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

function citationsToItems(citations: string[]) {
  return citations.map((url: string) => ({
    titulo: urlToTitle(url),
    descricao: '',
    url,
    fonte: (() => { try { return new URL(url).hostname; } catch { return 'web'; } })(),
    valores: [] as string[],
    areas: [] as string[],
  }));
}

async function perplexitySearch(apiKey: string, query: string): Promise<{ content: string; citations: string[] }> {
  const response = await fetch('https://api.perplexity.ai/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'sonar',
      messages: [
        { role: 'system', content: 'Você é um analista de crédito brasileiro. Responda de forma estruturada e objetiva, incluindo valores monetários e áreas quando disponíveis. Sempre em português.' },
        { role: 'user', content: query },
      ],
      temperature: 0.1,
    }),
  });

  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || `Erro ${response.status}`);
  return { content: data.choices?.[0]?.message?.content || '', citations: data.citations || [] };
}

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

    const apiKey = Deno.env.get('PERPLEXITY_API_KEY');
    if (!apiKey) {
      return new Response(
        JSON.stringify({ success: false, error: 'Perplexity não configurado' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const cleanCnpj = cnpj.replace(/\D/g, '');
    const cnpjFormatted = cleanCnpj.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
    const nome = razao_social || cnpjFormatted;

    console.log(`Buscando garantias/patrimônio para: ${nome}`);

    const searches = [
      {
        tipo: 'imoveis',
        label: 'Imóveis e Propriedades',
        query: `Pesquise sobre imóveis, propriedades, sedes e galpões da empresa "${nome}" CNPJ ${cnpjFormatted}. Informe endereços, áreas em m² e valores estimados.`,
      },
      {
        tipo: 'veiculos',
        label: 'Frota e Veículos',
        query: `Pesquise sobre frota de veículos e caminhões da empresa "${nome}" CNPJ ${cnpjFormatted}. Informe quantidade e tipos de veículos.`,
      },
      {
        tipo: 'patrimonio',
        label: 'Patrimônio e Ativos',
        query: `Pesquise sobre patrimônio líquido, ativo total, balanço patrimonial e bens da empresa "${nome}" CNPJ ${cnpjFormatted}. Informe valores e garantias disponíveis.`,
      },
    ];

    const results: Record<string, any> = {};

    await Promise.all(
      searches.map(async (search) => {
        try {
          const { content, citations } = await perplexitySearch(apiKey, search.query);
          const valores = content.match(/R\$\s?[\d.,]+(?:\s?(?:milh[ãõ]|bilh[ãõ]|mi|bi|mil))?/gi) || [];
          const areas = content.match(/[\d.,]+\s?m²/gi) || [];

          const items = citationsToItems(citations);
          if (items.length > 0 && content) items[0].descricao = content.substring(0, 200);

          results[search.tipo] = {
            label: search.label,
            encontrados: items.length,
            items,
            resumo: content,
          };
        } catch (err) {
          console.error(`Error searching ${search.tipo}:`, err);
          results[search.tipo] = { label: search.label, encontrados: 0, items: [], error: String(err) };
        }
      })
    );

    const porteUpper = (porte || '').toUpperCase();
    let patrimonioMultiplicador = 2;
    if (porteUpper.includes('GRANDE') || porteUpper.includes('DEMAIS')) patrimonioMultiplicador = 5;
    else if (porteUpper.includes('MEDIO') || porteUpper.includes('MÉDIA')) patrimonioMultiplicador = 3;

    const patrimonioEstimado = (capital_social || 100000) * patrimonioMultiplicador;

    return new Response(
      JSON.stringify({
        success: true, cnpj: cleanCnpj, garantias: results,
        estimativa: {
          patrimonioEstimado,
          garantiaMinima: Math.round(patrimonioEstimado * 0.3),
          garantiaMaxima: Math.round(patrimonioEstimado * 0.7),
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
