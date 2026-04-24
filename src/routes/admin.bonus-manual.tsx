import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, useRef, useCallback } from "react";
import { PageHeader } from "@/components/app/PageHeader";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { formatMonth } from "@/lib/format";
import { toast } from "sonner";
import { Check, Loader2, TrendingUp, TrendingDown, Minus, ChevronLeft, ChevronRight } from "lucide-react";

export const Route = createFileRoute("/admin/bonus-manual")({
  head: () => ({ meta: [{ title: "Conciliação diária — Rateio Creator" }] }),
  component: BonusManualPage,
});

interface DayEntry {
  date: string;           // YYYY-MM-DD
  label: string;          // "01/04"
  weekday: string;        // "Seg"
  posts_revenue: number;  // calculado dos posts (somente leitura)
  actual_revenue: number | null; // digitado pelo admin
  distribution_mode: string;
  note: string;
  id: string | null;      // id no DB (null = ainda não salvo)
  dirty: boolean;
  saving: boolean;
  saved: boolean;
}

const MODE_LABELS: Record<string, string> = {
  hybrid: "Misto",
  views: "Views",
  revenue: "Receita",
};

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

function BonusManualPage() {
  const { profile } = useAuth();
  const today = new Date().toISOString().slice(0, 7);
  const [monthRef, setMonthRef] = useState(today);
  const [rows, setRows] = useState<DayEntry[]>([]);
  const [loading, setLoading] = useState(true);
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

    // Group posts by day
    const postsByDay: Record<string, number> = {};
    for (const p of postsData ?? []) {
      if (!p.published_at) continue;
      const day = p.published_at.slice(0, 10);
      postsByDay[day] = (postsByDay[day] ?? 0) + Number(p.monetization_approx ?? 0);
    }

    // Index DB entries by date
    const dbEntries: Record<string, any> = {};
    for (const e of dbData ?? []) {
      dbEntries[e.entry_date] = e;
    }

    setRows(buildRows(days, postsByDay, dbEntries));
    setLoading(false);
  }, [buildRows]);

  useEffect(() => {
    load(monthRef);
  }, [monthRef, load]);

  const updateRow = (date: string, field: keyof DayEntry, value: unknown) => {
    setRows((prev) =>
      prev.map((r) =>
        r.date === date ? { ...r, [field]: value, dirty: true, saved: false } : r
      )
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
      ({ error } = await supabase
        .from("daily_revenue_entries")
        .update(payload)
        .eq("id", row.id));
    } else {
      const { data, error: e } = await supabase
        .from("daily_revenue_entries")
        .insert(payload)
        .select("id")
        .single();
      error = e;
      if (!error && data) {
        setRows((prev) => prev.map((r) => r.date === row.date ? { ...r, id: data.id } : r));
      }
    }

    if (error) {
      toast.error("Erro ao salvar", { description: error.message });
      setRows((prev) => prev.map((r) => r.date === row.date ? { ...r, saving: false } : r));
    } else {
      setRows((prev) => prev.map((r) => r.date === row.date ? { ...r, saving: false, dirty: false, saved: true } : r));
      setTimeout(() => {
        setRows((prev) => prev.map((r) => r.date === row.date ? { ...r, saved: false } : r));
      }, 2000);
    }
  };

  // Debounced auto-save when actual_revenue changes
  const handleActualChange = (row: DayEntry, raw: string) => {
    const val = raw === "" ? null : parseFloat(raw);
    updateRow(row.date, "actual_revenue", Number.isFinite(val) ? val : null);

    // debounce save
    clearTimeout(saveTimers.current[row.date]);
    saveTimers.current[row.date] = setTimeout(() => {
      setRows((prev) => {
        const updated = prev.find((r) => r.date === row.date);
        if (updated) saveRow(updated);
        return prev;
      });
    }, 800);
  };

  const handleFieldBlur = (row: DayEntry) => {
    if (row.dirty) saveRow(row);
  };

  // Summary
  const totalPosts = rows.reduce((s, r) => s + r.posts_revenue, 0);
  const totalActual = rows.reduce((s, r) => s + (r.actual_revenue ?? 0), 0);
  const totalBonus = totalActual - totalPosts;
  const filledDays = rows.filter((r) => r.actual_revenue != null).length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Conciliação diária"
        description="Compare o que os posts geraram com o que o Facebook realmente pagou. A diferença é o bônus do dia."
      />

      {/* Month navigation */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => setMonthRef(prevMonth(monthRef))}
          className="p-1.5 rounded-md border border-border hover:bg-muted transition-colors"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <input
          type="month"
          value={monthRef}
          onChange={(e) => e.target.value && setMonthRef(e.target.value)}
          className="h-9 rounded-md border border-input bg-background px-3 text-sm font-medium"
        />
        <button
          onClick={() => setMonthRef(nextMonth(monthRef))}
          className="p-1.5 rounded-md border border-border hover:bg-muted transition-colors"
          disabled={monthRef >= today}
        >
          <ChevronRight className="h-4 w-4" />
        </button>
        <span className="text-sm font-semibold text-muted-foreground">{formatMonth(monthRef)}</span>
      </div>

      {/* Summary KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="bg-card border border-border rounded-xl p-4">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">Posts (USD)</p>
          <p className="text-xl font-bold mt-1">${totalPosts.toFixed(2)}</p>
          <p className="text-xs text-muted-foreground mt-0.5">calculado do CSV</p>
        </div>
        <div className="bg-card border border-border rounded-xl p-4">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">Real recebido (USD)</p>
          <p className="text-xl font-bold mt-1">${totalActual.toFixed(2)}</p>
          <p className="text-xs text-muted-foreground mt-0.5">{filledDays} dias preenchidos</p>
        </div>
        <div className={`bg-card border rounded-xl p-4 ${totalBonus >= 0 ? "border-[#16a34a]/30" : "border-destructive/30"}`}>
          <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">Bônus / Diferença</p>
          <p className={`text-xl font-bold mt-1 ${totalBonus > 0 ? "text-[#16a34a]" : totalBonus < 0 ? "text-destructive" : ""}`}>
            {totalBonus >= 0 ? "+" : ""}${totalBonus.toFixed(2)}
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">real − posts</p>
        </div>
        <div className="bg-card border border-border rounded-xl p-4">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">Progresso</p>
          <p className="text-xl font-bold mt-1">{filledDays}/{rows.length}</p>
          <div className="mt-2 h-1.5 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-[#16a34a] rounded-full transition-all"
              style={{ width: rows.length ? `${(filledDays / rows.length) * 100}%` : "0%" }}
            />
          </div>
        </div>
      </div>

      {/* Daily table */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-border flex items-center justify-between">
          <div>
            <h2 className="font-semibold">Receita dia a dia — {formatMonth(monthRef)}</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Digite o valor real que o Facebook pagou em cada dia. O bônus é calculado automaticamente.
            </p>
          </div>
        </div>

        {loading ? (
          <div className="p-10 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs uppercase text-muted-foreground sticky top-0">
                <tr>
                  <th className="text-left px-4 py-3 font-medium w-20">Dia</th>
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
                  const bonus =
                    row.actual_revenue != null
                      ? row.actual_revenue - row.posts_revenue
                      : null;
                  const isWeekend = row.weekday === "Sáb" || row.weekday === "Dom";
                  const isFuture = row.date > new Date().toISOString().slice(0, 10);

                  return (
                    <tr
                      key={row.date}
                      className={`hover:bg-muted/20 ${isWeekend ? "bg-muted/10" : ""} ${isFuture ? "opacity-40" : ""}`}
                    >
                      {/* Day */}
                      <td className="px-4 py-2.5">
                        <span className="font-semibold tabular-nums">{row.label}</span>
                        <span className="text-[10px] text-muted-foreground ml-1.5">{row.weekday}</span>
                      </td>

                      {/* Posts revenue (read-only) */}
                      <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">
                        {row.posts_revenue > 0 ? `$${row.posts_revenue.toFixed(2)}` : <span className="text-muted-foreground/40">—</span>}
                      </td>

                      {/* Actual revenue (editable) */}
                      <td className="px-4 py-2.5 text-right">
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          disabled={isFuture}
                          placeholder="0.00"
                          value={row.actual_revenue ?? ""}
                          onChange={(e) => handleActualChange(row, e.target.value)}
                          onBlur={() => handleFieldBlur(row)}
                          className="w-28 h-7 rounded border border-input bg-background px-2 text-right text-sm tabular-nums focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-30"
                        />
                      </td>

                      {/* Bonus */}
                      <td className="px-4 py-2.5 text-right tabular-nums font-medium">
                        {bonus == null ? (
                          <span className="text-muted-foreground/30">—</span>
                        ) : bonus === 0 ? (
                          <span className="inline-flex items-center gap-1 text-muted-foreground">
                            <Minus className="h-3 w-3" /> $0.00
                          </span>
                        ) : bonus > 0 ? (
                          <span className="inline-flex items-center gap-1 text-[#16a34a]">
                            <TrendingUp className="h-3 w-3" />
                            +${bonus.toFixed(2)}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-destructive">
                            <TrendingDown className="h-3 w-3" />
                            ${bonus.toFixed(2)}
                          </span>
                        )}
                      </td>

                      {/* Distribution mode */}
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

                      {/* Note */}
                      <td className="px-4 py-2.5">
                        <input
                          type="text"
                          disabled={isFuture}
                          placeholder="ex: bônus Facebook, posts antigos…"
                          value={row.note}
                          onChange={(e) => updateRow(row.date, "note", e.target.value)}
                          onBlur={() => handleFieldBlur(row)}
                          className="h-7 w-full rounded border border-input bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-30"
                        />
                      </td>

                      {/* Save indicator */}
                      <td className="px-2 py-2.5 w-8">
                        {row.saving ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                        ) : row.saved ? (
                          <Check className="h-3.5 w-3.5 text-[#16a34a]" />
                        ) : row.dirty ? (
                          <div className="h-2 w-2 rounded-full bg-amber-400" title="Não salvo" />
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>

              {/* Footer totals */}
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
        )}
      </div>

      <p className="text-xs text-muted-foreground text-center">
        Dados salvos automaticamente. Dias futuros são bloqueados. Finais de semana em destaque.
      </p>
    </div>
  );
}
