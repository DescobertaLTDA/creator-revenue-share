import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useWriteGuard } from "@/hooks/use-write-guard";
import { PageHeader } from "@/components/app/PageHeader";
import { EmptyState } from "@/components/app/EmptyState";
import { Button } from "@/components/ui/button";
import { formatMonth } from "@/lib/format";
import { toast } from "sonner";
import { CalendarCheck, Plus, Loader2, ChevronRight, Users } from "lucide-react";

export const Route = createFileRoute("/admin/fechamentos")({
  head: () => ({ meta: [{ title: "Fechamentos — Splash Creators" }] }),
  component: Page,
});

interface Closing {
  id: string;
  month_ref: string;
  status: string;
  total_gross: number | null;
  pages: { nome: string } | null;
  _itemCount?: number;
}
interface PageRow { id: string; nome: string }
interface RawPost { id: string; monetization_approx: number | null }
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

  const { data: postsData } = await supabase
    .from("posts")
    .select("id, views")
    .gte("published_at", from)
    .lte("published_at", to);
  if (!postsData || postsData.length === 0) return {};

  const viewsByPost: Record<string, number> = {};
  for (const p of postsData as RawPostViews[]) viewsByPost[p.id] = Number(p.views ?? 0);

  const { data: paData } = await supabase
    .from("post_authors")
    .select("post_id, collaborator_id")
    .in("post_id", postsData.map((p: any) => p.id));

  const viewsByColab: Record<string, number> = {};
  for (const pa of (paData ?? []) as PostAuthor[]) {
    const views = viewsByPost[pa.post_id] ?? 0;
    viewsByColab[pa.collaborator_id] = (viewsByColab[pa.collaborator_id] ?? 0) + views;
  }

  const totalViews = Object.values(viewsByColab).reduce((a, b) => a + b, 0);
  if (totalViews === 0) return {};

  const pct: Record<string, number> = {};
  for (const [cid, v] of Object.entries(viewsByColab)) pct[cid] = v / totalViews;
  return pct;
}

function Page() {
  const { profile } = useAuth();
  const { isAdmin, guardSubmit, guard, WriteGuardDialog } = useWriteGuard();
  const [closings, setClosings] = useState<Closing[]>([]);
  const [pages, setPages] = useState<PageRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [generating, setGenerating] = useState(false);

  const thisMonth = new Date().toISOString().slice(0, 7);
  const [formMonth, setFormMonth] = useState(thisMonth);
  const [formPage, setFormPage] = useState("all");

  const load = async () => {
    setLoading(true);
    const { data: cs } = await supabase
      .from("monthly_closings")
      .select("id, month_ref, status, total_gross, pages(nome)")
      .order("month_ref", { ascending: false });

    const list = (cs as unknown as Closing[]) ?? [];

    if (list.length > 0) {
      const { data: itemRows } = await supabase
        .from("monthly_closing_items")
        .select("closing_id")
        .in("closing_id", list.map((c) => c.id));
      const countMap: Record<string, number> = {};
      for (const r of itemRows ?? []) countMap[r.closing_id] = (countMap[r.closing_id] ?? 0) + 1;
      list.forEach((c) => { c._itemCount = countMap[c.id] ?? 0; });
    }

    setClosings(list);
    setLoading(false);
  };

  useEffect(() => {
    (async () => {
      const { data: p } = await supabase.from("pages").select("id, nome").eq("ativo", true).order("nome");
      setPages((p as PageRow[]) ?? []);
      await load();
    })();
  }, []);

  const generate = async (e: FormEvent) => {
    e.preventDefault();
    setGenerating(true);
    try {
      const pageIds = formPage === "all" ? pages.map((p) => p.id) : [formPage];
      let generated = 0;

      for (const pageId of pageIds) {
        const pageName = pages.find((p) => p.id === pageId)?.nome ?? pageId;

        const { data: existing } = await supabase
          .from("monthly_closings")
          .select("id")
          .eq("month_ref", formMonth)
          .eq("page_id", pageId)
          .maybeSingle();
        if (existing) {
          toast.warning(`Já existe fechamento para ${pageName} em ${formatMonth(formMonth)}`);
          continue;
        }

        const [y, m] = formMonth.split("-").map(Number);
        const lastDay = new Date(y, m, 0).getDate();
        const dateFrom = `${formMonth}-01`;
        const dateTo = `${formMonth}-${String(lastDay).padStart(2, "0")}T23:59:59`;

        const { data: postsData } = await supabase
          .from("posts")
          .select("id, monetization_approx")
          .eq("page_id", pageId)
          .gte("published_at", dateFrom)
          .lte("published_at", dateTo);
        const posts = (postsData as RawPost[]) ?? [];

        if (posts.length === 0) {
          toast.info(`Sem posts em ${pageName} para ${formatMonth(formMonth)}`);
          continue;
        }

        const postIds = posts.map((p) => p.id);
        const { data: paData } = await supabase
          .from("post_authors")
          .select("post_id, collaborator_id")
          .in("post_id", postIds);
        const postAuthors = (paData as PostAuthor[]) ?? [];

        const colabIds = [...new Set(postAuthors.map((pa) => pa.collaborator_id))];
        if (colabIds.length === 0) {
          toast.info(`Nenhum colaborador vinculado em ${pageName}`);
          continue;
        }

        const { data: colabData } = await supabase
          .from("collaborators")
          .select("id, nome")
          .in("id", colabIds);
        const collabs = (colabData as Collab[]) ?? [];

        const { data: rulesData } = await supabase
          .from("split_rules")
          .select("collaborator_pct")
          .eq("page_id", pageId)
          .eq("active", true)
          .lte("effective_from", `${formMonth}-${String(lastDay).padStart(2, "0")}`)
          .order("effective_from", { ascending: false })
          .limit(1);
        const collaboratorPct = ((rulesData as SplitRule[]) ?? [])[0]?.collaborator_pct ?? 0;

        // Build post → collaborators map
        const postColabMap: Record<string, string[]> = {};
        for (const pa of postAuthors) {
          if (!postColabMap[pa.post_id]) postColabMap[pa.post_id] = [];
          postColabMap[pa.post_id].push(pa.collaborator_id);
        }

        // Gross per collaborator (proportional share of each post)
        const grossByColab: Record<string, number> = {};
        for (const post of posts) {
          const colabers = postColabMap[post.id] ?? [];
          if (!colabers.length) continue;
          const val = Number(post.monetization_approx ?? 0);
          const share = val / colabers.length;
          for (const cid of colabers) grossByColab[cid] = (grossByColab[cid] ?? 0) + share;
        }

        const totalGross = Object.values(grossByColab).reduce((a, b) => a + b, 0);

        // Fetch daily_revenue_entries for this month to calculate total bonus
        const { data: dailyEntries } = await supabase
          .from("daily_revenue_entries")
          .select("actual_revenue_usd")
          .gte("entry_date", dateFrom.slice(0, 10))
          .lte("entry_date", `${formMonth}-${String(lastDay).padStart(2, "0")}`);

        const totalActual = (dailyEntries ?? []).reduce(
          (s: number, e: any) => s + Number(e.actual_revenue_usd ?? 0), 0
        );
        const totalBonus = totalActual - totalGross;

        // Fetch views % from PREVIOUS month to distribute bonus
        const prevMonthRef = calcPrevMonthRef(formMonth);
        const viewsPct = totalBonus !== 0
          ? await fetchViewsPctByColabForMonth(prevMonthRef)
          : {};

        const { data: closing, error: cErr } = await supabase
          .from("monthly_closings")
          .insert({
            month_ref: formMonth,
            page_id: pageId,
            status: "aberto",
            total_gross: parseFloat(totalGross.toFixed(4)),
            created_by: profile?.id,
          })
          .select("id")
          .single();
        if (cErr) throw cErr;

        // All collaborators = those with posts + those only in viewsPct (prev month)
        const allColabIds = [...new Set([
          ...collabs.map((c) => c.id),
          ...Object.keys(viewsPct),
        ])];
        const { data: allColabData } = await supabase
          .from("collaborators")
          .select("id, nome")
          .in("id", allColabIds);
        const allCollabs = (allColabData as Collab[]) ?? [];

        const items = allCollabs
          .map((c) => {
            const gross = parseFloat((grossByColab[c.id] ?? 0).toFixed(4));
            const amountDue = parseFloat((gross * collaboratorPct / 100).toFixed(4));
            // Bonus share = totalBonus * (views of this colab / total views prev month)
            const bonusShare = parseFloat(((viewsPct[c.id] ?? 0) * totalBonus).toFixed(4));
            const finalAmount = parseFloat((amountDue + bonusShare).toFixed(4));
            // Skip colabs with nothing (no posts and no bonus share)
            if (gross === 0 && bonusShare === 0) return null;
            return {
              closing_id: closing.id,
              collaborator_id: c.id,
              gross_revenue: gross,
              collaborator_pct: collaboratorPct,
              amount_due: amountDue,
              adjustments: bonusShare,  // bonus from daily reconciliation
              final_amount: finalAmount,
              payment_status: "a_pagar",
            };
          })
          .filter((x): x is NonNullable<typeof x> => x !== null);

        if (items.length > 0) {
          const { error: iErr } = await supabase.from("monthly_closing_items").insert(items);
          if (iErr) throw iErr;
        }

        toast.success(`Fechamento gerado — ${pageName} (${items.length} colabs)`);
        generated++;
      }

      if (generated > 0) {
        setShowForm(false);
        await load();
      }
    } catch (err: any) {
      toast.error("Erro ao gerar fechamento", { description: err.message });
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="space-y-6">
      <WriteGuardDialog />
      <PageHeader
        title="Fechamentos mensais"
        description="Cálculo automático de pagamentos por colaborador com base nos posts e regras de split."
        actions={
          <Button onClick={guard(() => setShowForm((v) => !v))}>
            <Plus className="h-4 w-4 mr-2" />
            Gerar fechamento
          </Button>
        }
      />

      {showForm && (
        <form onSubmit={guardSubmit(generate)} className="bg-card border border-border rounded-lg p-4 sm:p-5 space-y-4">
          <h3 className="font-semibold">Novo fechamento</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Mês de referência</label>
              <input
                type="month"
                value={formMonth}
                onChange={(e) => setFormMonth(e.target.value)}
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                required
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Página</label>
              <select
                value={formPage}
                onChange={(e) => setFormPage(e.target.value)}
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="all">Todas as páginas</option>
                {pages.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
              </select>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            O cálculo usa os posts importados do mês, os vínculos por hashtag e as regras de split cadastradas.
          </p>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={() => setShowForm(false)} className="flex-1 h-11">Cancelar</Button>
            <Button type="submit" disabled={generating} className="flex-1 h-11">
              {generating && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              {generating ? "Calculando…" : "Gerar"}
            </Button>
          </div>
        </form>
      )}

      <div className="bg-card border border-border rounded-lg overflow-hidden">
        {loading ? (
          <div className="p-10 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : closings.length === 0 ? (
          <div className="p-6">
            <EmptyState icon={CalendarCheck} title="Nenhum fechamento ainda" description='Clique em "Gerar fechamento" para calcular os pagamentos do mês.' />
          </div>
        ) : (
          <>
            {/* Mobile card list */}
            <div className="sm:hidden divide-y divide-border">
              {closings.map((c) => (
                <Link key={c.id} to="/admin/fechamentos/$id" params={{ id: c.id }} className="flex items-center justify-between gap-3 px-4 py-4 hover:bg-muted/20 active:bg-muted/40 transition-colors">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-semibold text-sm">{formatMonth(c.month_ref)}</p>
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium ${
                        c.status === "fechado" ? "bg-[#16a34a]/10 text-[#16a34a]" : "bg-amber-500/10 text-amber-600"
                      }`}>
                        {c.status === "fechado" ? "Fechado" : "Em aberto"}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">{c.pages?.nome ?? "—"} · {c._itemCount ?? 0} colabs</p>
                    <p className="text-sm font-medium mt-1">${Number(c.total_gross ?? 0).toFixed(2)}</p>
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                </Link>
              ))}
            </div>
            {/* Desktop table */}
            <div className="hidden sm:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="text-left px-5 py-3 font-medium">Mês</th>
                    <th className="text-left px-5 py-3 font-medium">Página</th>
                    <th className="text-left px-5 py-3 font-medium">Status</th>
                    <th className="text-right px-5 py-3 font-medium">
                      <span className="inline-flex items-center justify-end gap-1"><Users className="h-3 w-3" />Colabs</span>
                    </th>
                    <th className="text-right px-5 py-3 font-medium">Receita bruta (USD)</th>
                    <th className="px-5 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {closings.map((c) => (
                    <tr key={c.id} className="hover:bg-muted/20">
                      <td className="px-5 py-3 font-medium">{formatMonth(c.month_ref)}</td>
                      <td className="px-5 py-3 text-muted-foreground">{c.pages?.nome ?? "—"}</td>
                      <td className="px-5 py-3">
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                          c.status === "fechado"
                            ? "bg-[#16a34a]/10 text-[#16a34a]"
                            : "bg-amber-500/10 text-amber-600"
                        }`}>
                          {c.status === "fechado" ? "Fechado" : "Em aberto"}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-right tabular-nums text-muted-foreground">{c._itemCount ?? 0}</td>
                      <td className="px-5 py-3 text-right tabular-nums font-medium">${Number(c.total_gross ?? 0).toFixed(2)}</td>
                      <td className="px-5 py-3 text-right">
                        <Link to="/admin/fechamentos/$id" params={{ id: c.id }} className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
                          Ver detalhes <ChevronRight className="h-3 w-3" />
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
