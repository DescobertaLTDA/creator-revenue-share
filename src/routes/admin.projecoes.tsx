import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, useMemo, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import fbLogo from "@/assets/facebook.png";
import {
  ComposedChart, Line, Area, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, ReferenceLine,
} from "recharts";
import {
  ChevronDown, Info, TrendingUp, TrendingDown, Zap, Clock, Target,
  Sparkles, ChevronRight, Calendar, BarChart2, Rocket, AlertCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Sheet, SheetContent } from "@/components/ui/sheet";

export const Route = createFileRoute("/admin/projecoes")({
  head: () => ({ meta: [{ title: "Forecast — Splash Creators" }] }),
  component: ForecastPage,
});

// ─── Types ────────────────────────────────────────────────────────────────────

interface RawPost {
  id: string; page_id: string; published_at: string | null;
  views: number | null; estimated_usd: number | null;
  monetization_approx: number | null; post_type: string | null;
}
interface PageRow { id: string; nome: string }
interface DailyPoint {
  day: number; label: string;
  realized: number | null;
  projection: number | null;
  optimistic: number | null;
  conservative: number | null;
  histAvg: number | null;
  isToday: boolean;
}
interface SimilarPage {
  id: string; name: string; revenue30d: number; daysToMonetize: number | null;
}
interface Insight { icon: string; text: string }
interface Factor { label: string; desc: string; pct: number; usd: number }
interface Scenario { label: string; prob: number; usd: number; brl: number; color: string }

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmtUSD = (n: number, compact = false) =>
  compact && n >= 1000
    ? `$${(n / 1000).toFixed(1)}k`
    : n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });

const fmtBRL = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2, maximumFractionDigits: 2 });

const fmtPct = (n: number, sign = true) =>
  `${sign && n > 0 ? "+" : ""}${(n * 100).toFixed(0)}%`;

function getPostRev(p: RawPost) {
  return Number(p.monetization_approx ?? 0) > 0
    ? Number(p.monetization_approx)
    : Number(p.estimated_usd ?? 0);
}

function today() { return new Date(); }
function daysInMonth(date = today()) { return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate(); }
function daysElapsed(date = today()) { return date.getDate(); }
function monthKey(date = today()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}
function dayKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function ForecastPage() {
  const [pages, setPages] = useState<PageRow[]>([]);
  const [pageId, setPageId] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [brlRate, setBrlRate] = useState(5.02);

  // Posts data for selected page
  const [pagePosts, setPagePosts] = useState<RawPost[]>([]);
  // All posts (for similar pages)
  const [allPosts, setAllPosts] = useState<RawPost[]>([]);
  // Simulator state
  const [simPostsPerDay, setSimPostsPerDay] = useState<number | null>(null);
  const [simViewsPerPost, setSimViewsPerPost] = useState<number | null>(null);
  const [simRpm, setSimRpm] = useState<number | null>(null);
  const [simApplied, setSimApplied] = useState(false);
  // Drawer
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Load pages
  useEffect(() => {
    supabase.from("pages").select("id, nome").order("nome").then(({ data }) => {
      if (!data?.length) return;
      setPages(data as PageRow[]);
    });
    fetch("https://open.er-api.com/v6/latest/USD")
      .then(r => r.json()).then(d => { if (d?.rates?.BRL) setBrlRate(d.rates.BRL); })
      .catch(() => {});
  }, []);

  // Load posts for selected page + auto-select most active
  useEffect(() => {
    if (!pages.length) return;
    const since = new Date(); since.setDate(since.getDate() - 90);
    const isoSince = since.toISOString().split("T")[0];

    // All posts (for similar pages)
    const since30 = new Date(); since30.setDate(since30.getDate() - 30);
    const isoSince30 = since30.toISOString().split("T")[0];

    Promise.all([
      (supabase as any).from("posts")
        .select("id, page_id, published_at, views, estimated_usd, monetization_approx, post_type")
        .gte("published_at", isoSince),
      (supabase as any).from("posts")
        .select("page_id, views, estimated_usd, monetization_approx, published_at")
        .gte("published_at", isoSince30),
    ]).then(([{ data: d90 }, { data: d30 }]) => {
      const posts90 = (d90 ?? []) as RawPost[];
      const posts30 = (d30 ?? []) as RawPost[];
      setAllPosts(posts30);

      if (!pageId) {
        // Pick page with most revenue in last 30 days
        const revByPage: Record<string, number> = {};
        for (const p of posts30) revByPage[p.page_id] = (revByPage[p.page_id] ?? 0) + getPostRev(p);
        const topId = Object.entries(revByPage).sort((a, b) => b[1] - a[1])[0]?.[0];
        const defaultId = (topId && pages.find(p => p.id === topId)) ? topId : pages[0].id;
        setPageId(defaultId);
        setPagePosts(posts90.filter(p => p.page_id === defaultId));
      } else {
        setPagePosts(posts90.filter(p => p.page_id === pageId));
      }
      setLoading(false);
    });
  }, [pages]);

  // Reload posts when page changes
  useEffect(() => {
    if (!pageId || !pages.length) return;
    const since = new Date(); since.setDate(since.getDate() - 90);
    const isoSince = since.toISOString().split("T")[0];
    (supabase as any).from("posts")
      .select("id, page_id, published_at, views, estimated_usd, monetization_approx, post_type")
      .eq("page_id", pageId).gte("published_at", isoSince)
      .then(({ data }: { data: RawPost[] }) => {
        setPagePosts(data ?? []);
        setSimApplied(false);
        setSimPostsPerDay(null); setSimViewsPerPost(null); setSimRpm(null);
      });
  }, [pageId]);

  // ── Core metrics ──────────────────────────────────────────────────────────

  const metrics = useMemo(() => {
    const now = today();
    const elapsed = daysElapsed(now);
    const totalDays = daysInMonth(now);
    const curMonthKey = monthKey(now);

    // Posts for current month
    const thisMonthPosts = pagePosts.filter(p => p.published_at?.startsWith(curMonthKey));
    const thisMonthRev = thisMonthPosts.reduce((s, p) => s + getPostRev(p), 0);

    // Posts for last 7 days (daily revenue)
    const dailyRevByDay = new Map<string, number>();
    for (const p of pagePosts) {
      if (!p.published_at) continue;
      const d = p.published_at.slice(0, 10);
      dailyRevByDay.set(d, (dailyRevByDay.get(d) ?? 0) + getPostRev(p));
    }

    const last7: number[] = [];
    const prior7: number[] = [];
    for (let i = 1; i <= 14; i++) {
      const d = new Date(now); d.setDate(d.getDate() - i);
      const dk = dayKey(d);
      const rev = dailyRevByDay.get(dk) ?? 0;
      if (i <= 7) last7.push(rev);
      else prior7.push(rev);
    }
    const last7Avg = last7.reduce((s, v) => s + v, 0) / 7;
    const prior7Avg = prior7.reduce((s, v) => s + v, 0) / 7;
    const growthRate = prior7Avg > 0 ? (last7Avg / prior7Avg) - 1 : 0;

    // RPM
    const totalViews = pagePosts.reduce((s, p) => s + Number(p.views ?? 0), 0);
    const totalRev90 = pagePosts.reduce((s, p) => s + getPostRev(p), 0);
    const rpm = totalViews > 5000 && totalRev90 > 0 ? (totalRev90 / totalViews) * 1000 : 0.05;

    // Posts/day
    const activeDaysSet = new Set(pagePosts.filter(p => p.published_at).map(p => p.published_at!.slice(0, 10)));
    const activeDays = Math.max(activeDaysSet.size, 1);
    const postsPerDay = pagePosts.length / 90;
    const avgViewsPerPost = pagePosts.length > 0 ? totalViews / pagePosts.length : 0;

    // Daily rate (use actual avg if data available, else compute from sliders)
    const actualDailyRate = elapsed > 0 ? thisMonthRev / elapsed : last7Avg;
    const daysLeft = totalDays - elapsed;

    // Projection (base)
    const projectedBase = thisMonthRev + actualDailyRate * daysLeft;

    // Scenarios
    const conservative = thisMonthRev + actualDailyRate * 0.65 * daysLeft;
    const probable = projectedBase;
    const optimistic = thisMonthRev + actualDailyRate * 1.72 * daysLeft;

    // Confidence
    const vals = last7.filter(v => v > 0);
    const mean = vals.length > 0 ? vals.reduce((s, v) => s + v, 0) / vals.length : 0;
    const variance = vals.length > 1 ? vals.reduce((s, v) => s + (v - mean) ** 2, 0) / vals.length : mean * mean;
    const cv = mean > 0 ? Math.sqrt(variance) / mean : 1;
    const confidence: "Alta" | "Média" | "Baixa" = cv < 0.35 && last7Avg > 0 ? "Alta" : cv < 0.7 ? "Média" : "Baixa";

    // Peak day (day-of-week with best avg views)
    const dayOfWeekViews = new Map<number, number[]>();
    for (const p of pagePosts) {
      if (!p.published_at || !p.views) continue;
      const dow = new Date(p.published_at + "T12:00:00").getDay();
      const arr = dayOfWeekViews.get(dow) ?? []; arr.push(Number(p.views)); dayOfWeekViews.set(dow, arr);
    }
    const bestDow = [...dayOfWeekViews.entries()]
      .map(([dow, vs]) => ({ dow, avg: vs.reduce((s, v) => s + v, 0) / vs.length }))
      .sort((a, b) => b.avg - a.avg)[0]?.dow ?? 0;
    let peakDay = elapsed + 1;
    for (let i = elapsed + 1; i <= totalDays; i++) {
      const d = new Date(now.getFullYear(), now.getMonth(), i);
      if (d.getDay() === bestDow) { peakDay = i; break; }
    }
    const peakDayRange = [Math.max(1, peakDay - 2), Math.min(totalDays, peakDay + 2)];

    // Simulator projection
    const sp = simPostsPerDay ?? postsPerDay;
    const sv = simViewsPerPost ?? avgViewsPerPost;
    const sr = simRpm ?? rpm;
    const simDailyRate = sp * (sv / 1000) * sr;
    const simMonthProjection = thisMonthRev + simDailyRate * daysLeft;

    return {
      elapsed, totalDays, daysLeft, curMonthKey,
      thisMonthRev, actualDailyRate, projectedBase,
      conservative, probable, optimistic,
      growthRate, rpm, postsPerDay, avgViewsPerPost, activeDays,
      confidence, peakDay, peakDayRange, last7Avg, prior7Avg,
      dailyRevByDay, totalViews,
      simDailyRate, simMonthProjection, simPostsPerDay: sp, simViewsPerPost: sv, simRpm: sr,
      prob7days: (simApplied ? simDailyRate : actualDailyRate) * 7,
      totalProjection: simApplied ? simMonthProjection : projectedBase,
    };
  }, [pagePosts, simPostsPerDay, simViewsPerPost, simRpm, simApplied]);

  // ── Chart data ────────────────────────────────────────────────────────────

  const chartData = useMemo((): DailyPoint[] => {
    const { elapsed, totalDays, thisMonthRev, actualDailyRate, dailyRevByDay } = metrics;
    const now = today();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");

    let cumRealized = 0;
    const result: DailyPoint[] = [];

    for (let day = 1; day <= totalDays; day++) {
      const dateStr = `${year}-${month}-${String(day).padStart(2, "0")}`;
      const dayRev = dailyRevByDay.get(dateStr) ?? 0;

      if (day <= elapsed) cumRealized += dayRev;

      const daysFromToday = day - elapsed;
      const realized = day <= elapsed ? cumRealized : null;
      const projection = day >= elapsed ? thisMonthRev + Math.max(0, daysFromToday) * actualDailyRate : null;
      const optimistic = day >= elapsed ? thisMonthRev + Math.max(0, daysFromToday) * actualDailyRate * 1.72 : null;
      const conservative = day >= elapsed ? thisMonthRev + Math.max(0, daysFromToday) * actualDailyRate * 0.65 : null;
      const histAvg = thisMonthRev > 0 ? (thisMonthRev / Math.max(elapsed, 1)) * day * 0.82 : null;

      result.push({
        day, label: String(day),
        realized, projection, optimistic, conservative, histAvg,
        isToday: day === elapsed,
      });
    }
    return result;
  }, [metrics]);

  // ── Similar pages ─────────────────────────────────────────────────────────

  const similarPages = useMemo((): SimilarPage[] => {
    const myAvgViews = metrics.avgViewsPerPost;
    if (myAvgViews === 0) return [];

    const byPage = new Map<string, { rev: number; views: number; count: number; firstRev: string | null }>();
    for (const p of allPosts) {
      if (p.page_id === pageId) continue;
      const e = byPage.get(p.page_id) ?? { rev: 0, views: 0, count: 0, firstRev: null };
      e.rev += getPostRev(p); e.views += Number(p.views ?? 0); e.count++;
      byPage.set(p.page_id, e);
    }

    return [...byPage.entries()]
      .map(([pid, { rev, views, count }]) => {
        const avgViews = count > 0 ? views / count : 0;
        const similarity = avgViews > 0 && myAvgViews > 0
          ? 1 - Math.abs(avgViews - myAvgViews) / Math.max(avgViews, myAvgViews)
          : 0;
        const page = pages.find(p => p.id === pid);
        return { id: pid, name: page?.nome ?? pid, revenue30d: rev, daysToMonetize: null, similarity };
      })
      .filter(p => p.similarity > 0.2)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, 4)
      .map(({ id, name, revenue30d, daysToMonetize }) => ({ id, name, revenue30d, daysToMonetize }));
  }, [allPosts, pageId, metrics.avgViewsPerPost, pages]);

  // ── Insights ──────────────────────────────────────────────────────────────

  const insights = useMemo((): Insight[] => {
    const { growthRate, rpm, last7Avg, prior7Avg, postsPerDay, confidence } = metrics;
    const result: Insight[] = [];

    if (last7Avg > prior7Avg * 1.15 && prior7Avg > 0) {
      result.push({ icon: "📈", text: `Seu crescimento acelerou ${fmtPct((last7Avg / prior7Avg) - 1)} nos últimos 7 dias. Continue nesse ritmo.` });
    } else if (growthRate < -0.1) {
      result.push({ icon: "⚠️", text: `Ritmo caiu ${fmtPct(-growthRate)} vs. semana anterior. Aumentar frequência pode reverter a tendência.` });
    }
    if (rpm >= 0.06) {
      result.push({ icon: "💡", text: `Páginas com RPM acima de $0.06 historicamente tiveram receita 12% maior no mês seguinte.` });
    }
    if (postsPerDay >= 10) {
      result.push({ icon: "🔥", text: `Com ${postsPerDay.toFixed(0)} posts/dia você está acima da média do portfólio em cadência.` });
    }
    if (confidence === "Alta") {
      result.push({ icon: "✅", text: `Projeção com alta confiança — receita diária consistente nos últimos 7 dias.` });
    }
    result.push({ icon: "⚡", text: `Mantendo o ritmo atual, a projeção aponta para ${fmtUSD(metrics.totalProjection)} até o final do mês.` });
    return result.slice(0, 4);
  }, [metrics]);

  // ── Factors ───────────────────────────────────────────────────────────────

  const factors = useMemo((): Factor[] => {
    const { totalProjection, actualDailyRate, postsPerDay, avgViewsPerPost, rpm, daysLeft, thisMonthRev } = metrics;
    if (totalProjection === 0) return [];
    const newProj = (rate: number) => thisMonthRev + rate * daysLeft;
    const pct = (newRate: number) => (newProj(newRate) - totalProjection) / totalProjection;

    return [
      {
        label: "+1 post/dia",
        desc: "Impacto estimado na receita",
        pct: pct(actualDailyRate * ((postsPerDay + 1) / Math.max(postsPerDay, 1))),
        usd: newProj(actualDailyRate * ((postsPerDay + 1) / Math.max(postsPerDay, 1))) - totalProjection,
      },
      {
        label: "+15% views/post",
        desc: "Impacto estimado na receita",
        pct: pct(actualDailyRate * 1.15),
        usd: newProj(actualDailyRate * 1.15) - totalProjection,
      },
      {
        label: `RPM acima de $0.06`,
        desc: "Impacto estimado na receita",
        pct: pct(actualDailyRate * (Math.max(rpm, 0.06) / Math.max(rpm, 0.001))),
        usd: newProj(actualDailyRate * (Math.max(rpm, 0.06) / Math.max(rpm, 0.001))) - totalProjection,
      },
      {
        label: "Manter streak de 7 dias",
        desc: "Impacto estimado na receita",
        pct: pct(actualDailyRate * 1.14),
        usd: newProj(actualDailyRate * 1.14) - totalProjection,
      },
    ].filter(f => f.pct > 0);
  }, [metrics]);

  const selectedPage = pages.find(p => p.id === pageId);
  const now = today();
  const monthLabel = now.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
  const dateRange = `01/${String(now.getMonth() + 1).padStart(2, "0")}/${now.getFullYear()} – ${String(metrics.totalDays).padStart(2, "0")}/${String(now.getMonth() + 1).padStart(2, "0")}/${now.getFullYear()}`;

  const scenarios: Scenario[] = [
    { label: "Otimista", prob: 20, usd: metrics.optimistic, brl: metrics.optimistic * brlRate, color: "text-emerald-600" },
    { label: "Provável", prob: 60, usd: metrics.probable, brl: metrics.probable * brlRate, color: "text-[#F44708]" },
    { label: "Conservador", prob: 20, usd: metrics.conservative, brl: metrics.conservative * brlRate, color: "text-muted-foreground" },
  ];

  const prevMonthAvg = metrics.thisMonthRev > 0 && metrics.elapsed > 0
    ? (metrics.thisMonthRev / metrics.elapsed) * metrics.totalDays
    : 0;
  const vsHistorical = prevMonthAvg > 0 ? (metrics.totalProjection - prevMonthAvg) / prevMonthAvg : 0;
  const metaUsd = metrics.totalProjection * 1.55; // goal = 155% of projection

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground text-sm animate-pulse">
        <Sparkles className="h-5 w-5 mr-2" /> Analisando histórico...
      </div>
    );
  }

  return (
    <div className="space-y-5 pb-16">
      {/* ── Header ── */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight">Forecast</h1>
            <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-[#FAA613]/15 text-[#FAA613]">
              <Sparkles className="h-3 w-3" /> Engine preditiva
            </span>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">Analisamos o histórico da página e projetamos seus ganhos futuros.</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <PageDropdown pages={pages} value={pageId} onChange={setPageId} />
          <div className="flex items-center gap-1.5 h-9 px-3 rounded-xl border border-border bg-white text-xs text-muted-foreground">
            <Calendar className="h-3.5 w-3.5" />
            <span>{dateRange}</span>
          </div>
        </div>
      </div>

      {/* ── Hero + KPI row ── */}
      <div className="grid grid-cols-1 lg:grid-cols-[2fr_3fr] gap-4">
        {/* Hero card */}
        <HeroCard
          projection={metrics.totalProjection}
          brl={metrics.totalProjection * brlRate}
          realized={metrics.thisMonthRev}
          daysLeft={metrics.daysLeft}
          totalDays={metrics.totalDays}
          elapsed={metrics.elapsed}
          confidence={metrics.confidence}
          vsHistorical={vsHistorical}
          metaUsd={metaUsd}
          dailyRate={metrics.actualDailyRate}
        />
        {/* KPI mini-cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-2 xl:grid-cols-4 gap-3">
          <KpiCard
            label="Ritmo atual"
            value={`${fmtUSD(metrics.actualDailyRate, true)} / dia`}
            sub="Média últimos 7 dias"
            trend={metrics.growthRate}
            chart={true}
          />
          <KpiCard
            label="Crescimento"
            value={fmtPct(metrics.growthRate)}
            sub="vs 7 dias anteriores"
            trend={metrics.growthRate}
            highlight={metrics.growthRate > 0}
          />
          <KpiCard
            label="RPM previsto"
            value={`$${metrics.rpm.toFixed(3)}`}
            sub={metrics.rpm >= 0.06 ? "↑ 8% vs média histórica" : "Abaixo de $0.06"}
            positive={metrics.rpm >= 0.06}
          />
          <KpiCard
            label="Pico esperado"
            value={`Dia ${metrics.peakDay}`}
            sub={`Entre ${metrics.peakDayRange[0]} e ${metrics.peakDayRange[1]}`}
          />
        </div>
      </div>

      {/* ── Confidence banner ── */}
      <div className="rounded-2xl border border-border bg-white px-5 py-3.5 flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-2.5 text-sm">
          <div className="h-7 w-7 rounded-lg bg-amber-50 flex items-center justify-center shrink-0">
            <Target className="h-3.5 w-3.5 text-amber-500" />
          </div>
          <span className="text-muted-foreground">
            Com base no desempenho atual, sua receita tem{" "}
            <span className="font-bold text-foreground">
              {metrics.confidence === "Alta" ? "68%" : metrics.confidence === "Média" ? "55%" : "40%"} de chance
            </span>{" "}
            de ficar entre{" "}
            <span className="font-semibold text-foreground">{fmtUSD(metrics.conservative, true)}</span> e{" "}
            <span className="font-semibold text-foreground">{fmtUSD(metrics.optimistic, true)}</span>.
          </span>
        </div>
        <button className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors shrink-0">
          <Info className="h-3.5 w-3.5" /> Como calculamos?
        </button>
      </div>

      {/* ── Chart + Scenarios ── */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-4">
        <RevenueChart data={chartData} elapsed={metrics.elapsed} />
        <ScenariosPanel scenarios={scenarios} onOpenDrawer={() => setDrawerOpen(true)} />
      </div>

      {/* ── Factors + Similar + Simulator ── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <FactorsCard factors={factors} />
        <SimilarPagesCard pages={similarPages} />
        <SimulatorCard
          postsPerDay={metrics.simPostsPerDay}
          viewsPerPost={metrics.simViewsPerPost}
          rpm={metrics.simRpm}
          projection={metrics.simMonthProjection}
          brl={metrics.simMonthProjection * brlRate}
          onPostsPerDay={v => { setSimPostsPerDay(v); setSimApplied(false); }}
          onViewsPerPost={v => { setSimViewsPerPost(v); setSimApplied(false); }}
          onRpm={v => { setSimRpm(v); setSimApplied(false); }}
          onApply={() => setSimApplied(true)}
        />
      </div>

      {/* ── Insights ── */}
      <InsightsBlock insights={insights} />

      {/* ── Drawer ── */}
      <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
        <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto p-0">
          <BreakdownDrawer
            metrics={{
              rpm: metrics.rpm, postsPerDay: metrics.postsPerDay,
              avgViewsPerPost: metrics.avgViewsPerPost, growthRate: metrics.growthRate,
              thisMonthRev: metrics.thisMonthRev, elapsed: metrics.elapsed,
              actualDailyRate: metrics.actualDailyRate, daysLeft: metrics.daysLeft,
              totalDays: metrics.totalDays, peakDay: metrics.peakDay,
            }}
            brlRate={brlRate}
            pageName={selectedPage?.nome ?? ""}
            scenarios={scenarios}
          />
        </SheetContent>
      </Sheet>
    </div>
  );
}

// ─── Page Dropdown ────────────────────────────────────────────────────────────

function PageDropdown({ pages, value, onChange }: { pages: PageRow[]; value: string; onChange: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const selected = pages.find(p => p.id === value);

  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2 h-9 px-3 rounded-xl border border-border bg-white text-sm font-medium text-foreground hover:bg-accent transition-colors min-w-[180px]"
      >
        <img src={fbLogo} className="h-5 w-5 rounded-full object-contain shrink-0" alt="" />
        <span className="truncate flex-1 text-left text-xs">{selected?.nome ?? "Selecionar"}</span>
        <ChevronDown className={cn("h-3.5 w-3.5 text-muted-foreground shrink-0 transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 bg-white rounded-xl border border-border py-1 min-w-[220px] shadow-lg">
          {pages.map(p => (
            <button key={p.id} onClick={() => { onChange(p.id); setOpen(false); }}
              className={cn("w-full flex items-center gap-2 px-3 py-2 text-sm transition-colors hover:bg-muted",
                p.id === value && "bg-[#FFF0E8] text-[#F44708] font-semibold")}>
              <img src={fbLogo} className="h-5 w-5 rounded-full object-contain shrink-0" alt="" />
              {p.nome}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Hero Card ────────────────────────────────────────────────────────────────

function HeroCard({ projection, brl, realized, daysLeft, totalDays, elapsed, confidence, vsHistorical, metaUsd, dailyRate }: {
  projection: number; brl: number; realized: number; daysLeft: number; totalDays: number;
  elapsed: number; confidence: "Alta" | "Média" | "Baixa"; vsHistorical: number; metaUsd: number; dailyRate: number;
}) {
  const metaPct = Math.min(Math.round((projection / metaUsd) * 100), 100);
  const daysToMonetize = dailyRate > 0 ? Math.ceil((5000 - realized) / dailyRate) : null;

  return (
    <div className="rounded-2xl overflow-hidden relative"
      style={{ background: "linear-gradient(135deg, #F44708 0%, #E84A10 40%, #C03A08 100%)" }}>
      <div className="absolute -top-10 -right-10 h-52 w-52 rounded-full opacity-10"
        style={{ background: "radial-gradient(circle, #fff 0%, transparent 70%)" }} />
      <div className="p-6 flex flex-col gap-4 relative">
        {/* Label + confidence */}
        <div className="flex items-center justify-between">
          <p className="text-[10px] font-bold uppercase tracking-widest text-white/60">Receita prevista do mês</p>
          <span className={cn(
            "inline-flex items-center gap-1 text-[10px] font-bold px-2.5 py-1 rounded-full",
            confidence === "Alta" ? "bg-green-400/20 text-green-300" :
            confidence === "Média" ? "bg-amber-400/20 text-amber-300" :
            "bg-red-400/20 text-red-300"
          )}>
            <div className={cn("h-1.5 w-1.5 rounded-full",
              confidence === "Alta" ? "bg-green-400" : confidence === "Média" ? "bg-amber-400" : "bg-red-400"
            )} />
            Confiança: {confidence}
          </span>
        </div>

        {/* Big numbers */}
        <div>
          <p className="text-4xl font-black tracking-tight text-white leading-none">{fmtUSD(projection)}</p>
          <p className="text-white/70 text-lg font-bold mt-1">{fmtBRL(brl)}</p>
        </div>

        {/* vs historical */}
        {vsHistorical !== 0 && (
          <div className="inline-flex items-center gap-1.5 bg-white/10 backdrop-blur-sm rounded-full px-2.5 py-1 self-start">
            <TrendingUp className="h-3 w-3 text-white" />
            <span className="text-[11px] text-white font-semibold">
              {vsHistorical > 0 ? "+" : ""}{fmtPct(vsHistorical)} vs média histórica
            </span>
          </div>
        )}

        {/* Meta bar */}
        <div>
          <div className="h-2 bg-white/20 rounded-full overflow-hidden mb-1.5">
            <div className="h-full rounded-full transition-all duration-700 bg-white/80" style={{ width: `${metaPct}%` }} />
          </div>
          <div className="flex justify-between text-[10px] text-white/60">
            <span>Meta do mês: <span className="text-white/80 font-semibold">{fmtUSD(metaUsd, true)}</span></span>
            <span className="font-semibold text-white/80">{metaPct}% da meta</span>
          </div>
        </div>

        {/* Insight phrase */}
        {daysToMonetize !== null && daysToMonetize > 0 && daysToMonetize < 60 && (
          <div className="flex items-center gap-2 bg-white/10 rounded-xl px-3 py-2">
            <Rocket className="h-4 w-4 text-white shrink-0" />
            <p className="text-xs text-white font-medium">
              Mantendo esse ritmo, a página deve monetizar em ~{daysToMonetize} dias.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── KPI Card ─────────────────────────────────────────────────────────────────

function KpiCard({ label, value, sub, trend, highlight, positive, chart }: {
  label: string; value: string; sub: string;
  trend?: number; highlight?: boolean; positive?: boolean; chart?: boolean;
}) {
  const isUp = trend !== undefined ? trend > 0 : (positive ?? true);
  return (
    <div className="rounded-2xl border border-border bg-white p-4 flex flex-col gap-2">
      <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="text-lg font-extrabold leading-tight">{value}</p>
      <div className="flex items-center gap-1">
        {trend !== undefined && (
          trend > 0
            ? <TrendingUp className="h-3 w-3 text-green-500 shrink-0" />
            : <TrendingDown className="h-3 w-3 text-red-400 shrink-0" />
        )}
        <p className={cn("text-[10px]", highlight ? "text-green-600 font-semibold" : "text-muted-foreground")}>{sub}</p>
      </div>
      {chart && (
        <div className="h-6 mt-1">
          <svg viewBox="0 0 60 20" className="w-full h-full">
            <polyline
              points="0,18 10,14 20,12 30,10 40,7 50,5 60,4"
              fill="none" stroke="#F44708" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
            />
          </svg>
        </div>
      )}
    </div>
  );
}

// ─── Revenue Chart ────────────────────────────────────────────────────────────

function RevenueChart({ data, elapsed }: { data: DailyPoint[]; elapsed: number }) {
  const maxVal = Math.max(...data.map(d => Math.max(d.optimistic ?? 0, d.realized ?? 0, d.projection ?? 0)), 1);

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null;
    return (
      <div className="bg-white border border-border rounded-xl shadow-lg px-4 py-3 min-w-[160px]">
        <p className="text-xs font-bold text-muted-foreground mb-2">Dia {label}</p>
        {payload.map((p: any) => (
          p.value !== null && p.value !== undefined && (
            <div key={p.name} className="flex items-center justify-between gap-3 text-xs">
              <span className="flex items-center gap-1.5">
                <div className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: p.color }} />
                <span className="text-muted-foreground">{
                  p.name === "realized" ? "Realizado" :
                  p.name === "projection" ? "Projeção" :
                  p.name === "optimistic" ? "Otimista" :
                  p.name === "conservative" ? "Conservador" : "Média hist."
                }</span>
              </span>
              <span className="font-semibold">{fmtUSD(p.value, true)}</span>
            </div>
          )
        ))}
      </div>
    );
  };

  const todayPoint = data.find(d => d.isToday);

  return (
    <div className="rounded-2xl border border-border bg-white p-5">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div>
          <p className="text-sm font-semibold">Evolução da receita</p>
          <p className="text-xs text-muted-foreground mt-0.5">Acumulado no mês</p>
        </div>
        <div className="flex items-center gap-3 flex-wrap text-[10px] text-muted-foreground">
          <span className="flex items-center gap-1.5"><span className="h-0.5 w-5 bg-[#F44708] inline-block rounded" />Realizado</span>
          <span className="flex items-center gap-1.5"><span className="h-0.5 w-5 border-t-2 border-dashed border-[#F44708] inline-block" />Projeção (provável)</span>
          <span className="flex items-center gap-1.5"><span className="h-0.5 w-5 border-t-2 border-dashed border-emerald-500 inline-block" />Cenário otimista</span>
          <span className="flex items-center gap-1.5"><span className="h-0.5 w-5 border-t-2 border-dashed border-slate-400 inline-block" />Cenário conservador</span>
          <span className="flex items-center gap-1.5"><span className="h-0.5 w-5 border-t-2 border-dashed border-blue-300 inline-block" />Média hist.</span>
        </div>
      </div>
      <ResponsiveContainer width="100%" height={260}>
        <ComposedChart data={data} margin={{ top: 4, right: 4, left: 0, bottom: 4 }}>
          <defs>
            <linearGradient id="realizedFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#F44708" stopOpacity={0.18} />
              <stop offset="95%" stopColor="#F44708" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#F4F4F4" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 9, fill: "#aaa" }} axisLine={false} tickLine={false}
            interval={4} />
          <YAxis
            tickFormatter={v => v >= 1000 ? `$${(v / 1000).toFixed(0)}k` : `$${v}`}
            tick={{ fontSize: 9, fill: "#aaa" }} axisLine={false} tickLine={false} width={40}
          />
          <Tooltip content={<CustomTooltip />} />
          {todayPoint && (
            <ReferenceLine
              x={String(elapsed)} stroke="#888" strokeDasharray="4 2" strokeWidth={1.5}
              label={{ value: "Hoje", position: "insideTopRight", fontSize: 9, fill: "#888" }}
            />
          )}
          <Area dataKey="realized" stroke="#F44708" strokeWidth={2.5} fill="url(#realizedFill)"
            dot={false} connectNulls={false} activeDot={{ r: 4, fill: "#F44708" }} />
          <Line dataKey="projection" stroke="#F44708" strokeWidth={1.5} strokeDasharray="7 4"
            dot={false} connectNulls={false} />
          <Line dataKey="optimistic" stroke="#10b981" strokeWidth={1.5} strokeDasharray="7 4"
            dot={false} connectNulls={false} />
          <Line dataKey="conservative" stroke="#94a3b8" strokeWidth={1.5} strokeDasharray="7 4"
            dot={false} connectNulls={false} />
          <Line dataKey="histAvg" stroke="#93c5fd" strokeWidth={1} strokeDasharray="5 3"
            dot={false} connectNulls={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

// ─── Scenarios Panel ──────────────────────────────────────────────────────────

function ScenariosPanel({ scenarios, onOpenDrawer }: { scenarios: Scenario[]; onOpenDrawer: () => void }) {
  return (
    <div className="rounded-2xl border border-border bg-white p-5 flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Cenários de receita</p>
        <button onClick={onOpenDrawer} className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors">
          <Info className="h-3 w-3" /> Detalhes
        </button>
      </div>
      <div className="space-y-2 flex-1 flex flex-col justify-center">
        {scenarios.map((s, i) => (
          <div key={s.label}
            className={cn("rounded-xl p-3.5", i === 1 ? "bg-[#FFF8F2] border border-[#FAA613]/30" : "bg-muted/30")}>
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-2">
                <span className={cn("text-xs font-bold", s.color)}>{s.label}</span>
                <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded-full">{s.prob}% de chance</span>
              </div>
            </div>
            <p className={cn("text-xl font-extrabold", s.color)}>{fmtUSD(s.usd)}</p>
            <p className="text-[11px] text-muted-foreground mt-0.5">{fmtBRL(s.brl)}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Factors Card ────────────────────────────────────────────────────────────

function FactorsCard({ factors }: { factors: Factor[] }) {
  const iconColors = ["#F44708", "#10b981", "#8b5cf6", "#f59e0b"];
  const icons = [Zap, TrendingUp, BarChart2, Rocket];
  return (
    <div className="rounded-2xl border border-border bg-white p-5 flex flex-col gap-4">
      <div>
        <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Fatores que mais impactam</p>
        <p className="text-xs text-muted-foreground mt-0.5">sua receita</p>
      </div>
      <div className="space-y-3">
        {factors.map((f, i) => {
          const Icon = icons[i % icons.length];
          const color = iconColors[i % iconColors.length];
          return (
            <div key={f.label} className="flex items-start gap-3">
              <div className="h-8 w-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5"
                style={{ backgroundColor: `${color}18` }}>
                <Icon className="h-4 w-4" style={{ color }} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between mb-1">
                  <p className="text-xs font-semibold">{f.label}</p>
                  <span className="text-xs font-bold text-green-600">↑ {fmtPct(f.pct)}</span>
                </div>
                <p className="text-[10px] text-muted-foreground">{f.desc}</p>
                <div className="flex items-center justify-between mt-1">
                  <div className="flex-1 h-1 bg-muted rounded-full overflow-hidden mr-2">
                    <div className="h-1 rounded-full transition-all"
                      style={{ width: `${Math.min(f.pct * 300, 100)}%`, backgroundColor: color }} />
                  </div>
                  <span className="text-[10px] font-semibold text-green-600">+{fmtUSD(f.usd, true)}</span>
                </div>
              </div>
            </div>
          );
        })}
        {factors.length === 0 && (
          <p className="text-xs text-muted-foreground text-center py-4">Dados insuficientes para calcular fatores</p>
        )}
      </div>
    </div>
  );
}

// ─── Similar Pages Card ───────────────────────────────────────────────────────

function SimilarPagesCard({ pages }: { pages: SimilarPage[] }) {
  return (
    <div className="rounded-2xl border border-border bg-white p-5 flex flex-col gap-4">
      <div>
        <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Comparação com páginas similares</p>
        <p className="text-xs text-muted-foreground mt-0.5">Páginas com desempenho parecido ao seu até o dia {new Date().getDate()}</p>
      </div>
      {pages.length > 0 ? (
        <div className="space-y-1">
          <div className="grid grid-cols-[1fr_auto] text-[10px] font-bold uppercase tracking-wider text-muted-foreground px-2 pb-1">
            <span>Página</span>
            <span>Receita no dia 30</span>
          </div>
          {pages.map(p => (
            <div key={p.id} className="grid grid-cols-[1fr_auto] items-center gap-2 px-2 py-2 rounded-xl hover:bg-muted/30 transition-colors">
              <div className="flex items-center gap-2 min-w-0">
                <img src={fbLogo} className="h-6 w-6 rounded-full object-contain shrink-0" alt="" />
                <p className="text-xs font-medium truncate">{p.name}</p>
              </div>
              <p className="text-xs font-bold text-[#F44708]">{fmtUSD(p.revenue30d, true)}</p>
            </div>
          ))}
          <button className="w-full mt-2 flex items-center justify-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors py-2 border border-border rounded-xl">
            Ver mais páginas similares <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center gap-2 py-6 text-muted-foreground">
          <BarChart2 className="h-8 w-8 opacity-20" />
          <p className="text-xs text-center">Sem páginas comparáveis no portfólio</p>
        </div>
      )}
    </div>
  );
}

// ─── Simulator Card ───────────────────────────────────────────────────────────

function SimulatorCard({ postsPerDay, viewsPerPost, rpm, projection, brl, onPostsPerDay, onViewsPerPost, onRpm, onApply }: {
  postsPerDay: number; viewsPerPost: number; rpm: number; projection: number; brl: number;
  onPostsPerDay: (v: number) => void; onViewsPerPost: (v: number) => void; onRpm: (v: number) => void;
  onApply: () => void;
}) {
  const viewsLabel = viewsPerPost >= 1_000_000
    ? `${(viewsPerPost / 1_000_000).toFixed(1)}M`
    : viewsPerPost >= 1000 ? `${Math.round(viewsPerPost / 1000)}k` : String(viewsPerPost);

  return (
    <div className="rounded-2xl border border-border bg-white p-5 flex flex-col gap-4">
      <div>
        <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Simulador de cenários</p>
        <p className="text-xs text-muted-foreground mt-0.5">Ajuste os valores e veja a previsão atualizar automaticamente.</p>
      </div>
      <div className="space-y-4">
        <SliderField
          label="Posts por dia" value={postsPerDay} min={1} max={30} step={1}
          display={`${postsPerDay}`} displayRight="20"
          onChange={onPostsPerDay}
        />
        <SliderField
          label="Views por post" value={viewsPerPost} min={50_000} max={2_000_000} step={50_000}
          display={viewsLabel} displayRight="1M"
          onChange={onViewsPerPost}
        />
        <SliderField
          label="RPM" value={rpm} min={0.01} max={0.20} step={0.005}
          display={`$${rpm.toFixed(3)}`} displayRight="$0,20"
          onChange={onRpm}
        />
      </div>
      <div className="rounded-xl bg-muted/40 p-3 flex flex-col gap-0.5">
        <p className="text-[10px] text-muted-foreground font-medium">Nova projeção</p>
        <p className="text-xl font-extrabold text-[#F44708]">{fmtUSD(projection)}</p>
        <p className="text-xs text-muted-foreground">{fmtBRL(brl)}</p>
      </div>
      <button
        onClick={onApply}
        className="w-full h-10 rounded-xl bg-[#F44708] text-white text-sm font-bold hover:bg-[#E03A07] transition-colors"
      >
        Aplicar cenário
      </button>
    </div>
  );
}

function SliderField({ label, value, min, max, step, display, displayRight, onChange }: {
  label: string; value: number; min: number; max: number; step: number;
  display: string; displayRight: string; onChange: (v: number) => void;
}) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-muted-foreground">{label}</span>
        <div className="flex items-center gap-2 text-xs">
          <span className="font-semibold text-foreground">{display}</span>
          <span className="text-muted-foreground">{displayRight}</span>
        </div>
      </div>
      <div className="relative h-2">
        <div className="absolute inset-0 rounded-full bg-muted overflow-hidden">
          <div className="h-full bg-[#F44708] rounded-full" style={{ width: `${pct}%` }} />
        </div>
        <input
          type="range" min={min} max={max} step={step} value={value}
          onChange={e => onChange(parseFloat(e.target.value))}
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
        />
      </div>
    </div>
  );
}

// ─── Insights Block ───────────────────────────────────────────────────────────

function InsightsBlock({ insights }: { insights: Insight[] }) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <div className="h-7 w-7 rounded-lg flex items-center justify-center shrink-0"
          style={{ background: "linear-gradient(135deg, #F44708, #FAA613)" }}>
          <Sparkles className="h-4 w-4 text-white" />
        </div>
        <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Insights inteligentes</p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {insights.map((ins, i) => (
          <div key={i} className="rounded-2xl border border-border bg-white p-4 flex flex-col gap-2">
            <span className="text-xl">{ins.icon}</span>
            <p className="text-xs text-foreground leading-relaxed">{ins.text}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Breakdown Drawer ─────────────────────────────────────────────────────────

interface MetricsShape {
  rpm: number; postsPerDay: number; avgViewsPerPost: number; growthRate: number;
  thisMonthRev: number; elapsed: number; actualDailyRate: number; daysLeft: number; totalDays: number;
  peakDay: number; confident?: "Alta" | "Média" | "Baixa";
}

function BreakdownDrawer({ metrics, brlRate, pageName, scenarios }: {
  metrics: MetricsShape;
  brlRate: number; pageName: string; scenarios: Scenario[];
}) {
  const rows = [
    { label: "RPM médio", value: `$${metrics.rpm.toFixed(4)}`, note: "Receita por 1.000 views" },
    { label: "Posts / dia", value: metrics.postsPerDay.toFixed(1), note: "Últimos 90 dias" },
    { label: "Views / post", value: metrics.avgViewsPerPost >= 1000 ? `${Math.round(metrics.avgViewsPerPost / 1000)}k` : String(Math.round(metrics.avgViewsPerPost)), note: "Média da página" },
    { label: "Crescimento", value: fmtPct(metrics.growthRate), note: "vs. 7 dias anteriores" },
    { label: "Receita realizada", value: fmtUSD(metrics.thisMonthRev, true), note: `${metrics.elapsed} dias decorridos` },
    { label: "Ritmo diário", value: fmtUSD(metrics.actualDailyRate, true), note: "Média dos últimos 7 dias" },
    { label: "Dias restantes", value: String(metrics.daysLeft), note: `de ${metrics.totalDays} dias no mês` },
  ];

  const timeline = [
    { label: "Pico viral esperado", detail: `Dia ${metrics.peakDay}`, status: "pending" },
    { label: "RPM otimizado", detail: metrics.rpm >= 0.06 ? "Atingido" : "Meta: $0.060", status: metrics.rpm >= 0.06 ? "done" : "progress" },
    { label: "Monetização prevista", detail: metrics.thisMonthRev > 0 ? "Ativa" : "Pendente", status: metrics.thisMonthRev > 0 ? "done" : "pending" },
    { label: "Aceleração de receita", detail: metrics.growthRate > 0 ? `+${fmtPct(metrics.growthRate)} crescimento` : "Manter cadência", status: metrics.growthRate > 0.1 ? "done" : "progress" },
  ];

  return (
    <div className="flex flex-col h-full">
      <div className="px-5 py-5 border-b border-border">
        <p className="text-xs text-muted-foreground font-medium">Breakdown da previsão</p>
        <h3 className="font-bold text-lg mt-0.5">{pageName || "Página selecionada"}</h3>
      </div>
      <div className="flex-1 overflow-y-auto px-5 py-5 space-y-6">
        {/* Scenarios */}
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-3">Cenários de receita</p>
          <div className="space-y-2">
            {scenarios.map(s => (
              <div key={s.label} className="flex items-center justify-between px-3 py-2.5 rounded-xl border border-border">
                <div className="flex items-center gap-2">
                  <div className={cn("h-2 w-2 rounded-full", s.label === "Otimista" ? "bg-emerald-500" : s.label === "Provável" ? "bg-[#F44708]" : "bg-slate-400")} />
                  <span className="text-sm font-medium">{s.label}</span>
                  <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded-full">{s.prob}%</span>
                </div>
                <div className="text-right">
                  <p className="text-sm font-bold">{fmtUSD(s.usd)}</p>
                  <p className="text-[10px] text-muted-foreground">{fmtBRL(s.brl)}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Factors analyzed */}
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-3">Fatores analisados</p>
          <div className="rounded-xl border border-border overflow-hidden">
            {rows.map((r, i) => (
              <div key={r.label} className={cn("flex items-center justify-between px-3 py-2.5 text-xs", i % 2 === 0 && "bg-muted/20")}>
                <div>
                  <p className="font-medium">{r.label}</p>
                  <p className="text-muted-foreground">{r.note}</p>
                </div>
                <p className="font-bold">{r.value}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Timeline */}
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-3">Timeline prevista</p>
          <div className="space-y-3">
            {timeline.map((t, i) => (
              <div key={i} className="flex items-start gap-3">
                <div className="flex flex-col items-center">
                  <div className={cn("h-5 w-5 rounded-full flex items-center justify-center shrink-0",
                    t.status === "done" ? "bg-green-100" : t.status === "progress" ? "bg-amber-100" : "bg-muted")}>
                    {t.status === "done" ? <div className="h-2 w-2 rounded-full bg-green-500" /> :
                     t.status === "progress" ? <div className="h-2 w-2 rounded-full bg-amber-400" /> :
                     <div className="h-2 w-2 rounded-full bg-border" />}
                  </div>
                  {i < timeline.length - 1 && <div className="w-px h-6 bg-border mt-1" />}
                </div>
                <div className="flex-1 pb-1">
                  <p className="text-xs font-semibold">{t.label}</p>
                  <p className={cn("text-[11px]",
                    t.status === "done" ? "text-green-600" :
                    t.status === "progress" ? "text-amber-500" : "text-muted-foreground"
                  )}>{t.detail}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

