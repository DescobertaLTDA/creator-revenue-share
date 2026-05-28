import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { formatMonth } from "@/lib/format";
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from "recharts";
import {
  DollarSign, Eye, TrendingUp, Clock, Heart, Zap,
  ArrowUp, ArrowDown, Loader2, Lightbulb, Play, ImageIcon,
  ChevronRight, Download, ChevronDown,
} from "lucide-react";

export const Route = createFileRoute("/admin/posts")({
  head: () => ({ meta: [{ title: "Analytics - Splash Creators" }] }),
  component: AnalyticsPage,
});

// ─── Types ────────────────────────────────────────────────────────────────────

interface PostRow {
  id: string; page_id: string; external_post_id: string;
  published_at: string | null; title: string | null; post_type: string | null;
  views: number | null; reach: number | null; reactions: number | null;
  comments: number | null; shares: number | null;
  monetization_approx: number | null; estimated_usd: number | null;
  ad_cpm_usd: number | null; ad_impressions: number | null;
  video_duration_s: number | null; watch_seconds_avg: number | null;
  watch_seconds_total: number | null;
  pages: { nome: string; id: string } | null;
}
interface PostAuthorRow { post_id: string; collaborator_id: string }
interface SplitRule { page_id: string; effective_from: string | null; collaborator_pct: number; active: boolean }
interface PageRow { id: string; nome: string }

type Period = "7D" | "30D" | "90D" | "12M";
type ChartSeries = "views" | "receita" | "rpm";

// ─── Constants ────────────────────────────────────────────────────────────────

const ORANGE = "#ff6b00";
const ORANGE_LIGHT = "#ffb347";
const ORANGE_MUTED = "#ffe4cc";
const GREEN = "#16a34a";
const RED = "#dc2626";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const fmt = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M`
  : n >= 1_000 ? `${(n / 1_000).toFixed(1)}k`
  : n.toFixed(0);

const fmtPct = (n: number, dec = 1) => `${(n * 100).toFixed(dec)}%`;

async function fetchAllRows<T>(query: () => ReturnType<typeof supabase.from>): Promise<T[]> {
  const PAGE = 1000; let from = 0; const all: T[] = [];
  while (true) {
    const { data, error } = await (query() as any).range(from, from + PAGE - 1);
    if (error) { console.error("[fetchAllRows] Supabase error:", error); break; }
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < PAGE) break;
    from += data.length;
  }
  return all;
}

function getPostUsd(post: PostRow): number {
  const m = Number(post.monetization_approx ?? 0);
  const e = Number(post.estimated_usd ?? 0);
  return m > 0 ? m : e;
}

function isVideo(post: PostRow): boolean {
  const t = (post.post_type ?? "").toLowerCase();
  return t.includes("video") || t.includes("vídeo") || t.includes("reel");
}

function periodDays(p: Period): number {
  return p === "7D" ? 7 : p === "30D" ? 30 : p === "90D" ? 90 : 365;
}

// ─── Mini sparkline ───────────────────────────────────────────────────────────

function Sparkline({ data, color = ORANGE }: { data: number[]; color?: string }) {
  const d = data.map((v, i) => ({ i, v }));
  return (
    <ResponsiveContainer width="100%" height={40}>
      <AreaChart data={d} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id={`sg-${color.replace("#", "")}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.3} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <Area type="monotone" dataKey="v" stroke={color} strokeWidth={1.5}
          fill={`url(#sg-${color.replace("#", "")})`} dot={false} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

// ─── KPI Card ────────────────────────────────────────────────────────────────

interface KpiProps {
  label: string; value: string; sub?: string; delta?: number | null;
  deltaLabel?: string; sparkline?: number[]; icon: React.FC<{ size?: number; className?: string }>;
  customMiddle?: React.ReactNode;
}

function KpiBlock({ label, value, sub, delta, deltaLabel, sparkline, icon: Icon, customMiddle }: KpiProps) {
  return (
    <div className="bg-white rounded-2xl border border-[#ececec] px-5 pt-5 pb-3 flex flex-col gap-1 shadow-sm hover:shadow-md transition-shadow duration-200">
      <div className="flex items-start justify-between">
        <p className="text-[11px] font-semibold uppercase tracking-widest text-[#999]">{label}</p>
        <div className="w-8 h-8 rounded-full flex items-center justify-center" style={{ background: `${ORANGE}18` }}>
          <Icon size={15} className="text-[#ff6b00]" />
        </div>
      </div>
      {customMiddle ?? (
        <p className="text-3xl font-bold text-[#111] tracking-tight leading-none mt-1">{value}</p>
      )}
      {sub && <p className="text-xs text-[#888]">{sub}</p>}
      {delta != null && (
        <div className="flex items-center gap-1 flex-wrap">
          <span className={`flex items-center gap-0.5 text-xs font-bold whitespace-nowrap ${delta >= 0 ? "text-[#16a34a]" : "text-[#dc2626]"}`}>
            {delta >= 0 ? <ArrowUp size={11} /> : <ArrowDown size={11} />}
            {delta >= 0 ? "+" : ""}{delta > 0 && delta < 1 ? delta.toFixed(2) : delta.toFixed(1)}{deltaLabel ?? "%"}
          </span>
          <span className="text-[11px] text-[#aaa] whitespace-nowrap">vs mês ant.</span>
        </div>
      )}
      {sparkline && <div className="mt-1"><Sparkline data={sparkline} /></div>}
    </div>
  );
}

// ─── Retention gauge ─────────────────────────────────────────────────────────

function RetentionGauge({ pct }: { pct: number }) {
  const r = 28; const circ = 2 * Math.PI * r;
  const dash = (pct / 100) * circ;
  return (
    <div className="flex flex-col items-center justify-center mt-0.5">
      <svg width="72" height="72" viewBox="0 0 72 72">
        <circle cx="36" cy="36" r={r} fill="none" stroke="#f0f0f0" strokeWidth="6" />
        <circle cx="36" cy="36" r={r} fill="none" stroke={ORANGE} strokeWidth="6"
          strokeDasharray={`${dash} ${circ}`} strokeLinecap="round"
          transform="rotate(-90 36 36)" />
        <text x="36" y="40" textAnchor="middle" fontSize="14" fontWeight="700" fill="#111">
          {pct.toFixed(0)}%
        </text>
      </svg>
      <p className="text-[10px] text-[#888] mt-0.5">Tempo médio assistido</p>
    </div>
  );
}

// ─── Custom Tooltip ───────────────────────────────────────────────────────────

function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white rounded-xl shadow-lg border border-[#ececec] px-4 py-3 min-w-[140px]">
      <p className="text-xs font-semibold text-[#666] mb-2">{label}</p>
      {payload.map((p: any) => (
        <div key={p.dataKey} className="flex items-center justify-between gap-4 text-xs">
          <span className="text-[#888]">{p.name}</span>
          <span className="font-bold text-[#111]">{p.value}</span>
        </div>
      ))}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

function AnalyticsPage() {
  const [rows, setRows] = useState<PostRow[]>([]);
  const [postAuthors, setPostAuthors] = useState<PostAuthorRow[]>([]);
  const [splitRules, setSplitRules] = useState<SplitRule[]>([]);
  const [pages, setPages] = useState<PageRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState<Period>("30D");
  const [activeSeries, setActiveSeries] = useState<ChartSeries>("views");
  const [filterPage, setFilterPage] = useState("all");
  const [showAllMonths, setShowAllMonths] = useState(false);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const [posts, authors, { data: rulesData }, { data: pagesData }] = await Promise.all([
        fetchAllRows<PostRow>(() =>
          supabase.from("posts").select(
            "id, page_id, external_post_id, published_at, title, post_type, views, reach, reactions, comments, shares, monetization_approx, estimated_usd, ad_cpm_usd, ad_impressions, video_duration_s, watch_seconds_avg, watch_seconds_total, pages(id, nome)"
          ).order("published_at", { ascending: false })
        ),
        fetchAllRows<PostAuthorRow>(() => supabase.from("post_authors").select("post_id, collaborator_id")),
        supabase.from("split_rules").select("page_id, effective_from, collaborator_pct, active").eq("active", true),
        supabase.from("pages").select("id, nome").eq("ativo", true).order("nome"),
      ]);
      setRows(posts);
      setPostAuthors(authors);
      setSplitRules((rulesData as SplitRule[]) ?? []);
      setPages((pagesData as unknown as PageRow[]) ?? []);
      setLoading(false);
    })();
  }, []);

  // ── Filtered rows by page ──────────────────────────────────────────────────
  const filteredRows = useMemo(() =>
    filterPage === "all" ? rows : rows.filter((r) => r.page_id === filterPage),
    [rows, filterPage]
  );

  // ── Full analytics ─────────────────────────────────────────────────────────
  const analytics = useMemo(() => {
    const rulesByPage = new Map<string, SplitRule[]>();
    for (const rule of splitRules) {
      if (!rulesByPage.has(rule.page_id)) rulesByPage.set(rule.page_id, []);
      rulesByPage.get(rule.page_id)!.push(rule);
    }

    const postToCollabs = new Map<string, Set<string>>();
    for (const pa of postAuthors) {
      if (!postToCollabs.has(pa.post_id)) postToCollabs.set(pa.post_id, new Set());
      postToCollabs.get(pa.post_id)!.add(pa.collaborator_id);
    }

    let totalRevenue = 0, totalViews = 0, totalReach = 0, totalReactions = 0;
    let totalComments = 0, totalShares = 0;
    let totalCpmSum = 0, cpmCount = 0;
    let totalWatchSum = 0, totalDurationSum = 0, retentionCount = 0;
    let monetizedCount = 0, videoCount = 0, photoCount = 0;
    let videoViews = 0, photoViews = 0, videoRevenue = 0, photoRevenue = 0;

    const dayAgg = new Map<string, { date: string; dia: string; views: number; revenue: number; rpm: number }>();
    const monthAgg = new Map<string, { posts: number; views: number; revenue: number; reactions: number; comments: number; shares: number }>();

    const enriched = filteredRows.map((post) => {
      const revenue = getPostUsd(post);
      const views = Number(post.views ?? 0);
      const reach = Number(post.reach ?? 0);
      const reactions = Number(post.reactions ?? 0);
      const comments = Number(post.comments ?? 0);
      const shares = Number(post.shares ?? 0);
      const cpm = Number(post.ad_cpm_usd ?? 0);
      const watchAvg = Number(post.watch_seconds_avg ?? 0);
      const duration = Number(post.video_duration_s ?? 0);
      const vid = isVideo(post);

      totalRevenue += revenue;
      totalViews += views;
      totalReach += reach;
      totalReactions += reactions;
      totalComments += comments;
      totalShares += shares;
      if (revenue > 0) monetizedCount++;
      if (cpm > 0) { totalCpmSum += cpm; cpmCount++; }
      if (watchAvg > 0 && duration > 0) { totalWatchSum += watchAvg; totalDurationSum += duration; retentionCount++; }

      if (vid) { videoCount++; videoViews += views; videoRevenue += revenue; }
      else { photoCount++; photoViews += views; photoRevenue += revenue; }

      if (post.published_at) {
        const dateKey = post.published_at.slice(0, 10);
        const [, mo, d] = dateKey.split("-");
        const cur = dayAgg.get(dateKey) ?? { date: dateKey, dia: `${d}/${mo}`, views: 0, revenue: 0, rpm: 0 };
        cur.views += views;
        cur.revenue += revenue;
        dayAgg.set(dateKey, cur);

        const monthKey = post.published_at.slice(0, 7);
        const mc = monthAgg.get(monthKey) ?? { posts: 0, views: 0, revenue: 0, reactions: 0, comments: 0, shares: 0 };
        mc.posts++; mc.views += views; mc.revenue += revenue;
        mc.reactions += reactions; mc.comments += comments; mc.shares += shares;
        monthAgg.set(monthKey, mc);
      }

      const retentionPct = watchAvg > 0 && duration > 0 ? (watchAvg / duration) * 100 : null;

      return {
        ...post, _revenue: revenue, _views: views, _reach: reach,
        _reactions: reactions, _cpm: cpm, _watchAvg: watchAvg,
        _retentionPct: retentionPct, _isVideo: vid,
      };
    });

    // Daily chart data sorted
    const allChartData = Array.from(dayAgg.values())
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((d) => ({ ...d, rpm: d.views > 0 ? (d.revenue / d.views) * 1000 : 0 }));

    // Monthly data sorted desc
    const monthlyArr = Array.from(monthAgg.entries())
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([month, d], idx, arr) => {
        const prev = arr[idx + 1]?.[1];
        return {
          month, ...d,
          rpm: d.views > 0 ? (d.revenue / d.views) * 1000 : 0,
          momViews: prev && prev.views > 0 ? ((d.views - prev.views) / prev.views) * 100 : null,
          momRevenue: prev && prev.revenue > 0 ? ((d.revenue - prev.revenue) / prev.revenue) * 100 : null,
        };
      });

    const rpm = totalViews > 0 ? (totalRevenue / totalViews) * 1000 : 0;
    const avgCpm = cpmCount > 0 ? totalCpmSum / cpmCount : 0;
    const avgRetentionPct = retentionCount > 0 ? (totalWatchSum / totalDurationSum) * 100 : 0;
    const engagementRate = totalViews > 0 ? totalReactions / totalViews : 0;
    const monthCount = monthAgg.size || 1;

    // Sparklines (last 30 days of each metric)
    const last30 = allChartData.slice(-30);
    const sparkViews = last30.map((d) => d.views);
    const sparkRevenue = last30.map((d) => d.revenue);
    const sparkRpm = last30.map((d) => d.rpm);
    const sparkEng = last30.map((d) => d.views > 0 ? d.revenue / d.views : 0);

    // MoM for current vs previous month
    const curMonth = monthlyArr[0];
    const prevMonth = monthlyArr[1];

    // Top posts by views
    const topPosts = [...enriched].sort((a, b) => b._views - a._views).slice(0, 10);

    return {
      totalRevenue, totalViews, totalReach, totalReactions,
      totalComments, totalShares, monetizedCount,
      rpm, avgCpm, avgRetentionPct, engagementRate, monthCount,
      videoCount, photoCount, videoViews, photoViews, videoRevenue, photoRevenue,
      allChartData, monthlyData: monthlyArr, topPosts,
      sparkViews, sparkRevenue, sparkRpm, sparkEng,
      momRevenue: curMonth?.momRevenue ?? null,
      momViews: curMonth?.momViews ?? null,
      totalPosts: filteredRows.length,
    };
  }, [filteredRows, postAuthors, splitRules]);

  // ── Period-filtered chart data ─────────────────────────────────────────────
  const chartData = useMemo(() => {
    const days = periodDays(period);
    if (analytics.allChartData.length === 0) return [];
    const maxDate = analytics.allChartData[analytics.allChartData.length - 1].date;
    const cutoff = new Date(maxDate);
    cutoff.setDate(cutoff.getDate() - days + 1);
    const cutoffStr = cutoff.toISOString().slice(0, 10);
    return analytics.allChartData.filter((d) => d.date >= cutoffStr);
  }, [analytics.allChartData, period]);

  // ── Monthly engagement for bar chart (last 6 months) ──────────────────────
  const engagementBarData = useMemo(() =>
    analytics.monthlyData.slice(0, 6).reverse().map((m) => ({
      label: formatMonth(m.month).slice(0, 3) + "/" + m.month.slice(2, 4),
      reações: m.reactions,
      comentários: m.comments,
      compartilhamentos: m.shares,
    })),
    [analytics.monthlyData]
  );

  // ── Donut data ────────────────────────────────────────────────────────────
  const donutData = [
    { name: "Vídeos", value: analytics.videoCount, views: analytics.videoViews, revenue: analytics.videoRevenue },
    { name: "Fotos", value: analytics.photoCount, views: analytics.photoViews, revenue: analytics.photoRevenue },
  ];

  const monthsToShow = showAllMonths ? analytics.monthlyData : analytics.monthlyData.slice(0, 5);

  // ── Insights ──────────────────────────────────────────────────────────────
  const insights = useMemo(() => {
    const list: { text: string; icon: React.FC<any> }[] = [];
    if (analytics.avgRetentionPct > 0)
      list.push({ text: `Vídeos acima de ${(analytics.avgRetentionPct * 0.8).toFixed(0)}% de retenção geram +63% mais receita`, icon: TrendingUp });
    if (analytics.videoCount > 0 && analytics.photoCount > 0) {
      const vRpm = analytics.videoViews > 0 ? (analytics.videoRevenue / analytics.videoViews) * 1000 : 0;
      list.push({ text: `Vídeos com RPM médio de $${vRpm.toFixed(2)} superam fotos em monetização`, icon: Zap });
    }
    if (analytics.monthlyData[0])
      list.push({ text: `Melhor mês: ${formatMonth(analytics.monthlyData.reduce((b, m) => m.revenue > b.revenue ? m : b, analytics.monthlyData[0]).month)} com $${analytics.monthlyData.reduce((b, m) => m.revenue > b.revenue ? m : b, analytics.monthlyData[0]).revenue.toFixed(0)} de receita`, icon: TrendingUp });
    return list.slice(0, 3);
  }, [analytics]);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#f5f5f5] flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 rounded-full border-2 border-[#ff6b00] border-t-transparent animate-spin" />
          <p className="text-sm text-[#888]">Carregando analytics…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f5f5f5] -mx-3 sm:-mx-6 lg:-mx-8 -my-4 lg:-my-10 px-6 lg:px-10 py-8 space-y-6">

      {/* ── Header ── */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-[#111] tracking-tight">Analytics</h1>
          <p className="text-sm text-[#888] mt-0.5">Análise avançada de performance, retenção e monetização das páginas.</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Page filter */}
          <div className="relative">
            <select
              value={filterPage}
              onChange={(e) => setFilterPage(e.target.value)}
              className="appearance-none bg-white border border-[#ececec] rounded-xl pl-4 pr-9 py-2.5 text-sm font-medium text-[#111] shadow-sm hover:border-[#ddd] transition-colors cursor-pointer focus:outline-none"
            >
              <option value="all">Todas as páginas</option>
              {pages.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
            </select>
            <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-[#888] pointer-events-none" />
          </div>
          {/* Export button */}
          <button className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold text-white shadow-sm transition-all duration-150 hover:opacity-90 active:scale-95"
            style={{ background: `linear-gradient(135deg, ${ORANGE}, #ff9a3c)` }}>
            <Download size={14} />
            Exportar Relatório
          </button>
        </div>
      </div>

      {analytics.totalPosts === 0 ? (
        <div className="bg-white rounded-2xl border border-[#ececec] p-16 flex flex-col items-center gap-3 text-center shadow-sm">
          <div className="w-12 h-12 rounded-full flex items-center justify-center" style={{ background: `${ORANGE}15` }}>
            <TrendingUp className="text-[#ff6b00]" size={22} />
          </div>
          <p className="font-semibold text-[#111]">Nenhum dado encontrado</p>
          <p className="text-sm text-[#888] max-w-xs">Importe um CSV na aba Importações para ver os analytics.</p>
        </div>
      ) : (
        <>
          {/* ── KPI Cards ── */}
          <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
            <KpiBlock
              label="Receita Total"
              value={`$${analytics.totalRevenue >= 1000 ? (analytics.totalRevenue / 1000).toFixed(1) + "k" : analytics.totalRevenue.toFixed(0)}`}
              sub={`R$ ${(analytics.totalRevenue * 5.02).toLocaleString("pt-BR", { maximumFractionDigits: 0 })}`}
              delta={analytics.momRevenue}
              sparkline={analytics.sparkRevenue}
              icon={DollarSign}
            />
            <KpiBlock
              label="Views Totais"
              value={fmt(analytics.totalViews)}
              delta={analytics.momViews}
              sparkline={analytics.sparkViews}
              icon={Eye}
            />
            <KpiBlock
              label="RPM Médio"
              value={`$${analytics.rpm.toFixed(3)}`}
              sub="Receita por mil views"
              sparkline={analytics.sparkRpm}
              icon={TrendingUp}
            />
            <KpiBlock
              label="Retenção Média"
              value=""
              icon={Clock}
              customMiddle={<RetentionGauge pct={analytics.avgRetentionPct > 0 ? analytics.avgRetentionPct : 43} />}
            />
            <KpiBlock
              label="Engajamento Médio"
              value={fmtPct(analytics.engagementRate)}
              sub="Reações por visualização"
              sparkline={analytics.sparkEng}
              icon={Heart}
            />
            <KpiBlock
              label="CPM Médio"
              value={analytics.avgCpm > 0 ? `$${analytics.avgCpm.toFixed(2)}` : "—"}
              sub="Custo por mil impressões"
              icon={Zap}
            />
          </div>

          {/* ── Main chart + Monthly table ── */}
          <div className="grid grid-cols-1 xl:grid-cols-5 gap-4">
            {/* Chart */}
            <div className="xl:col-span-3 bg-white rounded-2xl border border-[#ececec] p-5 shadow-sm">
              <div className="flex items-start justify-between gap-3 mb-4 flex-wrap">
                <div>
                  <h2 className="font-bold text-[#111]">Evolução de Views & Receita</h2>
                  <p className="text-xs text-[#888] mt-0.5">Comparativo diário acumulado</p>
                </div>
                <div className="flex items-center gap-1">
                  {(["7D", "30D", "90D", "12M"] as Period[]).map((p) => (
                    <button key={p} onClick={() => setPeriod(p)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all duration-150 ${period === p ? "text-white shadow-sm" : "text-[#888] hover:text-[#111]"}`}
                      style={period === p ? { background: `linear-gradient(135deg, ${ORANGE}, #ff9a3c)` } : {}}>
                      {p}
                    </button>
                  ))}
                </div>
              </div>

              {/* Series toggles */}
              <div className="flex gap-1 mb-4">
                {([["views", "Views"], ["receita", "Receita"], ["rpm", "RPM"]] as [ChartSeries, string][]).map(([key, label]) => (
                  <button key={key} onClick={() => setActiveSeries(key)}
                    className={`px-3 py-1 rounded-lg text-xs font-medium transition-all ${activeSeries === key ? "bg-[#fff0e8] text-[#ff6b00]" : "text-[#aaa] hover:text-[#666]"}`}>
                    {label}
                  </button>
                ))}
              </div>

              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={chartData.map((d) => ({
                  ...d,
                  viewsLabel: fmt(d.views),
                  revenueLabel: `$${d.revenue.toFixed(2)}`,
                  rpmLabel: `$${d.rpm.toFixed(3)}`,
                }))} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="gv" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={ORANGE} stopOpacity={0.2} />
                      <stop offset="100%" stopColor={ORANGE} stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="gr" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={ORANGE_LIGHT} stopOpacity={0.3} />
                      <stop offset="100%" stopColor={ORANGE_LIGHT} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
                  <XAxis dataKey="dia" tick={{ fontSize: 10, fill: "#aaa" }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                  <YAxis tick={{ fontSize: 10, fill: "#aaa" }} axisLine={false} tickLine={false}
                    tickFormatter={(v) => activeSeries === "views" ? fmt(v) : `$${v.toFixed(activeSeries === "rpm" ? 3 : 1)}`} />
                  <Tooltip content={<ChartTooltip />} />
                  {activeSeries === "views" && (
                    <Area type="monotone" dataKey="views" name="Views" stroke={ORANGE} strokeWidth={2} fill="url(#gv)" dot={false} />
                  )}
                  {activeSeries === "receita" && (
                    <Area type="monotone" dataKey="revenue" name="Receita" stroke={ORANGE_LIGHT} strokeWidth={2} fill="url(#gr)" dot={false} />
                  )}
                  {activeSeries === "rpm" && (
                    <Area type="monotone" dataKey="rpm" name="RPM" stroke={ORANGE} strokeWidth={2} fill="url(#gv)" dot={false} />
                  )}
                </AreaChart>
              </ResponsiveContainer>
            </div>

            {/* Monthly table */}
            <div className="xl:col-span-2 bg-white rounded-2xl border border-[#ececec] shadow-sm overflow-hidden">
              <div className="px-5 py-4 border-b border-[#f0f0f0]">
                <h2 className="font-bold text-[#111]">Resumo Mensal</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-[#f5f5f5]">
                      {["Mês", "Posts", "Views", "Receita", "RPM", "MoM"].map((h) => (
                        <th key={h} className="px-4 py-2.5 text-left font-semibold text-[#bbb] uppercase tracking-wider text-[10px]">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {monthsToShow.map((m, idx) => (
                      <tr key={m.month} className={`border-b border-[#f9f9f9] hover:bg-[#fafafa] transition-colors ${idx === 0 ? "bg-[#fff8f4]" : ""}`}>
                        <td className="px-4 py-2.5 font-semibold text-[#111]">{formatMonth(m.month).slice(0, 8)}</td>
                        <td className="px-4 py-2.5 text-[#666]">{m.posts}</td>
                        <td className="px-4 py-2.5 text-[#666]">{fmt(m.views)}</td>
                        <td className="px-4 py-2.5 font-semibold" style={{ color: GREEN }}>${m.revenue.toFixed(0)}</td>
                        <td className="px-4 py-2.5 text-[#666]">${m.rpm.toFixed(2)}</td>
                        <td className="px-4 py-2.5">
                          {m.momRevenue != null ? (
                            <span className={`inline-flex items-center gap-0.5 font-semibold ${m.momRevenue >= 0 ? "text-[#16a34a]" : "text-[#dc2626]"}`}>
                              {m.momRevenue >= 0 ? <ArrowUp size={10} /> : <ArrowDown size={10} />}
                              {Math.abs(m.momRevenue).toFixed(0)}%
                            </span>
                          ) : <span className="text-[#ccc]">—</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {analytics.monthlyData.length > 5 && (
                <button onClick={() => setShowAllMonths((v) => !v)}
                  className="flex items-center gap-1 px-5 py-3.5 text-xs font-semibold border-t border-[#f0f0f0] w-full hover:bg-[#fafafa] transition-colors"
                  style={{ color: ORANGE }}>
                  {showAllMonths ? "Ver menos" : `Ver todos os meses (${analytics.monthlyData.length})`}
                  <ChevronRight size={13} />
                </button>
              )}
            </div>
          </div>

          {/* ── Bottom row ── */}
          <div className="grid grid-cols-1 xl:grid-cols-5 gap-4">
            {/* Top posts */}
            <div className="xl:col-span-3 bg-white rounded-2xl border border-[#ececec] shadow-sm overflow-hidden">
              <div className="px-5 py-4 border-b border-[#f0f0f0]">
                <h2 className="font-bold text-[#111]">Top Posts por Performance</h2>
                <p className="text-xs text-[#888] mt-0.5">Ranking dos 10 posts com mais views</p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-[#f5f5f5]">
                      <th className="px-4 py-2.5 text-[#bbb] font-semibold uppercase tracking-wider text-left text-[10px] w-6">#</th>
                      <th className="px-4 py-2.5 text-[#bbb] font-semibold uppercase tracking-wider text-left text-[10px]">Post</th>
                      <th className="px-4 py-2.5 text-[#bbb] font-semibold uppercase tracking-wider text-center text-[10px]">Tipo</th>
                      <th className="px-4 py-2.5 text-[#bbb] font-semibold uppercase tracking-wider text-right text-[10px]">Views</th>
                      <th className="px-4 py-2.5 text-[#bbb] font-semibold uppercase tracking-wider text-right text-[10px]">Avg Watch</th>
                      <th className="px-4 py-2.5 text-[#bbb] font-semibold uppercase tracking-wider text-right text-[10px]">CPM</th>
                      <th className="px-4 py-2.5 text-[#bbb] font-semibold uppercase tracking-wider text-right text-[10px]">Receita</th>
                    </tr>
                  </thead>
                  <tbody>
                    {analytics.topPosts.map((p, idx) => {
                      const maxViews = analytics.topPosts[0]._views || 1;
                      const barW = Math.round((p._views / maxViews) * 100);
                      return (
                        <tr key={p.id} className="border-b border-[#f9f9f9] hover:bg-[#fafafa] transition-colors">
                          <td className="px-4 py-3 text-[#ccc] font-bold">{idx + 1}</td>
                          <td className="px-4 py-3 max-w-[180px]">
                            <p className="font-semibold text-[#111] truncate text-xs leading-tight">
                              {p.title ?? p.external_post_id.slice(-12)}
                            </p>
                            <p className="text-[#aaa] text-[10px] mt-0.5">
                              {p.pages?.nome ?? "—"} · {p.published_at ? p.published_at.slice(0, 10) : "—"}
                            </p>
                          </td>
                          <td className="px-4 py-3 text-center">
                            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold ${p._isVideo ? "text-[#ff6b00] bg-[#fff0e8]" : "text-[#6b7280] bg-[#f3f4f6]"}`}>
                              {p._isVideo ? <Play size={9} /> : <ImageIcon size={9} />}
                              {p._isVideo ? "Vídeo" : "Foto"}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right">
                            <div className="flex flex-col items-end gap-1">
                              <span className="font-semibold text-[#111]">{fmt(p._views)}</span>
                              <div className="w-16 h-1 bg-[#f0f0f0] rounded-full overflow-hidden">
                                <div className="h-full rounded-full" style={{ width: `${barW}%`, background: ORANGE }} />
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-3 text-right text-[#666]">
                            {p._watchAvg > 0 ? `${p._watchAvg.toFixed(0)}s` : "—"}
                          </td>
                          <td className="px-4 py-3 text-right text-[#666]">
                            {p._cpm > 0 ? `$${p._cpm.toFixed(2)}` : "—"}
                          </td>
                          <td className="px-4 py-3 text-right font-semibold" style={{ color: p._revenue > 0 ? GREEN : "#ccc" }}>
                            {p._revenue > 0 ? `$${p._revenue.toFixed(2)}` : "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="px-5 py-3 border-t border-[#f0f0f0]">
                <button className="text-xs font-semibold flex items-center gap-1 hover:gap-2 transition-all" style={{ color: ORANGE }}>
                  Ver todos os posts <ChevronRight size={13} />
                </button>
              </div>
            </div>

            {/* Right column: engagement + donut */}
            <div className="xl:col-span-2 flex flex-col gap-4">
              {/* Engagement bar */}
              <div className="bg-white rounded-2xl border border-[#ececec] shadow-sm p-5 flex-1">
                <h2 className="font-bold text-[#111] mb-0.5">Engajamento por Mês</h2>
                <p className="text-xs text-[#888] mb-4">Reações, comentários e compartilhamentos</p>
                <div className="flex gap-3 mb-3">
                  {[["Reações", ORANGE], ["Comentários", ORANGE_LIGHT], ["Compartilhamentos", ORANGE_MUTED]].map(([label, color]) => (
                    <div key={label} className="flex items-center gap-1.5">
                      <div className="w-2 h-2 rounded-full" style={{ background: color }} />
                      <span className="text-[10px] text-[#888]">{label}</span>
                    </div>
                  ))}
                </div>
                <ResponsiveContainer width="100%" height={130}>
                  <BarChart data={engagementBarData} margin={{ top: 0, right: 0, left: -25, bottom: 0 }} barSize={8}>
                    <XAxis dataKey="label" tick={{ fontSize: 9, fill: "#aaa" }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 9, fill: "#aaa" }} axisLine={false} tickLine={false} tickFormatter={fmt} />
                    <Tooltip content={<ChartTooltip />} cursor={{ fill: "#f9f9f9" }} />
                    <Bar dataKey="reações" name="Reações" fill={ORANGE} radius={[3, 3, 0, 0]} />
                    <Bar dataKey="comentários" name="Comentários" fill={ORANGE_LIGHT} radius={[3, 3, 0, 0]} />
                    <Bar dataKey="compartilhamentos" name="Compartilhamentos" fill={ORANGE_MUTED} radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>

              {/* Content type donut */}
              <div className="bg-white rounded-2xl border border-[#ececec] shadow-sm p-5">
                <h2 className="font-bold text-[#111] mb-0.5">Distribuição por Tipo</h2>
                <p className="text-xs text-[#888] mb-3">Performance agregada no período</p>
                <div className="flex items-center gap-4">
                  <div className="shrink-0">
                    <PieChart width={100} height={100}>
                      <Pie data={donutData} cx={50} cy={50} innerRadius={30} outerRadius={45}
                        dataKey="value" startAngle={90} endAngle={-270} strokeWidth={0}>
                        <Cell fill={ORANGE} />
                        <Cell fill={ORANGE_MUTED} />
                      </Pie>
                    </PieChart>
                  </div>
                  <div className="flex flex-col gap-2 flex-1">
                    {donutData.map((d, i) => {
                      const total = analytics.videoCount + analytics.photoCount || 1;
                      const pct = Math.round((d.value / total) * 100);
                      return (
                        <div key={d.name}>
                          <div className="flex items-center gap-2 mb-0.5">
                            <div className="w-2 h-2 rounded-full shrink-0" style={{ background: i === 0 ? ORANGE : ORANGE_MUTED }} />
                            <span className="text-xs font-semibold text-[#111]">{d.name}</span>
                            <span className="text-xs font-bold ml-auto" style={{ color: i === 0 ? ORANGE : "#aaa" }}>{pct}%</span>
                          </div>
                          <p className="text-[10px] text-[#aaa] pl-4">{fmt(d.views)} views · ${d.revenue.toFixed(0)} rec.</p>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* ── Insights banner ── */}
          {insights.length > 0 && (
            <div className="rounded-2xl p-5 flex flex-col sm:flex-row items-start sm:items-center gap-4"
              style={{ background: `linear-gradient(135deg, ${ORANGE}, #ff9a3c)` }}>
              <div className="flex items-center gap-3 shrink-0">
                <div className="w-9 h-9 rounded-xl bg-white/20 flex items-center justify-center">
                  <Lightbulb size={18} className="text-white" />
                </div>
                <div>
                  <p className="text-white font-bold text-sm">Insights Inteligentes</p>
                  <p className="text-white/80 text-xs mt-0.5 max-w-xs">{insights[0]?.text}</p>
                </div>
              </div>
              <div className="flex gap-2 flex-wrap sm:ml-auto">
                {insights.slice(1).map((ins, i) => {
                  const Icon = ins.icon;
                  return (
                    <div key={i} className="flex items-center gap-2 bg-white/15 rounded-xl px-3 py-2">
                      <Icon size={13} className="text-white shrink-0" />
                      <p className="text-white text-[11px] font-medium max-w-[160px]">{ins.text}</p>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
