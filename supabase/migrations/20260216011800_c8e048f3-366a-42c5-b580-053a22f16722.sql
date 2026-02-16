
-- Tabela de lotes de upload (categorias)
CREATE TABLE public.upload_batches (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  nome TEXT NOT NULL,
  arquivo_original TEXT,
  total_empresas INTEGER DEFAULT 0,
  total_processadas INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.upload_batches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read batches" ON public.upload_batches FOR SELECT USING (true);
CREATE POLICY "Anyone can insert batches" ON public.upload_batches FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can update batches" ON public.upload_batches FOR UPDATE USING (true);
CREATE POLICY "Anyone can delete batches" ON public.upload_batches FOR DELETE USING (true);

-- Tabela de contatos extraídos das planilhas, vinculados a empresa e batch
CREATE TABLE public.empresa_contacts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  cnpj TEXT NOT NULL,
  batch_id UUID REFERENCES public.upload_batches(id) ON DELETE CASCADE,
  nome_empresa TEXT,
  telefone TEXT,
  email TEXT,
  contato_nome TEXT,
  cargo TEXT,
  observacoes TEXT,
  score_potencial INTEGER DEFAULT 0,
  dados_extras JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.empresa_contacts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read contacts" ON public.empresa_contacts FOR SELECT USING (true);
CREATE POLICY "Anyone can insert contacts" ON public.empresa_contacts FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can update contacts" ON public.empresa_contacts FOR UPDATE USING (true);
CREATE POLICY "Anyone can delete contacts" ON public.empresa_contacts FOR DELETE USING (true);

-- Trigger para updated_at
CREATE TRIGGER update_empresa_contacts_updated_at
BEFORE UPDATE ON public.empresa_contacts
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();
