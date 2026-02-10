const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

async function buscarPerplexity(apiKey: string, nome: string, empresa: string, tipo: string) {
  const prompt = tipo === 'email'
    ? `Encontre TODOS os emails de "${nome}", sócio/diretor da empresa "${empresa}" no Brasil.

Pesquise em LinkedIn, site institucional de "${empresa}", Registro.br, Reclame Aqui, Jusbrasil, diários oficiais, artigos, entrevistas, redes sociais.

IMPORTANTE: Identifique o domínio principal da empresa "${empresa}" (ex: empresa.com.br) e sugira padrões prováveis como:
- nome.sobrenome@dominio.com.br
- nome@dominio.com.br  
- n.sobrenome@dominio.com.br
- primeiro.ultimo@dominio.com.br

Liste cada email encontrado OU inferido no formato:
email@dominio.com — Fonte: [onde encontrou ou "padrão inferido"]`
    : `Encontre telefone celular, WhatsApp ou telefone direto de "${nome}", sócio/diretor da empresa "${empresa}" no Brasil.

Pesquise em: site de "${empresa}" (contato, equipe), LinkedIn, Google Maps, Reclame Aqui, Jusbrasil, diários oficiais, redes sociais, Telelistas, GuiaMais.

IMPORTANTE: Priorize celulares (9 dígitos) pois têm WhatsApp. Inclua o DDD.

Liste cada telefone no formato:
(XX) XXXXX-XXXX — Fonte: [onde encontrou]`;

  const response = await fetch('https://api.perplexity.ai/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'sonar',
      messages: [
        { role: 'system', content: 'Você é um pesquisador expert em OSINT focado em encontrar contatos de executivos brasileiros. Seja exaustivo nas buscas. Sempre retorne resultados, mesmo que sejam inferidos a partir de padrões corporativos.' },
        { role: 'user', content: prompt },
      ],
      temperature: 0.1,
    }),
  });

  const data = await response.json();
  if (!response.ok) {
    console.error('Perplexity error:', response.status, data);
    return { content: '', citations: [] };
  }

  return {
    content: data.choices?.[0]?.message?.content || '',
    citations: data.citations || [],
  };
}

async function inferirEmailComIA(lovableKey: string, nome: string, empresa: string, dadosPerplexity: string) {
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
${dadosPerplexity}

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
    
    // Parse JSON from response
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

    const perplexityKey = Deno.env.get('PERPLEXITY_API_KEY');
    const lovableKey = Deno.env.get('LOVABLE_API_KEY');

    if (!perplexityKey) {
      return new Response(
        JSON.stringify({ success: false, error: 'Perplexity não configurado' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const empresaNome = empresa || '';
    console.log(`Smart search (${tipo}): ${nome} @ ${empresaNome}`);

    // Step 1: Perplexity web search
    const perplexityResult = await buscarPerplexity(perplexityKey, nome, empresaNome, tipo);
    
    // Step 2: AI inference (only for email, and only if Lovable AI is available)
    let aiResult = null;
    if (tipo === 'email' && lovableKey) {
      aiResult = await inferirEmailComIA(lovableKey, nome, empresaNome, perplexityResult.content);
    }

    // Step 3: Extract and merge contacts
    const contacts: { valor: string; fonte: string; tipo: string; confianca: string }[] = [];

    if (tipo === 'email') {
      // Emails from Perplexity
      const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
      const emails = perplexityResult.content.match(emailRegex) || [];
      const genericPatterns = ['nome', 'sobrenome', 'dominio', 'exemplo', 'usuario', 'iniciais', 'primeiro', 'ultimo', 'meio', 'example', 'user@'];
      for (const email of emails) {
        const lower = email.toLowerCase();
        const isGeneric = genericPatterns.some(p => lower.includes(p));
        if (!isGeneric && !lower.includes('sentry') && !lower.includes('noreply') && !lower.includes('no-reply') && !lower.includes('teste@') && !lower.includes('test@')) {
          if (!contacts.find(c => c.valor === lower)) {
            contacts.push({ valor: lower, fonte: 'Perplexity (web)', tipo: 'email', confianca: 'alta' });
          }
        }
      }

      // Emails from AI inference
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
      // Phones from Perplexity
      const phoneRegex = /(?:\+?55\s?)?(?:\(?\d{2}\)?\s?)?\d{4,5}[-.\s]?\d{4}/g;
      const phones = perplexityResult.content.match(phoneRegex) || [];
      for (const phone of phones) {
        const cleaned = phone.replace(/\D/g, '');
        if (cleaned.length >= 10 && cleaned.length <= 13) {
          if (!contacts.find(c => c.valor.replace(/\D/g, '') === cleaned)) {
            const isCelular = cleaned.length >= 11 && cleaned.charAt(cleaned.length - 9) === '9';
            contacts.push({
              valor: phone.trim(),
              fonte: 'Perplexity (web)',
              tipo: isCelular ? 'celular' : 'telefone',
              confianca: 'alta',
            });
          }
        }
      }
    }

    // Sort: alta first, then media, then baixa
    const order = { alta: 0, media: 1, baixa: 2 };
    contacts.sort((a, b) => (order[a.confianca as keyof typeof order] || 2) - (order[b.confianca as keyof typeof order] || 2));

    return new Response(
      JSON.stringify({
        success: true,
        contatos: contacts.slice(0, 10),
        totalResultados: perplexityResult.citations.length,
        resumo: perplexityResult.content,
        aiDados: aiResult ? {
          dominio: aiResult.dominio_empresa,
          linkedin: aiResult.linkedin_provavel,
          obs: aiResult.observacoes,
        } : null,
        fontes: perplexityResult.citations,
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
