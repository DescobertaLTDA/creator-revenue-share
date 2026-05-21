import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, useRef, useCallback, useMemo } from "react";
import { PageHeader } from "@/components/app/PageHeader";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useWriteGuard } from "@/hooks/use-write-guard";
import { formatMonth, formatPct } from "@/lib/format";
import { toast } from "sonner";
import { Check, Loader2, ChevronLeft, ChevronRight, Info, Coins, ChevronDown } from "lucide-react";

export const Route = createFileRoute("/admin/bonus-manual")({
  head: () => ({ meta: [{ title: "Conciliação diária — Splash Creators" }] }),
  component: BonusManualPage,
});

// ─── Types ────────────────────────────────────────────────────────────────────

interface PageOption {
  id: string;
  nome: string;
  isMonetized: boolean;
}

interface DayEntry {
  date: string;
  label: string;
  weekday: string;
  posts_revenue: number;
  views: number;
  actual_views: number | null;
  actual_followers: number | null;
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

// ─── Helpers ─────────────────────────────────────────────────────────────────

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

async function fetchViewsByColabForMonth(ref: string, pageId: string): Promise<ColabDist[]> {
  const days = daysInMonth(ref);
  const from = days[0];
  const to = days[days.length - 1];

  const { data: postsData } = await supabase
    .from("posts")
    .select("id, views")
    .eq("page_id", pageId)
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

// ─── PageSelect ───────────────────────────────────────────────────────────────

function PageSelect({
  pages,
  value,
  onChange,
}: {
  pages: PageOption[];
  value: string;
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const selected = pages.find((p) => p.id === value);
  const monetized = pages.filter((p) => p.isMonetized);
  const nonMonetized = pages.filter((p) => !p.isMonetized);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className={`h-10 min-w-[220px] flex items-center gap-2 px-3 rounded-xl border text-sm transition-colors bg-white ${
          open ? "border-[#F44708] ring-2 ring-[#F44708]/20" : "border-border hover:border-[#c4b5d8]"
        }`}
      >
        {selected ? (
          <>
            <Coins className={`h-4 w-4 shrink-0 ${selected.isMonetized ? "text-emerald-500" : "text-red-400"}`} />
            <span className="flex-1 truncate text-left font-medium text-foreground">{selected.nome}</span>
          </>
        ) : (
          <span className="flex-1 text-left text-muted-foreground">Selecionar página…</span>
        )}
        <ChevronDown className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="absolute z-50 top-full mt-1 left-0 min-w-full w-max max-w-sm bg-white border border-border rounded-xl overflow-hidden">
          <div className="max-h-72 overflow-y-auto p-1.5 space-y-px">
            {monetized.length > 0 && (
              <>
                <div className="flex items-center gap-1.5 px-3 pt-2 pb-1">
                  <Coins className="h-3 w-3 text-emerald-500" />
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-emerald-600">Monetizadas</span>
                </div>
                {monetized.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => { onChange(p.id); setOpen(false); }}
                    className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors text-left ${
                      value === p.id ? "bg-[#F44708] text-white" : "hover:bg-[#FFF0E8] text-foreground"
                    }`}
                  >
                    <Coins className={`h-3.5 w-3.5 shrink-0 ${value === p.id ? "text-white/80" : "text-emerald-500"}`} />
                    <span className="truncate">{p.nome}</span>
                  </button>
                ))}
              </>
            )}
            {nonMonetized.length > 0 && (
              <>
                <div className="flex items-center gap-1.5 px-3 pt-2 pb-1">
                  <Coins className="h-3 w-3 text-red-400" />
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-red-500">Não Monetizadas</span>
                </div>
                {nonMonetized.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => { onChange(p.id); setOpen(false); }}
                    className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors text-left ${
                      value === p.id ? "bg-[#F44708] text-white" : "hover:bg-[#FFF0E8] text-foreground"
                    }`}
                  >
                    <Coins className={`h-3.5 w-3.5 shrink-0 ${value === p.id ? "text-white/80" : "text-red-400"}`} />
                    <span className="truncate">{p.nome}</span>
                  </button>
                ))}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

function BonusManualPage() {
  const { profile } = useAuth();
  const { guard, canWrite, WriteGuardDialog } = useWriteGuard();
  const todayMonth = new Date().toISOString().slice(0, 7);
  const [monthRef, setMonthRef] = useState(todayMonth);
  const [pages, setPages] = useState<PageOption[]>([]);
  const [selectedPageId, setSelectedPageId] = useState<string>("");
  const [rows, setRows] = useState<DayEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [colabDist, setColabDist] = useState<ColabDist[]>([]);
  const [distLoading, setDistLoading] = useState(false);
  const [viewsFocusDate, setViewsFocusDate] = useState<string | null>(null);
  const [followersFocusDate, setFollowersFocusDate] = useState<string | null>(null);
  const saveTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  // Load pages list once
  useEffect(() => {
    async function loadPages() {
      const { data: pagesData } = await supabase
        .from("pages")
        .select("id, nome")
        .order("nome");

      if (!pagesData || pagesData.length === 0) return;

      // A page is monetized if it has ≥3 posts with revenue
      const { data: revPosts } = await supabase
        .from("posts")
        .select("page_id, monetization_approx, estimated_usd")
        .or("monetization_approx.gt.0,estimated_usd.gt.0");

      const revCounts = new Map<string, number>();
      for (const p of (revPosts ?? []) as any[]) {
        revCounts.set(p.page_id, (revCounts.get(p.page_id) ?? 0) + 1);
      }

      const list: PageOption[] = (pagesData as any[]).map((p) => ({
        id: p.id,
        nome: p.nome,
        isMonetized: (revCounts.get(p.id) ?? 0) >= 3,
      }));

      setPages(list);
      // Default to first monetized page, or first page
      const first = list.find((p) => p.isMonetized) ?? list[0];
      if (first) setSelectedPageId(first.id);
    }
    loadPages();
  }, []);

  const buildRows = useCallback(
    (
      days: string[],
      postsByDay: Record<string, number>,
      viewsByDay: Record<string, number>,
      dbEntries: Record<string, { id: string; actual_revenue_usd: number | null; actual_views: number | null; actual_followers: number | null; distribution_mode: string; note: string | null }>
    ): DayEntry[] => {
      return days.map((date) => {
        const d = new Date(date + "T00:00:00");
        const db = dbEntries[date];
        return {
          date,
          label: `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`,
          weekday: WEEKDAYS_SHORT[d.getDay()],
          posts_revenue: postsByDay[date] ?? 0,
          views: viewsByDay[date] ?? 0,
          actual_views: db?.actual_views ?? null,
          actual_followers: db?.actual_followers ?? null,
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

  const load = useCallback(async (ref: string, pageId: string) => {
    if (!pageId) return;
    setLoading(true);
    const days = daysInMonth(ref);
    const from = days[0];
    const to = days[days.length - 1];

    const [{ data: postsData }, { data: dbData }] = await Promise.all([
      supabase
        .from("posts")
        .select("published_at, monetization_approx, views")
        .eq("page_id", pageId)
        .gte("published_at", from)
        .lte("published_at", to + "T23:59:59"),
      (supabase as any)
        .from("daily_revenue_entries")
        .select("id, entry_date, actual_revenue_usd, actual_views, actual_followers, distribution_mode, note")
        .eq("page_id", pageId)
        .gte("entry_date", from)
        .lte("entry_date", to),
    ]);

    const postsByDay: Record<string, number> = {};
    const viewsByDay: Record<string, number> = {};
    for (const p of (postsData ?? []) as any[]) {
      if (!p.published_at) continue;
      const day = p.published_at.slice(0, 10);
      postsByDay[day] = (postsByDay[day] ?? 0) + Number(p.monetization_approx ?? 0);
      viewsByDay[day] = (viewsByDay[day] ?? 0) + Number(p.views ?? 0);
    }

    const dbEntries: Record<string, any> = {};
    for (const e of (dbData ?? []) as any[]) dbEntries[e.entry_date] = e;

    setRows(buildRows(days, postsByDay, viewsByDay, dbEntries));
    setLoading(false);
  }, [buildRows]);

  const loadDist = useCallback(async (ref: string, pageId: string) => {
    if (!pageId) return;
    setDistLoading(true);
    const prev = prevMonth(ref);
    const dist = await fetchViewsByColabForMonth(prev, pageId);
    setColabDist(dist);
    setDistLoading(false);
  }, []);

  useEffect(() => {
    if (!selectedPageId) return;
    load(monthRef, selectedPageId);
    loadDist(monthRef, selectedPageId);
  }, [monthRef, selectedPageId, load, loadDist]);

  const updateRow = (date: string, field: keyof DayEntry, value: unknown) => {
    setRows((prev) =>
      prev.map((r) => r.date === date ? { ...r, [field]: value, dirty: true, saved: false } : r)
    );
  };

  const saveRow = async (row: DayEntry) => {
    if (!selectedPageId) return;
    setRows((prev) => prev.map((r) => r.date === row.date ? { ...r, saving: true } : r));
    const payload = {
      entry_date: row.date,
      page_id: selectedPageId,
      actual_revenue_usd: row.actual_revenue,
      actual_views: row.actual_views,
      actual_followers: row.actual_followers,
      distribution_mode: row.distribution_mode,
      note: row.note.trim() || null,
      updated_at: new Date().toISOString(),
      created_by: profile?.id ?? null,
    };
    const { data, error } = await (supabase as any)
      .from("daily_revenue_entries")
      .upsert(payload, { onConflict: "entry_date,page_id" })
      .select("id")
      .single();
    if (!error && data) setRows((prev) => prev.map((r) => r.date === row.date ? { ...r, id: data.id } : r));
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

  const handleViewsChange = (row: DayEntry, raw: string) => {
    const digits = raw.replace(/\D/g, "");
    const val = digits === "" ? null : parseInt(digits, 10);
    updateRow(row.date, "actual_views", val);
    clearTimeout(saveTimers.current[row.date + "_views"]);
    saveTimers.current[row.date + "_views"] = setTimeout(() => {
      setRows((prev) => {
        const updated = prev.find((r) => r.date === row.date);
        if (updated) saveRow(updated);
        return prev;
      });
    }, 800);
  };

  const handleFollowersChange = (row: DayEntry, raw: string) => {
    const digits = raw.replace(/\D/g, "");
    const val = digits === "" ? null : parseInt(digits, 10);
    updateRow(row.date, "actual_followers", val);
    clearTimeout(saveTimers.current[row.date + "_followers"]);
    saveTimers.current[row.date + "_followers"] = setTimeout(() => {
      setRows((prev) => {
        const updated = prev.find((r) => r.date === row.date);
        if (updated) saveRow(updated);
        return prev;
      });
    }, 800);
  };

  const handleFollowersKeyDown = (e: React.KeyboardEvent<HTMLInputElement>, date: string) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const inputs = Array.from(document.querySelectorAll<HTMLInputElement>("[data-followers-input]"))
        .filter((el) => el.offsetParent !== null);
      const idx = inputs.findIndex((el) => el.dataset.followersInput === date);
      if (idx >= 0 && idx < inputs.length - 1) inputs[idx + 1].focus();
    }
  };

  const handleViewsKeyDown = (e: React.KeyboardEvent<HTMLInputElement>, date: string) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const inputs = Array.from(document.querySelectorAll<HTMLInputElement>("[data-views-input]"))
        .filter((el) => el.offsetParent !== null);
      const idx = inputs.findIndex((el) => el.dataset.viewsInput === date);
      if (idx >= 0 && idx < inputs.length - 1) inputs[idx + 1].focus();
    }
  };

  const handleFieldBlur = guard((row: DayEntry) => { if (row.dirty) saveRow(row); });

  const totalPosts = rows.reduce((s, r) => s + r.posts_revenue, 0);
  const totalActual = rows.reduce((s, r) => s + (r.actual_revenue ?? 0), 0);
  const totalBonus = totalActual - totalPosts;
  const totalViews = rows.reduce((s, r) => s + (r.actual_views ?? r.views), 0);
  const filledDays = rows.filter((r) => r.actual_revenue != null).length;

  const fmtViews = (n: number) => n.toLocaleString("pt-BR");

  const distWithBonus: ColabDist[] = useMemo(() => {
    if (totalBonus <= 0) return colabDist.map((c) => ({ ...c, bonus_estimated: 0 }));
    return colabDist.map((c) => ({ ...c, bonus_estimated: totalBonus * c.pct }));
  }, [colabDist, totalBonus]);

  const prevMonthRef = prevMonth(monthRef);
  const selectedPage = pages.find((p) => p.id === selectedPageId);

  return (
    <div className="space-y-6">
      <WriteGuardDialog />
      <PageHeader
        title="Histórico"
        description="Views reais e receita dia a dia. Compare o que o Facebook pagou vs o que os posts geraram."
      />

      {/* Page + Month selectors */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Page selector */}
        {pages.length > 0 && (
          <PageSelect pages={pages} value={selectedPageId} onChange={setSelectedPageId} />
        )}

        {/* Month navigation */}
        <div className="flex items-center gap-2 flex-1 min-w-[220px]">
          <button onClick={() => setMonthRef(prevMonth(monthRef))} className="p-2.5 rounded-lg border border-border hover:bg-muted transition-colors">
            <ChevronLeft className="h-5 w-5" />
          </button>
          <div className="flex-1 flex items-center gap-2">
            <input
              type="month"
              value={monthRef}
              onChange={(e) => e.target.value && setMonthRef(e.target.value)}
              className="flex-1 h-10 rounded-xl border border-border bg-background px-3 text-sm font-medium"
            />
            <span className="hidden sm:block text-sm font-semibold text-muted-foreground whitespace-nowrap">{formatMonth(monthRef)}</span>
          </div>
          <button onClick={() => setMonthRef(nextMonth(monthRef))} className="p-2.5 rounded-lg border border-border hover:bg-muted transition-colors" disabled={monthRef >= todayMonth}>
            <ChevronRight className="h-5 w-5" />
          </button>
        </div>
      </div>

      {/* No page selected */}
      {!selectedPageId && (
        <div className="border border-border rounded-xl p-8 text-center text-muted-foreground text-sm">
          Selecione uma página acima para ver e registrar os ganhos.
        </div>
      )}

      {selectedPageId && (
        <>
          {/* KPIs */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            <div className="bg-card border border-border rounded-lg p-4">
              <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">Views reais</p>
              <p className="text-xl font-bold mt-1 text-[#F44708]">{fmtViews(totalViews)}</p>
              <p className="text-xs text-muted-foreground mt-0.5">no mês</p>
            </div>
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
              <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">Diferença (USD)</p>
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
            <div className="px-4 sm:px-5 py-4 border-b border-border flex items-center justify-between gap-3">
              <div>
                <h2 className="font-semibold">
                  Receita dia a dia — {formatMonth(monthRef)}
                </h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {selectedPage && (
                    <span className="inline-flex items-center gap-1">
                      <Coins className={`h-3 w-3 ${selectedPage.isMonetized ? "text-emerald-500" : "text-red-400"}`} />
                      {selectedPage.nome}
                      {" · "}
                    </span>
                  )}
                  {canWrite ? "Digite o valor real do Facebook em cada dia. Salvo automaticamente." : "Somente leitura — seu perfil não tem permissão para editar."}
                </p>
              </div>
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
                        {/* Views CSV read-only row */}
                        {row.views > 0 && (
                          <div className="flex items-center justify-between text-xs text-muted-foreground">
                            <span className="font-semibold uppercase tracking-wider">Views CSV</span>
                            <span className="tabular-nums">{fmtViews(row.views)}</span>
                          </div>
                        )}
                        {/* Inputs grid: 2 cols on mobile */}
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <p className="text-[10px] uppercase tracking-wider text-[#F44708] font-semibold mb-1">Views manuais</p>
                            <input
                              type="text" inputMode="numeric" disabled={isFuture || !canWrite}
                              data-views-input={row.date}
                              placeholder="0"
                              value={viewsFocusDate === row.date
                                ? (row.actual_views ?? "")
                                : (row.actual_views != null ? row.actual_views.toLocaleString("pt-BR") : "")}
                              onFocus={() => setViewsFocusDate(row.date)}
                              onBlur={() => { setViewsFocusDate(null); handleFieldBlur(row); }}
                              onChange={(e) => handleViewsChange(row, e.target.value)}
                              onKeyDown={(e) => handleViewsKeyDown(e, row.date)}
                              className="w-full h-10 rounded-lg border border-input bg-background px-3 text-right text-sm tabular-nums text-[#F44708] focus:outline-none focus:ring-2 focus:ring-[#F44708]/40 disabled:opacity-30"
                            />
                          </div>
                          <div>
                            <p className="text-[10px] uppercase tracking-wider text-emerald-600 font-semibold mb-1">Seguidores</p>
                            <input
                              type="text" inputMode="numeric" disabled={isFuture || !canWrite}
                              data-followers-input={row.date}
                              placeholder="0"
                              value={followersFocusDate === row.date
                                ? (row.actual_followers ?? "")
                                : (row.actual_followers != null ? row.actual_followers.toLocaleString("pt-BR") : "")}
                              onFocus={() => setFollowersFocusDate(row.date)}
                              onBlur={() => { setFollowersFocusDate(null); handleFieldBlur(row); }}
                              onChange={(e) => handleFollowersChange(row, e.target.value)}
                              onKeyDown={(e) => handleFollowersKeyDown(e, row.date)}
                              className="w-full h-10 rounded-lg border border-input bg-background px-3 text-right text-sm tabular-nums text-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-500/40 disabled:opacity-30"
                            />
                          </div>
                          <div className="col-span-2">
                            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">Real recebido (USD)</p>
                            <input
                              type="number" min="0" step="0.01" disabled={isFuture || !canWrite}
                              placeholder="0.00"
                              value={row.actual_revenue ?? ""}
                              onChange={(e) => handleActualChange(row, e.target.value)}
                              onBlur={() => handleFieldBlur(row)}
                              className="w-full h-10 rounded-lg border border-input bg-background px-3 text-right text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-30"
                            />
                          </div>
                        </div>
                        {bonus != null && (
                          <div className="flex items-center justify-between text-xs">
                            <span className="font-semibold uppercase tracking-wider text-muted-foreground">Bônus</span>
                            <div className="text-right">
                              <p className={`text-sm font-semibold tabular-nums ${bonus > 0 ? "text-[#16a34a]" : bonus < 0 ? "text-destructive" : "text-muted-foreground"}`}>
                                {bonus > 0 ? "+" : ""}{bonus === 0 ? "$0.00" : `$${bonus.toFixed(2)}`}
                              </p>
                            </div>
                          </div>
                        )}
                        {row.actual_revenue != null && (
                          <input
                            type="text" disabled={isFuture || !canWrite}
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
                      <p>${totalActual.toFixed(2)}</p>
                      <p className="text-xs text-muted-foreground font-normal">posts: ${totalPosts.toFixed(2)}</p>
                    </div>
                  </div>
                </div>

                {/* Desktop: full table */}
                <div className="hidden sm:block overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
                      <tr>
                        <th className="text-left px-4 py-3 font-medium w-24">Dia</th>
                        <th className="text-right px-4 py-3 font-medium">Views CSV</th>
                        <th className="text-right px-4 py-3 font-medium text-[#F44708]">Views manuais</th>
                        <th className="text-right px-4 py-3 font-medium text-emerald-600">Seguidores</th>
                        <th className="text-right px-4 py-3 font-medium">Posts (USD)</th>
                        <th className="text-right px-4 py-3 font-medium">Real recebido (USD)</th>
                        <th className="w-8 px-4 py-3" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {rows.map((row) => {
                        const isWeekend = row.weekday === "Sáb" || row.weekday === "Dom";
                        const isFuture = row.date > new Date().toISOString().slice(0, 10);
                        return (
                          <tr key={row.date} className={`hover:bg-muted/20 ${isWeekend ? "bg-muted/10" : ""} ${isFuture ? "opacity-40" : ""}`}>
                            <td className="px-4 py-2.5">
                              <span className="font-semibold tabular-nums">{row.label}</span>
                              <span className="text-[10px] text-muted-foreground ml-1.5">{row.weekday}</span>
                            </td>
                            <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">
                              {row.views > 0 ? fmtViews(row.views) : <span className="text-muted-foreground/40">—</span>}
                            </td>
                            <td className="px-4 py-2.5 text-right">
                              <input
                                type="text" inputMode="numeric" disabled={isFuture || !canWrite}
                                data-views-input={row.date}
                                placeholder="0"
                                value={viewsFocusDate === row.date
                                  ? (row.actual_views ?? "")
                                  : (row.actual_views != null ? row.actual_views.toLocaleString("pt-BR") : "")}
                                onFocus={() => setViewsFocusDate(row.date)}
                                onBlur={() => { setViewsFocusDate(null); handleFieldBlur(row); }}
                                onChange={(e) => handleViewsChange(row, e.target.value)}
                                onKeyDown={(e) => handleViewsKeyDown(e, row.date)}
                                className="w-32 h-7 rounded border border-input bg-background px-2 text-right text-sm tabular-nums text-[#F44708] focus:outline-none focus:ring-1 focus:ring-[#F44708]/40 disabled:opacity-30"
                              />
                            </td>
                            <td className="px-4 py-2.5 text-right">
                              <input
                                type="text" inputMode="numeric" disabled={isFuture || !canWrite}
                                data-followers-input={row.date}
                                placeholder="0"
                                value={followersFocusDate === row.date
                                  ? (row.actual_followers ?? "")
                                  : (row.actual_followers != null ? row.actual_followers.toLocaleString("pt-BR") : "")}
                                onFocus={() => setFollowersFocusDate(row.date)}
                                onBlur={() => { setFollowersFocusDate(null); handleFieldBlur(row); }}
                                onChange={(e) => handleFollowersChange(row, e.target.value)}
                                onKeyDown={(e) => handleFollowersKeyDown(e, row.date)}
                                className="w-24 h-7 rounded border border-input bg-background px-2 text-right text-sm tabular-nums text-emerald-600 focus:outline-none focus:ring-1 focus:ring-emerald-500/40 disabled:opacity-30"
                              />
                            </td>
                            <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">
                              {row.posts_revenue > 0 ? `$${row.posts_revenue.toFixed(2)}` : <span className="text-muted-foreground/40">—</span>}
                            </td>
                            <td className="px-4 py-2.5 text-right">
                              <input
                                type="number" min="0" step="0.01" disabled={isFuture || !canWrite}
                                placeholder="0.00"
                                value={row.actual_revenue ?? ""}
                                onChange={(e) => handleActualChange(row, e.target.value)}
                                onBlur={() => handleFieldBlur(row)}
                                className="w-28 h-7 rounded border border-input bg-background px-2 text-right text-sm tabular-nums focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-30"
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
                        <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                          {(() => { const t = rows.reduce((s, r) => s + r.views, 0); return t > 0 ? fmtViews(t) : "—"; })()}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums text-[#F44708]">
                          {(() => { const t = rows.reduce((s, r) => s + (r.actual_views ?? 0), 0); return t > 0 ? fmtViews(t) : "—"; })()}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums text-emerald-600">
                          {(() => { const t = rows.reduce((s, r) => s + (r.actual_followers ?? 0), 0); return t > 0 ? t.toLocaleString("pt-BR") : "—"; })()}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">${totalPosts.toFixed(2)}</td>
                        <td className="px-4 py-3 text-right tabular-nums">${totalActual.toFixed(2)}</td>
                        <td />
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
                  Baseado nas views de <strong>{formatMonth(prevMonthRef)}</strong> em <strong>{selectedPage?.nome}</strong> — quem fez mais views recebe maior fatia do bônus de {formatMonth(monthRef)}.
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
                Sem dados de views em {formatMonth(prevMonthRef)} para {selectedPage?.nome}. Importe o CSV desse mês para calcular a distribuição.
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
                          {c.views.toLocaleString("pt-BR")} views
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
                            {c.views.toLocaleString("pt-BR")}
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
                          {distWithBonus.reduce((s, c) => s + c.views, 0).toLocaleString("pt-BR")}
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
        </>
      )}

      <p className="text-xs text-muted-foreground text-center">
        Dados salvos automaticamente por página. Dias futuros são bloqueados. Finais de semana em destaque.
      </p>
    </div>
  );
}
