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
  BarChart3, ArrowRight, Activity, Percent, ChevronRight, Shield
} from "lucide-react";
import {
  AreaChart, Area, ResponsiveContainer, XAxis, YAxis, Tooltip,
} from "recharts";

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
    <Card className="overflow-hidden hover:shadow-corporate transition-all duration-300 border-border/60">
      <CardContent className="p-5">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2.5">
            <div className="rounded-lg bg-primary/8 p-2">
              <Icon className="h-4 w-4 text-primary" />
            </div>
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-[0.1em]">{nome}</span>
          </div>
          {historico && (
            <Badge variant="outline" className={`text-[10px] font-semibold gap-0.5 border ${trendUp ? 'text-emerald-700 border-emerald-200 bg-emerald-50' : 'text-red-600 border-red-200 bg-red-50'}`}>
              {trendUp ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
              {Math.abs(trend).toFixed(2)}
            </Badge>
          )}
        </div>

        {isLoading ? (
          <Skeleton className="h-9 w-28" />
        ) : ultimo ? (
          <p className="text-2xl font-extrabold text-foreground tracking-tight">
            {prefix}{Number(ultimo.valor).toLocaleString("pt-BR", { maximumFractionDigits: 4 })}{suffix}
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">—</p>
        )}

        {historico && historico.length > 0 && (
          <div className="mt-4 -mx-1">
            <ResponsiveContainer width="100%" height={50}>
              <AreaChart data={historico}>
                <defs>
                  <linearGradient id={`spark-${codigo}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={trendUp ? 'hsl(152, 55%, 38%)' : 'hsl(0, 65%, 48%)'} stopOpacity={0.25} />
                    <stop offset="100%" stopColor={trendUp ? 'hsl(152, 55%, 38%)' : 'hsl(0, 65%, 48%)'} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <Area
                  type="monotone"
                  dataKey="value"
                  stroke={trendUp ? 'hsl(152, 55%, 38%)' : 'hsl(0, 65%, 48%)'}
                  fill={`url(#spark-${codigo})`}
                  strokeWidth={1.5}
                  dot={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}

        {ultimo && (
          <p className="text-[10px] text-muted-foreground mt-2 font-medium">Ref: {ultimo.data}</p>
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
      className="flex items-center justify-between py-3.5 px-4 rounded-lg hover:bg-primary/4 cursor-pointer transition-all duration-200 group"
      onClick={() => onClick(serie.codigo)}
    >
      <div className="flex items-center gap-3">
        <div className="rounded-md bg-primary/8 p-1.5 group-hover:bg-primary/12 transition-colors">
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
            <span className="text-xs text-muted-foreground ml-1 font-normal">{serie.unidade}</span>
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        )}
        <ChevronRight className="h-4 w-4 text-muted-foreground/40 group-hover:text-primary group-hover:translate-x-0.5 transition-all" />
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
      {/* Corporate Header */}
      <header className="border-b border-border/60 bg-card sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="bg-primary rounded-lg p-2.5 shadow-sm">
              <Shield className="h-5 w-5 text-primary-foreground" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-foreground tracking-tight">Central Analytics</h1>
              <p className="text-[11px] text-muted-foreground font-medium uppercase tracking-[0.12em]">Painel Econômico & Crédito Internacional</p>
            </div>
          </div>
          <nav className="flex items-center gap-1.5">
            <Link to="/empresas">
              <Button variant="ghost" size="sm" className="gap-2 text-xs font-semibold text-muted-foreground hover:text-foreground">
                <Building2 className="h-4 w-4" />
                Empresas
              </Button>
            </Link>
            <Link to="/internacionalizacao/analise">
              <Button size="sm" className="gap-2 text-xs font-semibold bg-primary hover:bg-primary/90 shadow-sm">
                <Globe className="h-4 w-4" />
                Análise ACI
              </Button>
            </Link>
          </nav>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8 space-y-8">
        {selectedSerie ? (
          <SerieChart codigo={selectedSerie} onBack={() => setSelectedSerie(null)} />
        ) : (
          <>
            {/* KPI Hero Cards */}
            <section>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-5">
                {KEY_INDICATORS.map((ind) => (
                  <SparklineCard key={ind.codigo} {...ind} />
                ))}
              </div>
            </section>

            {/* Main content grid */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
              {/* Left: All indicators list */}
              <div className="lg:col-span-2 space-y-5">
                <Card className="border-border/60">
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <CardTitle className="text-base font-bold flex items-center gap-2 tracking-tight">
                          <BarChart3 className="h-4 w-4 text-accent" />
                          Indicadores Econômicos
                        </CardTitle>
                        <CardDescription className="text-xs mt-1">Clique para ver o histórico detalhado</CardDescription>
                      </div>
                      <CustomSerieSearch onSearch={setSelectedSerie} />
                    </div>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <div className="divide-y divide-border/50">
                      {POPULAR_SERIES.map((serie) => (
                        <IndicatorRow key={serie.codigo} serie={serie} onClick={setSelectedSerie} />
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* Right: Quick actions & modules */}
              <div className="space-y-5">
                {/* Empresas Module */}
                <Card className="overflow-hidden hover:shadow-corporate transition-all duration-300 group border-border/60">
                  <Link to="/empresas">
                    <CardContent className="p-6">
                      <div className="flex items-start gap-4">
                        <div className="rounded-xl bg-primary p-3 shadow-sm group-hover:shadow-md transition-shadow">
                          <Building2 className="h-6 w-6 text-primary-foreground" />
                        </div>
                        <div className="flex-1">
                          <h3 className="text-sm font-bold text-foreground group-hover:text-primary transition-colors tracking-tight">
                            Empresas & Capital
                          </h3>
                          <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">
                            Busca automática de empresas, QSA, scoring de crédito e análise de potencial.
                          </p>
                          <div className="flex items-center gap-1 mt-3.5 text-xs text-accent font-bold uppercase tracking-wider">
                            Acessar <ArrowRight className="h-3 w-3" />
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Link>
                </Card>

                {/* Internacionalização Module */}
                <Card className="overflow-hidden hover:shadow-corporate transition-all duration-300 group border-border/60">
                  <Link to="/internacionalizacao/analise">
                    <CardContent className="p-6">
                      <div className="flex items-start gap-4">
                        <div className="rounded-xl bg-accent p-3 shadow-sm group-hover:shadow-md transition-shadow">
                          <Globe className="h-6 w-6 text-accent-foreground" />
                        </div>
                        <div className="flex-1">
                          <h3 className="text-sm font-bold text-foreground group-hover:text-primary transition-colors tracking-tight">
                            Análise de Internacionalização
                          </h3>
                          <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">
                            Elegibilidade para crédito internacional, scoring por modalidade e relatório técnico.
                          </p>
                          <div className="flex items-center gap-1 mt-3.5 text-xs text-accent font-bold uppercase tracking-wider">
                            Iniciar Análise <ArrowRight className="h-3 w-3" />
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Link>
                </Card>

                {/* Stats summary */}
                <Card className="border-border/60">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground font-bold">Resumo do Sistema</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3.5">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground font-medium">Indicadores BCB</span>
                      <Badge variant="secondary" className="text-xs font-bold">{POPULAR_SERIES.length}</Badge>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground font-medium">Módulos Ativos</span>
                      <Badge variant="secondary" className="text-xs font-bold">3</Badge>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground font-medium">Edge Functions</span>
                      <Badge variant="secondary" className="text-xs font-bold">8</Badge>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground font-medium">APIs Integradas</span>
                      <Badge variant="secondary" className="text-xs font-bold">BCB, Perplexity</Badge>
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
