import { useState } from "react";
import { Link } from "react-router-dom";
import { POPULAR_SERIES } from "@/lib/bcb-api";
import { SerieCard } from "@/components/SerieCard";
import { SerieChart } from "@/components/SerieChart";
import { CustomSerieSearch } from "@/components/CustomSerieSearch";
import { Landmark, Building2 } from "lucide-react";
import { Button } from "@/components/ui/button";

const Index = () => {
  const [selectedSerie, setSelectedSerie] = useState<number | null>(null);

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-primary rounded-lg p-2">
              <Landmark className="h-5 w-5 text-primary-foreground" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-foreground">Dados do Banco Central</h1>
              <p className="text-xs text-muted-foreground">Indicadores econômicos em tempo real · API SGS/BCB</p>
            </div>
          </div>
          <Link to="/empresas">
            <Button variant="outline" className="gap-2">
              <Building2 className="h-4 w-4" />
              Busca de Empresas
            </Button>
          </Link>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-8 space-y-8">
        {selectedSerie ? (
          <SerieChart codigo={selectedSerie} onBack={() => setSelectedSerie(null)} />
        ) : (
          <>
            <section className="space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div>
                  <h2 className="text-xl font-semibold text-foreground">Indicadores Populares</h2>
                  <p className="text-sm text-muted-foreground">
                    Clique em um indicador para ver o histórico
                  </p>
                </div>
                <CustomSerieSearch onSearch={setSelectedSerie} />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {POPULAR_SERIES.map((serie) => (
                  <SerieCard key={serie.codigo} serie={serie} onClick={setSelectedSerie} />
                ))}
              </div>
            </section>
          </>
        )}
      </main>
    </div>
  );
};

export default Index;
