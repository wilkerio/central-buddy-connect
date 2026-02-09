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

    // Search for different types of debts in parallel
    const searches = [
      {
        tipo: 'divida_ativa',
        label: 'Dívida Ativa da União',
        query: `"${cnpjFormatted}" OR "${cleanCnpj}" dívida ativa PGFN site:pgfn.fazenda.gov.br OR site:regularize.pgfn.gov.br`,
      },
      {
        tipo: 'protestos',
        label: 'Protestos em Cartório',
        query: `"${cnpjFormatted}" OR "${cleanCnpj}" OR "${nome}" protesto cartório títulos protestados`,
      },
      {
        tipo: 'processos',
        label: 'Processos Judiciais',
        query: `"${cnpjFormatted}" OR "${cleanCnpj}" OR "${nome}" processo judicial execução fiscal ação`,
      },
    ];

    const results: Record<string, any> = {};

    await Promise.all(
      searches.map(async (search) => {
        try {
          const response = await fetch('https://api.firecrawl.dev/v1/search', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${apiKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              query: search.query,
              limit: 5,
            }),
          });

          const data = await response.json();

          if (response.ok) {
            const items = (data.data || []).map((r: any) => ({
              titulo: r.title || 'Sem título',
              descricao: r.description || '',
              url: r.url || '',
              fonte: r.url ? new URL(r.url).hostname : 'desconhecida',
            }));

            // Extract monetary values from descriptions
            const valores: string[] = [];
            for (const item of items) {
              const text = `${item.titulo} ${item.descricao}`;
              const matches = text.match(/R\$\s?[\d.,]+/g);
              if (matches) valores.push(...matches);
            }

            results[search.tipo] = {
              label: search.label,
              encontrados: items.length,
              items,
              valores: [...new Set(valores)],
            };
          } else {
            console.error(`Search error for ${search.tipo}:`, data);
            results[search.tipo] = {
              label: search.label,
              encontrados: 0,
              items: [],
              valores: [],
              error: data.error || `Erro ${response.status}`,
            };
          }
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
      JSON.stringify({
        success: true,
        cnpj: cleanCnpj,
        dividas: results,
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
