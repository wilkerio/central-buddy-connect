import { useQuery } from "@tanstack/react-query";
import { fetchUltimoValor, type PopularSerie } from "@/lib/bcb-api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { TrendingUp } from "lucide-react";

interface Props {
  serie: PopularSerie;
  onClick: (codigo: number) => void;
}

export function SerieCard({ serie, onClick }: Props) {
  const { data, isLoading } = useQuery({
    queryKey: ["bcb-ultimo", serie.codigo],
    queryFn: () => fetchUltimoValor(serie.codigo),
    staleTime: 5 * 60 * 1000,
  });

  return (
    <Card
      className="cursor-pointer transition-all hover:shadow-lg hover:-translate-y-0.5 hover:border-primary/30"
      onClick={() => onClick(serie.codigo)}
    >
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground leading-tight">
          {serie.nome}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-8 w-24" />
        ) : data ? (
          <div className="flex items-end gap-2">
            <span className="text-2xl font-bold text-foreground">
              {Number(data.valor).toLocaleString("pt-BR", { maximumFractionDigits: 4 })}
            </span>
            <span className="text-xs text-muted-foreground mb-1">{serie.unidade}</span>
          </div>
        ) : (
          <span className="text-sm text-muted-foreground">Sem dados</span>
        )}
        {data && (
          <p className="text-xs text-muted-foreground mt-1">Ref: {data.data}</p>
        )}
      </CardContent>
    </Card>
  );
}
