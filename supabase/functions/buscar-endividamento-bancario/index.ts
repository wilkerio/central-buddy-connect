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

    console.log(`Buscando endividamento bancário para: ${nome} (${cnpjFormatted})`);

    // Buscar diferentes aspectos de endividamento bancário em paralelo
    const searches = [
      {
        tipo: 'scr_operacoes',
        label: 'Operações de Crédito (SCR)',
        query: `"${cnpjFormatted}" OR "${cleanCnpj}" OR "${nome}" SCR "sistema de informações de crédito" operação crédito bancário empréstimo financiamento`,
      },
      {
        tipo: 'emprestimos_financiamentos',
        label: 'Empréstimos e Financiamentos',
        query: `"${cnpjFormatted}" OR "${cleanCnpj}" OR "${nome}" empréstimo financiamento bancário crédito capital de giro cheque especial`,
      },
      {
        tipo: 'debentures_titulos',
        label: 'Debêntures e Títulos de Dívida',
        query: `"${cnpjFormatted}" OR "${cleanCnpj}" OR "${nome}" debênture emissão título dívida CRI CRA nota promissória`,
      },
      {
        tipo: 'credito_rural_bndes',
        label: 'Crédito Rural e BNDES',
        query: `"${cnpjFormatted}" OR "${cleanCnpj}" OR "${nome}" BNDES crédito rural financiamento agrícola FINAME FINEM`,
      },
      {
        tipo: 'inadimplencia',
        label: 'Inadimplência Bancária',
        query: `"${cnpjFormatted}" OR "${cleanCnpj}" OR "${nome}" inadimplência bancária atraso pagamento banco renegociação dívida bancária`,
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

            // Extrair valores monetários
            const valores: string[] = [];
            // Extrair termos bancários relevantes
            const termosBancarios: string[] = [];
            const termosAlvo = [
              'empréstimo', 'financiamento', 'crédito', 'capital de giro', 'cheque especial',
              'debênture', 'CRI', 'CRA', 'nota promissória', 'BNDES', 'FINAME', 'FINEM',
              'SCR', 'operação de crédito', 'inadimplência', 'renegociação', 'refinanciamento',
              'leasing', 'CDC', 'conta garantida', 'desconto de duplicatas', 'antecipação de recebíveis',
              'factoring', 'FIDC', 'securitização', 'spread bancário', 'taxa de juros',
              'crédito rural', 'custeio', 'investimento agropecuário',
            ];

            for (const item of items) {
              const text = `${item.titulo} ${item.descricao}`.toLowerCase();
              const matches = `${item.titulo} ${item.descricao}`.match(/R\$\s?[\d.,]+/g);
              if (matches) valores.push(...matches);

              for (const termo of termosAlvo) {
                if (text.includes(termo.toLowerCase()) && !termosBancarios.includes(termo)) {
                  termosBancarios.push(termo);
                }
              }
            }

            results[search.tipo] = {
              label: search.label,
              encontrados: items.length,
              items,
              valores: [...new Set(valores)],
              termosBancarios: [...new Set(termosBancarios)],
            };
          } else {
            console.error(`Search error for ${search.tipo}:`, data);
            results[search.tipo] = {
              label: search.label,
              encontrados: 0,
              items: [],
              valores: [],
              termosBancarios: [],
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
            termosBancarios: [],
            error: err instanceof Error ? err.message : 'Erro desconhecido',
          };
        }
      })
    );

    // Calcular score de endividamento
    const totalRegistros = Object.values(results).reduce((acc: number, s: any) => acc + (s.encontrados || 0), 0);
    const totalValores = Object.values(results).reduce((acc: number, s: any) => acc + (s.valores?.length || 0), 0);
    const todosTermos = Object.values(results).reduce((acc: string[], s: any) => [...acc, ...(s.termosBancarios || [])], [] as string[]);
    const termosUnicos = [...new Set(todosTermos)];
    const todosValores = Object.values(results).reduce((acc: string[], s: any) => [...acc, ...(s.valores || [])], [] as string[]);

    // Classificação de nível de endividamento
    let nivel: string;
    let status: string;
    if (totalRegistros >= 15 || termosUnicos.length >= 10) {
      nivel = 'alto';
      status = 'Endividamento Bancário Elevado';
    } else if (totalRegistros >= 8 || termosUnicos.length >= 5) {
      nivel = 'moderado';
      status = 'Endividamento Bancário Moderado';
    } else if (totalRegistros >= 3 || termosUnicos.length >= 2) {
      nivel = 'baixo';
      status = 'Endividamento Bancário Baixo';
    } else if (totalRegistros > 0) {
      nivel = 'minimo';
      status = 'Poucos Registros Encontrados';
    } else {
      nivel = 'nenhum';
      status = 'Sem Registros de Endividamento';
    }

    return new Response(
      JSON.stringify({
        success: true,
        cnpj: cleanCnpj,
        nivel,
        status,
        totalRegistros,
        totalValoresEncontrados: totalValores,
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
