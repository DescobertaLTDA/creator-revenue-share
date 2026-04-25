-- Schema essencial do Rateio Creator
-- Projeto alvo validado: fttwgqxoymsuqagwqegt
-- Execute este arquivo inteiro no Supabase SQL Editor.

create extension if not exists pgcrypto;

-- ============================================================
-- ENUMS
-- ============================================================
CREATE TYPE public.app_role AS ENUM ('admin', 'colaborador');
CREATE TYPE public.csv_import_status AS ENUM ('processando', 'concluido', 'falha', 'parcial');
CREATE TYPE public.post_author_source AS ENUM ('manual', 'hashtag');
CREATE TYPE public.closing_status AS ENUM ('aberto', 'fechado');
CREATE TYPE public.payment_status AS ENUM ('a_pagar', 'pago_fora', 'ajustado');

-- ============================================================
-- PROFILES
-- ============================================================
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  nome TEXT NOT NULL,
  email TEXT,
  role public.app_role NOT NULL DEFAULT 'colaborador',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- has_role (SECURITY DEFINER para evitar recursão em RLS)
-- ============================================================
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles WHERE id = _user_id AND role = _role
  );
$$;

CREATE OR REPLACE FUNCTION public.is_admin(_user_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles WHERE id = _user_id AND role = 'admin'
  );
$$;

-- Trigger de criação automática do profile no signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, nome, email, role)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'nome', split_part(NEW.email, '@', 1)),
    NEW.email,
    COALESCE((NEW.raw_user_meta_data->>'role')::public.app_role, 'colaborador')
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Trigger utilitário para updated_at
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_profiles_updated BEFORE UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================
-- PAGES
-- ============================================================
CREATE TABLE public.pages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  external_page_id TEXT UNIQUE NOT NULL,
  nome TEXT NOT NULL,
  ativo BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_pages_updated BEFORE UPDATE ON public.pages
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================
-- COLLABORATORS
-- ============================================================
CREATE TABLE public.collaborators (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  nome TEXT NOT NULL,
  email TEXT,
  ativo BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_collaborators_profile ON public.collaborators(profile_id);
CREATE TRIGGER trg_collaborators_updated BEFORE UPDATE ON public.collaborators
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================
-- COLLABORATOR_PAGES (N:N)
-- ============================================================
CREATE TABLE public.collaborator_pages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  collaborator_id UUID NOT NULL REFERENCES public.collaborators(id) ON DELETE CASCADE,
  page_id UUID NOT NULL REFERENCES public.pages(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (collaborator_id, page_id)
);
CREATE INDEX idx_colpages_col ON public.collaborator_pages(collaborator_id);
CREATE INDEX idx_colpages_page ON public.collaborator_pages(page_id);

-- ============================================================
-- CSV IMPORTS
-- ============================================================
CREATE TABLE public.csv_imports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  uploaded_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  file_name TEXT NOT NULL,
  file_path TEXT,
  file_hash TEXT,
  status public.csv_import_status NOT NULL DEFAULT 'processando',
  period_start DATE,
  period_end DATE,
  detected_pages_count INT NOT NULL DEFAULT 0,
  total_rows INT NOT NULL DEFAULT 0,
  valid_rows INT NOT NULL DEFAULT 0,
  invalid_rows INT NOT NULL DEFAULT 0,
  inserted_rows INT NOT NULL DEFAULT 0,
  updated_rows INT NOT NULL DEFAULT 0,
  duplicated_rows INT NOT NULL DEFAULT 0,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_csv_imports_created ON public.csv_imports(created_at DESC);

CREATE TABLE public.csv_import_errors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  import_id UUID NOT NULL REFERENCES public.csv_imports(id) ON DELETE CASCADE,
  row_number INT NOT NULL,
  field_name TEXT,
  error_message TEXT NOT NULL,
  raw_payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_csv_errors_import ON public.csv_import_errors(import_id);

-- ============================================================
-- POSTS
-- ============================================================
CREATE TABLE public.posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  page_id UUID NOT NULL REFERENCES public.pages(id) ON DELETE CASCADE,
  external_post_id TEXT NOT NULL,
  published_at TIMESTAMPTZ,
  title TEXT,
  description TEXT,
  permalink TEXT,
  post_type TEXT,
  language TEXT,
  views BIGINT DEFAULT 0,
  reach BIGINT DEFAULT 0,
  reactions BIGINT DEFAULT 0,
  comments BIGINT DEFAULT 0,
  shares BIGINT DEFAULT 0,
  clicks_total BIGINT DEFAULT 0,
  clicks_other BIGINT DEFAULT 0,
  link_clicks BIGINT DEFAULT 0,
  monetization_approx NUMERIC(14,4) DEFAULT 0,
  estimated_usd NUMERIC(14,4) DEFAULT 0,
  source_import_id UUID REFERENCES public.csv_imports(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (page_id, external_post_id)
);
CREATE INDEX idx_posts_page ON public.posts(page_id);
CREATE INDEX idx_posts_published ON public.posts(published_at DESC);
CREATE TRIGGER trg_posts_updated BEFORE UPDATE ON public.posts
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.post_authors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id UUID NOT NULL REFERENCES public.posts(id) ON DELETE CASCADE,
  collaborator_id UUID NOT NULL REFERENCES public.collaborators(id) ON DELETE CASCADE,
  source public.post_author_source NOT NULL DEFAULT 'manual',
  confidence NUMERIC(5,4) DEFAULT 1.0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (post_id, collaborator_id)
);
CREATE INDEX idx_post_authors_post ON public.post_authors(post_id);
CREATE INDEX idx_post_authors_col ON public.post_authors(collaborator_id);

-- ============================================================
-- SPLIT RULES
-- ============================================================
CREATE TABLE public.split_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  page_id UUID NOT NULL REFERENCES public.pages(id) ON DELETE CASCADE,
  effective_from DATE NOT NULL DEFAULT CURRENT_DATE,
  collaborator_pct NUMERIC(5,2) NOT NULL,
  page_pct NUMERIC(5,2) NOT NULL,
  team_pct NUMERIC(5,2) NOT NULL,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT split_rules_sum_100 CHECK (collaborator_pct + page_pct + team_pct = 100)
);
CREATE INDEX idx_split_rules_page ON public.split_rules(page_id, effective_from DESC);

-- ============================================================
-- MONTHLY CLOSINGS
-- ============================================================
CREATE TABLE public.monthly_closings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  month_ref TEXT NOT NULL, -- 'YYYY-MM'
  page_id UUID NOT NULL REFERENCES public.pages(id) ON DELETE CASCADE,
  status public.closing_status NOT NULL DEFAULT 'aberto',
  total_gross NUMERIC(14,2) DEFAULT 0,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  closed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (month_ref, page_id)
);
CREATE INDEX idx_closings_month ON public.monthly_closings(month_ref);

CREATE TABLE public.monthly_closing_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  closing_id UUID NOT NULL REFERENCES public.monthly_closings(id) ON DELETE CASCADE,
  collaborator_id UUID NOT NULL REFERENCES public.collaborators(id) ON DELETE CASCADE,
  gross_revenue NUMERIC(14,2) NOT NULL DEFAULT 0,
  collaborator_pct NUMERIC(5,2) NOT NULL DEFAULT 0,
  amount_due NUMERIC(14,2) NOT NULL DEFAULT 0,
  adjustments NUMERIC(14,2) NOT NULL DEFAULT 0,
  final_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  payment_status public.payment_status NOT NULL DEFAULT 'a_pagar',
  paid_at TIMESTAMPTZ,
  payment_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (closing_id, collaborator_id)
);
CREATE INDEX idx_closing_items_closing ON public.monthly_closing_items(closing_id);
CREATE INDEX idx_closing_items_col ON public.monthly_closing_items(collaborator_id);
CREATE TRIGGER trg_closing_items_updated BEFORE UPDATE ON public.monthly_closing_items
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================
-- PAYOUT RECEIPTS
-- ============================================================
CREATE TABLE public.payout_receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  closing_item_id UUID NOT NULL REFERENCES public.monthly_closing_items(id) ON DELETE CASCADE,
  file_path TEXT,
  generated_pdf_path TEXT,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_receipts_item ON public.payout_receipts(closing_item_id);

-- ============================================================
-- AUDIT LOGS
-- ============================================================
CREATE TABLE public.audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_profile_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id TEXT,
  before_json JSONB,
  after_json JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_entity ON public.audit_logs(entity, entity_id);
CREATE INDEX idx_audit_created ON public.audit_logs(created_at DESC);

-- ============================================================
-- ENABLE RLS
-- ============================================================
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.collaborators ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.collaborator_pages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.csv_imports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.csv_import_errors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.post_authors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.split_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.monthly_closings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.monthly_closing_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payout_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- RLS POLICIES
-- ============================================================

-- PROFILES
CREATE POLICY "profiles_select_self" ON public.profiles
  FOR SELECT TO authenticated USING (id = auth.uid() OR public.is_admin(auth.uid()));
CREATE POLICY "profiles_update_self" ON public.profiles
  FOR UPDATE TO authenticated USING (id = auth.uid() OR public.is_admin(auth.uid()));
CREATE POLICY "profiles_admin_all" ON public.profiles
  FOR ALL TO authenticated USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));

-- PAGES (admin full; colaborador leitura das páginas vinculadas)
CREATE POLICY "pages_select_linked" ON public.pages
  FOR SELECT TO authenticated USING (
    public.is_admin(auth.uid()) OR EXISTS (
      SELECT 1 FROM public.collaborator_pages cp
      JOIN public.collaborators c ON c.id = cp.collaborator_id
      WHERE cp.page_id = pages.id AND c.profile_id = auth.uid()
    )
  );
CREATE POLICY "pages_admin_all" ON public.pages
  FOR ALL TO authenticated USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));

-- COLLABORATORS
CREATE POLICY "collaborators_select_self_or_admin" ON public.collaborators
  FOR SELECT TO authenticated USING (public.is_admin(auth.uid()) OR profile_id = auth.uid());
CREATE POLICY "collaborators_admin_all" ON public.collaborators
  FOR ALL TO authenticated USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));

-- COLLABORATOR_PAGES
CREATE POLICY "colpages_select" ON public.collaborator_pages
  FOR SELECT TO authenticated USING (
    public.is_admin(auth.uid()) OR EXISTS (
      SELECT 1 FROM public.collaborators c WHERE c.id = collaborator_pages.collaborator_id AND c.profile_id = auth.uid()
    )
  );
CREATE POLICY "colpages_admin_all" ON public.collaborator_pages
  FOR ALL TO authenticated USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));

-- CSV IMPORTS (admin-only)
CREATE POLICY "csv_imports_admin_all" ON public.csv_imports
  FOR ALL TO authenticated USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));
CREATE POLICY "csv_import_errors_admin_all" ON public.csv_import_errors
  FOR ALL TO authenticated USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));

-- POSTS (admin full; colaborador só posts onde é autor)
CREATE POLICY "posts_select_author_or_admin" ON public.posts
  FOR SELECT TO authenticated USING (
    public.is_admin(auth.uid()) OR EXISTS (
      SELECT 1 FROM public.post_authors pa
      JOIN public.collaborators c ON c.id = pa.collaborator_id
      WHERE pa.post_id = posts.id AND c.profile_id = auth.uid()
    )
  );
CREATE POLICY "posts_admin_all" ON public.posts
  FOR ALL TO authenticated USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));

CREATE POLICY "post_authors_select" ON public.post_authors
  FOR SELECT TO authenticated USING (
    public.is_admin(auth.uid()) OR EXISTS (
      SELECT 1 FROM public.collaborators c WHERE c.id = post_authors.collaborator_id AND c.profile_id = auth.uid()
    )
  );
CREATE POLICY "post_authors_admin_all" ON public.post_authors
  FOR ALL TO authenticated USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));

-- SPLIT RULES
CREATE POLICY "split_rules_select" ON public.split_rules
  FOR SELECT TO authenticated USING (
    public.is_admin(auth.uid()) OR EXISTS (
      SELECT 1 FROM public.collaborator_pages cp
      JOIN public.collaborators c ON c.id = cp.collaborator_id
      WHERE cp.page_id = split_rules.page_id AND c.profile_id = auth.uid()
    )
  );
CREATE POLICY "split_rules_admin_all" ON public.split_rules
  FOR ALL TO authenticated USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));

-- MONTHLY CLOSINGS
CREATE POLICY "closings_select" ON public.monthly_closings
  FOR SELECT TO authenticated USING (
    public.is_admin(auth.uid()) OR EXISTS (
      SELECT 1 FROM public.monthly_closing_items mci
      JOIN public.collaborators c ON c.id = mci.collaborator_id
      WHERE mci.closing_id = monthly_closings.id AND c.profile_id = auth.uid()
    )
  );
CREATE POLICY "closings_admin_all" ON public.monthly_closings
  FOR ALL TO authenticated USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));

CREATE POLICY "closing_items_select" ON public.monthly_closing_items
  FOR SELECT TO authenticated USING (
    public.is_admin(auth.uid()) OR EXISTS (
      SELECT 1 FROM public.collaborators c WHERE c.id = monthly_closing_items.collaborator_id AND c.profile_id = auth.uid()
    )
  );
CREATE POLICY "closing_items_admin_all" ON public.monthly_closing_items
  FOR ALL TO authenticated USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));

-- RECEIPTS
CREATE POLICY "receipts_select" ON public.payout_receipts
  FOR SELECT TO authenticated USING (
    public.is_admin(auth.uid()) OR EXISTS (
      SELECT 1 FROM public.monthly_closing_items mci
      JOIN public.collaborators c ON c.id = mci.collaborator_id
      WHERE mci.id = payout_receipts.closing_item_id AND c.profile_id = auth.uid()
    )
  );
CREATE POLICY "receipts_admin_all" ON public.payout_receipts
  FOR ALL TO authenticated USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));

-- AUDIT LOGS (admin-only read; writes via server)
CREATE POLICY "audit_admin_read" ON public.audit_logs
  FOR SELECT TO authenticated USING (public.is_admin(auth.uid()));
CREATE POLICY "audit_insert_any" ON public.audit_logs
  FOR INSERT TO authenticated WITH CHECK (actor_profile_id = auth.uid() OR public.is_admin(auth.uid()));

-- ============================================================
-- STORAGE BUCKETS
-- ============================================================
INSERT INTO storage.buckets (id, name, public) VALUES ('csv-uploads', 'csv-uploads', false)
ON CONFLICT (id) DO NOTHING;
INSERT INTO storage.buckets (id, name, public) VALUES ('receipts', 'receipts', false)
ON CONFLICT (id) DO NOTHING;

-- Policies: admin full on both buckets; colaborador reads own receipts
CREATE POLICY "csv_admin_all" ON storage.objects
  FOR ALL TO authenticated
  USING (bucket_id = 'csv-uploads' AND public.is_admin(auth.uid()))
  WITH CHECK (bucket_id = 'csv-uploads' AND public.is_admin(auth.uid()));

CREATE POLICY "receipts_admin_all_storage" ON storage.objects
  FOR ALL TO authenticated
  USING (bucket_id = 'receipts' AND public.is_admin(auth.uid()))
  WITH CHECK (bucket_id = 'receipts' AND public.is_admin(auth.uid()));

CREATE POLICY "receipts_user_read" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'receipts' AND EXISTS (
      SELECT 1 FROM public.payout_receipts pr
      JOIN public.monthly_closing_items mci ON mci.id = pr.closing_item_id
      JOIN public.collaborators c ON c.id = mci.collaborator_id
      WHERE c.profile_id = auth.uid()
        AND (pr.file_path = storage.objects.name OR pr.generated_pdf_path = storage.objects.name)
    )
  );

-- Ajuste final do trigger helper (mantido do segundo migration)
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;
