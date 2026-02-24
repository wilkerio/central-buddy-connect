const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

interface DadoVerificado {
  categoria: string;
  titulo: string;
  valor: string;
  confianca: 'verificado' | 'alta' | 'media' | 'baixa' | 'estimativa';
  fontes: Array<{ nome: string; url: string; tipo: string }>;
  detalhes?: string;
  verificado: boolean;
}

function classifySource(url: string): { nome: string; tipo: string } {
  let tipo = 'web'; let nome = '';
  try {
    const u = new URL(url); nome = u.hostname.replace('www.', '');
    if (nome.includes('gov.br') || nome.includes('cvm.gov') || nome.includes('bcb.gov')) tipo = 'oficial';
    else if (nome.includes('b3.com') || nome.includes('bovespa')) tipo = 'oficial';
    else if (nome.includes('valor.com') || nome.includes('infomoney') || nome.includes('bloomberg') || nome.includes('reuters')) tipo = 'imprensa_financeira';
    else if (nome.includes('jusbrasil') || nome.includes('escavador')) tipo = 'juridico';
    else if (nome.includes('reclameaqui')) tipo = 'consumidor';
    else if (nome.includes('abstractapi')) tipo = 'validacao';
  } catch { nome = url.substring(0, 50); }
  return { nome, tipo };
}

async function firecrawlSearch(apiKey: string, query: string) {
  const response = await fetch('https://api.firecrawl.dev/v1/search', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, limit: 5, lang: 'pt-br', country: 'BR', scrapeOptions: { formats: ['markdown'] } }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `Firecrawl error: ${response.status}`);
  return data.data || [];
}

async function perplexitySearch(apiKey: string, query: string, systemPrompt: string) {
  const response = await fetch('https://api.perplexity.ai/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'sonar-pro', messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: query }], temperature: 0.1, search_recency_filter: 'year' }),
  });
  const ct = response.headers.get('content-type') || '';
  if (!ct.includes('application/json')) { await response.text(); throw new Error(`Perplexity retornou ${response.status}`); }
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || `Perplexity error: ${response.status}`);
  return { content: data.choices?.[0]?.message?.content || '', citations: data.citations || [] };
}

async function abstractApiCompanyEnrich(apiKey: string, domain: string) {
  try {
    const response = await fetch(`https://companyenrichment.abstractapi.com/v2/?api_key=${apiKey}&domain=${encodeURIComponent(domain)}`);
    if (!response.ok) return null;
    return await response.json();
  } catch { return null; }
}

// Cross-validate data: check if a value appears in multiple sources
function crossValidate(allContent: string[], valor: string): { encontrado_em: number; verificado: boolean } {
  const normalizado = valor.toLowerCase().replace(/[^\w\d]/g, '');
  let count = 0;
  for (const content of allContent) {
    if (content.toLowerCase().replace(/[^\w\d]/g, '').includes(normalizado)) count++;
  }
  return { encontrado_em: count, verificado: count >= 2 };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const { cnpj, razao_social, capital_social, porte, cnae_fiscal } = await req.json();
    if (!cnpj || !razao_social) {
      return new Response(JSON.stringify({ success: false, error: 'CNPJ e razão social são obrigatórios' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const firecrawlKey = Deno.env.get('FIRECRAWL_API_KEY');
    const perplexityKey = Deno.env.get('PERPLEXITY_API_KEY');
    const companyKey = Deno.env.get('ABSTRACTAPI_COMPANY_KEY');
    const dados: DadoVerificado[] = [];
    const todasFontes: Array<{ nome: string; url: string; tipo: string }> = [];

    const systemPrompt = 'Você é um analista de dados corporativos. Responda APENAS com fatos verificáveis. Nunca invente dados. Sempre em português brasileiro.';

    const queries = [
      { categoria: 'faturamento', titulo: 'Faturamento & Receita',
        fcQuery: `"${razao_social}" CNPJ ${cnpj} faturamento receita bruta receita líquida anual 2024 2025`,
        ppQuery: `Qual o faturamento e receita da empresa "${razao_social}" (CNPJ: ${cnpj})? Dados de 2023-2025.` },
      { categoria: 'dividas_processos', titulo: 'Dívidas & Processos',
        fcQuery: `"${razao_social}" CNPJ ${cnpj} dívida ativa protestos processos judiciais sanções`,
        ppQuery: `A empresa "${razao_social}" (CNPJ: ${cnpj}) possui dívidas, protestos ou processos judiciais?` },
      { categoria: 'reputacao_mercado', titulo: 'Reputação de Mercado',
        fcQuery: `"${razao_social}" CNPJ ${cnpj} reputação notícias reclamações rating crédito`,
        ppQuery: `Qual a reputação de mercado da empresa "${razao_social}" (CNPJ: ${cnpj})?` },
      { categoria: 'comercio_exterior', titulo: 'Comércio Exterior',
        fcQuery: `"${razao_social}" CNPJ ${cnpj} exportação importação comércio exterior`,
        ppQuery: `A empresa "${razao_social}" (CNPJ: ${cnpj}) realiza comércio exterior?` },
    ];

    // Run all searches in parallel
    const searchResults = await Promise.allSettled(
      queries.map(async (q) => {
        const fontesCitadas: Array<{ nome: string; url: string; tipo: string }> = [];
        const contentSources: string[] = [];

        const [fcRes, ppRes] = await Promise.allSettled([
          firecrawlKey ? firecrawlSearch(firecrawlKey, q.fcQuery) : Promise.resolve([]),
          perplexityKey ? perplexitySearch(perplexityKey, q.ppQuery, systemPrompt) : Promise.resolve({ content: '', citations: [] }),
        ]);

        if (fcRes.status === 'fulfilled') {
          const results = fcRes.value as any[];
          const fcContent = results.map((r: any) => r.markdown || r.description || '').join('\n');
          contentSources.push(fcContent);
          for (const r of results) {
            if (r.url) { const src = classifySource(r.url); fontesCitadas.push({ ...src, url: r.url }); }
          }
        }

        if (ppRes.status === 'fulfilled') {
          const pp = ppRes.value as { content: string; citations: string[] };
          contentSources.push(pp.content);
          for (const url of pp.citations) {
            if (!fontesCitadas.find(f => f.url === url)) { const src = classifySource(url); fontesCitadas.push({ ...src, url }); }
          }
        }

        todasFontes.push(...fontesCitadas);
        const allContent = contentSources.join('\n');

        // Extract monetary values and cross-validate
        const valores = allContent.match(/R\$\s?[\d.,]+(?:\s?(?:bilh[ãõ]es?|milh[ãõ]es?|mil|bi|mi|B|M|K))?/gi) || [];
        const valorPrincipal = valores[0] || 'Não encontrado';

        // Cross-validation: did the value appear in multiple sources?
        const validation = valorPrincipal !== 'Não encontrado' ? crossValidate(contentSources, valorPrincipal) : { encontrado_em: 0, verificado: false };

        const temFonteOficial = fontesCitadas.some(f => f.tipo === 'oficial');
        const naoEncontrado = allContent.length < 50;

        let confianca: DadoVerificado['confianca'];
        if (validation.verificado) confianca = 'verificado';
        else if (temFonteOficial) confianca = 'alta';
        else if (fontesCitadas.some(f => f.tipo === 'imprensa_financeira')) confianca = 'media';
        else if (fontesCitadas.length > 0) confianca = 'baixa';
        else confianca = 'estimativa';

        if (naoEncontrado) confianca = 'estimativa';

        return {
          categoria: q.categoria,
          titulo: q.titulo,
          valor: naoEncontrado ? 'Sem dados públicos' : valorPrincipal,
          confianca,
          fontes: fontesCitadas,
          detalhes: allContent.substring(0, 600),
          verificado: validation.verificado,
        } as DadoVerificado;
      })
    );

    for (const result of searchResults) {
      if (result.status === 'fulfilled') dados.push(result.value);
    }

    // ===== AbstractAPI Company Enrichment =====
    if (companyKey) {
      // Try to infer domain from razao_social
      const domainGuess = razao_social.toLowerCase()
        .replace(/\s*(s\.?a\.?|ltda\.?|me|eireli|construtora|incorporadora|e\s)\s*/gi, '')
        .replace(/[^a-z0-9]/g, '')
        .substring(0, 30);

      const domainsToTry = [`${domainGuess}.com.br`, `${domainGuess}.com`];

      for (const domain of domainsToTry) {
        const enrichment = await abstractApiCompanyEnrich(companyKey, domain);
        if (enrichment && enrichment.name) {
          dados.push({
            categoria: 'enrichment_empresa',
            titulo: 'Dados Verificados (AbstractAPI)',
            valor: enrichment.name || razao_social,
            confianca: 'verificado',
            verificado: true,
            fontes: [{ nome: 'AbstractAPI', url: `https://companyenrichment.abstractapi.com`, tipo: 'validacao' }],
            detalhes: [
              enrichment.industry ? `Setor: ${enrichment.industry}` : '',
              enrichment.employees_range ? `Funcionários: ${enrichment.employees_range}` : '',
              enrichment.revenue_range ? `Receita: ${enrichment.revenue_range}` : '',
              enrichment.type ? `Tipo: ${enrichment.type}` : '',
              enrichment.founded_year ? `Fundada: ${enrichment.founded_year}` : '',
              enrichment.phone_numbers?.length ? `Telefones: ${enrichment.phone_numbers.join(', ')}` : '',
              enrichment.email_addresses?.length ? `Emails: ${enrichment.email_addresses.join(', ')}` : '',
            ].filter(Boolean).join(' | '),
          });
          todasFontes.push({ nome: 'AbstractAPI', url: 'https://companyenrichment.abstractapi.com', tipo: 'validacao' });
          break; // Found data, no need to try other domains
        }
      }
    }

    // Dados da ReceitaWS
    dados.unshift({
      categoria: 'cadastro_receita',
      titulo: 'Cadastro na Receita Federal',
      valor: `Capital Social: R$ ${(capital_social || 0).toLocaleString('pt-BR')}`,
      confianca: 'verificado',
      verificado: true,
      fontes: [{ nome: 'Receita Federal', url: 'https://servicos.receita.fazenda.gov.br/servicos/cnpjreva/cnpjreva_solicitacao.asp', tipo: 'oficial' }],
      detalhes: `Porte: ${porte || 'N/A'} | CNAE: ${cnae_fiscal || 'N/A'}`,
    });

    const fontesUnicas = [...new Map(todasFontes.map(f => [f.url, f])).values()];
    const totalVerificados = dados.filter(d => d.verificado).length;

    return new Response(
      JSON.stringify({
        success: true,
        dados,
        verificacao: {
          total_dados: dados.length,
          total_verificados: totalVerificados,
          total_fontes: fontesUnicas.length,
          fontes_oficiais: fontesUnicas.filter(f => f.tipo === 'oficial').length,
          fontes_validacao: fontesUnicas.filter(f => f.tipo === 'validacao').length,
          apis_utilizadas: [firecrawlKey ? 'Firecrawl' : null, perplexityKey ? 'Perplexity' : null, companyKey ? 'AbstractAPI' : null].filter(Boolean),
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
