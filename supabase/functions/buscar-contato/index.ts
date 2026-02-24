const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

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

async function inferirEmailComIA(lovableKey: string, nome: string, empresa: string, dadosWeb: string) {
  try {
    const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${lovableKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'google/gemini-3-flash-preview',
        messages: [
          {
            role: 'system',
            content: `Você é um especialista em identificar emails corporativos de executivos brasileiros.
Regras:
- Identifique o domínio provável da empresa
- Gere variações comuns: nome@, nome.sobrenome@, nsob@, primeiro.ultimo@
- Considere domínios .com.br, .com, .net.br
- Indique confiança: ALTA (encontrado), MÉDIA (padrão corporativo), BAIXA (inferência)
- Retorne em JSON puro, sem markdown`
          },
          {
            role: 'user',
            content: `Nome: ${nome}\nEmpresa: ${empresa}\nDados encontrados:\n${dadosWeb}\n\nRetorne JSON: {"dominio_empresa":"","emails":[{"email":"","confianca":"","padrao":""}],"linkedin_provavel":"","observacoes":""}`
          }
        ],
        temperature: 0.2,
      }),
    });
    if (!response.ok) { await response.text(); return null; }
    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '';
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    return jsonMatch ? JSON.parse(jsonMatch[0]) : null;
  } catch (err) { console.error('AI inference error:', err); return null; }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { nome, empresa, tipo } = await req.json();
    if (!nome || !tipo) {
      return new Response(JSON.stringify({ success: false, error: 'Nome e tipo são obrigatórios' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const firecrawlKey = Deno.env.get('FIRECRAWL_API_KEY');
    const perplexityKey = Deno.env.get('PERPLEXITY_API_KEY');
    const lovableKey = Deno.env.get('LOVABLE_API_KEY');

    if (!firecrawlKey && !perplexityKey) {
      return new Response(JSON.stringify({ success: false, error: 'Nenhuma API de busca configurada' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const empresaNome = empresa || '';
    console.log(`Smart search (${tipo}): ${nome} @ ${empresaNome} [Firecrawl+Perplexity]`);

    let webContent = '';
    const allCitations: string[] = [];

    const searchQuery = tipo === 'email'
      ? `"${nome}" "${empresaNome}" email contato linkedin site oficial Brasil`
      : `"${nome}" "${empresaNome}" telefone celular WhatsApp contato Brasil`;

    const ppPrompt = tipo === 'email'
      ? `Encontre emails de "${nome}", sócio/diretor da empresa "${empresaNome}" no Brasil. Pesquise em LinkedIn, site institucional, registros públicos. Identifique o domínio da empresa e sugira padrões prováveis.`
      : `Encontre telefone celular, WhatsApp ou telefone direto de "${nome}", sócio/diretor da empresa "${empresaNome}" no Brasil. Pesquise em site da empresa, LinkedIn, Google Maps, Reclame Aqui, registros públicos.`;

    // Firecrawl
    if (firecrawlKey) {
      try {
        const fcResults = await firecrawlSearch(firecrawlKey, searchQuery);
        webContent += fcResults.map(r => r.markdown || r.description || '').join('\n\n');
        allCitations.push(...fcResults.map(r => r.url).filter(Boolean));
      } catch (err) { console.error('Firecrawl error:', err); }
    }

    // Perplexity
    if (perplexityKey) {
      try {
        const ppResult = await perplexitySearch(perplexityKey, ppPrompt,
          'Você é um pesquisador expert em OSINT focado em encontrar contatos de executivos brasileiros. Seja exaustivo nas buscas. Sempre retorne resultados, mesmo que sejam inferidos.'
        );
        webContent += '\n\n' + ppResult.content;
        for (const url of ppResult.citations) {
          if (!allCitations.includes(url)) allCitations.push(url);
        }
      } catch (err) { console.error('Perplexity error:', err); }
    }

    // AI inference for email
    let aiResult = null;
    if (tipo === 'email' && lovableKey) {
      aiResult = await inferirEmailComIA(lovableKey, nome, empresaNome, webContent);
    }

    // Extract contacts
    const contacts: { valor: string; fonte: string; tipo: string; confianca: string }[] = [];

    if (tipo === 'email') {
      const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
      const emails = webContent.match(emailRegex) || [];
      const genericPatterns = ['nome', 'sobrenome', 'dominio', 'exemplo', 'usuario', 'iniciais', 'primeiro', 'ultimo', 'meio', 'example', 'user@'];
      for (const email of emails) {
        const lower = email.toLowerCase();
        const isGeneric = genericPatterns.some(p => lower.includes(p));
        if (!isGeneric && !lower.includes('sentry') && !lower.includes('noreply') && !lower.includes('no-reply') && !lower.includes('teste@') && !lower.includes('test@')) {
          if (!contacts.find(c => c.valor === lower)) {
            contacts.push({ valor: lower, fonte: 'Web (Firecrawl+Perplexity)', tipo: 'email', confianca: 'alta' });
          }
        }
      }
      if (aiResult?.emails) {
        for (const item of aiResult.emails) {
          const lower = (item.email || '').toLowerCase();
          if (lower && !lower.includes('example') && !contacts.find(c => c.valor === lower)) {
            contacts.push({ valor: lower, fonte: `IA (padrão ${item.padrao || 'inferido'})`, tipo: 'email', confianca: item.confianca || 'media' });
          }
        }
      }
    } else {
      const phoneRegex = /(?:\+?55\s?)?(?:\(?\d{2}\)?\s?)?\d{4,5}[-.\s]?\d{4}/g;
      const phones = webContent.match(phoneRegex) || [];
      for (const phone of phones) {
        const cleaned = phone.replace(/\D/g, '');
        if (cleaned.length >= 10 && cleaned.length <= 13) {
          if (!contacts.find(c => c.valor.replace(/\D/g, '') === cleaned)) {
            const isCelular = cleaned.length >= 11 && cleaned.charAt(cleaned.length - 9) === '9';
            contacts.push({ valor: phone.trim(), fonte: 'Web (Firecrawl+Perplexity)', tipo: isCelular ? 'celular' : 'telefone', confianca: 'alta' });
          }
        }
      }
    }

    const order = { alta: 0, media: 1, baixa: 2 };
    contacts.sort((a, b) => (order[a.confianca as keyof typeof order] || 2) - (order[b.confianca as keyof typeof order] || 2));

    return new Response(
      JSON.stringify({
        success: true,
        contatos: contacts.slice(0, 10),
        totalResultados: allCitations.length,
        resumo: webContent,
        aiDados: aiResult ? { dominio: aiResult.dominio_empresa, linkedin: aiResult.linkedin_provavel, obs: aiResult.observacoes } : null,
        fontes: allCitations,
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
