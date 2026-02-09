import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { POPULAR_SERIES, fetchUltimoValor, fetchSerie, type SerieData } from "@/lib/bcb-api";
import { SerieChart } from "@/components/SerieChart";
import { CustomSerieSearch } from "@/components/CustomSerieSearch";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Landmark, Building2, Globe, TrendingUp, TrendingDown, DollarSign,
  BarChart3, ArrowRight, Activity, Percent, ChevronRight
} from "lucide-react";
import {
  AreaChart, Area, ResponsiveContainer, XAxis, YAxis, Tooltip,
  BarChart, Bar, CartesianGrid
} from "recharts";

// Key indicators for the hero section
const KEY_INDICATORS = [
  { codigo: 11, nome: "Selic", icon: Percent, prefix: "", suffix: "% a.a." },
  { codigo: 1, nome: "Dólar", icon: DollarSign, prefix: "R$ ", suffix: "" },
  { codigo: 433, nome: "IPCA", icon: TrendingUp, prefix: "", suffix: "%" },
  { codigo: 21619, nome: "Euro", icon: DollarSign, prefix: "R$ ", suffix: "" },
];

function SparklineCard({ codigo, nome, icon: Icon, prefix, suffix }: typeof KEY_INDICATORS[0]) {
  const { data: ultimo, isLoading } = useQuery({
    queryKey: ["bcb-ultimo", codigo],
    queryFn: () => fetchUltimoValor(codigo),
    staleTime: 5 * 60 * 1000,
  });

  const { data: historico } = useQuery({
    queryKey: ["bcb-sparkline", codigo],
    queryFn: async () => {
      const fim = new Date();
      const inicio = new Date(fim.getFullYear(), fim.getMonth() - 3, fim.getDate());
      const data = await fetchSerie(codigo, inicio, fim);
      return data.slice(-30).map((d: SerieData) => ({
        date: d.data,
        value: parseFloat(d.valor),
      }));
    },
    staleTime: 10 * 60 * 1000,
  });

  const trend = historico && historico.length >= 2
    ? historico[historico.length - 1].value - historico[historico.length - 2].value
    : 0;
  const trendUp = trend >= 0;

  return (
    <Card className="overflow-hidden hover:shadow-md transition-shadow">
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <div className="rounded-lg bg-primary/10 p-1.5">
              <Icon className="h-4 w-4 text-primary" />
            </div>
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{nome}</span>
          </div>
          {historico && (
            <Badge variant="outline" className={`text-[10px] gap-0.5 ${trendUp ? 'text-emerald-600 border-emerald-200' : 'text-red-500 border-red-200'}`}>
              {trendUp ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
              {Math.abs(trend).toFixed(2)}
            </Badge>
          )}
        </div>

        {isLoading ? (
          <Skeleton className="h-8 w-28" />
        ) : ultimo ? (
          <p className="text-2xl font-black text-foreground">
            {prefix}{Number(ultimo.valor).toLocaleString("pt-BR", { maximumFractionDigits: 4 })}{suffix}
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">—</p>
        )}

        {historico && historico.length > 0 && (
          <div className="mt-3 -mx-1">
            <ResponsiveContainer width="100%" height={48}>
              <AreaChart data={historico}>
                <defs>
                  <linearGradient id={`spark-${codigo}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={trendUp ? 'hsl(150, 60%, 40%)' : 'hsl(0, 60%, 50%)'} stopOpacity={0.3} />
                    <stop offset="100%" stopColor={trendUp ? 'hsl(150, 60%, 40%)' : 'hsl(0, 60%, 50%)'} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <Area
                  type="monotone"
                  dataKey="value"
                  stroke={trendUp ? 'hsl(150, 60%, 40%)' : 'hsl(0, 60%, 50%)'}
                  fill={`url(#spark-${codigo})`}
                  strokeWidth={1.5}
                  dot={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}

        {ultimo && (
          <p className="text-[10px] text-muted-foreground mt-1">Ref: {ultimo.data}</p>
        )}
      </CardContent>
    </Card>
  );
}

function IndicatorRow({ serie, onClick }: { serie: typeof POPULAR_SERIES[0]; onClick: (c: number) => void }) {
  const { data, isLoading } = useQuery({
    queryKey: ["bcb-ultimo", serie.codigo],
    queryFn: () => fetchUltimoValor(serie.codigo),
    staleTime: 5 * 60 * 1000,
  });

  return (
    <div
      className="flex items-center justify-between py-3 px-4 rounded-lg hover:bg-muted/50 cursor-pointer transition-colors group"
      onClick={() => onClick(serie.codigo)}
    >
      <div className="flex items-center gap-3">
        <div className="rounded-md bg-primary/10 p-1.5">
          <Activity className="h-3.5 w-3.5 text-primary" />
        </div>
        <span className="text-sm font-medium text-foreground">{serie.nome}</span>
      </div>
      <div className="flex items-center gap-3">
        {isLoading ? (
          <Skeleton className="h-5 w-20" />
        ) : data ? (
          <span className="text-sm font-semibold text-foreground tabular-nums">
            {Number(data.valor).toLocaleString("pt-BR", { maximumFractionDigits: 4 })}
            <span className="text-xs text-muted-foreground ml-1">{serie.unidade}</span>
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        )}
        <ChevronRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
      </div>
    </div>
  );
}

const Index = () => {
  const [selectedSerie, setSelectedSerie] = useState<number | null>(null);

  const otherSeries = POPULAR_SERIES.filter(
    s => !KEY_INDICATORS.some(k => k.codigo === s.codigo)
  );

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b bg-card/80 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-primary rounded-xl p-2">
              <Landmark className="h-5 w-5 text-primary-foreground" />
            </div>
            <div>
              <h1 className="text-base font-bold text-foreground">Central Analytics</h1>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Painel Econômico & Crédito Internacional</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Link to="/empresas">
              <Button variant="ghost" size="sm" className="gap-2 text-xs">
                <Building2 className="h-4 w-4" />
                Empresas
              </Button>
            </Link>
            <Link to="/internacionalizacao/analise">
              <Button variant="default" size="sm" className="gap-2 text-xs">
                <Globe className="h-4 w-4" />
                Análise ACI
              </Button>
            </Link>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-6 space-y-6">
        {selectedSerie ? (
          <SerieChart codigo={selectedSerie} onBack={() => setSelectedSerie(null)} />
        ) : (
          <>
            {/* KPI Hero Cards */}
            <section>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                {KEY_INDICATORS.map((ind) => (
                  <SparklineCard key={ind.codigo} {...ind} />
                ))}
              </div>
            </section>

            {/* Main content grid */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Left: All indicators list */}
              <div className="lg:col-span-2 space-y-4">
                <Card>
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                      <div>
                        <CardTitle className="text-base flex items-center gap-2">
                          <BarChart3 className="h-4 w-4 text-primary" />
                          Indicadores Econômicos
                        </CardTitle>
                        <CardDescription className="text-xs">Clique para ver o histórico detalhado</CardDescription>
                      </div>
                      <CustomSerieSearch onSearch={setSelectedSerie} />
                    </div>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <div className="divide-y divide-border">
                      {POPULAR_SERIES.map((serie) => (
                        <IndicatorRow key={serie.codigo} serie={serie} onClick={setSelectedSerie} />
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* Right: Quick actions & modules */}
              <div className="space-y-4">
                {/* Module cards */}
                <Card className="overflow-hidden border-primary/20 hover:border-primary/40 transition-colors group">
                  <Link to="/empresas">
                    <CardContent className="p-5">
                      <div className="flex items-start gap-4">
                        <div className="rounded-xl bg-primary/10 p-3">
                          <Building2 className="h-6 w-6 text-primary" />
                        </div>
                        <div className="flex-1">
                          <h3 className="text-sm font-semibold text-foreground group-hover:text-primary transition-colors">
                            Empresas & Capital
                          </h3>
                          <p className="text-xs text-muted-foreground mt-1">
                            Busca automática de empresas, QSA, scoring de crédito e análise de potencial.
                          </p>
                          <div className="flex items-center gap-1 mt-3 text-xs text-primary font-medium">
                            Acessar <ArrowRight className="h-3 w-3" />
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Link>
                </Card>

                <Card className="overflow-hidden border-primary/20 hover:border-primary/40 transition-colors group">
                  <Link to="/internacionalizacao/analise">
                    <CardContent className="p-5">
                      <div className="flex items-start gap-4">
                        <div className="rounded-xl bg-emerald-100 p-3">
                          <Globe className="h-6 w-6 text-emerald-600" />
                        </div>
                        <div className="flex-1">
                          <h3 className="text-sm font-semibold text-foreground group-hover:text-primary transition-colors">
                            Análise de Internacionalização
                          </h3>
                          <p className="text-xs text-muted-foreground mt-1">
                            Elegibilidade para crédito internacional, scoring por modalidade e relatório técnico.
                          </p>
                          <div className="flex items-center gap-1 mt-3 text-xs text-primary font-medium">
                            Iniciar Análise <ArrowRight className="h-3 w-3" />
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Link>
                </Card>

                {/* Stats summary */}
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-xs uppercase tracking-wider text-muted-foreground">Resumo do Sistema</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">Indicadores BCB</span>
                      <Badge variant="secondary" className="text-xs">{POPULAR_SERIES.length}</Badge>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">Módulos Ativos</span>
                      <Badge variant="secondary" className="text-xs">3</Badge>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">Edge Functions</span>
                      <Badge variant="secondary" className="text-xs">8</Badge>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">APIs Integradas</span>
                      <Badge variant="secondary" className="text-xs">BCB, Perplexity</Badge>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  );
};

export default Index;
