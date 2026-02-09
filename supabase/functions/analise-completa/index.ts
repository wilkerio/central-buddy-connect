const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

interface FonteResultado {
  fonte: string;
  status: 'sucesso' | 'erro' | 'sem_dados';
  dados: any;
  tempoMs: number;
}

// Helper to time async calls
async function timedFetch(nome: string, fn: () => Promise<any>): Promise<FonteResultado> {
  const start = Date.now();
  try {
    const dados = await fn();
    return { fonte: nome, status: 'sucesso', dados, tempoMs: Date.now() - start };
  } catch (err) {
    console.error(`[${nome}] Erro:`, err);
    return { fonte: nome, status: 'erro', dados: { error: err instanceof Error ? err.message : 'Erro desconhecido' }, tempoMs: Date.now() - start };
  }
}

// ========== DATA SOURCES ==========

// 1. BrasilAPI - CNPJ (enriched data)
async function buscarCnpjBrasilApi(cnpj: string) {
  const res = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${cnpj}`);
  if (!res.ok) throw new Error(`Status ${res.status}`);
  return res.json();
}

// 2. BrasilAPI - CEP
async function buscarCep(cep: string) {
  if (!cep) return null;
  const clean = cep.replace(/\D/g, '');
  if (clean.length !== 8) return null;
  const res = await fetch(`https://brasilapi.com.br/api/cep/v2/${clean}`);
  if (!res.ok) return null;
  return res.json();
}

// 3. BrasilAPI - DDD info
async function buscarDdd(ddd: string) {
  if (!ddd) return null;
  const clean = ddd.replace(/\D/g, '').substring(0, 2);
  if (clean.length < 2) return null;
  const res = await fetch(`https://brasilapi.com.br/api/ddd/v1/${clean}`);
  if (!res.ok) return null;
  return res.json();
}

// 4. BrasilAPI - IBGE municipality
async function buscarMunicipioIbge(uf: string) {
  if (!uf) return null;
  const res = await fetch(`https://brasilapi.com.br/api/ibge/municipios/v1/${uf}?providers=dados-abertos-br,gov,wikipedia`);
  if (!res.ok) return null;
  return res.json();
}

// 5. BrasilAPI - Tabela de bancos
async function buscarBancos() {
  const res = await fetch('https://brasilapi.com.br/api/banks/v1');
  if (!res.ok) return [];
  const data = await res.json();
  return { totalBancos: data.length, amostra: data.slice(0, 5) };
}

// 6. ReceitaWS - Additional CNPJ data
async function buscarReceitaWs(cnpj: string) {
  const res = await fetch(`https://receitaws.com.br/v1/cnpj/${cnpj}`, {
    headers: { 'Accept': 'application/json' },
  });
  if (!res.ok) throw new Error(`Status ${res.status}`);
  const data = await res.json();
  if (data.status === 'ERROR') throw new Error(data.message || 'CNPJ não encontrado');
  return {
    situacao: data.situacao,
    tipo: data.tipo,
    atividade_principal: data.atividade_principal,
    atividades_secundarias: data.atividades_secundarias?.slice(0, 5),
    natureza_juridica: data.natureza_juridica,
    capital_social: data.capital_social,
    porte: data.porte,
    abertura: data.abertura,
    ultima_atualizacao: data.ultima_atualizacao,
    efr: data.efr,
    motivo_situacao: data.motivo_situacao,
    situacao_especial: data.situacao_especial,
    data_situacao_especial: data.data_situacao_especial,
    qsa: data.qsa?.map((s: any) => ({ nome: s.nome, qual: s.qual })),
  };
}

// 7-15. Firecrawl-based searches
async function buscarViaFirecrawl(apiKey: string, query: string, limit = 5) {
  const res = await fetch('https://api.firecrawl.dev/v1/search', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, limit, lang: 'pt-br', country: 'BR' }),
  });
  if (!res.ok) throw new Error(`Firecrawl ${res.status}`);
  const data = await res.json();
  return (data.data || []).map((r: any) => ({
    titulo: r.title || '',
    url: r.url || '',
    descricao: r.description || '',
    conteudo: (r.markdown || '').substring(0, 500),
  }));
}

// Extract monetary values from text
function extrairValores(texto: string): string[] {
  const regex = /R\$\s*[\d.,]+(?:\s*(?:mil|milh[õo]|bilh[õo]|trilh[õo])(?:es|ões)?)?/gi;
  return [...new Set((texto.match(regex) || []).slice(0, 10))];
}

// Extract emails from text
function extrairEmails(texto: string): string[] {
  const regex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
  return [...new Set((texto.match(regex) || []).filter(e => !e.includes('example') && !e.includes('teste')).slice(0, 10))];
}

// Extract phone numbers
function extrairTelefones(texto: string): string[] {
  const regex = /(?:\+55\s?)?(?:\(?\d{2}\)?\s?)?(?:9\s?)?\d{4}[-.\s]?\d{4}/g;
  return [...new Set((texto.match(regex) || []).slice(0, 10))];
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { cnpj, razao_social, nome_fantasia, cep, ddd_telefone_1, uf, municipio, qsa } = await req.json();

    if (!cnpj) {
      return new Response(
        JSON.stringify({ success: false, error: 'CNPJ é obrigatório' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const cleanCnpj = cnpj.replace(/\D/g, '');
    const nomeEmpresa = nome_fantasia || razao_social || '';
    const apiKey = Deno.env.get('FIRECRAWL_API_KEY');

    console.log(`[analise-completa] Iniciando análise para ${nomeEmpresa} (${cleanCnpj})`);

    // ========== PARALLEL EXECUTION OF ALL SOURCES ==========
    const fontes: Promise<FonteResultado>[] = [];

    // === FREE APIs (BrasilAPI + others) ===
    // 1. CNPJ enrichment
    fontes.push(timedFetch('BrasilAPI CNPJ', () => buscarCnpjBrasilApi(cleanCnpj)));

    // 2. CEP data
    fontes.push(timedFetch('BrasilAPI CEP', () => buscarCep(cep)));

    // 3. DDD info
    const ddd = ddd_telefone_1 ? ddd_telefone_1.replace(/\D/g, '').substring(0, 2) : '';
    fontes.push(timedFetch('BrasilAPI DDD', () => buscarDdd(ddd)));

    // 4. IBGE municipalities
    fontes.push(timedFetch('IBGE Municípios', () => buscarMunicipioIbge(uf)));

    // 5. Bancos
    fontes.push(timedFetch('BrasilAPI Bancos', () => buscarBancos()));

    // 6. ReceitaWS
    fontes.push(timedFetch('ReceitaWS', () => buscarReceitaWs(cleanCnpj)));

    // === FIRECRAWL-BASED SEARCHES (if API key available) ===
    if (apiKey) {
      // 7. Dívida Ativa da União
      fontes.push(timedFetch('Dívida Ativa (PGFN)', () =>
        buscarViaFirecrawl(apiKey, `"${nomeEmpresa}" OR "${cleanCnpj}" dívida ativa PGFN site:pgfn.fazenda.gov.br OR site:regularize.pgfn.gov.br`, 3)
      ));

      // 8. CEIS - Cadastro de Empresas Inidôneas
      fontes.push(timedFetch('CEIS Sanções', () =>
        buscarViaFirecrawl(apiKey, `"${nomeEmpresa}" OR "${cleanCnpj}" CEIS inidônea suspensa sanção`, 3)
      ));

      // 9. CNEP - Cadastro de Empresas Punidas
      fontes.push(timedFetch('CNEP Punições', () =>
        buscarViaFirecrawl(apiKey, `"${nomeEmpresa}" OR "${cleanCnpj}" CNEP punida penalidade`, 3)
      ));

      // 10. Simples Nacional
      fontes.push(timedFetch('Simples Nacional', () =>
        buscarViaFirecrawl(apiKey, `"${nomeEmpresa}" OR "${cleanCnpj}" simples nacional MEI optante`, 3)
      ));

      // 11. CVM - Comissão de Valores Mobiliários
      fontes.push(timedFetch('CVM', () =>
        buscarViaFirecrawl(apiKey, `"${nomeEmpresa}" OR "${cleanCnpj}" site:cvm.gov.br OR "comissão de valores mobiliários"`, 3)
      ));

      // 12. BNDES Transparência
      fontes.push(timedFetch('BNDES', () =>
        buscarViaFirecrawl(apiKey, `"${nomeEmpresa}" OR "${cleanCnpj}" BNDES financiamento contrato`, 3)
      ));

      // 13. Processos Judiciais
      fontes.push(timedFetch('Processos Judiciais', () =>
        buscarViaFirecrawl(apiKey, `"${nomeEmpresa}" OR "${cleanCnpj}" processo judicial ação jusbrasil`, 4)
      ));

      // 14. Protestos em Cartório
      fontes.push(timedFetch('Protestos', () =>
        buscarViaFirecrawl(apiKey, `"${nomeEmpresa}" OR "${cleanCnpj}" protesto cartório título`, 3)
      ));

      // 15. Portal da Transparência
      fontes.push(timedFetch('Portal Transparência', () =>
        buscarViaFirecrawl(apiKey, `"${nomeEmpresa}" OR "${cleanCnpj}" site:portaldatransparencia.gov.br contrato licitação`, 3)
      ));

      // 16. Diário Oficial
      fontes.push(timedFetch('Diário Oficial', () =>
        buscarViaFirecrawl(apiKey, `"${nomeEmpresa}" OR "${cleanCnpj}" diário oficial publicação`, 3)
      ));

      // 17. Receita Federal - Situação fiscal
      fontes.push(timedFetch('Receita Federal', () =>
        buscarViaFirecrawl(apiKey, `"${nomeEmpresa}" OR "${cleanCnpj}" receita federal situação cadastral`, 3)
      ));

      // 18. CADIN - Inadimplentes
      fontes.push(timedFetch('CADIN', () =>
        buscarViaFirecrawl(apiKey, `"${nomeEmpresa}" OR "${cleanCnpj}" CADIN inadimplente cadastro`, 3)
      ));

      // 19. Comércio Exterior (COMEX)
      fontes.push(timedFetch('Comércio Exterior', () =>
        buscarViaFirecrawl(apiKey, `"${nomeEmpresa}" OR "${cleanCnpj}" exportação importação comércio exterior RADAR`, 3)
      ));

      // 20. ANS - Agência Nacional de Saúde
      fontes.push(timedFetch('ANS', () =>
        buscarViaFirecrawl(apiKey, `"${nomeEmpresa}" OR "${cleanCnpj}" site:ans.gov.br OR "agência nacional de saúde"`, 2)
      ));

      // 21. ANVISA
      fontes.push(timedFetch('ANVISA', () =>
        buscarViaFirecrawl(apiKey, `"${nomeEmpresa}" OR "${cleanCnpj}" site:anvisa.gov.br OR anvisa registro`, 2)
      ));

      // 22. ANATEL
      fontes.push(timedFetch('ANATEL', () =>
        buscarViaFirecrawl(apiKey, `"${nomeEmpresa}" OR "${cleanCnpj}" site:anatel.gov.br OR anatel outorga`, 2)
      ));

      // 23. IBAMA - Multas ambientais
      fontes.push(timedFetch('IBAMA', () =>
        buscarViaFirecrawl(apiKey, `"${nomeEmpresa}" OR "${cleanCnpj}" ibama multa ambiental auto infração`, 2)
      ));

      // 24. TCU - Tribunal de Contas
      fontes.push(timedFetch('TCU', () =>
        buscarViaFirecrawl(apiKey, `"${nomeEmpresa}" OR "${cleanCnpj}" TCU "tribunal de contas" acórdão`, 2)
      ));

      // 25. Reclame Aqui (reputação)
      fontes.push(timedFetch('Reclame Aqui', () =>
        buscarViaFirecrawl(apiKey, `"${nomeEmpresa}" site:reclameaqui.com.br`, 3)
      ));

      // 26. Buscar emails dos sócios
      if (qsa && qsa.length > 0) {
        const sociosPrincipais = qsa.slice(0, 3).map((s: any) => s.nome_socio).join('" OR "');
        fontes.push(timedFetch('Contatos Sócios', () =>
          buscarViaFirecrawl(apiKey, `"${sociosPrincipais}" "${nomeEmpresa}" email contato telefone linkedin`, 5)
        ));
      }

      // 27. Glassdoor / Indeed (empregador)
      fontes.push(timedFetch('Glassdoor/Indeed', () =>
        buscarViaFirecrawl(apiKey, `"${nomeEmpresa}" glassdoor OR indeed avaliação empresa empregador`, 2)
      ));

      // 28. Notícias recentes
      fontes.push(timedFetch('Notícias', () =>
        buscarViaFirecrawl(apiKey, `"${nomeEmpresa}" notícia 2025 2024`, 4)
      ));

      // 29. Website oficial
      fontes.push(timedFetch('Website Oficial', () =>
        buscarViaFirecrawl(apiKey, `"${nomeEmpresa}" site oficial`, 2)
      ));

      // 30. Patentes / INPI
      fontes.push(timedFetch('INPI Patentes', () =>
        buscarViaFirecrawl(apiKey, `"${nomeEmpresa}" OR "${cleanCnpj}" INPI patente marca registro`, 2)
      ));
    }

    // ========== EXECUTE ALL IN PARALLEL ==========
    const resultados = await Promise.all(fontes);

    console.log(`[analise-completa] ${resultados.length} fontes consultadas`);

    // ========== AGGREGATE RESULTS ==========
    const sucesso = resultados.filter(r => r.status === 'sucesso');
    const erros = resultados.filter(r => r.status === 'erro');
    const tempoTotal = resultados.reduce((acc, r) => Math.max(acc, r.tempoMs), 0);

    // Extract all values, emails, phones from Firecrawl results
    const todosTextos = resultados
      .filter(r => r.status === 'sucesso' && Array.isArray(r.dados))
      .flatMap(r => r.dados.map((d: any) => `${d.titulo} ${d.descricao} ${d.conteudo}`))
      .join(' ');

    const todosValores = extrairValores(todosTextos);
    const todosEmails = extrairEmails(todosTextos);
    const todosTelefones = extrairTelefones(todosTextos);

    // Categorize results
    const categorias = {
      fiscal: {
        label: 'Fiscal & Tributário',
        fontes: resultados.filter(r => ['Simples Nacional', 'Receita Federal', 'ReceitaWS', 'CADIN', 'Dívida Ativa (PGFN)'].includes(r.fonte)),
      },
      judicial: {
        label: 'Judicial & Regulatório',
        fontes: resultados.filter(r => ['CEIS Sanções', 'CNEP Punições', 'Processos Judiciais', 'Protestos', 'TCU', 'IBAMA'].includes(r.fonte)),
      },
      governo: {
        label: 'Governo & Contratos',
        fontes: resultados.filter(r => ['Portal Transparência', 'BNDES', 'Diário Oficial', 'CVM'].includes(r.fonte)),
      },
      regulatorio: {
        label: 'Agências Reguladoras',
        fontes: resultados.filter(r => ['ANS', 'ANVISA', 'ANATEL', 'INPI Patentes'].includes(r.fonte)),
      },
      comercio: {
        label: 'Comércio Exterior',
        fontes: resultados.filter(r => ['Comércio Exterior'].includes(r.fonte)),
      },
      reputacao: {
        label: 'Reputação & Mercado',
        fontes: resultados.filter(r => ['Reclame Aqui', 'Glassdoor/Indeed', 'Notícias', 'Website Oficial'].includes(r.fonte)),
      },
      contatos: {
        label: 'Contatos & Prospecção',
        fontes: resultados.filter(r => ['Contatos Sócios'].includes(r.fonte)),
      },
      dados_basicos: {
        label: 'Dados Básicos',
        fontes: resultados.filter(r => ['BrasilAPI CNPJ', 'BrasilAPI CEP', 'BrasilAPI DDD', 'IBGE Municípios', 'BrasilAPI Bancos'].includes(r.fonte)),
      },
    };

    // Determine risk signals
    const sinaisRisco: string[] = [];
    const sinaisPositivos: string[] = [];

    for (const r of resultados) {
      if (r.status !== 'sucesso') continue;
      const items = Array.isArray(r.dados) ? r.dados : [];
      const texto = items.map((d: any) => `${d.titulo} ${d.descricao}`).join(' ').toLowerCase();

      if (['CEIS Sanções', 'CNEP Punições'].includes(r.fonte) && items.length > 0) {
        if (texto.includes('inidône') || texto.includes('suspens') || texto.includes('punid')) {
          sinaisRisco.push(`⚠️ ${r.fonte}: possíveis registros encontrados`);
        }
      }
      if (r.fonte === 'Dívida Ativa (PGFN)' && items.length > 0 && texto.includes('dívida')) {
        sinaisRisco.push('⚠️ Possível dívida ativa na PGFN');
      }
      if (r.fonte === 'Processos Judiciais' && items.length > 0) {
        sinaisRisco.push(`📋 ${items.length} resultado(s) de processos judiciais`);
      }
      if (r.fonte === 'IBAMA' && items.length > 0 && texto.includes('multa')) {
        sinaisRisco.push('🌿 Possíveis multas ambientais (IBAMA)');
      }
      if (r.fonte === 'BNDES' && items.length > 0) {
        sinaisPositivos.push('🏛️ Relação com BNDES encontrada');
      }
      if (r.fonte === 'Comércio Exterior' && items.length > 0) {
        sinaisPositivos.push('🌍 Atividade de comércio exterior');
      }
      if (r.fonte === 'CVM' && items.length > 0) {
        sinaisPositivos.push('📈 Registros na CVM');
      }
    }

    const resultado = {
      success: true,
      cnpj: cleanCnpj,
      empresa: nomeEmpresa,
      resumo: {
        totalFontes: resultados.length,
        fontesComSucesso: sucesso.length,
        fontesComErro: erros.length,
        tempoTotalMs: tempoTotal,
        valoresEncontrados: todosValores,
        emailsEncontrados: todosEmails,
        telefonesEncontrados: todosTelefones,
        sinaisRisco,
        sinaisPositivos,
      },
      categorias,
      fontes: resultados,
    };

    return new Response(
      JSON.stringify(resultado),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('[analise-completa] Error:', error);
    return new Response(
      JSON.stringify({ success: false, error: error instanceof Error ? error.message : 'Erro desconhecido' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
