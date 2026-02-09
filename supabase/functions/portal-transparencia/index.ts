const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
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

    const apiKey = Deno.env.get('PERPLEXITY_API_KEY');
    if (!apiKey) {
      return new Response(
        JSON.stringify({ success: false, error: 'Perplexity não configurado' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const cleanCnpj = cnpj.replace(/\D/g, '');
    const cnpjFormatted = cleanCnpj.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');

    console.log('Buscando Portal da Transparência para:', cnpjFormatted);

    const response = await fetch('https://api.perplexity.ai/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'sonar',
        messages: [
          { role: 'system', content: 'Você é um analista de transparência pública. Pesquise informações no Portal da Transparência do Governo Federal sobre a empresa solicitada. Informe contratos com o governo, valores recebidos, sanções e penalidades. Seja objetivo e estruturado. Sempre em português.' },
          { role: 'user', content: `Pesquise no Portal da Transparência sobre a empresa com CNPJ ${cnpjFormatted}. Informe: 1) Contratos e licitações com o governo, 2) Valores recebidos do governo federal, 3) Sanções, penalidades ou impedimentos, 4) Outras informações relevantes.` },
        ],
        temperature: 0.1,
        search_domain_filter: ['portaldatransparencia.gov.br', 'gov.br'],
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('Perplexity error:', data);
      return new Response(
        JSON.stringify({ success: false, error: data.error?.message || `Erro ${response.status}` }),
        { status: response.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const content = data.choices?.[0]?.message?.content || '';
    const citations = data.citations || [];
    const resumo = extractResumo(content);

    const result = {
      success: true,
      cnpj: cleanCnpj,
      url: `https://portaldatransparencia.gov.br/pessoa-juridica/${cleanCnpj}`,
      markdown: content,
      resumo,
      fontes: citations.map((url: string) => ({ url, titulo: urlToTitle(url), fonte: (() => { try { return new URL(url).hostname; } catch { return 'web'; } })() })),
    };

    return new Response(
      JSON.stringify(result),
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
