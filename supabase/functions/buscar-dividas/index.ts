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

async function firecrawlSearch(apiKey: string, query: string): Promise<Array<{ url: string; title: string; markdown: string; description: string }>> {
  const response = await fetch('https://api.firecrawl.dev/v1/search', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, limit: 5, lang: 'pt-br', country: 'BR', scrapeOptions: { formats: ['markdown'] } }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `Firecrawl error: ${response.status}`);
  return data.data || [];
}

async function perplexitySearch(apiKey: string, query: string, systemPrompt: string): Promise<{ content: string; citations: string[] }> {
  const response = await fetch('https://api.perplexity.ai/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'sonar',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: query },
      ],
      temperature: 0.1,
    }),
  });
  const ct = response.headers.get('content-type') || '';
  if (!ct.includes('application/json')) {
    const text = await response.text();
    console.error('Perplexity non-JSON:', text.substring(0, 200));
    throw new Error(`Perplexity retornou ${response.status}`);
  }
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || `Perplexity error: ${response.status}`);
  return { content: data.choices?.[0]?.message?.content || '', citations: data.citations || [] };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { cnpj, razao_social } = await req.json();
    if (!cnpj) {
      return new Response(JSON.stringify({ success: false, error: 'CNPJ é obrigatório' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const firecrawlKey = Deno.env.get('FIRECRAWL_API_KEY');
    const perplexityKey = Deno.env.get('PERPLEXITY_API_KEY');

    if (!firecrawlKey && !perplexityKey) {
      return new Response(JSON.stringify({ success: false, error: 'Nenhuma API de busca configurada' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const cleanCnpj = cnpj.replace(/\D/g, '');
    const cnpjFormatted = cleanCnpj.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
    const nome = razao_social || cnpjFormatted;

    console.log(`Buscando dívidas (Firecrawl+Perplexity) para: ${nome}`);

    const searches = [
      { tipo: 'divida_ativa', label: 'Dívida Ativa da União', query: `"${nome}" CNPJ ${cnpjFormatted} dívida ativa PGFN débitos inscritos` },
      { tipo: 'protestos', label: 'Protestos em Cartório', query: `"${nome}" CNPJ ${cnpjFormatted} protestos cartório títulos protestados` },
      { tipo: 'processos', label: 'Processos Judiciais', query: `"${nome}" CNPJ ${cnpjFormatted} processos judiciais execuções fiscais` },
    ];

    const results: Record<string, any> = {};

    await Promise.all(
      searches.map(async (search) => {
        const allItems: Array<{ titulo: string; descricao: string; url: string; fonte: string }> = [];
        const allValores: string[] = [];
        let resumoFinal = '';

        // Firecrawl search
        if (firecrawlKey) {
          try {
            const fcResults = await firecrawlSearch(firecrawlKey, search.query);
            for (const r of fcResults) {
              allItems.push({
                titulo: r.title || urlToTitle(r.url || ''),
                descricao: (r.markdown || r.description || '').substring(0, 200),
                url: r.url,
                fonte: (() => { try { return new URL(r.url).hostname; } catch { return 'web'; } })(),
              });
            }
            const fcContent = fcResults.map(r => r.markdown || r.description || '').join('\n');
            const fcValores = fcContent.match(/R\$\s?[\d.,]+/g) || [];
            allValores.push(...fcValores);
            resumoFinal += fcContent.substring(0, 300);
          } catch (err) {
            console.error(`Firecrawl error (${search.tipo}):`, err);
          }
        }

        // Perplexity search
        if (perplexityKey) {
          try {
            const ppResult = await perplexitySearch(
              perplexityKey,
              search.query,
              'Você é um analista de crédito brasileiro. Responda de forma estruturada e objetiva, incluindo valores monetários quando disponíveis. Sempre em português.'
            );
            const ppValores = ppResult.content.match(/R\$\s?[\d.,]+/g) || [];
            allValores.push(...ppValores);
            resumoFinal += '\n\n' + ppResult.content.substring(0, 300);

            // Add citation-based items
            for (const url of ppResult.citations) {
              if (!allItems.find(i => i.url === url)) {
                allItems.push({
                  titulo: urlToTitle(url),
                  descricao: '',
                  url,
                  fonte: (() => { try { return new URL(url).hostname; } catch { return 'web'; } })(),
                });
              }
            }
          } catch (err) {
            console.error(`Perplexity error (${search.tipo}):`, err);
          }
        }

        results[search.tipo] = {
          label: search.label,
          encontrados: allItems.length,
          items: allItems,
          valores: [...new Set(allValores)],
          resumo: resumoFinal,
        };
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
