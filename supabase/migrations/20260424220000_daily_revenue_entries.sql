-- Tabela de conciliação diária de receita
-- posts_revenue é calculado dos posts importados (não armazenado aqui)
-- actual_revenue é o valor real que o Facebook pagou naquele dia
-- A diferença (actual - posts) é o bônus/ajuste a ser distribuído

CREATE TABLE IF NOT EXISTS public.daily_revenue_entries (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_date      DATE    NOT NULL UNIQUE,
  actual_revenue_usd NUMERIC(14,4),        -- valor real recebido no dia (entrada manual)
  distribution_mode TEXT NOT NULL DEFAULT 'hybrid'
    CHECK (distribution_mode IN ('views', 'revenue', 'hybrid')),
  note            TEXT,
  created_by      UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_daily_revenue_entries_date
  ON public.daily_revenue_entries (entry_date DESC);

ALTER TABLE public.daily_revenue_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin_manage_daily_revenue"
  ON public.daily_revenue_entries
  FOR ALL
  TO authenticated
  USING (
    (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin'
  )
  WITH CHECK (
    (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin'
  );
