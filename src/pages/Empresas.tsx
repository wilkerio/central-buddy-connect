import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { fetchCnpj, fetchAllInstituicoesFinanceiras, CNPJS_POOL, type CnpjData } from "@/lib/empresa-api";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Building2, Landmark, ArrowLeft, Users, Search, X, Phone, Mail, MessageCircle, ExternalLink, Loader2, Pause, Play, Globe, TrendingUp, ShieldCheck, AlertTriangle, FileText, Scale, DollarSign, Gavel, Ban, Receipt, BarChart3, Info, Home, Car, Briefcase, Shield, CheckCircle2, XCircle, HelpCircle, Zap } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { Link } from "react-router-dom";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, PieChart, Pie, Legend } from "recharts";

const SEARCH_INTERVAL = 8000;

function shuffleArray<T>(arr: T[]): T[] {
  const shuffled = [...arr];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
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
  const [isRunning, setIsRunning] = useState(true);
  const [currentSearch, setCurrentSearch] = useState<string | null>(null);
  const [filterText, setFilterText] = useState("");
  const [filterIf, setFilterIf] = useState("");
  const [cnpjManual, setCnpjManual] = useState("");
  const [isManualLoading, setIsManualLoading] = useState(false);
  const [dbLoaded, setDbLoaded] = useState(false);
  const queueRef = useRef<string[]>([]);
  const fetchedRef = useRef<Set<string>>(new Set());

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

  const fetchNext = useCallback(async () => {
    if (queueRef.current.length === 0) {
      queueRef.current = shuffleArray(CNPJS_POOL.filter(c => !fetchedRef.current.has(c)));
      if (queueRef.current.length === 0) {
        // All fetched, reset
        fetchedRef.current.clear();
        queueRef.current = shuffleArray([...CNPJS_POOL]);
      }
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

  useEffect(() => {
    if (!isRunning || !dbLoaded) return;

    // Initial fetch immediately
    fetchNext();

    const interval = setInterval(fetchNext, SEARCH_INTERVAL);
    return () => clearInterval(interval);
  }, [isRunning, dbLoaded, fetchNext]);

  const filteredEmpresas = empresas.filter(e =>
    !filterText ||
    e.razao_social.toLowerCase().includes(filterText.toLowerCase()) ||
    (e.nome_fantasia && e.nome_fantasia.toLowerCase().includes(filterText.toLowerCase())) ||
    e.cnpj.includes(filterText.replace(/\D/g, ""))
  );

  const formatCurrency = (val: number) =>
    val.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

  const formatCnpj = (val: string) =>
    val.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center gap-3">
          <Link to="/">
            <Button variant="ghost" size="icon">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div className="bg-accent rounded-lg p-2">
            <Building2 className="h-5 w-5 text-accent-foreground" />
          </div>
          <div className="flex-1">
            <h1 className="text-lg font-bold text-foreground">Empresas & Capital</h1>
            <p className="text-xs text-muted-foreground">
              Busca contínua automática · {empresas.length} empresas encontradas
            </p>
          </div>
          <Button
            variant={isRunning ? "destructive" : "default"}
            size="sm"
            onClick={() => setIsRunning(!isRunning)}
            className="gap-2"
          >
            {isRunning ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            {isRunning ? "Pausar" : "Retomar"}
          </Button>
        </div>
        {/* Search status bar */}
        {isRunning && currentSearch && (
          <div className="border-t bg-muted/50 px-4 py-1.5">
            <div className="max-w-6xl mx-auto flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              Buscando CNPJ {formatCnpj(currentSearch)}...
            </div>
          </div>
        )}
      </header>

      <main className="max-w-6xl mx-auto px-4 py-8">
        {selectedEmpresa ? (
          <EmpresaDetail empresa={selectedEmpresa} onBack={() => setSelectedEmpresa(null)} formatCurrency={formatCurrency} formatCnpj={formatCnpj} />
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

              <div className="flex items-center gap-3">
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
                {isRunning && (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="relative flex h-2 w-2">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-primary"></span>
                    </span>
                    Buscando...
                  </div>
                )}
              </div>

              {filteredEmpresas.length === 0 && empresas.length === 0 ? (
                <div className="flex flex-col items-center gap-3 py-12">
                  <Loader2 className="h-8 w-8 animate-spin text-primary" />
                  <p className="text-muted-foreground">Buscando empresas automaticamente...</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {filteredEmpresas.map((empresa) => {
                    const credito = calcularPotencialCreditoInternacional(empresa);
                    return (
                    <Card
                      key={empresa.cnpj}
                      className="cursor-pointer transition-all hover:shadow-lg hover:-translate-y-0.5 hover:border-primary/30 animate-in fade-in slide-in-from-top-2 duration-500"
                      onClick={() => setSelectedEmpresa(empresa)}
                    >
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-medium text-muted-foreground leading-tight">
                          {empresa.nome_fantasia || empresa.razao_social}
                        </CardTitle>
                        {empresa.nome_fantasia && (
                          <CardDescription className="text-xs truncate">{empresa.razao_social}</CardDescription>
                        )}
                      </CardHeader>
                      <CardContent className="space-y-2">
                        <p className="text-lg font-bold text-primary">
                          {formatCurrency(empresa.capital_social)}
                        </p>
                        <div className="flex items-center gap-2 flex-wrap">
                          <Badge variant={empresa.situacao_cadastral === "ATIVA" ? "default" : "destructive"} className="text-xs">
                            {empresa.situacao_cadastral}
                          </Badge>
                          <span className="text-xs text-muted-foreground">{empresa.porte}</span>
                        </div>
                        <p className="text-xs text-muted-foreground truncate">
                          {empresa.municipio}/{empresa.uf}
                        </p>

                        {/* Potencial Crédito Internacional */}
                        <div className="pt-1 border-t">
                          <div className="flex items-center justify-between mb-1">
                            <p className="text-xs font-medium flex items-center gap-1">
                              <Globe className="h-3 w-3" />
                              Crédito Internacional
                            </p>
                            <span className={`text-xs font-bold ${credito.cor}`}>
                              {credito.score}%
                            </span>
                          </div>
                          <Progress value={credito.score} className="h-1.5" />
                          <div className="flex items-center justify-between mt-1">
                            <span className={`text-[10px] font-semibold uppercase ${credito.cor}`}>
                              {credito.nivel === "alto" ? "🔥 Alto" : credito.nivel === "medio" ? "⚡ Médio" : credito.nivel === "baixo" ? "📊 Baixo" : "⚠️ Muito Baixo"}
                            </span>
                            {credito.decisores > 0 && (
                              <span className="text-[10px] text-muted-foreground">
                                {credito.decisores} decisor{credito.decisores > 1 ? "es" : ""}
                              </span>
                            )}
                          </div>
                        </div>




                        {/* Contato direto */}
                        <div className="flex flex-wrap gap-1.5 pt-1 border-t">
                          {empresa.email && (
                            <a href={`mailto:${empresa.email}`} onClick={(e) => e.stopPropagation()} title={empresa.email}>
                              <Badge variant="secondary" className="gap-1 text-xs cursor-pointer hover:bg-accent">
                                <Mail className="h-3 w-3" />
                                Email
                              </Badge>
                            </a>
                          )}
                          {empresa.ddd_telefone_1 && (
                            <a
                              href={`https://wa.me/55${empresa.ddd_telefone_1.replace(/\D/g, "")}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              title={empresa.ddd_telefone_1}
                            >
                              <Badge variant="secondary" className="gap-1 text-xs cursor-pointer hover:bg-accent text-green-700">
                                <MessageCircle className="h-3 w-3" />
                                WhatsApp
                              </Badge>
                            </a>
                          )}
                          {empresa.ddd_telefone_1 && (
                            <a href={`tel:${empresa.ddd_telefone_1}`} onClick={(e) => e.stopPropagation()} title={empresa.ddd_telefone_1}>
                              <Badge variant="secondary" className="gap-1 text-xs cursor-pointer hover:bg-accent">
                                <Phone className="h-3 w-3" />
                                {empresa.ddd_telefone_1}
                              </Badge>
                            </a>
                          )}
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

function EmpresaDetail({ empresa, onBack, formatCurrency, formatCnpj }: {
  empresa: CnpjData;
  onBack: () => void;
  formatCurrency: (v: number) => string;
  formatCnpj: (v: string) => string;
}) {
  const credito = calcularPotencialCreditoInternacional(empresa);
  const [portalData, setPortalData] = useState<any>(null);
  const [portalLoading, setPortalLoading] = useState(false);
  const [portalError, setPortalError] = useState<string | null>(null);
  const [dividasData, setDividasData] = useState<any>(null);
  const [dividasLoading, setDividasLoading] = useState(false);
  const [dividasError, setDividasError] = useState<string | null>(null);
  const [faturamentoData, setFaturamentoData] = useState<any>(null);
  const [faturamentoLoading, setFaturamentoLoading] = useState(false);
  const [faturamentoError, setFaturamentoError] = useState<string | null>(null);
  const [garantiasData, setGarantiasData] = useState<any>(null);
  const [garantiasLoading, setGarantiasLoading] = useState(false);
  const [garantiasError, setGarantiasError] = useState<string | null>(null);
  const [creditoIntData, setCreditoIntData] = useState<any>(null);
  const [creditoIntLoading, setCreditoIntLoading] = useState(false);
  const [creditoIntError, setCreditoIntError] = useState<string | null>(null);
  const [endividamentoData, setEndividamentoData] = useState<any>(null);
  const [endividamentoLoading, setEndividamentoLoading] = useState(false);
  const [endividamentoError, setEndividamentoError] = useState<string | null>(null);

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

  const buscarFaturamento = async () => {
    setFaturamentoLoading(true);
    setFaturamentoError(null);
    try {
      const { data, error } = await supabase.functions.invoke('buscar-faturamento', {
        body: {
          cnpj: empresa.cnpj,
          razao_social: empresa.razao_social,
          capital_social: empresa.capital_social,
          cnae_fiscal: empresa.cnae_fiscal,
          porte: empresa.porte,
          data_inicio_atividade: empresa.data_inicio_atividade,
        },
      });
      if (error) throw new Error(error.message);
      if (!data?.success) throw new Error(data?.error || 'Erro desconhecido');
      setFaturamentoData(data);
    } catch (err: any) {
      setFaturamentoError(err.message);
    } finally {
      setFaturamentoLoading(false);
    }
  };

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
      {/* DESTAQUE: Crédito Internacional Verificado */}
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
          {!creditoIntData && !creditoIntLoading && !creditoIntError && (
            <Button onClick={verificarCreditoInternacional} className="gap-2">
              <Globe className="h-4 w-4" />
              Verificar Crédito Internacional
            </Button>
          )}

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

      {/* Faturamento Estimado */}
      <Card className="border-2 border-primary/10">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <BarChart3 className="h-5 w-5 text-primary" />
            Faturamento Estimado
          </CardTitle>
          <CardDescription>Estimativa baseada em dados públicos + busca de dados reais na web</CardDescription>
        </CardHeader>
        <CardContent>
          {!faturamentoData && !faturamentoLoading && !faturamentoError && (
            <Button onClick={buscarFaturamento} className="gap-2">
              <BarChart3 className="h-4 w-4" />
              Calcular Faturamento Estimado
            </Button>
          )}

          {faturamentoLoading && (
            <div className="flex flex-col items-center gap-3 py-8">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="text-sm text-muted-foreground">Calculando estimativa e buscando dados reais...</p>
            </div>
          )}

          {faturamentoError && (
            <div className="space-y-2">
              <p className="text-sm text-destructive">Erro: {faturamentoError}</p>
              <Button variant="outline" size="sm" onClick={buscarFaturamento}>Tentar novamente</Button>
            </div>
          )}

          {faturamentoData && (() => {
            const est = faturamentoData.estimativa;
            const mensal = est.mensal || [];
            const maxVal = Math.max(...mensal.map((m: any) => m.valor));
            const fmtVal = (v: number) => v >= 1_000_000_000 ? `R$ ${(v / 1_000_000_000).toFixed(1)}B` : v >= 1_000_000 ? `R$ ${(v / 1_000_000).toFixed(1)}M` : v >= 1_000 ? `R$ ${(v / 1_000).toFixed(0)}K` : `R$ ${v}`;

            return (
              <div className="space-y-6 animate-fade-in">
                {/* Summary Cards */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div className="rounded-xl bg-gradient-to-br from-primary/10 to-primary/5 border border-primary/20 p-3 text-center">
                    <p className="text-2xl font-black text-primary">{fmtVal(est.anual)}</p>
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground mt-1">Faturamento Anual Est.</p>
                  </div>
                  <div className="rounded-xl bg-gradient-to-br from-accent/30 to-accent/10 border p-3 text-center">
                    <p className="text-2xl font-black text-foreground">{fmtVal(Math.round(est.anual / 12))}</p>
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground mt-1">Média Mensal</p>
                  </div>
                  <div className="rounded-xl bg-muted/50 border p-3 text-center">
                    <p className="text-lg font-bold text-foreground">{est.setor}</p>
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground mt-1">Setor</p>
                  </div>
                  <div className="rounded-xl bg-muted/50 border p-3 text-center">
                    <Badge className={`text-xs ${
                      est.confianca === 'média' ? 'bg-yellow-100 text-yellow-700 border-yellow-300' :
                      est.confianca === 'baixa' ? 'bg-orange-100 text-orange-700 border-orange-300' :
                      'bg-red-100 text-red-700 border-red-300'
                    }`}>
                      {est.confianca === 'média' ? '⚡' : '⚠️'} Confiança {est.confianca}
                    </Badge>
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground mt-2">Precisão</p>
                  </div>
                </div>

                {/* Monthly Chart */}
                <div>
                  <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-1">
                    <TrendingUp className="h-3 w-3" />
                    Projeção Mensal (com sazonalidade)
                  </p>
                  <div className="h-56 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={mensal} margin={{ top: 5, right: 5, left: 5, bottom: 5 }}>
                        <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                        <XAxis dataKey="mes" tick={{ fontSize: 11 }} />
                        <YAxis tick={{ fontSize: 10 }} tickFormatter={(v: number) => fmtVal(v)} width={65} />
                        <Tooltip
                          formatter={(value: number) => [fmtVal(value), 'Faturamento']}
                          contentStyle={{ borderRadius: '8px', fontSize: '12px' }}
                        />
                        <Bar dataKey="valor" radius={[4, 4, 0, 0]}>
                          {mensal.map((entry: any, i: number) => (
                            <Cell
                              key={i}
                              fill={entry.valor >= maxVal * 0.9 ? 'hsl(var(--primary))' : entry.valor >= maxVal * 0.7 ? 'hsl(var(--primary) / 0.7)' : 'hsl(var(--primary) / 0.4)'}
                            />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                {/* Methodology */}
                <div className="flex items-start gap-2 p-3 rounded-lg bg-muted/50 border text-xs text-muted-foreground">
                  <Info className="h-4 w-4 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="font-semibold mb-1">Metodologia da Estimativa</p>
                    <p>{est.metodologia}</p>
                  </div>
                </div>

                {/* Web Data */}
                {faturamentoData.dadosWeb && faturamentoData.dadosWeb.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                      <Globe className="h-3 w-3" />
                      Dados Reais Encontrados na Web
                    </p>
                    <div className="space-y-1.5">
                      {faturamentoData.dadosWeb.map((item: any, i: number) => (
                        <a
                          key={i}
                          href={item.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="block text-xs p-3 rounded-lg border bg-background hover:bg-accent/50 transition-all hover:shadow-sm group"
                        >
                          <p className="font-medium text-foreground group-hover:text-primary transition-colors line-clamp-1">
                            {item.titulo}
                          </p>
                          {item.descricao && (
                            <p className="text-muted-foreground mt-0.5 line-clamp-2">{item.descricao}</p>
                          )}
                          {item.valoresEncontrados && item.valoresEncontrados.length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-2">
                              {item.valoresEncontrados.map((v: string, vi: number) => (
                                <Badge key={vi} variant="outline" className="text-xs text-primary border-primary/30">
                                  💰 {v}
                                </Badge>
                              ))}
                            </div>
                          )}
                          <div className="flex items-center gap-1 mt-1.5 text-[10px] text-muted-foreground">
                            <ExternalLink className="h-2.5 w-2.5" />
                            {item.fonte}
                          </div>
                        </a>
                      ))}
                    </div>
                  </div>
                )}

                {/* Refresh */}
                <div className="flex justify-center">
                  <Button variant="ghost" size="sm" onClick={buscarFaturamento} className="gap-2 text-xs text-muted-foreground">
                    <Search className="h-3 w-3" />
                    Recalcular
                  </Button>
                </div>
              </div>
            );
          })()}
        </CardContent>
      </Card>


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
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <InfoItem label="CNPJ" value={formatCnpj(empresa.cnpj)} />
            <InfoItem label="Capital Social" value={formatCurrency(empresa.capital_social)} highlight />
            <InfoItem label="Porte" value={empresa.porte} />
            <InfoItem label="Natureza Jurídica" value={empresa.natureza_juridica} />
            <InfoItem label="CNAE" value={empresa.cnae_fiscal_descricao} />
            <InfoItem label="Início Atividade" value={empresa.data_inicio_atividade} />
            <InfoItem
              label="Endereço"
              value={`${empresa.logradouro}, ${empresa.numero} - ${empresa.bairro}, ${empresa.municipio}/${empresa.uf}`}
            />
          </div>
        </CardContent>
      </Card>

      {/* Contato da Empresa */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Phone className="h-4 w-4" />
            Contato da Empresa
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-3">
            {empresa.ddd_telefone_1 && (
              <>
                <a
                  href={`https://wa.me/55${empresa.ddd_telefone_1.replace(/\D/g, "")}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <Button variant="outline" className="gap-2 text-green-600 border-green-200 hover:bg-green-50 hover:text-green-700">
                    <MessageCircle className="h-4 w-4" />
                    WhatsApp
                  </Button>
                </a>
                <a href={`tel:${empresa.ddd_telefone_1}`}>
                  <Button variant="outline" className="gap-2">
                    <Phone className="h-4 w-4" />
                    {empresa.ddd_telefone_1}
                  </Button>
                </a>
              </>
            )}
            {empresa.email && (
              <a href={`mailto:${empresa.email}`}>
                <Button variant="outline" className="gap-2 text-blue-600 border-blue-200 hover:bg-blue-50 hover:text-blue-700">
                  <Mail className="h-4 w-4" />
                  {empresa.email}
                </Button>
              </a>
            )}
            {!empresa.ddd_telefone_1 && !empresa.email && (
              <p className="text-sm text-muted-foreground">Nenhum contato disponível na Receita Federal.</p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Portal da Transparência */}
      <Card className="border-2 border-indigo-500/20 overflow-hidden">
        {/* Header with gradient */}
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
          {!portalData && !portalLoading && !portalError && (
            <Button onClick={buscarPortalTransparencia} className="gap-2 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 text-white">
              <Scale className="h-4 w-4" />
              Consultar Portal da Transparência
            </Button>
          )}

          {portalLoading && (
            <div className="flex flex-col items-center gap-3 py-8">
              <Loader2 className="h-8 w-8 animate-spin text-indigo-600" />
              <p className="text-sm text-muted-foreground">Consultando dados no Portal da Transparência...</p>
              <div className="flex gap-6 text-xs text-muted-foreground">
                <span className="animate-pulse">Contratos...</span>
                <span className="animate-pulse" style={{ animationDelay: '0.3s' }}>Licitações...</span>
                <span className="animate-pulse" style={{ animationDelay: '0.6s' }}>Sanções...</span>
              </div>
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

            // Chart data for distribution
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
                {/* Summary Cards */}
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

                {/* Charts Row */}
                {totalRegistros > 0 && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* Bar Chart */}
                    <div className="rounded-xl border bg-background p-4">
                      <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-1">
                        <BarChart3 className="h-3 w-3" />
                        Distribuição por Categoria
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

                    {/* Pie Chart */}
                    <div className="rounded-xl border bg-background p-4">
                      <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-1">
                        <Info className="h-3 w-3" />
                        Proporção dos Registros
                      </p>
                      <div className="h-48">
                        <ResponsiveContainer width="100%" height="100%">
                          <PieChart>
                            <Pie
                              data={pieData}
                              cx="50%"
                              cy="50%"
                              innerRadius={40}
                              outerRadius={70}
                              paddingAngle={3}
                              dataKey="value"
                              label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                              labelLine={false}
                            >
                              {pieData.map((entry, i) => (
                                <Cell key={i} fill={entry.fill} />
                              ))}
                            </Pie>
                            <Tooltip contentStyle={{ borderRadius: '8px', fontSize: '12px' }} />
                          </PieChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                  </div>
                )}

                {/* Contratos */}
                {totalContratos > 0 && (
                  <div className="space-y-2">
                    <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                      <FileText className="h-3 w-3 text-indigo-600" />
                      Contratos e Licitações ({totalContratos})
                    </p>
                    <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                      {resumo.contratos.map((item: string, i: number) => (
                        <p key={i} className="text-xs text-foreground p-2.5 rounded-lg border bg-indigo-50/50 dark:bg-indigo-950/20 border-indigo-200/50 dark:border-indigo-800/30 hover:bg-indigo-100/50 dark:hover:bg-indigo-950/40 transition-colors">
                          📋 {item}
                        </p>
                      ))}
                    </div>
                  </div>
                )}

                {/* Valores Recebidos */}
                {totalValores > 0 && (
                  <div className="space-y-2">
                    <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                      <DollarSign className="h-3 w-3 text-emerald-600" />
                      Valores Recebidos ({totalValores})
                    </p>
                    <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                      {resumo.valoresRecebidos.map((item: string, i: number) => (
                        <p key={i} className="text-xs text-foreground p-2.5 rounded-lg border bg-emerald-50/50 dark:bg-emerald-950/20 border-emerald-200/50 dark:border-emerald-800/30 hover:bg-emerald-100/50 dark:hover:bg-emerald-950/40 transition-colors">
                          💰 {item}
                        </p>
                      ))}
                    </div>
                  </div>
                )}

                {/* Sanções */}
                {totalSancoes > 0 ? (
                  <div className="space-y-2">
                    <p className="text-xs font-bold uppercase tracking-wider flex items-center gap-1 text-destructive">
                      <AlertTriangle className="h-3 w-3" />
                      ⚠️ Sanções e Penalidades ({totalSancoes})
                    </p>
                    <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                      {resumo.sancoes.map((item: string, i: number) => (
                        <p key={i} className="text-xs text-destructive p-2.5 rounded-lg border border-destructive/30 bg-destructive/5 hover:bg-destructive/10 transition-colors">
                          🚨 {item}
                        </p>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 text-sm text-green-600 p-3 rounded-lg bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-900">
                    <ShieldCheck className="h-5 w-5" />
                    <span className="font-medium">Nenhuma sanção ou penalidade encontrada — empresa regular</span>
                  </div>
                )}

                {/* Outras Infos */}
                {totalOutras > 0 && (
                  <div className="space-y-2">
                    <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                      <Info className="h-3 w-3 text-purple-600" />
                      Outras Informações ({totalOutras})
                    </p>
                    <div className="space-y-1.5 max-h-36 overflow-y-auto pr-1">
                      {resumo.outrasInfos.map((item: string, i: number) => (
                        <p key={i} className="text-xs text-foreground p-2.5 rounded-lg border bg-muted/30 hover:bg-muted/50 transition-colors">
                          {item}
                        </p>
                      ))}
                    </div>
                  </div>
                )}

                {/* Actions */}
                <div className="flex items-center justify-between pt-2 border-t">
                  <a href={portalData.url} target="_blank" rel="noopener noreferrer">
                    <Button variant="outline" size="sm" className="gap-2">
                      <ExternalLink className="h-3 w-3" />
                      Ver no Portal da Transparência
                    </Button>
                  </a>
                  <Button variant="ghost" size="sm" onClick={buscarPortalTransparencia} className="gap-2 text-xs text-muted-foreground">
                    <Search className="h-3 w-3" />
                    Consultar novamente
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
          {!dividasData && !dividasLoading && !dividasError && (
            <Button onClick={buscarDividas} className="gap-2" variant="destructive">
              <Search className="h-4 w-4" />
              Buscar Dívidas e Pendências
            </Button>
          )}

          {dividasLoading && (
            <div className="flex flex-col items-center gap-3 py-8">
              <Loader2 className="h-8 w-8 animate-spin text-destructive" />
              <p className="text-sm text-muted-foreground">Buscando dívidas e pendências...</p>
              <div className="flex gap-6 text-xs text-muted-foreground">
                <span className="animate-pulse">Dívida Ativa...</span>
                <span className="animate-pulse" style={{ animationDelay: '0.3s' }}>Protestos...</span>
                <span className="animate-pulse" style={{ animationDelay: '0.6s' }}>Processos...</span>
              </div>
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
                {/* Risk Overview Dashboard */}
                <div className={`rounded-xl p-4 bg-gradient-to-br ${riskBg} border`}>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                    {/* Risk Score */}
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

                    {/* Total records */}
                    <div className="text-center">
                      <div className="text-3xl font-black text-foreground">{totalRegistros}</div>
                      <p className="text-[10px] uppercase tracking-wider text-muted-foreground mt-1">Registros</p>
                    </div>

                    {/* Chart mini */}
                    <div className="col-span-2 flex items-center justify-center gap-3">
                      {chartData.map((item, i) => (
                        <div key={i} className="flex flex-col items-center gap-1">
                          <div className="relative w-12 h-12">
                            <svg viewBox="0 0 36 36" className="w-12 h-12 -rotate-90">
                              <circle cx="18" cy="18" r="14" fill="none" stroke="currentColor" strokeWidth="3" className="text-muted/30" />
                              <circle
                                cx="18" cy="18" r="14" fill="none"
                                stroke={item.fill}
                                strokeWidth="3"
                                strokeDasharray={`${Math.min(88, item.registros * 17.6)} 88`}
                                strokeLinecap="round"
                                className="transition-all duration-1000"
                              />
                            </svg>
                            <span className="absolute inset-0 flex items-center justify-center text-xs font-bold">{item.registros}</span>
                          </div>
                          <span className="text-[9px] text-muted-foreground text-center leading-tight">{item.name}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Detail Cards Grid */}
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
                            <Badge variant={hasItems ? "destructive" : "secondary"} className="text-xs">
                              {section.encontrados}
                            </Badge>
                          </div>
                        </div>

                        <div className="p-3">
                          {/* Values found */}
                          {section.valores && section.valores.length > 0 && (
                            <div className="flex flex-wrap gap-1 mb-3">
                              {section.valores.slice(0, 4).map((v: string, i: number) => (
                                <Badge key={i} variant="outline" className={`text-xs ${config.color} ${config.borderColor}`}>
                                  {v}
                                </Badge>
                              ))}
                            </div>
                          )}

                          {hasItems ? (
                            <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
                              {section.items.map((item: any, i: number) => (
                                <a
                                  key={i}
                                  href={item.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="block text-xs p-2 rounded-md border bg-background hover:bg-accent/50 transition-all hover:shadow-sm group"
                                >
                                  <p className="font-medium text-foreground group-hover:text-primary transition-colors line-clamp-1">
                                    {config.emoji} {item.titulo}
                                  </p>
                                  {item.descricao && (
                                    <p className="text-muted-foreground mt-0.5 line-clamp-2 leading-relaxed">{item.descricao}</p>
                                  )}
                                  <div className="flex items-center gap-1 mt-1.5 text-[10px] text-muted-foreground">
                                    <ExternalLink className="h-2.5 w-2.5" />
                                    {item.fonte}
                                  </div>
                                </a>
                              ))}
                            </div>
                          ) : (
                            <div className="flex items-center gap-2 text-xs text-green-600 py-3 justify-center">
                              <ShieldCheck className="h-4 w-4" />
                              <span className="font-medium">Nenhum registro</span>
                            </div>
                          )}
                        </div>
                      </Card>
                    );
                  })}
                </div>

                {/* Refresh button */}
                <div className="flex justify-center">
                  <Button variant="ghost" size="sm" onClick={buscarDividas} className="gap-2 text-xs text-muted-foreground">
                    <Search className="h-3 w-3" />
                    Buscar novamente
                  </Button>
                </div>
              </div>
            );
          })()}
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
          {!endividamentoData && !endividamentoLoading && !endividamentoError && (
            <Button onClick={buscarEndividamentoBancario} className="gap-2 bg-amber-600 hover:bg-amber-700 text-white">
              <Landmark className="h-4 w-4" />
              Buscar Endividamento Bancário
            </Button>
          )}

          {endividamentoLoading && (
            <div className="flex flex-col items-center gap-3 py-8">
              <Loader2 className="h-8 w-8 animate-spin text-amber-600" />
              <p className="text-sm text-muted-foreground">Buscando endividamento bancário...</p>
              <div className="flex gap-5 text-xs text-muted-foreground">
                <span className="animate-pulse">SCR...</span>
                <span className="animate-pulse" style={{ animationDelay: '0.2s' }}>Empréstimos...</span>
                <span className="animate-pulse" style={{ animationDelay: '0.4s' }}>Debêntures...</span>
                <span className="animate-pulse" style={{ animationDelay: '0.6s' }}>BNDES...</span>
                <span className="animate-pulse" style={{ animationDelay: '0.8s' }}>Inadimplência...</span>
              </div>
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
                {/* Overview Dashboard */}
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
                      <Badge className={`text-xs ${
                        endividamentoData.nivel === 'alto' ? 'bg-destructive/20 text-destructive border-destructive/30' :
                        endividamentoData.nivel === 'moderado' ? 'bg-amber-100 text-amber-700 border-amber-300' :
                        endividamentoData.nivel === 'baixo' ? 'bg-yellow-100 text-yellow-700 border-yellow-300' :
                        endividamentoData.nivel === 'minimo' ? 'bg-blue-100 text-blue-700 border-blue-300' :
                        'bg-emerald-100 text-emerald-700 border-emerald-300'
                      }`}>
                        {endividamentoData.nivel === 'alto' ? '🔴' : endividamentoData.nivel === 'moderado' ? '🟠' : endividamentoData.nivel === 'baixo' ? '🟡' : endividamentoData.nivel === 'minimo' ? '🔵' : '🟢'} {endividamentoData.nivel.charAt(0).toUpperCase() + endividamentoData.nivel.slice(1)}
                      </Badge>
                      <p className="text-[10px] uppercase tracking-wider text-muted-foreground mt-2">Nível</p>
                    </div>
                  </div>
                </div>

                {/* Termos Bancários Identificados */}
                {endividamentoData.termosIdentificados && endividamentoData.termosIdentificados.length > 0 && (
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1">
                      <Landmark className="h-3 w-3" />
                      Termos Bancários Identificados
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {endividamentoData.termosIdentificados.map((t: string, i: number) => (
                        <Badge key={i} variant="outline" className="text-xs capitalize border-amber-400/50 text-amber-700 dark:text-amber-400">
                          🏦 {t}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}

                {/* Valores Encontrados */}
                {endividamentoData.valoresEncontrados && endividamentoData.valoresEncontrados.length > 0 && (
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1">
                      <DollarSign className="h-3 w-3" />
                      Valores Mencionados
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {endividamentoData.valoresEncontrados.map((v: string, i: number) => (
                        <Badge key={i} variant="outline" className="text-xs border-primary/30 text-primary">
                          💰 {v}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}

                {/* Category Cards */}
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
                            <Badge variant={hasItems ? "default" : "secondary"} className="text-xs">
                              {section.encontrados}
                            </Badge>
                          </div>
                        </div>
                        <div className="p-3">
                          {section.valores && section.valores.length > 0 && (
                            <div className="flex flex-wrap gap-1 mb-3">
                              {section.valores.slice(0, 4).map((v: string, i: number) => (
                                <Badge key={i} variant="outline" className={`text-xs ${cfg.color} ${cfg.borderColor}`}>
                                  {v}
                                </Badge>
                              ))}
                            </div>
                          )}
                          {hasItems ? (
                            <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
                              {section.items.map((item: any, i: number) => (
                                <a key={i} href={item.url} target="_blank" rel="noopener noreferrer"
                                   className="block text-xs p-2 rounded-md border bg-background hover:bg-accent/50 transition-all hover:shadow-sm group">
                                  <p className="font-medium text-foreground group-hover:text-primary transition-colors line-clamp-1">
                                    {cfg.emoji} {item.titulo}
                                  </p>
                                  {item.descricao && <p className="text-muted-foreground mt-0.5 line-clamp-2">{item.descricao}</p>}
                                  <div className="flex items-center gap-1 mt-1 text-[10px] text-muted-foreground">
                                    <ExternalLink className="h-2.5 w-2.5" />
                                    {item.fonte}
                                  </div>
                                </a>
                              ))}
                            </div>
                          ) : (
                            <div className="flex items-center gap-2 text-xs text-emerald-600 py-3 justify-center">
                              <ShieldCheck className="h-4 w-4" />
                              <span className="font-medium">Nenhum registro</span>
                            </div>
                          )}
                        </div>
                      </Card>
                    );
                  })}
                </div>

                <div className="flex justify-center">
                  <Button variant="ghost" size="sm" onClick={buscarEndividamentoBancario} className="gap-2 text-xs text-muted-foreground">
                    <Search className="h-3 w-3" />
                    Buscar novamente
                  </Button>
                </div>
              </div>
            );
          })()}
        </CardContent>
      </Card>

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
          {!garantiasData && !garantiasLoading && !garantiasError && (
            <Button onClick={buscarGarantias} className="gap-2 bg-emerald-600 hover:bg-emerald-700">
              <Shield className="h-4 w-4" />
              Verificar Garantias e Patrimônio
            </Button>
          )}

          {garantiasLoading && (
            <div className="flex flex-col items-center gap-3 py-8">
              <Loader2 className="h-8 w-8 animate-spin text-emerald-600" />
              <p className="text-sm text-muted-foreground">Verificando patrimônio e garantias...</p>
              <div className="flex gap-6 text-xs text-muted-foreground">
                <span className="animate-pulse">Imóveis...</span>
                <span className="animate-pulse" style={{ animationDelay: '0.3s' }}>Veículos...</span>
                <span className="animate-pulse" style={{ animationDelay: '0.6s' }}>Patrimônio...</span>
              </div>
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
                {/* Guarantee Capacity Overview */}
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
                        {est.capacidadeGarantia === 'alta' ? '🏛️' : est.capacidadeGarantia === 'média' ? '🏠' : '⚠️'} {est.capacidadeGarantia.charAt(0).toUpperCase() + est.capacidadeGarantia.slice(1)}
                      </Badge>
                      <p className="text-[10px] uppercase tracking-wider text-muted-foreground mt-2">Capacidade</p>
                    </div>
                  </div>

                  {/* Guarantee Bar */}
                  <div className="mt-4">
                    <div className="flex justify-between text-[10px] text-muted-foreground mb-1">
                      <span>Garantia Mínima (30%)</span>
                      <span>Garantia Máxima (70%)</span>
                    </div>
                    <div className="relative h-4 rounded-full bg-muted overflow-hidden">
                      <div
                        className="absolute left-0 top-0 h-full rounded-full bg-gradient-to-r from-emerald-400 to-emerald-600 transition-all duration-1000"
                        style={{ width: '70%' }}
                      />
                      <div
                        className="absolute left-0 top-0 h-full rounded-full bg-emerald-700/50"
                        style={{ width: '30%' }}
                      />
                    </div>
                  </div>
                </div>

                {/* Asset Categories */}
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
                            <Badge variant={hasItems ? "default" : "secondary"} className="text-xs">
                              {section.encontrados}
                            </Badge>
                          </div>
                        </div>

                        <div className="p-3">
                          {hasItems ? (
                            <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                              {section.items.map((item: any, i: number) => (
                                <a
                                  key={i}
                                  href={item.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="block text-xs p-2 rounded-md border bg-background hover:bg-accent/50 transition-all hover:shadow-sm group"
                                >
                                  <p className="font-medium text-foreground group-hover:text-primary transition-colors line-clamp-1">
                                    {config.emoji} {item.titulo}
                                  </p>
                                  {item.descricao && (
                                    <p className="text-muted-foreground mt-0.5 line-clamp-2">{item.descricao}</p>
                                  )}
                                  {(item.valores?.length > 0 || item.areas?.length > 0) && (
                                    <div className="flex flex-wrap gap-1 mt-1.5">
                                      {item.valores?.map((v: string, vi: number) => (
                                        <Badge key={`v${vi}`} variant="outline" className={`text-[10px] ${config.color} ${config.borderColor}`}>
                                          💰 {v}
                                        </Badge>
                                      ))}
                                      {item.areas?.map((a: string, ai: number) => (
                                        <Badge key={`a${ai}`} variant="outline" className="text-[10px]">
                                          📐 {a}
                                        </Badge>
                                      ))}
                                    </div>
                                  )}
                                  <div className="flex items-center gap-1 mt-1 text-[10px] text-muted-foreground">
                                    <ExternalLink className="h-2.5 w-2.5" />
                                    {item.fonte}
                                  </div>
                                </a>
                              ))}
                            </div>
                          ) : (
                            <div className="flex items-center gap-2 text-xs text-muted-foreground py-3 justify-center">
                              <Search className="h-3 w-3" />
                              Nenhum registro público encontrado
                            </div>
                          )}
                        </div>
                      </Card>
                    );
                  })}
                </div>

                {/* Methodology note */}
                <div className="flex items-start gap-2 p-3 rounded-lg bg-muted/50 border text-xs text-muted-foreground">
                  <Info className="h-4 w-4 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="font-semibold mb-1">Sobre as Garantias</p>
                    <p>Patrimônio estimado com base no Capital Social × Fator Porte ({est.multiplicador}x). A faixa de garantia (30-70%) representa a capacidade típica de oferecer bens como colateral. Dados de imóveis e veículos são de fontes públicas e podem não refletir a totalidade.</p>
                  </div>
                </div>

                {/* Refresh */}
                <div className="flex justify-center">
                  <Button variant="ghost" size="sm" onClick={buscarGarantias} className="gap-2 text-xs text-muted-foreground">
                    <Search className="h-3 w-3" />
                    Buscar novamente
                  </Button>
                </div>
              </div>
            );
          })()}
        </CardContent>
      </Card>

      {/* Quadro Societário com links de contato */}
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
    } catch (err) {
      console.error(`Erro buscando ${tipo}:`, err);
    } finally {
      setLoading(false);
      setSearched(true);
    }
  };

  return (
    <div className="p-3 rounded-lg border bg-muted/30 space-y-3">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <p className="font-medium text-foreground">{socio.nome_socio}</p>
          <p className="text-xs text-muted-foreground">{socio.qualificacao_socio}</p>
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
            Buscar Email
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5 text-xs text-green-700"
            onClick={() => buscarContato('whatsapp')}
            disabled={phoneLoading}
          >
            {phoneLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <MessageCircle className="h-3 w-3" />}
            Buscar WhatsApp
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

      {/* Email results */}
      {emailSearched && (
        <div className="pl-0 sm:pl-4">
          {emailResults.length > 0 ? (
            <div className="space-y-1">
              <p className="text-xs font-semibold text-muted-foreground">📧 Emails encontrados:</p>
              {emailResults.map((c, i) => (
                <a key={i} href={`mailto:${c.valor}`} className="flex items-center gap-2 text-xs p-1.5 rounded border bg-background hover:bg-accent transition-colors">
                  <Mail className="h-3 w-3 text-primary flex-shrink-0" />
                  <span className="font-medium text-primary">{c.valor}</span>
                  <span className="text-muted-foreground truncate ml-auto text-[10px]">{new URL(c.fonte).hostname}</span>
                </a>
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">Nenhum email encontrado automaticamente.</p>
          )}
        </div>
      )}

      {/* Phone results */}
      {phoneSearched && (
        <div className="pl-0 sm:pl-4">
          {phoneResults.length > 0 ? (
            <div className="space-y-1">
              <p className="text-xs font-semibold text-muted-foreground">📱 Telefones encontrados:</p>
              {phoneResults.map((c, i) => (
                <a key={i} href={`https://wa.me/55${c.valor.replace(/\D/g, '')}`} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-xs p-1.5 rounded border bg-background hover:bg-accent transition-colors">
                  <MessageCircle className="h-3 w-3 text-green-600 flex-shrink-0" />
                  <span className="font-medium text-green-700">{c.valor}</span>
                  <span className="text-muted-foreground truncate ml-auto text-[10px]">{(() => { try { return new URL(c.fonte).hostname; } catch { return c.fonte; } })()}</span>
                </a>
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">Nenhum telefone encontrado automaticamente.</p>
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
