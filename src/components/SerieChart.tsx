import { useQuery } from "@tanstack/react-query";
import { fetchSerie, POPULAR_SERIES } from "@/lib/bcb-api";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";

interface Props {
  codigo: number;
  onBack: () => void;
}

export function SerieChart({ codigo, onBack }: Props) {
  const serie = POPULAR_SERIES.find((s) => s.codigo === codigo);

  const { data, isLoading, error } = useQuery({
    queryKey: ["bcb-serie", codigo],
    queryFn: () => fetchSerie(codigo),
    staleTime: 5 * 60 * 1000,
  });

  const chartData = data?.map((item) => ({
    data: item.data,
    valor: Number(item.valor),
  }));

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={onBack}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <CardTitle>{serie?.nome || `Série ${codigo}`}</CardTitle>
            <CardDescription>Últimos 12 meses · {serie?.unidade}</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-72 w-full" />
        ) : error ? (
          <p className="text-destructive text-sm">Erro ao carregar dados.</p>
        ) : chartData && chartData.length > 0 ? (
          <ResponsiveContainer width="100%" height={320}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(220, 15%, 88%)" />
              <XAxis
                dataKey="data"
                tick={{ fontSize: 11 }}
                tickFormatter={(v) => {
                  const parts = v.split("/");
                  return `${parts[1]}/${parts[2]?.slice(2)}`;
                }}
              />
              <YAxis tick={{ fontSize: 11 }} domain={["auto", "auto"]} />
              <Tooltip
                contentStyle={{
                  borderRadius: "0.5rem",
                  border: "1px solid hsl(220, 15%, 88%)",
                  fontSize: "0.875rem",
                }}
                formatter={(value: number) => [
                  value.toLocaleString("pt-BR", { maximumFractionDigits: 4 }),
                  serie?.unidade || "Valor",
                ]}
              />
              <Line
                type="monotone"
                dataKey="valor"
                stroke="hsl(215, 80%, 45%)"
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4 }}
              />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <p className="text-muted-foreground text-sm">Nenhum dado disponível.</p>
        )}
      </CardContent>
    </Card>
  );
}
