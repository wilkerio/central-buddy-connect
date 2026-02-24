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
  BarChart3, ArrowRight, Activity, Percent, ChevronRight, Shield, Zap, Sparkles
} from "lucide-react";
import {
  AreaChart, Area, ResponsiveContainer, XAxis, YAxis, Tooltip,
} from "recharts";

const KEY_INDICATORS = [
  { codigo: 11, nome: "Selic", icon: Percent, prefix: "", suffix: "% a.a.", color: "38 80% 52%" },
  { codigo: 1, nome: "Dólar", icon: DollarSign, prefix: "R$ ", suffix: "", color: "152 55% 42%" },
  { codigo: 433, nome: "IPCA", icon: TrendingUp, prefix: "", suffix: "%", color: "210 100% 60%" },
  { codigo: 21619, nome: "Euro", icon: DollarSign, prefix: "R$ ", suffix: "", color: "280 70% 60%" },
];

function SparklineCard({ codigo, nome, icon: Icon, prefix, suffix, color }: typeof KEY_INDICATORS[0]) {
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
    <div className="glass-card-hover rounded-xl p-5 relative overflow-hidden group">
      {/* Ambient glow */}
      <div 
        className="absolute -top-12 -right-12 w-32 h-32 rounded-full blur-3xl opacity-10 group-hover:opacity-20 transition-opacity duration-700"
        style={{ background: `hsl(${color})` }}
      />
      
      <div className="relative z-10">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2.5">
            <div 
              className="rounded-lg p-2 border border-border/40"
              style={{ background: `hsl(${color} / 0.12)` }}
            >
              <Icon className="h-4 w-4" style={{ color: `hsl(${color})` }} />
            </div>
            <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-[0.15em]">{nome}</span>
          </div>
          {historico && (
            <div className={`flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full ${
              trendUp 
                ? 'text-[hsl(152,55%,42%)] bg-[hsl(152,55%,42%)]/10' 
                : 'text-[hsl(0,62%,45%)] bg-[hsl(0,62%,45%)]/10'
            }`}>
              {trendUp ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
              {Math.abs(trend).toFixed(2)}
            </div>
          )}
        </div>

        {isLoading ? (
          <Skeleton className="h-9 w-28 bg-secondary" />
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
                    <stop offset="0%" stopColor={trendUp ? 'hsl(152, 55%, 42%)' : 'hsl(0, 62%, 45%)'} stopOpacity={0.3} />
                    <stop offset="100%" stopColor={trendUp ? 'hsl(152, 55%, 42%)' : 'hsl(0, 62%, 45%)'} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <Area
                  type="monotone"
                  dataKey="value"
                  stroke={trendUp ? 'hsl(152, 55%, 42%)' : 'hsl(0, 62%, 45%)'}
                  fill={`url(#spark-${codigo})`}
                  strokeWidth={1.5}
                  dot={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}

        {ultimo && (
          <p className="text-[10px] text-muted-foreground/60 mt-2 font-medium tracking-wide">
            Ref: {ultimo.data}
          </p>
        )}
      </div>
    </div>
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
      className="flex items-center justify-between py-3.5 px-4 rounded-lg hover:bg-secondary/50 cursor-pointer transition-all duration-300 group border border-transparent hover:border-border/40"
      onClick={() => onClick(serie.codigo)}
    >
      <div className="flex items-center gap-3">
        <div className="rounded-md bg-accent/10 p-1.5 group-hover:bg-accent/20 transition-colors">
          <Activity className="h-3.5 w-3.5 text-accent" />
        </div>
        <span className="text-sm font-medium text-foreground">{serie.nome}</span>
      </div>
      <div className="flex items-center gap-3">
        {isLoading ? (
          <Skeleton className="h-5 w-20 bg-secondary" />
        ) : data ? (
          <span className="text-sm font-semibold text-foreground tabular-nums">
            {Number(data.valor).toLocaleString("pt-BR", { maximumFractionDigits: 4 })}
            <span className="text-xs text-muted-foreground ml-1 font-normal">{serie.unidade}</span>
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        )}
        <ChevronRight className="h-4 w-4 text-muted-foreground/30 group-hover:text-accent group-hover:translate-x-0.5 transition-all" />
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
    <div className="min-h-screen bg-background relative">
      {/* Background grid */}
      <div className="fixed inset-0 dot-grid opacity-30 pointer-events-none" />
      
      {/* Ambient gradient orbs */}
      <div className="fixed top-0 left-1/4 w-[600px] h-[600px] rounded-full bg-accent/5 blur-[120px] pointer-events-none" />
      <div className="fixed bottom-0 right-1/4 w-[400px] h-[400px] rounded-full bg-[hsl(210,100%,60%)]/5 blur-[100px] pointer-events-none" />

      {/* Header */}
      <header className="border-b border-border/40 bg-card/60 backdrop-blur-xl sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="relative">
              <div className="bg-accent rounded-xl p-2.5 shadow-glow">
                <Shield className="h-5 w-5 text-accent-foreground" />
              </div>
              <div className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 bg-[hsl(152,55%,42%)] rounded-full animate-pulse-glow" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-foreground tracking-tight flex items-center gap-2">
                Central Analytics
                <span className="text-[9px] font-bold bg-accent/15 text-accent px-2 py-0.5 rounded-full tracking-widest uppercase">PRO</span>
              </h1>
              <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-[0.15em]">
                Painel Econômico & Crédito Internacional
              </p>
            </div>
          </div>
          <nav className="flex items-center gap-2">
            <Link to="/empresas">
              <Button variant="ghost" size="sm" className="gap-2 text-xs font-semibold text-muted-foreground hover:text-foreground hover:bg-secondary/60">
                <Building2 className="h-4 w-4" />
                Empresas
              </Button>
            </Link>
            <Link to="/internacionalizacao/analise">
              <Button size="sm" className="gap-2 text-xs font-bold bg-accent hover:bg-accent/90 text-accent-foreground shadow-glow">
                <Globe className="h-4 w-4" />
                Análise ACI
              </Button>
            </Link>
          </nav>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8 space-y-8 relative z-10">
        {selectedSerie ? (
          <SerieChart codigo={selectedSerie} onBack={() => setSelectedSerie(null)} />
        ) : (
          <>
            {/* Hero section */}
            <section className="relative">
              <div className="flex items-center gap-2 mb-6">
                <Zap className="h-4 w-4 text-accent" />
                <span className="text-[10px] font-bold text-accent uppercase tracking-[0.2em]">Indicadores em Tempo Real</span>
                <div className="h-px flex-1 bg-gradient-to-r from-accent/30 to-transparent" />
              </div>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                {KEY_INDICATORS.map((ind) => (
                  <SparklineCard key={ind.codigo} {...ind} />
                ))}
              </div>
            </section>

            {/* Main content grid */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Left: All indicators */}
              <div className="lg:col-span-2 space-y-5">
                <div className="glass-card rounded-xl overflow-hidden">
                  <div className="p-6 pb-3 flex items-center justify-between">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <BarChart3 className="h-4 w-4 text-accent" />
                        <h2 className="text-base font-bold text-foreground tracking-tight">
                          Indicadores Econômicos
                        </h2>
                      </div>
                      <p className="text-[11px] text-muted-foreground">Clique para ver o histórico detalhado</p>
                    </div>
                    <CustomSerieSearch onSearch={setSelectedSerie} />
                  </div>
                  <div className="px-6 pb-4">
                    <div className="divide-y divide-border/30">
                      {POPULAR_SERIES.map((serie) => (
                        <IndicatorRow key={serie.codigo} serie={serie} onClick={setSelectedSerie} />
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              {/* Right sidebar */}
              <div className="space-y-4">
                {/* Empresas Module */}
                <Link to="/empresas" className="block">
                  <div className="glass-card-hover rounded-xl p-6 group relative overflow-hidden">
                    <div className="absolute top-0 right-0 w-32 h-32 bg-accent/5 rounded-full blur-2xl group-hover:bg-accent/10 transition-all duration-700" />
                    <div className="relative z-10">
                      <div className="flex items-start gap-4">
                        <div className="rounded-xl bg-accent/15 p-3 border border-accent/20 group-hover:shadow-glow transition-all duration-500">
                          <Building2 className="h-6 w-6 text-accent" />
                        </div>
                        <div className="flex-1">
                          <h3 className="text-sm font-bold text-foreground group-hover:text-accent transition-colors tracking-tight">
                            Empresas & Capital
                          </h3>
                          <p className="text-[11px] text-muted-foreground mt-1.5 leading-relaxed">
                            Busca automática, QSA, scoring de crédito e análise de potencial.
                          </p>
                          <div className="flex items-center gap-1.5 mt-3.5 text-[10px] text-accent font-bold uppercase tracking-[0.15em]">
                            Acessar <ArrowRight className="h-3 w-3 group-hover:translate-x-1 transition-transform" />
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </Link>

                {/* Internacionalização Module */}
                <Link to="/internacionalizacao/analise" className="block">
                  <div className="glass-card-hover rounded-xl p-6 group relative overflow-hidden">
                    <div className="absolute top-0 right-0 w-32 h-32 bg-[hsl(210,100%,60%)]/5 rounded-full blur-2xl group-hover:bg-[hsl(210,100%,60%)]/10 transition-all duration-700" />
                    <div className="relative z-10">
                      <div className="flex items-start gap-4">
                        <div className="rounded-xl bg-[hsl(210,100%,60%)]/10 p-3 border border-[hsl(210,100%,60%)]/20 group-hover:shadow-glow-blue transition-all duration-500">
                          <Globe className="h-6 w-6 text-[hsl(210,100%,60%)]" />
                        </div>
                        <div className="flex-1">
                          <h3 className="text-sm font-bold text-foreground group-hover:text-[hsl(210,100%,60%)] transition-colors tracking-tight">
                            Análise de Internacionalização
                          </h3>
                          <p className="text-[11px] text-muted-foreground mt-1.5 leading-relaxed">
                            Elegibilidade para crédito internacional, scoring e relatório técnico.
                          </p>
                          <div className="flex items-center gap-1.5 mt-3.5 text-[10px] text-[hsl(210,100%,60%)] font-bold uppercase tracking-[0.15em]">
                            Iniciar Análise <ArrowRight className="h-3 w-3 group-hover:translate-x-1 transition-transform" />
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </Link>

                {/* System Stats */}
                <div className="glass-card rounded-xl p-5">
                  <div className="flex items-center gap-2 mb-4">
                    <Sparkles className="h-3.5 w-3.5 text-accent" />
                    <span className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground font-bold">Sistema</span>
                  </div>
                  <div className="space-y-3">
                    {[
                      { label: "Indicadores BCB", value: String(POPULAR_SERIES.length) },
                      { label: "Módulos Ativos", value: "3" },
                      { label: "Edge Functions", value: "8" },
                      { label: "APIs Integradas", value: "BCB, Perplexity" },
                    ].map((item) => (
                      <div key={item.label} className="flex items-center justify-between">
                        <span className="text-[11px] text-muted-foreground font-medium">{item.label}</span>
                        <span className="text-[11px] font-bold text-foreground bg-secondary/60 px-2.5 py-0.5 rounded-full">
                          {item.value}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  );
};

export default Index;
