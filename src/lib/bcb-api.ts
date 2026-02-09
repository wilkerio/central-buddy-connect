// Banco Central do Brasil - API pública SGS
// Docs: https://dadosabertos.bcb.gov.br/

export interface SerieData {
  data: string;
  valor: string;
}

export interface PopularSerie {
  codigo: number;
  nome: string;
  unidade: string;
}

// Séries populares do BCB
export const POPULAR_SERIES: PopularSerie[] = [
  { codigo: 11, nome: "Taxa de juros - Selic", unidade: "% a.a." },
  { codigo: 433, nome: "IPCA - Variação mensal", unidade: "%" },
  { codigo: 1, nome: "Taxa de câmbio - Dólar (venda)", unidade: "R$/US$" },
  { codigo: 21619, nome: "Taxa de câmbio - Euro (venda)", unidade: "R$/EUR" },
  { codigo: 4390, nome: "CDI acumulado no mês", unidade: "%" },
  { codigo: 7326, nome: "IGPM - Variação mensal", unidade: "%" },
  { codigo: 24364, nome: "Dívida Líquida do Setor Público - % PIB", unidade: "%" },
  { codigo: 4393, nome: "IPCA - acumulado 12 meses", unidade: "%" },
  { codigo: 27574, nome: "PIB mensal - Valores correntes", unidade: "R$ milhões" },
  { codigo: 20542, nome: "Índice de Atividade Econômica - IBC-Br", unidade: "Índice" },
];

function formatDate(date: Date): string {
  const dd = String(date.getDate()).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const yyyy = date.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

export async function fetchSerie(
  codigo: number,
  dataInicio?: Date,
  dataFim?: Date
): Promise<SerieData[]> {
  const fim = dataFim || new Date();
  const inicio = dataInicio || new Date(fim.getFullYear() - 1, fim.getMonth(), fim.getDate());

  const url = `https://api.bcb.gov.br/dados/serie/bcdata.sgs.${codigo}/dados?formato=json&dataInicial=${formatDate(inicio)}&dataFinal=${formatDate(fim)}`;

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Erro ao buscar série ${codigo}: ${response.status}`);
  }

  return response.json();
}

export async function fetchUltimoValor(codigo: number): Promise<SerieData | null> {
  const url = `https://api.bcb.gov.br/dados/serie/bcdata.sgs.${codigo}/dados/ultimos/1?formato=json`;

  const response = await fetch(url);
  if (!response.ok) return null;

  const data = await response.json();
  return data.length > 0 ? data[0] : null;
}
