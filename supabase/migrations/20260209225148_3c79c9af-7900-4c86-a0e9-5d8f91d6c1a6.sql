
-- Tabela principal de análises de internacionalização
CREATE TABLE public.internationalization_analyses (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  
  -- Dados da empresa
  cnpj TEXT NOT NULL,
  razao_social TEXT NOT NULL,
  company_data JSONB NOT NULL DEFAULT '{}',
  
  -- Dados financeiros (editáveis)
  financial_data JSONB NOT NULL DEFAULT '{}',
  
  -- Garantias
  collaterals JSONB NOT NULL DEFAULT '{}',
  
  -- Passivos
  liabilities JSONB NOT NULL DEFAULT '{}',
  
  -- Capacidade de internacionalização
  internationalization_capacity JSONB NOT NULL DEFAULT '{}',
  
  -- Resultados calculados
  overall_score DECIMAL(5,2) DEFAULT 0,
  risk_classification TEXT DEFAULT 'N/A',
  eligible_modalities JSONB DEFAULT '[]',
  estimated_credit_amount_usd DECIMAL(15,2) DEFAULT 0,
  
  -- Resultados por modalidade
  modality_results JSONB DEFAULT '{}',
  
  -- Status
  status TEXT NOT NULL DEFAULT 'draft',
  analyst_notes TEXT
);

-- Enable RLS
ALTER TABLE public.internationalization_analyses ENABLE ROW LEVEL SECURITY;

-- Políticas abertas (sem auth por enquanto)
CREATE POLICY "Anyone can read analyses"
  ON public.internationalization_analyses FOR SELECT USING (true);

CREATE POLICY "Anyone can insert analyses"
  ON public.internationalization_analyses FOR INSERT WITH CHECK (true);

CREATE POLICY "Anyone can update analyses"
  ON public.internationalization_analyses FOR UPDATE USING (true);

CREATE POLICY "Anyone can delete analyses"
  ON public.internationalization_analyses FOR DELETE USING (true);

-- Trigger para updated_at
CREATE TRIGGER update_internationalization_analyses_updated_at
  BEFORE UPDATE ON public.internationalization_analyses
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Índices
CREATE INDEX idx_intl_analyses_cnpj ON public.internationalization_analyses(cnpj);
CREATE INDEX idx_intl_analyses_score ON public.internationalization_analyses(overall_score DESC);
CREATE INDEX idx_intl_analyses_status ON public.internationalization_analyses(status);
