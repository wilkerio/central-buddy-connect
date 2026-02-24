import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { fetchCnpj, fetchAllInstituicoesFinanceiras, CNPJS_POOL_UNIQUE, type CnpjData } from "@/lib/empresa-api";
import PlanilhaUpload from "@/components/PlanilhaUpload";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Building2, Landmark, ArrowLeft, Users, Search, X, Phone, Mail, MessageCircle, ExternalLink, Loader2, Pause, Play, Globe, TrendingUp, ShieldCheck, AlertTriangle, FileText, Scale, DollarSign, Gavel, Ban, Receipt, BarChart3, Info, Home, Car, Briefcase, Shield, CheckCircle2, XCircle, HelpCircle, Zap, Tag, Database, ChevronRight } from "lucide-react";
import { SourceIndicator, SourceBadgeRow, type ConfiancaNivel, type Fonte } from "@/components/SourceIndicator";
import { Progress } from "@/components/ui/progress";
import { Link } from "react-router-dom";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, PieChart, Pie, Legend } from "recharts";

const SEARCH_INTERVAL = 5000;
const DISCOVERY_INTERVAL = 3000; // Faster for random discovery

function shuffleArray<T>(arr: T[]): T[] {
  const shuffled = [...arr];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

// Multiplicadores CNAE para estimativa rápida de faturamento
const MULT_CNAE: Record<string, number> = {
  '46': 8, '47': 10, '10': 6, '11': 6, '20': 4, '21': 5, '29': 5, '62': 3,
  '64': 2, '65': 2, '49': 4, '50': 4, '51': 3, '41': 5, '01': 6, '06': 3,
  '07': 4, '86': 4, '85': 3, '55': 5, '56': 6, '35': 3, '36': 3,
};
const MULT_PORTE: Record<string, number> = {
  'MICRO': 3, 'PEQUENO': 5, 'DEMAIS': 8, 'GRANDE': 10,
};

function estimarFaturamentoMensal(capitalSocial: number, cnae: number, porte: string): number {
  const cnaePrefix = String(cnae).substring(0, 2);
  const cnaeMult = MULT_CNAE[cnaePrefix] || 4;
  const porteMult = Object.entries(MULT_PORTE).find(([k]) => (porte || '').toUpperCase().includes(k))?.[1] || 4;
  return Math.round((capitalSocial * cnaeMult * (porteMult / 4)) / 12);
}

// Gerador de CNPJs válidos por UF (baseado em faixas conhecidas)
// Prioriza grandes centros econômicos
const UF_PRIORITY = [
  'SP', 'RJ', 'MG', 'PR', 'RS', 'SC', 'BA', 'GO', 'DF', 'PE',
  'CE', 'PA', 'MA', 'MT', 'MS', 'ES', 'AM', 'RN', 'PB', 'AL',
  'SE', 'PI', 'TO', 'RO', 'AC', 'AP', 'RR',
];

function gerarCnpjAleatorio(): string {
  // Gera um CNPJ base aleatório (8 dígitos raiz + 0001 filial)
  const raiz = Math.floor(Math.random() * 99999999).toString().padStart(8, '0');
  const base = raiz + '0001';
  // Calcula dígitos verificadores
  const pesos1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const pesos2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  let soma = 0;
  for (let i = 0; i < 12; i++) soma += parseInt(base[i]) * pesos1[i];
  const d1 = soma % 11 < 2 ? 0 : 11 - (soma % 11);
  const base13 = base + d1;
  soma = 0;
  for (let i = 0; i < 13; i++) soma += parseInt(base13[i]) * pesos2[i];
  const d2 = soma % 11 < 2 ? 0 : 11 - (soma % 11);
  return base13 + d2;
}

// CNAEs tipicamente envolvidos em operações internacionais
const CNAES_INTERNACIONAIS = [
  4611, 4612, 4613, 4614, 4615, 4616, 4617, 4618, 4619, // Comércio atacadista
  4921, 4922, 4923, 4924, 4929, 4930, // Transporte
  5011, 5012, 5021, 5022, 5030, // Navegação / transporte aquaviário
  5111, 5112, 5120, // Transporte aéreo
  6421, 6422, 6423, 6424, 6431, 6432, 6433, 6434, 6435, 6436, 6437, 6438, 6440, // Financeiro
  6550, // Planos de saúde (grandes)
  7020, 7111, 7112, 7119, 7120, // Consultoria / engenharia
  6201, 6202, 6203, 6204, 6209, // Tecnologia
  2011, 2012, 2013, 2014, 2019, 2021, 2022, 2029, 2031, 2032, 2033, 2040, 2051, 2052, 2061, 2062, 2063, 2071, 2072, 2073, 2091, 2092, 2093, 2094, 2099, // Indústria química
  1011, 1012, 1013, 1020, 1031, 1032, 1033, 1041, 1042, 1043, 1051, 1052, 1053, 1061, 1062, 1063, 1064, 1065, 1066, 1069, 1071, 1072, // Alimentos
  500, 510, 600, 700, 800, 900, 1000, // Agricultura / mineração
];


// Renders text with markdown links [text](url) as clickable <a> tags
function RenderLinkedItem({ text, emoji, variant }: { text: string; emoji: string; variant: 'accent' | 'success' | 'destructive' | 'muted' }) {
  const variantStyles = {
    accent: 'border-accent/20 bg-accent/5',
    success: 'border-[hsl(153,100%,39%)]/20 bg-[hsl(153,100%,39%)]/5',
    destructive: 'border-destructive/30 bg-destructive/5 text-destructive',
    muted: 'border-border bg-muted/30',
  };

  // Parse markdown links [text](url)
  const parts = text.split(/(\[[^\]]+\]\([^)]+\))/g);
  
  return (
    <div className={`text-xs p-2.5 rounded-lg border ${variantStyles[variant]} leading-relaxed`}>
      {emoji}{' '}
      {parts.map((part, i) => {
        const linkMatch = part.match(/\[([^\]]+)\]\(([^)]+)\)/);
        if (linkMatch) {
          return (
            <a
              key={i}
              href={linkMatch[2]}
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent underline underline-offset-2 hover:text-accent/80 transition-colors font-medium"
            >
              {linkMatch[1]} <ExternalLink className="inline h-2.5 w-2.5" />
            </a>
          );
        }
        // Also handle raw URLs
        const urlParts = part.split(/(https?:\/\/[^\s)]+)/g);
        return urlParts.map((urlPart, j) => {
          if (urlPart.match(/^https?:\/\//)) {
            return (
              <a
                key={`${i}-${j}`}
                href={urlPart}
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent underline underline-offset-2 hover:text-accent/80 transition-colors font-medium break-all"
              >
                {urlPart.length > 60 ? urlPart.substring(0, 60) + '...' : urlPart}
              </a>
            );
          }
          return <span key={`${i}-${j}`}>{urlPart}</span>;
        });
      })}
    </div>
  );
}

interface CreditoInternacionalScore {
  score: number; // 0-100
  nivel: "alto" | "medio" | "baixo" | "muito_baixo";
  cor: string;
  decisores: number;
  fatores: string[];
}

function calcularPotencialCreditoInternacional(empresa: CnpjData): CreditoInternacionalScore {
  let score = 0;
  const fatores: string[] = [];

  // 1. Capital Social (0-25 pts)
  if (empresa.capital_social >= 100_000_000) { score += 25; fatores.push("Capital > R$100M"); }
  else if (empresa.capital_social >= 10_000_000) { score += 20; fatores.push("Capital > R$10M"); }
  else if (empresa.capital_social >= 1_000_000) { score += 12; fatores.push("Capital > R$1M"); }
  else if (empresa.capital_social >= 100_000) { score += 5; fatores.push("Capital > R$100K"); }

  // 2. Porte da empresa (0-15 pts)
  const porte = (empresa.porte || "").toUpperCase();
  if (porte.includes("GRANDE") || porte.includes("DEMAIS")) { score += 15; fatores.push("Grande porte"); }
  else if (porte.includes("MEDIO") || porte.includes("MÉDIA")) { score += 10; fatores.push("Médio porte"); }
  else if (porte.includes("PEQUENO")) { score += 4; fatores.push("Pequeno porte"); }

  // 3. CNAE relevante para internacionalização (0-20 pts)
  const cnaeNum = Number(String(empresa.cnae_fiscal).substring(0, 4));
  if (CNAES_INTERNACIONAIS.some(c => String(cnaeNum).startsWith(String(c).substring(0, 2)))) {
    score += 20;
    fatores.push("CNAE com perfil internacional");
  } else if (empresa.cnae_fiscal_descricao?.toLowerCase().match(/export|import|internacional|exterior|cambio|câmbio|comércio exterior/)) {
    score += 20;
    fatores.push("Descrição sugere atuação internacional");
  }

  // 4. Quadro societário robusto (0-15 pts) - mais sócios = mais decisores
  const numSocios = empresa.qsa?.length || 0;
  if (numSocios >= 5) { score += 15; fatores.push(`${numSocios} sócios no QSA`); }
  else if (numSocios >= 3) { score += 10; fatores.push(`${numSocios} sócios no QSA`); }
  else if (numSocios >= 1) { score += 5; fatores.push(`${numSocios} sócio(s) no QSA`); }

  // 5. Qualificação dos sócios - diretores/administradores = decisores (0-15 pts)
  const qualificacoesDecisoras = ["ADMINISTRADOR", "DIRETOR", "PRESIDENTE", "SÓCIO-ADMINISTRADOR", "PROCURADOR"];
  const decisores = (empresa.qsa || []).filter(s =>
    qualificacoesDecisoras.some(q => s.qualificacao_socio?.toUpperCase().includes(q))
  );
  if (decisores.length >= 3) { score += 15; fatores.push(`${decisores.length} decisores-chave`); }
  else if (decisores.length >= 1) { score += 8; fatores.push(`${decisores.length} decisor(es)-chave`); }

  // 6. Empresa ativa (0-5 pts)
  if (empresa.situacao_cadastral === "ATIVA") { score += 5; fatores.push("Empresa ativa"); }

  // 7. Tempo de mercado (0-5 pts)
  if (empresa.data_inicio_atividade) {
    const anos = (new Date().getFullYear()) - new Date(empresa.data_inicio_atividade).getFullYear();
    if (anos >= 10) { score += 5; fatores.push(`${anos} anos de mercado`); }
    else if (anos >= 5) { score += 3; fatores.push(`${anos} anos de mercado`); }
  }

  // Normalizar score para 0-100
  score = Math.min(100, score);

  let nivel: CreditoInternacionalScore["nivel"];
  let cor: string;
  if (score >= 70) { nivel = "alto"; cor = "text-green-600"; }
  else if (score >= 45) { nivel = "medio"; cor = "text-yellow-600"; }
  else if (score >= 25) { nivel = "baixo"; cor = "text-orange-500"; }
  else { nivel = "muito_baixo"; cor = "text-red-500"; }

  return { score, nivel, cor, decisores: decisores.length, fatores };
}

// Save empresa to database
async function saveEmpresaToDb(empresa: CnpjData) {
  try {
    await supabase.from("empresas_cache").upsert(
      { cnpj: empresa.cnpj, data: empresa as any },
      { onConflict: "cnpj" }
    );
  } catch (err) {
    console.error("Erro salvando no banco:", err);
  }
}

// Load all cached empresas from database
async function loadEmpresasFromDb(): Promise<CnpjData[]> {
  const { data, error } = await supabase
    .from("empresas_cache")
    .select("cnpj, data")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Erro carregando do banco:", error);
    return [];
  }
  return (data || []).map((row: any) => row.data as CnpjData);
}

export default function Empresas() {
  const [empresas, setEmpresas] = useState<CnpjData[]>([]);
  const [selectedEmpresa, setSelectedEmpresa] = useState<CnpjData | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [currentSearch, setCurrentSearch] = useState<string | null>(null);
  const [searchMode, setSearchMode] = useState<'pool' | 'discovery'>('pool');
  const [discoveryStats, setDiscoveryStats] = useState({ tentativas: 0, encontradas: 0 });
  const [filterText, setFilterText] = useState("");
  const [filterCapitalMin, setFilterCapitalMin] = useState("");
  const [filterIf, setFilterIf] = useState("");
  const [cnpjManual, setCnpjManual] = useState("");
  const [isManualLoading, setIsManualLoading] = useState(false);
  const [dbLoaded, setDbLoaded] = useState(false);
  const [sortByRanking, setSortByRanking] = useState(true);
  const [batches, setBatches] = useState<{ id: string; nome: string; total_empresas: number; created_at: string }[]>([]);
  const [selectedBatch, setSelectedBatch] = useState<string | null>(null);
  const [batchContacts, setBatchContacts] = useState<Map<string, { telefone: string | null; email: string | null; contato_nome: string | null; cargo: string | null; nome_empresa: string | null; dados_extras: any; score_potencial: number | null }>>(new Map());
  const [batchCnpjs, setBatchCnpjs] = useState<Set<string>>(new Set());
  const [batchAllContacts, setBatchAllContacts] = useState<{ cnpj: string; telefone: string | null; email: string | null; contato_nome: string | null; cargo: string | null; nome_empresa: string | null; dados_extras: any; score_potencial: number | null }[]>([]);
  const [batchViewMode, setBatchViewMode] = useState<'table' | 'cards'>('table');
  const queueRef = useRef<string[]>([]);
  const fetchedRef = useRef<Set<string>>(new Set());
  const poolExhaustedRef = useRef(false);

  // Load from database on mount
  useEffect(() => {
    loadEmpresasFromDb().then((cached) => {
      if (cached.length > 0) {
        setEmpresas(cached);
        fetchedRef.current = new Set(cached.map(e => e.cnpj));
      }
      setDbLoaded(true);
    });
  }, []);

  // Load analyzed CNPJs
  const [analyzedCnpjs, setAnalyzedCnpjs] = useState<Map<string, { score: number | null; status: string; rating: string | null }>>(new Map());
  useEffect(() => {
    supabase.from("internationalization_analyses")
      .select("cnpj, overall_score, status, risk_classification")
      .then(({ data }) => {
        if (data) {
          const map = new Map<string, { score: number | null; status: string; rating: string | null }>();
          data.forEach((r: any) => map.set(r.cnpj, { score: r.overall_score, status: r.status, rating: r.risk_classification }));
          setAnalyzedCnpjs(map);
        }
      });
  }, []);

  // Load batches and contacts
  const loadBatches = useCallback(async () => {
    const { data } = await supabase.from("upload_batches").select("id, nome, total_empresas, created_at").order("created_at", { ascending: false });
    if (data) setBatches(data as any);
  }, []);

  const loadBatchContacts = useCallback(async (batchId: string | null) => {
    if (!batchId) { setBatchContacts(new Map()); setBatchCnpjs(new Set()); setBatchAllContacts([]); return; }
    const { data } = await supabase.from("empresa_contacts").select("cnpj, telefone, email, contato_nome, cargo, nome_empresa, dados_extras, score_potencial").eq("batch_id", batchId);
    if (data) {
      const contacts = new Map<string, { telefone: string | null; email: string | null; contato_nome: string | null; cargo: string | null; nome_empresa: string | null; dados_extras: any; score_potencial: number | null }>();
      const cnpjs = new Set<string>();
      data.forEach((r: any) => { contacts.set(r.cnpj, r); cnpjs.add(r.cnpj); });
      setBatchContacts(contacts);
      setBatchCnpjs(cnpjs);
      const sorted = [...data].sort((a, b) => (b.score_potencial || 0) - (a.score_potencial || 0));
      setBatchAllContacts(sorted as any);
    }
  }, []);

  useEffect(() => { loadBatches(); }, [loadBatches]);
  useEffect(() => { loadBatchContacts(selectedBatch); }, [selectedBatch, loadBatchContacts]);

  // Auto-load financial institutions
  const ifQuery = useQuery({
    queryKey: ["if-all"],
    queryFn: fetchAllInstituicoesFinanceiras,
    staleTime: 10 * 60 * 1000,
  });

  const filteredIfs = ifQuery.data?.filter((item) =>
    !filterIf || item.nomeIf.toLowerCase().includes(filterIf.toLowerCase()) ||
    item.cnpj.includes(filterIf)
  );

  // Busca do pool fixo
  const fetchFromPool = useCallback(async () => {
    if (queueRef.current.length === 0) {
      const remaining = CNPJS_POOL_UNIQUE.filter(c => !fetchedRef.current.has(c));
      if (remaining.length === 0) {
        poolExhaustedRef.current = true;
        setSearchMode('discovery');
        return;
      }
      queueRef.current = shuffleArray(remaining);
    }

    const cnpj = queueRef.current.pop()!;
    fetchedRef.current.add(cnpj);
    setCurrentSearch(cnpj);

    try {
      const data = await fetchCnpj(cnpj);
      setEmpresas(prev => {
        const exists = prev.find(e => e.cnpj === data.cnpj);
        if (exists) return prev;
        return [data, ...prev];
      });
      saveEmpresaToDb(data);
    } catch (err) {
      console.error("Erro buscando CNPJ:", cnpj, err);
    }
    setCurrentSearch(null);
  }, []);

  // Descoberta de novos CNPJs aleatórios (varredura Brasil)
  const fetchDiscovery = useCallback(async () => {
    const cnpj = gerarCnpjAleatorio();
    if (fetchedRef.current.has(cnpj)) return;
    fetchedRef.current.add(cnpj);
    setCurrentSearch(cnpj);
    setDiscoveryStats(prev => ({ ...prev, tentativas: prev.tentativas + 1 }));

    try {
      const data = await fetchCnpj(cnpj);
      setEmpresas(prev => {
        const exists = prev.find(e => e.cnpj === data.cnpj);
        if (exists) return prev;
        return [data, ...prev];
      });
      saveEmpresaToDb(data);
      setDiscoveryStats(prev => ({ ...prev, encontradas: prev.encontradas + 1 }));
    } catch {
      // 404 = CNPJ não existe, normal na varredura
    }
    setCurrentSearch(null);
  }, []);

  useEffect(() => {
    if (!isRunning || !dbLoaded) return;

    if (!poolExhaustedRef.current) {
      fetchFromPool();
      const interval = setInterval(fetchFromPool, SEARCH_INTERVAL);
      return () => clearInterval(interval);
    } else {
      // Modo descoberta: busca mais rápida com CNPJs aleatórios
      fetchDiscovery();
      const interval = setInterval(fetchDiscovery, DISCOVERY_INTERVAL);
      return () => clearInterval(interval);
    }
  }, [isRunning, dbLoaded, searchMode, fetchFromPool, fetchDiscovery]);

  const capitalMinNum = filterCapitalMin ? parseFloat(filterCapitalMin.replace(/\D/g, "")) : 0;

  const filteredEmpresas = useMemo(() => {
    let result = empresas.filter(e => {
      // Text filter
      if (filterText && !(
        e.razao_social.toLowerCase().includes(filterText.toLowerCase()) ||
        (e.nome_fantasia && e.nome_fantasia.toLowerCase().includes(filterText.toLowerCase())) ||
        e.cnpj.includes(filterText.replace(/\D/g, ""))
      )) return false;
      // Capital filter
      if (capitalMinNum > 0 && e.capital_social < capitalMinNum) return false;
      // Batch filter
      if (selectedBatch && !batchCnpjs.has(e.cnpj) && !batchCnpjs.has(e.cnpj.replace(/\D/g, ""))) return false;
      return true;
    });

    // Sort by ranking (potencial de crédito internacional)
    if (sortByRanking) {
      result = [...result].sort((a, b) => {
        const scoreA = calcularPotencialCreditoInternacional(a).score;
        const scoreB = calcularPotencialCreditoInternacional(b).score;
        return scoreB - scoreA;
      });
    }

    return result;
  }, [empresas, filterText, capitalMinNum, selectedBatch, batchCnpjs, sortByRanking]);

  const formatCurrency = (val: number) =>
    val.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

  const formatCompact = (val: number) => {
    if (val >= 1_000_000_000) return `R$ ${(val / 1_000_000_000).toFixed(1).replace('.0', '')}B`;
    if (val >= 1_000_000) return `R$ ${(val / 1_000_000).toFixed(1).replace('.0', '')}M`;
    if (val >= 1_000) return `R$ ${(val / 1_000).toFixed(0)}K`;
    return `R$ ${val}`;
  };

  const formatCnpj = (val: string) =>
    val.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border/60 bg-card sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center gap-4">
          <Link to="/">
            <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-foreground">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div className="bg-primary rounded-lg p-2.5 shadow-sm">
            <Building2 className="h-5 w-5 text-primary-foreground" />
          </div>
          <div className="flex-1">
            <h1 className="text-lg font-bold text-foreground tracking-tight">Empresas & Capital</h1>
            <p className="text-[11px] text-muted-foreground font-medium uppercase tracking-[0.12em]">
              {searchMode === 'pool' ? 'Pool inicial' : 'Varredura Brasil'} · {empresas.length} empresas
              {searchMode === 'discovery' && discoveryStats.tentativas > 0 && (
                <span className="ml-1">· {discoveryStats.encontradas}/{discoveryStats.tentativas} descobertas</span>
              )}
            </p>
          </div>
          <Button
            variant={isRunning ? "destructive" : "default"}
            size="sm"
            onClick={() => setIsRunning(!isRunning)}
            className="gap-2 font-semibold text-xs shadow-sm"
          >
            {isRunning ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            {isRunning ? "Pausar" : "Retomar"}
          </Button>
          <Link to="/internacionalizacao/analise">
            <Button variant="outline" size="sm" className="gap-2 text-xs font-semibold border-border/60">
              <Globe className="h-4 w-4" />
              Análise ACI
            </Button>
          </Link>
        </div>
        {isRunning && currentSearch && (
          <div className="border-t border-border/40 bg-primary/3 px-6 py-1.5">
            <div className="max-w-7xl mx-auto flex items-center gap-2 text-xs text-muted-foreground font-medium">
              <Loader2 className="h-3 w-3 animate-spin text-accent" />
              {searchMode === 'discovery' ? 'Varredura' : 'Pool'}: CNPJ {formatCnpj(currentSearch)}...
            </div>
          </div>
        )}
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8">
        {selectedEmpresa ? (
          <EmpresaDetail empresa={selectedEmpresa} onBack={() => setSelectedEmpresa(null)} formatCurrency={formatCurrency} formatCompact={formatCompact} formatCnpj={formatCnpj} />
        ) : (
          <Tabs defaultValue="empresas" className="space-y-6">
            <TabsList className="grid w-full max-w-md grid-cols-2">
              <TabsTrigger value="empresas" className="gap-2">
                <Building2 className="h-4 w-4" />
                Empresas ({empresas.length})
              </TabsTrigger>
              <TabsTrigger value="if" className="gap-2">
                <Landmark className="h-4 w-4" />
                Inst. Financeiras
              </TabsTrigger>
            </TabsList>

            <TabsContent value="empresas" className="space-y-4">
              {/* Manual CNPJ search */}
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  const cleaned = cnpjManual.replace(/\D/g, "");
                  if (cleaned.length !== 14) return;
                  setIsManualLoading(true);
                  try {
                    const data = await fetchCnpj(cleaned);
                    setEmpresas(prev => {
                      const exists = prev.find(emp => emp.cnpj === data.cnpj);
                      if (exists) return prev;
                      return [data, ...prev];
                    });
                    setSelectedEmpresa(data);
                    saveEmpresaToDb(data);
                    setCnpjManual("");
                  } catch (err) {
                    console.error("Erro buscando CNPJ manual:", err);
                  } finally {
                    setIsManualLoading(false);
                  }
                }}
                className="flex gap-2"
              >
                <Input
                  placeholder="Digitar CNPJ (ex: 00.000.000/0001-91)"
                  value={cnpjManual}
                  onChange={(e) => setCnpjManual(e.target.value)}
                  className="max-w-xs"
                />
                <Button type="submit" disabled={cnpjManual.replace(/\D/g, "").length !== 14 || isManualLoading}>
                  {isManualLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                  <span className="ml-2">Buscar CNPJ</span>
                </Button>
              </form>

              {/* Planilha upload */}
              <PlanilhaUpload
                onEmpresaFound={(empresa) => {
                  setEmpresas(prev => {
                    if (prev.find(e => e.cnpj === empresa.cnpj)) return prev;
                    return [empresa, ...prev];
                  });
                }}
                onSaveEmpresa={saveEmpresaToDb}
                onBatchComplete={() => loadBatches()}
              />

              <div className="flex items-center gap-3 flex-wrap">
                <div className="relative flex-1 max-w-sm">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Filtrar empresas..."
                    value={filterText}
                    onChange={(e) => setFilterText(e.target.value)}
                    className="pl-9"
                  />
                  {filterText && (
                    <button onClick={() => setFilterText("")} className="absolute right-3 top-1/2 -translate-y-1/2">
                      <X className="h-4 w-4 text-muted-foreground" />
                    </button>
                  )}
                </div>
                <div className="relative max-w-[200px]">
                  <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    type="text"
                    placeholder="Capital mínimo (R$)"
                    value={filterCapitalMin}
                    onChange={(e) => {
                      const raw = e.target.value.replace(/\D/g, "");
                      if (!raw) { setFilterCapitalMin(""); return; }
                      setFilterCapitalMin(Number(raw).toLocaleString("pt-BR"));
                    }}
                    className="pl-9"
                  />
                  {filterCapitalMin && (
                    <button onClick={() => setFilterCapitalMin("")} className="absolute right-3 top-1/2 -translate-y-1/2">
                      <X className="h-4 w-4 text-muted-foreground" />
                    </button>
                  )}
                </div>
                {isRunning && (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="relative flex h-2 w-2">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-primary"></span>
                    </span>
                    {searchMode === 'discovery' ? '🔍 Varredura Brasil ativa' : 'Buscando pool...'}
                  </div>
                )}
              </div>

              {/* Categorias / Batches como pastas */}
              {batches.length > 0 && !selectedBatch && (
                <div className="space-y-2">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">📁 Planilhas importadas</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {batches.map(b => (
                      <Card
                        key={b.id}
                        className="cursor-pointer hover:shadow-md hover:border-primary/30 transition-all"
                        onClick={() => setSelectedBatch(b.id)}
                      >
                        <CardContent className="p-4 flex items-center gap-3">
                          <div className="bg-accent rounded-lg p-2">
                            <FileText className="h-5 w-5 text-accent-foreground" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">{b.nome}</p>
                            <p className="text-xs text-muted-foreground">{b.total_empresas} empresas · {new Date(b.created_at).toLocaleDateString("pt-BR")}</p>
                          </div>
                          <Badge variant="secondary" className="text-xs shrink-0">Ver ranking →</Badge>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                </div>
              )}

              {/* Batch selected = pasta aberta */}
              {selectedBatch && (
                <div className="space-y-3">
                  <div className="flex items-center gap-3 flex-wrap">
                    <Button variant="ghost" size="sm" onClick={() => setSelectedBatch(null)} className="gap-1.5">
                      <ArrowLeft className="h-3.5 w-3.5" />
                      Voltar
                    </Button>
                    <div className="flex items-center gap-2 flex-1">
                      <FileText className="h-4 w-4 text-primary" />
                      <span className="text-sm font-semibold">{batches.find(b => b.id === selectedBatch)?.nome}</span>
                      <Badge variant="secondary" className="text-xs">
                        {batchAllContacts.length} contatos
                      </Badge>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Button
                        variant={batchViewMode === 'table' ? 'default' : 'outline'}
                        size="sm"
                        onClick={() => setBatchViewMode('table')}
                        className="gap-1.5 text-xs"
                      >
                        <BarChart3 className="h-3.5 w-3.5" />
                        Tabela
                      </Button>
                      <Button
                        variant={batchViewMode === 'cards' ? 'default' : 'outline'}
                        size="sm"
                        onClick={() => setBatchViewMode('cards')}
                        className="gap-1.5 text-xs"
                      >
                        <Building2 className="h-3.5 w-3.5" />
                        Cards
                      </Button>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1.5 text-xs"
                      onClick={() => {
                        const rows = batchAllContacts.map((c, idx) => ({
                          ranking: idx + 1,
                          empresa: c.nome_empresa || "",
                          cnpj: c.cnpj,
                          telefone: c.telefone || "",
                          email: c.email || "",
                          contato: c.contato_nome || "",
                          cargo: c.cargo || "",
                        }));
                        const headers = Object.keys(rows[0] || {});
                        const csvContent = [
                          headers.join(";"),
                          ...rows.map(r => headers.map(h => `"${(r as any)[h] ?? ""}"`).join(";"))
                        ].join("\n");
                        const blob = new Blob(["\uFEFF" + csvContent], { type: "text/csv;charset=utf-8;" });
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement("a");
                        a.href = url;
                        a.download = `ranking-${batches.find(b => b.id === selectedBatch)?.nome || "planilha"}.csv`;
                        a.click();
                        URL.revokeObjectURL(url);
                      }}
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                      Exportar CSV
                    </Button>
                    <Button
                      variant={sortByRanking ? "default" : "outline"}
                      size="sm"
                      onClick={() => setSortByRanking(!sortByRanking)}
                      className="gap-1.5 text-xs"
                    >
                      <TrendingUp className="h-3.5 w-3.5" />
                      {sortByRanking ? "🏆 Ranking" : "Ranking"}
                    </Button>
                  </div>

                  {/* TABLE VIEW */}
                  {batchViewMode === 'table' && (
                    <Card>
                      <CardContent className="p-0">
                        <div className="overflow-auto max-h-[70vh]">
                          <Table>
                            <TableHeader>
                              <TableRow className="bg-muted/50">
                                <TableHead className="w-12 text-center">#</TableHead>
                                <TableHead>Empresa</TableHead>
                                <TableHead>CNPJ</TableHead>
                                <TableHead>Contato</TableHead>
                                <TableHead>WhatsApp / Telefone</TableHead>
                                <TableHead>Email</TableHead>
                                <TableHead className="text-center">Score</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {[...batchAllContacts].map((contact) => {
                                const empresa = empresas.find(e => e.cnpj === contact.cnpj || e.cnpj.replace(/\D/g, "") === contact.cnpj.replace(/\D/g, ""));
                                const score = empresa ? calcularPotencialCreditoInternacional(empresa) : null;
                                const scoreVal = score?.score ?? contact.score_potencial ?? 0;
                                return { contact, empresa, scoreVal };
                              }).sort((a, b) => b.scoreVal - a.scoreVal).map(({ contact, empresa, scoreVal }, idx) => {
                                return (
                                  <TableRow
                                    key={contact.cnpj + idx}
                                    className="cursor-pointer hover:bg-muted/30"
                                    onClick={() => {
                                      if (empresa) setSelectedEmpresa(empresa);
                                    }}
                                  >
                                    <TableCell className="text-center font-bold text-muted-foreground">{idx + 1}</TableCell>
                                    <TableCell>
                                      <div>
                                        <p className="text-sm font-medium truncate max-w-[200px]">{contact.nome_empresa || empresa?.razao_social || "—"}</p>
                                        {contact.cargo && <p className="text-xs text-muted-foreground">{contact.cargo}</p>}
                                      </div>
                                    </TableCell>
                                    <TableCell className="text-xs font-mono text-muted-foreground">{contact.cnpj}</TableCell>
                                    <TableCell>
                                      {contact.contato_nome ? (
                                        <Badge variant="outline" className="gap-1 text-xs">
                                          <Users className="h-2.5 w-2.5" />
                                          {contact.contato_nome}
                                        </Badge>
                                      ) : "—"}
                                    </TableCell>
                                    <TableCell>
                                      {contact.telefone ? (
                                        <a
                                          href={`https://wa.me/55${contact.telefone.replace(/\D/g, "").slice(0, 11)}`}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          onClick={(e) => e.stopPropagation()}
                                          className="inline-flex items-center gap-1.5 text-xs font-medium text-green-700 hover:underline"
                                        >
                                          <MessageCircle className="h-3.5 w-3.5" />
                                          {contact.telefone}
                                        </a>
                                      ) : (
                                        <span className="text-xs text-muted-foreground">—</span>
                                      )}
                                    </TableCell>
                                    <TableCell>
                                      {contact.email ? (
                                        <a
                                          href={`mailto:${contact.email}`}
                                          onClick={(e) => e.stopPropagation()}
                                          className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
                                        >
                                          <Mail className="h-3.5 w-3.5" />
                                          {contact.email}
                                        </a>
                                      ) : (
                                        <span className="text-xs text-muted-foreground">—</span>
                                      )}
                                    </TableCell>
                                    <TableCell className="text-center">
                                      <span className={`text-sm font-bold ${scoreVal >= 70 ? 'text-green-600' : scoreVal >= 45 ? 'text-yellow-600' : scoreVal >= 25 ? 'text-orange-500' : 'text-red-500'}`}>
                                        {scoreVal}%
                                      </span>
                                    </TableCell>
                                  </TableRow>
                                );
                              })}
                            </TableBody>
                          </Table>
                        </div>
                      </CardContent>
                    </Card>
                  )}
                </div>
              )}

              {/* Ranking toggle quando não tem batch selecionado */}
              {!selectedBatch && (
                <div className="flex items-center gap-2">
                  <Button
                    variant={sortByRanking ? "default" : "outline"}
                    size="sm"
                    onClick={() => setSortByRanking(!sortByRanking)}
                    className="gap-1.5 text-xs"
                  >
                    <TrendingUp className="h-3.5 w-3.5" />
                    {sortByRanking ? "🏆 Ranking ativo" : "Ranking"}
                  </Button>
                  <span className="text-xs text-muted-foreground">{filteredEmpresas.length} empresas</span>
                </div>
              )}

              {/* Hide cards grid when batch table view is active */}
              {selectedBatch && batchViewMode === 'table' ? null : filteredEmpresas.length === 0 && empresas.length === 0 ? (
                <div className="flex flex-col items-center gap-3 py-12">
                  <Loader2 className="h-8 w-8 animate-spin text-primary" />
                  <p className="text-muted-foreground">Buscando empresas automaticamente...</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {filteredEmpresas.map((empresa, idx) => {
                    const credito = calcularPotencialCreditoInternacional(empresa);
                    const aciAnalysis = analyzedCnpjs.get(empresa.cnpj.replace(/\D/g, "")) || analyzedCnpjs.get(empresa.cnpj);
                    return (
                    <Card
                      key={empresa.cnpj}
                      className={`cursor-pointer transition-all hover:shadow-lg hover:-translate-y-0.5 hover:border-primary/30 animate-in fade-in slide-in-from-top-2 duration-500 ${idx < 3 && sortByRanking ? 'ring-2 ring-primary/20 border-primary/40' : ''}`}
                      onClick={() => setSelectedEmpresa(empresa)}
                    >
                      <CardHeader className="pb-2">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-center gap-2 flex-1 min-w-0">
                            {sortByRanking && (
                              <span className={`text-lg font-black shrink-0 ${idx === 0 ? 'text-yellow-500' : idx === 1 ? 'text-gray-400' : idx === 2 ? 'text-amber-600' : 'text-muted-foreground'}`}>
                                #{idx + 1}
                              </span>
                            )}
                            <CardTitle className="text-sm font-medium text-muted-foreground leading-tight truncate">
                              {empresa.nome_fantasia || empresa.razao_social}
                            </CardTitle>
                          </div>
                          {/* Score de chance */}
                          <div className={`shrink-0 flex flex-col items-center rounded-lg px-2 py-1 ${credito.score >= 70 ? 'bg-green-100 dark:bg-green-900/30' : credito.score >= 45 ? 'bg-yellow-100 dark:bg-yellow-900/30' : credito.score >= 25 ? 'bg-orange-100 dark:bg-orange-900/30' : 'bg-red-100 dark:bg-red-900/30'}`}>
                            <span className={`text-lg font-black ${credito.cor}`}>{credito.score}%</span>
                            <span className={`text-[9px] font-bold uppercase ${credito.cor}`}>
                              {credito.nivel === "alto" ? "🔥 TOP" : credito.nivel === "medio" ? "⚡ BOM" : credito.nivel === "baixo" ? "📊 MÉDIO" : "⚠️ BAIXO"}
                            </span>
                          </div>
                        </div>
                        {empresa.nome_fantasia && (
                          <CardDescription className="text-xs truncate">{empresa.razao_social}</CardDescription>
                        )}
                      </CardHeader>
                      <CardContent className="space-y-2">
                        <div className="flex items-center justify-between">
                          <p className="text-lg font-bold text-primary" title={formatCurrency(empresa.capital_social)}>
                            {formatCompact(empresa.capital_social)}
                          </p>
                          <div className="text-right">
                            <p className="text-[10px] text-muted-foreground">Porte</p>
                            <p className="text-xs font-semibold text-accent-foreground">
                              {empresa.porte || '—'}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <Badge variant={empresa.situacao_cadastral === "ATIVA" ? "default" : "destructive"} className="text-xs">
                            {empresa.situacao_cadastral}
                          </Badge>
                          <span className="text-xs text-muted-foreground">{empresa.porte}</span>
                        </div>
                        <p className="text-xs text-muted-foreground truncate">
                          {empresa.municipio}/{empresa.uf}
                        </p>

                        {/* Barra de progresso + decisores */}
                        <div className="pt-1 border-t">
                          <Progress value={credito.score} className="h-1.5" />
                          <div className="flex items-center justify-between mt-1">
                            <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                              <Globe className="h-3 w-3" />
                              Potencial crédito intl.
                            </span>
                            {credito.decisores > 0 && (
                              <span className="text-[10px] text-muted-foreground">
                                {credito.decisores} decisor{credito.decisores > 1 ? "es" : ""}
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Análise ACI indicator */}
                        <div className="pt-1 border-t">
                          {aciAnalysis ? (
                            <div className="flex items-center justify-between">
                              <span className="text-[10px] font-medium flex items-center gap-1 text-emerald-500">
                                <CheckCircle2 className="h-3 w-3" />
                                Análise ACI realizada
                              </span>
                              <div className="flex items-center gap-1.5">
                                {aciAnalysis.rating && aciAnalysis.rating !== "N/A" && (
                                  <Badge variant="outline" className="text-[9px] px-1.5 py-0 h-4 border-emerald-500/50 text-emerald-500">
                                    {aciAnalysis.rating}
                                  </Badge>
                                )}
                                {aciAnalysis.score != null && aciAnalysis.score > 0 && (
                                  <span className="text-[10px] font-bold text-emerald-500">{aciAnalysis.score}pts</span>
                                )}
                              </div>
                            </div>
                          ) : (
                            <div className="flex items-center justify-between">
                              <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                                <XCircle className="h-3 w-3" />
                                Sem análise ACI
                              </span>
                              <Link to="/internacionalizacao/analise" onClick={(e) => e.stopPropagation()}>
                                <Badge variant="outline" className="text-[9px] px-1.5 py-0 h-4 cursor-pointer hover:bg-accent">
                                  Analisar
                                </Badge>
                              </Link>
                            </div>
                          )}
                        </div>
                        {/* Contato direto (planilha + receita) */}
                        <div className="flex flex-wrap gap-1.5 pt-1 border-t">
                          {(() => {
                            const batchContact = batchContacts.get(empresa.cnpj) || batchContacts.get(empresa.cnpj.replace(/\D/g, ""));
                            const emailToShow = batchContact?.email || empresa.email;
                            const phoneToShow = batchContact?.telefone || empresa.ddd_telefone_1;
                            const contactName = batchContact?.contato_nome;
                            const contactCargo = batchContact?.cargo;
                            return (
                              <>
                                {contactName && (
                                  <Badge variant="outline" className="gap-1 text-[10px]">
                                    <Users className="h-2.5 w-2.5" />
                                    {contactName}{contactCargo ? ` · ${contactCargo}` : ""}
                                  </Badge>
                                )}
                                {emailToShow && (
                                  <a href={`mailto:${emailToShow}`} onClick={(e) => e.stopPropagation()} title={emailToShow}>
                                    <Badge variant="secondary" className="gap-1 text-xs cursor-pointer hover:bg-accent">
                                      <Mail className="h-3 w-3" />
                                      Email
                                    </Badge>
                                  </a>
                                )}
                                {phoneToShow && (
                                  <a
                                    href={`https://wa.me/55${phoneToShow.replace(/\D/g, "")}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    onClick={(e) => e.stopPropagation()}
                                    title={phoneToShow}
                                  >
                                    <Badge variant="secondary" className="gap-1 text-xs cursor-pointer hover:bg-accent text-green-700">
                                      <MessageCircle className="h-3 w-3" />
                                      WhatsApp
                                    </Badge>
                                  </a>
                                )}
                                {phoneToShow && (
                                  <a href={`tel:${phoneToShow}`} onClick={(e) => e.stopPropagation()} title={phoneToShow}>
                                    <Badge variant="secondary" className="gap-1 text-xs cursor-pointer hover:bg-accent">
                                      <Phone className="h-3 w-3" />
                                      {phoneToShow}
                                    </Badge>
                                  </a>
                                )}
                              </>
                            );
                          })()}
                        </div>

                        {/* Sócios resumo */}
                        {empresa.qsa && empresa.qsa.length > 0 && (
                          <div className="pt-1 border-t">
                            <p className="text-xs text-muted-foreground flex items-center gap-1 mb-1">
                              <Users className="h-3 w-3" />
                              {empresa.qsa.length} sócio{empresa.qsa.length > 1 ? "s" : ""}
                            </p>
                            <div className="space-y-0.5">
                              {empresa.qsa.slice(0, 3).map((socio, i) => (
                                <p key={i} className="text-xs text-foreground truncate" title={socio.qualificacao_socio}>
                                  {socio.nome_socio}
                                </p>
                              ))}
                              {empresa.qsa.length > 3 && (
                                <p className="text-xs text-muted-foreground">+{empresa.qsa.length - 3} mais...</p>
                              )}
                            </div>
                          </div>
                        )}
                      </CardContent>
                    </Card>
                    );
                  })}
                </div>
              )}
            </TabsContent>

            <TabsContent value="if" className="space-y-4">
              <div className="relative max-w-sm">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Filtrar instituições..."
                  value={filterIf}
                  onChange={(e) => setFilterIf(e.target.value)}
                  className="pl-9"
                />
                {filterIf && (
                  <button onClick={() => setFilterIf("")} className="absolute right-3 top-1/2 -translate-y-1/2">
                    <X className="h-4 w-4 text-muted-foreground" />
                  </button>
                )}
              </div>

              {ifQuery.isLoading ? (
                <div className="space-y-2">
                  {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
                </div>
              ) : filteredIfs && filteredIfs.length > 0 ? (
                <Card>
                  <CardContent className="pt-4">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Instituição</TableHead>
                          <TableHead>CNPJ</TableHead>
                          <TableHead>Segmento</TableHead>
                          <TableHead>Tipo</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredIfs.map((item) => (
                          <TableRow key={item.codigoIf}>
                            <TableCell className="font-medium">{item.nomeIf}</TableCell>
                            <TableCell className="text-xs font-mono">{item.cnpj}</TableCell>
                            <TableCell><Badge variant="secondary">{item.segmento}</Badge></TableCell>
                            <TableCell className="text-sm">{item.tipoInstituicao}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              ) : (
                <p className="text-muted-foreground text-sm">Nenhuma instituição encontrada.</p>
              )}
            </TabsContent>
          </Tabs>
        )}
      </main>
    </div>
  );
}

function EmpresaDetail({ empresa, onBack, formatCurrency, formatCompact, formatCnpj }: {
  empresa: CnpjData;
  onBack: () => void;
  formatCurrency: (v: number) => string;
  formatCompact: (v: number) => string;
  formatCnpj: (v: string) => string;
}) {
  const credito = calcularPotencialCreditoInternacional(empresa);
  const [activeTab, setActiveTab] = useState("dados-reais");
  const [portalData, setPortalData] = useState<any>(null);
  const [portalLoading, setPortalLoading] = useState(false);
  const [portalError, setPortalError] = useState<string | null>(null);
  const [dividasData, setDividasData] = useState<any>(null);
  const [dividasLoading, setDividasLoading] = useState(false);
  const [dividasError, setDividasError] = useState<string | null>(null);
  // faturamento removed — using capital social directly
  const [garantiasData, setGarantiasData] = useState<any>(null);
  const [garantiasLoading, setGarantiasLoading] = useState(false);
  const [garantiasError, setGarantiasError] = useState<string | null>(null);
  const [creditoIntData, setCreditoIntData] = useState<any>(null);
  const [creditoIntLoading, setCreditoIntLoading] = useState(false);
  const [creditoIntError, setCreditoIntError] = useState<string | null>(null);
  const [endividamentoData, setEndividamentoData] = useState<any>(null);
  const [endividamentoLoading, setEndividamentoLoading] = useState(false);
  const [endividamentoError, setEndividamentoError] = useState<string | null>(null);
  const [dadosReaisData, setDadosReaisData] = useState<any>(null);
  const [dadosReaisLoading, setDadosReaisLoading] = useState(false);
  const [dadosReaisError, setDadosReaisError] = useState<string | null>(null);

  const buscarPortalTransparencia = async () => {
    setPortalLoading(true);
    setPortalError(null);
    try {
      const { data, error } = await supabase.functions.invoke('portal-transparencia', {
        body: { cnpj: empresa.cnpj },
      });
      if (error) throw new Error(error.message);
      if (!data?.success) throw new Error(data?.error || 'Erro desconhecido');
      setPortalData(data);
    } catch (err: any) {
      setPortalError(err.message);
    } finally {
      setPortalLoading(false);
    }
  };

  const buscarDividas = async () => {
    setDividasLoading(true);
    setDividasError(null);
    try {
      const { data, error } = await supabase.functions.invoke('buscar-dividas', {
        body: { cnpj: empresa.cnpj, razao_social: empresa.razao_social },
      });
      if (error) throw new Error(error.message);
      if (!data?.success) throw new Error(data?.error || 'Erro desconhecido');
      setDividasData(data.dividas);
    } catch (err: any) {
      setDividasError(err.message);
    } finally {
      setDividasLoading(false);
    }
  };

  // buscarFaturamento removed — using capital social directly

  const buscarGarantias = async () => {
    setGarantiasLoading(true);
    setGarantiasError(null);
    try {
      const { data, error } = await supabase.functions.invoke('buscar-garantias', {
        body: {
          cnpj: empresa.cnpj,
          razao_social: empresa.razao_social,
          capital_social: empresa.capital_social,
          porte: empresa.porte,
        },
      });
      if (error) throw new Error(error.message);
      if (!data?.success) throw new Error(data?.error || 'Erro desconhecido');
      setGarantiasData(data);
    } catch (err: any) {
      setGarantiasError(err.message);
    } finally {
      setGarantiasLoading(false);
    }
  };

  const verificarCreditoInternacional = async () => {
    setCreditoIntLoading(true);
    setCreditoIntError(null);
    try {
      const { data, error } = await supabase.functions.invoke('verificar-credito-internacional', {
        body: { cnpj: empresa.cnpj, razao_social: empresa.razao_social },
      });
      if (error) throw new Error(error.message);
      if (!data?.success) throw new Error(data?.error || 'Erro desconhecido');
      setCreditoIntData(data);
    } catch (err: any) {
      setCreditoIntError(err.message);
    } finally {
      setCreditoIntLoading(false);
    }
  };

  // Auto-trigger ALL searches on mount
  useEffect(() => {
    verificarCreditoInternacional();
    // buscarFaturamento removed
    buscarDividas();
    buscarPortalTransparencia();
    buscarGarantias();
    buscarEndividamentoBancario();
    buscarDadosReais();
  }, []);

  const buscarDadosReais = async () => {
    setDadosReaisLoading(true);
    setDadosReaisError(null);
    try {
      const { data, error } = await supabase.functions.invoke('buscar-dados-reais', {
        body: {
          cnpj: empresa.cnpj,
          razao_social: empresa.razao_social,
          capital_social: empresa.capital_social,
          porte: empresa.porte,
          cnae_fiscal: empresa.cnae_fiscal,
        },
      });
      if (error) throw new Error(error.message);
      if (!data?.success) throw new Error(data?.error || 'Erro desconhecido');
      setDadosReaisData(data);
    } catch (err: any) {
      setDadosReaisError(err.message);
    } finally {
      setDadosReaisLoading(false);
    }
  };

  // Progress tracking
  const searches = [
    { label: 'Dados Reais', loading: dadosReaisLoading, done: !!dadosReaisData, error: !!dadosReaisError, icon: '🔍' },
    { label: 'Crédito Internacional', loading: creditoIntLoading, done: !!creditoIntData, error: !!creditoIntError, icon: '🌐' },
    { label: 'Capital Social', loading: false, done: true, error: false, icon: '💰' },
    { label: 'Dívidas', loading: dividasLoading, done: !!dividasData, error: !!dividasError, icon: '💰' },
    { label: 'Transparência', loading: portalLoading, done: !!portalData, error: !!portalError, icon: '⚖️' },
    { label: 'Garantias', loading: garantiasLoading, done: !!garantiasData, error: !!garantiasError, icon: '🛡️' },
    { label: 'Endividamento', loading: endividamentoLoading, done: !!endividamentoData, error: !!endividamentoError, icon: '🏦' },
  ];
  const completedCount = searches.filter(s => s.done || s.error).length;
  const allDone = completedCount === searches.length;
  const progressPercent = Math.round((completedCount / searches.length) * 100);

  const buscarEndividamentoBancario = async () => {
    setEndividamentoLoading(true);
    setEndividamentoError(null);
    try {
      const { data, error } = await supabase.functions.invoke('buscar-endividamento-bancario', {
        body: { cnpj: empresa.cnpj, razao_social: empresa.razao_social },
      });
      if (error) throw new Error(error.message);
      if (!data?.success) throw new Error(data?.error || 'Erro desconhecido');
      setEndividamentoData(data);
    } catch (err: any) {
      setEndividamentoError(err.message);
    } finally {
      setEndividamentoLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* COMPANY HEADER - moved to top */}
      <Card>
        <CardHeader>
          <div className="flex items-start gap-3">
            <Button variant="ghost" size="icon" onClick={onBack}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div className="flex-1 flex items-start justify-between">
              <div>
                <CardTitle className="text-xl">{empresa.razao_social}</CardTitle>
                {empresa.nome_fantasia && (
                  <CardDescription className="text-base mt-1">{empresa.nome_fantasia}</CardDescription>
                )}
              </div>
              <Badge variant={empresa.situacao_cadastral === "ATIVA" ? "default" : "destructive"}>
                {empresa.situacao_cadastral}
              </Badge>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 text-sm">
            <InfoItem label="CNPJ" value={formatCnpj(empresa.cnpj)} />
            <InfoItem label="Capital Social" value={formatCompact(empresa.capital_social)} highlight />
            <InfoItem label="Porte" value={empresa.porte} />
            <InfoItem label="CNAE" value={empresa.cnae_fiscal_descricao} />
            <InfoItem label="Natureza Jurídica" value={empresa.natureza_juridica} />
            <InfoItem label="Início Atividade" value={empresa.data_inicio_atividade} />
            <InfoItem label="Localização" value={`${empresa.municipio}/${empresa.uf}`} />
            {empresa.ddd_telefone_1 && <InfoItem label="Telefone" value={empresa.ddd_telefone_1} />}
          </div>
          {/* Quick contact buttons */}
          <div className="flex flex-wrap gap-2 mt-4 pt-3 border-t">
            {empresa.ddd_telefone_1 && (
              <>
                <a href={`https://wa.me/55${empresa.ddd_telefone_1.replace(/\D/g, "")}`} target="_blank" rel="noopener noreferrer">
                  <Button variant="outline" size="sm" className="gap-1.5 text-green-600 border-green-200 hover:bg-green-50">
                    <MessageCircle className="h-3.5 w-3.5" /> WhatsApp
                  </Button>
                </a>
                <a href={`tel:${empresa.ddd_telefone_1}`}>
                  <Button variant="outline" size="sm" className="gap-1.5">
                    <Phone className="h-3.5 w-3.5" /> Ligar
                  </Button>
                </a>
              </>
            )}
            {empresa.email && (
              <a href={`mailto:${empresa.email}`}>
                <Button variant="outline" size="sm" className="gap-1.5 text-blue-600 border-blue-200 hover:bg-blue-50">
                  <Mail className="h-3.5 w-3.5" /> {empresa.email}
                </Button>
              </a>
            )}
          </div>
        </CardContent>
      </Card>

      {/* PAINEL COMPLETO DA EMPRESA */}
      <Card className="border-0 overflow-hidden shadow-xl relative">
        {/* Header */}
        <div className="px-5 py-4 bg-gradient-to-r from-card to-muted/30 border-b flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center">
              <Building2 className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h3 className="text-base font-bold text-foreground">Visão Completa</h3>
              <p className="text-xs text-muted-foreground">Análise em tempo real · {searches.filter(s => s.done).length}/{searches.length} fontes consultadas</p>
            </div>
          </div>
          {allDone ? (
            <Badge className="bg-[hsl(153,100%,39%)]/15 text-[hsl(153,100%,39%)] border-[hsl(153,100%,39%)]/30 text-xs">
              <CheckCircle2 className="h-3 w-3 mr-1" /> Completo
            </Badge>
          ) : (
            <Badge variant="outline" className="text-xs gap-1.5">
              <Loader2 className="h-3 w-3 animate-spin" /> Analisando...
            </Badge>
          )}
        </div>

        <CardContent className="p-0">
          {/* KPI Grid - 5 colunas */}
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 divide-x divide-y md:divide-y-0 divide-border">
            {/* Capital Social */}
            <div className="p-4 hover:bg-muted/50 transition-colors cursor-pointer" onClick={() => setActiveTab("financeiro")}>
              <div className="flex items-center gap-1.5 mb-1.5">
                <DollarSign className="h-3.5 w-3.5 text-blue-500" />
                <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Capital Social</span>
              </div>
              <p className="text-lg font-black text-foreground">
                {empresa.capital_social
                  ? (empresa.capital_social >= 1e9 ? `R$ ${(empresa.capital_social/1e9).toFixed(1)}B` : empresa.capital_social >= 1e6 ? `R$ ${(empresa.capital_social/1e6).toFixed(1)}M` : empresa.capital_social >= 1e3 ? `R$ ${(empresa.capital_social/1e3).toFixed(0)}K` : `R$ ${empresa.capital_social.toFixed(0)}`)
                  : '—'}
              </p>
              <span className="text-[9px] text-muted-foreground">Receita Federal</span>
            </div>

            {/* Dívidas */}
            <div className="p-4 hover:bg-muted/50 transition-colors cursor-pointer" onClick={() => setActiveTab("compliance")}>
              <div className="flex items-center gap-1.5 mb-1.5">
                <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
                <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Dívidas</span>
              </div>
              {dividasLoading ? <Skeleton className="h-6 w-20" /> : (() => {
                const totalDividas = dividasData ? (Object.values(dividasData) as any[]).reduce((a: number, s: any) => a + (s.encontrados || 0), 0) : 0;
                return <p className={`text-lg font-black ${totalDividas > 0 ? 'text-destructive' : 'text-[hsl(153,100%,39%)]'}`}>{dividasData ? (totalDividas > 0 ? `${totalDividas} registros` : 'Nenhuma') : '—'}</p>;
              })()}
              <span className="text-[9px] text-muted-foreground">PGFN · Protestos · CADIN</span>
            </div>

            {/* Endividamento */}
            <div className="p-4 hover:bg-muted/50 transition-colors cursor-pointer" onClick={() => setActiveTab("financeiro")}>
              <div className="flex items-center gap-1.5 mb-1.5">
                <Landmark className="h-3.5 w-3.5 text-violet-500" />
                <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Endividamento</span>
              </div>
              {endividamentoLoading ? <Skeleton className="h-6 w-20" /> : (
                <p className={`text-lg font-black ${
                  endividamentoData?.nivel === 'nenhum' ? 'text-[hsl(153,100%,39%)]' :
                  endividamentoData?.nivel === 'baixo' ? 'text-blue-600' :
                  endividamentoData?.nivel === 'moderado' ? 'text-amber-600' :
                  endividamentoData?.nivel === 'alto' ? 'text-destructive' : 'text-muted-foreground'
                }`}>
                  {endividamentoData?.nivel ? endividamentoData.nivel.charAt(0).toUpperCase() + endividamentoData.nivel.slice(1) : '—'}
                </p>
              )}
              <span className="text-[9px] text-muted-foreground">SCR / Banco Central</span>
            </div>

            {/* Sanções */}
            <div className="p-4 hover:bg-muted/50 transition-colors cursor-pointer" onClick={() => setActiveTab("compliance")}>
              <div className="flex items-center gap-1.5 mb-1.5">
                <Ban className="h-3.5 w-3.5 text-red-500" />
                <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Sanções</span>
              </div>
              {portalLoading ? <Skeleton className="h-6 w-20" /> : (
                <p className={`text-lg font-black ${(portalData?.resumo?.sancoes?.length || 0) > 0 ? 'text-destructive' : 'text-[hsl(153,100%,39%)]'}`}>
                  {portalData?.resumo ? ((portalData.resumo.sancoes?.length || 0) > 0 ? `${portalData.resumo.sancoes.length} ativas` : 'Regular') : '—'}
                </p>
              )}
              <span className="text-[9px] text-muted-foreground">Portal Transparência</span>
            </div>

            {/* Score */}
            <div className="p-4 hover:bg-muted/50 transition-colors cursor-pointer" onClick={() => setActiveTab("credito")}>
              <div className="flex items-center gap-1.5 mb-1.5">
                <Zap className="h-3.5 w-3.5 text-primary" />
                <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Score</span>
              </div>
              <div className="flex items-baseline gap-1.5">
                <p className={`text-lg font-black ${credito.cor}`}>{credito.score}</p>
                <span className="text-xs text-muted-foreground">/100</span>
              </div>
              <span className="text-[9px] text-muted-foreground">{credito.fatores.length} fatores</span>
            </div>
          </div>

          {/* DÍVIDAS RECENTES - seção actionable */}
          {!dividasLoading && dividasData && (() => {
            const allDividaItems: Array<{ tipo: string; label: string; titulo: string; descricao: string; url: string; fonte: string; valores: string[] }> = [];
            for (const [tipo, section] of Object.entries(dividasData) as [string, any][]) {
              if (section.items && section.items.length > 0) {
                for (const item of section.items.slice(0, 5)) {
                  allDividaItems.push({
                    tipo,
                    label: section.label || tipo,
                    titulo: item.titulo || 'Registro',
                    descricao: item.descricao || '',
                    url: item.url || '',
                    fonte: item.fonte || '',
                    valores: section.valores || [],
                  });
                }
              }
            }
            if (allDividaItems.length === 0) return null;

            // Build chart data by type
            const chartDataMap: Record<string, number> = {};
            for (const [tipo, section] of Object.entries(dividasData) as [string, any][]) {
              if (section.encontrados > 0) {
                chartDataMap[section.label || tipo] = section.encontrados;
              }
            }
            const dividasChartData = Object.entries(chartDataMap).map(([name, value]) => ({ name, value }));
            const DIVIDA_COLORS = ['hsl(0, 72%, 51%)', 'hsl(38, 92%, 50%)', 'hsl(25, 95%, 53%)', 'hsl(280, 67%, 50%)'];

            return (
              <div className="border-t">
                <div className="px-5 py-3 bg-destructive/5 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 text-destructive" />
                    <span className="text-sm font-bold text-foreground">Dívidas & Pendências Recentes</span>
                    <Badge variant="destructive" className="text-[10px]">{allDividaItems.length} encontradas</Badge>
                  </div>
                  <Button variant="ghost" size="sm" className="text-xs gap-1 text-destructive hover:text-destructive" onClick={() => setActiveTab("compliance")}>
                    Ver todas <ChevronRight className="h-3 w-3" />
                  </Button>
                </div>

                {/* Gráfico de Dívidas por Tipo */}
                {dividasChartData.length > 0 && (
                  <div className="px-5 py-4 border-b bg-card/50">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {/* Bar Chart */}
                      <div>
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">Distribuição por Tipo</p>
                        <ResponsiveContainer width="100%" height={160}>
                          <BarChart data={dividasChartData} layout="vertical" margin={{ left: 0, right: 16, top: 4, bottom: 4 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
                            <XAxis type="number" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
                            <YAxis type="category" dataKey="name" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} width={120} />
                            <Tooltip
                              contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 12 }}
                              formatter={(value: number) => [`${value} registros`, 'Quantidade']}
                            />
                            <Bar dataKey="value" radius={[0, 6, 6, 0]} maxBarSize={24}>
                              {dividasChartData.map((_, idx) => (
                                <Cell key={idx} fill={DIVIDA_COLORS[idx % DIVIDA_COLORS.length]} />
                              ))}
                            </Bar>
                          </BarChart>
                        </ResponsiveContainer>
                      </div>

                      {/* Pie Chart */}
                      <div>
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">Proporção</p>
                        <ResponsiveContainer width="100%" height={160}>
                          <PieChart>
                            <Pie
                              data={dividasChartData}
                              dataKey="value"
                              nameKey="name"
                              cx="50%"
                              cy="50%"
                              outerRadius={60}
                              innerRadius={30}
                              strokeWidth={2}
                              stroke="hsl(var(--card))"
                              label={({ name, percent }) => `${name.split(' ')[0]} ${(percent * 100).toFixed(0)}%`}
                            >
                              {dividasChartData.map((_, idx) => (
                                <Cell key={idx} fill={DIVIDA_COLORS[idx % DIVIDA_COLORS.length]} />
                              ))}
                            </Pie>
                            <Tooltip
                              contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 12 }}
                              formatter={(value: number) => [`${value} registros`, 'Quantidade']}
                            />
                          </PieChart>
                        </ResponsiveContainer>
                      </div>
                    </div>

                    {/* Valores monetários encontrados */}
                    {(() => {
                      const allValores = new Set<string>();
                      for (const [, section] of Object.entries(dividasData) as [string, any][]) {
                        (section.valores || []).forEach((v: string) => allValores.add(v));
                      }
                      if (allValores.size === 0) return null;
                      return (
                        <div className="mt-3 flex flex-wrap gap-1.5">
                          <span className="text-[10px] text-muted-foreground font-medium">Valores encontrados:</span>
                          {[...allValores].slice(0, 8).map((v, i) => (
                            <Badge key={i} variant="outline" className="text-[10px] text-destructive border-destructive/30">{v}</Badge>
                          ))}
                        </div>
                      );
                    })()}
                  </div>
                )}

                <div className="divide-y divide-border">
                  {allDividaItems.slice(0, 5).map((item, i) => (
                    <div key={i} className="px-5 py-3 flex items-start gap-3 hover:bg-muted/30 transition-colors">
                      <div className={`mt-0.5 h-8 w-8 rounded-lg flex items-center justify-center flex-shrink-0 ${
                        item.tipo === 'divida_ativa' ? 'bg-red-100 dark:bg-red-950/40' :
                        item.tipo === 'protestos' ? 'bg-amber-100 dark:bg-amber-950/40' :
                        'bg-orange-100 dark:bg-orange-950/40'
                      }`}>
                        {item.tipo === 'divida_ativa' ? <Receipt className="h-4 w-4 text-red-600" /> :
                         item.tipo === 'protestos' ? <FileText className="h-4 w-4 text-amber-600" /> :
                         <Gavel className="h-4 w-4 text-orange-600" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <Badge variant="outline" className="text-[9px] px-1.5 py-0 h-4">{item.label}</Badge>
                          {item.valores.length > 0 && (
                            <span className="text-[10px] font-bold text-destructive">{item.valores[0]}</span>
                          )}
                        </div>
                        <p className="text-xs font-medium text-foreground truncate">{item.titulo}</p>
                        {item.descricao && <p className="text-[11px] text-muted-foreground line-clamp-2 mt-0.5">{item.descricao.substring(0, 120)}</p>}
                      </div>
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        {item.url && (
                          <a href={item.url} target="_blank" rel="noopener noreferrer" className="text-accent hover:text-accent/80">
                            <Button variant="outline" size="sm" className="h-7 text-[10px] gap-1">
                              <ExternalLink className="h-3 w-3" /> Resolver
                            </Button>
                          </a>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}

          {/* Secondary row - Garantias, Crédito Int, Contratos */}
          <div className="border-t bg-muted/20">
            <div className="grid grid-cols-3 divide-x divide-border">
              <div className="px-4 py-3 cursor-pointer hover:bg-muted/50 transition-colors" onClick={() => setActiveTab("garantias")}>
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-muted-foreground font-medium">Garantias</span>
                  {garantiasLoading ? <Skeleton className="h-4 w-16" /> :
                    <span className={`text-xs font-bold ${
                      garantiasData?.estimativa?.capacidadeGarantia === 'alta' ? 'text-[hsl(153,100%,39%)]' :
                      garantiasData?.estimativa?.capacidadeGarantia === 'media' ? 'text-amber-600' :
                      garantiasData?.estimativa?.capacidadeGarantia === 'baixa' ? 'text-destructive' :
                      'text-muted-foreground'
                    }`}>
                      {garantiasData?.estimativa?.capacidadeGarantia
                        ? garantiasData.estimativa.capacidadeGarantia.charAt(0).toUpperCase() + garantiasData.estimativa.capacidadeGarantia.slice(1)
                        : '—'}
                    </span>}
                </div>
              </div>
              <div className="px-4 py-3 cursor-pointer hover:bg-muted/50 transition-colors" onClick={() => setActiveTab("credito")}>
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-muted-foreground font-medium">Créd. Internacional</span>
                  {creditoIntLoading ? <Skeleton className="h-4 w-16" /> :
                    <span className={`text-xs font-bold ${
                      creditoIntData?.status === 'confirmado' ? 'text-[hsl(153,100%,39%)]' :
                      creditoIntData?.status === 'provavel' ? 'text-blue-600' :
                      'text-muted-foreground'
                    }`}>
                      {creditoIntData?.status === 'confirmado' ? 'Confirmado' :
                       creditoIntData?.status === 'provavel' ? 'Provável' :
                       creditoIntData?.status === 'possivel' ? 'Possível' :
                       creditoIntData ? 'N/A' : '—'}
                    </span>}
                </div>
              </div>
              <div className="px-4 py-3 cursor-pointer hover:bg-muted/50 transition-colors" onClick={() => setActiveTab("compliance")}>
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-muted-foreground font-medium">Contratos Gov.</span>
                  {portalLoading ? <Skeleton className="h-4 w-16" /> :
                    <span className="text-xs font-bold text-foreground">
                      {portalData?.resumo?.contratos?.length > 0 ? `${portalData.resumo.contratos.length}` : portalData ? '0' : '—'}
                    </span>}
                </div>
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="px-5 py-2 bg-muted/30 border-t flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <ShieldCheck className="h-3 w-3 text-[hsl(153,100%,39%)]" />
              <span className="text-[9px] font-medium text-muted-foreground">Receita Federal · PGFN · BCB · CVM · Portal Transparência</span>
            </div>
            {dadosReaisData && (
              <span className="text-[9px] text-muted-foreground">{dadosReaisData.verificacao?.total_fontes || 0} fontes</span>
            )}
          </div>
        </CardContent>
      </Card>

      {/* PROGRESS DASHBOARD */}
      {!allDone && (
        <Card className="border-2 border-primary/30 bg-gradient-to-r from-primary/5 to-accent/10 overflow-hidden">
          <div className="px-4 py-3">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin text-primary" />
                <span className="text-sm font-bold text-foreground">Analisando empresa...</span>
              </div>
              <Badge variant="outline" className="text-xs">{completedCount}/{searches.length}</Badge>
            </div>
            <Progress value={progressPercent} className="h-2 mb-3" />
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
              {searches.map((s, i) => (
                <div key={i} className={`flex items-center gap-1.5 text-xs rounded-lg px-2 py-1.5 border transition-all ${
                  s.done ? 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-400' :
                  s.error ? 'bg-destructive/10 border-destructive/30 text-destructive' :
                  s.loading ? 'bg-primary/10 border-primary/30 text-primary animate-pulse' :
                  'bg-muted/50 border-border text-muted-foreground'
                }`}>
                  {s.loading ? <Loader2 className="h-3 w-3 animate-spin flex-shrink-0" /> :
                   s.done ? <CheckCircle2 className="h-3 w-3 flex-shrink-0" /> :
                   s.error ? <XCircle className="h-3 w-3 flex-shrink-0" /> :
                   <span className="text-xs">{s.icon}</span>}
                  <span className="truncate font-medium">{s.label}</span>
                </div>
              ))}
            </div>
          </div>
        </Card>
      )}

      {/* RESUMO INTELIGENTE - shows when all done */}
      {allDone && (() => {
        // Gerar resumo inteligente baseado nos dados coletados
        const pontosFortesArr: string[] = [];
        const pontosAtencaoArr: string[] = [];
        const riscos: string[] = [];

        // Capital Social
        const capSocial = empresa.capital_social || 0;
        if (capSocial >= 100e6) pontosFortesArr.push(`Capital social robusto de R$ ${(capSocial/1e6).toFixed(0)}M, indicando solidez patrimonial`);
        else if (capSocial >= 10e6) pontosFortesArr.push(`Capital social de R$ ${(capSocial/1e6).toFixed(1)}M posiciona bem para operações de crédito`);
        else if (capSocial > 0 && capSocial < 100e3) pontosAtencaoArr.push(`Capital social abaixo de R$ 100K pode limitar acesso a linhas de crédito maiores`);

        // Dívidas
        const totalDividas = dividasData ? (Object.values(dividasData) as any[]).reduce((a: number, s: any) => a + (s.encontrados || 0), 0) : 0;
        if (totalDividas === 0) pontosFortesArr.push('Nenhuma dívida registrada em PGFN, Protestos ou CADIN — excelente posição fiscal');
        else if (totalDividas <= 3) pontosAtencaoArr.push(`${totalDividas} registro(s) de dívida identificado(s) — requer análise de materialidade`);
        else riscos.push(`${totalDividas} registros de dívida ativos representam risco de restrição de crédito`);

        // Endividamento
        if (endividamentoData?.nivel === 'nenhum') pontosFortesArr.push('Sem endividamento bancário registrado no SCR/Banco Central');
        else if (endividamentoData?.nivel === 'alto') riscos.push('Alto endividamento bancário pode comprometer capacidade de pagamento');
        else if (endividamentoData?.nivel === 'moderado') pontosAtencaoArr.push('Endividamento bancário moderado — monitorar relação dívida/receita');

        // Sanções
        const totalSancoes = portalData?.resumo?.sancoes?.length || 0;
        if (totalSancoes === 0) pontosFortesArr.push('Sem sanções governamentais — compliance regular');
        else riscos.push(`${totalSancoes} sanção(ões) governamental(ais) identificada(s) — impedimento para contratos públicos`);

        // Contratos governo
        const totalContratosGov = portalData?.resumo?.contratos?.length || 0;
        if (totalContratosGov > 0) pontosFortesArr.push(`${totalContratosGov} contrato(s) com governo federal — experiência em licitações`);

        // Garantias
        if (garantiasData?.estimativa?.capacidadeGarantia === 'alta') pontosFortesArr.push('Alta capacidade de garantia — favorável para operações estruturadas');
        else if (garantiasData?.estimativa?.capacidadeGarantia === 'baixa') pontosAtencaoArr.push('Baixa capacidade de garantia pode limitar acesso a crédito internacional');

        // Crédito internacional
        if (creditoIntData?.status === 'confirmado') pontosFortesArr.push('Experiência confirmada em operações internacionais');
        else if (creditoIntData?.status === 'nao_encontrado') pontosAtencaoArr.push('Sem histórico de crédito internacional identificado');

        // Score
        if (credito.score >= 70) pontosFortesArr.push(`Score de crédito ${credito.score}/100 (${credito.nivel.toUpperCase()}) — bom perfil para captação`);
        else if (credito.score < 40) riscos.push(`Score de crédito ${credito.score}/100 — perfil de risco elevado`);

        const overallGood = riscos.length === 0 && pontosAtencaoArr.length <= 1;
        const overallBad = riscos.length >= 2;

        return (
          <Card className="glass-card overflow-hidden">
            {/* Header gradient */}
            <div className={`h-1 ${overallBad ? 'bg-gradient-to-r from-destructive via-primary to-destructive' : overallGood ? 'bg-gradient-to-r from-[hsl(153,100%,39%)] via-accent to-primary' : 'bg-gradient-to-r from-primary via-accent to-[hsl(211,100%,45%)]'}`} />
            <div className="px-5 py-3 bg-gradient-to-r from-[hsl(228,100%,8%)] to-[hsl(270,60%,10%)] flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className={`h-8 w-8 rounded-lg flex items-center justify-center shadow-glow ${overallBad ? 'bg-destructive' : overallGood ? 'bg-[hsl(153,100%,39%)]' : 'bg-accent'}`}>
                  <Zap className="h-4 w-4 text-accent-foreground" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-foreground tracking-wide">Resumo Inteligente</h3>
                  <p className="text-[10px] text-muted-foreground">Análise consolidada com base em {searches.length} fontes verificadas</p>
                </div>
              </div>
              <Badge variant="outline" className={`text-[10px] font-bold ${overallBad ? 'border-destructive/40 text-destructive' : overallGood ? 'border-[hsl(153,100%,39%)]/40 text-[hsl(153,100%,39%)]' : 'border-accent/40 text-accent'}`}>
                {overallBad ? '⚠️ Atenção Necessária' : overallGood ? '✅ Perfil Favorável' : '📊 Perfil Moderado'}
              </Badge>
            </div>

            <CardContent className="p-5 space-y-4">
              {/* Verdict */}
              <div className={`rounded-xl p-4 border ${overallBad ? 'border-destructive/20 bg-destructive/5' : overallGood ? 'border-[hsl(153,100%,39%)]/20 bg-[hsl(153,100%,39%)]/5' : 'border-accent/20 bg-accent/5'}`}>
                <p className="text-sm font-medium text-foreground leading-relaxed">
                  {overallGood 
                    ? `A ${empresa.razao_social.split(' ').slice(0, 3).join(' ')} apresenta um perfil sólido para operações de crédito. Com situação fiscal limpa, sem sanções e ${credito.score >= 60 ? 'bom score de crédito' : 'score aceitável'}, a empresa está bem posicionada para captação de recursos.`
                    : overallBad
                    ? `A ${empresa.razao_social.split(' ').slice(0, 3).join(' ')} apresenta pontos críticos que precisam ser endereçados antes de avançar em operações de crédito. Foram identificados ${riscos.length} risco(s) que podem impactar a elegibilidade da empresa.`
                    : `A ${empresa.razao_social.split(' ').slice(0, 3).join(' ')} tem um perfil misto — possui pontos fortes relevantes, mas há aspectos que merecem atenção para otimizar o acesso a crédito e operações internacionais.`
                  }
                </p>
              </div>

              {/* Three columns */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {/* Pontos Fortes */}
                {pontosFortesArr.length > 0 && (
                  <div className="space-y-2">
                    <h4 className="text-[10px] font-bold uppercase tracking-[0.15em] text-[hsl(153,100%,39%)] flex items-center gap-1.5">
                      <CheckCircle2 className="h-3 w-3" /> Pontos Fortes ({pontosFortesArr.length})
                    </h4>
                    <div className="space-y-1.5">
                      {pontosFortesArr.map((p, i) => (
                        <div key={i} className="text-[11px] text-foreground/80 p-2 rounded-lg border border-[hsl(153,100%,39%)]/15 bg-[hsl(153,100%,39%)]/5 leading-relaxed">
                          ✅ {p}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Pontos de Atenção */}
                {pontosAtencaoArr.length > 0 && (
                  <div className="space-y-2">
                    <h4 className="text-[10px] font-bold uppercase tracking-[0.15em] text-primary flex items-center gap-1.5">
                      <HelpCircle className="h-3 w-3" /> Atenção ({pontosAtencaoArr.length})
                    </h4>
                    <div className="space-y-1.5">
                      {pontosAtencaoArr.map((p, i) => (
                        <div key={i} className="text-[11px] text-foreground/80 p-2 rounded-lg border border-primary/15 bg-primary/5 leading-relaxed">
                          ⚡ {p}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Riscos */}
                {riscos.length > 0 && (
                  <div className="space-y-2">
                    <h4 className="text-[10px] font-bold uppercase tracking-[0.15em] text-destructive flex items-center gap-1.5">
                      <AlertTriangle className="h-3 w-3" /> Riscos ({riscos.length})
                    </h4>
                    <div className="space-y-1.5">
                      {riscos.map((p, i) => (
                        <div key={i} className="text-[11px] text-foreground/80 p-2 rounded-lg border border-destructive/15 bg-destructive/5 leading-relaxed">
                          🚨 {p}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* KPI Strip */}
              <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 pt-2 border-t border-border/30">
                {[
                  { icon: '🌐', label: 'Créd. Internac.', value: creditoIntData?.status === 'confirmado' ? 'Confirmado' : creditoIntData?.status === 'provavel' ? 'Provável' : creditoIntData?.status === 'possivel' ? 'Possível' : 'N/A', tab: 'credito' },
                  { icon: '💰', label: 'Capital Social', value: capSocial >= 1e9 ? `R$ ${(capSocial/1e9).toFixed(1)}B` : capSocial >= 1e6 ? `R$ ${(capSocial/1e6).toFixed(0)}M` : capSocial > 0 ? `R$ ${(capSocial/1e3).toFixed(0)}K` : 'N/A', tab: 'financeiro' },
                  { icon: '💰', label: 'Dívidas', value: totalDividas === 0 ? 'Nenhuma' : `${totalDividas} reg.`, tab: 'compliance' },
                  { icon: '⚖️', label: 'Sanções', value: totalSancoes === 0 ? 'Regular' : `${totalSancoes} sanções`, tab: 'compliance' },
                  { icon: '🛡️', label: 'Garantias', value: garantiasData?.estimativa?.capacidadeGarantia ? garantiasData.estimativa.capacidadeGarantia.charAt(0).toUpperCase() + garantiasData.estimativa.capacidadeGarantia.slice(1) : 'N/A', tab: 'garantias' },
                  { icon: '🏦', label: 'Endividamento', value: endividamentoData?.nivel ? (endividamentoData.nivel === 'nenhum' ? 'Nenhum' : endividamentoData.nivel.charAt(0).toUpperCase() + endividamentoData.nivel.slice(1)) : 'N/A', tab: 'financeiro' },
                ].map((kpi, i) => (
                  <div key={i} className="rounded-lg border border-border/30 p-2.5 text-center bg-card/50 hover:bg-accent/10 cursor-pointer transition-colors" onClick={() => setActiveTab(kpi.tab)}>
                    <span className="text-base">{kpi.icon}</span>
                    <p className="text-[11px] font-bold mt-1 text-foreground">{kpi.value}</p>
                    <p className="text-[9px] text-muted-foreground">{kpi.label}</p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        );
      })()}

      {/* TABBED CONTENT */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList className="grid w-full grid-cols-6">
          <TabsTrigger value="dados-reais" className="text-xs gap-1">
            <Database className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Dados Reais</span>
          </TabsTrigger>
          <TabsTrigger value="credito" className="text-xs gap-1">
            <Globe className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Crédito</span>
          </TabsTrigger>
          <TabsTrigger value="financeiro" className="text-xs gap-1">
            <BarChart3 className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Financeiro</span>
          </TabsTrigger>
          <TabsTrigger value="compliance" className="text-xs gap-1">
            <Scale className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Compliance</span>
          </TabsTrigger>
          <TabsTrigger value="garantias" className="text-xs gap-1">
            <Shield className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Garantias</span>
          </TabsTrigger>
          <TabsTrigger value="contatos" className="text-xs gap-1">
            <Users className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Contatos</span>
          </TabsTrigger>
        </TabsList>

        {/* TAB: Dados Reais */}
        <TabsContent value="dados-reais" className="space-y-4">
          <Card className="border-2 border-primary/20 overflow-hidden">
            {dadosReaisData && (
              <div className={`px-4 py-2 text-sm font-bold flex items-center gap-2 ${
                dadosReaisData.resumo?.confianca_geral === 'alta' ? 'bg-emerald-600 text-white' :
                dadosReaisData.resumo?.confianca_geral === 'media' ? 'bg-blue-600 text-white' :
                dadosReaisData.resumo?.confianca_geral === 'baixa' ? 'bg-amber-500 text-amber-950' :
                'bg-muted text-muted-foreground'
              }`}>
                <Database className="h-4 w-4" />
                {dadosReaisData.resumo?.confianca_geral === 'alta' && '✅ DADOS VERIFICADOS — FONTES OFICIAIS'}
                {dadosReaisData.resumo?.confianca_geral === 'media' && '📋 DADOS VERIFICADOS — FONTES CONFIÁVEIS'}
                {dadosReaisData.resumo?.confianca_geral === 'baixa' && '⚠️ DADOS PARCIAIS — VERIFICAÇÃO RECOMENDADA'}
                {dadosReaisData.resumo?.confianca_geral === 'estimativa' && '📊 DADOS ESTIMADOS — SEM FONTES PÚBLICAS'}
                <span className="ml-auto text-xs font-normal opacity-80">
                  {dadosReaisData.resumo?.total_fontes || 0} fontes · {dadosReaisData.resumo?.fontes_oficiais || 0} oficiais
                </span>
              </div>
            )}
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Database className="h-5 w-5 text-primary" />
                Dados Reais Verificados
              </CardTitle>
              <CardDescription>Dados buscados via Perplexity AI + Firecrawl com fontes rastreáveis. Clique nas fontes para verificar.</CardDescription>
            </CardHeader>
            <CardContent>
              {dadosReaisLoading && (
                <div className="flex flex-col items-center gap-3 py-8">
                  <Loader2 className="h-8 w-8 animate-spin text-primary" />
                  <p className="text-sm text-muted-foreground">Buscando dados reais com Perplexity + Firecrawl...</p>
                  <p className="text-xs text-muted-foreground">Cruzando fontes oficiais, imprensa e bases públicas...</p>
                </div>
              )}

              {dadosReaisError && (
                <div className="space-y-2">
                  <p className="text-sm text-destructive">Erro: {dadosReaisError}</p>
                  <Button variant="outline" size="sm" onClick={buscarDadosReais}>Tentar novamente</Button>
                </div>
              )}

              {dadosReaisData && (
                <div className="space-y-4 animate-fade-in">
                  {/* Summary stats */}
                  <div className="grid grid-cols-3 gap-3">
                    <div className="rounded-xl border p-3 text-center bg-background">
                      <p className="text-3xl font-black text-foreground">{dadosReaisData.resumo?.total_dados || 0}</p>
                      <p className="text-[10px] uppercase tracking-wider text-muted-foreground mt-1">Categorias</p>
                    </div>
                    <div className="rounded-xl border p-3 text-center bg-background">
                      <p className="text-3xl font-black text-foreground">{dadosReaisData.resumo?.total_fontes || 0}</p>
                      <p className="text-[10px] uppercase tracking-wider text-muted-foreground mt-1">Fontes</p>
                    </div>
                    <div className="rounded-xl border p-3 text-center bg-background">
                      <SourceIndicator
                        confianca={dadosReaisData.resumo?.confianca_geral || 'estimativa'}
                        fontes={[]}
                        compact
                      />
                      <p className="text-[10px] uppercase tracking-wider text-muted-foreground mt-2">Confiança</p>
                    </div>
                  </div>

                  {/* Data cards */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {(dadosReaisData.dados || []).map((dado: any, i: number) => (
                      <Card key={i} className="overflow-hidden">
                        <div className="px-3 py-2 border-b bg-muted/30 flex items-center justify-between">
                          <span className="text-xs font-bold">{dado.titulo}</span>
                          <SourceIndicator confianca={dado.confianca} fontes={dado.fontes || []} compact />
                        </div>
                        <CardContent className="p-4 space-y-3">
                          <p className="text-lg font-black text-foreground">{dado.valor}</p>
                          {dado.detalhes && (
                            <p className="text-xs text-muted-foreground leading-relaxed line-clamp-4">{dado.detalhes}</p>
                          )}
                          {dado.fontes && dado.fontes.length > 0 && (
                            <div className="space-y-1 pt-2 border-t">
                              <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Fontes</p>
                              {dado.fontes.map((f: Fonte, fi: number) => (
                                <a
                                  key={fi}
                                  href={f.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="flex items-center gap-2 text-xs p-1.5 rounded border bg-background hover:bg-accent/50 transition-colors group"
                                >
                                  <ExternalLink className="h-3 w-3 text-muted-foreground group-hover:text-primary flex-shrink-0" />
                                  <span className="font-medium text-foreground group-hover:text-primary truncate">{f.nome}</span>
                                  <Badge variant="outline" className="text-[9px] ml-auto shrink-0">
                                    {f.tipo === 'oficial' ? '🏛️ Oficial' :
                                     f.tipo === 'imprensa_financeira' ? '📰 Imprensa' :
                                     f.tipo === 'juridico' ? '⚖️ Jurídico' :
                                     f.tipo === 'scraping' ? '🔍 Extraído' : '🌐 Web'}
                                  </Badge>
                                </a>
                              ))}
                            </div>
                          )}
                        </CardContent>
                      </Card>
                    ))}
                  </div>

                  {/* All sources */}
                  {dadosReaisData.fontes && dadosReaisData.fontes.length > 0 && (
                    <Card>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-xs uppercase tracking-wider text-muted-foreground font-bold flex items-center gap-1.5">
                          <ExternalLink className="h-3 w-3" />
                          Todas as Fontes ({dadosReaisData.fontes.length})
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-1">
                        {dadosReaisData.fontes.map((f: Fonte, i: number) => (
                          <a
                            key={i}
                            href={f.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-2 text-xs p-2 rounded-lg border bg-background hover:bg-accent/50 transition-colors group"
                          >
                            <ExternalLink className="h-3 w-3 text-muted-foreground group-hover:text-primary" />
                            <span className="font-medium text-primary hover:underline truncate flex-1">{f.nome}</span>
                            <Badge variant="outline" className="text-[9px] shrink-0">
                              {f.tipo === 'oficial' ? '🏛️ Oficial' :
                               f.tipo === 'imprensa_financeira' ? '📰 Imprensa' :
                               f.tipo === 'juridico' ? '⚖️ Jurídico' :
                               f.tipo === 'consumidor' ? '👥 Consumidor' :
                               f.tipo === 'scraping' ? '🔍 Extraído' : '🌐 Web'}
                            </Badge>
                          </a>
                        ))}
                      </CardContent>
                    </Card>
                  )}

                  <div className="flex justify-center">
                    <Button variant="ghost" size="sm" onClick={buscarDadosReais} className="gap-2 text-xs text-muted-foreground">
                      <Search className="h-3 w-3" />
                      Buscar novamente
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* TAB: Crédito Internacional */}
        <TabsContent value="credito" className="space-y-4">
      <Card className={`border-2 overflow-hidden ${
        creditoIntData?.status === 'confirmado' ? 'border-emerald-500 bg-gradient-to-r from-emerald-50 to-emerald-100/50 dark:from-emerald-950/40 dark:to-emerald-900/20' :
        creditoIntData?.status === 'provavel' ? 'border-blue-500 bg-gradient-to-r from-blue-50 to-blue-100/50 dark:from-blue-950/40 dark:to-blue-900/20' :
        creditoIntData?.status === 'possivel' ? 'border-yellow-500 bg-gradient-to-r from-yellow-50 to-yellow-100/50 dark:from-yellow-950/40 dark:to-yellow-900/20' :
        creditoIntData?.status === 'nao_encontrado' ? 'border-muted bg-muted/30' :
        'border-primary/20 bg-gradient-to-r from-card to-accent/10'
      }`}>
        {/* Status banner when data exists */}
        {creditoIntData && (
          <div className={`px-4 py-2 text-sm font-bold flex items-center gap-2 ${
            creditoIntData.status === 'confirmado' ? 'bg-emerald-600 text-white' :
            creditoIntData.status === 'provavel' ? 'bg-blue-600 text-white' :
            creditoIntData.status === 'possivel' ? 'bg-yellow-500 text-yellow-950' :
            'bg-muted text-muted-foreground'
          }`}>
            {creditoIntData.status === 'confirmado' && <><CheckCircle2 className="h-4 w-4" /> ✅ CRÉDITO INTERNACIONAL CONFIRMADO</>}
            {creditoIntData.status === 'provavel' && <><Zap className="h-4 w-4" /> ⚡ PROVÁVEL CRÉDITO INTERNACIONAL</>}
            {creditoIntData.status === 'possivel' && <><HelpCircle className="h-4 w-4" /> 🔍 POSSÍVEL CRÉDITO INTERNACIONAL</>}
            {creditoIntData.status === 'nao_encontrado' && <><XCircle className="h-4 w-4" /> Sem registro de crédito internacional</>}
          </div>
        )}

        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Globe className="h-5 w-5 text-primary" />
            Crédito Internacional — Verificação
          </CardTitle>
          <CardDescription>Verifica se a empresa já possui ou utilizou crédito internacional (ACC, ACE, Carta de Crédito, BNDES-Exim, etc.)</CardDescription>
        </CardHeader>
        <CardContent>
          {creditoIntLoading && (
            <div className="flex flex-col items-center gap-3 py-6">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="text-sm text-muted-foreground">Verificando histórico de crédito internacional...</p>
            </div>
          )}

          {creditoIntError && (
            <div className="space-y-2">
              <p className="text-sm text-destructive">Erro: {creditoIntError}</p>
              <Button variant="outline" size="sm" onClick={verificarCreditoInternacional}>Tentar novamente</Button>
            </div>
          )}

          {creditoIntData && (
            <div className="space-y-5 animate-fade-in">
              {/* Summary stats */}
              <div className="grid grid-cols-3 gap-3">
                <div className="rounded-xl border p-3 text-center bg-background">
                  <p className="text-3xl font-black text-foreground">{creditoIntData.indicadoresPositivos}</p>
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground mt-1">Indicadores</p>
                </div>
                <div className="rounded-xl border p-3 text-center bg-background">
                  <p className="text-3xl font-black text-foreground">{creditoIntData.totalResultados}</p>
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground mt-1">Resultados</p>
                </div>
                <div className="rounded-xl border p-3 text-center bg-background">
                  <Badge className={`text-xs ${
                    creditoIntData.confianca === 'alta' ? 'bg-emerald-100 text-emerald-700 border-emerald-300' :
                    creditoIntData.confianca === 'média' ? 'bg-blue-100 text-blue-700 border-blue-300' :
                    creditoIntData.confianca === 'baixa' ? 'bg-yellow-100 text-yellow-700 border-yellow-300' :
                    'bg-muted text-muted-foreground'
                  }`}>
                    Confiança {creditoIntData.confianca}
                  </Badge>
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground mt-2">Precisão</p>
                </div>
              </div>

              {/* Evidence tags */}
              {creditoIntData.evidencias && creditoIntData.evidencias.length > 0 && (
                <div>
                  <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1">
                    <FileText className="h-3 w-3" />
                    Evidências Encontradas
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {creditoIntData.evidencias.map((ev: string, i: number) => (
                      <Badge key={i} variant="outline" className="text-xs capitalize border-primary/30 text-primary">
                        ✓ {ev}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              {/* Category results */}
              {creditoIntData.categorias && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  {Object.entries(creditoIntData.categorias).map(([key, section]: [string, any]) => {
                    const config: Record<string, { icon: any; color: string; emoji: string }> = {
                      credito_internacional: { icon: <DollarSign className="h-4 w-4" />, color: 'text-emerald-600', emoji: '💳' },
                      operacoes_cambio: { icon: <TrendingUp className="h-4 w-4" />, color: 'text-blue-600', emoji: '💱' },
                      relacoes_internacionais: { icon: <Globe className="h-4 w-4" />, color: 'text-purple-600', emoji: '🌐' },
                    };
                    const cfg = config[key] || { icon: <FileText className="h-4 w-4" />, color: 'text-muted-foreground', emoji: '📄' };

                    return (
                      <div key={key} className="rounded-lg border bg-background p-3 space-y-2">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-1.5">
                            <span className={cfg.color}>{cfg.icon}</span>
                            <span className="text-xs font-bold">{section.label}</span>
                          </div>
                          <Badge variant={section.encontrados > 0 ? "default" : "secondary"} className="text-xs">{section.encontrados}</Badge>
                        </div>
                        {section.items && section.items.length > 0 ? (
                          <div className="space-y-1 max-h-36 overflow-y-auto">
                            {section.items.slice(0, 3).map((item: any, i: number) => (
                              <a key={i} href={item.url} target="_blank" rel="noopener noreferrer" className="block text-xs p-1.5 rounded border bg-muted/30 hover:bg-accent transition-colors">
                                <p className="font-medium line-clamp-1">{cfg.emoji} {item.titulo}</p>
                                {item.descricao && <p className="text-muted-foreground line-clamp-1 mt-0.5">{item.descricao}</p>}
                              </a>
                            ))}
                          </div>
                        ) : (
                          <p className="text-xs text-muted-foreground text-center py-2">Nenhum registro</p>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              <div className="flex justify-center">
                <Button variant="ghost" size="sm" onClick={verificarCreditoInternacional} className="gap-2 text-xs text-muted-foreground">
                  <Search className="h-3 w-3" />
                  Verificar novamente
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Score de Crédito Internacional - Destaque */}
      <Card className="border-2 border-primary/20 bg-gradient-to-r from-card to-accent/20">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Globe className="h-5 w-5 text-primary" />
            Potencial de Crédito Internacional
          </CardTitle>
          <CardDescription>Análise baseada em capital, porte, setor, sócios e tempo de mercado</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-4">
            <div className="flex-shrink-0 text-center">
              <div className={`text-4xl font-black ${credito.cor}`}>{credito.score}</div>
              <div className="text-xs text-muted-foreground">de 100</div>
            </div>
            <div className="flex-1 space-y-2">
              <Progress value={credito.score} className="h-3" />
              <div className="flex items-center justify-between">
                <Badge className={`${
                  credito.nivel === "alto" ? "bg-green-100 text-green-800 border-green-300" :
                  credito.nivel === "medio" ? "bg-yellow-100 text-yellow-800 border-yellow-300" :
                  credito.nivel === "baixo" ? "bg-orange-100 text-orange-800 border-orange-300" :
                  "bg-red-100 text-red-800 border-red-300"
                }`}>
                  {credito.nivel === "alto" ? "🔥 Alto Potencial" : credito.nivel === "medio" ? "⚡ Médio Potencial" : credito.nivel === "baixo" ? "📊 Baixo Potencial" : "⚠️ Muito Baixo"}
                </Badge>
                <span className="text-sm font-medium text-muted-foreground">
                  {credito.decisores} decisor{credito.decisores !== 1 ? "es" : ""} identificado{credito.decisores !== 1 ? "s" : ""}
                </span>
              </div>
            </div>
          </div>
          
          {/* Fatores */}
          <div>
            <p className="text-xs font-semibold text-muted-foreground mb-2 flex items-center gap-1">
              <TrendingUp className="h-3 w-3" />
              FATORES DA ANÁLISE
            </p>
            <div className="flex flex-wrap gap-1.5">
              {credito.fatores.map((f, i) => (
                <Badge key={i} variant="outline" className="text-xs">
                  {f}
                </Badge>
              ))}
            </div>
          </div>

          {/* Decisores resumo */}
          {credito.decisores > 0 && (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-900">
              <ShieldCheck className="h-5 w-5 text-green-600" />
              <p className="text-sm font-medium text-green-800 dark:text-green-300">
                {credito.decisores} pessoa{credito.decisores > 1 ? "s" : ""} com poder para fechar crédito internacional nesta empresa
              </p>
            </div>
          )}
        </CardContent>
      </Card>
        </TabsContent>

        {/* TAB: Financeiro */}
        <TabsContent value="financeiro" className="space-y-4">
      {/* Capital Social */}
      <Card className="border-2 border-primary/10 overflow-hidden">
        <div className="px-4 py-2 bg-primary text-primary-foreground text-sm font-bold flex items-center gap-2">
          <DollarSign className="h-4 w-4" />
          💰 CAPITAL SOCIAL & PERFIL FINANCEIRO
          <span className="ml-auto text-xs font-normal opacity-80">
            Fonte: Receita Federal
          </span>
        </div>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <DollarSign className="h-5 w-5 text-primary" />
            Capital Social
          </CardTitle>
          <CardDescription>Dados oficiais da Receita Federal · CNPJ {empresa.cnpj}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-6 animate-fade-in">
            {/* Summary Cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="rounded-xl bg-gradient-to-br from-primary/10 to-primary/5 border border-primary/20 p-4 text-center">
                <p className="text-2xl font-black text-primary">
                  {empresa.capital_social >= 1e9 ? `R$ ${(empresa.capital_social/1e9).toFixed(1)}B` :
                   empresa.capital_social >= 1e6 ? `R$ ${(empresa.capital_social/1e6).toFixed(1)}M` :
                   empresa.capital_social >= 1e3 ? `R$ ${(empresa.capital_social/1e3).toFixed(0)}K` :
                   `R$ ${empresa.capital_social.toFixed(0)}`}
                </p>
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground mt-1">Capital Social</p>
              </div>
              <div className="rounded-xl bg-muted/50 border p-4 text-center">
                <p className="text-lg font-bold text-foreground">{empresa.porte || '—'}</p>
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground mt-1">Porte</p>
              </div>
              <div className="rounded-xl bg-muted/50 border p-4 text-center">
                <p className="text-lg font-bold text-foreground">{empresa.cnae_fiscal_descricao?.split(' ').slice(0, 3).join(' ') || '—'}</p>
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground mt-1">Setor (CNAE)</p>
              </div>
              <div className="rounded-xl bg-muted/50 border p-4 text-center">
                <p className="text-lg font-bold text-foreground">
                  {empresa.data_inicio_atividade ? `${new Date().getFullYear() - new Date(empresa.data_inicio_atividade).getFullYear()} anos` : '—'}
                </p>
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground mt-1">Tempo de Mercado</p>
              </div>
            </div>

            {/* Capital Social vs Sócios chart */}
            {empresa.qsa && empresa.qsa.length > 0 && (() => {
              const sociosData = empresa.qsa
                .filter(s => s.capital_social_socio > 0)
                .sort((a, b) => b.capital_social_socio - a.capital_social_socio)
                .slice(0, 8)
                .map(s => ({
                  name: s.nome_socio.split(' ').slice(0, 2).join(' '),
                  valor: s.capital_social_socio,
                }));
              if (sociosData.length === 0) return null;
              const fmtVal = (v: number) => v >= 1e6 ? `R$ ${(v/1e6).toFixed(1)}M` : v >= 1e3 ? `R$ ${(v/1e3).toFixed(0)}K` : `R$ ${v}`;
              const COLORS = ['hsl(var(--primary))', 'hsl(var(--accent))', 'hsl(210, 70%, 55%)', 'hsl(153, 70%, 40%)', 'hsl(280, 60%, 50%)', 'hsl(38, 80%, 50%)', 'hsl(0, 70%, 55%)', 'hsl(180, 50%, 45%)'];
              return (
                <div>
                  <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-1">
                    <Users className="h-3 w-3" />
                    Participação Societária (Capital por Sócio)
                  </p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="h-56">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={sociosData} layout="vertical" margin={{ left: 0, right: 16, top: 4, bottom: 4 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
                          <XAxis type="number" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} tickFormatter={(v: number) => fmtVal(v)} />
                          <YAxis type="category" dataKey="name" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} width={100} />
                          <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 12 }} formatter={(value: number) => [fmtVal(value), 'Capital']} />
                          <Bar dataKey="valor" radius={[0, 6, 6, 0]} maxBarSize={24}>
                            {sociosData.map((_, idx) => (
                              <Cell key={idx} fill={COLORS[idx % COLORS.length]} />
                            ))}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                    <div className="h-56">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie data={sociosData} dataKey="valor" nameKey="name" cx="50%" cy="50%" outerRadius={70} innerRadius={35} strokeWidth={2} stroke="hsl(var(--card))" label={({ name, percent }) => `${name.split(' ')[0]} ${(percent * 100).toFixed(0)}%`}>
                            {sociosData.map((_, idx) => (
                              <Cell key={idx} fill={COLORS[idx % COLORS.length]} />
                            ))}
                          </Pie>
                          <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 12 }} formatter={(value: number) => [fmtVal(value), 'Capital']} />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* Source */}
            <div className="flex items-start gap-2 p-3 rounded-lg bg-muted/50 border text-xs text-muted-foreground">
              <ShieldCheck className="h-4 w-4 flex-shrink-0 mt-0.5 text-[hsl(153,100%,39%)]" />
              <div>
                <p className="font-semibold mb-1">Dados Oficiais — Receita Federal do Brasil</p>
                <p>Capital social registrado no CNPJ. Valor atualizado conforme última alteração contratual informada à Receita Federal.</p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Endividamento Bancário */}
      <Card className="border-2 border-amber-500/20 overflow-hidden">
        {endividamentoData && (
          <div className={`px-4 py-2 text-sm font-bold flex items-center gap-2 ${
            endividamentoData.nivel === 'alto' ? 'bg-destructive text-destructive-foreground' :
            endividamentoData.nivel === 'moderado' ? 'bg-amber-500 text-amber-950' :
            endividamentoData.nivel === 'baixo' ? 'bg-yellow-400 text-yellow-950' :
            endividamentoData.nivel === 'minimo' ? 'bg-blue-500 text-white' :
            'bg-emerald-600 text-white'
          }`}>
            {endividamentoData.nivel === 'alto' && <><AlertTriangle className="h-4 w-4" /> ⚠️ {endividamentoData.status}</>}
            {endividamentoData.nivel === 'moderado' && <><TrendingUp className="h-4 w-4" /> ⚡ {endividamentoData.status}</>}
            {endividamentoData.nivel === 'baixo' && <><BarChart3 className="h-4 w-4" /> 📊 {endividamentoData.status}</>}
            {endividamentoData.nivel === 'minimo' && <><Info className="h-4 w-4" /> 📋 {endividamentoData.status}</>}
            {endividamentoData.nivel === 'nenhum' && <><ShieldCheck className="h-4 w-4" /> ✅ {endividamentoData.status}</>}
            <span className="ml-auto text-xs font-normal opacity-80">
              Fontes: Perplexity AI · Firecrawl · Receita Federal
            </span>
          </div>
        )}
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Landmark className="h-5 w-5 text-amber-600" />
            Endividamento Bancário
          </CardTitle>
          <CardDescription>SCR, empréstimos, financiamentos, debêntures, BNDES e inadimplência bancária</CardDescription>
        </CardHeader>
        <CardContent>
          {endividamentoLoading && (
            <div className="flex flex-col items-center gap-3 py-8">
              <Loader2 className="h-8 w-8 animate-spin text-amber-600" />
              <p className="text-sm text-muted-foreground">Buscando endividamento bancário...</p>
            </div>
          )}
          {endividamentoError && (
            <div className="space-y-2">
              <p className="text-sm text-destructive">Erro: {endividamentoError}</p>
              <Button variant="outline" size="sm" onClick={buscarEndividamentoBancario}>Tentar novamente</Button>
            </div>
          )}
          {endividamentoData && (() => {
            const categorias = Object.entries(endividamentoData.categorias) as [string, any][];
            const nivelColor = endividamentoData.nivel === 'alto' ? 'text-destructive' :
                               endividamentoData.nivel === 'moderado' ? 'text-amber-600' :
                               endividamentoData.nivel === 'baixo' ? 'text-yellow-600' :
                               endividamentoData.nivel === 'minimo' ? 'text-blue-600' : 'text-emerald-600';
            const nivelBg = endividamentoData.nivel === 'alto' ? 'from-destructive/10 to-destructive/5' :
                            endividamentoData.nivel === 'moderado' ? 'from-amber-500/10 to-amber-500/5' :
                            endividamentoData.nivel === 'baixo' ? 'from-yellow-500/10 to-yellow-500/5' :
                            endividamentoData.nivel === 'minimo' ? 'from-blue-500/10 to-blue-500/5' : 'from-emerald-500/10 to-emerald-500/5';
            return (
              <div className="space-y-6 animate-fade-in">
                <div className={`rounded-xl p-4 bg-gradient-to-br ${nivelBg} border`}>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                    <div className="text-center">
                      <div className={`text-3xl font-black ${nivelColor}`}>{endividamentoData.totalRegistros}</div>
                      <p className="text-[10px] uppercase tracking-wider text-muted-foreground mt-1">Registros</p>
                    </div>
                    <div className="text-center">
                      <div className="text-3xl font-black text-foreground">{endividamentoData.termosIdentificados?.length || 0}</div>
                      <p className="text-[10px] uppercase tracking-wider text-muted-foreground mt-1">Termos Bancários</p>
                    </div>
                    <div className="text-center">
                      <div className="text-3xl font-black text-foreground">{endividamentoData.valoresEncontrados?.length || 0}</div>
                      <p className="text-[10px] uppercase tracking-wider text-muted-foreground mt-1">Valores</p>
                    </div>
                    <div className="text-center flex flex-col items-center justify-center">
                      <Badge className="bg-emerald-100 text-emerald-700 border-emerald-300 text-xs">
                        ✅ Confiança Alta
                      </Badge>
                      <p className="text-[10px] uppercase tracking-wider text-muted-foreground mt-2">Precisão</p>
                    </div>
                  </div>
                </div>
                {endividamentoData.termosIdentificados && endividamentoData.termosIdentificados.length > 0 && (
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1">
                      <Landmark className="h-3 w-3" /> Termos Bancários Identificados
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {endividamentoData.termosIdentificados.map((t: string, i: number) => (
                        <Badge key={i} variant="outline" className="text-xs capitalize border-amber-400/50 text-amber-700 dark:text-amber-400">🏦 {t}</Badge>
                      ))}
                    </div>
                  </div>
                )}
                {endividamentoData.valoresEncontrados && endividamentoData.valoresEncontrados.length > 0 && (
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1">
                      <DollarSign className="h-3 w-3" /> Valores Mencionados
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {endividamentoData.valoresEncontrados.map((v: string, i: number) => (
                        <Badge key={i} variant="outline" className="text-xs border-primary/30 text-primary">💰 {v}</Badge>
                      ))}
                    </div>
                  </div>
                )}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {categorias.map(([key, section]) => {
                    const configMap: Record<string, { icon: any; color: string; borderColor: string; bgColor: string; emoji: string }> = {
                      scr_operacoes: { icon: <BarChart3 className="h-4 w-4" />, color: 'text-blue-600', borderColor: 'border-blue-300', bgColor: 'bg-blue-50 dark:bg-blue-950/20', emoji: '📊' },
                      emprestimos_financiamentos: { icon: <DollarSign className="h-4 w-4" />, color: 'text-amber-600', borderColor: 'border-amber-300', bgColor: 'bg-amber-50 dark:bg-amber-950/20', emoji: '💳' },
                      debentures_titulos: { icon: <FileText className="h-4 w-4" />, color: 'text-purple-600', borderColor: 'border-purple-300', bgColor: 'bg-purple-50 dark:bg-purple-950/20', emoji: '📜' },
                      credito_rural_bndes: { icon: <Landmark className="h-4 w-4" />, color: 'text-green-600', borderColor: 'border-green-300', bgColor: 'bg-green-50 dark:bg-green-950/20', emoji: '🏛️' },
                      inadimplencia: { icon: <AlertTriangle className="h-4 w-4" />, color: 'text-red-600', borderColor: 'border-red-300', bgColor: 'bg-red-50 dark:bg-red-950/20', emoji: '⚠️' },
                    };
                    const cfg = configMap[key] || { icon: <FileText className="h-4 w-4" />, color: 'text-muted-foreground', borderColor: 'border-border', bgColor: 'bg-muted/20', emoji: '📄' };
                    const hasItems = section.items && section.items.length > 0;
                    return (
                      <Card key={key} className={`${cfg.borderColor} border overflow-hidden`}>
                        <div className={`${cfg.bgColor} px-3 py-2 border-b ${cfg.borderColor}`}>
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <span className={cfg.color}>{cfg.icon}</span>
                              <span className="text-xs font-bold">{section.label}</span>
                            </div>
                            <Badge variant={hasItems ? "default" : "secondary"} className="text-xs">{section.encontrados}</Badge>
                          </div>
                        </div>
                        <div className="p-3">
                          {section.valores && section.valores.length > 0 && (
                            <div className="flex flex-wrap gap-1 mb-3">
                              {section.valores.slice(0, 4).map((v: string, i: number) => (
                                <Badge key={i} variant="outline" className={`text-xs ${cfg.color} ${cfg.borderColor}`}>{v}</Badge>
                              ))}
                            </div>
                          )}
                          {hasItems ? (
                            <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
                              {section.items.map((item: any, i: number) => (
                                <a key={i} href={item.url} target="_blank" rel="noopener noreferrer"
                                   className="block text-xs p-2 rounded-md border bg-background hover:bg-accent/50 transition-all hover:shadow-sm group">
                                  <p className="font-medium text-foreground group-hover:text-primary transition-colors line-clamp-1">{cfg.emoji} {item.titulo}</p>
                                  {item.descricao && <p className="text-muted-foreground mt-0.5 line-clamp-2">{item.descricao}</p>}
                                  <div className="flex items-center gap-1 mt-1 text-[10px] text-muted-foreground">
                                    <ExternalLink className="h-2.5 w-2.5" /> {item.fonte}
                                  </div>
                                </a>
                              ))}
                            </div>
                          ) : (
                            <div className="flex items-center gap-2 text-xs text-emerald-600 py-3 justify-center">
                              <ShieldCheck className="h-4 w-4" /> <span className="font-medium">Nenhum registro</span>
                            </div>
                          )}
                        </div>
                      </Card>
                    );
                  })}
                </div>
                <div className="flex justify-center">
                  <Button variant="ghost" size="sm" onClick={buscarEndividamentoBancario} className="gap-2 text-xs text-muted-foreground">
                    <Search className="h-3 w-3" /> Buscar novamente
                  </Button>
                </div>
              </div>
            );
          })()}
        </CardContent>
      </Card>
        </TabsContent>

        {/* TAB: Compliance */}
        <TabsContent value="compliance" className="space-y-4">
      {/* Portal da Transparência */}
      <Card className="border-2 border-indigo-500/20 overflow-hidden">
        {portalData && portalData.resumo && (
          <div className={`px-4 py-2 text-sm font-bold flex items-center gap-2 ${
            portalData.resumo.sancoes.length > 0
              ? 'bg-destructive text-destructive-foreground'
              : 'bg-gradient-to-r from-indigo-600 to-purple-600 text-white'
          }`}>
            {portalData.resumo.sancoes.length > 0
              ? <><AlertTriangle className="h-4 w-4" /> ⚠️ SANÇÕES ENCONTRADAS</>
              : <><ShieldCheck className="h-4 w-4" /> ✅ SEM SANÇÕES — EMPRESA REGULAR</>
            }
          </div>
        )}
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Scale className="h-5 w-5 text-indigo-600" />
            Portal da Transparência
          </CardTitle>
          <CardDescription>Contratos, licitações, valores recebidos e sanções do governo federal</CardDescription>
        </CardHeader>
        <CardContent>
          {portalLoading && (
            <div className="flex flex-col items-center gap-3 py-8">
              <Loader2 className="h-8 w-8 animate-spin text-indigo-600" />
              <p className="text-sm text-muted-foreground">Consultando dados no Portal da Transparência...</p>
            </div>
          )}
          {portalError && (
            <div className="space-y-2">
              <p className="text-sm text-destructive">Erro: {portalError}</p>
              <Button variant="outline" size="sm" onClick={buscarPortalTransparencia}>Tentar novamente</Button>
            </div>
          )}
          {portalData && portalData.resumo && (() => {
            const resumo = portalData.resumo;
            const totalContratos = resumo.contratos.length;
            const totalValores = resumo.valoresRecebidos.length;
            const totalSancoes = resumo.sancoes.length;
            const totalOutras = resumo.outrasInfos.length;
            const totalRegistros = totalContratos + totalValores + totalSancoes + totalOutras;
            const pieData = [
              { name: 'Contratos', value: totalContratos, fill: 'hsl(230, 70%, 55%)' },
              { name: 'Valores', value: totalValores, fill: 'hsl(145, 65%, 40%)' },
              { name: 'Sanções', value: totalSancoes, fill: 'hsl(0, 75%, 55%)' },
              { name: 'Outros', value: totalOutras, fill: 'hsl(270, 50%, 55%)' },
            ].filter(d => d.value > 0);
            const barData = [
              { categoria: 'Contratos', registros: totalContratos, fill: 'hsl(230, 70%, 55%)' },
              { categoria: 'Valores', registros: totalValores, fill: 'hsl(145, 65%, 40%)' },
              { categoria: 'Sanções', registros: totalSancoes, fill: 'hsl(0, 75%, 55%)' },
              { categoria: 'Outros', registros: totalOutras, fill: 'hsl(270, 50%, 55%)' },
            ];
            return (
              <div className="space-y-6 animate-fade-in">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div className="rounded-xl bg-gradient-to-br from-indigo-500/10 to-indigo-500/5 border border-indigo-200 dark:border-indigo-800 p-3 text-center">
                    <p className="text-3xl font-black text-indigo-600">{totalRegistros}</p>
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground mt-1">Total Registros</p>
                  </div>
                  <div className="rounded-xl bg-gradient-to-br from-blue-500/10 to-blue-500/5 border border-blue-200 dark:border-blue-800 p-3 text-center">
                    <div className="flex items-center justify-center gap-1">
                      <FileText className="h-4 w-4 text-blue-600" />
                      <p className="text-3xl font-black text-blue-600">{totalContratos}</p>
                    </div>
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground mt-1">Contratos</p>
                  </div>
                  <div className="rounded-xl bg-gradient-to-br from-emerald-500/10 to-emerald-500/5 border border-emerald-200 dark:border-emerald-800 p-3 text-center">
                    <div className="flex items-center justify-center gap-1">
                      <DollarSign className="h-4 w-4 text-emerald-600" />
                      <p className="text-3xl font-black text-emerald-600">{totalValores}</p>
                    </div>
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground mt-1">Valores Recebidos</p>
                  </div>
                  <div className={`rounded-xl p-3 text-center border ${
                    totalSancoes > 0
                      ? 'bg-gradient-to-br from-destructive/10 to-destructive/5 border-destructive/30'
                      : 'bg-gradient-to-br from-green-500/10 to-green-500/5 border-green-200 dark:border-green-800'
                  }`}>
                    <div className="flex items-center justify-center gap-1">
                      {totalSancoes > 0 ? <AlertTriangle className="h-4 w-4 text-destructive" /> : <ShieldCheck className="h-4 w-4 text-green-600" />}
                      <p className={`text-3xl font-black ${totalSancoes > 0 ? 'text-destructive' : 'text-green-600'}`}>{totalSancoes}</p>
                    </div>
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground mt-1">Sanções</p>
                  </div>
                </div>
                {totalRegistros > 0 && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="rounded-xl border bg-background p-4">
                      <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-1">
                        <BarChart3 className="h-3 w-3" /> Distribuição por Categoria
                      </p>
                      <div className="h-48">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={barData} margin={{ top: 5, right: 5, left: 5, bottom: 5 }}>
                            <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                            <XAxis dataKey="categoria" tick={{ fontSize: 11 }} />
                            <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                            <Tooltip contentStyle={{ borderRadius: '8px', fontSize: '12px' }} />
                            <Bar dataKey="registros" radius={[6, 6, 0, 0]}>
                              {barData.map((entry, i) => (
                                <Cell key={i} fill={entry.fill} />
                              ))}
                            </Bar>
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                    <div className="rounded-xl border bg-background p-4">
                      <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-1">
                        <Info className="h-3 w-3" /> Proporção dos Registros
                      </p>
                      <div className="h-48">
                        <ResponsiveContainer width="100%" height="100%">
                          <PieChart>
                            <Pie data={pieData} cx="50%" cy="50%" innerRadius={40} outerRadius={70} paddingAngle={3} dataKey="value"
                              label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`} labelLine={false}>
                              {pieData.map((entry, i) => (<Cell key={i} fill={entry.fill} />))}
                            </Pie>
                            <Tooltip contentStyle={{ borderRadius: '8px', fontSize: '12px' }} />
                          </PieChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                  </div>
                )}
                {totalContratos > 0 && (
                  <details className="group">
                    <summary className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1 cursor-pointer select-none hover:text-foreground transition-colors list-none">
                      <ChevronRight className="h-3 w-3 transition-transform group-open:rotate-90" />
                      <FileText className="h-3 w-3 text-accent" /> Contratos e Licitações ({totalContratos})
                    </summary>
                    <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1 mt-2 ml-4">
                      {resumo.contratos.map((item: string, i: number) => (
                        <RenderLinkedItem key={i} text={item} emoji="📋" variant="accent" />
                      ))}
                    </div>
                  </details>
                )}
                {totalValores > 0 && (
                  <details className="group">
                    <summary className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1 cursor-pointer select-none hover:text-foreground transition-colors list-none">
                      <ChevronRight className="h-3 w-3 transition-transform group-open:rotate-90" />
                      <DollarSign className="h-3 w-3 text-[hsl(153,100%,39%)]" /> Valores Recebidos ({totalValores})
                    </summary>
                    <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1 mt-2 ml-4">
                      {resumo.valoresRecebidos.map((item: string, i: number) => (
                        <RenderLinkedItem key={i} text={item} emoji="💰" variant="success" />
                      ))}
                    </div>
                  </details>
                )}
                {totalSancoes > 0 ? (
                  <details className="group" open>
                    <summary className="text-xs font-bold uppercase tracking-wider flex items-center gap-1 text-destructive cursor-pointer select-none hover:text-destructive/80 transition-colors list-none">
                      <ChevronRight className="h-3 w-3 transition-transform group-open:rotate-90" />
                      <AlertTriangle className="h-3 w-3" /> ⚠️ Sanções e Penalidades ({totalSancoes})
                    </summary>
                    <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1 mt-2 ml-4">
                      {resumo.sancoes.map((item: string, i: number) => (
                        <RenderLinkedItem key={i} text={item} emoji="🚨" variant="destructive" />
                      ))}
                    </div>
                  </details>
                ) : (
                  <div className="flex items-center gap-2 text-sm text-[hsl(153,100%,39%)] p-3 rounded-lg bg-[hsl(153,100%,39%)]/10 border border-[hsl(153,100%,39%)]/20">
                    <ShieldCheck className="h-5 w-5" />
                    <span className="font-medium">Nenhuma sanção ou penalidade encontrada — empresa regular</span>
                  </div>
                )}
                {totalOutras > 0 && (
                  <details className="group">
                    <summary className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1 cursor-pointer select-none hover:text-foreground transition-colors list-none">
                      <ChevronRight className="h-3 w-3 transition-transform group-open:rotate-90" />
                      <Info className="h-3 w-3 text-secondary" /> Outras Informações ({totalOutras})
                    </summary>
                    <div className="space-y-1.5 max-h-36 overflow-y-auto pr-1 mt-2 ml-4">
                      {resumo.outrasInfos.map((item: string, i: number) => (
                        <RenderLinkedItem key={i} text={item} emoji="ℹ️" variant="muted" />
                      ))}
                    </div>
                  </details>
                )}
                <div className="flex items-center justify-between pt-2 border-t">
                  <a href={portalData.url} target="_blank" rel="noopener noreferrer">
                    <Button variant="outline" size="sm" className="gap-2"><ExternalLink className="h-3 w-3" /> Ver no Portal</Button>
                  </a>
                  <Button variant="ghost" size="sm" onClick={buscarPortalTransparencia} className="gap-2 text-xs text-muted-foreground">
                    <Search className="h-3 w-3" /> Consultar novamente
                  </Button>
                </div>
              </div>
            );
          })()}
        </CardContent>
      </Card>

      {/* Dívidas e Pendências */}
      <Card className="border-2 border-destructive/10">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Receipt className="h-5 w-5 text-destructive" />
            Dívidas & Pendências
          </CardTitle>
          <CardDescription>Dívida ativa, protestos em cartório e processos judiciais</CardDescription>
        </CardHeader>
        <CardContent>
          {dividasLoading && (
            <div className="flex flex-col items-center gap-3 py-8">
              <Loader2 className="h-8 w-8 animate-spin text-destructive" />
              <p className="text-sm text-muted-foreground">Buscando dívidas e pendências...</p>
            </div>
          )}
          {dividasError && (
            <div className="space-y-2">
              <p className="text-sm text-destructive">Erro: {dividasError}</p>
              <Button variant="outline" size="sm" onClick={buscarDividas}>Tentar novamente</Button>
            </div>
          )}
          {dividasData && (() => {
            const sections = Object.entries(dividasData) as [string, any][];
            const totalRegistros = sections.reduce((acc, [, s]) => acc + (s.encontrados || 0), 0);
            const totalValores = sections.reduce((acc, [, s]) => acc + (s.valores?.length || 0), 0);
            const chartData = sections.map(([key, section]) => ({
              name: key === 'divida_ativa' ? 'Dívida Ativa' : key === 'protestos' ? 'Protestos' : 'Processos',
              registros: section.encontrados || 0,
              fill: key === 'divida_ativa' ? 'hsl(var(--destructive))' : key === 'protestos' ? 'hsl(30, 90%, 50%)' : 'hsl(280, 60%, 50%)',
            }));
            const riskScore = Math.min(100, totalRegistros * 15 + totalValores * 10);
            const riskLevel = riskScore >= 60 ? 'Alto' : riskScore >= 30 ? 'Moderado' : riskScore > 0 ? 'Baixo' : 'Nenhum';
            const riskColor = riskScore >= 60 ? 'text-destructive' : riskScore >= 30 ? 'text-orange-500' : riskScore > 0 ? 'text-yellow-600' : 'text-green-600';
            const riskBg = riskScore >= 60 ? 'from-destructive/10 to-destructive/5' : riskScore >= 30 ? 'from-orange-500/10 to-orange-500/5' : riskScore > 0 ? 'from-yellow-500/10 to-yellow-500/5' : 'from-green-500/10 to-green-500/5';
            return (
              <div className="space-y-6 animate-fade-in">
                <div className={`rounded-xl p-4 bg-gradient-to-br ${riskBg} border`}>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                    <div className="text-center">
                      <div className={`text-3xl font-black ${riskColor}`}>{riskScore}</div>
                      <p className="text-[10px] uppercase tracking-wider text-muted-foreground mt-1">Score de Risco</p>
                      <Badge className={`mt-1 text-xs ${
                        riskScore >= 60 ? 'bg-destructive/20 text-destructive border-destructive/30' :
                        riskScore >= 30 ? 'bg-orange-100 text-orange-700 border-orange-300' :
                        riskScore > 0 ? 'bg-yellow-100 text-yellow-700 border-yellow-300' :
                        'bg-green-100 text-green-700 border-green-300'
                      }`}>
                        {riskScore >= 60 ? '⚠️' : riskScore >= 30 ? '⚡' : riskScore > 0 ? '📊' : '✅'} {riskLevel}
                      </Badge>
                    </div>
                    <div className="text-center">
                      <div className="text-3xl font-black text-foreground">{totalRegistros}</div>
                      <p className="text-[10px] uppercase tracking-wider text-muted-foreground mt-1">Registros</p>
                    </div>
                    <div className="col-span-2 flex items-center justify-center gap-3">
                      {chartData.map((item, i) => (
                        <div key={i} className="flex flex-col items-center gap-1">
                          <div className="relative w-12 h-12">
                            <svg viewBox="0 0 36 36" className="w-12 h-12 -rotate-90">
                              <circle cx="18" cy="18" r="14" fill="none" stroke="currentColor" strokeWidth="3" className="text-muted/30" />
                              <circle cx="18" cy="18" r="14" fill="none" stroke={item.fill} strokeWidth="3"
                                strokeDasharray={`${Math.min(88, item.registros * 17.6)} 88`} strokeLinecap="round" className="transition-all duration-1000" />
                            </svg>
                            <span className="absolute inset-0 flex items-center justify-center text-xs font-bold">{item.registros}</span>
                          </div>
                          <span className="text-[9px] text-muted-foreground text-center leading-tight">{item.name}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  {sections.map(([key, section]) => {
                    const config = {
                      divida_ativa: { icon: <DollarSign className="h-4 w-4" />, color: 'text-destructive', borderColor: 'border-destructive/30', bgColor: 'bg-destructive/5', emoji: '💰' },
                      protestos: { icon: <Ban className="h-4 w-4" />, color: 'text-orange-600', borderColor: 'border-orange-300', bgColor: 'bg-orange-50 dark:bg-orange-950/20', emoji: '📋' },
                      processos: { icon: <Gavel className="h-4 w-4" />, color: 'text-purple-600', borderColor: 'border-purple-300', bgColor: 'bg-purple-50 dark:bg-purple-950/20', emoji: '⚖️' },
                    }[key] || { icon: <FileText className="h-4 w-4" />, color: 'text-muted-foreground', borderColor: 'border-border', bgColor: 'bg-muted/20', emoji: '📄' };
                    const hasItems = section.items && section.items.length > 0;
                    return (
                      <Card key={key} className={`${config.borderColor} border overflow-hidden`}>
                        <div className={`${config.bgColor} px-3 py-2 border-b ${config.borderColor}`}>
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <span className={config.color}>{config.icon}</span>
                              <span className="text-xs font-bold">{section.label}</span>
                            </div>
                            <Badge variant={hasItems ? "destructive" : "secondary"} className="text-xs">{section.encontrados}</Badge>
                          </div>
                        </div>
                        <div className="p-3">
                          {section.valores && section.valores.length > 0 && (
                            <div className="flex flex-wrap gap-1 mb-3">
                              {section.valores.slice(0, 4).map((v: string, i: number) => (
                                <Badge key={i} variant="outline" className={`text-xs ${config.color} ${config.borderColor}`}>{v}</Badge>
                              ))}
                            </div>
                          )}
                          {hasItems ? (
                            <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
                              {section.items.map((item: any, i: number) => (
                                <a key={i} href={item.url} target="_blank" rel="noopener noreferrer"
                                   className="block text-xs p-2 rounded-md border bg-background hover:bg-accent/50 transition-all hover:shadow-sm group">
                                  <p className="font-medium text-foreground group-hover:text-primary transition-colors line-clamp-1">{config.emoji} {item.titulo}</p>
                                  {item.descricao && <p className="text-muted-foreground mt-0.5 line-clamp-2 leading-relaxed">{item.descricao}</p>}
                                  <div className="flex items-center gap-1 mt-1.5 text-[10px] text-muted-foreground">
                                    <ExternalLink className="h-2.5 w-2.5" /> {item.fonte}
                                  </div>
                                </a>
                              ))}
                            </div>
                          ) : (
                            <div className="flex items-center gap-2 text-xs text-green-600 py-3 justify-center">
                              <ShieldCheck className="h-4 w-4" /> <span className="font-medium">Nenhum registro</span>
                            </div>
                          )}
                        </div>
                      </Card>
                    );
                  })}
                </div>
                <div className="flex justify-center">
                  <Button variant="ghost" size="sm" onClick={buscarDividas} className="gap-2 text-xs text-muted-foreground">
                    <Search className="h-3 w-3" /> Buscar novamente
                  </Button>
                </div>
              </div>
            );
          })()}
        </CardContent>
      </Card>
        </TabsContent>

        {/* TAB: Garantias */}
        <TabsContent value="garantias" className="space-y-4">
      {/* Garantias & Patrimônio */}
      <Card className="border-2 border-emerald-500/10">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Shield className="h-5 w-5 text-emerald-600" />
            Garantias & Patrimônio
          </CardTitle>
          <CardDescription>Imóveis, veículos, patrimônio e capacidade de garantia da empresa</CardDescription>
        </CardHeader>
        <CardContent>
          {garantiasLoading && (
            <div className="flex flex-col items-center gap-3 py-8">
              <Loader2 className="h-8 w-8 animate-spin text-emerald-600" />
              <p className="text-sm text-muted-foreground">Verificando patrimônio e garantias...</p>
            </div>
          )}
          {garantiasError && (
            <div className="space-y-2">
              <p className="text-sm text-destructive">Erro: {garantiasError}</p>
              <Button variant="outline" size="sm" onClick={buscarGarantias}>Tentar novamente</Button>
            </div>
          )}
          {garantiasData && (() => {
            const est = garantiasData.estimativa;
            const sections = Object.entries(garantiasData.garantias) as [string, any][];
            const fmtVal = (v: number) => v >= 1_000_000_000 ? `R$ ${(v / 1_000_000_000).toFixed(1)}B` : v >= 1_000_000 ? `R$ ${(v / 1_000_000).toFixed(1)}M` : v >= 1_000 ? `R$ ${(v / 1_000).toFixed(0)}K` : `R$ ${v}`;
            const capColor = est.capacidadeGarantia === 'alta' ? 'text-emerald-600' :
                             est.capacidadeGarantia === 'média' ? 'text-yellow-600' :
                             est.capacidadeGarantia === 'baixa' ? 'text-orange-500' : 'text-red-500';
            const capBg = est.capacidadeGarantia === 'alta' ? 'from-emerald-500/10 to-emerald-500/5' :
                          est.capacidadeGarantia === 'média' ? 'from-yellow-500/10 to-yellow-500/5' :
                          est.capacidadeGarantia === 'baixa' ? 'from-orange-500/10 to-orange-500/5' : 'from-red-500/10 to-red-500/5';
            return (
              <div className="space-y-6 animate-fade-in">
                <div className={`rounded-xl p-4 bg-gradient-to-br ${capBg} border`}>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                    <div className="text-center">
                      <p className={`text-2xl font-black ${capColor}`}>{fmtVal(est.patrimonioEstimado)}</p>
                      <p className="text-[10px] uppercase tracking-wider text-muted-foreground mt-1">Patrimônio Est.</p>
                    </div>
                    <div className="text-center">
                      <p className="text-lg font-bold text-foreground">{fmtVal(est.garantiaMinima)}</p>
                      <p className="text-[10px] uppercase tracking-wider text-muted-foreground mt-1">Garantia Mín.</p>
                    </div>
                    <div className="text-center">
                      <p className="text-lg font-bold text-foreground">{fmtVal(est.garantiaMaxima)}</p>
                      <p className="text-[10px] uppercase tracking-wider text-muted-foreground mt-1">Garantia Máx.</p>
                    </div>
                    <div className="text-center flex flex-col items-center justify-center">
                      <Badge className={`text-xs ${
                        est.capacidadeGarantia === 'alta' ? 'bg-emerald-100 text-emerald-700 border-emerald-300' :
                        est.capacidadeGarantia === 'média' ? 'bg-yellow-100 text-yellow-700 border-yellow-300' :
                        est.capacidadeGarantia === 'baixa' ? 'bg-orange-100 text-orange-700 border-orange-300' :
                        'bg-red-100 text-red-700 border-red-300'
                      }`}>
                        {est.capacidadeGarantia === 'alta' ? '🟢' : est.capacidadeGarantia === 'média' ? '🟡' : est.capacidadeGarantia === 'baixa' ? '🟠' : '🔴'} {est.capacidadeGarantia.charAt(0).toUpperCase() + est.capacidadeGarantia.slice(1)}
                      </Badge>
                      <p className="text-[10px] uppercase tracking-wider text-muted-foreground mt-2">Capacidade</p>
                    </div>
                  </div>
                  <div className="mt-4">
                    <div className="flex justify-between text-[10px] text-muted-foreground mb-1">
                      <span>Garantia Mínima (30%)</span>
                      <span>Garantia Máxima (70%)</span>
                    </div>
                    <div className="relative h-4 rounded-full bg-muted overflow-hidden">
                      <div className="absolute left-0 top-0 h-full rounded-full bg-gradient-to-r from-emerald-400 to-emerald-600 transition-all duration-1000" style={{ width: '70%' }} />
                      <div className="absolute left-0 top-0 h-full rounded-full bg-emerald-700/50" style={{ width: '30%' }} />
                    </div>
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  {sections.map(([key, section]) => {
                    const config = {
                      imoveis: { icon: <Home className="h-4 w-4" />, color: 'text-blue-600', borderColor: 'border-blue-300', bgColor: 'bg-blue-50 dark:bg-blue-950/20', emoji: '🏢' },
                      veiculos: { icon: <Car className="h-4 w-4" />, color: 'text-amber-600', borderColor: 'border-amber-300', bgColor: 'bg-amber-50 dark:bg-amber-950/20', emoji: '🚗' },
                      patrimonio: { icon: <Briefcase className="h-4 w-4" />, color: 'text-emerald-600', borderColor: 'border-emerald-300', bgColor: 'bg-emerald-50 dark:bg-emerald-950/20', emoji: '💼' },
                    }[key] || { icon: <FileText className="h-4 w-4" />, color: 'text-muted-foreground', borderColor: 'border-border', bgColor: 'bg-muted/20', emoji: '📄' };
                    const hasItems = section.items && section.items.length > 0;
                    return (
                      <Card key={key} className={`${config.borderColor} border overflow-hidden`}>
                        <div className={`${config.bgColor} px-3 py-2 border-b ${config.borderColor}`}>
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <span className={config.color}>{config.icon}</span>
                              <span className="text-xs font-bold">{section.label}</span>
                            </div>
                            <Badge variant={hasItems ? "default" : "secondary"} className="text-xs">{section.encontrados}</Badge>
                          </div>
                        </div>
                        <div className="p-3">
                          {hasItems ? (
                            <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                              {section.items.map((item: any, i: number) => (
                                <a key={i} href={item.url} target="_blank" rel="noopener noreferrer"
                                   className="block text-xs p-2 rounded-md border bg-background hover:bg-accent/50 transition-all hover:shadow-sm group">
                                  <p className="font-medium text-foreground group-hover:text-primary transition-colors line-clamp-1">{config.emoji} {item.titulo}</p>
                                  {item.descricao && <p className="text-muted-foreground mt-0.5 line-clamp-2">{item.descricao}</p>}
                                  {(item.valores?.length > 0 || item.areas?.length > 0) && (
                                    <div className="flex flex-wrap gap-1 mt-1.5">
                                      {item.valores?.map((v: string, vi: number) => (
                                        <Badge key={`v${vi}`} variant="outline" className={`text-[10px] ${config.color} ${config.borderColor}`}>💰 {v}</Badge>
                                      ))}
                                      {item.areas?.map((a: string, ai: number) => (
                                        <Badge key={`a${ai}`} variant="outline" className="text-[10px]">📐 {a}</Badge>
                                      ))}
                                    </div>
                                  )}
                                  <div className="flex items-center gap-1 mt-1 text-[10px] text-muted-foreground">
                                    <ExternalLink className="h-2.5 w-2.5" /> {item.fonte}
                                  </div>
                                </a>
                              ))}
                            </div>
                          ) : (
                            <div className="flex items-center gap-2 text-xs text-muted-foreground py-3 justify-center">
                              <Search className="h-3 w-3" /> Nenhum registro público encontrado
                            </div>
                          )}
                        </div>
                      </Card>
                    );
                  })}
                </div>
                <div className="flex items-start gap-2 p-3 rounded-lg bg-muted/50 border text-xs text-muted-foreground">
                  <Info className="h-4 w-4 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="font-semibold mb-1">Sobre as Garantias</p>
                    <p>Patrimônio estimado com base no Capital Social × Fator Porte ({est.multiplicador}x). A faixa de garantia (30-70%) representa a capacidade típica de oferecer bens como colateral.</p>
                  </div>
                </div>
                <div className="flex justify-center">
                  <Button variant="ghost" size="sm" onClick={buscarGarantias} className="gap-2 text-xs text-muted-foreground">
                    <Search className="h-3 w-3" /> Buscar novamente
                  </Button>
                </div>
              </div>
            );
          })()}
        </CardContent>
      </Card>
        </TabsContent>

        {/* TAB: Contatos */}
        <TabsContent value="contatos" className="space-y-4">
      {empresa.qsa && empresa.qsa.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Users className="h-4 w-4" />
              Sócios & Contato ({empresa.qsa.length})
            </CardTitle>
            <CardDescription>Busca automática de emails e telefones dos sócios</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {empresa.qsa.map((socio, i) => (
                <SocioContactCard key={i} socio={socio} empresa={empresa} />
              ))}
            </div>
          </CardContent>
        </Card>
      )}
      {(!empresa.qsa || empresa.qsa.length === 0) && (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            Nenhum sócio encontrado no cadastro.
          </CardContent>
        </Card>
      )}
        </TabsContent>
      </Tabs>
    </div>
  );
}


function SocioContactCard({ socio, empresa }: { socio: { nome_socio: string; qualificacao_socio: string }; empresa: CnpjData }) {
  const [emailResults, setEmailResults] = useState<{ valor: string; fonte: string }[]>([]);
  const [phoneResults, setPhoneResults] = useState<{ valor: string; fonte: string }[]>([]);
  const [emailLoading, setEmailLoading] = useState(false);
  const [phoneLoading, setPhoneLoading] = useState(false);
  const [emailSearched, setEmailSearched] = useState(false);
  const [phoneSearched, setPhoneSearched] = useState(false);
  const [resumo, setResumo] = useState<string | null>(null);
  const [showResumo, setShowResumo] = useState(false);

  // Auto-search on mount for decisores (administradores/diretores)
  useEffect(() => {
    const qualUpper = socio.qualificacao_socio?.toUpperCase() || '';
    const isDecisor = ['ADMINISTRADOR', 'DIRETOR', 'PRESIDENTE', 'SÓCIO-ADMINISTRADOR', 'PROCURADOR'].some(q => qualUpper.includes(q));
    if (isDecisor) {
      buscarContato('email');
      buscarContato('whatsapp');
    }
  }, []);

  const buscarContato = async (tipo: 'email' | 'whatsapp') => {
    const setLoading = tipo === 'email' ? setEmailLoading : setPhoneLoading;
    const setResults = tipo === 'email' ? setEmailResults : setPhoneResults;
    const setSearched = tipo === 'email' ? setEmailSearched : setPhoneSearched;

    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('buscar-contato', {
        body: {
          nome: socio.nome_socio,
          empresa: empresa.nome_fantasia || empresa.razao_social,
          tipo,
        },
      });
      if (error) throw error;
      setResults(data?.contatos || []);
      if (data?.resumo) setResumo(data.resumo);
    } catch (err) {
      console.error(`Erro buscando ${tipo}:`, err);
    } finally {
      setLoading(false);
      setSearched(true);
    }
  };

  const qualUpper = socio.qualificacao_socio?.toUpperCase() || '';
  const isDecisor = ['ADMINISTRADOR', 'DIRETOR', 'PRESIDENTE', 'SÓCIO-ADMINISTRADOR', 'PROCURADOR'].some(q => qualUpper.includes(q));

  const formatFonte = (fonte: string) => {
    try { return new URL(fonte).hostname; } catch { return fonte; }
  };

  return (
    <div className={`p-3 rounded-lg border space-y-3 ${isDecisor ? 'bg-primary/5 border-primary/20' : 'bg-muted/30'}`}>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {isDecisor && (
            <Badge variant="outline" className="text-[10px] border-primary/30 text-primary">
              Decisor
            </Badge>
          )}
          <div>
            <p className="font-medium text-foreground">{socio.nome_socio}</p>
            <p className="text-xs text-muted-foreground">{socio.qualificacao_socio}</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5 text-xs"
            onClick={() => buscarContato('email')}
            disabled={emailLoading}
          >
            {emailLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Mail className="h-3 w-3" />}
            {emailSearched ? 'Rebuscar Email' : 'Buscar Email'}
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5 text-xs text-green-700"
            onClick={() => buscarContato('whatsapp')}
            disabled={phoneLoading}
          >
            {phoneLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <MessageCircle className="h-3 w-3" />}
            {phoneSearched ? 'Rebuscar WhatsApp' : 'Buscar WhatsApp'}
          </Button>
          <a
            href={`https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(socio.nome_socio)}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            <Button size="sm" variant="outline" className="gap-1.5 text-xs">
              <ExternalLink className="h-3 w-3" />
              LinkedIn
            </Button>
          </a>
          <a
            href={`https://www.instagram.com/explore/search/keyword/?q=${encodeURIComponent(socio.nome_socio)}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            <Button size="sm" variant="outline" className="gap-1.5 text-xs">
              <ExternalLink className="h-3 w-3" />
              Instagram
            </Button>
          </a>
          <a
            href={`https://www.google.com/search?q=${encodeURIComponent(socio.nome_socio + " " + (empresa.nome_fantasia || empresa.razao_social))}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            <Button size="sm" variant="outline" className="gap-1.5 text-xs">
              <Search className="h-3 w-3" />
              Google
            </Button>
          </a>
        </div>
      </div>

      {/* Loading state */}
      {(emailLoading || phoneLoading) && !emailSearched && !phoneSearched && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground pl-0 sm:pl-4">
          <Loader2 className="h-3 w-3 animate-spin" />
          Buscando contatos automaticamente...
        </div>
      )}

      {/* Combined results row */}
      {(emailSearched || phoneSearched) && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pl-0 sm:pl-4">
          {/* Emails */}
          {emailSearched && (
            <div>
              <p className="text-xs font-semibold text-muted-foreground mb-1.5">📧 Emails</p>
              {emailResults.length > 0 ? (
                <div className="space-y-1">
                  {emailResults.map((c, i) => (
                    <a key={i} href={`mailto:${c.valor}`} className="flex items-center gap-2 text-xs p-1.5 rounded border bg-background hover:bg-accent transition-colors">
                      <Mail className="h-3 w-3 text-primary flex-shrink-0" />
                      <span className="font-medium text-primary truncate">{c.valor}</span>
                      <span className="text-muted-foreground ml-auto text-[10px] flex-shrink-0">{formatFonte(c.fonte)}</span>
                    </a>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground italic">Nenhum email encontrado</p>
              )}
            </div>
          )}

          {/* Telefones/WhatsApp */}
          {phoneSearched && (
            <div>
              <p className="text-xs font-semibold text-muted-foreground mb-1.5">📱 WhatsApp / Telefone</p>
              {phoneResults.length > 0 ? (
                <div className="space-y-1">
                  {phoneResults.map((c, i) => (
                    <a key={i} href={`https://wa.me/55${c.valor.replace(/\D/g, '')}`} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-xs p-1.5 rounded border bg-background hover:bg-accent transition-colors">
                      <MessageCircle className="h-3 w-3 text-green-600 flex-shrink-0" />
                      <span className="font-medium text-green-700">{c.valor}</span>
                      <span className="text-muted-foreground ml-auto text-[10px] flex-shrink-0">{formatFonte(c.fonte)}</span>
                    </a>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground italic">Nenhum telefone encontrado</p>
              )}
            </div>
          )}
        </div>
      )}

      {/* Resumo expandível */}
      {resumo && (
        <div className="pl-0 sm:pl-4">
          <button onClick={() => setShowResumo(!showResumo)} className="text-[10px] text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors">
            <Info className="h-3 w-3" />
            {showResumo ? 'Ocultar detalhes da pesquisa' : 'Ver detalhes da pesquisa'}
          </button>
          {showResumo && (
            <div className="mt-2 p-2 rounded bg-muted/50 border text-xs text-muted-foreground whitespace-pre-wrap max-h-40 overflow-y-auto">
              {resumo}
            </div>
          )}
        </div>
      )}
    </div>
  );
}



function InfoItem({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`text-sm font-medium ${highlight ? "text-primary text-lg" : "text-foreground"}`}>{value}</p>
    </div>
  );
}
