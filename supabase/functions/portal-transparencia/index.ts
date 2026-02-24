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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { cnpj } = await req.json();

    if (!cnpj) {
      return new Response(
        JSON.stringify({ success: false, error: 'CNPJ é obrigatório' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const apiKey = Deno.env.get('FIRECRAWL_API_KEY');
    if (!apiKey) {
      return new Response(
        JSON.stringify({ success: false, error: 'Firecrawl não configurado' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const cleanCnpj = cnpj.replace(/\D/g, '');
    const cnpjFormatted = cleanCnpj.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');

    console.log('Buscando Portal da Transparência para:', cnpjFormatted);

    const response = await fetch('https://api.firecrawl.dev/v1/search', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query: `Portal da Transparência empresa CNPJ ${cnpjFormatted} contratos licitações sanções penalidades valores recebidos governo federal`,
        limit: 10,
        lang: 'pt-br',
        country: 'BR',
        scrapeOptions: { formats: ['markdown'] },
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('Firecrawl error:', data);
      return new Response(
        JSON.stringify({ success: false, error: data.error || `Erro ${response.status}` }),
        { status: response.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const results = data.data || [];
    const markdownParts: string[] = [];
    const fontes: Array<{ url: string; titulo: string; fonte: string }> = [];

    for (const result of results) {
      const title = result.title || urlToTitle(result.url || '');
      const content = result.markdown || result.description || '';
      if (content) {
        markdownParts.push(`## ${title}\n\n${content}`);
      }
      if (result.url) {
        fontes.push({
          url: result.url,
          titulo: title,
          fonte: (() => { try { return new URL(result.url).hostname; } catch { return 'web'; } })(),
        });
      }
    }

    const fullMarkdown = markdownParts.join('\n\n---\n\n');
    const resumo = extractResumo(fullMarkdown);

    const resultData = {
      success: true,
      cnpj: cleanCnpj,
      url: `https://portaldatransparencia.gov.br/pessoa-juridica/${cleanCnpj}`,
      markdown: fullMarkdown,
      resumo,
      fontes,
    };

    return new Response(
      JSON.stringify(resultData),
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

function extractResumo(content: string): {
  contratos: string[];
  valoresRecebidos: string[];
  sancoes: string[];
  outrasInfos: string[];
} {
  const lines = content.split('\n').filter(l => l.trim());
  const contratos: string[] = [];
  const valoresRecebidos: string[] = [];
  const sancoes: string[] = [];
  const outrasInfos: string[] = [];
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

  return {
    contratos: contratos.slice(0, 20),
    valoresRecebidos: valoresRecebidos.slice(0, 20),
    sancoes: sancoes.slice(0, 10),
    outrasInfos: outrasInfos.slice(0, 10),
  };
}
