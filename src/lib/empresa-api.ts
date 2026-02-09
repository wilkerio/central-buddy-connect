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
  // Bancos
  "00000000000191", // Banco do Brasil
  "60746948000112", // Bradesco
  "90400888000142", // Banrisul
  "60701190000104", // Itaú Unibanco
  "00360305000104", // Caixa Econômica
  "62073200000121", // BNP Paribas
  "33042953000174", // Citibank
  "60872504000123", // Santander
  // Energia & Petróleo
  "33000167000101", // Petrobras
  "02328280000197", // Eletrobras
  "33050196000188", // Petrobras Distribuidora
  "61695227000193", // Raizen
  // Mineração & Indústria
  "33592510000154", // Vale
  "89850341000160", // Gerdau
  "33412792000160", // JBS
  "02916265000160", // BRF
  "76535764000143", // O Boticário
  "61186680000174", // Natura
  // Varejo & Tecnologia
  "47960950000121", // Magazine Luiza
  "02558157000162", // Telefônica/Vivo
  "33041260065290", // Casas Bahia
  "76430438000142", // Renner
  "33014556000196", // Americanas
  "05423963000111", // Localiza
  "02541982000154", // Raia Drogasil
  "60850229000147", // Carrefour Brasil
  // Saúde & Seguros
  "29309127000179", // Hapvida
  "92693118000160", // SulAmérica
  "02685377000162", // Rede D'Or
  // Construção & Logística
  "01838723000127", // MRV
  "07526557000100", // Azul
  "09296295000160", // Gol
  "04884082000119", // CCR
  "61695554000193", // Embraer
  // Agro & Alimentos
  "00776574000160", // Marfrig
  "47508411000156", // Cosan
  "02800026000181", // Minerva Foods
  // Financeiras & Fintechs
  "18236120000158", // Nubank
  "30306294000145", // Stone
  "10573521000191", // PagSeguro
  // Telecomunicações
  "33530486000129", // Claro/Embratel
  "76535764000143", // Grupo Boticário
  "02421421000111", // Tim
];
