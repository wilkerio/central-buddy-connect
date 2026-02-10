// BrasilAPI - CNPJ (Receita Federal)
// https://brasilapi.com.br/docs#tag/CNPJ

export interface CnpjData {
  cnpj: string;
  razao_social: string;
  nome_fantasia: string;
  situacao_cadastral: string;
  data_situacao_cadastral: string;
  capital_social: number;
  natureza_juridica: string;
  porte: string;
  cnae_fiscal: number;
  cnae_fiscal_descricao: string;
  cnaes_secundarios: { codigo: number; descricao: string }[];
  logradouro: string;
  numero: string;
  complemento: string;
  bairro: string;
  municipio: string;
  uf: string;
  cep: string;
  ddd_telefone_1: string;
  email: string;
  data_inicio_atividade: string;
  qsa: { nome_socio: string; qualificacao_socio: string; capital_social_socio: number }[];
}

export async function fetchCnpj(cnpj: string): Promise<CnpjData> {
  const cleaned = cnpj.replace(/\D/g, "");
  if (cleaned.length !== 14) throw new Error("CNPJ deve ter 14 dígitos");

  const response = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${cleaned}`);
  if (!response.ok) {
    if (response.status === 404) throw new Error("CNPJ não encontrado");
    throw new Error(`Erro ao buscar CNPJ: ${response.status}`);
  }
  return response.json();
}

// BCB - IF.data - Instituições Financeiras
export interface InstituicaoFinanceira {
  codigoIf: number;
  nomeIf: string;
  cnpj: string;
  segmento: string;
  tipoInstituicao: string;
}

export async function fetchAllInstituicoesFinanceiras(): Promise<InstituicaoFinanceira[]> {
  const url = `https://olinda.bcb.gov.br/olinda/servico/informes_ifdata/versao/v1/odata/IfDataCadastro?$top=100&$orderby=NomeInstituicao&$format=json`;

  const response = await fetch(url);
  if (!response.ok) throw new Error(`Erro ao buscar IFs: ${response.status}`);

  const data = await response.json();
  return (data.value || []).map((item: any) => ({
    codigoIf: item.CodigoIf,
    nomeIf: item.NomeInstituicao,
    cnpj: item.Cnpj,
    segmento: item.Segmento,
    tipoInstituicao: item.TipoInstituicao,
  }));
}

// Grande lista de CNPJs para busca contínua em background
export const CNPJS_POOL = [
  // Bancos & Financeiro
  "00000000000191", // Banco do Brasil
  "60746948000112", // Bradesco
  "90400888000142", // Banrisul
  "60701190000104", // Itaú Unibanco
  "00360305000104", // Caixa Econômica
  "62073200000121", // BNP Paribas
  "33042953000174", // Citibank
  "60872504000123", // Santander
  "18236120000158", // Nubank
  "30306294000145", // Stone
  "10573521000191", // PagSeguro
  "92702067000196", // Banco Original
  "00416968000101", // Banco Inter
  "13370835000185", // XP Investimentos
  "62307848000115", // BTG Pactual
  "04902979000144", // Banco Daycoval
  "60850229000147", // Safra
  "17351180000159", // Banco Pan
  "92894922000108", // Sicredi
  "02038232000164", // Sicoob

  // Energia & Petróleo
  "33000167000101", // Petrobras
  "02328280000197", // Eletrobras
  "33050196000188", // Vibra Energia (ex-BR Distribuidora)
  "61695227000193", // Raizen
  "02998611000104", // Eneva
  "15527906000136", // Equatorial Energia
  "02016440000162", // AES Brasil
  "04895728000180", // Neoenergia
  "61093009000109", // CPFL Energia
  "02846056000168", // Copel
  "17155730000164", // CEMIG
  "33050071000158", // Light
  "33337122000127", // Eletropaulo/Enel SP
  "02328280000197", // Eletrobras
  "61695554000193", // Embraer (aviação)

  // Mineração & Siderurgia
  "33592510000154", // Vale
  "89850341000160", // Gerdau
  "17469701000177", // CSN
  "60894730000105", // Usiminas
  "92690783000191", // Ferbasa

  // Alimentos & Agro
  "33412792000160", // JBS
  "02916265000160", // BRF
  "00776574000160", // Marfrig
  "02800026000181", // Minerva Foods
  "47508411000156", // Cosan
  "86550951000150", // Camil Alimentos
  "01838723000127", // M.Dias Branco
  "56994502000130", // SLC Agrícola
  "07526557000100", // Adecoagro
  "09274235000102", // São Martinho
  "60746948000112", // Brasilagro
  "95438849000106", // Jalles Machado

  // Varejo
  "47960950000121", // Magazine Luiza
  "76430438000142", // Renner
  "33014556000196", // Americanas
  "02541982000154", // Raia Drogasil
  "60850229000147", // Carrefour Brasil
  "47508411000156", // Assaí Atacadista
  "04433714000165", // Petz
  "02558157000162", // Grupo Mateus
  "61585865000151", // Pague Menos
  "49669856000143", // Arezzo
  "07170938000107", // Centauro/Grupo SBF
  "27865757000102", // Via (Casas Bahia)
  "75315333000109", // Havan
  "47960950000121", // Kabum

  // Tecnologia & Telecom
  "02558157000162", // Telefônica/Vivo
  "33530486000129", // Claro/Embratel
  "02421421000111", // Tim
  "04065791000199", // Positivo Tecnologia
  "02083364000148", // TOTVS
  "10793118000178", // Locaweb
  "14380200000121", // Vtex
  "02276653000123", // Linx
  "27865757000102", // CI&T
  "34878566000129", // PicPay

  // Saúde
  "29309127000179", // Hapvida
  "92693118000160", // SulAmérica
  "02685377000162", // Rede D'Or
  "28027316000110", // Notre Dame Intermédica
  "05895227000156", // Fleury
  "61486650000183", // Dasa
  "43213221000110", // Oncoclínicas
  "50722325000160", // Mater Dei

  // Construção & Imobiliário
  "01838723000127", // MRV
  "52007199000104", // Cyrela
  "73178600000118", // Even
  "08741499000108", // Eztec
  "07859971000130", // Tenda
  "07816890000153", // Direcional
  "51218147000193", // Trisul
  "29780061000109", // Lavvi

  // Logística & Transporte
  "07526557000100", // Azul
  "09296295000160", // Gol
  "04884082000119", // CCR
  "02846056000168", // Ecorodovias
  "08402943000169", // Rumo Logística
  "02960895000112", // Movida
  "05423963000111", // Localiza
  "44914992000134", // JSL
  "17314329000120", // Vamos Locação
  "01543035000104", // Santos Brasil

  // Cosméticos & Consumo
  "76535764000143", // O Boticário
  "61186680000174", // Natura &Co
  "56381218000107", // Alpargatas (Havaianas)
  "07516735000108", // Kimberly-Clark Brasil
  "61064929000179", // Colgate-Palmolive
  "61099008000141", // Unilever Brasil
  "33033028000102", // Ambev

  // Papel & Celulose
  "60643228000121", // Suzano
  "89012294000173", // Klabin

  // Seguros & Previdência
  "29030467000162", // Porto Seguro
  "33000118000179", // BB Seguridade
  "92702067000196", // IRB Brasil RE
  "02585585000148", // Caixa Seguridade

  // Educação
  "02541982000154", // Cogna (Kroton)
  "04310392000146", // Yduqs
  "08561701000101", // Ser Educacional
  "02800026000181", // Ânima Educação
  "46068425000133", // Cruzeiro do Sul

  // Diversos / Industrial
  "76500180000120", // WEG
  "42150391000170", // Randon
  "84429695000111", // Marcopolo
  "15115504000124", // Iochpe-Maxion
  "60894730000105", // Tupy
  "33000167000101", // Braskem
];
