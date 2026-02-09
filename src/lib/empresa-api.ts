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

export async function searchInstituicoesFinanceiras(nome: string): Promise<InstituicaoFinanceira[]> {
  const url = `https://olinda.bcb.gov.br/olinda/servico/informes_ifdata/versao/v1/odata/IfDataCadastro?$filter=contains(NomeInstituicao,'${encodeURIComponent(nome)}')&$top=20&$format=json`;

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
