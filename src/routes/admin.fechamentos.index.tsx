import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useWriteGuard } from "@/hooks/use-write-guard";
import { Button } from "@/components/ui/button";
import { formatMonth } from "@/lib/format";
import { toast } from "sonner";
import { CalendarCheck, Plus, Loader2 } from "lucide-react";

export const Route = createFileRoute("/admin/fechamentos/")({
  head: () => ({ meta: [{ title: "Fechamentos — Splash Creators" }] }),
  component: Page,
});

interface PageRow { id: string; nome: string }
interface RawPostViews { id: string; views: number | null }
interface PostAuthor { post_id: string; collaborator_id: string }
interface SplitRule { collaborator_pct: number }
interface Collab { id: string; nome: string }

function calcPrevMonthRef(monthRef: string) {
  const [y, m] = monthRef.split("-").map(Number);
  const d = new Date(y, m - 2, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

async function fetchViewsPctByColabForMonth(monthRef: string): Promise<Record<string, number>> {
  const [y, m] = monthRef.split("-").map(Number);
  const lastDay = new Date(y, m, 0).getDate();
  const from = `${monthRef}-01`;
  const to = `${monthRef}-${String(lastDay).padStart(2, "0")}T23:59:59`;
  const { data: postsData } = await supabase.from("posts").select("id, views").gte("published_at", from).lte("published_at", to);
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
  const [pages, setPages] = useState<PageRow[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [generating, setGenerating] = useState(false);
  const thisMonth = new Date().toISOString().slice(0, 7);
  const [formMonth, setFormMonth] = useState(thisMonth);
  const [formPage, setFormPage] = useState("all");

  useEffect(() => {
    (async () => {
      // Fetch latest closing and redirect immediately
      const { data: latest } = await supabase
        .from("monthly_closings")
        .select("id")
        .order("month_ref", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (latest?.id) {
        navigate({ to: "/admin/fechamentos/$id", params: { id: latest.id }, replace: true });
        return;
      }

      // No closings yet — load pages to show generate form
      const { data: p } = await supabase.from("pages").select("id, nome").eq("ativo", true).order("nome");
      setPages((p as PageRow[]) ?? []);
      setLoading(false);
    })();
  }, []);

  const generate = async (e: FormEvent) => {
    e.preventDefault();
    setGenerating(true);
    try {
      const pageIds = formPage === "all" ? pages.map((p) => p.id) : [formPage];
      let createdId: string | null = null;

      for (const pageId of pageIds) {
        const pageName = pages.find((p) => p.id === pageId)?.nome ?? pageId;
        const { data: existing } = await supabase.from("monthly_closings").select("id").eq("month_ref", formMonth).eq("page_id", pageId).maybeSingle();
        if (existing) { toast.warning(`Já existe fechamento para ${pageName} em ${formatMonth(formMonth)}`); continue; }

        const [y, m] = formMonth.split("-").map(Number);
        const lastDay = new Date(y, m, 0).getDate();
        const dateFrom = `${formMonth}-01`;
        const dateTo = `${formMonth}-${String(lastDay).padStart(2, "0")}T23:59:59`;

        const { data: postsData } = await supabase.from("posts").select("id, monetization_approx").eq("page_id", pageId).gte("published_at", dateFrom).lte("published_at", dateTo);
        const posts = (postsData ?? []) as { id: string; monetization_approx: number | null }[];
        if (posts.length === 0) { toast.info(`Sem posts em ${pageName} para ${formatMonth(formMonth)}`); continue; }

        const { data: paData } = await supabase.from("post_authors").select("post_id, collaborator_id").in("post_id", posts.map((p) => p.id));
        const postAuthors = (paData ?? []) as PostAuthor[];
        const colabIds = [...new Set(postAuthors.map((pa) => pa.collaborator_id))];
        if (colabIds.length === 0) { toast.info(`Nenhum colaborador vinculado em ${pageName}`); continue; }

        const { data: colabData } = await supabase.from("collaborators").select("id, nome").in("id", colabIds);
        const collabs = (colabData ?? []) as Collab[];

        const { data: rulesData } = await supabase.from("split_rules").select("collaborator_pct").eq("page_id", pageId).eq("active", true).lte("effective_from", `${formMonth}-${String(lastDay).padStart(2, "0")}`).order("effective_from", { ascending: false }).limit(1);
        const collaboratorPct = ((rulesData as SplitRule[]) ?? [])[0]?.collaborator_pct ?? 0;

        const postColabMap: Record<string, string[]> = {};
        for (const pa of postAuthors) { if (!postColabMap[pa.post_id]) postColabMap[pa.post_id] = []; postColabMap[pa.post_id].push(pa.collaborator_id); }

        const grossByColab: Record<string, number> = {};
        for (const post of posts) {
          const colabers = postColabMap[post.id] ?? [];
          if (!colabers.length) continue;
          const val = Number(post.monetization_approx ?? 0);
          for (const cid of colabers) grossByColab[cid] = (grossByColab[cid] ?? 0) + val / colabers.length;
        }
        const totalGross = Object.values(grossByColab).reduce((a, b) => a + b, 0);

        const { data: dailyEntries } = await supabase.from("daily_revenue_entries").select("actual_revenue_usd").gte("entry_date", dateFrom.slice(0, 10)).lte("entry_date", `${formMonth}-${String(lastDay).padStart(2, "0")}`);
        const totalActual = (dailyEntries ?? []).reduce((s: number, e: any) => s + Number(e.actual_revenue_usd ?? 0), 0);
        const totalBonus = totalActual - totalGross;
        const viewsPct = totalBonus !== 0 ? await fetchViewsPctByColabForMonth(calcPrevMonthRef(formMonth)) : {};

        const { data: closing, error: cErr } = await supabase.from("monthly_closings").insert({ month_ref: formMonth, page_id: pageId, status: "aberto", total_gross: parseFloat(totalGross.toFixed(4)), created_by: profile?.id }).select("id").single();
        if (cErr) throw cErr;
        createdId = closing.id;

        const allColabIds = [...new Set([...collabs.map((c) => c.id), ...Object.keys(viewsPct)])];
        const { data: allColabData } = await supabase.from("collaborators").select("id, nome").in("id", allColabIds);
        const allCollabs = (allColabData ?? []) as Collab[];

        const items = allCollabs.map((c) => {
          const gross = parseFloat((grossByColab[c.id] ?? 0).toFixed(4));
          const amountDue = parseFloat((gross * collaboratorPct / 100).toFixed(4));
          const bonusShare = parseFloat(((viewsPct[c.id] ?? 0) * totalBonus).toFixed(4));
          const finalAmount = parseFloat((amountDue + bonusShare).toFixed(4));
          if (gross === 0 && bonusShare === 0) return null;
          return { closing_id: closing.id, collaborator_id: c.id, gross_revenue: gross, collaborator_pct: collaboratorPct, amount_due: amountDue, adjustments: bonusShare, final_amount: finalAmount, payment_status: "a_pagar" };
        }).filter((x): x is NonNullable<typeof x> => x !== null);

        if (items.length > 0) { const { error: iErr } = await supabase.from("monthly_closing_items").insert(items); if (iErr) throw iErr; }
        toast.success(`Fechamento gerado — ${pageName} (${items.length} colabs)`);
      }

      if (createdId) navigate({ to: "/admin/fechamentos/$id", params: { id: createdId } });
    } catch (err: any) {
      toast.error("Erro ao gerar fechamento", { description: err.message });
    } finally {
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

  // No closings exist — show generate form
  return (
    <div className="space-y-6">
      <WriteGuardDialog />
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Fechamentos</h1>
          <p className="text-sm text-muted-foreground mt-1">Nenhum fechamento gerado ainda.</p>
        </div>
        <Button onClick={guard(() => setShowForm(true))} className="gap-2">
          <Plus className="h-4 w-4" />
          Gerar fechamento
        </Button>
      </div>

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

      {!showForm && (
        <div className="rounded-xl border border-border bg-card p-12 flex flex-col items-center gap-3 text-center">
          <div className="h-12 w-12 rounded-full bg-orange-500/10 flex items-center justify-center">
            <CalendarCheck className="h-6 w-6 text-orange-500" />
          </div>
          <p className="font-semibold">Nenhum fechamento ainda</p>
          <p className="text-sm text-muted-foreground max-w-xs">
            Gere o primeiro fechamento para calcular os pagamentos do mês automaticamente.
          </p>
        </div>
      )}
    </div>
  );
}
