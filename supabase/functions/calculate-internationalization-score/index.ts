const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

interface ModalityResult {
  eligible: boolean;
  score: number;
  estimated_amount_usd: number;
  interest_rate: number;
  grace_period: string;
  observations: string[];
  requirements_met: string[];
  requirements_missing: string[];
}

function analyzeCorporateFinance(data: any): ModalityResult {
  const fin = data.financial_data || {};
  const col = data.collaterals || {};
  const intl = data.internationalization_capacity || {};
  
  const faturamento = fin.receita_bruta_anual || fin.faturamento_anual || 0;
  const totalGarantiasReais = (col.imoveis || [])
    .filter((i: any) => i.livre_onus)
    .reduce((s: number, i: any) => s + (i.valor_avaliacao || 0), 0);
  const coberturaJuros = fin.ebitda && fin.despesas_financeiras ? fin.ebitda / fin.despesas_financeiras : fin.ebitda ? 3 : 0;
  
  const reqsMet: string[] = [];
  const reqsMissing: string[] = [];
  
  if (faturamento >= 24_000_000) reqsMet.push('Faturamento ≥ R$24MM'); else reqsMissing.push('Faturamento < R$24MM');
  if (totalGarantiasReais > 0) reqsMet.push('Garantias reais disponíveis'); else reqsMissing.push('Sem garantias reais');
  if (coberturaJuros > 2) reqsMet.push('Cobertura de juros adequada'); else reqsMissing.push('Cobertura de juros insuficiente');
  if (intl.estrutura_juridica_internacional) reqsMet.push('Estrutura jurídica internacional'); else reqsMissing.push('Sem estrutura jurídica internacional');
  if (col.imoveis?.some((i: any) => i.livre_onus)) reqsMet.push('Imóveis livres de ônus'); else reqsMissing.push('Sem imóveis livres de ônus');
  
  const score = Math.min(100, (reqsMet.length / (reqsMet.length + reqsMissing.length)) * 100);
  const ltv = score >= 70 ? 0.6 : score >= 50 ? 0.45 : 0.3;
  const valorAprovavel = totalGarantiasReais * ltv / 5.5; // convertendo para USD aprox
  
  return {
    eligible: score >= 60,
    score: Math.round(score),
    estimated_amount_usd: Math.round(valorAprovavel),
    interest_rate: 12,
    grace_period: '3-6 anos',
    observations: score >= 60 ? ['Empresa elegível para Corporate Finance'] : ['Necessário fortalecer garantias e estrutura'],
    requirements_met: reqsMet,
    requirements_missing: reqsMissing,
  };
}

function analyzeBonds(data: any): ModalityResult {
  const fin = data.financial_data || {};
  const intl = data.internationalization_capacity || {};
  
  const faturamento = fin.receita_bruta_anual || fin.faturamento_anual || 0;
  const reqsMet: string[] = [];
  const reqsMissing: string[] = [];
  
  if (faturamento >= 100_000_000) reqsMet.push('Faturamento ≥ R$100MM'); else reqsMissing.push('Faturamento < R$100MM');
  if (intl.possui_rating) reqsMet.push('Possui rating'); else reqsMissing.push('Sem rating de agência');
  if (intl.governanca_internacional) reqsMet.push('Governança internacional'); else reqsMissing.push('Sem governança internacional');
  if (intl.experiencia_exportacao_anos >= 3) reqsMet.push('Experiência exportação ≥ 3 anos'); else reqsMissing.push('Experiência exportação < 3 anos');
  if ((fin.endividamento_total || 1) < 0.5) reqsMet.push('Endividamento < 50%'); else reqsMissing.push('Endividamento elevado');
  if (intl.registro_bolsa_valores) reqsMet.push('Registro em bolsa'); else reqsMissing.push('Sem registro em bolsa');
  
  const score = Math.min(100, (reqsMet.length / (reqsMet.length + reqsMissing.length)) * 100);
  
  return {
    eligible: score >= 80,
    score: Math.round(score),
    estimated_amount_usd: score >= 80 ? Math.round(faturamento * 0.3 / 5.5) : 0,
    interest_rate: 8,
    grace_period: '5-10 anos',
    observations: ['Modalidade mais sofisticada - exige estrutura premium'],
    requirements_met: reqsMet,
    requirements_missing: reqsMissing,
  };
}

function analyzeStockFunding(data: any): ModalityResult {
  const col = data.collaterals || {};
  const acoes = col.acoes_bolsa || [];
  
  const totalAcoes = acoes.reduce((s: number, a: any) => s + (a.valor_mercado || 0), 0);
  const liquidezOk = acoes.every((a: any) => a.liquidez === 'alta' || a.liquidez === 'media');
  
  const reqsMet: string[] = [];
  const reqsMissing: string[] = [];
  
  if (totalAcoes >= 10_000_000) reqsMet.push('Ações ≥ R$10MM'); else reqsMissing.push('Ações < R$10MM');
  if (liquidezOk && acoes.length > 0) reqsMet.push('Liquidez adequada'); else reqsMissing.push('Liquidez insuficiente');
  if (acoes.length > 0) reqsMet.push('Possui ações em bolsa'); else reqsMissing.push('Sem ações em bolsa');
  
  const score = Math.min(100, (reqsMet.length / Math.max(1, reqsMet.length + reqsMissing.length)) * 100);
  
  return {
    eligible: score >= 60 && totalAcoes > 0,
    score: Math.round(score),
    estimated_amount_usd: Math.round(totalAcoes * 0.7 / 5.5),
    interest_rate: 10,
    grace_period: '2-5 anos',
    observations: totalAcoes > 0 ? ['70% LTV típico sobre valor de mercado'] : ['Necessário ações listadas em bolsa'],
    requirements_met: reqsMet,
    requirements_missing: reqsMissing,
  };
}

function analyzeCashBacked(data: any): ModalityResult {
  const col = data.collaterals || {};
  const conta = col.conta_investimento || {};
  
  const reqsMet: string[] = [];
  const reqsMissing: string[] = [];
  
  if (conta.banco_prime) reqsMet.push('Banco prime (Tier 1)'); else reqsMissing.push('Sem conta em banco prime');
  if ((conta.valor_total || 0) >= 3_000_000) reqsMet.push('Investimentos ≥ R$3MM'); else reqsMissing.push('Investimentos < R$3MM');
  
  const score = Math.min(100, (reqsMet.length / Math.max(1, reqsMet.length + reqsMissing.length)) * 100);
  
  return {
    eligible: conta.banco_prime && (conta.valor_total || 0) >= 3_000_000,
    score: Math.round(score),
    estimated_amount_usd: Math.round((conta.valor_total || 0) * 0.9 / 5.5),
    interest_rate: 6,
    grace_period: '1-3 anos',
    observations: [
      'Mantém propriedade dos recursos',
      'Pode continuar auferindo rendimentos',
      'Preserva flexibilidade e privacidade',
    ],
    requirements_met: reqsMet,
    requirements_missing: reqsMissing,
  };
}

function analyzePrivateHardLender(data: any): ModalityResult {
  const fin = data.financial_data || {};
  const col = data.collaterals || {};
  
  const temGarantias = (col.imoveis || []).length > 0;
  const ebitdaPositivo = (fin.ebitda || 0) > 0;
  
  const reqsMet: string[] = [];
  const reqsMissing: string[] = [];
  
  if (temGarantias) reqsMet.push('Possui garantias reais'); else reqsMissing.push('Sem garantias reais');
  if (ebitdaPositivo) reqsMet.push('EBITDA positivo'); else reqsMissing.push('EBITDA negativo ou zero');
  
  const score = Math.min(100, (reqsMet.length / Math.max(1, reqsMet.length + reqsMissing.length)) * 100);
  const totalGarantias = (col.imoveis || []).reduce((s: number, i: any) => s + (i.valor_avaliacao || 0), 0);
  
  return {
    eligible: score >= 50,
    score: Math.round(score),
    estimated_amount_usd: Math.round(totalGarantias * 0.5 / 5.5),
    interest_rate: 18,
    grace_period: '1-2 anos',
    observations: ['Opção para empresas com negativação ou alta alavancagem', 'Taxa mais elevada compensada pela flexibilidade'],
    requirements_met: reqsMet,
    requirements_missing: reqsMissing,
  };
}

function calculateOverallScore(data: any): {
  score: number;
  classification: string;
  breakdown: Record<string, number>;
} {
  const fin = data.financial_data || {};
  const col = data.collaterals || {};
  const intl = data.internationalization_capacity || {};
  const liab = data.liabilities || {};
  
  const faturamento = fin.receita_bruta_anual || fin.faturamento_anual || 0;
  
  // Tamanho (20%)
  const tamanho = Math.min(100, (faturamento / 24_000_000) * 100);
  
  // Saúde Financeira (25%)
  let saude = 0;
  if ((fin.liquidez_corrente || 0) >= 1.5) saude += 30;
  else if ((fin.liquidez_corrente || 0) >= 1) saude += 15;
  if ((fin.margem_liquida || 0) > 10) saude += 30;
  else if ((fin.margem_liquida || 0) > 5) saude += 15;
  if ((fin.endividamento_total || 1) < 0.4) saude += 20;
  else if ((fin.endividamento_total || 1) < 0.6) saude += 10;
  if ((fin.roe || 0) > 15) saude += 20;
  else if ((fin.roe || 0) > 8) saude += 10;
  
  // Garantias (20%)
  const totalGarantias = (col.imoveis || []).reduce((s: number, i: any) => s + (i.valor_avaliacao || 0), 0)
    + (col.acoes_bolsa || []).reduce((s: number, a: any) => s + (a.valor_mercado || 0), 0)
    + (col.conta_investimento?.valor_total || 0);
  const garantias = Math.min(100, (totalGarantias / 10_000_000) * 100);
  
  // Experiência Internacional (15%)
  let experiencia = 0;
  if (intl.experiencia_exportacao_anos >= 5) experiencia = 100;
  else if (intl.experiencia_exportacao_anos >= 3) experiencia = 70;
  else if (intl.experiencia_exportacao_anos >= 1) experiencia = 40;
  if (intl.tem_offshore_company) experiencia = Math.min(100, experiencia + 20);
  
  // Governança (10%)
  let governanca = 0;
  if (intl.governanca_internacional) governanca = 100;
  else if (intl.auditoria_internacional) governanca = 70;
  else if (intl.compliance_internacional) governanca = 40;
  
  // Ausência de Passivos Críticos (10%)
  let passivos = 100;
  if ((liab.protestos || []).length > 0) passivos -= 30;
  if (!(liab.dividas_fiscais?.certidao_negativa)) passivos -= 30;
  if ((liab.acoes_judiciais?.quantidade || 0) > 5) passivos -= 20;
  if ((liab.score_credito_serasa || 1000) < 500) passivos -= 20;
  passivos = Math.max(0, passivos);
  
  const breakdown = { tamanho, saude, garantias, experiencia, governanca, passivos };
  
  const score = (tamanho * 0.20) + (saude * 0.25) + (garantias * 0.20) + 
                (experiencia * 0.15) + (governanca * 0.10) + (passivos * 0.10);
  
  let classification: string;
  if (score >= 80) classification = 'Excelente';
  else if (score >= 60) classification = 'Bom';
  else if (score >= 40) classification = 'Regular';
  else classification = 'Insuficiente';
  
  return { score: Math.round(score * 100) / 100, classification, breakdown };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json();
    const { financial_data, collaterals, liabilities, internationalization_capacity } = body;

    const data = { financial_data, collaterals, liabilities, internationalization_capacity };

    // Calculate all modality scores
    const modalities = {
      corporate_finance: analyzeCorporateFinance(data),
      bonds: analyzeBonds(data),
      stock_funding: analyzeStockFunding(data),
      cash_backed: analyzeCashBacked(data),
      private_hard_lender: analyzePrivateHardLender(data),
    };

    // Calculate overall score
    const overall = calculateOverallScore(data);

    // Determine eligible modalities
    const eligibleModalities = Object.entries(modalities)
      .filter(([_, m]) => m.eligible)
      .map(([key, m]) => ({ modality: key, score: m.score, amount: m.estimated_amount_usd }));

    // Total estimated credit
    const totalCreditUsd = eligibleModalities.reduce((s, m) => s + m.amount, 0);

    // Risk classification
    let riskClass: string;
    if (overall.score >= 80) riskClass = 'AAA';
    else if (overall.score >= 70) riskClass = 'AA';
    else if (overall.score >= 60) riskClass = 'A';
    else if (overall.score >= 50) riskClass = 'BBB';
    else if (overall.score >= 40) riskClass = 'BB';
    else riskClass = 'B';

    // Generate recommendations
    const recommendations: string[] = [];
    if (!data.internationalization_capacity?.estrutura_juridica_internacional) {
      recommendations.push('Estabelecer estrutura jurídica internacional (offshore ou subsidiária)');
    }
    if ((data.financial_data?.endividamento_total || 1) > 0.5) {
      recommendations.push('Reduzir nível de endividamento para abaixo de 50%');
    }
    if (!(data.liabilities?.dividas_fiscais?.certidao_negativa)) {
      recommendations.push('Obter certidão negativa de débitos fiscais');
    }
    if (!data.internationalization_capacity?.governanca_internacional) {
      recommendations.push('Implementar governança corporativa internacional');
    }
    if ((data.collaterals?.imoveis || []).length === 0) {
      recommendations.push('Apresentar garantias reais (imóveis) para aumentar elegibilidade');
    }

    return new Response(
      JSON.stringify({
        success: true,
        overall_score: overall.score,
        risk_classification: riskClass,
        classification: overall.classification,
        score_breakdown: overall.breakdown,
        modalities,
        eligible_modalities: eligibleModalities,
        estimated_credit_total_usd: totalCreditUsd,
        recommendations,
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
