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
        { role: 'system', content: 'Você é um analista de comércio exterior brasileiro. Responda de forma estruturada e objetiva. Sempre em português.' },
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

    if (!cnpj && !razao_social) {
      return new Response(
        JSON.stringify({ success: false, error: 'CNPJ ou razão social é obrigatório' }),
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

    const nome = razao_social || cnpj;
    console.log(`Buscando crédito internacional para: ${nome}`);

    const searches = [
      {
        tipo: 'credito_internacional',
        label: 'Crédito Internacional / Trade Finance',
        query: `Pesquise sobre crédito internacional, trade finance, carta de crédito, ACC, ACE e BNDES-Exim da empresa "${nome}". Informe operações, valores e instituições envolvidas.`,
      },
      {
        tipo: 'operacoes_cambio',
        label: 'Operações de Câmbio',
        query: `Pesquise sobre operações de câmbio, exportação e importação da empresa "${nome}". Informe volumes, países de destino e moedas utilizadas.`,
      },
      {
        tipo: 'relacoes_internacionais',
        label: 'Relações Internacionais',
        query: `Pesquise sobre subsidiárias, filiais no exterior, joint ventures e operações globais da empresa "${nome}". Informe países e parcerias internacionais.`,
      },
    ];

    const results: Record<string, any> = {};
    let indicadoresPositivos = 0;
    let evidencias: string[] = [];

    const keywords = [
      'carta de crédito', 'letter of credit', 'trade finance',
      'acc', 'ace', 'bndes-exim', 'financiamento à exportação',
      'crédito internacional', 'câmbio', 'exportação', 'importação',
      'subsidiária', 'filial no exterior', 'operação internacional',
    ];

    await Promise.all(
      searches.map(async (search) => {
        try {
          const { content, citations } = await perplexitySearch(apiKey, search.query);

          const textLower = content.toLowerCase();
          for (const kw of keywords) {
            if (textLower.includes(kw) && !evidencias.includes(kw)) {
              evidencias.push(kw);
              indicadoresPositivos++;
            }
          }

          results[search.tipo] = {
            label: search.label,
            encontrados: citations.length,
            items: citations.map((url: string) => ({
              titulo: url,
              descricao: '',
              url,
              fonte: new URL(url).hostname,
            })),
            resumo: content,
          };
        } catch (err) {
          console.error(`Error searching ${search.tipo}:`, err);
          results[search.tipo] = { label: search.label, encontrados: 0, items: [] };
        }
      })
    );

    const totalResultados = Object.values(results).reduce((a: number, s: any) => a + s.encontrados, 0);
    let status: string;
    let confianca: string;

    if (indicadoresPositivos >= 5 && totalResultados >= 8) {
      status = 'confirmado';
      confianca = 'alta';
    } else if (indicadoresPositivos >= 3 || totalResultados >= 5) {
      status = 'provavel';
      confianca = 'média';
    } else if (indicadoresPositivos >= 1 || totalResultados >= 2) {
      status = 'possivel';
      confianca = 'baixa';
    } else {
      status = 'nao_encontrado';
      confianca = 'n/a';
    }

    return new Response(
      JSON.stringify({
        success: true,
        status,
        confianca,
        indicadoresPositivos,
        evidencias: evidencias.slice(0, 10),
        totalResultados,
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
