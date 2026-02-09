const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

// Multiplicadores de faturamento por CNAE (faixa do CNAE fiscal -> multiplicador sobre capital social)
const MULTIPLICADORES_CNAE: Record<string, { mult: number; label: string }> = {
  '46': { mult: 8, label: 'Comércio Atacadista' },
  '47': { mult: 10, label: 'Comércio Varejista' },
  '10': { mult: 6, label: 'Alimentos' },
  '11': { mult: 6, label: 'Bebidas' },
  '20': { mult: 4, label: 'Química' },
  '21': { mult: 5, label: 'Farmacêutica' },
  '29': { mult: 5, label: 'Automotivo' },
  '62': { mult: 3, label: 'Tecnologia' },
  '64': { mult: 2, label: 'Financeiro' },
  '65': { mult: 2, label: 'Seguros' },
  '49': { mult: 4, label: 'Transporte Terrestre' },
  '50': { mult: 4, label: 'Transporte Aquaviário' },
  '51': { mult: 3, label: 'Transporte Aéreo' },
  '41': { mult: 5, label: 'Construção Civil' },
  '01': { mult: 6, label: 'Agropecuária' },
  '06': { mult: 3, label: 'Petróleo/Gás' },
  '07': { mult: 4, label: 'Mineração' },
  '86': { mult: 4, label: 'Saúde' },
};

// Multiplicadores por porte
const MULTIPLICADORES_PORTE: Record<string, number> = {
  'MICRO EMPRESA': 3,
  'EMPRESA DE PEQUENO PORTE': 5,
  'DEMAIS': 8,
  'GRANDE': 10,
};

function estimarFaturamento(capitalSocial: number, cnae: number, porte: string, anosAtividade: number) {
  const cnaePrefix = String(cnae).substring(0, 2);
  const cnaeInfo = MULTIPLICADORES_CNAE[cnaePrefix] || { mult: 4, label: 'Geral' };

  const porteMult = Object.entries(MULTIPLICADORES_PORTE).find(
    ([key]) => porte?.toUpperCase().includes(key)
  )?.[1] || 4;

  // Base: capital social * multiplicador CNAE * fator porte
  const faturamentoAnual = capitalSocial * cnaeInfo.mult * (porteMult / 4);

  // Ajuste por anos de atividade (empresas maduras tendem a faturar mais)
  const maturidadeFator = Math.min(2, 1 + (anosAtividade / 20));
  const faturamentoAjustado = faturamentoAnual * maturidadeFator;

  // Gerar estimativa mensal com variação sazonal
  const meses = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
  const sazonalidade = [0.85, 0.80, 0.95, 0.90, 1.00, 0.95, 0.88, 0.92, 1.05, 1.10, 1.20, 1.40];

  const mensal = meses.map((mes, i) => ({
    mes,
    valor: Math.round((faturamentoAjustado / 12) * sazonalidade[i]),
  }));

  return {
    anual: Math.round(faturamentoAjustado),
    mensal,
    setor: cnaeInfo.label,
    confianca: capitalSocial >= 1_000_000 ? 'média' : capitalSocial >= 100_000 ? 'baixa' : 'muito baixa',
    metodologia: `Capital Social (${(capitalSocial / 1000000).toFixed(1)}M) × Multiplicador ${cnaeInfo.label} (${cnaeInfo.mult}x) × Fator Porte (${porteMult / 4}x) × Maturidade (${maturidadeFator.toFixed(1)}x)`,
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { cnpj, razao_social, capital_social, cnae_fiscal, porte, data_inicio_atividade } = await req.json();

    if (!cnpj) {
      return new Response(
        JSON.stringify({ success: false, error: 'CNPJ é obrigatório' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 1. Calculate estimate
    const anosAtividade = data_inicio_atividade
      ? new Date().getFullYear() - new Date(data_inicio_atividade).getFullYear()
      : 5;

    const estimativa = estimarFaturamento(
      capital_social || 100000,
      cnae_fiscal || 0,
      porte || '',
      anosAtividade
    );

    // 2. Search web for real revenue data
    let dadosWeb: any[] = [];
    const apiKey = Deno.env.get('FIRECRAWL_API_KEY');

    if (apiKey) {
      const nome = razao_social || '';
      const query = `"${nome}" faturamento receita receita bruta bilhões milhões anual 2024 2025`;

      console.log(`Buscando faturamento para: ${nome}`);

      try {
        const response = await fetch('https://api.firecrawl.dev/v1/search', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ query, limit: 5 }),
        });

        const data = await response.json();

        if (response.ok && data.data) {
          dadosWeb = data.data.map((r: any) => {
            const text = `${r.title || ''} ${r.description || ''}`;

            // Extract monetary values
            const valoresBI = text.match(/R\$\s?[\d.,]+\s?(?:bilh[ãõ]|bi)/gi) || [];
            const valoresMI = text.match(/R\$\s?[\d.,]+\s?(?:milh[ãõ]|mi)/gi) || [];
            const valoresSimples = text.match(/R\$\s?[\d.,]+/g) || [];

            return {
              titulo: r.title || '',
              descricao: r.description || '',
              url: r.url || '',
              fonte: r.url ? new URL(r.url).hostname : '',
              valoresEncontrados: [...valoresBI, ...valoresMI, ...valoresSimples.slice(0, 3)].slice(0, 5),
            };
          }).filter((r: any) => r.valoresEncontrados.length > 0 || r.titulo);
        }
      } catch (err) {
        console.error('Erro buscando faturamento na web:', err);
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        estimativa,
        dadosWeb: dadosWeb.slice(0, 5),
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
