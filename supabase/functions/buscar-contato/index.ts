const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

// ===== AbstractAPI Validators =====
async function validateEmail(apiKey: string, email: string): Promise<{ valido: boolean; score: number; detalhes: string }> {
  try {
    const response = await fetch(`https://emailvalidation.abstractapi.com/v1/?api_key=${apiKey}&email=${encodeURIComponent(email)}`);
    const data = await response.json();
    const deliverable = data.deliverability === 'DELIVERABLE';
    const score = data.quality_score ? parseFloat(data.quality_score) : 0;
    return {
      valido: deliverable && score > 0.5,
      score,
      detalhes: `${data.deliverability || 'UNKNOWN'} | MX: ${data.is_mx_found?.value ? 'Sim' : 'Não'} | SMTP: ${data.is_smtp_valid?.value ? 'Sim' : 'Não'} | Descartável: ${data.is_disposable_email?.value ? 'Sim' : 'Não'}`,
    };
  } catch (err) {
    console.error('AbstractAPI email error:', err);
    return { valido: false, score: 0, detalhes: 'Erro na validação' };
  }
}

async function validatePhone(apiKey: string, phone: string): Promise<{ valido: boolean; tipo: string; detalhes: string }> {
  try {
    const cleanPhone = phone.replace(/\D/g, '');
    const intlPhone = cleanPhone.startsWith('55') ? cleanPhone : `55${cleanPhone}`;
    const response = await fetch(`https://phonevalidation.abstractapi.com/v1/?api_key=${apiKey}&phone=${intlPhone}`);
    const data = await response.json();
    return {
      valido: data.valid === true,
      tipo: data.type || 'desconhecido',
      detalhes: `${data.carrier || ''} | ${data.location || ''} | Tipo: ${data.type || 'N/A'}`.trim(),
    };
  } catch (err) {
    console.error('AbstractAPI phone error:', err);
    return { valido: false, tipo: 'desconhecido', detalhes: 'Erro na validação' };
  }
}

// ===== Search APIs =====
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
      messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: query }],
      temperature: 0.1,
    }),
  });
  const ct = response.headers.get('content-type') || '';
  if (!ct.includes('application/json')) {
    await response.text();
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
          { role: 'system', content: 'Você é um especialista em identificar emails corporativos brasileiros. Retorne JSON puro: {"dominio_empresa":"","emails":[{"email":"","confianca":"alta|media|baixa","padrao":""}],"linkedin_provavel":"","observacoes":""}' },
          { role: 'user', content: `Nome: ${nome}\nEmpresa: ${empresa}\nDados:\n${dadosWeb}` }
        ],
        temperature: 0.2,
      }),
    });
    if (!response.ok) { await response.text(); return null; }
    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '';
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    return jsonMatch ? JSON.parse(jsonMatch[0]) : null;
  } catch { return null; }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const { nome, empresa, tipo } = await req.json();
    if (!nome || !tipo) {
      return new Response(JSON.stringify({ success: false, error: 'Nome e tipo são obrigatórios' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const firecrawlKey = Deno.env.get('FIRECRAWL_API_KEY');
    const perplexityKey = Deno.env.get('PERPLEXITY_API_KEY');
    const lovableKey = Deno.env.get('LOVABLE_API_KEY');
    const emailValidationKey = Deno.env.get('ABSTRACTAPI_EMAIL_KEY');
    const phoneValidationKey = Deno.env.get('ABSTRACTAPI_PHONE_KEY');

    if (!firecrawlKey && !perplexityKey) {
      return new Response(JSON.stringify({ success: false, error: 'Nenhuma API de busca configurada' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const empresaNome = empresa || '';
    console.log(`Smart search (${tipo}): ${nome} @ ${empresaNome} [Firecrawl+Perplexity+AbstractAPI]`);

    let webContent = '';
    const allCitations: string[] = [];

    const searchQuery = tipo === 'email'
      ? `"${nome}" "${empresaNome}" email contato linkedin site oficial Brasil`
      : `"${nome}" "${empresaNome}" telefone celular WhatsApp contato Brasil`;

    const ppPrompt = tipo === 'email'
      ? `Encontre emails de "${nome}", sócio/diretor da empresa "${empresaNome}" no Brasil. Pesquise em LinkedIn, site institucional, registros públicos.`
      : `Encontre telefone celular, WhatsApp ou telefone direto de "${nome}", sócio/diretor da empresa "${empresaNome}" no Brasil.`;

    // Parallel search: Firecrawl + Perplexity
    const [fcResult, ppResult] = await Promise.allSettled([
      firecrawlKey ? firecrawlSearch(firecrawlKey, searchQuery) : Promise.resolve([]),
      perplexityKey ? perplexitySearch(perplexityKey, ppPrompt, 'Você é um pesquisador expert em OSINT focado em encontrar contatos de executivos brasileiros. Seja exaustivo.') : Promise.resolve({ content: '', citations: [] }),
    ]);

    if (fcResult.status === 'fulfilled') {
      webContent += (fcResult.value as any[]).map((r: any) => r.markdown || r.description || '').join('\n\n');
      allCitations.push(...(fcResult.value as any[]).map((r: any) => r.url).filter(Boolean));
    }
    if (ppResult.status === 'fulfilled') {
      const pp = ppResult.value as { content: string; citations: string[] };
      webContent += '\n\n' + pp.content;
      for (const url of pp.citations) { if (!allCitations.includes(url)) allCitations.push(url); }
    }

    // AI inference for email
    let aiResult = null;
    if (tipo === 'email' && lovableKey) {
      aiResult = await inferirEmailComIA(lovableKey, nome, empresaNome, webContent);
    }

    // Extract raw contacts
    const rawContacts: { valor: string; origem: string; tipo: string }[] = [];

    if (tipo === 'email') {
      const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
      const emails = webContent.match(emailRegex) || [];
      const genericPatterns = ['nome', 'sobrenome', 'dominio', 'exemplo', 'usuario', 'iniciais', 'primeiro', 'ultimo', 'meio', 'example', 'user@'];
      for (const email of emails) {
        const lower = email.toLowerCase();
        if (!genericPatterns.some(p => lower.includes(p)) && !lower.includes('sentry') && !lower.includes('noreply') && !lower.includes('no-reply') && !lower.includes('teste@') && !lower.includes('test@')) {
          if (!rawContacts.find(c => c.valor === lower)) {
            rawContacts.push({ valor: lower, origem: 'busca_web', tipo: 'email' });
          }
        }
      }
      if (aiResult?.emails) {
        for (const item of aiResult.emails) {
          const lower = (item.email || '').toLowerCase();
          if (lower && !lower.includes('example') && !rawContacts.find(c => c.valor === lower)) {
            rawContacts.push({ valor: lower, origem: 'inferencia_ia', tipo: 'email' });
          }
        }
      }
    } else {
      const phoneRegex = /(?:\+?55\s?)?(?:\(?\d{2}\)?\s?)?\d{4,5}[-.\s]?\d{4}/g;
      const phones = webContent.match(phoneRegex) || [];
      for (const phone of phones) {
        const cleaned = phone.replace(/\D/g, '');
        if (cleaned.length >= 10 && cleaned.length <= 13) {
          if (!rawContacts.find(c => c.valor.replace(/\D/g, '') === cleaned)) {
            rawContacts.push({ valor: phone.trim(), origem: 'busca_web', tipo: 'telefone' });
          }
        }
      }
    }

    // ===== VALIDATION with AbstractAPI =====
    const contacts: { valor: string; tipo: string; verificado: boolean; confianca: 'verificado' | 'provavel' | 'nao_verificado'; validacao: string; origem: string }[] = [];

    if (tipo === 'email' && emailValidationKey) {
      // Validate up to 5 emails to avoid rate limits
      const toValidate = rawContacts.slice(0, 5);
      const validations = await Promise.allSettled(
        toValidate.map(async (c) => {
          const result = await validateEmail(emailValidationKey, c.valor);
          return {
            valor: c.valor,
            tipo: 'email',
            verificado: result.valido,
            confianca: result.valido ? 'verificado' as const : result.score > 0.3 ? 'provavel' as const : 'nao_verificado' as const,
            validacao: result.detalhes,
            origem: c.origem,
          };
        })
      );
      for (const v of validations) {
        if (v.status === 'fulfilled') contacts.push(v.value);
      }
      // Add remaining without validation
      for (const c of rawContacts.slice(5)) {
        contacts.push({ valor: c.valor, tipo: 'email', verificado: false, confianca: 'nao_verificado', validacao: 'Não validado (limite de API)', origem: c.origem });
      }
    } else if (tipo !== 'email' && phoneValidationKey) {
      const toValidate = rawContacts.slice(0, 5);
      const validations = await Promise.allSettled(
        toValidate.map(async (c) => {
          const result = await validatePhone(phoneValidationKey, c.valor);
          const isCelular = result.tipo === 'mobile';
          return {
            valor: c.valor,
            tipo: isCelular ? 'celular' : 'telefone',
            verificado: result.valido,
            confianca: result.valido ? 'verificado' as const : 'nao_verificado' as const,
            validacao: result.detalhes,
            origem: c.origem,
          };
        })
      );
      for (const v of validations) {
        if (v.status === 'fulfilled') contacts.push(v.value);
      }
      for (const c of rawContacts.slice(5)) {
        contacts.push({ valor: c.valor, tipo: 'telefone', verificado: false, confianca: 'nao_verificado', validacao: 'Não validado (limite de API)', origem: c.origem });
      }
    } else {
      // No validation key — mark all as not verified
      for (const c of rawContacts) {
        contacts.push({ valor: c.valor, tipo: c.tipo, verificado: false, confianca: 'nao_verificado', validacao: 'Validação não disponível', origem: c.origem });
      }
    }

    // Sort: verificado first, then provavel, then nao_verificado
    const order = { verificado: 0, provavel: 1, nao_verificado: 2 };
    contacts.sort((a, b) => order[a.confianca] - order[b.confianca]);

    const totalVerificados = contacts.filter(c => c.verificado).length;

    return new Response(
      JSON.stringify({
        success: true,
        contatos: contacts.slice(0, 10),
        verificacao: {
          total_encontrados: rawContacts.length,
          total_verificados: totalVerificados,
          api_validacao: tipo === 'email' ? (emailValidationKey ? 'AbstractAPI Email' : 'não configurada') : (phoneValidationKey ? 'AbstractAPI Phone' : 'não configurada'),
        },
        resumo: webContent.substring(0, 500),
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
