const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

interface DadoVerificado {
  categoria: string;
  titulo: string;
  valor: string;
  confianca: 'alta' | 'media' | 'baixa' | 'estimativa';
  fontes: Array<{ nome: string; url: string; tipo: string }>;
  detalhes?: string;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { cnpj, razao_social, capital_social, porte, cnae_fiscal } = await req.json();
    if (!cnpj || !razao_social) {
      return new Response(
        JSON.stringify({ success: false, error: 'CNPJ e razão social são obrigatórios' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const perplexityKey = Deno.env.get('PERPLEXITY_API_KEY');
    const firecrawlKey = Deno.env.get('FIRECRAWL_API_KEY');
    const dados: DadoVerificado[] = [];
    const todasFontes: Array<{ nome: string; url: string; tipo: string }> = [];

    // ===== 1. PERPLEXITY: Busca geral com citações =====
    if (perplexityKey) {
      const queries = [
        {
          categoria: 'faturamento',
          prompt: `Qual o faturamento, receita bruta e receita líquida anual da empresa "${razao_social}" (CNPJ: ${cnpj})? Busque dados de 2023, 2024 ou 2025. Informe valores exatos em R$ e a fonte oficial. Se for empresa listada, use dados da CVM/B3.`,
        },
        {
          categoria: 'dividas_processos',
          prompt: `A empresa "${razao_social}" (CNPJ: ${cnpj}) possui dívidas ativas, protestos, processos judiciais ou sanções governamentais? Busque em fontes oficiais (PGFN, tribunais, CEIS, CNEP). Informe valores e status.`,
        },
        {
          categoria: 'reputacao_mercado',
          prompt: `Qual a reputação de mercado da empresa "${razao_social}" (CNPJ: ${cnpj})? Busque notícias recentes, prêmios, reclamações no Reclame Aqui, rating de crédito e posição no mercado. Informe fatos concretos com datas.`,
        },
        {
          categoria: 'comercio_exterior',
          prompt: `A empresa "${razao_social}" (CNPJ: ${cnpj}) realiza operações de comércio exterior (exportação/importação)? Busque dados no Comex Stat, Siscomex ou fontes oficiais. Informe volumes, países de destino e produtos.`,
        },
      ];

      const perplexityResults = await Promise.allSettled(
        queries.map(async (q) => {
          const response = await fetch('https://api.perplexity.ai/chat/completions', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${perplexityKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              model: 'sonar-pro',
              messages: [
                {
                  role: 'system',
                  content: 'Você é um analista de dados corporativos. Responda APENAS com fatos verificáveis e suas fontes. Nunca invente dados. Se não encontrar, diga explicitamente. Sempre em português brasileiro.',
                },
                { role: 'user', content: q.prompt },
              ],
              temperature: 0.1,
              search_recency_filter: 'year',
            }),
          });

          const ct = response.headers.get('content-type') || '';
          if (!ct.includes('application/json')) {
            const text = await response.text();
            console.error('Perplexity returned non-JSON:', text.substring(0, 200));
            throw new Error(`API retornou ${response.status} (${ct || 'unknown'})`);
          }
          const data = await response.json();
          if (!response.ok) throw new Error(`Perplexity error: ${response.status}`);

          const content = data.choices?.[0]?.message?.content || '';
          const citations = (data.citations || []) as string[];

          // Determinar confiança baseado nas citações
          const fontesCitadas = citations.map((url: string) => {
            let tipo = 'web';
            let nome = '';
            try {
              const u = new URL(url);
              nome = u.hostname.replace('www.', '');
              // Classificar fonte
              if (nome.includes('gov.br') || nome.includes('cvm.gov') || nome.includes('bcb.gov')) tipo = 'oficial';
              else if (nome.includes('b3.com') || nome.includes('bovespa')) tipo = 'oficial';
              else if (nome.includes('valor.com') || nome.includes('infomoney') || nome.includes('bloomberg') || nome.includes('reuters')) tipo = 'imprensa_financeira';
              else if (nome.includes('jusbrasil') || nome.includes('escavador') || nome.includes('consulta')) tipo = 'juridico';
              else if (nome.includes('reclameaqui')) tipo = 'consumidor';
            } catch {
              nome = url.substring(0, 50);
            }
            return { nome, url, tipo };
          });

          todasFontes.push(...fontesCitadas);

          // Confiança baseada no tipo de fontes
          const temFonteOficial = fontesCitadas.some(f => f.tipo === 'oficial');
          const temImprensaFinanceira = fontesCitadas.some(f => f.tipo === 'imprensa_financeira');
          const confianca: DadoVerificado['confianca'] = temFonteOficial ? 'alta' : temImprensaFinanceira ? 'media' : fontesCitadas.length > 0 ? 'baixa' : 'estimativa';

          // Extrair valores monetários
          const valores = content.match(/R\$\s?[\d.,]+(?:\s?(?:bilh[ãõ]es?|milh[ãõ]es?|mil|bi|mi|B|M|K))?/gi) || [];
          const valorPrincipal = valores[0] || 'Não encontrado';

          // Detectar se dados foram realmente encontrados
          const naoEncontrado = content.toLowerCase().includes('não foram encontrad') || 
            content.toLowerCase().includes('não há dados') ||
            content.toLowerCase().includes('não foi possível') ||
            content.toLowerCase().includes('não encontrei');

          return {
            categoria: q.categoria,
            titulo: q.categoria === 'faturamento' ? 'Faturamento & Receita' :
                    q.categoria === 'dividas_processos' ? 'Dívidas & Processos' :
                    q.categoria === 'reputacao_mercado' ? 'Reputação de Mercado' :
                    'Comércio Exterior',
            valor: naoEncontrado ? 'Sem dados públicos' : valorPrincipal,
            confianca: naoEncontrado ? 'estimativa' : confianca,
            fontes: fontesCitadas,
            detalhes: content.substring(0, 500),
          } as DadoVerificado;
        })
      );

      for (const result of perplexityResults) {
        if (result.status === 'fulfilled') {
          dados.push(result.value);
        }
      }
    }

    // ===== 2. FIRECRAWL: Scrape de fontes específicas =====
    if (firecrawlKey) {
      const cnpjClean = cnpj.replace(/\D/g, '');
      const scrapeSources = [
        {
          url: `https://casfrancisco.cnpja.com/office/${cnpjClean}`,
          categoria: 'cadastro_oficial',
          titulo: 'Dados Cadastrais',
        },
        {
          url: `https://www.reclameaqui.com.br/busca/?q=${encodeURIComponent(razao_social)}`,
          categoria: 'reputacao_consumidor',
          titulo: 'Reputação do Consumidor',
        },
      ];

      const firecrawlResults = await Promise.allSettled(
        scrapeSources.map(async (source) => {
          const response = await fetch('https://api.firecrawl.dev/v1/scrape', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${firecrawlKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              url: source.url,
              formats: ['markdown'],
              onlyMainContent: true,
              waitFor: 3000,
            }),
          });

          const data = await response.json();
          if (!response.ok) return null;

          const markdown = data?.data?.markdown || data?.markdown || '';
          if (!markdown || markdown.length < 50) return null;

          // Extrair informações relevantes
          const valores = markdown.match(/R\$\s?[\d.,]+(?:\s?(?:bilh[ãõ]es?|milh[ãõ]es?|mil))?/gi) || [];
          const rating = markdown.match(/nota\s*:?\s*([\d.,]+)/i)?.[1] || markdown.match(/score\s*:?\s*([\d.,]+)/i)?.[1];

          return {
            categoria: source.categoria,
            titulo: source.titulo,
            valor: rating ? `Nota: ${rating}` : valores[0] || 'Dados encontrados',
            confianca: 'media' as const,
            fontes: [{ nome: new URL(source.url).hostname.replace('www.', ''), url: source.url, tipo: 'scraping' }],
            detalhes: markdown.substring(0, 400),
          } as DadoVerificado;
        })
      );

      for (const result of firecrawlResults) {
        if (result.status === 'fulfilled' && result.value) {
          dados.push(result.value);
          todasFontes.push(...result.value.fontes);
        }
      }
    }

    // ===== 3. Dados da ReceitaWS (sempre alta confiança) =====
    dados.unshift({
      categoria: 'cadastro_receita',
      titulo: 'Cadastro na Receita Federal',
      valor: `Capital Social: R$ ${(capital_social || 0).toLocaleString('pt-BR')}`,
      confianca: 'alta',
      fontes: [{ nome: 'Receita Federal', url: `https://servicos.receita.fazenda.gov.br/servicos/cnpjreva/cnpjreva_solicitacao.asp`, tipo: 'oficial' }],
      detalhes: `Porte: ${porte || 'N/A'} | CNAE: ${cnae_fiscal || 'N/A'}`,
    });

    // Estatísticas gerais
    const fontesUnicas = [...new Map(todasFontes.map(f => [f.url, f])).values()];
    const fontesOficiais = fontesUnicas.filter(f => f.tipo === 'oficial').length;
    const confiancaGeral: DadoVerificado['confianca'] = 
      fontesOficiais >= 2 ? 'alta' :
      fontesUnicas.length >= 3 ? 'media' :
      fontesUnicas.length >= 1 ? 'baixa' : 'estimativa';

    return new Response(
      JSON.stringify({
        success: true,
        dados,
        resumo: {
          total_dados: dados.length,
          total_fontes: fontesUnicas.length,
          fontes_oficiais: fontesOficiais,
          confianca_geral: confiancaGeral,
        },
        fontes: fontesUnicas,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error:', error);
    return new Response(
      JSON.stringify({ success: false, error: error instanceof Error ? error.message : 'Erro desconhecido' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
