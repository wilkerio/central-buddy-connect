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

function classifySource(url: string): { nome: string; tipo: string } {
  let tipo = 'web';
  let nome = '';
  try {
    const u = new URL(url);
    nome = u.hostname.replace('www.', '');
    if (nome.includes('gov.br') || nome.includes('cvm.gov') || nome.includes('bcb.gov')) tipo = 'oficial';
    else if (nome.includes('b3.com') || nome.includes('bovespa')) tipo = 'oficial';
    else if (nome.includes('valor.com') || nome.includes('infomoney') || nome.includes('bloomberg') || nome.includes('reuters')) tipo = 'imprensa_financeira';
    else if (nome.includes('jusbrasil') || nome.includes('escavador') || nome.includes('consulta')) tipo = 'juridico';
    else if (nome.includes('reclameaqui')) tipo = 'consumidor';
  } catch { nome = url.substring(0, 50); }
  return { nome, tipo };
}

async function firecrawlSearch(apiKey: string, query: string): Promise<Array<{ url: string; title: string; markdown: string; description: string }>> {
  const response = await fetch('https://api.firecrawl.dev/v1/search', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, limit: 5, lang: 'pt-br', country: 'BR', scrapeOptions: { formats: ['markdown'] } }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `Firecrawl error: ${response.status}`);
  return data.data || [];
}

async function perplexitySearch(apiKey: string, query: string, systemPrompt: string): Promise<{ content: string; citations: string[] }> {
  const response = await fetch('https://api.perplexity.ai/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'sonar-pro',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: query },
      ],
      temperature: 0.1,
      search_recency_filter: 'year',
    }),
  });
  const ct = response.headers.get('content-type') || '';
  if (!ct.includes('application/json')) {
    const text = await response.text();
    console.error('Perplexity non-JSON:', text.substring(0, 200));
    throw new Error(`Perplexity retornou ${response.status}`);
  }
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || `Perplexity error: ${response.status}`);
  return { content: data.choices?.[0]?.message?.content || '', citations: data.citations || [] };
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

    const firecrawlKey = Deno.env.get('FIRECRAWL_API_KEY');
    const perplexityKey = Deno.env.get('PERPLEXITY_API_KEY');
    const dados: DadoVerificado[] = [];
    const todasFontes: Array<{ nome: string; url: string; tipo: string }> = [];

    const queries = [
      {
        categoria: 'faturamento',
        titulo: 'Faturamento & Receita',
        fcQuery: `"${razao_social}" CNPJ ${cnpj} faturamento receita bruta receita líquida anual 2024 2025`,
        ppQuery: `Qual o faturamento, receita bruta e receita líquida anual da empresa "${razao_social}" (CNPJ: ${cnpj})? Busque dados de 2023, 2024 ou 2025.`,
      },
      {
        categoria: 'dividas_processos',
        titulo: 'Dívidas & Processos',
        fcQuery: `"${razao_social}" CNPJ ${cnpj} dívida ativa protestos processos judiciais sanções PGFN CEIS`,
        ppQuery: `A empresa "${razao_social}" (CNPJ: ${cnpj}) possui dívidas ativas, protestos, processos judiciais ou sanções governamentais?`,
      },
      {
        categoria: 'reputacao_mercado',
        titulo: 'Reputação de Mercado',
        fcQuery: `"${razao_social}" CNPJ ${cnpj} reputação notícias reclamações Reclame Aqui rating crédito`,
        ppQuery: `Qual a reputação de mercado da empresa "${razao_social}" (CNPJ: ${cnpj})? Busque notícias recentes, prêmios, reclamações no Reclame Aqui.`,
      },
      {
        categoria: 'comercio_exterior',
        titulo: 'Comércio Exterior',
        fcQuery: `"${razao_social}" CNPJ ${cnpj} exportação importação comércio exterior Comex Stat`,
        ppQuery: `A empresa "${razao_social}" (CNPJ: ${cnpj}) realiza operações de comércio exterior (exportação/importação)?`,
      },
    ];

    const systemPrompt = 'Você é um analista de dados corporativos. Responda APENAS com fatos verificáveis e suas fontes. Nunca invente dados. Se não encontrar, diga explicitamente. Sempre em português brasileiro.';

    const searchResults = await Promise.allSettled(
      queries.map(async (q) => {
        const fontesCitadas: Array<{ nome: string; url: string; tipo: string }> = [];
        let allContent = '';

        // Firecrawl
        if (firecrawlKey) {
          try {
            const fcResults = await firecrawlSearch(firecrawlKey, q.fcQuery);
            for (const r of fcResults) {
              if (r.url) {
                const src = classifySource(r.url);
                fontesCitadas.push({ ...src, url: r.url });
              }
            }
            allContent += fcResults.map(r => r.markdown || r.description || '').join('\n');
          } catch (err) { console.error(`Firecrawl error (${q.categoria}):`, err); }
        }

        // Perplexity
        if (perplexityKey) {
          try {
            const ppResult = await perplexitySearch(perplexityKey, q.ppQuery, systemPrompt);
            allContent += '\n' + ppResult.content;
            for (const url of ppResult.citations) {
              if (!fontesCitadas.find(f => f.url === url)) {
                const src = classifySource(url);
                fontesCitadas.push({ ...src, url });
              }
            }
          } catch (err) { console.error(`Perplexity error (${q.categoria}):`, err); }
        }

        todasFontes.push(...fontesCitadas);

        const temFonteOficial = fontesCitadas.some(f => f.tipo === 'oficial');
        const temImprensaFinanceira = fontesCitadas.some(f => f.tipo === 'imprensa_financeira');
        const confianca: DadoVerificado['confianca'] = temFonteOficial ? 'alta' : temImprensaFinanceira ? 'media' : fontesCitadas.length > 0 ? 'baixa' : 'estimativa';

        const valores = allContent.match(/R\$\s?[\d.,]+(?:\s?(?:bilh[ãõ]es?|milh[ãõ]es?|mil|bi|mi|B|M|K))?/gi) || [];
        const valorPrincipal = valores[0] || 'Não encontrado';
        const naoEncontrado = allContent.length < 50;

        return {
          categoria: q.categoria,
          titulo: q.titulo,
          valor: naoEncontrado ? 'Sem dados públicos' : valorPrincipal,
          confianca: naoEncontrado ? 'estimativa' : confianca,
          fontes: fontesCitadas,
          detalhes: allContent.substring(0, 600),
        } as DadoVerificado;
      })
    );

    for (const result of searchResults) {
      if (result.status === 'fulfilled') dados.push(result.value);
    }

    // Dados da ReceitaWS
    dados.unshift({
      categoria: 'cadastro_receita',
      titulo: 'Cadastro na Receita Federal',
      valor: `Capital Social: R$ ${(capital_social || 0).toLocaleString('pt-BR')}`,
      confianca: 'alta',
      fontes: [{ nome: 'Receita Federal', url: 'https://servicos.receita.fazenda.gov.br/servicos/cnpjreva/cnpjreva_solicitacao.asp', tipo: 'oficial' }],
      detalhes: `Porte: ${porte || 'N/A'} | CNAE: ${cnae_fiscal || 'N/A'}`,
    });

    const fontesUnicas = [...new Map(todasFontes.map(f => [f.url, f])).values()];
    const fontesOficiais = fontesUnicas.filter(f => f.tipo === 'oficial').length;
    const confiancaGeral: DadoVerificado['confianca'] =
      fontesOficiais >= 2 ? 'alta' : fontesUnicas.length >= 3 ? 'media' : fontesUnicas.length >= 1 ? 'baixa' : 'estimativa';

    return new Response(
      JSON.stringify({
        success: true,
        dados,
        resumo: { total_dados: dados.length, total_fontes: fontesUnicas.length, fontes_oficiais: fontesOficiais, confianca_geral: confiancaGeral },
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
