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

    const apiKey = Deno.env.get('PERPLEXITY_API_KEY');
    if (!apiKey) {
      return new Response(
        JSON.stringify({ success: false, error: 'Perplexity não configurado' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const empresaNome = empresa || '';
    console.log(`Searching ${tipo} for: ${nome} (${empresaNome})`);

    let prompt: string;
    if (tipo === 'email') {
      prompt = `Pesquise o email de contato profissional de "${nome}" da empresa "${empresaNome}". Informe todos os emails encontrados e suas fontes.`;
    } else {
      prompt = `Pesquise o telefone/WhatsApp de contato de "${nome}" da empresa "${empresaNome}". Informe todos os números encontrados e suas fontes.`;
    }

    const response = await fetch('https://api.perplexity.ai/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'sonar',
        messages: [
          { role: 'system', content: 'Você é um assistente de pesquisa de contatos profissionais. Informe apenas dados públicos encontrados na web. Sempre em português.' },
          { role: 'user', content: prompt },
        ],
        temperature: 0.1,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('Perplexity error:', data);
      return new Response(
        JSON.stringify({ success: false, error: data.error?.message || `Erro ${response.status}` }),
        { status: response.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const content = data.choices?.[0]?.message?.content || '';
    const citations = data.citations || [];
    const contacts: { valor: string; fonte: string; tipo: string }[] = [];

    if (tipo === 'email') {
      const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
      const emails = content.match(emailRegex) || [];
      for (const email of emails) {
        const lower = email.toLowerCase();
        if (!lower.includes('example') && !lower.includes('sentry') && !lower.includes('noreply') && !lower.includes('no-reply')) {
          if (!contacts.find(c => c.valor === lower)) {
            contacts.push({ valor: lower, fonte: citations[0] || 'Perplexity', tipo: 'email' });
          }
        }
      }
    } else {
      const phoneRegex = /(?:\+?55\s?)?(?:\(?\d{2}\)?\s?)?\d{4,5}[-.\s]?\d{4}/g;
      const phones = content.match(phoneRegex) || [];
      for (const phone of phones) {
        const cleaned = phone.replace(/\D/g, '');
        if (cleaned.length >= 10 && cleaned.length <= 13) {
          if (!contacts.find(c => c.valor.replace(/\D/g, '') === cleaned)) {
            contacts.push({ valor: phone.trim(), fonte: citations[0] || 'Perplexity', tipo: 'telefone' });
          }
        }
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        contatos: contacts.slice(0, 5),
        totalResultados: citations.length,
        resumo: content,
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
