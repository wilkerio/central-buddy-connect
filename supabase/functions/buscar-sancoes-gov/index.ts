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
        { role: 'system', content: 'Você é um especialista em compliance e due diligence empresarial no Brasil. Pesquise dados oficiais sobre sanções, impedimentos e penalidades governamentais. Responda de forma objetiva e estruturada.' },
        { role: 'user', content: query },
      ],
      temperature: 0.1,
    }),
  });

  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || `Erro ${response.status}`);
  return {
    content: data.choices?.[0]?.message?.content || '',
    citations: data.citations || [],
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const { cnpj, razao_social } = await req.json();
    if (!cnpj) {
      return new Response(JSON.stringify({ success: false, error: 'CNPJ é obrigatório' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const apiKey = Deno.env.get('PERPLEXITY_API_KEY');
    if (!apiKey) {
      return new Response(JSON.stringify({ success: false, error: 'Perplexity não configurado' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const cleanCnpj = cnpj.replace(/\D/g, '');
    const cnpjFormatted = cleanCnpj.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
    const nome = razao_social || cnpjFormatted;

    console.log(`Buscando sanções governamentais para: ${nome} (${cnpjFormatted})`);

    const searches = [
      {
        tipo: 'ceis',
        label: 'CEIS - Empresas Inidôneas e Suspensas',
        query: `Pesquise se a empresa "${nome}" CNPJ ${cnpjFormatted} consta no CEIS (Cadastro Nacional de Empresas Inidôneas e Suspensas) do Portal da Transparência do Governo Federal. Informe se há registros de impedimentos, motivo da sanção, órgão sancionador, data de início e término da sanção.`,
      },
      {
        tipo: 'cnep',
        label: 'CNEP - Empresas Punidas',
        query: `Pesquise se a empresa "${nome}" CNPJ ${cnpjFormatted} consta no CNEP (Cadastro Nacional de Empresas Punidas) com base na Lei Anticorrupção (Lei 12.846/2013). Informe se há registros de punições, tipo de sanção, valor de multa e situação.`,
      },
      {
        tipo: 'cepim',
        label: 'CEPIM - Entidades Impedidas',
        query: `Pesquise se a empresa "${nome}" CNPJ ${cnpjFormatted} consta no CEPIM (Cadastro de Entidades Privadas Sem Fins Lucrativos Impedidas) ou possui outras restrições no Portal da Transparência. Verifique também se há registros no Cadastro de Expulsões da Administração Federal (CEAF) relacionados a sócios da empresa.`,
      },
      {
        tipo: 'tcu_cgu',
        label: 'TCU/CGU - Irregularidades',
        query: `Pesquise se a empresa "${nome}" CNPJ ${cnpjFormatted} possui irregularidades apontadas pelo TCU (Tribunal de Contas da União) ou CGU (Controladoria-Geral da União). Informe achados de auditoria, processos de tomada de contas especial, ou determinações de órgãos de controle.`,
      },
    ];

    const results: Record<string, any> = {};
    let totalSancoes = 0;

    await Promise.all(
      searches.map(async (search) => {
        try {
          const { content, citations } = await perplexitySearch(apiKey, search.query);
          
          // Detect if sanctions were found
          const temSancao = /consta|registrad[oa]|encontrad[oa]|sanciona|impedid[oa]|punid[oa]|irregularidade/i.test(content) &&
            !/não consta|não foi encontrad|não há registro|sem registro|não possui|não foram encontrad/i.test(content);
          
          if (temSancao) totalSancoes++;

          results[search.tipo] = {
            label: search.label,
            tem_registro: temSancao,
            resumo: content,
            fontes: citations.map((url: string) => {
              try { return { url, fonte: new URL(url).hostname }; }
              catch { return { url, fonte: 'web' }; }
            }),
          };
        } catch (err) {
          console.error(`Error searching ${search.tipo}:`, err);
          results[search.tipo] = {
            label: search.label,
            tem_registro: false,
            resumo: '',
            error: err instanceof Error ? err.message : 'Erro desconhecido',
            fontes: [],
          };
        }
      })
    );

    // Risk level based on sanctions
    let risco_sancoes: string;
    if (totalSancoes === 0) risco_sancoes = 'baixo';
    else if (totalSancoes === 1) risco_sancoes = 'medio';
    else risco_sancoes = 'alto';

    return new Response(JSON.stringify({
      success: true,
      cnpj: cleanCnpj,
      total_sancoes: totalSancoes,
      risco_sancoes,
      sancoes: results,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (error) {
    console.error('Error:', error);
    return new Response(
      JSON.stringify({ success: false, error: error instanceof Error ? error.message : 'Erro desconhecido' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
