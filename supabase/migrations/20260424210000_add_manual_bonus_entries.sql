CREATE TABLE IF NOT EXISTS public.manual_bonus_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bonus_date DATE NOT NULL,
  amount_usd NUMERIC(14, 4) NOT NULL CHECK (amount_usd >= 0),
  amount_brl NUMERIC(14, 2),
  distribution_mode TEXT NOT NULL DEFAULT 'hybrid'
    CHECK (distribution_mode IN ('views', 'revenue', 'hybrid')),
  note TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_manual_bonus_entries_date
  ON public.manual_bonus_entries (bonus_date DESC);

CREATE INDEX IF NOT EXISTS idx_manual_bonus_entries_active
  ON public.manual_bonus_entries (active, bonus_date DESC);

DROP TRIGGER IF EXISTS trg_manual_bonus_entries_updated ON public.manual_bonus_entries;
CREATE TRIGGER trg_manual_bonus_entries_updated
BEFORE UPDATE ON public.manual_bonus_entries
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.manual_bonus_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "manual_bonus_select_admin" ON public.manual_bonus_entries;
CREATE POLICY "manual_bonus_select_admin" ON public.manual_bonus_entries
  FOR SELECT TO authenticated
  USING (public.is_admin(auth.uid()));

DROP POLICY IF EXISTS "manual_bonus_admin_all" ON public.manual_bonus_entries;
CREATE POLICY "manual_bonus_admin_all" ON public.manual_bonus_entries
  FOR ALL TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));
