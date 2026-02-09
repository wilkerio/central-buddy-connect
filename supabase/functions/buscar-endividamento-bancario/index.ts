const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

interface DividaExtraida {
  valor: string;
  valorNumerico: number;
  contexto: string;
  tipo: string;
  fonte: string;
  url: string;
}

function extrairValoresComContexto(texto: string, url: string, fonte: string): DividaExtraida[] {
  const dividas: DividaExtraida[] = [];
  if (!texto) return dividas;

  // Regex para capturar valores monetários com contexto ao redor
  const regexValor = /(?:(?:R\$|BRL)\s?[\d.,]+(?:\s?(?:mil|milh[oõ]es|milh[aã]o|bilh[oõ]es|bilh[aã]o|mi|bi|tri))?|[\d.,]+\s?(?:mil|milh[oõ]es|milh[aã]o|bilh[oõ]es|bilh[aã]o))/gi;

  const matches = [...texto.matchAll(regexValor)];

  for (const match of matches) {
    const idx = match.index || 0;
    // Pegar contexto: 120 chars antes e depois
    const start = Math.max(0, idx - 120);
    const end = Math.min(texto.length, idx + match[0].length + 120);
    const contexto = texto.substring(start, end).replace(/\s+/g, ' ').trim();

    // Determinar tipo pela proximidade de palavras-chave
    const ctxLower = contexto.toLowerCase();
    let tipo = 'outros';
    if (ctxLower.match(/empr[eé]stimo|financiamento|capital.?de.?giro|cheque.?especial|cr[eé]dito.?banc/)) tipo = 'empréstimo';
    else if (ctxLower.match(/deb[eê]nture|cri\b|cra\b|nota.?promiss/)) tipo = 'debênture';
    else if (ctxLower.match(/bndes|finame|finem|cr[eé]dito.?rural|agro/)) tipo = 'BNDES/Rural';
    else if (ctxLower.match(/inadimpl|atraso|vencid|renegoci|refinanc/)) tipo = 'inadimplência';
    else if (ctxLower.match(/d[ií]vida|endividamento|passivo|obriga/)) tipo = 'dívida';
    else if (ctxLower.match(/opera[çc][aã]o|scr|cr[eé]dito/)) tipo = 'operação de crédito';

    // Converter valor para número
    let valorStr = match[0].replace(/[^\d.,milhõesbirtMBK]/gi, '').trim();
    let valorNum = parseFloat(valorStr.replace(/\./g, '').replace(',', '.')) || 0;
    const multiplicador = match[0].toLowerCase();
    if (multiplicador.match(/bilh[oõ]|bi\b/)) valorNum *= 1_000_000_000;
    else if (multiplicador.match(/milh[oõã]|mi\b/)) valorNum *= 1_000_000;
    else if (multiplicador.match(/\bmil\b/)) valorNum *= 1_000;

    if (valorNum > 0) {
      dividas.push({
        valor: match[0].trim(),
        valorNumerico: valorNum,
        contexto,
        tipo,
        fonte,
        url,
      });
    }
  }

  return dividas;
}

function formatarMoeda(valor: number): string {
  if (valor >= 1_000_000_000) return `R$ ${(valor / 1_000_000_000).toFixed(2)}B`;
  if (valor >= 1_000_000) return `R$ ${(valor / 1_000_000).toFixed(2)}M`;
  if (valor >= 1_000) return `R$ ${(valor / 1_000).toFixed(1)}K`;
  return `R$ ${valor.toFixed(2)}`;
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

    const searches = [
      {
        tipo: 'scr_operacoes',
        label: 'Operações de Crédito (SCR)',
        query: `"${cnpjFormatted}" OR "${cleanCnpj}" OR "${nome}" SCR operação crédito bancário empréstimo financiamento saldo devedor`,
      },
      {
        tipo: 'emprestimos_financiamentos',
        label: 'Empréstimos e Financiamentos',
        query: `"${cnpjFormatted}" OR "${cleanCnpj}" OR "${nome}" empréstimo financiamento bancário capital de giro valor dívida saldo R$`,
      },
      {
        tipo: 'debentures_titulos',
        label: 'Debêntures e Títulos de Dívida',
        query: `"${cnpjFormatted}" OR "${cleanCnpj}" OR "${nome}" debênture emissão título dívida valor R$ milhões CRI CRA`,
      },
      {
        tipo: 'credito_rural_bndes',
        label: 'Crédito Rural e BNDES',
        query: `"${cnpjFormatted}" OR "${cleanCnpj}" OR "${nome}" BNDES crédito rural FINAME valor contrato R$ financiamento`,
      },
      {
        tipo: 'inadimplencia',
        label: 'Inadimplência Bancária',
        query: `"${cnpjFormatted}" OR "${cleanCnpj}" OR "${nome}" inadimplência bancária dívida vencida valor R$ atraso renegociação`,
      },
    ];

    const results: Record<string, any> = {};
    const todasDividas: DividaExtraida[] = [];

    await Promise.all(
      searches.map(async (search) => {
        try {
          // Usar scrapeOptions para obter conteúdo completo das páginas
          const response = await fetch('https://api.firecrawl.dev/v1/search', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${apiKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              query: search.query,
              limit: 5,
              scrapeOptions: {
                formats: ['markdown'],
                onlyMainContent: true,
              },
            }),
          });

          const data = await response.json();

          if (response.ok) {
            const items = (data.data || []).map((r: any) => {
              const markdown = r.markdown || '';
              const descricao = r.description || '';
              const titulo = r.title || 'Sem título';
              const url = r.url || '';
              const fonte = url ? new URL(url).hostname : 'desconhecida';

              // Extrair valores do conteúdo completo da página
              const fullText = `${titulo} ${descricao} ${markdown}`;
              const dividasExtraidas = extrairValoresComContexto(fullText, url, fonte);
              todasDividas.push(...dividasExtraidas);

              // Extrair valores simples para display
              const valoresSimples = [...new Set(
                (fullText.match(/R\$\s?[\d.,]+(?:\s?(?:mil|milh[oõ]es|milh[aã]o|bilh[oõ]es|bilh[aã]o|mi|bi))?/gi) || [])
                  .map(v => v.trim())
              )].slice(0, 6);

              return {
                titulo,
                descricao,
                url,
                fonte,
                valores: valoresSimples,
                dividasDetalhadas: dividasExtraidas.slice(0, 5).map(d => ({
                  valor: d.valor,
                  tipo: d.tipo,
                  contexto: d.contexto,
                })),
              };
            });

            // Extrair termos bancários
            const termosBancarios: string[] = [];
            const termosAlvo = [
              'empréstimo', 'financiamento', 'crédito', 'capital de giro', 'cheque especial',
              'debênture', 'CRI', 'CRA', 'nota promissória', 'BNDES', 'FINAME', 'FINEM',
              'SCR', 'operação de crédito', 'inadimplência', 'renegociação', 'refinanciamento',
              'leasing', 'CDC', 'conta garantida', 'desconto de duplicatas', 'antecipação de recebíveis',
              'factoring', 'FIDC', 'securitização', 'saldo devedor', 'passivo circulante',
              'crédito rural', 'custeio', 'dívida bancária',
            ];

            for (const item of items) {
              const text = `${item.titulo} ${item.descricao}`.toLowerCase();
              for (const termo of termosAlvo) {
                if (text.includes(termo.toLowerCase()) && !termosBancarios.includes(termo)) {
                  termosBancarios.push(termo);
                }
              }
            }

            const todosValoresCategoria = items.flatMap((i: any) => i.valores || []);

            results[search.tipo] = {
              label: search.label,
              encontrados: items.length,
              items,
              valores: [...new Set(todosValoresCategoria)].slice(0, 8),
              termosBancarios: [...new Set(termosBancarios)],
            };
          } else {
            console.error(`Search error for ${search.tipo}:`, data);
            results[search.tipo] = {
              label: search.label, encontrados: 0, items: [], valores: [], termosBancarios: [],
              error: data.error || `Erro ${response.status}`,
            };
          }
        } catch (err) {
          console.error(`Error searching ${search.tipo}:`, err);
          results[search.tipo] = {
            label: search.label, encontrados: 0, items: [], valores: [], termosBancarios: [],
            error: err instanceof Error ? err.message : 'Erro desconhecido',
          };
        }
      })
    );

    // Consolidar dados
    const totalRegistros = Object.values(results).reduce((acc: number, s: any) => acc + (s.encontrados || 0), 0);
    const todosTermos = Object.values(results).reduce((acc: string[], s: any) => [...acc, ...(s.termosBancarios || [])], [] as string[]);
    const termosUnicos = [...new Set(todosTermos)];
    const todosValoresStr = Object.values(results).reduce((acc: string[], s: any) => [...acc, ...(s.valores || [])], [] as string[]);

    // Agrupar dívidas por tipo e calcular totais
    const dividasPorTipo: Record<string, { total: number; quantidade: number; itens: DividaExtraida[] }> = {};
    for (const d of todasDividas) {
      if (!dividasPorTipo[d.tipo]) {
        dividasPorTipo[d.tipo] = { total: 0, quantidade: 0, itens: [] };
      }
      dividasPorTipo[d.tipo].total += d.valorNumerico;
      dividasPorTipo[d.tipo].quantidade += 1;
      dividasPorTipo[d.tipo].itens.push(d);
    }

    // Calcular endividamento total estimado
    const endividamentoTotal = todasDividas.reduce((acc, d) => acc + d.valorNumerico, 0);

    // Top dívidas por valor
    const topDividas = [...todasDividas]
      .sort((a, b) => b.valorNumerico - a.valorNumerico)
      .slice(0, 10)
      .map(d => ({
        valor: d.valor,
        valorFormatado: formatarMoeda(d.valorNumerico),
        valorNumerico: d.valorNumerico,
        tipo: d.tipo,
        contexto: d.contexto,
        fonte: d.fonte,
        url: d.url,
      }));

    // Resumo por tipo
    const resumoPorTipo = Object.entries(dividasPorTipo).map(([tipo, data]) => ({
      tipo,
      total: data.total,
      totalFormatado: formatarMoeda(data.total),
      quantidade: data.quantidade,
    })).sort((a, b) => b.total - a.total);

    // Classificação
    let nivel: string;
    let status: string;
    if (endividamentoTotal >= 100_000_000 || totalRegistros >= 15) {
      nivel = 'alto';
      status = 'Endividamento Bancário Elevado';
    } else if (endividamentoTotal >= 10_000_000 || totalRegistros >= 8) {
      nivel = 'moderado';
      status = 'Endividamento Bancário Moderado';
    } else if (endividamentoTotal >= 1_000_000 || totalRegistros >= 3) {
      nivel = 'baixo';
      status = 'Endividamento Bancário Baixo';
    } else if (totalRegistros > 0 || endividamentoTotal > 0) {
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
        endividamentoTotal,
        endividamentoTotalFormatado: formatarMoeda(endividamentoTotal),
        termosIdentificados: termosUnicos,
        valoresEncontrados: [...new Set(todosValoresStr)].slice(0, 15),
        topDividas,
        resumoPorTipo,
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
