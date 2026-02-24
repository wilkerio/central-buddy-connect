const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

async function buscarFirecrawl(apiKey: string, nome: string, empresa: string, tipo: string) {
  const query = tipo === 'email'
    ? `"${nome}" "${empresa}" email contato linkedin site oficial Brasil`
    : `"${nome}" "${empresa}" telefone celular WhatsApp contato Brasil`;

  const response = await fetch('https://api.firecrawl.dev/v1/search', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query,
      limit: 5,
      lang: 'pt-br',
      country: 'BR',
      scrapeOptions: { formats: ['markdown'] },
    }),
  });

  const data = await response.json();
  if (!response.ok) {
    console.error('Firecrawl error:', response.status, data);
    return { content: '', citations: [] };
  }

  const results = data.data || [];
  const content = results.map((r: any) => r.markdown || r.description || '').join('\n\n');
  const citations = results.map((r: any) => r.url).filter(Boolean);

  return { content, citations };
}

async function inferirEmailComIA(lovableKey: string, nome: string, empresa: string, dadosWeb: string) {
  try {
    const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${lovableKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-3-flash-preview',
        messages: [
          {
            role: 'system',
            content: `Você é um especialista em identificar emails corporativos de executivos brasileiros. 
Dado um nome e empresa, você infere os emails mais prováveis baseado em padrões comuns de domínios corporativos brasileiros.

Regras:
- Identifique o domínio provável da empresa (ex: Magazine Luiza → magazineluiza.com.br)
- Gere variações comuns: nome@, nome.sobrenome@, nsob@, primeiro.ultimo@
- Considere domínios .com.br, .com, .net.br
- Indique confiança: ALTA (encontrado), MÉDIA (padrão corporativo comum), BAIXA (inferência)
- Retorne em JSON puro, sem markdown`
          },
          {
            role: 'user',
            content: `Nome: ${nome}
Empresa: ${empresa}
Dados já encontrados pela pesquisa web:
${dadosWeb}

Retorne um JSON com a estrutura:
{
  "dominio_empresa": "dominio.com.br",
  "emails": [
    {"email": "exemplo@dominio.com.br", "confianca": "alta|media|baixa", "padrao": "nome.sobrenome"}
  ],
  "telefones_inferidos": [],
  "linkedin_provavel": "url ou null",
  "observacoes": "texto curto"
}`
          }
        ],
        temperature: 0.2,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('Lovable AI error:', response.status, errText);
      return null;
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '';
    
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    return null;
  } catch (err) {
    console.error('AI inference error:', err);
    return null;
  }
}

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

    const firecrawlKey = Deno.env.get('FIRECRAWL_API_KEY');
    const lovableKey = Deno.env.get('LOVABLE_API_KEY');

    if (!firecrawlKey) {
      return new Response(
        JSON.stringify({ success: false, error: 'Firecrawl não configurado' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const empresaNome = empresa || '';
    console.log(`Smart search (${tipo}): ${nome} @ ${empresaNome}`);

    // Step 1: Firecrawl web search
    const webResult = await buscarFirecrawl(firecrawlKey, nome, empresaNome, tipo);
    
    // Step 2: AI inference (only for email)
    let aiResult = null;
    if (tipo === 'email' && lovableKey) {
      aiResult = await inferirEmailComIA(lovableKey, nome, empresaNome, webResult.content);
    }

    // Step 3: Extract and merge contacts
    const contacts: { valor: string; fonte: string; tipo: string; confianca: string }[] = [];

    if (tipo === 'email') {
      const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
      const emails = webResult.content.match(emailRegex) || [];
      const genericPatterns = ['nome', 'sobrenome', 'dominio', 'exemplo', 'usuario', 'iniciais', 'primeiro', 'ultimo', 'meio', 'example', 'user@'];
      for (const email of emails) {
        const lower = email.toLowerCase();
        const isGeneric = genericPatterns.some(p => lower.includes(p));
        if (!isGeneric && !lower.includes('sentry') && !lower.includes('noreply') && !lower.includes('no-reply') && !lower.includes('teste@') && !lower.includes('test@')) {
          if (!contacts.find(c => c.valor === lower)) {
            contacts.push({ valor: lower, fonte: 'Firecrawl (web)', tipo: 'email', confianca: 'alta' });
          }
        }
      }

      if (aiResult?.emails) {
        for (const item of aiResult.emails) {
          const lower = (item.email || '').toLowerCase();
          if (lower && !lower.includes('example') && !contacts.find(c => c.valor === lower)) {
            contacts.push({
              valor: lower,
              fonte: `IA (padrão ${item.padrao || 'inferido'})`,
              tipo: 'email',
              confianca: item.confianca || 'media',
            });
          }
        }
      }
    } else {
      const phoneRegex = /(?:\+?55\s?)?(?:\(?\d{2}\)?\s?)?\d{4,5}[-.\s]?\d{4}/g;
      const phones = webResult.content.match(phoneRegex) || [];
      for (const phone of phones) {
        const cleaned = phone.replace(/\D/g, '');
        if (cleaned.length >= 10 && cleaned.length <= 13) {
          if (!contacts.find(c => c.valor.replace(/\D/g, '') === cleaned)) {
            const isCelular = cleaned.length >= 11 && cleaned.charAt(cleaned.length - 9) === '9';
            contacts.push({
              valor: phone.trim(),
              fonte: 'Firecrawl (web)',
              tipo: isCelular ? 'celular' : 'telefone',
              confianca: 'alta',
            });
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
        totalResultados: webResult.citations.length,
        resumo: webResult.content,
        aiDados: aiResult ? {
          dominio: aiResult.dominio_empresa,
          linkedin: aiResult.linkedin_provavel,
          obs: aiResult.observacoes,
        } : null,
        fontes: webResult.citations,
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
