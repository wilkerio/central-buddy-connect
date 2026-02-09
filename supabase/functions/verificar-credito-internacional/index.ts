const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { cnpj, razao_social } = await req.json();

    if (!cnpj && !razao_social) {
      return new Response(
        JSON.stringify({ success: false, error: 'CNPJ ou razão social é obrigatório' }),
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

    const nome = razao_social || cnpj;
    console.log(`Buscando crédito internacional para: ${nome}`);

    const searches = [
      {
        tipo: 'credito_internacional',
        label: 'Crédito Internacional / Trade Finance',
        query: `"${nome}" crédito internacional trade finance carta crédito financiamento exportação importação BNDES-Exim ACC ACE`,
      },
      {
        tipo: 'operacoes_cambio',
        label: 'Operações de Câmbio',
        query: `"${nome}" câmbio operação cambial exportação importação dólar remessa internacional`,
      },
      {
        tipo: 'relacoes_internacionais',
        label: 'Relações Internacionais',
        query: `"${nome}" subsidiária filial exterior parceiro internacional joint venture operação global`,
      },
    ];

    const results: Record<string, any> = {};
    let indicadoresPositivos = 0;
    let evidencias: string[] = [];

    await Promise.all(
      searches.map(async (search) => {
        try {
          const response = await fetch('https://api.firecrawl.dev/v1/search', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${apiKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ query: search.query, limit: 5 }),
          });

          const data = await response.json();

          if (response.ok) {
            const items = (data.data || []).map((r: any) => ({
              titulo: r.title || 'Sem título',
              descricao: r.description || '',
              url: r.url || '',
              fonte: r.url ? new URL(r.url).hostname : 'desconhecida',
            }));

            // Check for strong indicators
            for (const item of items) {
              const text = `${item.titulo} ${item.descricao}`.toLowerCase();
              const keywords = [
                'carta de crédito', 'letter of credit', 'trade finance',
                'acc', 'ace', 'bndes-exim', 'financiamento à exportação',
                'crédito internacional', 'câmbio', 'exportação', 'importação',
                'subsidiária', 'filial no exterior', 'operação internacional',
              ];
              for (const kw of keywords) {
                if (text.includes(kw) && !evidencias.includes(kw)) {
                  evidencias.push(kw);
                  indicadoresPositivos++;
                }
              }
            }

            results[search.tipo] = {
              label: search.label,
              encontrados: items.length,
              items,
            };
          } else {
            results[search.tipo] = { label: search.label, encontrados: 0, items: [] };
          }
        } catch (err) {
          console.error(`Error searching ${search.tipo}:`, err);
          results[search.tipo] = { label: search.label, encontrados: 0, items: [] };
        }
      })
    );

    // Determine status
    const totalResultados = Object.values(results).reduce((a: number, s: any) => a + s.encontrados, 0);
    let status: string;
    let confianca: string;

    if (indicadoresPositivos >= 5 && totalResultados >= 8) {
      status = 'confirmado';
      confianca = 'alta';
    } else if (indicadoresPositivos >= 3 || totalResultados >= 5) {
      status = 'provavel';
      confianca = 'média';
    } else if (indicadoresPositivos >= 1 || totalResultados >= 2) {
      status = 'possivel';
      confianca = 'baixa';
    } else {
      status = 'nao_encontrado';
      confianca = 'n/a';
    }

    return new Response(
      JSON.stringify({
        success: true,
        status,
        confianca,
        indicadoresPositivos,
        evidencias: evidencias.slice(0, 10),
        totalResultados,
        categorias: results,
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
