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
      prompt = `Encontre o email profissional e pessoal de "${nome}", que é sócio/diretor da empresa "${empresaNome}" no Brasil.

Pesquise em:
- LinkedIn (perfil público)
- Site institucional da empresa "${empresaNome}"
- Registro.br / domínios associados
- Reclame Aqui (respostas de representantes)
- Jusbrasil, processos judiciais públicos
- Publicações em diários oficiais
- Artigos, entrevistas, palestras
- Redes sociais (Twitter/X, Facebook)

Liste TODOS os emails encontrados, um por linha, no formato:
email@dominio.com — Fonte: [onde encontrou]

Se não encontrar emails diretos, sugira o padrão provável do domínio da empresa (ex: nome@empresa.com.br).`;
    } else {
      prompt = `Encontre o telefone celular, WhatsApp ou telefone comercial direto de "${nome}", sócio/diretor da empresa "${empresaNome}" no Brasil.

Pesquise em:
- Site institucional da empresa "${empresaNome}" (página de contato, equipe)
- LinkedIn (perfil público com telefone)
- Google Maps / Google Meu Negócio da empresa
- Reclame Aqui (telefones em respostas)
- Jusbrasil, processos judiciais (citações com telefone)
- Publicações em diários oficiais
- Cartórios, registros comerciais
- Redes sociais (Instagram bio, Facebook)
- Sites de busca de telefone (Telelistas, 102, GuiaMais)

Liste TODOS os telefones encontrados, um por linha, no formato:
(XX) XXXXX-XXXX — Fonte: [onde encontrou]

Priorize celulares (9 dígitos) pois são mais prováveis de ter WhatsApp.`;
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
          { role: 'system', content: 'Você é um pesquisador especializado em encontrar informações de contato de executivos e empresários brasileiros usando fontes públicas da web. Seja minucioso e busque em múltiplas fontes. Sempre em português.' },
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
        if (!lower.includes('example') && !lower.includes('sentry') && !lower.includes('noreply') && !lower.includes('no-reply') && !lower.includes('teste@') && !lower.includes('test@')) {
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
        contatos: contacts.slice(0, 8),
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
