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
        { role: 'system', content: 'Você é um analista de crédito bancário brasileiro. Responda de forma estruturada e objetiva, incluindo valores, termos bancários e indicadores quando disponíveis. Sempre em português.' },
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
    const { cnpj, razao_social } = await req.json();

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

    console.log(`Buscando endividamento bancário para: ${nome} (${cnpjFormatted})`);

    const searches = [
      {
        tipo: 'scr_operacoes',
        label: 'Operações de Crédito (SCR)',
        query: `Pesquise sobre operações de crédito bancário (SCR) da empresa "${nome}" CNPJ ${cnpjFormatted}. Informe empréstimos, financiamentos e operações de crédito.`,
      },
      {
        tipo: 'emprestimos_financiamentos',
        label: 'Empréstimos e Financiamentos',
        query: `Pesquise sobre empréstimos, financiamentos bancários, capital de giro e cheque especial da empresa "${nome}" CNPJ ${cnpjFormatted}. Informe valores e instituições financeiras.`,
      },
      {
        tipo: 'debentures_titulos',
        label: 'Debêntures e Títulos de Dívida',
        query: `Pesquise sobre debêntures, CRI, CRA, notas promissórias e títulos de dívida da empresa "${nome}" CNPJ ${cnpjFormatted}. Informe valores e condições.`,
      },
      {
        tipo: 'credito_rural_bndes',
        label: 'Crédito Rural e BNDES',
        query: `Pesquise sobre financiamentos do BNDES, FINAME, FINEM e crédito rural da empresa "${nome}" CNPJ ${cnpjFormatted}. Informe valores e programas.`,
      },
      {
        tipo: 'inadimplencia',
        label: 'Inadimplência Bancária',
        query: `Pesquise sobre inadimplência bancária, atrasos de pagamento e renegociação de dívidas bancárias da empresa "${nome}" CNPJ ${cnpjFormatted}.`,
      },
    ];

    const results: Record<string, any> = {};
    const termosAlvo = [
      'empréstimo', 'financiamento', 'crédito', 'capital de giro', 'cheque especial',
      'debênture', 'CRI', 'CRA', 'nota promissória', 'BNDES', 'FINAME', 'FINEM',
      'SCR', 'operação de crédito', 'inadimplência', 'renegociação', 'refinanciamento',
      'leasing', 'CDC', 'conta garantida', 'desconto de duplicatas', 'antecipação de recebíveis',
      'factoring', 'FIDC', 'securitização', 'spread bancário', 'taxa de juros',
      'crédito rural', 'custeio', 'investimento agropecuário',
    ];

    await Promise.all(
      searches.map(async (search) => {
        try {
          const { content, citations } = await perplexitySearch(apiKey, search.query);
          const valores = content.match(/R\$\s?[\d.,]+/g) || [];
          const termosBancarios: string[] = [];
          const textLower = content.toLowerCase();
          for (const termo of termosAlvo) {
            if (textLower.includes(termo.toLowerCase())) termosBancarios.push(termo);
          }

          const items = citationsToItems(citations);
          if (items.length > 0 && content) items[0].descricao = content.substring(0, 200);

          results[search.tipo] = {
            label: search.label,
            encontrados: items.length,
            items,
            valores: [...new Set(valores)],
            termosBancarios: [...new Set(termosBancarios)],
            resumo: content,
          };
        } catch (err) {
          console.error(`Error searching ${search.tipo}:`, err);
          results[search.tipo] = {
            label: search.label, encontrados: 0, items: [], valores: [], termosBancarios: [],
            error: err instanceof Error ? err.message : 'Erro desconhecido',
          };
        }
      })
    );

    const totalRegistros = Object.values(results).reduce((acc: number, s: any) => acc + (s.encontrados || 0), 0);
    const todosTermos = Object.values(results).reduce((acc: string[], s: any) => [...acc, ...(s.termosBancarios || [])], [] as string[]);
    const termosUnicos = [...new Set(todosTermos)];
    const todosValores = Object.values(results).reduce((acc: string[], s: any) => [...acc, ...(s.valores || [])], [] as string[]);

    let nivel: string;
    let status: string;
    if (totalRegistros >= 15 || termosUnicos.length >= 10) { nivel = 'alto'; status = 'Endividamento Bancário Elevado'; }
    else if (totalRegistros >= 8 || termosUnicos.length >= 5) { nivel = 'moderado'; status = 'Endividamento Bancário Moderado'; }
    else if (totalRegistros >= 3 || termosUnicos.length >= 2) { nivel = 'baixo'; status = 'Endividamento Bancário Baixo'; }
    else if (totalRegistros > 0) { nivel = 'minimo'; status = 'Poucos Registros Encontrados'; }
    else { nivel = 'nenhum'; status = 'Sem Registros de Endividamento'; }

    return new Response(
      JSON.stringify({
        success: true, cnpj: cleanCnpj, nivel, status, totalRegistros,
        totalValoresEncontrados: todosValores.length,
        termosIdentificados: termosUnicos,
        valoresEncontrados: [...new Set(todosValores)].slice(0, 10),
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
