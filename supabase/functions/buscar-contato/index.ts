const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { nome, empresa, tipo } = await req.json();

    if (!nome || !tipo) {
      return new Response(
        JSON.stringify({ success: false, error: 'Nome e tipo são obrigatórios' }),
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

    // Build search query based on type
    const empresaNome = empresa || '';
    let query: string;
    if (tipo === 'email') {
      query = `${nome} ${empresaNome} email contato @`;
    } else {
      query = `${nome} ${empresaNome} whatsapp telefone celular contato`;
    }

    console.log(`Searching ${tipo} for: ${nome} (${empresaNome})`);

    // Use Firecrawl search to find contact info
    const response = await fetch('https://api.firecrawl.dev/v1/search', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query,
        limit: 5,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('Firecrawl search error:', data);
      return new Response(
        JSON.stringify({ success: false, error: data.error || `Erro ${response.status}` }),
        { status: response.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Extract contacts from results
    const results = data.data || [];
    const contacts: { valor: string; fonte: string; tipo: string }[] = [];

    for (const result of results) {
      const text = `${result.title || ''} ${result.description || ''} ${result.markdown || ''}`;
      
      if (tipo === 'email') {
        // Extract emails
        const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
        const emails = text.match(emailRegex) || [];
        for (const email of emails) {
          const lower = email.toLowerCase();
          // Filter out common non-personal emails
          if (!lower.includes('example') && !lower.includes('sentry') && !lower.includes('noreply') && !lower.includes('no-reply')) {
            if (!contacts.find(c => c.valor === lower)) {
              contacts.push({
                valor: lower,
                fonte: result.url || result.title || 'Google',
                tipo: 'email',
              });
            }
          }
        }
      } else {
        // Extract phone numbers (Brazilian format)
        const phoneRegex = /(?:\+?55\s?)?(?:\(?\d{2}\)?\s?)?\d{4,5}[-.\s]?\d{4}/g;
        const phones = text.match(phoneRegex) || [];
        for (const phone of phones) {
          const cleaned = phone.replace(/\D/g, '');
          if (cleaned.length >= 10 && cleaned.length <= 13) {
            if (!contacts.find(c => c.valor.replace(/\D/g, '') === cleaned)) {
              contacts.push({
                valor: phone.trim(),
                fonte: result.url || result.title || 'Google',
                tipo: 'telefone',
              });
            }
          }
        }
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        contatos: contacts.slice(0, 5),
        totalResultados: results.length,
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
