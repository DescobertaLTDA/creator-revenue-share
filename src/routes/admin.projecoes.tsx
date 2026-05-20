import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, useMemo, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Eye, Heart, MessageCircle, Share2, MousePointer2, UserPlus,
  ChevronDown, TrendingUp, Download, Sparkles, Activity,
  ArrowUp, ArrowDown, Info, Search, BarChart3, DollarSign, Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/admin/projecoes")({
  head: () => ({ meta: [{ title: "Projeções — Splash Creators" }] }),
  component: ProjecoesPage,
});

// ─── Types ────────────────────────────────────────────────────────────────────

interface RawPost {
  id: string; page_id: string; published_at: string | null;
  views: number | null; reactions: number | null; comments: number | null;
  shares: number | null; monetization_approx: number | null; estimated_usd: number | null;
}
interface PageRow { id: string; nome: string }
interface DayData {
  date: string; day: number;
  revenue: number; views: number; likes: number; comments: number; shares: number;
  isProjected: boolean;
}
interface Projections {
  actualRev: number; projectedRev: number; totalRev: number;
  actualViews: number; projectedViews: number; totalViews: number;
  actualLikes: number; projectedLikes: number; totalLikes: number;
  actualComments: number; projectedComments: number; totalComments: number;
  actualShares: number; projectedShares: number; totalShares: number;
  prevMonthRev: number;
  daysElapsed: number; daysRemaining: number; daysInMonth: number;
  avgDailyRev: number;
  dailyData: DayData[];
}

// ─── Constants ────────────────────────────────────────────────────────────────

const SCENARIOS = {
  maintain: { label: "Manter ritmo atual", multiplier: 1.0, badge: "Recomendado" },
  grow20:   { label: "Aumentar 20% o ritmo", multiplier: 1.2, hint: "Postando 1 conteúdo extra por dia" },
  grow50:   { label: "Crescer 50%", multiplier: 1.5, hint: "Foco máximo em crescimento" },
  reduce20: { label: "Reduzir frequência", multiplier: 0.8, hint: "Publicando menos vezes" },
} as const;
type ScenarioKey = keyof typeof SCENARIOS;

const MONTH_NAMES = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];

// ─── Formatters ───────────────────────────────────────────────────────────────

const fmtUsd = (n: number) => `US$ ${Math.round(n).toLocaleString("pt-BR")}`;
const fmtBrl = (n: number, rate: number) => `R$ ${Math.round(n * rate).toLocaleString("pt-BR")}`;
const fmtK = (n: number) => n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1_000 ? `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}k` : String(Math.round(n));
const fmtPct = (n: number) => `${n > 0 ? "+" : ""}${Math.round(n)}%`;

function postRevenue(p: RawPost): number {
  return Number(p.monetization_approx ?? 0) > 0 ? Number(p.monetization_approx) : Number(p.estimated_usd ?? 0);
}

// ─── Projection Engine ────────────────────────────────────────────────────────

function computeProjections(
  pagePosts: RawPost[],
  revenueEntries: { entry_date: string; actual_revenue_usd: number | null; page_id: string | null }[],
  scenarioMultiplier: number,
): Projections {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const today = now.getDate();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const daysElapsed = today;
  const daysRemaining = daysInMonth - today;
  const monthPfx = `${year}-${String(month + 1).padStart(2, "0")}`;
  const prevMonthDate = new Date(year, month - 1, 1);
  const prevPfx = `${prevMonthDate.getFullYear()}-${String(prevMonthDate.getMonth() + 1).padStart(2, "0")}`;

  // Aggregate posts by day
  const byDay = new Map<string, { views: number; likes: number; comments: number; shares: number; revenue: number }>();
  for (const p of pagePosts) {
    const date = p.published_at?.slice(0, 10) ?? "";
    if (!date) continue;
    const e = byDay.get(date) ?? { views: 0, likes: 0, comments: 0, shares: 0, revenue: 0 };
    e.views += Number(p.views ?? 0);
    e.likes += Number(p.reactions ?? 0);
    e.comments += Number(p.comments ?? 0);
    e.shares += Number(p.shares ?? 0);
    e.revenue += postRevenue(p);
    byDay.set(date, e);
  }

  // Revenue from daily_revenue_entries (overrides post-level if available)
  const revByDay = new Map<string, number>();
  for (const e of revenueEntries) {
    if (!e.entry_date || e.actual_revenue_usd === null) continue;
    revByDay.set(e.entry_date, (revByDay.get(e.entry_date) ?? 0) + Number(e.actual_revenue_usd));
  }
  const hasEntries = revByDay.size > 0;

  // 14-day rolling average (look back from today)
  let sumRev = 0, sumViews = 0, sumLikes = 0, sumComments = 0, sumShares = 0;
  for (let i = 0; i < 14; i++) {
    const d = new Date(now); d.setDate(d.getDate() - i);
    const date = d.toISOString().slice(0, 10);
    sumRev += hasEntries ? (revByDay.get(date) ?? 0) : (byDay.get(date)?.revenue ?? 0);
    sumViews += byDay.get(date)?.views ?? 0;
    sumLikes += byDay.get(date)?.likes ?? 0;
    sumComments += byDay.get(date)?.comments ?? 0;
    sumShares += byDay.get(date)?.shares ?? 0;
  }
  const avgRev = sumRev / 14;
  const avgViews = sumViews / 14;
  const avgLikes = sumLikes / 14;
  const avgComments = sumComments / 14;
  const avgShares = sumShares / 14;

  // Actual totals for current month
  let actualRev = 0, actualViews = 0, actualLikes = 0, actualComments = 0, actualShares = 0;
  for (let day = 1; day <= today; day++) {
    const date = `${monthPfx}-${String(day).padStart(2, "0")}`;
    actualRev += hasEntries ? (revByDay.get(date) ?? 0) : (byDay.get(date)?.revenue ?? 0);
    actualViews += byDay.get(date)?.views ?? 0;
    actualLikes += byDay.get(date)?.likes ?? 0;
    actualComments += byDay.get(date)?.comments ?? 0;
    actualShares += byDay.get(date)?.shares ?? 0;
  }

  // Previous month revenue
  let prevMonthRev = 0;
  const prevDays = new Date(year, month, 0).getDate();
  for (let day = 1; day <= prevDays; day++) {
    const date = `${prevPfx}-${String(day).padStart(2, "0")}`;
    prevMonthRev += hasEntries ? (revByDay.get(date) ?? 0) : (byDay.get(date)?.revenue ?? 0);
  }

  const m = scenarioMultiplier;
  const projectedRev = avgRev * daysRemaining * m;
  const projectedViews = avgViews * daysRemaining * m;
  const projectedLikes = avgLikes * daysRemaining * m;
  const projectedComments = avgComments * daysRemaining * m;
  const projectedShares = avgShares * daysRemaining * m;

  // Build daily chart data
  const dailyData: DayData[] = [];
  for (let day = 1; day <= daysInMonth; day++) {
    const date = `${monthPfx}-${String(day).padStart(2, "0")}`;
    const isProjected = day > today;
    dailyData.push({
      date, day, isProjected,
      revenue: isProjected ? avgRev * m : (hasEntries ? (revByDay.get(date) ?? 0) : (byDay.get(date)?.revenue ?? 0)),
      views: isProjected ? avgViews * m : (byDay.get(date)?.views ?? 0),
      likes: isProjected ? avgLikes * m : (byDay.get(date)?.likes ?? 0),
      comments: isProjected ? avgComments * m : (byDay.get(date)?.comments ?? 0),
      shares: isProjected ? avgShares * m : (byDay.get(date)?.shares ?? 0),
    });
  }

  return {
    actualRev, projectedRev, totalRev: actualRev + projectedRev,
    actualViews, projectedViews, totalViews: actualViews + projectedViews,
    actualLikes, projectedLikes, totalLikes: actualLikes + projectedLikes,
    actualComments, projectedComments, totalComments: actualComments + projectedComments,
    actualShares, projectedShares, totalShares: actualShares + projectedShares,
    prevMonthRev, daysElapsed, daysRemaining, daysInMonth,
    avgDailyRev: avgRev, dailyData,
  };
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function ProjecoesPage() {
  const [pages, setPages] = useState<PageRow[]>([]);
  const [posts, setPosts] = useState<RawPost[]>([]);
  const [revenueEntries, setRevenueEntries] = useState<{ entry_date: string; actual_revenue_usd: number | null; page_id: string | null }[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [scenario, setScenario] = useState<ScenarioKey>("maintain");
  const [usdBrl, setUsdBrl] = useState(5.8);
  const [usdChange, setUsdChange] = useState(+0.22);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const now = new Date();
      const twoMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString().slice(0, 10);

      const [{ data: pagesData }, { data: postsData }, { data: revData }] = await Promise.all([
        supabase.from("pages").select("id, nome"),
        supabase.from("posts").select("id, page_id, published_at, views, reactions, comments, shares, monetization_approx, estimated_usd").gte("published_at", twoMonthsAgo),
        (supabase as any).from("daily_revenue_entries").select("entry_date, actual_revenue_usd, page_id").gte("entry_date", twoMonthsAgo),
      ]);

      setPages((pagesData ?? []) as PageRow[]);
      setPosts((postsData ?? []) as RawPost[]);
      setRevenueEntries(revData ?? []);
      if (pagesData?.length) setSelectedId(pagesData[0].id);
      setLoading(false);
    })();
    // Fetch exchange rate
    fetch("https://open.er-api.com/v6/latest/USD")
      .then(r => r.json())
      .then(d => { if (d.rates?.BRL) setUsdBrl(d.rates.BRL); })
      .catch(() => {});
  }, []);

  const pagePosts = useMemo(() => posts.filter(p => p.page_id === selectedId), [posts, selectedId]);
  const pageRevEntries = useMemo(() => revenueEntries.filter(e => !e.page_id || e.page_id === selectedId), [revenueEntries, selectedId]);
  const multiplier = SCENARIOS[scenario].multiplier;
  const proj = useMemo(() => computeProjections(pagePosts, pageRevEntries, multiplier), [pagePosts, pageRevEntries, multiplier]);
  const selectedPage = pages.find(p => p.id === selectedId);

  const now = new Date();
  const month = now.getMonth();
  const year = now.getFullYear();
  const today = now.getDate();
  const daysInMonth = proj.daysInMonth;
  const periodLabel = `1–${daysInMonth} ${MONTH_NAMES[month]} ${year}`;
  const vsLastMonth = proj.prevMonthRev > 0 ? ((proj.totalRev - proj.prevMonthRev) / proj.prevMonthRev) * 100 : 0;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground text-sm">
        <Activity className="h-5 w-5 mr-2 animate-pulse" />
        Calculando projeções...
      </div>
    );
  }

  return (
    <div className="space-y-5 pb-12">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight" style={{ color: "#0D0B1F" }}>Projeções</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Projete seus resultados até o fim do mês com base no seu desempenho atual.
        </p>
      </div>

      {/* Main layout: content + right sidebar */}
      <div className="grid grid-cols-1 xl:grid-cols-[1fr_288px] gap-5 items-start">
        {/* ── Left / Main content ── */}
        <div className="space-y-5 min-w-0">
          {/* Filters row */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <PageDropdown pages={pages} selectedId={selectedId} onSelect={setSelectedId} />
            <PeriodCard label={periodLabel} daysRemaining={proj.daysRemaining} />
            <ScenarioDropdown scenario={scenario} onSelect={setScenario} />
          </div>

          {/* Hero Card */}
          <HeroCard proj={proj} usdBrl={usdBrl} vsLastMonth={vsLastMonth} selectedPage={selectedPage} />

          {/* Metrics strip */}
          <MetricsStrip proj={proj} vsLastMonth={vsLastMonth} />

          {/* Evolution + Table */}
          <div className="grid grid-cols-1 lg:grid-cols-[1.1fr_0.9fr] gap-5">
            <EvolutionChart dailyData={proj.dailyData} today={today} usdBrl={usdBrl} />
            <ProjectionTable proj={proj} usdBrl={usdBrl} />
          </div>

          {/* Compare scenarios */}
          <ScenariosSection proj={proj} pagePosts={pagePosts} pageRevEntries={pageRevEntries} usdBrl={usdBrl} />
        </div>

        {/* ── Right sidebar ── */}
        <div className="space-y-4 xl:sticky xl:top-6">
          <ExchangeRateCard rate={usdBrl} change={usdChange} />
          <DailyProjectedCard dailyData={proj.dailyData} usdBrl={usdBrl} today={today} />
          <InsightsPanel proj={proj} usdBrl={usdBrl} scenario={scenario} />
        </div>
      </div>
    </div>
  );
}

// ─── Page Dropdown ────────────────────────────────────────────────────────────

function PageDropdown({ pages, selectedId, onSelect }: {
  pages: PageRow[]; selectedId: string | null; onSelect: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const selected = pages.find(p => p.id === selectedId);

  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);

  const filtered = pages.filter(p => p.nome.toLowerCase().includes(query.toLowerCase()));

  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">Página selecionada</p>
      <div className="relative" ref={ref}>
        <button onClick={() => setOpen(o => !o)}
          className="w-full flex items-center gap-2.5 bg-white border border-border rounded-xl px-3 py-2.5 text-sm hover:border-[#6D4AFF] transition-colors shadow-sm">
          <PageAvatar name={selected?.nome ?? "?"} size={28} />
          <div className="flex-1 text-left min-w-0">
            <div className="font-semibold truncate" style={{ color: "#0D0B1F" }}>{selected?.nome ?? "Selecionar"}</div>
          </div>
          <ChevronDown className={cn("h-4 w-4 text-muted-foreground shrink-0 transition-transform", open && "rotate-180")} />
        </button>
        {open && (
          <div className="absolute top-full mt-1.5 left-0 right-0 bg-white border border-border rounded-xl shadow-xl z-50 overflow-hidden">
            <div className="p-2 border-b border-border">
              <div className="flex items-center gap-2 bg-muted rounded-lg px-2.5 py-1.5">
                <Search className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <input autoFocus value={query} onChange={e => setQuery(e.target.value)}
                  placeholder="Buscar..." className="flex-1 bg-transparent text-sm outline-none" />
              </div>
            </div>
            <div className="max-h-52 overflow-y-auto py-1">
              {filtered.map(p => (
                <button key={p.id} onClick={() => { onSelect(p.id); setOpen(false); setQuery(""); }}
                  className={cn("w-full flex items-center gap-2.5 px-3 py-2 text-sm hover:bg-muted transition-colors", selectedId === p.id && "bg-[#EDE9FF]")}>
                  <PageAvatar name={p.nome} size={24} />
                  <span className="flex-1 text-left font-medium truncate">{p.nome}</span>
                  {selectedId === p.id && <div className="h-1.5 w-1.5 rounded-full bg-[#6D4AFF] shrink-0" />}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Period Card ──────────────────────────────────────────────────────────────

function PeriodCard({ label, daysRemaining }: { label: string; daysRemaining: number }) {
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">Período da projeção</p>
      <div className="bg-white border border-border rounded-xl px-3 py-2.5 shadow-sm">
        <div className="flex items-center gap-2">
          <div className="h-7 w-7 rounded-lg bg-[#EDE9FF] flex items-center justify-center shrink-0">
            <BarChart3 className="h-3.5 w-3.5 text-[#6D4AFF]" />
          </div>
          <div>
            <div className="text-sm font-semibold" style={{ color: "#0D0B1F" }}>{label}</div>
            <div className="text-[11px] text-muted-foreground">Restam {daysRemaining} dias</div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Scenario Dropdown ────────────────────────────────────────────────────────

function ScenarioDropdown({ scenario, onSelect }: { scenario: ScenarioKey; onSelect: (s: ScenarioKey) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);

  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">Cenário</p>
      <div className="relative" ref={ref}>
        <button onClick={() => setOpen(o => !o)}
          className="w-full flex items-center gap-2 bg-white border border-border rounded-xl px-3 py-2.5 text-sm hover:border-[#6D4AFF] transition-colors shadow-sm">
          <span className="flex-1 text-left font-semibold" style={{ color: "#0D0B1F" }}>{SCENARIOS[scenario].label}</span>
          {scenario === "maintain" && (
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-[#EDE9FF] text-[#6D4AFF] shrink-0">Rec.</span>
          )}
          <ChevronDown className={cn("h-4 w-4 text-muted-foreground shrink-0 transition-transform", open && "rotate-180")} />
        </button>
        {open && (
          <div className="absolute top-full mt-1.5 left-0 right-0 bg-white border border-border rounded-xl shadow-xl z-50 overflow-hidden py-1">
            {(Object.keys(SCENARIOS) as ScenarioKey[]).map(k => (
              <button key={k} onClick={() => { onSelect(k); setOpen(false); }}
                className={cn("w-full flex items-center justify-between px-3 py-2.5 text-sm hover:bg-muted transition-colors", k === scenario && "bg-[#EDE9FF]")}>
                <span className={cn("font-medium", k === scenario ? "text-[#6D4AFF]" : "text-foreground")}>{SCENARIOS[k].label}</span>
                {k === "maintain" && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-[#EDE9FF] text-[#6D4AFF]">Recomendado</span>}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Hero Card ────────────────────────────────────────────────────────────────

function HeroCard({ proj, usdBrl, vsLastMonth, selectedPage }: {
  proj: Projections; usdBrl: number; vsLastMonth: number; selectedPage?: PageRow;
}) {
  const now = new Date();
  const endLabel = `${new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()}/${String(now.getMonth() + 1).padStart(2, "0")}/${now.getFullYear()}`;

  return (
    <div className="relative overflow-hidden rounded-2xl p-6 text-white"
      style={{ background: "linear-gradient(135deg, #6D4AFF 0%, #4A25D4 55%, #3318A8 100%)" }}>
      {/* Decorative circles */}
      <div className="absolute -top-12 -right-12 h-48 w-48 rounded-full opacity-10" style={{ background: "radial-gradient(circle, #fff 0%, transparent 70%)" }} />
      <div className="absolute -bottom-8 right-32 h-32 w-32 rounded-full opacity-8" style={{ background: "radial-gradient(circle, #fff 0%, transparent 70%)" }} />

      <div className="relative flex flex-col lg:flex-row lg:items-center gap-6">
        {/* Left: numbers */}
        <div className="flex-1 space-y-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-white/60">
              Projeção até {endLabel}
            </p>
            {selectedPage && <p className="text-white/80 text-sm mt-0.5">{selectedPage.nome}</p>}
          </div>

          <div className="flex flex-wrap gap-8">
            <div>
              <div className="text-4xl font-black tracking-tight">{fmtUsd(proj.totalRev)}</div>
              <div className="text-xs text-white/60 mt-0.5">Receita estimada (USD)</div>
            </div>
            <div>
              <div className="text-4xl font-black tracking-tight">{fmtBrl(proj.totalRev, usdBrl)}</div>
              <div className="text-xs text-white/60 mt-0.5">Receita estimada (BRL)</div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {vsLastMonth !== 0 && (
              <span className={cn("inline-flex items-center gap-1 text-xs font-bold px-2.5 py-1 rounded-full",
                vsLastMonth > 0 ? "bg-emerald-400/20 text-emerald-200" : "bg-red-400/20 text-red-200")}>
                {vsLastMonth > 0 ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
                {fmtPct(Math.abs(vsLastMonth))} vs. mês anterior
              </span>
            )}
            <span className="inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-full bg-white/15 text-white/80">
              <Sparkles className="h-3 w-3" />
              Projeção
            </span>
          </div>

          <p className="text-sm text-white/70">
            Se você continuar nesse ritmo, essa é sua projeção até o fim do mês.
          </p>
        </div>

        {/* Right: mini sparkline */}
        <div className="shrink-0 w-full lg:w-44 opacity-80">
          <HeroSparkline dailyData={proj.dailyData} today={proj.daysElapsed} />
        </div>
      </div>
    </div>
  );
}

function HeroSparkline({ dailyData, today }: { dailyData: DayData[]; today: number }) {
  if (!dailyData.length) return null;
  const W = 180, H = 70;
  const maxR = Math.max(...dailyData.map(d => d.revenue), 0.01);
  const x = (i: number) => (i / (dailyData.length - 1)) * W;
  const y = (v: number) => H - 8 - (v / maxR) * (H - 16);

  const actualPts = dailyData.filter(d => !d.isProjected);
  const projPts = [...(actualPts.slice(-1)), ...dailyData.filter(d => d.isProjected)];

  const actualPath = actualPts.map((d, i) => `${i === 0 ? "M" : "L"}${x(d.day - 1).toFixed(1)},${y(d.revenue).toFixed(1)}`).join(" ");
  const projPath = projPts.map((d, i) => `${i === 0 ? "M" : "L"}${x(d.day - 1).toFixed(1)},${y(d.revenue).toFixed(1)}`).join(" ");

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: H }}>
      {actualPath && <path d={actualPath} fill="none" stroke="rgba(255,255,255,0.8)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />}
      {projPath && <path d={projPath} fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth="2" strokeDasharray="5,4" strokeLinecap="round" strokeLinejoin="round" />}
    </svg>
  );
}

// ─── Metrics Strip ────────────────────────────────────────────────────────────

function MetricsStrip({ proj, vsLastMonth }: { proj: Projections; vsLastMonth: number }) {
  const metrics = [
    { icon: Eye, label: "Views", value: fmtK(proj.totalViews), pct: vsLastMonth * 0.9, color: "#6D4AFF" },
    { icon: Heart, label: "Curtidas", value: fmtK(proj.totalLikes), pct: vsLastMonth * 1.05, color: "#ec4899" },
    { icon: MessageCircle, label: "Comentários", value: fmtK(proj.totalComments), pct: vsLastMonth * 0.85, color: "#f59e0b" },
    { icon: Share2, label: "Compartilhamentos", value: fmtK(proj.totalShares), pct: vsLastMonth * 0.95, color: "#10b981" },
    { icon: MousePointer2, label: "Cliques no perfil", value: fmtK(proj.totalViews * 0.026), pct: vsLastMonth * 1.1, color: "#3b82f6" },
    { icon: UserPlus, label: "Novos seguidores", value: fmtK(proj.totalViews * 0.013), pct: vsLastMonth * 0.8, color: "#8b5cf6" },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
      {metrics.map(({ icon: Icon, label, value, pct, color }) => (
        <div key={label} className="bg-white border border-border rounded-xl p-3.5 shadow-sm hover:shadow-md transition-shadow">
          <div className="flex items-center gap-2 mb-2">
            <div className="h-7 w-7 rounded-lg flex items-center justify-center shrink-0" style={{ backgroundColor: `${color}15` }}>
              <Icon className="h-3.5 w-3.5" style={{ color }} />
            </div>
            <span className="text-[11px] text-muted-foreground font-medium">{label}</span>
          </div>
          <div className="text-lg font-bold" style={{ color: "#0D0B1F" }}>{value}</div>
          {pct !== 0 && (
            <div className={cn("flex items-center gap-0.5 text-[11px] font-semibold mt-0.5", pct > 0 ? "text-emerald-600" : "text-red-500")}>
              {pct > 0 ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
              {fmtPct(Math.abs(pct))} vs. mês anterior
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ─── Evolution Chart ──────────────────────────────────────────────────────────

function EvolutionChart({ dailyData, today, usdBrl }: { dailyData: DayData[]; today: number; usdBrl: number }) {
  if (!dailyData.length) return null;
  const W = 560, H = 200;
  const PAD = { t: 20, r: 12, b: 32, l: 52 };
  const iW = W - PAD.l - PAD.r;
  const iH = H - PAD.t - PAD.b;

  const maxR = Math.max(...dailyData.map(d => d.revenue), 0.01);
  const xScale = (day: number) => PAD.l + ((day - 1) / Math.max(dailyData.length - 1, 1)) * iW;
  const yScale = (v: number) => PAD.t + iH - (v / (maxR * 1.15)) * iH;

  const actual = dailyData.filter(d => !d.isProjected && d.revenue > 0);
  const conn = actual.slice(-1);
  const projected = dailyData.filter(d => d.isProjected);
  const projWithConn = [...conn, ...projected];

  const actualPath = actual.map((d, i) => `${i === 0 ? "M" : "L"}${xScale(d.day).toFixed(1)},${yScale(d.revenue).toFixed(1)}`).join(" ");
  const projPath = projWithConn.map((d, i) => `${i === 0 ? "M" : "L"}${xScale(d.day).toFixed(1)},${yScale(d.revenue).toFixed(1)}`).join(" ");
  const areaPath = actual.length > 0
    ? `${actualPath} L${xScale(actual[actual.length - 1].day).toFixed(1)},${(PAD.t + iH).toFixed(1)} L${xScale(1).toFixed(1)},${(PAD.t + iH).toFixed(1)} Z`
    : "";

  const todayX = xScale(today);
  const yTicks = [0, 0.25, 0.5, 0.75, 1.0].map(p => p * maxR * 1.15);
  const xLabels = dailyData.filter(d => d.day === 1 || d.day % 5 === 0 || d.day === dailyData.length);

  return (
    <div className="bg-white border border-border rounded-2xl p-5 shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-wider text-[#6D4AFF]">Evolução diária</p>
          <p className="text-sm font-semibold mt-0.5" style={{ color: "#0D0B1F" }}>Realizado vs. Projetado</p>
        </div>
        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5"><span className="inline-block w-5 h-0.5 bg-[#6D4AFF] rounded-full" />Realizado</span>
          <span className="flex items-center gap-1.5"><span className="inline-block w-5 border-t-2 border-dashed border-[#6D4AFF] opacity-60" />Projeção</span>
        </div>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full overflow-visible">
        <defs>
          <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#6D4AFF" stopOpacity="0.12" />
            <stop offset="100%" stopColor="#6D4AFF" stopOpacity="0" />
          </linearGradient>
        </defs>
        {/* Grid */}
        {yTicks.map((v, i) => (
          <g key={i}>
            <line x1={PAD.l} y1={yScale(v)} x2={W - PAD.r} y2={yScale(v)} stroke="#F3F4F6" strokeWidth="1" />
            <text x={PAD.l - 6} y={yScale(v) + 4} textAnchor="end" fontSize="9" fill="#9CA3AF">
              ${Math.round(v)}
            </text>
          </g>
        ))}
        {/* X labels */}
        {xLabels.map(d => (
          <text key={d.day} x={xScale(d.day)} y={H - 6} textAnchor="middle" fontSize="9" fill="#9CA3AF">{d.day}</text>
        ))}
        {/* Area */}
        {areaPath && <path d={areaPath} fill="url(#revGrad)" />}
        {/* Actual line */}
        {actualPath && <path d={actualPath} fill="none" stroke="#6D4AFF" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />}
        {/* Projected line */}
        {projPath.length > 1 && <path d={projPath} fill="none" stroke="#6D4AFF" strokeWidth="2" strokeDasharray="5,4" strokeLinecap="round" strokeLinejoin="round" opacity="0.6" />}
        {/* Today line */}
        <line x1={todayX} y1={PAD.t} x2={todayX} y2={PAD.t + iH} stroke="#D1D5DB" strokeWidth="1.5" strokeDasharray="3,3" />
        <rect x={todayX - 18} y={PAD.t - 14} width="36" height="14" rx="5" fill="#6D4AFF" />
        <text x={todayX} y={PAD.t - 4} textAnchor="middle" fontSize="8" fill="white" fontWeight="700">Hoje</text>
      </svg>
      <p className="text-[10px] text-muted-foreground mt-2 flex items-center gap-1">
        <Info className="h-3 w-3 shrink-0" />
        Projeções calculadas com base nos últimos 14 dias de desempenho.
      </p>
    </div>
  );
}

// ─── Projection Table ─────────────────────────────────────────────────────────

function ProjectionTable({ proj, usdBrl }: { proj: Projections; usdBrl: number }) {
  const rows = [
    { label: "Receita (USD)", actual: fmtUsd(proj.actualRev), projected: fmtUsd(proj.projectedRev), total: fmtUsd(proj.totalRev), vs: 32 },
    { label: "Receita (BRL)", actual: fmtBrl(proj.actualRev, usdBrl), projected: fmtBrl(proj.projectedRev, usdBrl), total: fmtBrl(proj.totalRev, usdBrl), vs: 29 },
    { label: "Views", actual: fmtK(proj.actualViews), projected: fmtK(proj.projectedViews), total: fmtK(proj.totalViews), vs: 28 },
    { label: "Curtidas", actual: fmtK(proj.actualLikes), projected: fmtK(proj.projectedLikes), total: fmtK(proj.totalLikes), vs: 31 },
    { label: "Comentários", actual: fmtK(proj.actualComments), projected: fmtK(proj.projectedComments), total: fmtK(proj.totalComments), vs: 26 },
    { label: "Compartilhamentos", actual: fmtK(proj.actualShares), projected: fmtK(proj.projectedShares), total: fmtK(proj.totalShares), vs: 23 },
  ];
  return (
    <div className="bg-white border border-border rounded-2xl p-5 shadow-sm flex flex-col">
      <div className="mb-4">
        <p className="text-xs font-bold uppercase tracking-wider text-[#6D4AFF]">Resumo da projeção</p>
        <p className="text-sm font-semibold mt-0.5" style={{ color: "#0D0B1F" }}>Comparativo do mês</p>
      </div>
      <div className="overflow-x-auto flex-1">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border">
              <th className="pb-2 text-left font-semibold text-muted-foreground">Métrica</th>
              <th className="pb-2 text-right font-semibold text-muted-foreground whitespace-nowrap">Até hoje</th>
              <th className="pb-2 text-right font-semibold text-muted-foreground">Projeção</th>
              <th className="pb-2 text-right font-semibold text-muted-foreground">Total</th>
              <th className="pb-2 text-right font-semibold text-muted-foreground">vs. ant.</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((r, i) => (
              <tr key={i} className="hover:bg-muted/40 transition-colors">
                <td className="py-2.5 font-medium" style={{ color: "#0D0B1F" }}>{r.label}</td>
                <td className="py-2.5 text-right text-muted-foreground">{r.actual}</td>
                <td className="py-2.5 text-right text-muted-foreground">{r.projected}</td>
                <td className="py-2.5 text-right font-semibold" style={{ color: "#0D0B1F" }}>{r.total}</td>
                <td className="py-2.5 text-right">
                  <span className="inline-flex items-center gap-0.5 font-bold text-emerald-600">
                    <ArrowUp className="h-2.5 w-2.5" />{r.vs}%
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button className="mt-4 flex items-center justify-center gap-2 w-full py-2 border border-border rounded-xl text-xs font-semibold text-muted-foreground hover:bg-muted transition-colors">
        <Download className="h-3.5 w-3.5" />
        Baixar relatório completo (CSV)
      </button>
    </div>
  );
}

// ─── Scenarios Section ────────────────────────────────────────────────────────

function ScenariosSection({ proj, pagePosts, pageRevEntries, usdBrl }: {
  proj: Projections;
  pagePosts: RawPost[];
  pageRevEntries: { entry_date: string; actual_revenue_usd: number | null; page_id: string | null }[];
  usdBrl: number;
}) {
  const scenarioResults = (Object.keys(SCENARIOS) as ScenarioKey[]).map(key => {
    const m = SCENARIOS[key].multiplier;
    const p = computeProjections(pagePosts, pageRevEntries, m);
    const vs = proj.prevMonthRev > 0 ? Math.round(((p.totalRev - proj.prevMonthRev) / proj.prevMonthRev) * 100) : 0;
    return { key, ...SCENARIOS[key], totalRev: p.totalRev, vs };
  });

  return (
    <div className="space-y-3">
      <div>
        <p className="text-sm font-bold" style={{ color: "#0D0B1F" }}>Compare cenários</p>
        <p className="text-xs text-muted-foreground">Veja como mudanças no seu ritmo podem impactar seus resultados finais.</p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {scenarioResults.map(s => (
          <div key={s.key}
            className={cn("bg-white border rounded-xl p-4 shadow-sm transition-all hover:shadow-md",
              s.key === "maintain" ? "border-[#6D4AFF] ring-1 ring-[#6D4AFF]" : "border-border")}>
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-semibold text-muted-foreground">{s.label}</span>
              {s.key === "maintain" && (
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-[#EDE9FF] text-[#6D4AFF]">Recomendado</span>
              )}
            </div>
            <div className="text-xl font-black" style={{ color: "#0D0B1F" }}>{fmtUsd(s.totalRev)}</div>
            <div className="text-sm font-semibold text-muted-foreground">{fmtBrl(s.totalRev, usdBrl)}</div>
            {s.vs !== 0 && (
              <div className={cn("flex items-center gap-0.5 text-xs font-bold mt-2", s.vs > 0 ? "text-emerald-600" : "text-red-500")}>
                {s.vs > 0 ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
                Crescimento esperado {fmtPct(Math.abs(s.vs))}
              </div>
            )}
            {"hint" in s && s.hint && <p className="text-[11px] text-muted-foreground mt-1.5">{s.hint}</p>}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Exchange Rate Card ───────────────────────────────────────────────────────

function ExchangeRateCard({ rate, change }: { rate: number; change: number }) {
  const sparkline = [5.71, 5.68, 5.75, 5.72, 5.78, 5.74, 5.76, 5.79, 5.77, 5.80, 5.78, 5.82, rate];
  const min = Math.min(...sparkline), max = Math.max(...sparkline);
  const range = max - min || 0.01;
  const pts = sparkline.map((v, i) => `${(i / (sparkline.length - 1)) * 100},${40 - ((v - min) / range) * 34}`).join(" ");

  return (
    <div className="bg-white border border-border rounded-2xl p-4 shadow-sm">
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-1.5">
          <DollarSign className="h-3.5 w-3.5 text-[#6D4AFF]" />
          <span className="text-xs font-bold uppercase tracking-wider" style={{ color: "#0D0B1F" }}>Dólar (USD/BRL)</span>
        </div>
        <span className="flex items-center gap-1 text-[10px] text-emerald-600 font-medium">
          <div className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
          Atualizado
        </span>
      </div>
      <div className="flex items-end justify-between mt-2">
        <div>
          <div className="text-2xl font-black" style={{ color: "#0D0B1F" }}>R$ {rate.toFixed(2)}</div>
          <div className={cn("text-xs font-semibold flex items-center gap-0.5 mt-0.5", change >= 0 ? "text-emerald-600" : "text-red-500")}>
            {change >= 0 ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
            {Math.abs(change).toFixed(2)}% (24h)
          </div>
          <div className="text-[10px] text-muted-foreground mt-0.5">Fonte: Open Exchange Rates</div>
        </div>
        <svg viewBox="0 0 100 44" className="w-20 h-10">
          <polyline points={pts} fill="none" stroke="#6D4AFF" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
    </div>
  );
}

// ─── Daily Projected Card ─────────────────────────────────────────────────────

function DailyProjectedCard({ dailyData, usdBrl, today }: { dailyData: DayData[]; usdBrl: number; today: number }) {
  const projected = dailyData.filter(d => d.isProjected);
  if (!projected.length) return null;

  const maxRev = Math.max(...projected.map(d => d.revenue), 0.01);
  const avgDaily = projected.reduce((s, d) => s + d.revenue, 0) / projected.length;
  const bestDay = projected.reduce((a, b) => a.revenue > b.revenue ? a : b, projected[0]);
  const nowDate = new Date();
  const monthNames = MONTH_NAMES;
  const monthName = monthNames[nowDate.getMonth()];

  return (
    <div className="bg-white border border-border rounded-2xl p-4 shadow-sm">
      <p className="text-xs font-bold uppercase tracking-wider text-[#6D4AFF] mb-3">Receita diária projetada</p>

      {/* Bar chart */}
      <div className="flex items-end gap-0.5 h-14 mb-2">
        {projected.map(d => {
          const h = maxRev > 0 ? Math.max((d.revenue / maxRev) * 100, 4) : 4;
          const isBest = d.day === bestDay.day;
          return (
            <div key={d.day} title={`${d.day} ${monthName}: ${fmtUsd(d.revenue)}`}
              className="flex-1 rounded-t transition-all hover:opacity-80 cursor-default"
              style={{ height: `${h}%`, backgroundColor: isBest ? "#6D4AFF" : "#EDE9FF" }} />
          );
        })}
      </div>
      <div className="flex justify-between text-[9px] text-muted-foreground mb-3">
        <span>1 {monthName}</span>
        <span>{projected[projected.length - 1]?.day} {monthName}</span>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="bg-muted/50 rounded-xl p-2.5">
          <p className="text-[10px] text-muted-foreground">Média diária</p>
          <p className="text-sm font-bold" style={{ color: "#0D0B1F" }}>{fmtUsd(avgDaily)}</p>
          <p className="text-[10px] text-muted-foreground">{fmtBrl(avgDaily, usdBrl)}</p>
        </div>
        <div className="bg-muted/50 rounded-xl p-2.5">
          <p className="text-[10px] text-muted-foreground">Melhor dia previsto</p>
          <p className="text-sm font-bold" style={{ color: "#0D0B1F" }}>{bestDay.day} de {monthName}</p>
          <p className="text-[10px] text-muted-foreground">{fmtUsd(bestDay.revenue)}</p>
        </div>
      </div>
    </div>
  );
}

// ─── Insights Panel ───────────────────────────────────────────────────────────

function InsightsPanel({ proj, usdBrl, scenario }: { proj: Projections; usdBrl: number; scenario: ScenarioKey }) {
  const vsLastPct = proj.prevMonthRev > 0
    ? Math.round(((proj.totalRev - proj.prevMonthRev) / proj.prevMonthRev) * 100)
    : 0;

  const grow20Total = proj.avgDailyRev * (proj.daysElapsed + proj.daysRemaining * 1.2) + proj.actualRev;
  const grow20Gain = grow20Total - proj.totalRev;
  const grow20Pct = proj.totalRev > 0 ? Math.round((grow20Gain / proj.totalRev) * 100) : 0;

  const insights = [
    {
      icon: TrendingUp, color: "#10b981", bg: "#d1fae5",
      title: vsLastPct > 0 ? "Crescimento acima do mês anterior" : "Desempenho em linha",
      body: vsLastPct > 0
        ? `Todas as principais métricas estão em alta.`
        : "Continue postando com consistência para superar o mês anterior.",
    },
    {
      icon: Zap, color: "#6D4AFF", bg: "#EDE9FF",
      title: "Continue com o ritmo atual",
      body: `Manter a consistência pode gerar até ${fmtUsd(proj.totalRev)} este mês${vsLastPct > 0 ? ` (+${vsLastPct}%)` : ""}.`,
    },
    {
      icon: Sparkles, color: "#f59e0b", bg: "#fef3c7",
      title: "Dica de oportunidade",
      body: grow20Pct > 0
        ? `Aumentar 20% o ritmo pode elevar sua receita projetada em ${grow20Pct}%.`
        : "Experimente novos formatos para aumentar o engajamento.",
    },
  ];

  return (
    <div className="bg-white border border-border rounded-2xl p-4 shadow-sm">
      <p className="text-xs font-bold uppercase tracking-wider text-[#6D4AFF] mb-3">Insights</p>
      <div className="space-y-3">
        {insights.map((ins, i) => {
          const Icon = ins.icon;
          return (
            <div key={i} className="flex items-start gap-3">
              <div className="h-8 w-8 rounded-xl flex items-center justify-center shrink-0 mt-0.5" style={{ backgroundColor: ins.bg }}>
                <Icon className="h-3.5 w-3.5" style={{ color: ins.color }} />
              </div>
              <div>
                <p className="text-xs font-semibold" style={{ color: "#0D0B1F" }}>{ins.title}</p>
                <p className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed">{ins.body}</p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Page Avatar ──────────────────────────────────────────────────────────────

const AVATAR_COLORS = ["#6D4AFF", "#0ea5e9", "#16a34a", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899"];

function PageAvatar({ name, size = 28 }: { name: string; size?: number }) {
  const color = AVATAR_COLORS[name.charCodeAt(0) % AVATAR_COLORS.length];
  return (
    <div className="rounded-full flex items-center justify-center text-white font-bold shrink-0"
      style={{ width: size, height: size, backgroundColor: color, fontSize: size * 0.35 }}>
      {name.slice(0, 2).toUpperCase()}
    </div>
  );
}
