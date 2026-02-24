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

async function firecrawlSearch(apiKey: string, query: string): Promise<{ results: Array<{ url: string; title: string; markdown: string; description: string }> }> {
  const response = await fetch('https://api.firecrawl.dev/v1/search', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query,
      limit: 5,
      lang: 'pt-br',
      country: 'BR',
      scrapeOptions: { formats: ['markdown'] },
    }),
  });

  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `Firecrawl error: ${response.status}`);
  return { results: data.data || [] };
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
  } catch {
    nome = url.substring(0, 50);
  }
  return { nome, tipo };
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

    const apiKey = Deno.env.get('FIRECRAWL_API_KEY');
    const dados: DadoVerificado[] = [];
    const todasFontes: Array<{ nome: string; url: string; tipo: string }> = [];

    if (apiKey) {
      const queries = [
        {
          categoria: 'faturamento',
          titulo: 'Faturamento & Receita',
          query: `"${razao_social}" CNPJ ${cnpj} faturamento receita bruta receita líquida anual 2024 2025`,
        },
        {
          categoria: 'dividas_processos',
          titulo: 'Dívidas & Processos',
          query: `"${razao_social}" CNPJ ${cnpj} dívida ativa protestos processos judiciais sanções PGFN CEIS`,
        },
        {
          categoria: 'reputacao_mercado',
          titulo: 'Reputação de Mercado',
          query: `"${razao_social}" CNPJ ${cnpj} reputação notícias reclamações Reclame Aqui rating crédito`,
        },
        {
          categoria: 'comercio_exterior',
          titulo: 'Comércio Exterior',
          query: `"${razao_social}" CNPJ ${cnpj} exportação importação comércio exterior Comex Stat`,
        },
      ];

      const searchResults = await Promise.allSettled(
        queries.map(async (q) => {
          const { results } = await firecrawlSearch(apiKey, q.query);

          const fontesCitadas = results
            .filter(r => r.url)
            .map(r => {
              const { nome, tipo } = classifySource(r.url);
              return { nome, url: r.url, tipo };
            });

          todasFontes.push(...fontesCitadas);

          const temFonteOficial = fontesCitadas.some(f => f.tipo === 'oficial');
          const temImprensaFinanceira = fontesCitadas.some(f => f.tipo === 'imprensa_financeira');
          const confianca: DadoVerificado['confianca'] = temFonteOficial ? 'alta' : temImprensaFinanceira ? 'media' : fontesCitadas.length > 0 ? 'baixa' : 'estimativa';

          const allContent = results.map(r => r.markdown || r.description || '').join('\n');
          const valores = allContent.match(/R\$\s?[\d.,]+(?:\s?(?:bilh[ãõ]es?|milh[ãõ]es?|mil|bi|mi|B|M|K))?/gi) || [];
          const valorPrincipal = valores[0] || 'Não encontrado';

          const naoEncontrado = results.length === 0 || allContent.length < 50;

          return {
            categoria: q.categoria,
            titulo: q.titulo,
            valor: naoEncontrado ? 'Sem dados públicos' : valorPrincipal,
            confianca: naoEncontrado ? 'estimativa' : confianca,
            fontes: fontesCitadas,
            detalhes: allContent.substring(0, 500),
          } as DadoVerificado;
        })
      );

      for (const result of searchResults) {
        if (result.status === 'fulfilled') {
          dados.push(result.value);
        }
      }
    }

    // Dados da ReceitaWS (sempre alta confiança)
    dados.unshift({
      categoria: 'cadastro_receita',
      titulo: 'Cadastro na Receita Federal',
      valor: `Capital Social: R$ ${(capital_social || 0).toLocaleString('pt-BR')}`,
      confianca: 'alta',
      fontes: [{ nome: 'Receita Federal', url: `https://servicos.receita.fazenda.gov.br/servicos/cnpjreva/cnpjreva_solicitacao.asp`, tipo: 'oficial' }],
      detalhes: `Porte: ${porte || 'N/A'} | CNAE: ${cnae_fiscal || 'N/A'}`,
    });

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
