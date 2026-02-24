const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

function urlToTitle(url: string): string {
  try {
    const u = new URL(url);
    const path = u.pathname.replace(/\/$/, '').split('/').pop() || '';
    const decoded = decodeURIComponent(path).replace(/[-_]/g, ' ').replace(/\.\w+$/, '');
    if (decoded.length > 5) return decoded.substring(0, 80);
    return u.hostname.replace('www.', '');
  } catch { return url.substring(0, 80); }
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

async function perplexitySearch(apiKey: string, query: string): Promise<{ content: string; citations: string[] }> {
  const response = await fetch('https://api.perplexity.ai/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'sonar',
      messages: [
        { role: 'system', content: 'Você é um analista de transparência pública. Pesquise informações no Portal da Transparência do Governo Federal. Seja objetivo e estruturado. Sempre em português.' },
        { role: 'user', content: query },
      ],
      temperature: 0.1,
      search_domain_filter: ['portaldatransparencia.gov.br', 'gov.br'],
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
    const { cnpj } = await req.json();
    if (!cnpj) {
      return new Response(JSON.stringify({ success: false, error: 'CNPJ é obrigatório' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const firecrawlKey = Deno.env.get('FIRECRAWL_API_KEY');
    const perplexityKey = Deno.env.get('PERPLEXITY_API_KEY');

    if (!firecrawlKey && !perplexityKey) {
      return new Response(JSON.stringify({ success: false, error: 'Nenhuma API de busca configurada' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const cleanCnpj = cnpj.replace(/\D/g, '');
    const cnpjFormatted = cleanCnpj.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');

    console.log('Buscando Portal da Transparência (Firecrawl+Perplexity) para:', cnpjFormatted);

    const markdownParts: string[] = [];
    const fontes: Array<{ url: string; titulo: string; fonte: string }> = [];

    // Firecrawl search
    if (firecrawlKey) {
      try {
        const fcResults = await firecrawlSearch(firecrawlKey,
          `Portal da Transparência empresa CNPJ ${cnpjFormatted} contratos licitações sanções penalidades valores recebidos governo federal`
        );
        for (const r of fcResults) {
          const title = r.title || urlToTitle(r.url || '');
          if (r.markdown || r.description) markdownParts.push(`## ${title}\n\n${r.markdown || r.description}`);
          if (r.url && !fontes.find(f => f.url === r.url)) {
            fontes.push({ url: r.url, titulo: title, fonte: (() => { try { return new URL(r.url).hostname; } catch { return 'web'; } })() });
          }
        }
      } catch (err) { console.error('Firecrawl error:', err); }
    }

    // Perplexity search
    if (perplexityKey) {
      try {
        const ppResult = await perplexitySearch(perplexityKey,
          `Pesquise no Portal da Transparência sobre a empresa com CNPJ ${cnpjFormatted}. Informe: 1) Contratos e licitações com o governo, 2) Valores recebidos do governo federal, 3) Sanções, penalidades ou impedimentos, 4) Outras informações relevantes.`
        );
        if (ppResult.content) markdownParts.push(`## Análise Perplexity\n\n${ppResult.content}`);
        for (const url of ppResult.citations) {
          if (!fontes.find(f => f.url === url)) {
            fontes.push({ url, titulo: urlToTitle(url), fonte: (() => { try { return new URL(url).hostname; } catch { return 'web'; } })() });
          }
        }
      } catch (err) { console.error('Perplexity error:', err); }
    }

    const fullMarkdown = markdownParts.join('\n\n---\n\n');
    const resumo = extractResumo(fullMarkdown);

    return new Response(
      JSON.stringify({
        success: true,
        cnpj: cleanCnpj,
        url: `https://portaldatransparencia.gov.br/pessoa-juridica/${cleanCnpj}`,
        markdown: fullMarkdown,
        resumo,
        fontes,
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

function extractResumo(content: string): { contratos: string[]; valoresRecebidos: string[]; sancoes: string[]; outrasInfos: string[] } {
  const lines = content.split('\n').filter(l => l.trim());
  const contratos: string[] = [], valoresRecebidos: string[] = [], sancoes: string[] = [], outrasInfos: string[] = [];
  let currentSection = '';
  for (const line of lines) {
    const lower = line.toLowerCase();
    if (lower.includes('contrato') || lower.includes('licitaç') || lower.includes('convênio')) currentSection = 'contratos';
    else if (lower.includes('receb') || lower.includes('pagamento') || lower.includes('valor') || lower.includes('r$')) currentSection = 'valores';
    else if (lower.includes('sanç') || lower.includes('penalidade') || lower.includes('impediment') || lower.includes('inidone') || lower.includes('suspens')) currentSection = 'sancoes';
    if (currentSection === 'contratos' && line.trim().length > 5) contratos.push(line.trim());
    else if (currentSection === 'valores' && line.trim().length > 5) valoresRecebidos.push(line.trim());
    else if (currentSection === 'sancoes' && line.trim().length > 5) sancoes.push(line.trim());
    else if (line.trim().length > 10) outrasInfos.push(line.trim());
  }
  return { contratos: contratos.slice(0, 20), valoresRecebidos: valoresRecebidos.slice(0, 20), sancoes: sancoes.slice(0, 10), outrasInfos: outrasInfos.slice(0, 10) };
}
