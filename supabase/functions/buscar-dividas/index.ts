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
  return data.data || [];
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { cnpj, razao_social } = await req.json();

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
    const nome = razao_social || cnpjFormatted;

    console.log(`Buscando dívidas para: ${nome} (${cnpjFormatted})`);

    const searches = [
      {
        tipo: 'divida_ativa',
        label: 'Dívida Ativa da União',
        query: `"${nome}" CNPJ ${cnpjFormatted} dívida ativa PGFN débitos inscritos`,
      },
      {
        tipo: 'protestos',
        label: 'Protestos em Cartório',
        query: `"${nome}" CNPJ ${cnpjFormatted} protestos cartório títulos protestados`,
      },
      {
        tipo: 'processos',
        label: 'Processos Judiciais',
        query: `"${nome}" CNPJ ${cnpjFormatted} processos judiciais execuções fiscais`,
      },
    ];

    const results: Record<string, any> = {};

    await Promise.all(
      searches.map(async (search) => {
        try {
          const searchResults = await firecrawlSearch(apiKey, search.query);
          const items = searchResults.map(r => ({
            titulo: r.title || urlToTitle(r.url || ''),
            descricao: (r.markdown || r.description || '').substring(0, 200),
            url: r.url,
            fonte: (() => { try { return new URL(r.url).hostname; } catch { return 'web'; } })(),
          }));

          const allContent = searchResults.map(r => r.markdown || r.description || '').join('\n');
          const valores = allContent.match(/R\$\s?[\d.,]+/g) || [];

          results[search.tipo] = {
            label: search.label,
            encontrados: items.length,
            items,
            valores: [...new Set(valores)],
            resumo: allContent.substring(0, 500),
          };
        } catch (err) {
          console.error(`Error searching ${search.tipo}:`, err);
          results[search.tipo] = {
            label: search.label,
            encontrados: 0,
            items: [],
            valores: [],
            error: err instanceof Error ? err.message : 'Erro desconhecido',
          };
        }
      })
    );

    return new Response(
      JSON.stringify({ success: true, cnpj: cleanCnpj, dividas: results }),
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
