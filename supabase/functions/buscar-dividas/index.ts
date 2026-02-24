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
        { role: 'system', content: 'Você é um analista de crédito brasileiro. Responda de forma estruturada e objetiva, incluindo valores monetários quando disponíveis. Sempre em português.' },
        { role: 'user', content: query },
      ],
      temperature: 0.1,
    }),
  });

  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    const text = await response.text();
    console.error('Perplexity returned non-JSON:', text.substring(0, 200));
    throw new Error(`API retornou ${response.status} (${contentType || 'unknown'})`);
  }
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error?.message || `Erro ${response.status}`);
  }

  return {
    content: data.choices?.[0]?.message?.content || '',
    citations: data.citations || [],
  };
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

    console.log(`Buscando dívidas para: ${nome} (${cnpjFormatted})`);

    const searches = [
      {
        tipo: 'divida_ativa',
        label: 'Dívida Ativa da União',
        query: `Pesquise sobre dívida ativa da União (PGFN) da empresa "${nome}" CNPJ ${cnpjFormatted}. Informe se há registros de débitos inscritos em dívida ativa, valores, e situação atual.`,
      },
      {
        tipo: 'protestos',
        label: 'Protestos em Cartório',
        query: `Pesquise sobre protestos em cartório da empresa "${nome}" CNPJ ${cnpjFormatted}. Informe se há títulos protestados, valores e cartórios envolvidos.`,
      },
      {
        tipo: 'processos',
        label: 'Processos Judiciais',
        query: `Pesquise sobre processos judiciais e execuções fiscais da empresa "${nome}" CNPJ ${cnpjFormatted}. Informe processos relevantes, valores envolvidos e situação.`,
      },
    ];

    const results: Record<string, any> = {};

    await Promise.all(
      searches.map(async (search) => {
        try {
          const { content, citations } = await perplexitySearch(apiKey, search.query);
          const valores = content.match(/R\$\s?[\d.,]+/g) || [];
          const items = citationsToItems(citations);
          // Add summary as first item description
          if (items.length > 0 && content) {
            items[0].descricao = content.substring(0, 200);
          }

          results[search.tipo] = {
            label: search.label,
            encontrados: items.length,
            items,
            valores: [...new Set(valores)],
            resumo: content,
          };
        } catch (err) {
          console.error(`Error searching ${search.tipo}:`, err);
          results[search.tipo] = {
            label: search.label,
            encontrados: 0,
            items: [],
            valores: [],
            error: err instanceof Error ? err.message : 'Erro desconhecido',
          };
        }
      })
    );

    return new Response(
      JSON.stringify({ success: true, cnpj: cleanCnpj, dividas: results }),
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
