import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useWriteGuard } from "@/hooks/use-write-guard";
import { Button } from "@/components/ui/button";
import { formatMonth } from "@/lib/format";
import { toast } from "sonner";
import { CalendarCheck, Plus, Loader2, Lock, Clock, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/admin/fechamentos/")({
  head: () => ({ meta: [{ title: "Fechamentos — Splash Creators" }] }),
  component: Page,
});

interface PageRow { id: string; nome: string }
interface RawPostViews { id: string; views: number | null }
interface PostAuthor { post_id: string; collaborator_id: string }
interface Collab { id: string; nome: string }
interface ClosingRow {
  id: string;
  month_ref: string;
  status: string;
  total_gross: number;
  pages: { nome: string } | null;
}

async function fetchViewsPctByColabForMonth(monthRef: string, pageId?: string): Promise<Record<string, number>> {
  const [y, m] = monthRef.split("-").map(Number);
  const lastDay = new Date(y, m, 0).getDate();
  const from = `${monthRef}-01`;
  const to = `${monthRef}-${String(lastDay).padStart(2, "0")}T23:59:59`;
  let query = supabase.from("posts").select("id, views").gte("published_at", from).lte("published_at", to);
  if (pageId) query = (query as any).eq("page_id", pageId);
  const { data: postsData } = await query;
  if (!postsData || postsData.length === 0) return {};
  const viewsByPost: Record<string, number> = {};
  for (const p of postsData as RawPostViews[]) viewsByPost[p.id] = Number(p.views ?? 0);
  const { data: paData } = await supabase.from("post_authors").select("post_id, collaborator_id").in("post_id", postsData.map((p: any) => p.id));
  const viewsByColab: Record<string, number> = {};
  for (const pa of (paData ?? []) as PostAuthor[]) {
    viewsByColab[pa.collaborator_id] = (viewsByColab[pa.collaborator_id] ?? 0) + (viewsByPost[pa.post_id] ?? 0);
  }
  const totalViews = Object.values(viewsByColab).reduce((a, b) => a + b, 0);
  if (totalViews === 0) return {};
  const pct: Record<string, number> = {};
  for (const [cid, v] of Object.entries(viewsByColab)) pct[cid] = v / totalViews;
  return pct;
}

function Page() {
  const { profile } = useAuth();
  const { guardSubmit, guard, WriteGuardDialog } = useWriteGuard();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [closings, setClosings] = useState<ClosingRow[]>([]);
  const [pages, setPages] = useState<PageRow[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [generating, setGenerating] = useState(false);
  const thisMonth = new Date().toISOString().slice(0, 7);
  const [formMonth, setFormMonth] = useState(thisMonth);
  const [formPage, setFormPage] = useState("all");

  const loadAll = async () => {
    const [{ data: cls }, { data: p }] = await Promise.all([
      supabase.from("monthly_closings").select("id, month_ref, status, total_gross, pages(nome)").order("month_ref", { ascending: false }),
      supabase.from("pages").select("id, nome").eq("ativo", true).order("nome"),
    ]);
    setClosings((cls as unknown as ClosingRow[]) ?? []);
    setPages((p as PageRow[]) ?? []);
    setLoading(false);
  };

  useEffect(() => { loadAll(); }, []);

  // Group closings by month
  const grouped = closings.reduce<Record<string, ClosingRow[]>>((acc, c) => {
    (acc[c.month_ref] = acc[c.month_ref] ?? []).push(c);
    return acc;
  }, {});
  const months = Object.keys(grouped).sort((a, b) => b.localeCompare(a));

  const generate = async (e: FormEvent) => {
    e.preventDefault();
    setGenerating(true);
    const timeout = setTimeout(() => {
      setGenerating(false);
      toast.error("Tempo esgotado", { description: "A operação demorou demais. Verifique sua conexão e tente novamente." });
    }, 30_000);
    try {
      const pageIds = formPage === "all" ? pages.map((p) => p.id) : [formPage];
      let createdId: string | null = null;

      for (const pageId of pageIds) {
        const pageName = pages.find((p) => p.id === pageId)?.nome ?? pageId;

        const { data: existing, error: exErr } = await supabase.from("monthly_closings").select("id").eq("month_ref", formMonth).eq("page_id", pageId).maybeSingle();
        if (exErr) throw exErr;
        if (existing) { toast.warning(`Já existe fechamento para ${pageName} em ${formatMonth(formMonth)}`); continue; }

        const [y, m] = formMonth.split("-").map(Number);
        const lastDay = new Date(y, m, 0).getDate();
        const dateFrom = `${formMonth}-01`;
        const dateTo = `${formMonth}-${String(lastDay).padStart(2, "0")}`;

        const { data: dailyEntries, error: deErr } = await supabase.from("daily_revenue_entries").select("actual_revenue_usd").eq("page_id", pageId).gte("entry_date", dateFrom).lte("entry_date", dateTo);
        if (deErr) throw deErr;
        const totalManual = (dailyEntries ?? []).reduce((s: number, e: any) => s + Number(e.actual_revenue_usd ?? 0), 0);

        let totalActual = totalManual;
        if (totalActual === 0) {
          // Fallback: sem lançamento manual, usa monetization_approx dos posts (CSV)
          const { data: postRev, error: prErr } = await supabase.from("posts").select("monetization_approx").eq("page_id", pageId).gte("published_at", dateFrom).lte("published_at", `${dateTo}T23:59:59`);
          if (prErr) throw prErr;
          totalActual = (postRev ?? []).reduce((s: number, p: any) => s + Number(p.monetization_approx ?? 0), 0);
        }

        const viewsPct = await fetchViewsPctByColabForMonth(formMonth, pageId);
        if (Object.keys(viewsPct).length === 0) { toast.info(`Sem posts/views em ${pageName} para ${formatMonth(formMonth)}`); continue; }

        const colabIds = Object.keys(viewsPct);
        const { data: colabData, error: coErr } = await supabase.from("collaborators").select("id, nome").in("id", colabIds);
        if (coErr) throw coErr;
        const collabs = (colabData ?? []) as Collab[];

        const { data: closing, error: cErr } = await supabase.from("monthly_closings").insert({ month_ref: formMonth, page_id: pageId, status: "aberto", total_gross: parseFloat(totalActual.toFixed(4)), created_by: profile?.id }).select("id").single();
        if (cErr) throw cErr;
        createdId = closing.id;

        const items = collabs.map((c) => {
          const viewShare = viewsPct[c.id] ?? 0;
          const gross = parseFloat((viewShare * totalActual).toFixed(4));
          if (gross === 0) return null;
          return { closing_id: closing.id, collaborator_id: c.id, gross_revenue: gross, collaborator_pct: 100, amount_due: gross, adjustments: 0, final_amount: gross, payment_status: "a_pagar" };
        }).filter((x): x is NonNullable<typeof x> => x !== null);

        if (items.length > 0) { const { error: iErr } = await supabase.from("monthly_closing_items").insert(items); if (iErr) throw iErr; }
        toast.success(`Fechamento gerado — ${pageName} (${items.length} colabs)`);
      }

      await loadAll();
      setShowForm(false);
      if (createdId) navigate({ to: "/admin/fechamentos/$id", params: { id: createdId } });
    } catch (err: any) {
      toast.error("Erro ao gerar fechamento", { description: err.message });
    } finally {
      clearTimeout(timeout);
      setGenerating(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-32">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <WriteGuardDialog />

      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Fechamentos</h1>
          <p className="text-sm text-muted-foreground mt-1">Selecione um fechamento para visualizar ou registrar pagamentos.</p>
        </div>
        <Button onClick={guard(() => setShowForm((v) => !v))} className="gap-2">
          <Plus className="h-4 w-4" />
          Gerar fechamento
        </Button>
      </div>

      {/* Generate form */}
      {showForm && (
        <form onSubmit={guardSubmit(generate)} className="rounded-xl border border-border bg-card p-5 space-y-4 max-w-lg">
          <h3 className="font-semibold text-sm">Novo fechamento</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Mês de referência</label>
              <input type="month" value={formMonth} onChange={(e) => setFormMonth(e.target.value)} className="h-9 rounded-lg border border-input bg-background px-3 text-sm" required />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Página</label>
              <select value={formPage} onChange={(e) => setFormPage(e.target.value)} className="h-9 rounded-lg border border-input bg-background px-3 text-sm">
                <option value="all">Todas as páginas</option>
                {pages.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
              </select>
            </div>
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={() => setShowForm(false)} className="flex-1 h-10">Cancelar</Button>
            <Button type="submit" disabled={generating} className="flex-1 h-10">
              {generating && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              {generating ? "Calculando…" : "Gerar"}
            </Button>
          </div>
        </form>
      )}

      {/* List */}
      {months.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-12 flex flex-col items-center gap-3 text-center">
          <div className="h-12 w-12 rounded-full bg-orange-500/10 flex items-center justify-center">
            <CalendarCheck className="h-6 w-6 text-orange-500" />
          </div>
          <p className="font-semibold">Nenhum fechamento ainda</p>
          <p className="text-sm text-muted-foreground max-w-xs">
            Gere o primeiro fechamento para calcular os pagamentos do mês automaticamente.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {months.map((month) => (
            <div key={month} className="rounded-xl border border-border bg-card overflow-hidden">
              <div className="px-5 py-3 border-b border-border bg-muted/30">
                <p className="text-sm font-semibold">{formatMonth(month)}</p>
              </div>
              <div className="divide-y divide-border">
                {grouped[month].map((c) => (
                  <Link
                    key={c.id}
                    to="/admin/fechamentos/$id"
                    params={{ id: c.id }}
                    className="flex items-center justify-between gap-4 px-5 py-3.5 hover:bg-muted/30 transition-colors group"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <span className={cn(
                        "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold border shrink-0",
                        c.status === "fechado"
                          ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/20"
                          : "bg-amber-500/10 text-amber-600 border-amber-400/20"
                      )}>
                        {c.status === "fechado" ? <Lock className="h-2.5 w-2.5" /> : <Clock className="h-2.5 w-2.5" />}
                        {c.status === "fechado" ? "Finalizado" : "Aberto"}
                      </span>
                      <span className="text-sm font-medium truncate">{c.pages?.nome ?? "—"}</span>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <span className="text-sm font-semibold tabular-nums">${Number(c.total_gross).toFixed(2)}</span>
                      <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-foreground transition-colors" />
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
