import { useState, useCallback } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { fetchCnpj, type CnpjData } from "@/lib/empresa-api";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import {
  ArrowLeft, Search, Loader2, Globe, TrendingUp, Building2, Shield,
  DollarSign, BarChart3, CheckCircle2, XCircle, AlertTriangle,
  FileText, Download, RefreshCw, Plus, Trash2, ChevronRight
} from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend, RadarChart, Radar, PolarGrid,
  PolarAngleAxis, PolarRadiusAxis
} from "recharts";

const MODALITY_LABELS: Record<string, { label: string; icon: any; color: string }> = {
  corporate_finance: { label: 'Corporate Finance', icon: Building2, color: 'hsl(215, 80%, 45%)' },
  bonds: { label: 'Bonds', icon: FileText, color: 'hsl(280, 60%, 50%)' },
  stock_funding: { label: 'Stock Funding', icon: TrendingUp, color: 'hsl(150, 60%, 40%)' },
  cash_backed: { label: 'Cash Backed', icon: DollarSign, color: 'hsl(45, 90%, 50%)' },
  private_hard_lender: { label: 'Private Hard Lender', icon: Shield, color: 'hsl(0, 60%, 50%)' },
};

const PIE_COLORS = ['hsl(215, 80%, 45%)', 'hsl(150, 60%, 40%)', 'hsl(45, 90%, 50%)', 'hsl(280, 60%, 50%)', 'hsl(0, 60%, 50%)'];

interface AnalysisData {
  financial_data: any;
  collaterals: any;
  liabilities: any;
  internationalization_capacity: any;
}

interface ScoreResult {
  overall_score: number;
  risk_classification: string;
  classification: string;
  score_breakdown: Record<string, number>;
  modalities: Record<string, any>;
  eligible_modalities: Array<{ modality: string; score: number; amount: number }>;
  estimated_credit_total_usd: number;
  recommendations: string[];
}

const defaultFinancial = {
  faturamento_anual: 0,
  receita_bruta_anual: 0,
  receita_liquida_anual: 0,
  lucro_bruto: 0,
  lucro_liquido: 0,
  ebitda: 0,
  ativo_total: 0,
  patrimonio_liquido: 0,
  passivo_total: 0,
  passivo_circulante: 0,
  ativo_circulante: 0,
  capital_social: 0,
  margem_bruta: 0,
  margem_liquida: 0,
  roe: 0,
  roa: 0,
  liquidez_corrente: 0,
  endividamento_total: 0,
  despesas_financeiras: 0,
};

const defaultCollaterals = {
  imoveis: [] as any[],
  acoes_bolsa: [] as any[],
  conta_investimento: { banco: '', valor_total: 0, banco_prime: false },
  recebiveis_exportacao: { valor_total: 0, prazo_medio: 0 },
};

const defaultLiabilities = {
  dividas_fiscais: { valor_total: 0, certidao_negativa: false },
  dividas_trabalhistas: { valor_total: 0, processos_ativos: 0 },
  protestos: [] as any[],
  acoes_judiciais: { quantidade: 0, valor_total: 0 },
  score_credito_serasa: 0,
};

const defaultIntl = {
  tem_offshore_company: false,
  pais_offshore: '',
  estrutura_juridica_internacional: false,
  experiencia_exportacao_anos: 0,
  paises_atuacao: [] as string[],
  registro_bolsa_valores: false,
  possui_rating: false,
  agencia_rating: '',
  nota_rating: '',
  auditoria_internacional: false,
  governanca_internacional: false,
  compliance_internacional: false,
};

function formatUSD(val: number) {
  return val.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}

function formatBRL(val: number) {
  return val.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
}

export default function InternacionalizacaoAnalise() {
  const [step, setStep] = useState<'search' | 'form' | 'result'>('search');
  const [cnpjInput, setCnpjInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [empresa, setEmpresa] = useState<CnpjData | null>(null);

  const [financial, setFinancial] = useState({ ...defaultFinancial });
  const [collaterals, setCollaterals] = useState({ ...defaultCollaterals });
  const [liabilities, setLiabilities] = useState({ ...defaultLiabilities });
  const [intl, setIntl] = useState({ ...defaultIntl });

  const [scoreResult, setScoreResult] = useState<ScoreResult | null>(null);
  const [calculating, setCalculating] = useState(false);
  const [cvmData, setCvmData] = useState<any>(null);
  const [sancoesData, setSancoesData] = useState<any>(null);

  const searchCnpj = async () => {
    const cleaned = cnpjInput.replace(/\D/g, '');
    if (cleaned.length !== 14) return;
    setLoading(true);
    try {
      const data = await fetchCnpj(cleaned);
      setEmpresa(data);
      setFinancial(prev => ({ ...prev, capital_social: data.capital_social || 0 }));
      // Auto-fetch additional data from existing edge functions
      autoFetchData(data);
      setStep('form');
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const autoFetchData = async (emp: CnpjData) => {
    // Fetch all data sources in parallel
    const fetchFaturamento = async () => {
      try {
        const { data } = await supabase.functions.invoke('buscar-faturamento', {
          body: {
            cnpj: emp.cnpj, razao_social: emp.razao_social,
            capital_social: emp.capital_social, cnae_fiscal: emp.cnae_fiscal,
            porte: emp.porte, data_inicio_atividade: emp.data_inicio_atividade,
          },
        });
        if (data?.success && data.estimativa) {
          setFinancial(prev => ({
            ...prev,
            faturamento_anual: data.estimativa.anual,
            receita_bruta_anual: data.estimativa.anual,
            receita_liquida_anual: Math.round(data.estimativa.anual * 0.85),
            lucro_bruto: Math.round(data.estimativa.anual * 0.3),
            ebitda: Math.round(data.estimativa.anual * 0.15),
            lucro_liquido: Math.round(data.estimativa.anual * 0.08),
            ativo_total: Math.round(data.estimativa.anual * 1.2),
            patrimonio_liquido: Math.round(data.estimativa.anual * 0.4),
            passivo_total: Math.round(data.estimativa.anual * 0.8),
            passivo_circulante: Math.round(data.estimativa.anual * 0.3),
            ativo_circulante: Math.round(data.estimativa.anual * 0.5),
            margem_bruta: 30,
            margem_liquida: 8,
            roe: 20,
            roa: 7,
            liquidez_corrente: 1.67,
            endividamento_total: 0.67,
          }));
        }
      } catch { /* silent */ }
    };

    const fetchGarantias = async () => {
      try {
        const { data } = await supabase.functions.invoke('buscar-garantias', {
          body: { cnpj: emp.cnpj, razao_social: emp.razao_social, capital_social: emp.capital_social, porte: emp.porte },
        });
        if (data?.success && data.capacidade_garantia) {
          setCollaterals(prev => ({
            ...prev,
            imoveis: [{
              tipo: 'industrial',
              valor_avaliacao: data.capacidade_garantia.valor_estimado || 0,
              valor_mercado: data.capacidade_garantia.valor_estimado || 0,
              livre_onus: true,
              localizacao: emp.municipio + '/' + emp.uf,
            }],
          }));
        }
      } catch { /* silent */ }
    };

    const fetchCVM = async () => {
      try {
        const { data } = await supabase.functions.invoke('buscar-cvm', {
          body: { cnpj: emp.cnpj, razao_social: emp.razao_social },
        });
        if (data?.success) {
          // Override financial data with CVM real data if available
          if (data.dados_financeiros) {
            const df = data.dados_financeiros;
            setFinancial(prev => ({
              ...prev,
              ...(df.receita_liquida > 0 && { receita_liquida_anual: df.receita_liquida, receita_bruta_anual: Math.round(df.receita_liquida * 1.18), faturamento_anual: Math.round(df.receita_liquida * 1.18) }),
              ...(df.lucro_liquido !== 0 && { lucro_liquido: df.lucro_liquido }),
              ...(df.ebitda > 0 && { ebitda: df.ebitda }),
              ...(df.patrimonio_liquido > 0 && { patrimonio_liquido: df.patrimonio_liquido }),
              ...(df.ativo_total > 0 && { ativo_total: df.ativo_total }),
            }));
          }
          // Auto-fill international governance if CVM registered
          if (data.is_registrada_cvm) {
            setIntl(prev => ({
              ...prev,
              registro_bolsa_valores: data.listada_b3 || prev.registro_bolsa_valores,
              auditoria_internacional: true,
              governanca_internacional: true,
              ...(data.rating && { possui_rating: true, agencia_rating: data.rating.agencia, nota_rating: data.rating.nota }),
            }));
          }
          setCvmData(data);
        }
      } catch { /* silent */ }
    };

    const fetchSancoes = async () => {
      try {
        const { data } = await supabase.functions.invoke('buscar-sancoes-gov', {
          body: { cnpj: emp.cnpj, razao_social: emp.razao_social },
        });
        if (data?.success) {
          setSancoesData(data);
          // If sanctions found, reduce score
          if (data.total_sancoes > 0) {
            setLiabilities(prev => ({
              ...prev,
              score_credito_serasa: Math.max(0, (prev.score_credito_serasa || 700) - (data.total_sancoes * 150)),
            }));
          }
        }
      } catch { /* silent */ }
    };

    // Run all fetches in parallel
    await Promise.all([fetchFaturamento(), fetchGarantias(), fetchCVM(), fetchSancoes()]);
  };

  const calculateScore = async () => {
    setCalculating(true);
    try {
      const { data, error } = await supabase.functions.invoke('calculate-internationalization-score', {
        body: {
          financial_data: financial,
          collaterals,
          liabilities,
          internationalization_capacity: intl,
        },
      });
      if (error) throw error;
      if (data?.success) {
        setScoreResult(data);
        // Save to database
        await supabase.from('internationalization_analyses').insert({
          cnpj: empresa!.cnpj,
          razao_social: empresa!.razao_social,
          company_data: empresa as any,
          financial_data: financial as any,
          collaterals: collaterals as any,
          liabilities: liabilities as any,
          internationalization_capacity: intl as any,
          overall_score: data.overall_score,
          risk_classification: data.risk_classification,
          eligible_modalities: data.eligible_modalities as any,
          estimated_credit_amount_usd: data.estimated_credit_total_usd,
          modality_results: data.modalities as any,
          status: 'completed',
        } as any);
        setStep('result');
      }
    } catch (err) {
      console.error(err);
    } finally {
      setCalculating(false);
    }
  };

  const exportPDF = () => {
    // Generate a printable version
    window.print();
  };

  const resetAnalysis = () => {
    setStep('search');
    setEmpresa(null);
    setFinancial({ ...defaultFinancial });
    setCollaterals({ ...defaultCollaterals });
    setLiabilities({ ...defaultLiabilities });
    setIntl({ ...defaultIntl });
    setScoreResult(null);
    setCnpjInput('');
  };

  return (
    <div className="min-h-screen bg-background print:bg-white">
      {/* Header */}
      <header className="border-b bg-card sticky top-0 z-10 print:hidden">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center gap-3">
          <Link to="/empresas">
            <Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button>
          </Link>
          <div className="bg-primary rounded-lg p-2">
            <Globe className="h-5 w-5 text-primary-foreground" />
          </div>
          <div className="flex-1">
            <h1 className="text-lg font-bold text-foreground">Análise de Internacionalização</h1>
            <p className="text-xs text-muted-foreground">
              Elegibilidade para crédito internacional · ACI
            </p>
          </div>
          {step !== 'search' && (
            <Button variant="outline" size="sm" onClick={resetAnalysis} className="gap-2">
              <RefreshCw className="h-4 w-4" /> Nova Análise
            </Button>
          )}
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-8 space-y-6">
        {/* Step: Search */}
        {step === 'search' && (
          <div className="flex flex-col items-center justify-center min-h-[60vh] space-y-8">
            <div className="text-center space-y-3">
              <div className="mx-auto bg-primary/10 rounded-full p-6 w-fit">
                <Globe className="h-12 w-12 text-primary" />
              </div>
              <h2 className="text-2xl font-bold text-foreground">Análise de Elegibilidade</h2>
              <p className="text-muted-foreground max-w-md">
                Insira o CNPJ da empresa para iniciar a análise de elegibilidade para
                internacionalização e crédito internacional.
              </p>
            </div>
            <form onSubmit={(e) => { e.preventDefault(); searchCnpj(); }} className="flex gap-3 w-full max-w-md">
              <Input
                placeholder="00.000.000/0001-00"
                value={cnpjInput}
                onChange={(e) => setCnpjInput(e.target.value)}
                className="text-lg h-12"
              />
              <Button type="submit" disabled={cnpjInput.replace(/\D/g, '').length !== 14 || loading} className="h-12 px-6 gap-2">
                {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Search className="h-5 w-5" />}
                Analisar
              </Button>
            </form>
          </div>
        )}

        {/* Step: Form */}
        {step === 'form' && empresa && (
          <div className="space-y-6">
            {/* Company header */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Building2 className="h-5 w-5 text-primary" />
                  {empresa.nome_fantasia || empresa.razao_social}
                </CardTitle>
                <CardDescription>
                  CNPJ: {empresa.cnpj.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5")} · {empresa.porte} · {empresa.municipio}/{empresa.uf}
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-2">
                {cvmData && (
                  cvmData.is_registrada_cvm ? (
                    <Badge className="bg-primary/10 text-primary border-primary/20">
                      <CheckCircle2 className="h-3 w-3 mr-1" /> CVM Registrada {cvmData.categoria_cvm ? `(Cat. ${cvmData.categoria_cvm})` : ''}
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-muted-foreground">
                      CVM: Não registrada
                    </Badge>
                  )
                )}
                {cvmData?.listada_b3 && (
                  <Badge className="bg-primary/10 text-primary border-primary/20">
                    <TrendingUp className="h-3 w-3 mr-1" /> Listada B3
                  </Badge>
                )}
                {cvmData?.rating && (
                  <Badge className="bg-primary/10 text-primary border-primary/20">
                    Rating: {cvmData.rating.nota} ({cvmData.rating.agencia})
                  </Badge>
                )}
                {sancoesData && (
                  sancoesData.total_sancoes === 0 ? (
                    <Badge className="bg-emerald-500/10 text-emerald-600 border-emerald-500/20">
                      <CheckCircle2 className="h-3 w-3 mr-1" /> Sem sanções governamentais
                    </Badge>
                  ) : (
                    <Badge variant="destructive">
                      <AlertTriangle className="h-3 w-3 mr-1" /> {sancoesData.total_sancoes} sanção(ões) encontrada(s)
                    </Badge>
                  )
                )}
                {!cvmData && <Badge variant="outline" className="text-muted-foreground"><Loader2 className="h-3 w-3 mr-1 animate-spin" /> CVM...</Badge>}
                {!sancoesData && <Badge variant="outline" className="text-muted-foreground"><Loader2 className="h-3 w-3 mr-1 animate-spin" /> Sanções...</Badge>}
              </CardContent>
            </Card>

            <Tabs defaultValue="financeiro" className="space-y-4">
              <TabsList className="grid w-full grid-cols-4">
                <TabsTrigger value="financeiro">Financeiro</TabsTrigger>
                <TabsTrigger value="garantias">Garantias</TabsTrigger>
                <TabsTrigger value="passivos">Passivos</TabsTrigger>
                <TabsTrigger value="internacional">Internacional</TabsTrigger>
              </TabsList>

              {/* Financeiro Tab */}
              <TabsContent value="financeiro" className="space-y-4">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base flex items-center gap-2">
                      <BarChart3 className="h-4 w-4 text-primary" /> Dados Financeiros
                    </CardTitle>
                    <CardDescription>Preencha ou ajuste os dados financeiros. Valores estimados foram pré-carregados.</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      {[
                        { key: 'faturamento_anual', label: 'Faturamento Anual (R$)' },
                        { key: 'receita_bruta_anual', label: 'Receita Bruta Anual (R$)' },
                        { key: 'receita_liquida_anual', label: 'Receita Líquida Anual (R$)' },
                        { key: 'lucro_bruto', label: 'Lucro Bruto (R$)' },
                        { key: 'lucro_liquido', label: 'Lucro Líquido (R$)' },
                        { key: 'ebitda', label: 'EBITDA (R$)' },
                        { key: 'ativo_total', label: 'Ativo Total (R$)' },
                        { key: 'ativo_circulante', label: 'Ativo Circulante (R$)' },
                        { key: 'passivo_total', label: 'Passivo Total (R$)' },
                        { key: 'passivo_circulante', label: 'Passivo Circulante (R$)' },
                        { key: 'patrimonio_liquido', label: 'Patrimônio Líquido (R$)' },
                        { key: 'capital_social', label: 'Capital Social (R$)' },
                        { key: 'margem_bruta', label: 'Margem Bruta (%)' },
                        { key: 'margem_liquida', label: 'Margem Líquida (%)' },
                        { key: 'roe', label: 'ROE (%)' },
                        { key: 'liquidez_corrente', label: 'Liquidez Corrente' },
                        { key: 'endividamento_total', label: 'Endividamento Total (0-1)' },
                        { key: 'despesas_financeiras', label: 'Despesas Financeiras (R$)' },
                      ].map(({ key, label }) => (
                        <div key={key} className="space-y-1">
                          <label className="text-xs font-medium text-muted-foreground">{label}</label>
                          <Input
                            type="number"
                            step="any"
                            value={(financial as any)[key] || ''}
                            onChange={(e) => setFinancial(prev => ({ ...prev, [key]: parseFloat(e.target.value) || 0 }))}
                          />
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>

              {/* Garantias Tab */}
              <TabsContent value="garantias" className="space-y-4">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base flex items-center gap-2">
                      <Shield className="h-4 w-4 text-primary" /> Imóveis
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {collaterals.imoveis.map((imovel: any, idx: number) => (
                      <div key={idx} className="grid grid-cols-2 md:grid-cols-4 gap-3 p-3 border rounded-lg relative">
                        <button
                          className="absolute -top-2 -right-2 bg-destructive text-destructive-foreground rounded-full p-1"
                          onClick={() => setCollaterals(prev => ({
                            ...prev,
                            imoveis: prev.imoveis.filter((_: any, i: number) => i !== idx)
                          }))}
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                        <div className="space-y-1">
                          <label className="text-xs text-muted-foreground">Tipo</label>
                          <select
                            className="w-full border rounded-md p-2 text-sm bg-background"
                            value={imovel.tipo}
                            onChange={(e) => {
                              const updated = [...collaterals.imoveis];
                              updated[idx] = { ...updated[idx], tipo: e.target.value };
                              setCollaterals(prev => ({ ...prev, imoveis: updated }));
                            }}
                          >
                            <option value="urbano">Urbano</option>
                            <option value="rural">Rural</option>
                            <option value="industrial">Industrial</option>
                          </select>
                        </div>
                        <div className="space-y-1">
                          <label className="text-xs text-muted-foreground">Valor Avaliação (R$)</label>
                          <Input
                            type="number"
                            value={imovel.valor_avaliacao || ''}
                            onChange={(e) => {
                              const updated = [...collaterals.imoveis];
                              updated[idx] = { ...updated[idx], valor_avaliacao: parseFloat(e.target.value) || 0 };
                              setCollaterals(prev => ({ ...prev, imoveis: updated }));
                            }}
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-xs text-muted-foreground">Localização</label>
                          <Input
                            value={imovel.localizacao || ''}
                            onChange={(e) => {
                              const updated = [...collaterals.imoveis];
                              updated[idx] = { ...updated[idx], localizacao: e.target.value };
                              setCollaterals(prev => ({ ...prev, imoveis: updated }));
                            }}
                          />
                        </div>
                        <div className="flex items-end gap-2">
                          <label className="flex items-center gap-2 text-xs">
                            <input
                              type="checkbox"
                              checked={imovel.livre_onus || false}
                              onChange={(e) => {
                                const updated = [...collaterals.imoveis];
                                updated[idx] = { ...updated[idx], livre_onus: e.target.checked };
                                setCollaterals(prev => ({ ...prev, imoveis: updated }));
                              }}
                            />
                            Livre de ônus
                          </label>
                        </div>
                      </div>
                    ))}
                    <Button
                      variant="outline" size="sm"
                      onClick={() => setCollaterals(prev => ({
                        ...prev,
                        imoveis: [...prev.imoveis, { tipo: 'urbano', valor_avaliacao: 0, livre_onus: true, localizacao: '' }]
                      }))}
                      className="gap-2"
                    >
                      <Plus className="h-4 w-4" /> Adicionar Imóvel
                    </Button>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Conta de Investimento</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div className="space-y-1">
                        <label className="text-xs text-muted-foreground">Banco</label>
                        <Input
                          value={collaterals.conta_investimento.banco}
                          onChange={(e) => setCollaterals(prev => ({
                            ...prev,
                            conta_investimento: { ...prev.conta_investimento, banco: e.target.value }
                          }))}
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs text-muted-foreground">Valor Total (R$)</label>
                        <Input
                          type="number"
                          value={collaterals.conta_investimento.valor_total || ''}
                          onChange={(e) => setCollaterals(prev => ({
                            ...prev,
                            conta_investimento: { ...prev.conta_investimento, valor_total: parseFloat(e.target.value) || 0 }
                          }))}
                        />
                      </div>
                      <div className="flex items-end">
                        <label className="flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={collaterals.conta_investimento.banco_prime}
                            onChange={(e) => setCollaterals(prev => ({
                              ...prev,
                              conta_investimento: { ...prev.conta_investimento, banco_prime: e.target.checked }
                            }))}
                          />
                          Banco Prime (JP Morgan, Citi, HSBC...)
                        </label>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>

              {/* Passivos Tab */}
              <TabsContent value="passivos" className="space-y-4">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base flex items-center gap-2">
                      <AlertTriangle className="h-4 w-4 text-destructive" /> Passivos e Dívidas
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div className="space-y-4">
                        <h4 className="text-sm font-semibold">Dívidas Fiscais</h4>
                        <div className="space-y-3">
                          <div className="space-y-1">
                            <label className="text-xs text-muted-foreground">Valor Total (R$)</label>
                            <Input
                              type="number"
                              value={liabilities.dividas_fiscais.valor_total || ''}
                              onChange={(e) => setLiabilities(prev => ({
                                ...prev,
                                dividas_fiscais: { ...prev.dividas_fiscais, valor_total: parseFloat(e.target.value) || 0 }
                              }))}
                            />
                          </div>
                          <label className="flex items-center gap-2 text-sm">
                            <input
                              type="checkbox"
                              checked={liabilities.dividas_fiscais.certidao_negativa}
                              onChange={(e) => setLiabilities(prev => ({
                                ...prev,
                                dividas_fiscais: { ...prev.dividas_fiscais, certidao_negativa: e.target.checked }
                              }))}
                            />
                            Possui Certidão Negativa
                          </label>
                        </div>
                      </div>

                      <div className="space-y-4">
                        <h4 className="text-sm font-semibold">Dívidas Trabalhistas</h4>
                        <div className="grid grid-cols-2 gap-3">
                          <div className="space-y-1">
                            <label className="text-xs text-muted-foreground">Valor Total (R$)</label>
                            <Input
                              type="number"
                              value={liabilities.dividas_trabalhistas.valor_total || ''}
                              onChange={(e) => setLiabilities(prev => ({
                                ...prev,
                                dividas_trabalhistas: { ...prev.dividas_trabalhistas, valor_total: parseFloat(e.target.value) || 0 }
                              }))}
                            />
                          </div>
                          <div className="space-y-1">
                            <label className="text-xs text-muted-foreground">Processos Ativos</label>
                            <Input
                              type="number"
                              value={liabilities.dividas_trabalhistas.processos_ativos || ''}
                              onChange={(e) => setLiabilities(prev => ({
                                ...prev,
                                dividas_trabalhistas: { ...prev.dividas_trabalhistas, processos_ativos: parseInt(e.target.value) || 0 }
                              }))}
                            />
                          </div>
                        </div>
                      </div>

                      <div className="space-y-4">
                        <h4 className="text-sm font-semibold">Ações Judiciais</h4>
                        <div className="grid grid-cols-2 gap-3">
                          <div className="space-y-1">
                            <label className="text-xs text-muted-foreground">Quantidade</label>
                            <Input
                              type="number"
                              value={liabilities.acoes_judiciais.quantidade || ''}
                              onChange={(e) => setLiabilities(prev => ({
                                ...prev,
                                acoes_judiciais: { ...prev.acoes_judiciais, quantidade: parseInt(e.target.value) || 0 }
                              }))}
                            />
                          </div>
                          <div className="space-y-1">
                            <label className="text-xs text-muted-foreground">Valor Total (R$)</label>
                            <Input
                              type="number"
                              value={liabilities.acoes_judiciais.valor_total || ''}
                              onChange={(e) => setLiabilities(prev => ({
                                ...prev,
                                acoes_judiciais: { ...prev.acoes_judiciais, valor_total: parseFloat(e.target.value) || 0 }
                              }))}
                            />
                          </div>
                        </div>
                      </div>

                      <div className="space-y-4">
                        <h4 className="text-sm font-semibold">Score de Crédito</h4>
                        <div className="space-y-1">
                          <label className="text-xs text-muted-foreground">Score Serasa (0-1000)</label>
                          <Input
                            type="number"
                            min="0"
                            max="1000"
                            value={liabilities.score_credito_serasa || ''}
                            onChange={(e) => setLiabilities(prev => ({
                              ...prev,
                              score_credito_serasa: parseInt(e.target.value) || 0
                            }))}
                          />
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* Sanctions Card */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base flex items-center gap-2">
                      <Shield className="h-4 w-4 text-primary" /> Sanções Governamentais (CEIS/CNEP/CEPIM)
                    </CardTitle>
                    <CardDescription>Dados obtidos automaticamente do Portal da Transparência</CardDescription>
                  </CardHeader>
                  <CardContent>
                    {!sancoesData ? (
                      <div className="flex items-center gap-2 text-muted-foreground text-sm">
                        <Loader2 className="h-4 w-4 animate-spin" /> Consultando bases governamentais...
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {Object.entries(sancoesData.sancoes || {}).map(([key, sancao]: [string, any]) => (
                          <div key={key} className={`p-3 rounded-lg border ${sancao.tem_registro ? 'border-destructive/30 bg-destructive/5' : 'border-border bg-muted/30'}`}>
                            <div className="flex items-center gap-2 mb-1">
                              {sancao.tem_registro ? (
                                <XCircle className="h-4 w-4 text-destructive" />
                              ) : (
                                <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                              )}
                              <span className="text-sm font-medium">{sancao.label}</span>
                            </div>
                            {sancao.resumo && (
                              <p className="text-xs text-muted-foreground line-clamp-2 ml-6">{sancao.resumo.substring(0, 200)}</p>
                            )}
                          </div>
                        ))}
                        <div className="flex items-center gap-2 mt-2">
                          <Badge variant={sancoesData.risco_sancoes === 'baixo' ? 'outline' : 'destructive'}>
                            Risco: {sancoesData.risco_sancoes?.toUpperCase()}
                          </Badge>
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>

              {/* Internacional Tab */}
              <TabsContent value="internacional" className="space-y-4">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base flex items-center gap-2">
                      <Globe className="h-4 w-4 text-primary" /> Capacidade de Internacionalização
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div className="space-y-3">
                        <h4 className="text-sm font-semibold">Estrutura Jurídica</h4>
                        <label className="flex items-center gap-2 text-sm">
                          <input type="checkbox" checked={intl.tem_offshore_company}
                            onChange={(e) => setIntl(prev => ({ ...prev, tem_offshore_company: e.target.checked }))} />
                          Possui Offshore/Subsidiária no Exterior
                        </label>
                        {intl.tem_offshore_company && (
                          <Input placeholder="País (ex: Delaware, USA)" value={intl.pais_offshore}
                            onChange={(e) => setIntl(prev => ({ ...prev, pais_offshore: e.target.value }))} />
                        )}
                        <label className="flex items-center gap-2 text-sm">
                          <input type="checkbox" checked={intl.estrutura_juridica_internacional}
                            onChange={(e) => setIntl(prev => ({ ...prev, estrutura_juridica_internacional: e.target.checked }))} />
                          Estrutura Jurídica Internacional
                        </label>
                      </div>

                      <div className="space-y-3">
                        <h4 className="text-sm font-semibold">Experiência</h4>
                        <div className="space-y-1">
                          <label className="text-xs text-muted-foreground">Anos de Experiência em Exportação</label>
                          <Input type="number" value={intl.experiencia_exportacao_anos || ''}
                            onChange={(e) => setIntl(prev => ({ ...prev, experiencia_exportacao_anos: parseInt(e.target.value) || 0 }))} />
                        </div>
                      </div>

                      <div className="space-y-3">
                        <h4 className="text-sm font-semibold">Governança</h4>
                        <label className="flex items-center gap-2 text-sm">
                          <input type="checkbox" checked={intl.registro_bolsa_valores}
                            onChange={(e) => setIntl(prev => ({ ...prev, registro_bolsa_valores: e.target.checked }))} />
                          Registro em Bolsa de Valores
                        </label>
                        <label className="flex items-center gap-2 text-sm">
                          <input type="checkbox" checked={intl.possui_rating}
                            onChange={(e) => setIntl(prev => ({ ...prev, possui_rating: e.target.checked }))} />
                          Possui Rating (Moody's, S&P, Fitch)
                        </label>
                        <label className="flex items-center gap-2 text-sm">
                          <input type="checkbox" checked={intl.auditoria_internacional}
                            onChange={(e) => setIntl(prev => ({ ...prev, auditoria_internacional: e.target.checked }))} />
                          Auditoria Internacional
                        </label>
                        <label className="flex items-center gap-2 text-sm">
                          <input type="checkbox" checked={intl.governanca_internacional}
                            onChange={(e) => setIntl(prev => ({ ...prev, governanca_internacional: e.target.checked }))} />
                          Governança Internacional
                        </label>
                        <label className="flex items-center gap-2 text-sm">
                          <input type="checkbox" checked={intl.compliance_internacional}
                            onChange={(e) => setIntl(prev => ({ ...prev, compliance_internacional: e.target.checked }))} />
                          Compliance Internacional
                        </label>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>

            {/* Calculate Button */}
            <div className="flex justify-center">
              <Button size="lg" onClick={calculateScore} disabled={calculating} className="gap-3 px-8 h-14 text-lg">
                {calculating ? <Loader2 className="h-6 w-6 animate-spin" /> : <BarChart3 className="h-6 w-6" />}
                Calcular Elegibilidade
              </Button>
            </div>
          </div>
        )}

        {/* Step: Result Dashboard */}
        {step === 'result' && scoreResult && empresa && (
          <ResultDashboard
            result={scoreResult}
            empresa={empresa}
            financial={financial}
            collaterals={collaterals}
            onExportPDF={exportPDF}
          />
        )}
      </main>
    </div>
  );
}

function ResultDashboard({
  result, empresa, financial, collaterals, onExportPDF
}: {
  result: ScoreResult;
  empresa: CnpjData;
  financial: any;
  collaterals: any;
  onExportPDF: () => void;
}) {
  const scoreColor = result.overall_score >= 70 ? 'text-emerald-600' : result.overall_score >= 50 ? 'text-amber-500' : 'text-destructive';
  const scoreBg = result.overall_score >= 70 ? 'bg-emerald-50 border-emerald-200' : result.overall_score >= 50 ? 'bg-amber-50 border-amber-200' : 'bg-red-50 border-red-200';

  // Radar chart data
  const radarData = Object.entries(result.score_breakdown).map(([key, val]) => ({
    subject: { tamanho: 'Tamanho', saude: 'Saúde Fin.', garantias: 'Garantias', experiencia: 'Exp. Intl.', governanca: 'Governança', passivos: 'Passivos' }[key] || key,
    score: Math.round(val),
    fullMark: 100,
  }));

  // Pie chart data for collaterals
  const totalImoveis = (collaterals.imoveis || []).reduce((s: number, i: any) => s + (i.valor_avaliacao || 0), 0);
  const totalInvestimento = collaterals.conta_investimento?.valor_total || 0;
  const totalRecebiveis = (collaterals.recebiveis_exportacao?.valor_total || 0);
  const pieData = [
    { name: 'Imóveis', value: totalImoveis },
    { name: 'Investimentos', value: totalInvestimento },
    { name: 'Recebíveis', value: totalRecebiveis },
  ].filter(d => d.value > 0);

  // Financial indicators bar chart
  const finBarData = [
    { name: 'Margem Bruta', value: financial.margem_bruta },
    { name: 'Margem Líq.', value: financial.margem_liquida },
    { name: 'ROE', value: financial.roe },
    { name: 'Liquidez', value: financial.liquidez_corrente * 10 },
    { name: 'Endiv.', value: financial.endividamento_total * 100 },
  ];

  return (
    <div className="space-y-6 print:space-y-4">
      {/* Print header */}
      <div className="hidden print:block text-center mb-8">
        <h1 className="text-2xl font-bold">Relatório de Análise de Internacionalização</h1>
        <p className="text-sm text-muted-foreground">{empresa.razao_social} · {new Date().toLocaleDateString('pt-BR')}</p>
      </div>

      {/* Top bar with export */}
      <div className="flex items-center justify-between print:hidden">
        <div>
          <h2 className="text-xl font-bold text-foreground">{empresa.nome_fantasia || empresa.razao_social}</h2>
          <p className="text-sm text-muted-foreground">CNPJ: {empresa.cnpj.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5")}</p>
        </div>
        <Button onClick={onExportPDF} variant="outline" className="gap-2">
          <Download className="h-4 w-4" /> Exportar PDF
        </Button>
      </div>

      {/* Section 1: Overview */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className={`${scoreBg} border-2`}>
          <CardContent className="pt-6 text-center">
            <p className={`text-5xl font-black ${scoreColor}`}>{result.overall_score}</p>
            <p className="text-xs uppercase tracking-wider text-muted-foreground mt-2">Score Geral</p>
            <Badge className="mt-2" variant={result.overall_score >= 60 ? 'default' : 'destructive'}>
              {result.classification}
            </Badge>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6 text-center">
            <p className="text-3xl font-black text-foreground">{result.risk_classification}</p>
            <p className="text-xs uppercase tracking-wider text-muted-foreground mt-2">Classificação Risco</p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6 text-center">
            <p className="text-3xl font-black text-foreground">{result.eligible_modalities.length}</p>
            <p className="text-xs uppercase tracking-wider text-muted-foreground mt-2">Modalidades Elegíveis</p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6 text-center">
            <p className="text-2xl font-black text-primary">{formatUSD(result.estimated_credit_total_usd)}</p>
            <p className="text-xs uppercase tracking-wider text-muted-foreground mt-2">Crédito Estimado Total</p>
          </CardContent>
        </Card>
      </div>

      {/* Section 2: Modalities */}
      <div>
        <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <DollarSign className="h-5 w-5 text-primary" /> Modalidades de Crédito
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {Object.entries(result.modalities).map(([key, mod]: [string, any]) => {
            const config = MODALITY_LABELS[key];
            const Icon = config?.icon || DollarSign;
            return (
              <Card key={key} className={`overflow-hidden ${mod.eligible ? 'border-emerald-300' : 'border-muted'}`}>
                <div className={`h-1.5 ${mod.eligible ? 'bg-emerald-500' : 'bg-muted'}`} />
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center justify-between">
                    <span className="flex items-center gap-2">
                      <Icon className="h-4 w-4" style={{ color: config?.color }} />
                      {config?.label || key}
                    </span>
                    {mod.eligible ? (
                      <Badge variant="default" className="bg-emerald-600 text-xs">Elegível</Badge>
                    ) : (
                      <Badge variant="secondary" className="text-xs">Não Elegível</Badge>
                    )}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">Score</span>
                    <span className="font-bold">{mod.score}%</span>
                  </div>
                  <Progress value={mod.score} className="h-2" />

                  {mod.eligible && (
                    <div className="grid grid-cols-2 gap-2 pt-2 border-t">
                      <div>
                        <p className="text-[10px] text-muted-foreground">Valor Est.</p>
                        <p className="text-sm font-semibold">{formatUSD(mod.estimated_amount_usd)}</p>
                      </div>
                      <div>
                        <p className="text-[10px] text-muted-foreground">Taxa / Prazo</p>
                        <p className="text-sm font-semibold">{mod.interest_rate}% a.a.</p>
                        <p className="text-[10px] text-muted-foreground">{mod.grace_period}</p>
                      </div>
                    </div>
                  )}

                  {/* Requirements */}
                  <div className="space-y-1 pt-2 border-t">
                    {mod.requirements_met?.map((r: string, i: number) => (
                      <p key={i} className="text-xs flex items-center gap-1 text-emerald-600">
                        <CheckCircle2 className="h-3 w-3 shrink-0" /> {r}
                      </p>
                    ))}
                    {mod.requirements_missing?.map((r: string, i: number) => (
                      <p key={i} className="text-xs flex items-center gap-1 text-destructive">
                        <XCircle className="h-3 w-3 shrink-0" /> {r}
                      </p>
                    ))}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>

      {/* Section 3: Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Radar Chart */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Composição do Score</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <RadarChart data={radarData}>
                <PolarGrid stroke="hsl(var(--border))" />
                <PolarAngleAxis dataKey="subject" tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} />
                <PolarRadiusAxis angle={30} domain={[0, 100]} tick={{ fontSize: 10 }} />
                <Radar name="Score" dataKey="score" stroke="hsl(var(--primary))" fill="hsl(var(--primary))" fillOpacity={0.3} />
              </RadarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Financial Indicators */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Indicadores Financeiros (%)</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={finBarData}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="name" tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Bar dataKey="value" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Collateral Pie Chart */}
        {pieData.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Composição de Garantias</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <PieChart>
                  <Pie data={pieData} cx="50%" cy="50%" outerRadius={100} dataKey="value" label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}>
                    {pieData.map((_, idx) => (
                      <Cell key={idx} fill={PIE_COLORS[idx % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Legend />
                  <Tooltip formatter={(val: number) => formatBRL(val)} />
                </PieChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        )}

        {/* Recommendations */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <FileText className="h-4 w-4 text-primary" /> Recomendações
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {result.recommendations.map((rec, i) => (
                <div key={i} className="flex items-start gap-3 p-3 rounded-lg bg-muted/50">
                  <ChevronRight className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                  <p className="text-sm">{rec}</p>
                </div>
              ))}
              {result.recommendations.length === 0 && (
                <p className="text-sm text-muted-foreground">Empresa com perfil excelente, sem recomendações adicionais.</p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
