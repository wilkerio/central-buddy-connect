import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchCnpj, searchInstituicoesFinanceiras } from "@/lib/empresa-api";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Search, Building2, Landmark, ArrowLeft, Users } from "lucide-react";
import { Link } from "react-router-dom";

export default function Empresas() {
  const [cnpjInput, setCnpjInput] = useState("");
  const [cnpjSearch, setCnpjSearch] = useState("");
  const [ifInput, setIfInput] = useState("");
  const [ifSearch, setIfSearch] = useState("");

  const cnpjQuery = useQuery({
    queryKey: ["cnpj", cnpjSearch],
    queryFn: () => fetchCnpj(cnpjSearch),
    enabled: !!cnpjSearch,
    retry: false,
  });

  const ifQuery = useQuery({
    queryKey: ["if-search", ifSearch],
    queryFn: () => searchInstituicoesFinanceiras(ifSearch),
    enabled: !!ifSearch,
  });

  const handleCnpjSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (cnpjInput.replace(/\D/g, "").length === 14) {
      setCnpjSearch(cnpjInput);
    }
  };

  const handleIfSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (ifInput.trim().length >= 2) {
      setIfSearch(ifInput.trim());
    }
  };

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
          <div>
            <h1 className="text-lg font-bold text-foreground">Busca de Empresas</h1>
            <p className="text-xs text-muted-foreground">Receita Federal (CNPJ) · Instituições Financeiras (BCB)</p>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-8">
        <Tabs defaultValue="cnpj" className="space-y-6">
          <TabsList className="grid w-full max-w-md grid-cols-2">
            <TabsTrigger value="cnpj" className="gap-2">
              <Building2 className="h-4 w-4" />
              CNPJ
            </TabsTrigger>
            <TabsTrigger value="if" className="gap-2">
              <Landmark className="h-4 w-4" />
              Inst. Financeiras
            </TabsTrigger>
          </TabsList>

          {/* CNPJ Tab */}
          <TabsContent value="cnpj" className="space-y-6">
            <form onSubmit={handleCnpjSearch} className="flex gap-2 max-w-md">
              <Input
                placeholder="Digite o CNPJ (ex: 00.000.000/0001-91)"
                value={cnpjInput}
                onChange={(e) => setCnpjInput(e.target.value)}
              />
              <Button type="submit" disabled={cnpjInput.replace(/\D/g, "").length !== 14}>
                <Search className="h-4 w-4 mr-2" />
                Buscar
              </Button>
            </form>

            {cnpjQuery.isLoading && (
              <div className="space-y-4">
                <Skeleton className="h-40 w-full" />
                <Skeleton className="h-40 w-full" />
              </div>
            )}

            {cnpjQuery.error && (
              <Card className="border-destructive/50">
                <CardContent className="pt-6">
                  <p className="text-destructive text-sm">{(cnpjQuery.error as Error).message}</p>
                </CardContent>
              </Card>
            )}

            {cnpjQuery.data && (
              <div className="space-y-4">
                <Card>
                  <CardHeader>
                    <div className="flex items-start justify-between">
                      <div>
                        <CardTitle className="text-xl">{cnpjQuery.data.razao_social}</CardTitle>
                        {cnpjQuery.data.nome_fantasia && (
                          <CardDescription className="text-base mt-1">
                            {cnpjQuery.data.nome_fantasia}
                          </CardDescription>
                        )}
                      </div>
                      <Badge
                        variant={cnpjQuery.data.situacao_cadastral === "ATIVA" ? "default" : "destructive"}
                      >
                        {cnpjQuery.data.situacao_cadastral}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                      <InfoItem label="CNPJ" value={formatCnpj(cnpjQuery.data.cnpj)} />
                      <InfoItem
                        label="Capital Social"
                        value={formatCurrency(cnpjQuery.data.capital_social)}
                        highlight
                      />
                      <InfoItem label="Porte" value={cnpjQuery.data.porte} />
                      <InfoItem label="Natureza Jurídica" value={cnpjQuery.data.natureza_juridica} />
                      <InfoItem label="CNAE" value={cnpjQuery.data.cnae_fiscal_descricao} />
                      <InfoItem label="Início Atividade" value={cnpjQuery.data.data_inicio_atividade} />
                      <InfoItem
                        label="Endereço"
                        value={`${cnpjQuery.data.logradouro}, ${cnpjQuery.data.numero} - ${cnpjQuery.data.bairro}, ${cnpjQuery.data.municipio}/${cnpjQuery.data.uf}`}
                      />
                      {cnpjQuery.data.email && <InfoItem label="Email" value={cnpjQuery.data.email} />}
                      {cnpjQuery.data.ddd_telefone_1 && (
                        <InfoItem label="Telefone" value={cnpjQuery.data.ddd_telefone_1} />
                      )}
                    </div>
                  </CardContent>
                </Card>

                {cnpjQuery.data.qsa && cnpjQuery.data.qsa.length > 0 && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base flex items-center gap-2">
                        <Users className="h-4 w-4" />
                        Quadro Societário ({cnpjQuery.data.qsa.length})
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Nome</TableHead>
                            <TableHead>Qualificação</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {cnpjQuery.data.qsa.map((socio, i) => (
                            <TableRow key={i}>
                              <TableCell className="font-medium">{socio.nome_socio}</TableCell>
                              <TableCell>{socio.qualificacao_socio}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </CardContent>
                  </Card>
                )}
              </div>
            )}
          </TabsContent>

          {/* IF Tab */}
          <TabsContent value="if" className="space-y-6">
            <form onSubmit={handleIfSearch} className="flex gap-2 max-w-md">
              <Input
                placeholder="Nome da instituição (ex: Banco do Brasil)"
                value={ifInput}
                onChange={(e) => setIfInput(e.target.value)}
              />
              <Button type="submit" disabled={ifInput.trim().length < 2}>
                <Search className="h-4 w-4 mr-2" />
                Buscar
              </Button>
            </form>

            {ifQuery.isLoading && <Skeleton className="h-60 w-full" />}

            {ifQuery.data && ifQuery.data.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">
                    Resultados ({ifQuery.data.length})
                  </CardTitle>
                </CardHeader>
                <CardContent>
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
                      {ifQuery.data.map((item) => (
                        <TableRow key={item.codigoIf}>
                          <TableCell className="font-medium">{item.nomeIf}</TableCell>
                          <TableCell className="text-xs font-mono">{item.cnpj}</TableCell>
                          <TableCell>
                            <Badge variant="secondary">{item.segmento}</Badge>
                          </TableCell>
                          <TableCell className="text-sm">{item.tipoInstituicao}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            )}

            {ifQuery.data && ifQuery.data.length === 0 && (
              <p className="text-muted-foreground text-sm">Nenhuma instituição encontrada.</p>
            )}
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}

function InfoItem({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`text-sm font-medium ${highlight ? "text-primary text-lg" : "text-foreground"}`}>
        {value}
      </p>
    </div>
  );
}
