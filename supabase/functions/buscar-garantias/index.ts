const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { cnpj, razao_social, capital_social, porte } = await req.json();

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

    console.log(`Buscando garantias/patrimônio para: ${nome}`);

    // Search for different asset types in parallel
    const searches = [
      {
        tipo: 'imoveis',
        label: 'Imóveis e Propriedades',
        query: `"${nome}" OR "${cnpjFormatted}" imóvel propriedade sede terreno galpão escritório endereço`,
      },
      {
        tipo: 'veiculos',
        label: 'Frota e Veículos',
        query: `"${nome}" frota veículos caminhões automóveis patrimônio`,
      },
      {
        tipo: 'patrimonio',
        label: 'Patrimônio e Ativos',
        query: `"${nome}" patrimônio líquido ativo total balanço patrimonial bens garantia`,
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
            const items = (data.data || []).map((r: any) => {
              const text = `${r.title || ''} ${r.description || ''}`;
              
              // Extract monetary values
              const valores = text.match(/R\$\s?[\d.,]+(?:\s?(?:milh[ãõ]|bilh[ãõ]|mi|bi|mil))?/gi) || [];
              // Extract areas (m²)
              const areas = text.match(/[\d.,]+\s?m²/gi) || [];

              return {
                titulo: r.title || 'Sem título',
                descricao: r.description || '',
                url: r.url || '',
                fonte: r.url ? new URL(r.url).hostname : 'desconhecida',
                valores: [...new Set(valores)].slice(0, 4),
                areas: [...new Set(areas)].slice(0, 3),
              };
            });

            results[search.tipo] = {
              label: search.label,
              encontrados: items.length,
              items,
            };
          } else {
            console.error(`Search error for ${search.tipo}:`, data);
            results[search.tipo] = { label: search.label, encontrados: 0, items: [], error: data.error };
          }
        } catch (err) {
          console.error(`Error searching ${search.tipo}:`, err);
          results[search.tipo] = { label: search.label, encontrados: 0, items: [], error: String(err) };
        }
      })
    );

    // Estimate patrimony based on capital social and porte
    const porteUpper = (porte || '').toUpperCase();
    let patrimonioMultiplicador = 2;
    if (porteUpper.includes('GRANDE') || porteUpper.includes('DEMAIS')) patrimonioMultiplicador = 5;
    else if (porteUpper.includes('MEDIO') || porteUpper.includes('MÉDIA')) patrimonioMultiplicador = 3;

    const patrimonioEstimado = (capital_social || 100000) * patrimonioMultiplicador;

    // Estimate guarantee capacity (typically 30-70% of patrimony)
    const garantiaMinima = Math.round(patrimonioEstimado * 0.3);
    const garantiaMaxima = Math.round(patrimonioEstimado * 0.7);

    return new Response(
      JSON.stringify({
        success: true,
        cnpj: cleanCnpj,
        garantias: results,
        estimativa: {
          patrimonioEstimado,
          garantiaMinima,
          garantiaMaxima,
          multiplicador: patrimonioMultiplicador,
          capacidadeGarantia: patrimonioEstimado >= 10_000_000 ? 'alta' :
                              patrimonioEstimado >= 1_000_000 ? 'média' :
                              patrimonioEstimado >= 100_000 ? 'baixa' : 'muito baixa',
        },
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
