const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

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
    const url = `https://portaldatransparencia.gov.br/pessoa-juridica/${cleanCnpj}`;

    console.log('Scraping Portal da Transparência:', url);

    const response = await fetch('https://api.firecrawl.dev/v1/scrape', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url,
        formats: ['markdown'],
        onlyMainContent: true,
        waitFor: 3000,
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

    // Parse the markdown to extract structured info
    const markdown = data.data?.markdown || data.markdown || '';
    
    // Try to extract key data points from the markdown
    const result = {
      success: true,
      cnpj: cleanCnpj,
      url,
      markdown,
      // Raw data for display
      resumo: extractResumo(markdown),
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

function extractResumo(markdown: string): {
  contratos: string[];
  valoresRecebidos: string[];
  sancoes: string[];
  outrasInfos: string[];
} {
  const lines = markdown.split('\n').filter(l => l.trim());
  
  const contratos: string[] = [];
  const valoresRecebidos: string[] = [];
  const sancoes: string[] = [];
  const outrasInfos: string[] = [];

  let currentSection = '';

  for (const line of lines) {
    const lower = line.toLowerCase();
    
    if (lower.includes('contrato') || lower.includes('licitaç') || lower.includes('convênio')) {
      currentSection = 'contratos';
    } else if (lower.includes('receb') || lower.includes('pagamento') || lower.includes('valor') || lower.includes('r$')) {
      currentSection = 'valores';
    } else if (lower.includes('sanç') || lower.includes('penalidade') || lower.includes('impediment') || lower.includes('inidone') || lower.includes('suspens')) {
      currentSection = 'sancoes';
    }

    if (currentSection === 'contratos' && line.trim().length > 5) {
      contratos.push(line.trim());
    } else if (currentSection === 'valores' && line.trim().length > 5) {
      valoresRecebidos.push(line.trim());
    } else if (currentSection === 'sancoes' && line.trim().length > 5) {
      sancoes.push(line.trim());
    } else if (line.trim().length > 10) {
      outrasInfos.push(line.trim());
    }
  }

  return {
    contratos: contratos.slice(0, 20),
    valoresRecebidos: valoresRecebidos.slice(0, 20),
    sancoes: sancoes.slice(0, 10),
    outrasInfos: outrasInfos.slice(0, 10),
  };
}
