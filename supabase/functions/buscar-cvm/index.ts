const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

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
        { role: 'system', content: 'Você é um analista financeiro especializado em dados da CVM (Comissão de Valores Mobiliários). Extraia dados estruturados das demonstrações financeiras. Responda em JSON quando solicitado.' },
        { role: 'user', content: query },
      ],
      temperature: 0.1,
    }),
  });

  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || `Erro ${response.status}`);
  return {
    content: data.choices?.[0]?.message?.content || '',
    citations: data.citations || [],
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const { cnpj, razao_social } = await req.json();
    if (!cnpj) {
      return new Response(JSON.stringify({ success: false, error: 'CNPJ é obrigatório' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const apiKey = Deno.env.get('PERPLEXITY_API_KEY');
    if (!apiKey) {
      return new Response(JSON.stringify({ success: false, error: 'Perplexity não configurado' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const cleanCnpj = cnpj.replace(/\D/g, '');
    const cnpjFormatted = cleanCnpj.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
    const nome = razao_social || cnpjFormatted;

    console.log(`Buscando dados CVM para: ${nome} (${cnpjFormatted})`);

    // Search for CVM financial data
    const { content, citations } = await perplexitySearch(apiKey,
      `Pesquise os dados financeiros mais recentes da empresa "${nome}" CNPJ ${cnpjFormatted} na CVM (Comissão de Valores Mobiliários). 
      Busque nas demonstrações financeiras padronizadas (DFP) ou informações trimestrais (ITR).
      Informe os seguintes dados se disponíveis:
      - Receita líquida
      - Lucro líquido
      - EBITDA
      - Patrimônio líquido
      - Ativo total
      - Passivo total
      - Endividamento líquido
      - Margem EBITDA
      - ROE
      - Se a empresa é registrada na CVM (companhia aberta)
      - Categoria de registro CVM (A ou B)
      - Se possui ações listadas em bolsa (B3)
      - Rating de crédito se houver
      Se a empresa não for registrada na CVM, informe isso claramente.`
    );

    // Parse financial data from response
    const isRegistradaCVM = /registrad[ao] na CVM|companhia aberta|listada na B3/i.test(content);
    const categoriaMatch = content.match(/categoria\s*["']?([AB])["']?/i);
    const listadaB3 = /listada na B3|ações negociadas|bolsa de valores/i.test(content);
    
    // Extract numeric values
    const extractValue = (patterns: RegExp[]): number => {
      for (const p of patterns) {
        const m = content.match(p);
        if (m) {
          const val = m[1].replace(/\./g, '').replace(',', '.');
          const num = parseFloat(val);
          // Handle billions/millions
          if (/bilh/i.test(m[0])) return num * 1_000_000_000;
          if (/milh/i.test(m[0])) return num * 1_000_000;
          return num;
        }
      }
      return 0;
    };

    const receitaLiquida = extractValue([
      /receita\s+l[ií]quida[^R]*R\$\s*([\d.,]+)\s*(bilh|milh)?/i,
    ]);
    const lucroLiquido = extractValue([
      /lucro\s+l[ií]quido[^R]*R\$\s*([\d.,]+)\s*(bilh|milh)?/i,
    ]);
    const ebitda = extractValue([
      /EBITDA[^R]*R\$\s*([\d.,]+)\s*(bilh|milh)?/i,
    ]);
    const patrimonioLiquido = extractValue([
      /patrim[oô]nio\s+l[ií]quido[^R]*R\$\s*([\d.,]+)\s*(bilh|milh)?/i,
    ]);
    const ativoTotal = extractValue([
      /ativo\s+total[^R]*R\$\s*([\d.,]+)\s*(bilh|milh)?/i,
    ]);

    const ratingMatch = content.match(/(Moody's|S&P|Fitch|rating)[^:]*:\s*([A-Za-z0-9+\-]+)/i);

    return new Response(JSON.stringify({
      success: true,
      cnpj: cleanCnpj,
      is_registrada_cvm: isRegistradaCVM,
      categoria_cvm: categoriaMatch?.[1] || null,
      listada_b3: listadaB3,
      dados_financeiros: {
        receita_liquida: receitaLiquida,
        lucro_liquido: lucroLiquido,
        ebitda,
        patrimonio_liquido: patrimonioLiquido,
        ativo_total: ativoTotal,
      },
      rating: ratingMatch ? { agencia: ratingMatch[1], nota: ratingMatch[2] } : null,
      resumo: content,
      fontes: citations,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (error) {
    console.error('Error:', error);
    return new Response(
      JSON.stringify({ success: false, error: error instanceof Error ? error.message : 'Erro desconhecido' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
