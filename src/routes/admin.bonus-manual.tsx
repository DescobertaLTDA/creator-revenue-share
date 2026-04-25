import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, useRef, useCallback, useMemo } from "react";
import { PageHeader } from "@/components/app/PageHeader";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useWriteGuard } from "@/hooks/use-write-guard";
import { formatMonth, formatPct } from "@/lib/format";
import { toast } from "sonner";
import { Check, Loader2, TrendingUp, TrendingDown, Minus, ChevronLeft, ChevronRight, Info } from "lucide-react";

export const Route = createFileRoute("/admin/bonus-manual")({
  head: () => ({ meta: [{ title: "Conciliação diária — Splash Creators" }] }),
  component: BonusManualPage,
});

interface DayEntry {
  date: string;
  label: string;
  weekday: string;
  posts_revenue: number;
  actual_revenue: number | null;
  distribution_mode: string;
  note: string;
  id: string | null;
  dirty: boolean;
  saving: boolean;
  saved: boolean;
}

interface ColabDist {
  id: string;
  nome: string;
  hashtag: string | null;
  views: number;
  pct: number;
  bonus_estimated: number;
}

const WEEKDAYS_SHORT = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

function prevMonth(ref: string) {
  const [y, m] = ref.split("-").map(Number);
  const d = new Date(y, m - 2, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function nextMonth(ref: string) {
  const [y, m] = ref.split("-").map(Number);
  const d = new Date(y, m, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function daysInMonth(ref: string): string[] {
  const [y, m] = ref.split("-").map(Number);
  const count = new Date(y, m, 0).getDate();
  return Array.from({ length: count }, (_, i) =>
    `${ref}-${String(i + 1).padStart(2, "0")}`
  );
}

async function fetchViewsByColabForMonth(ref: string): Promise<ColabDist[]> {
  const days = daysInMonth(ref);
  const from = days[0];
  const to = days[days.length - 1];

  const { data: postsData } = await supabase
    .from("posts")
    .select("id, views")
    .gte("published_at", from)
    .lte("published_at", to + "T23:59:59");

  if (!postsData || postsData.length === 0) return [];

  const postIds = postsData.map((p: any) => p.id);
  const viewsByPost: Record<string, number> = {};
  for (const p of postsData as any[]) viewsByPost[p.id] = Number(p.views ?? 0);

  const { data: paData } = await supabase
    .from("post_authors")
    .select("post_id, collaborator_id")
    .in("post_id", postIds);

  const postColabMap: Record<string, string[]> = {};
  for (const pa of (paData ?? []) as any[]) {
    if (!postColabMap[pa.post_id]) postColabMap[pa.post_id] = [];
    postColabMap[pa.post_id].push(pa.collaborator_id);
  }

  const viewsByColab: Record<string, number> = {};
  for (const [postId, colabs] of Object.entries(postColabMap)) {
    const views = viewsByPost[postId] ?? 0;
    const share = views / colabs.length;
    for (const cid of colabs) viewsByColab[cid] = (viewsByColab[cid] ?? 0) + share;
  }

  const colabIds = Object.keys(viewsByColab);
  if (colabIds.length === 0) return [];

  const { data: colabData } = await supabase
    .from("collaborators")
    .select("id, nome, hashtag")
    .in("id", colabIds);

  const totalViews = Object.values(viewsByColab).reduce((a, b) => a + b, 0);

  return ((colabData ?? []) as any[])
    .map((c) => ({
      id: c.id,
      nome: c.nome,
      hashtag: c.hashtag ?? null,
      views: Math.round(viewsByColab[c.id] ?? 0),
      pct: totalViews > 0 ? (viewsByColab[c.id] ?? 0) / totalViews : 0,
      bonus_estimated: 0,
    }))
    .sort((a, b) => b.views - a.views);
}

function BonusManualPage() {
  const { profile } = useAuth();
  const { guard, WriteGuardDialog } = useWriteGuard();
  const todayMonth = new Date().toISOString().slice(0, 7);
  const [monthRef, setMonthRef] = useState(todayMonth);
  const [rows, setRows] = useState<DayEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [colabDist, setColabDist] = useState<ColabDist[]>([]);
  const [distLoading, setDistLoading] = useState(false);
  const saveTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const buildRows = useCallback(
    (
      days: string[],
      postsByDay: Record<string, number>,
      dbEntries: Record<string, { id: string; actual_revenue_usd: number | null; distribution_mode: string; note: string | null }>
    ): DayEntry[] => {
      return days.map((date) => {
        const d = new Date(date + "T00:00:00");
        const db = dbEntries[date];
        return {
          date,
          label: `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`,
          weekday: WEEKDAYS_SHORT[d.getDay()],
          posts_revenue: postsByDay[date] ?? 0,
          actual_revenue: db?.actual_revenue_usd ?? null,
          distribution_mode: db?.distribution_mode ?? "hybrid",
          note: db?.note ?? "",
          id: db?.id ?? null,
          dirty: false,
          saving: false,
          saved: false,
        };
      });
    },
    []
  );

  const load = useCallback(async (ref: string) => {
    setLoading(true);
    const days = daysInMonth(ref);
    const from = days[0];
    const to = days[days.length - 1];

    const [{ data: postsData }, { data: dbData }] = await Promise.all([
      supabase
        .from("posts")
        .select("published_at, monetization_approx")
        .gte("published_at", from)
        .lte("published_at", to + "T23:59:59"),
      supabase
        .from("daily_revenue_entries")
        .select("id, entry_date, actual_revenue_usd, distribution_mode, note")
        .gte("entry_date", from)
        .lte("entry_date", to),
    ]);

    const postsByDay: Record<string, number> = {};
    for (const p of (postsData ?? []) as any[]) {
      if (!p.published_at) continue;
      const day = p.published_at.slice(0, 10);
      postsByDay[day] = (postsByDay[day] ?? 0) + Number(p.monetization_approx ?? 0);
    }

    const dbEntries: Record<string, any> = {};
    for (const e of (dbData ?? []) as any[]) dbEntries[e.entry_date] = e;

    setRows(buildRows(days, postsByDay, dbEntries));
    setLoading(false);
  }, [buildRows]);

  const loadDist = useCallback(async (ref: string) => {
    setDistLoading(true);
    const prev = prevMonth(ref);
    const dist = await fetchViewsByColabForMonth(prev);
    setColabDist(dist);
    setDistLoading(false);
  }, []);

  useEffect(() => {
    load(monthRef);
    loadDist(monthRef);
  }, [monthRef, load, loadDist]);

  const updateRow = (date: string, field: keyof DayEntry, value: unknown) => {
    setRows((prev) =>
      prev.map((r) => r.date === date ? { ...r, [field]: value, dirty: true, saved: false } : r)
    );
  };

  const saveRow = async (row: DayEntry) => {
    setRows((prev) => prev.map((r) => r.date === row.date ? { ...r, saving: true } : r));
    const payload = {
      entry_date: row.date,
      actual_revenue_usd: row.actual_revenue,
      distribution_mode: row.distribution_mode,
      note: row.note.trim() || null,
      updated_at: new Date().toISOString(),
      created_by: profile?.id ?? null,
    };
    let error: any = null;
    if (row.id) {
      ({ error } = await supabase.from("daily_revenue_entries").update(payload).eq("id", row.id));
    } else {
      const { data, error: e } = await supabase
        .from("daily_revenue_entries").insert(payload).select("id").single();
      error = e;
      if (!error && data) setRows((prev) => prev.map((r) => r.date === row.date ? { ...r, id: (data as any).id } : r));
    }
    if (error) {
      toast.error("Erro ao salvar", { description: error.message });
      setRows((prev) => prev.map((r) => r.date === row.date ? { ...r, saving: false } : r));
    } else {
      setRows((prev) => prev.map((r) => r.date === row.date ? { ...r, saving: false, dirty: false, saved: true } : r));
      setTimeout(() => setRows((prev) => prev.map((r) => r.date === row.date ? { ...r, saved: false } : r)), 2000);
    }
  };

  const handleActualChange = (row: DayEntry, raw: string) => {
    const val = raw === "" ? null : parseFloat(raw);
    updateRow(row.date, "actual_revenue", Number.isFinite(val) ? val : null);
    clearTimeout(saveTimers.current[row.date]);
    saveTimers.current[row.date] = setTimeout(() => {
      setRows((prev) => {
        const updated = prev.find((r) => r.date === row.date);
        if (updated) saveRow(updated);
        return prev;
      });
    }, 800);
  };

  const handleFieldBlur = guard((row: DayEntry) => { if (row.dirty) saveRow(row); });

  const totalPosts = rows.reduce((s, r) => s + r.posts_revenue, 0);
  const totalActual = rows.reduce((s, r) => s + (r.actual_revenue ?? 0), 0);
  const totalBonus = totalActual - totalPosts;
  const filledDays = rows.filter((r) => r.actual_revenue != null).length;

  // Distribution with estimated bonus applied
  const distWithBonus: ColabDist[] = useMemo(() => {
    if (totalBonus <= 0) return colabDist.map((c) => ({ ...c, bonus_estimated: 0 }));
    return colabDist.map((c) => ({ ...c, bonus_estimated: totalBonus * c.pct }));
  }, [colabDist, totalBonus]);

  const prevMonthRef = prevMonth(monthRef);

  return (
    <div className="space-y-6">
      <WriteGuardDialog />
      <PageHeader
        title="Conciliação diária"
        description="Compare o que os posts geraram com o que o Facebook realmente pagou. A diferença é o bônus distribuído pelas views do mês anterior."
      />

      {/* Month navigation */}
      <div className="flex items-center gap-2">
        <button onClick={() => setMonthRef(prevMonth(monthRef))} className="p-2.5 rounded-lg border border-border hover:bg-muted transition-colors">
          <ChevronLeft className="h-5 w-5" />
        </button>
        <div className="flex-1 flex items-center gap-2">
          <input
            type="month"
            value={monthRef}
            onChange={(e) => e.target.value && setMonthRef(e.target.value)}
            className="flex-1 h-9 rounded-md border border-input bg-background px-3 text-sm font-medium"
          />
          <span className="hidden sm:block text-sm font-semibold text-muted-foreground whitespace-nowrap">{formatMonth(monthRef)}</span>
        </div>
        <button onClick={() => setMonthRef(nextMonth(monthRef))} className="p-2.5 rounded-lg border border-border hover:bg-muted transition-colors" disabled={monthRef >= todayMonth}>
          <ChevronRight className="h-5 w-5" />
        </button>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-card border border-border rounded-lg p-4">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">Posts (USD)</p>
          <p className="text-xl font-bold mt-1">${totalPosts.toFixed(2)}</p>
          <p className="text-xs text-muted-foreground mt-0.5">calculado do CSV</p>
        </div>
        <div className="bg-card border border-border rounded-lg p-4">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">Real recebido (USD)</p>
          <p className="text-xl font-bold mt-1">${totalActual.toFixed(2)}</p>
          <p className="text-xs text-muted-foreground mt-0.5">{filledDays} dias preenchidos</p>
        </div>
        <div className={`bg-card border rounded-lg p-4 ${totalBonus > 0 ? "border-[#16a34a]/30" : totalBonus < 0 ? "border-destructive/30" : "border-border"}`}>
          <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">Bônus total (USD)</p>
          <p className={`text-xl font-bold mt-1 ${totalBonus > 0 ? "text-[#16a34a]" : totalBonus < 0 ? "text-destructive" : ""}`}>
            {totalBonus >= 0 ? "+" : ""}${totalBonus.toFixed(2)}
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">real − posts</p>
        </div>
        <div className="bg-card border border-border rounded-lg p-4">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">Progresso</p>
          <p className="text-xl font-bold mt-1">{filledDays}/{rows.length}</p>
          <div className="mt-2 h-1.5 bg-muted rounded-full overflow-hidden">
            <div className="h-full bg-[#16a34a] rounded-full transition-all" style={{ width: rows.length ? `${(filledDays / rows.length) * 100}%` : "0%" }} />
          </div>
        </div>
      </div>

      {/* Daily table */}
      <div className="bg-card border border-border rounded-lg overflow-hidden">
        <div className="px-4 sm:px-5 py-4 border-b border-border">
          <h2 className="font-semibold">Receita dia a dia — {formatMonth(monthRef)}</h2>
          <p className="text-xs text-muted-foreground mt-0.5">Digite o valor real do Facebook em cada dia. Salvo automaticamente.</p>
        </div>
        {loading ? (
          <div className="p-10 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : (
          <>
            {/* Mobile: compact card list */}
            <div className="sm:hidden divide-y divide-border">
              {rows.map((row) => {
                const bonus = row.actual_revenue != null ? row.actual_revenue - row.posts_revenue : null;
                const isWeekend = row.weekday === "Sáb" || row.weekday === "Dom";
                const isFuture = row.date > new Date().toISOString().slice(0, 10);
                return (
                  <div key={row.date} className={`px-4 py-3 space-y-2.5 ${isWeekend ? "bg-muted/10" : ""} ${isFuture ? "opacity-40" : ""}`}>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold tabular-nums text-sm">{row.label}</span>
                        <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">{row.weekday}</span>
                        {row.posts_revenue > 0 && <span className="text-xs text-muted-foreground">posts: ${row.posts_revenue.toFixed(2)}</span>}
                      </div>
                      <div className="h-5 w-5 flex items-center justify-center">
                        {row.saving ? <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                          : row.saved ? <Check className="h-3.5 w-3.5 text-[#16a34a]" />
                          : row.dirty ? <div className="h-2 w-2 rounded-full bg-amber-400" />
                          : null}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="flex-1">
                        <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">Real recebido (USD)</p>
                        <input
                          type="number" min="0" step="0.01" disabled={isFuture}
                          placeholder="0.00"
                          value={row.actual_revenue ?? ""}
                          onChange={(e) => handleActualChange(row, e.target.value)}
                          onBlur={() => handleFieldBlur(row)}
                          className="w-full h-10 rounded-lg border border-input bg-background px-3 text-right text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-30"
                        />
                      </div>
                      {bonus != null && (
                        <div className="shrink-0 text-right">
                          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">Bônus</p>
                          <p className={`text-sm font-semibold tabular-nums ${bonus > 0 ? "text-[#16a34a]" : bonus < 0 ? "text-destructive" : "text-muted-foreground"}`}>
                            {bonus > 0 ? "+" : ""}{bonus === 0 ? "$0.00" : `$${bonus.toFixed(2)}`}
                          </p>
                        </div>
                      )}
                    </div>
                    {row.actual_revenue != null && (
                      <input
                        type="text" disabled={isFuture}
                        placeholder="Observação (opcional)"
                        value={row.note}
                        onChange={(e) => updateRow(row.date, "note", e.target.value)}
                        onBlur={() => handleFieldBlur(row)}
                        className="w-full h-9 rounded-lg border border-input bg-background px-3 text-xs focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-30"
                      />
                    )}
                  </div>
                );
              })}
              <div className="px-4 py-3 bg-muted/30 flex items-center justify-between font-semibold text-sm">
                <span>Total</span>
                <div className="text-right">
                  <p className={totalBonus > 0 ? "text-[#16a34a]" : totalBonus < 0 ? "text-destructive" : ""}>
                    {totalBonus >= 0 ? "+" : ""}${totalBonus.toFixed(2)} bônus
                  </p>
                  <p className="text-xs text-muted-foreground font-normal">real: ${totalActual.toFixed(2)}</p>
                </div>
              </div>
            </div>

            {/* Desktop: full table */}
            <div className="hidden sm:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="text-left px-4 py-3 font-medium w-24">Dia</th>
                    <th className="text-right px-4 py-3 font-medium">Posts (USD)</th>
                    <th className="text-right px-4 py-3 font-medium">Real recebido (USD)</th>
                    <th className="text-right px-4 py-3 font-medium">Bônus / Diferença</th>
                    <th className="text-left px-4 py-3 font-medium w-28">Rateio</th>
                    <th className="text-left px-4 py-3 font-medium">Observação</th>
                    <th className="w-8 px-4 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {rows.map((row) => {
                    const bonus = row.actual_revenue != null ? row.actual_revenue - row.posts_revenue : null;
                    const isWeekend = row.weekday === "Sáb" || row.weekday === "Dom";
                    const isFuture = row.date > new Date().toISOString().slice(0, 10);
                    return (
                      <tr key={row.date} className={`hover:bg-muted/20 ${isWeekend ? "bg-muted/10" : ""} ${isFuture ? "opacity-40" : ""}`}>
                        <td className="px-4 py-2.5">
                          <span className="font-semibold tabular-nums">{row.label}</span>
                          <span className="text-[10px] text-muted-foreground ml-1.5">{row.weekday}</span>
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">
                          {row.posts_revenue > 0 ? `$${row.posts_revenue.toFixed(2)}` : <span className="text-muted-foreground/40">—</span>}
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          <input
                            type="number" min="0" step="0.01" disabled={isFuture}
                            placeholder="0.00"
                            value={row.actual_revenue ?? ""}
                            onChange={(e) => handleActualChange(row, e.target.value)}
                            onBlur={() => handleFieldBlur(row)}
                            className="w-28 h-7 rounded border border-input bg-background px-2 text-right text-sm tabular-nums focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-30"
                          />
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums font-medium">
                          {bonus == null ? (
                            <span className="text-muted-foreground/30">—</span>
                          ) : bonus === 0 ? (
                            <span className="inline-flex items-center gap-1 text-muted-foreground"><Minus className="h-3 w-3" />$0.00</span>
                          ) : bonus > 0 ? (
                            <span className="inline-flex items-center gap-1 text-[#16a34a]"><TrendingUp className="h-3 w-3" />+${bonus.toFixed(2)}</span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-destructive"><TrendingDown className="h-3 w-3" />${bonus.toFixed(2)}</span>
                          )}
                        </td>
                        <td className="px-4 py-2.5">
                          <select
                            disabled={isFuture}
                            value={row.distribution_mode}
                            onChange={(e) => {
                              updateRow(row.date, "distribution_mode", e.target.value);
                              setTimeout(() => {
                                setRows((prev) => {
                                  const updated = prev.find((r) => r.date === row.date);
                                  if (updated) saveRow({ ...updated, distribution_mode: e.target.value, dirty: true });
                                  return prev;
                                });
                              }, 0);
                            }}
                            className="h-7 w-full rounded border border-input bg-background px-1.5 text-xs disabled:opacity-30"
                          >
                            <option value="hybrid">Misto</option>
                            <option value="views">Views</option>
                            <option value="revenue">Receita</option>
                          </select>
                        </td>
                        <td className="px-4 py-2.5">
                          <input
                            type="text" disabled={isFuture}
                            placeholder="ex: bônus Facebook, posts antigos…"
                            value={row.note}
                            onChange={(e) => updateRow(row.date, "note", e.target.value)}
                            onBlur={() => handleFieldBlur(row)}
                            className="h-7 w-full rounded border border-input bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-30"
                          />
                        </td>
                        <td className="px-2 py-2.5 w-8">
                          {row.saving ? <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                            : row.saved ? <Check className="h-3.5 w-3.5 text-[#16a34a]" />
                            : row.dirty ? <div className="h-2 w-2 rounded-full bg-amber-400" title="Não salvo" />
                            : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-border bg-muted/30 font-semibold text-sm">
                    <td className="px-4 py-3 text-muted-foreground">Total</td>
                    <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">${totalPosts.toFixed(2)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">${totalActual.toFixed(2)}</td>
                    <td className={`px-4 py-3 text-right tabular-nums ${totalBonus > 0 ? "text-[#16a34a]" : totalBonus < 0 ? "text-destructive" : ""}`}>
                      {totalBonus >= 0 ? "+" : ""}${totalBonus.toFixed(2)}
                    </td>
                    <td colSpan={3} />
                  </tr>
                </tfoot>
              </table>
            </div>
          </>
        )}
      </div>

      {/* Bonus distribution preview */}
      <div className="bg-card border border-border rounded-lg overflow-hidden">
        <div className="px-5 py-4 border-b border-border flex items-start justify-between gap-4">
          <div>
            <h2 className="font-semibold">Distribuição do bônus por colaborador</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Baseado nas views de <strong>{formatMonth(prevMonthRef)}</strong> — quem fez mais views recebe maior fatia do bônus de {formatMonth(monthRef)}.
            </p>
          </div>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground shrink-0 mt-1">
            <Info className="h-3.5 w-3.5" />
            Bônus total: <span className={`font-semibold ${totalBonus > 0 ? "text-[#16a34a]" : totalBonus < 0 ? "text-destructive" : ""}`}>${totalBonus.toFixed(2)}</span>
          </div>
        </div>

        {distLoading ? (
          <div className="p-8 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : distWithBonus.length === 0 ? (
          <div className="p-6 text-sm text-muted-foreground text-center">
            Sem dados de views em {formatMonth(prevMonthRef)}. Importe o CSV desse mês para calcular a distribuição.
          </div>
        ) : (
          <>
            {/* Mobile card list */}
            <div className="sm:hidden divide-y divide-border">
              {distWithBonus.map((c) => (
                <div key={c.id} className="px-4 py-3 space-y-2">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold text-sm">{c.nome}</p>
                      {c.hashtag && <p className="text-xs text-muted-foreground">#{c.hashtag}</p>}
                    </div>
                    <p className={`font-bold tabular-nums text-sm shrink-0 ${totalBonus > 0 ? "text-[#16a34a]" : totalBonus < 0 ? "text-destructive" : ""}`}>
                      {totalBonus !== 0 ? `${totalBonus >= 0 ? "+" : ""}$${c.bonus_estimated.toFixed(2)}` : "—"}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                      <div className="h-full bg-[#16a34a] rounded-full transition-all" style={{ width: `${c.pct * 100}%` }} />
                    </div>
                    <span className="text-xs font-semibold w-12 text-right tabular-nums">{formatPct(c.pct * 100)}</span>
                    <span className="text-xs text-muted-foreground">
                      {c.views >= 1_000_000 ? `${(c.views / 1_000_000).toFixed(1)}M` : c.views >= 1_000 ? `${(c.views / 1_000).toFixed(1)}k` : c.views.toLocaleString("pt-BR")} views
                    </span>
                  </div>
                </div>
              ))}
            </div>
            {/* Desktop table */}
            <div className="hidden sm:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="text-left px-5 py-3 font-medium">Colaborador</th>
                    <th className="text-right px-5 py-3 font-medium">Views em {formatMonth(prevMonthRef)}</th>
                    <th className="text-right px-5 py-3 font-medium">% do total</th>
                    <th className="text-right px-5 py-3 font-medium">Bônus estimado (USD)</th>
                    <th className="px-5 py-3 font-medium w-48">Participação</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {distWithBonus.map((c) => (
                    <tr key={c.id} className="hover:bg-muted/20">
                      <td className="px-5 py-3">
                        <p className="font-medium">{c.nome}</p>
                        {c.hashtag && <p className="text-xs text-muted-foreground">#{c.hashtag}</p>}
                      </td>
                      <td className="px-5 py-3 text-right tabular-nums">
                        {c.views >= 1_000_000 ? `${(c.views / 1_000_000).toFixed(1)}M` : c.views >= 1_000 ? `${(c.views / 1_000).toFixed(1)}k` : c.views.toLocaleString("pt-BR")}
                      </td>
                      <td className="px-5 py-3 text-right tabular-nums font-semibold">{formatPct(c.pct * 100)}</td>
                      <td className={`px-5 py-3 text-right tabular-nums font-semibold ${totalBonus > 0 ? "text-[#16a34a]" : totalBonus < 0 ? "text-destructive" : ""}`}>
                        {totalBonus !== 0 ? `${totalBonus >= 0 ? "+" : ""}$${c.bonus_estimated.toFixed(2)}` : "—"}
                      </td>
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                            <div className="h-full bg-[#16a34a] rounded-full" style={{ width: `${c.pct * 100}%` }} />
                          </div>
                          <span className="text-xs text-muted-foreground w-10 text-right">{formatPct(c.pct * 100)}</span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-border bg-muted/30 font-semibold text-sm">
                    <td className="px-5 py-3">Total</td>
                    <td className="px-5 py-3 text-right tabular-nums text-muted-foreground">
                      {(() => { const t = distWithBonus.reduce((s, c) => s + c.views, 0); return t >= 1_000_000 ? `${(t / 1_000_000).toFixed(1)}M` : t >= 1_000 ? `${(t / 1_000).toFixed(1)}k` : t.toLocaleString("pt-BR"); })()}
                    </td>
                    <td className="px-5 py-3 text-right">100%</td>
                    <td className={`px-5 py-3 text-right tabular-nums ${totalBonus > 0 ? "text-[#16a34a]" : totalBonus < 0 ? "text-destructive" : ""}`}>
                      {totalBonus !== 0 ? `${totalBonus >= 0 ? "+" : ""}$${totalBonus.toFixed(2)}` : "—"}
                    </td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          </>
        )}
      </div>

      <p className="text-xs text-muted-foreground text-center">
        Dados salvos automaticamente. Dias futuros são bloqueados. Finais de semana em destaque.
      </p>
    </div>
  );
}
