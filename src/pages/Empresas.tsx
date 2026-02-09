import { useState, useEffect, useRef, useCallback } from "react";
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
import { Building2, Landmark, ArrowLeft, Users, Search, X, Phone, Mail, MessageCircle, ExternalLink, Loader2, Pause, Play, Globe, TrendingUp, ShieldCheck, AlertTriangle } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { Link } from "react-router-dom";

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
  
  return (
    <div className="space-y-4">
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

      {/* Quadro Societário com links de contato */}
      {empresa.qsa && empresa.qsa.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Users className="h-4 w-4" />
              Sócios & Contato ({empresa.qsa.length})
            </CardTitle>
            <CardDescription>Links para buscar os sócios nas redes sociais</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {empresa.qsa.map((socio, i) => (
                <div key={i} className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 rounded-lg border bg-muted/30">
                  <div>
                    <p className="font-medium text-foreground">{socio.nome_socio}</p>
                    <p className="text-xs text-muted-foreground">{socio.qualificacao_socio}</p>
                  </div>
                    <div className="flex flex-wrap gap-2">
                    <a
                      href={`https://www.google.com/search?q=${encodeURIComponent(socio.nome_socio + " " + (empresa.nome_fantasia || empresa.razao_social) + " email")}`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <Button size="sm" variant="outline" className="gap-1.5 text-xs">
                        <Mail className="h-3 w-3" />
                        Buscar Email
                      </Button>
                    </a>
                    <a
                      href={`https://www.google.com/search?q=${encodeURIComponent(socio.nome_socio + " " + (empresa.nome_fantasia || empresa.razao_social) + " whatsapp telefone contato")}`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <Button size="sm" variant="outline" className="gap-1.5 text-xs text-green-700">
                        <MessageCircle className="h-3 w-3" />
                        Buscar WhatsApp
                      </Button>
                    </a>
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
              ))}
            </div>
          </CardContent>
        </Card>
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
