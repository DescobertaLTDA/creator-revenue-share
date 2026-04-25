-- ============================================================
-- Leitor (colaborador role) can read all data
-- Previously restricted to own records only via profile_id link
-- ============================================================

-- Helper: any authenticated user with colaborador role
CREATE OR REPLACE FUNCTION public.is_leitor(_user_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles WHERE id = _user_id AND role = 'colaborador'
  );
$$;

-- PAGES: leitor sees all pages
DROP POLICY IF EXISTS "pages_select_linked" ON public.pages;
CREATE POLICY "pages_select_any_auth" ON public.pages
  FOR SELECT TO authenticated
  USING (public.is_admin(auth.uid()) OR public.is_leitor(auth.uid()));

-- COLLABORATORS: leitor sees all collaborators
DROP POLICY IF EXISTS "collaborators_select_self_or_admin" ON public.collaborators;
CREATE POLICY "collaborators_select_any_auth" ON public.collaborators
  FOR SELECT TO authenticated
  USING (public.is_admin(auth.uid()) OR public.is_leitor(auth.uid()));

-- COLLABORATOR_PAGES: leitor sees all
DROP POLICY IF EXISTS "colpages_select" ON public.collaborator_pages;
CREATE POLICY "colpages_select_any_auth" ON public.collaborator_pages
  FOR SELECT TO authenticated
  USING (public.is_admin(auth.uid()) OR public.is_leitor(auth.uid()));

-- CSV IMPORTS: leitor can read (not write)
DROP POLICY IF EXISTS "csv_imports_admin_all" ON public.csv_imports;
CREATE POLICY "csv_imports_select_auth" ON public.csv_imports
  FOR SELECT TO authenticated
  USING (public.is_admin(auth.uid()) OR public.is_leitor(auth.uid()));
CREATE POLICY "csv_imports_admin_write" ON public.csv_imports
  FOR ALL TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

DROP POLICY IF EXISTS "csv_import_errors_admin_all" ON public.csv_import_errors;
CREATE POLICY "csv_import_errors_select_auth" ON public.csv_import_errors
  FOR SELECT TO authenticated
  USING (public.is_admin(auth.uid()) OR public.is_leitor(auth.uid()));
CREATE POLICY "csv_import_errors_admin_write" ON public.csv_import_errors
  FOR ALL TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

-- POSTS: leitor sees all posts
DROP POLICY IF EXISTS "posts_select_author_or_admin" ON public.posts;
CREATE POLICY "posts_select_any_auth" ON public.posts
  FOR SELECT TO authenticated
  USING (public.is_admin(auth.uid()) OR public.is_leitor(auth.uid()));

-- POST_AUTHORS: leitor sees all
DROP POLICY IF EXISTS "post_authors_select" ON public.post_authors;
CREATE POLICY "post_authors_select_any_auth" ON public.post_authors
  FOR SELECT TO authenticated
  USING (public.is_admin(auth.uid()) OR public.is_leitor(auth.uid()));

-- SPLIT RULES: leitor sees all
DROP POLICY IF EXISTS "split_rules_select" ON public.split_rules;
CREATE POLICY "split_rules_select_any_auth" ON public.split_rules
  FOR SELECT TO authenticated
  USING (public.is_admin(auth.uid()) OR public.is_leitor(auth.uid()));

-- MONTHLY CLOSINGS: leitor sees all
DROP POLICY IF EXISTS "closings_select" ON public.monthly_closings;
CREATE POLICY "closings_select_any_auth" ON public.monthly_closings
  FOR SELECT TO authenticated
  USING (public.is_admin(auth.uid()) OR public.is_leitor(auth.uid()));

-- MONTHLY CLOSING ITEMS: leitor sees all
DROP POLICY IF EXISTS "closing_items_select" ON public.monthly_closing_items;
CREATE POLICY "closing_items_select_any_auth" ON public.monthly_closing_items
  FOR SELECT TO authenticated
  USING (public.is_admin(auth.uid()) OR public.is_leitor(auth.uid()));

-- PAYOUT RECEIPTS: leitor sees all
DROP POLICY IF EXISTS "receipts_select" ON public.payout_receipts;
CREATE POLICY "receipts_select_any_auth" ON public.payout_receipts
  FOR SELECT TO authenticated
  USING (public.is_admin(auth.uid()) OR public.is_leitor(auth.uid()));

-- PROFILES: leitor can read all profiles (needed for Cadastro page view)
DROP POLICY IF EXISTS "profiles_select_self" ON public.profiles;
CREATE POLICY "profiles_select_auth" ON public.profiles
  FOR SELECT TO authenticated
  USING (id = auth.uid() OR public.is_admin(auth.uid()) OR public.is_leitor(auth.uid()));
