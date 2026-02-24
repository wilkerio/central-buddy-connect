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

// Multiplicadores de faturamento por CNAE
const MULTIPLICADORES_CNAE: Record<string, { mult: number; label: string }> = {
  '46': { mult: 8, label: 'Comércio Atacadista' }, '47': { mult: 10, label: 'Comércio Varejista' },
  '10': { mult: 6, label: 'Alimentos' }, '11': { mult: 6, label: 'Bebidas' },
  '20': { mult: 4, label: 'Química' }, '21': { mult: 5, label: 'Farmacêutica' },
  '29': { mult: 5, label: 'Automotivo' }, '62': { mult: 3, label: 'Tecnologia' },
  '64': { mult: 2, label: 'Financeiro' }, '65': { mult: 2, label: 'Seguros' },
  '49': { mult: 4, label: 'Transporte Terrestre' }, '50': { mult: 4, label: 'Transporte Aquaviário' },
  '51': { mult: 3, label: 'Transporte Aéreo' }, '41': { mult: 5, label: 'Construção Civil' },
  '01': { mult: 6, label: 'Agropecuária' }, '06': { mult: 3, label: 'Petróleo/Gás' },
  '07': { mult: 4, label: 'Mineração' }, '86': { mult: 4, label: 'Saúde' },
};

const MULTIPLICADORES_PORTE: Record<string, number> = {
  'MICRO EMPRESA': 3, 'EMPRESA DE PEQUENO PORTE': 5, 'DEMAIS': 8, 'GRANDE': 10,
};

function estimarFaturamento(capitalSocial: number, cnae: number, porte: string, anosAtividade: number) {
  const cnaePrefix = String(cnae).substring(0, 2);
  const cnaeInfo = MULTIPLICADORES_CNAE[cnaePrefix] || { mult: 4, label: 'Geral' };
  const porteMult = Object.entries(MULTIPLICADORES_PORTE).find(([key]) => porte?.toUpperCase().includes(key))?.[1] || 4;
  const faturamentoAnual = capitalSocial * cnaeInfo.mult * (porteMult / 4);
  const maturidadeFator = Math.min(2, 1 + (anosAtividade / 20));
  const faturamentoAjustado = faturamentoAnual * maturidadeFator;
  const meses = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
  const sazonalidade = [0.85, 0.80, 0.95, 0.90, 1.00, 0.95, 0.88, 0.92, 1.05, 1.10, 1.20, 1.40];
  const mensal = meses.map((mes, i) => ({ mes, valor: Math.round((faturamentoAjustado / 12) * sazonalidade[i]) }));
  return {
    anual: Math.round(faturamentoAjustado), mensal, setor: cnaeInfo.label,
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

    const anosAtividade = data_inicio_atividade
      ? new Date().getFullYear() - new Date(data_inicio_atividade).getFullYear()
      : 5;

    const estimativa = estimarFaturamento(capital_social || 100000, cnae_fiscal || 0, porte || '', anosAtividade);

    let dadosWeb: any[] = [];
    const apiKey = Deno.env.get('PERPLEXITY_API_KEY');

    if (apiKey) {
      const nome = razao_social || '';
      console.log(`Buscando faturamento para: ${nome}`);

      try {
        const response = await fetch('https://api.perplexity.ai/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'sonar',
            messages: [
              { role: 'system', content: 'Você é um analista financeiro. Pesquise e informe dados reais de faturamento e receita da empresa solicitada. Inclua valores em R$ e fontes. Sempre em português.' },
              { role: 'user', content: `Qual o faturamento/receita bruta anual da empresa "${nome}"? Inclua dados de 2023, 2024 ou 2025 se disponíveis.` },
            ],
            temperature: 0.1,
          }),
        });

        const contentType = response.headers.get('content-type') || '';
        if (!contentType.includes('application/json')) {
          await response.text();
          throw new Error(`API retornou formato inesperado (${response.status})`);
        }
        const data = await response.json();

        if (response.ok) {
          const content = data.choices?.[0]?.message?.content || '';
          const citations = data.citations || [];

          const valoresBI = content.match(/R\$\s?[\d.,]+\s?(?:bilh[ãõ]|bi)/gi) || [];
          const valoresMI = content.match(/R\$\s?[\d.,]+\s?(?:milh[ãõ]|mi)/gi) || [];
          const valoresSimples = content.match(/R\$\s?[\d.,]+/g) || [];

          dadosWeb = [{
            titulo: 'Análise de Faturamento',
            descricao: content.substring(0, 300),
            url: citations[0] || '',
            fonte: citations[0] ? new URL(citations[0]).hostname : 'perplexity',
            valoresEncontrados: [...valoresBI, ...valoresMI, ...valoresSimples.slice(0, 3)].slice(0, 5),
          }];

          for (const url of citations.slice(0, 4)) {
            dadosWeb.push({
              titulo: urlToTitle(url),
              descricao: '',
              url,
              fonte: new URL(url).hostname,
              valoresEncontrados: [],
            });
          }
        }
      } catch (err) {
        console.error('Erro buscando faturamento na web:', err);
      }
    }

    return new Response(
      JSON.stringify({ success: true, estimativa, dadosWeb: dadosWeb.slice(0, 5) }),
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
