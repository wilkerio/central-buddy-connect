
-- Table to cache searched companies
CREATE TABLE public.empresas_cache (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  cnpj TEXT NOT NULL UNIQUE,
  data JSONB NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Public access (no auth needed for this use case)
ALTER TABLE public.empresas_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read empresas_cache"
  ON public.empresas_cache FOR SELECT
  USING (true);

CREATE POLICY "Anyone can insert empresas_cache"
  ON public.empresas_cache FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Anyone can update empresas_cache"
  ON public.empresas_cache FOR UPDATE
  USING (true);

-- Index for fast lookups
CREATE INDEX idx_empresas_cache_cnpj ON public.empresas_cache (cnpj);

-- Trigger for updated_at
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_empresas_cache_updated_at
  BEFORE UPDATE ON public.empresas_cache
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
