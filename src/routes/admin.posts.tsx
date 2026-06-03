import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { formatMonth } from "@/lib/format";
import {
  AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, Tooltip as ReTooltip,
  ResponsiveContainer, CartesianGrid,
} from "recharts";
import {
  DollarSign, Eye, ArrowUp, ArrowDown, Loader2,
  Play, ImageIcon, ChevronDown, ChevronRight,
  Users, BarChart2, Zap, Calendar, Heart,
  TrendingUp, Share2, Bookmark, UserPlus,
} from "lucide-react";

export const Route = createFileRoute("/admin/posts")({
  head: () => ({ meta: [{ title: "Analytics — Splash Creators" }] }),
  component: AnalyticsPage,
});

// ─── Design tokens ────────────────────────────────────────────────────────────

const C = {
  orange: "#ff6b00",
  orangeSoft: "#fff0e6",
  green: "#059669",
  greenSoft: "#ecfdf5",
  red: "#e11d48",
  redSoft: "#fff1f2",
  blue: "#1877F2",
  blueSoft: "#eff6ff",
  purple: "#7c3aed",
  purpleSoft: "#f5f3ff",
  amber: "#d97706",
  amberSoft: "#fffbeb",
  bg: "#f7f8fa",
  card: "#ffffff",
  border: "#e8eaed",
  text: "#0d0d0d",
  sub: "#6b7280",
  muted: "#9ca3af",
  faint: "#f3f4f6",
};

const USD_TO_BRL = 5.02;

// ─── Formatters ───────────────────────────────────────────────────────────────

const fmt = (n: number): string =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M`
  : n >= 1_000 ? `${(n / 1_000).toFixed(1)}k`
  : n.toFixed(0);

const fmtBRL = (usd: number, compact = true): string => {
  const brl = usd * USD_TO_BRL;
  if (!compact) return `R$ ${brl.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (brl >= 1_000_000) return `R$ ${(brl / 1_000_000).toFixed(1)}M`;
  if (brl >= 1_000)     return `R$ ${(brl / 1_000).toFixed(1)}k`;
  return `R$ ${brl.toFixed(2)}`;
};

// ─── Types ────────────────────────────────────────────────────────────────────

type Platform = "all" | "facebook" | "instagram";

interface PostRow {
  id: string;
  page_id: string;
  external_post_id: string;
  published_at: string | null;
  title: string | null;
  post_type: string | null;
  source: string | null;
  views: number | null;
  reach: number | null;
  reactions: number | null;
  comments: number | null;
  shares: number | null;
  saves: number | null;
  follows_gained: number | null;
  monetization_approx: number | null;
  estimated_usd: number | null;
  watch_seconds_avg: number | null;
  video_duration_s: number | null;
  ad_cpm_usd: number | null;
  pages: { nome: string; id: string } | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function fetchAllRows<T>(query: () => any): Promise<T[]> {
  const PAGE = 1000;
  let from = 0;
  const all: T[] = [];
  while (true) {
    const { data, error } = await query().range(from, from + PAGE - 1);
    if (error || !data || data.length === 0) break;
    all.push(...data);
    if (data.length < PAGE) break;
    from += data.length;
  }
  return all;
}

function postUsd(p: PostRow): number {
  const m = Number(p.monetization_approx ?? 0);
  const e = Number(p.estimated_usd ?? 0);
  return m > 0 ? m : e;
}

function isVideo(p: PostRow): boolean {
  const t = (p.post_type ?? "").toLowerCase();
  return t.includes("video") || t.includes("vídeo") || t.includes("reel");
}

// ─── Micro-components ─────────────────────────────────────────────────────────

function Sparkline({
  data, color = C.orange, height = 38,
}: { data: number[]; color?: string; height?: number }) {
  if (!data.length) return null;
  const safe = color.replace(/[^a-z0-9]/gi, "");
  const id = `spk-${safe}`;
  const d = data.map((v, i) => ({ i, v }));
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={d} margin={{ top: 2, right: 0, left: 0, bottom: 2 }}>
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.22} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <Area type="monotone" dataKey="v" stroke={color} strokeWidth={1.5}
          fill={`url(#${id})`} dot={false} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

function Delta({ v, suffix = "%" }: { v: number | null; suffix?: string }) {
  if (v == null) return <span className="text-xs text-[#d1d5db]">—</span>;
  const up = v >= 0;
  return (
    <span className={`inline-flex items-center gap-0.5 text-xs font-bold tabular-nums ${up ? "text-[#059669]" : "text-[#e11d48]"}`}>
      {up ? <ArrowUp size={10} /> : <ArrowDown size={10} />}
      {Math.abs(v) >= 1000
        ? `${(Math.abs(v) / 1000).toFixed(1)}k`
        : `${Math.abs(v).toFixed(1)}`}{suffix}
    </span>
  );
}

// KPI Card
function KpiCard({
  label, value, sub, delta, sparkline, icon: Icon, accent = C.orange,
}: {
  label: string; value: string; sub?: string; delta?: number | null;
  sparkline?: number[]; icon: React.ElementType; accent?: string;
}) {
  return (
    <div className="bg-white rounded-2xl border border-[#e8eaed] px-5 pt-4 pb-3 flex flex-col shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all duration-200">
      <div className="flex items-start justify-between mb-2">
        <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-[#9ca3af]">{label}</span>
        <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0" style={{ background: `${accent}18` }}>
          <Icon size={13} style={{ color: accent }} />
        </div>
      </div>
      <p className="text-[1.6rem] font-black tracking-tight leading-none text-[#0d0d0d]">{value}</p>
      {sub && <p className="text-[11px] text-[#9ca3af] mt-1 leading-snug">{sub}</p>}
      {delta != null && (
        <div className="flex items-center gap-1.5 mt-2">
          <Delta v={delta} />
          <span className="text-[10px] text-[#d1d5db]">vs mês ant.</span>
        </div>
      )}
      {sparkline && sparkline.length > 1 && (
        <div className="mt-2 -mx-1">
          <Sparkline data={sparkline} color={accent} />
        </div>
      )}
    </div>
  );
}

// Platform toggle
function PlatformToggle({ value, onChange }: { value: Platform; onChange: (p: Platform) => void }) {
  return (
    <div className="flex items-center bg-[#f3f4f6] rounded-xl p-0.5 shrink-0">
      {(["all", "facebook", "instagram"] as Platform[]).map((p) => {
        const active = value === p;
        const label = p === "all" ? "Todos" : p === "facebook" ? "Facebook" : "Instagram";
        return (
          <button
            key={p}
            onClick={() => onChange(p)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all whitespace-nowrap ${
              active
                ? "bg-white shadow-sm text-[#0d0d0d]"
                : "text-[#9ca3af] hover:text-[#6b7280]"
            }`}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

// Chart tooltip
function ChartTip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white rounded-xl shadow-lg border border-[#e8eaed] px-4 py-3 min-w-[130px]">
      <p className="text-[10px] font-semibold text-[#9ca3af] mb-2">{label}</p>
      {payload.map((p: any) => (
        <div key={p.dataKey} className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-1.5">
            <div className="w-1.5 h-1.5 rounded-full" style={{ background: p.color }} />
            <span className="text-[11px] text-[#6b7280]">{p.name}</span>
          </div>
          <span className="text-xs font-bold text-[#0d0d0d]">{p.value}</span>
        </div>
      ))}
    </div>
  );
}

// Posting heatmap
const DAYS_SHORT = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const HOUR_LABELS = ["0h", "3h", "6h", "9h", "12h", "15h", "18h", "21h"];

function PostingHeatmap({ grid }: { grid: { count: number; views: number }[][] }) {
  const maxCount = Math.max(...grid.flatMap((r) => r.map((c) => c.count)), 1);
  return (
    <div className="bg-white rounded-2xl border border-[#e8eaed] p-5 shadow-sm">
      <h2 className="font-bold text-[#0d0d0d]">Mapa de Publicações</h2>
      <p className="text-xs text-[#9ca3af] mt-0.5 mb-4">Frequência por dia da semana × hora de publicação</p>
      <div className="flex gap-3">
        {/* Day labels */}
        <div className="flex flex-col justify-around shrink-0 pt-5 pb-0.5">
          {DAYS_SHORT.map((d) => (
            <span key={d} className="text-[10px] text-[#9ca3af] font-medium text-right w-6 leading-none">{d}</span>
          ))}
        </div>
        <div className="flex-1 min-w-0">
          {/* Hour labels */}
          <div className="flex justify-between mb-1.5 px-px">
            {HOUR_LABELS.map((h) => (
              <span key={h} className="text-[9px] text-[#d1d5db] font-medium">{h}</span>
            ))}
          </div>
          {/* Grid cells */}
          <div className="flex flex-col gap-1">
            {grid.map((row, dayIdx) => (
              <div key={dayIdx} className="flex gap-1">
                {row.map((cell, hourIdx) => {
                  const intensity = cell.count === 0 ? 0 : Math.max(0.08, cell.count / maxCount);
                  return (
                    <div
                      key={hourIdx}
                      className="flex-1 rounded-sm"
                      style={{
                        aspectRatio: "1",
                        background: cell.count === 0 ? C.faint : `rgba(255, 107, 0, ${intensity})`,
                        minWidth: 0,
                      }}
                      title={
                        cell.count > 0
                          ? `${DAYS_SHORT[dayIdx]} ${hourIdx}h — ${cell.count} posts · ${fmt(cell.views)} views`
                          : undefined
                      }
                    />
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>
      {/* Legend */}
      <div className="flex items-center gap-1.5 mt-3 justify-end">
        <span className="text-[9px] text-[#d1d5db]">Menos</span>
        {[0, 0.15, 0.35, 0.6, 0.85, 1.0].map((v) => (
          <div key={v} className="w-3 h-3 rounded-sm"
            style={{ background: v === 0 ? C.faint : `rgba(255, 107, 0, ${v})` }} />
        ))}
        <span className="text-[9px] text-[#d1d5db]">Mais</span>
      </div>
    </div>
  );
}

// Engagement funnel
function EngagementFunnel({ items }: {
  items: { label: string; value: number; icon: React.ElementType; color: string }[];
}) {
  const max = items[0]?.value || 1;
  return (
    <div className="bg-white rounded-2xl border border-[#e8eaed] p-5 shadow-sm h-full">
      <h2 className="font-bold text-[#0d0d0d]">Funil de Engajamento</h2>
      <p className="text-xs text-[#9ca3af] mt-0.5 mb-5">Taxa de conversão do alcance à ação</p>
      <div className="flex flex-col gap-3">
        {items.map((item, idx) => {
          const pct = Math.round((item.value / max) * 100);
          const convRate = idx > 0 && items[idx - 1].value > 0
            ? ((item.value / items[idx - 1].value) * 100).toFixed(1)
            : null;
          const Icon = item.icon;
          return (
            <div key={item.label}>
              <div className="flex items-center justify-between mb-1.5">
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 rounded-md flex items-center justify-center"
                    style={{ background: `${item.color}15` }}>
                    <Icon size={11} style={{ color: item.color }} />
                  </div>
                  <span className="text-xs font-semibold text-[#0d0d0d]">{item.label}</span>
                </div>
                <div className="flex items-center gap-2">
                  {convRate && (
                    <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-[#f3f4f6] text-[#6b7280]">
                      {convRate}%
                    </span>
                  )}
                  <span className="text-xs font-bold text-[#0d0d0d] tabular-nums">{fmt(item.value)}</span>
                </div>
              </div>
              <div className="h-2 bg-[#f3f4f6] rounded-full overflow-hidden">
                <div className="h-full rounded-full transition-all duration-700"
                  style={{ width: `${pct}%`, background: item.color }} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

function AnalyticsPage() {
  const [rows, setRows] = useState<PostRow[]>([]);
  const [allPages, setAllPages] = useState<{ id: string; nome: string }[]>([]);
  const [loading, setLoading] = useState(true);

  // ── Filters ──────────────────────────────────────────────────────────────────
  const [platform, setPlatform] = useState<Platform>("all");
  const [filterPage, setFilterPage] = useState("all");
  const today = new Date();
  const [dateFrom, setDateFrom] = useState(
    `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-01`
  );
  const [dateTo, setDateTo] = useState(today.toISOString().slice(0, 10));
  const [chartSeries, setChartSeries] = useState<"views" | "revenue" | "rpm">("views");
  const [showAllPages, setShowAllPages] = useState(false);
  const [showAllMonths, setShowAllMonths] = useState(false);

  // ── Data load ──────────────────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      setLoading(true);
      const [posts, { data: pagesData }] = await Promise.all([
        fetchAllRows<PostRow>(() =>
          supabase.from("posts").select([
            "id", "page_id", "external_post_id", "published_at", "title", "post_type", "source",
            "views", "reach", "reactions", "comments", "shares", "saves", "follows_gained",
            "monetization_approx", "estimated_usd", "watch_seconds_avg", "video_duration_s",
            "ad_cpm_usd", "pages(id, nome)",
          ].join(", ")).order("published_at", { ascending: false })
        ),
        supabase.from("pages").select("id, nome").order("nome"),
      ]);
      setRows(posts);
      setAllPages((pagesData as any[]) ?? []);
      setLoading(false);
    })();
  }, []);

  // ── Filtered rows ──────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    let r = [...rows];
    if (platform === "facebook") r = r.filter((p) => p.source === "facebook" || !p.source);
    if (platform === "instagram") r = r.filter((p) => p.source === "instagram");
    if (filterPage !== "all") r = r.filter((p) => p.page_id === filterPage);
    if (dateFrom) r = r.filter((p) => p.published_at && p.published_at.slice(0, 10) >= dateFrom);
    if (dateTo)   r = r.filter((p) => p.published_at && p.published_at.slice(0, 10) <= dateTo);
    return r;
  }, [rows, platform, filterPage, dateFrom, dateTo]);

  // ── Main analytics ─────────────────────────────────────────────────────────
  const stats = useMemo(() => {
    if (!filtered.length) return null;
    const isIG = platform === "instagram";

    // Accumulators
    let tViews = 0, tReach = 0, tReactions = 0, tComments = 0;
    let tShares = 0, tSaves = 0, tFollows = 0, tRevenue = 0;
    let watchNum = 0, watchDen = 0;
    let vidCount = 0, photoCount = 0;
    let vidViews = 0, photoViews = 0, vidRevenue = 0, photoRevenue = 0;
    let vidReactions = 0, photoReactions = 0;

    const dayMap = new Map<string, { date: string; label: string; views: number; revenue: number }>();
    const monthMap = new Map<string, { posts: number; views: number; revenue: number; reactions: number }>();
    const pageMap = new Map<string, { id: string; nome: string; posts: number; views: number; revenue: number; reactions: number }>();

    // Heatmap [weekday 0-6][hour 0-23]
    const heatmap: { count: number; views: number }[][] =
      Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => ({ count: 0, views: 0 })));

    for (const p of filtered) {
      const v  = Number(p.views    ?? 0);
      const rv = postUsd(p);
      const re = Number(p.reactions ?? 0);
      const co = Number(p.comments  ?? 0);
      const sh = Number(p.shares    ?? 0);
      const sa = Number(p.saves     ?? 0);
      const fo = Number(p.follows_gained ?? 0);
      const rc = Number(p.reach     ?? 0);
      const wa = Number(p.watch_seconds_avg ?? 0);
      const du = Number(p.video_duration_s  ?? 0);
      const vid = isVideo(p);

      tViews += v; tReach += rc; tReactions += re; tComments += co;
      tShares += sh; tSaves += sa; tFollows += fo; tRevenue += rv;
      if (wa > 0 && du > 0) { watchNum += wa; watchDen += du; }

      if (vid) { vidCount++; vidViews += v; vidRevenue += rv; vidReactions += re; }
      else      { photoCount++; photoViews += v; photoRevenue += rv; photoReactions += re; }

      if (p.published_at) {
        const dk = p.published_at.slice(0, 10);
        const [, mo, d] = dk.split("-");
        const de = dayMap.get(dk) ?? { date: dk, label: `${d}/${mo}`, views: 0, revenue: 0 };
        de.views += v; de.revenue += rv;
        dayMap.set(dk, de);

        const mk = dk.slice(0, 7);
        const me = monthMap.get(mk) ?? { posts: 0, views: 0, revenue: 0, reactions: 0 };
        me.posts++; me.views += v; me.revenue += rv; me.reactions += re;
        monthMap.set(mk, me);

        const dt = new Date(p.published_at);
        if (!isNaN(dt.getTime())) {
          heatmap[dt.getDay()][dt.getHours()].count++;
          heatmap[dt.getDay()][dt.getHours()].views += v;
        }

        const pgId = p.page_id;
        const pgName = p.pages?.nome ?? pgId;
        const pge = pageMap.get(pgId) ?? { id: pgId, nome: pgName, posts: 0, views: 0, revenue: 0, reactions: 0 };
        pge.posts++; pge.views += v; pge.revenue += rv; pge.reactions += re;
        pageMap.set(pgId, pge);
      }
    }

    const rpm = tViews > 0 ? (tRevenue / tViews) * 1000 : 0;
    const avgRetention = watchDen > 0 ? (watchNum / watchDen) * 100 : 0;
    const engRate = tViews > 0 ? (tReactions / tViews) * 100 : 0;

    // Daily chart
    const dailyChart = Array.from(dayMap.values())
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((d) => ({
        ...d,
        rpm: d.views > 0 ? (d.revenue / d.views) * 1000 : 0,
        viewsFmt: fmt(d.views),
        revFmt: fmtBRL(d.revenue),
        rpmFmt: fmtBRL(d.views > 0 ? (d.revenue / d.views) * 1000 : 0),
      }));

    // Monthly data (desc)
    const monthlyData = Array.from(monthMap.entries())
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

    // Sparklines (last 30 days)
    const last30 = dailyChart.slice(-30);
    const sparkV   = last30.map((d) => d.views);
    const sparkRev = last30.map((d) => d.revenue);
    const sparkRpm = last30.map((d) => d.rpm);

    // Page ranking
    const pageRanking = Array.from(pageMap.values()).sort((a, b) => b.views - a.views);

    // Top posts (by views)
    const enriched = filtered.map((p) => ({
      ...p,
      _views:    Number(p.views ?? 0),
      _revenue:  postUsd(p),
      _reactions: Number(p.reactions ?? 0),
      _isVideo:  isVideo(p),
      _watchAvg: Number(p.watch_seconds_avg ?? 0),
    }));
    const topPosts = [...enriched].sort((a, b) => b._views - a._views).slice(0, 6);

    // Pareto
    const byViews = [...enriched].sort((a, b) => b._views - a._views);
    let cumV = 0, paretoCount = 0;
    const target80 = tViews * 0.8;
    for (const p of byViews) { cumV += p._views; paretoCount++; if (cumV >= target80) break; }

    return {
      tViews, tReach, tReactions, tComments, tShares, tSaves, tFollows, tRevenue,
      rpm, avgRetention, engRate,
      vidCount, photoCount, vidViews, photoViews, vidRevenue, photoRevenue, vidReactions, photoReactions,
      dailyChart, monthlyData, heatmap, pageRanking, topPosts,
      sparkV, sparkRev, sparkRpm,
      momV: monthlyData[0]?.momViews ?? null,
      momRev: monthlyData[0]?.momRevenue ?? null,
      totalPosts: filtered.length,
      paretoCount,
      paretoTotal: filtered.length,
      isIG,
    };
  }, [filtered, platform]);

  // All-time monthly (for scorecard, ignores date filter)
  const allMonthly = useMemo(() => {
    let r = [...rows];
    if (platform === "facebook") r = r.filter((p) => p.source === "facebook" || !p.source);
    if (platform === "instagram") r = r.filter((p) => p.source === "instagram");
    if (filterPage !== "all") r = r.filter((p) => p.page_id === filterPage);

    const agg = new Map<string, { posts: number; views: number; revenue: number }>();
    for (const p of r) {
      if (!p.published_at) continue;
      const k = p.published_at.slice(0, 7);
      const c = agg.get(k) ?? { posts: 0, views: 0, revenue: 0 };
      c.posts++; c.views += Number(p.views ?? 0); c.revenue += postUsd(p);
      agg.set(k, c);
    }
    return Array.from(agg.entries())
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([month, d], idx, arr) => {
        const prev = arr[idx + 1]?.[1];
        return {
          month, ...d,
          rpm: d.views > 0 ? (d.revenue / d.views) * 1000 : 0,
          momRevenue: prev && prev.revenue > 0 ? ((d.revenue - prev.revenue) / prev.revenue) * 100 : null,
          momViews: prev && prev.views > 0 ? ((d.views - prev.views) / prev.views) * 100 : null,
        };
      });
  }, [rows, platform, filterPage]);

  // ── Loading ───────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-8 h-8 animate-spin text-[#ff6b00]" />
          <p className="text-sm text-[#9ca3af]">Carregando Analytics…</p>
        </div>
      </div>
    );
  }

  const isIG = platform === "instagram";
  const noData = !stats || stats.totalPosts === 0;

  return (
    <div className="min-h-screen bg-[#f7f8fa] -mx-3 sm:-mx-6 lg:-mx-8 -my-4 lg:-my-10 px-4 sm:px-6 lg:px-10 py-8 space-y-5">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-[#0d0d0d] tracking-tight">Analytics</h1>
          <p className="text-sm text-[#9ca3af] mt-0.5">
            Performance, monetização e engajamento —{" "}
            <span className="font-semibold text-[#6b7280]">
              {filtered.length.toLocaleString("pt-BR")} posts
            </span>
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <PlatformToggle value={platform} onChange={(p) => { setPlatform(p); setChartSeries("views"); }} />

          {/* Page filter */}
          <div className="relative">
            <select
              value={filterPage}
              onChange={(e) => setFilterPage(e.target.value)}
              className="appearance-none bg-white border border-[#e8eaed] rounded-xl pl-3 pr-8 py-2 text-xs font-medium text-[#0d0d0d] shadow-sm hover:border-[#d1d5db] transition-colors focus:outline-none"
            >
              <option value="all">Todas as páginas</option>
              {allPages.map((pg) => (
                <option key={pg.id} value={pg.id}>{pg.nome}</option>
              ))}
            </select>
            <ChevronDown size={13} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#9ca3af] pointer-events-none" />
          </div>

          {/* Date range */}
          <div className="flex items-center gap-1.5 bg-white border border-[#e8eaed] rounded-xl px-3 py-2 shadow-sm">
            <Calendar size={12} className="text-[#9ca3af] shrink-0" />
            <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)}
              className="text-xs text-[#0d0d0d] bg-transparent border-none outline-none w-[100px]" />
            <span className="text-[#d1d5db] text-xs select-none">–</span>
            <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)}
              className="text-xs text-[#0d0d0d] bg-transparent border-none outline-none w-[100px]" />
          </div>
        </div>
      </div>

      {/* ── Empty state ────────────────────────────────────────────────────── */}
      {noData ? (
        <div className="bg-white rounded-2xl border border-[#e8eaed] p-20 flex flex-col items-center gap-4">
          <div className="w-12 h-12 rounded-2xl flex items-center justify-center" style={{ background: C.orangeSoft }}>
            <BarChart2 size={22} className="text-[#ff6b00]" />
          </div>
          <p className="font-bold text-[#0d0d0d]">Nenhum dado no período</p>
          <p className="text-sm text-[#9ca3af] text-center max-w-xs">
            Ajuste os filtros de data, plataforma ou página para visualizar os dados.
          </p>
        </div>
      ) : (
        <>
          {/* ── KPI Strip ──────────────────────────────────────────────────── */}
          <div className={`grid gap-3 ${isIG ? "grid-cols-2 lg:grid-cols-5" : "grid-cols-2 lg:grid-cols-5"}`}>

            {!isIG && (
              <KpiCard
                label="Receita Total"
                value={fmtBRL(stats.tRevenue)}
                delta={stats.momRev}
                sparkline={stats.sparkRev}
                icon={DollarSign}
                accent={C.green}
              />
            )}

            <KpiCard
              label="Views Totais"
              value={fmt(stats.tViews)}
              delta={stats.momV}
              sparkline={stats.sparkV}
              icon={Eye}
              accent={C.orange}
            />

            {!isIG && (
              <KpiCard
                label="RPM Médio"
                value={fmtBRL(stats.rpm, false)}
                sub="receita por mil visualizações"
                sparkline={stats.sparkRpm}
                icon={TrendingUp}
                accent={C.amber}
              />
            )}

            <KpiCard
              label="Posts Publicados"
              value={String(stats.totalPosts)}
              sub={`${fmt(stats.tViews / Math.max(stats.totalPosts, 1))} views por post`}
              icon={BarChart2}
              accent={C.blue}
            />

            <KpiCard
              label="Reações Totais"
              value={fmt(stats.tReactions)}
              sub={`${fmt(stats.tComments)} coment. · ${fmt(stats.tShares)} comp.`}
              icon={Heart}
              accent={C.red}
            />

            {isIG ? (
              <KpiCard
                label="Seguimentos"
                value={fmt(stats.tFollows)}
                sub="novos seguidores acumulados"
                icon={UserPlus}
                accent={C.purple}
              />
            ) : (
              <KpiCard
                label="Engajamento"
                value={`${stats.engRate.toFixed(2)}%`}
                sub="reações ÷ visualizações"
                icon={Zap}
                accent={C.purple}
              />
            )}
          </div>

          {/* ── Trend Chart + Content Breakdown ───────────────────────────── */}
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">

            {/* Area chart */}
            <div className="xl:col-span-2 bg-white rounded-2xl border border-[#e8eaed] p-5 shadow-sm">
              <div className="flex items-start justify-between flex-wrap gap-3 mb-4">
                <div>
                  <h2 className="font-bold text-[#0d0d0d]">Evolução Temporal</h2>
                  <p className="text-xs text-[#9ca3af] mt-0.5">Performance diária acumulada no período</p>
                </div>
                <div className="flex gap-0.5 bg-[#f3f4f6] rounded-lg p-0.5">
                  {(
                    [
                      ["views", "Views"],
                      ...(!isIG ? [["revenue", "Receita"], ["rpm", "RPM"]] as [string, string][] : []),
                    ] as [string, string][]
                  ).map(([k, label]) => (
                    <button
                      key={k}
                      onClick={() => setChartSeries(k as any)}
                      className={`px-3 py-1 rounded-md text-xs font-semibold transition-all ${
                        chartSeries === k
                          ? "bg-white shadow-sm text-[#ff6b00]"
                          : "text-[#9ca3af] hover:text-[#6b7280]"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              <ResponsiveContainer width="100%" height={210}>
                <AreaChart data={stats.dailyChart} margin={{ top: 4, right: 4, left: -22, bottom: 0 }}>
                  <defs>
                    <linearGradient id="gOrange" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={C.orange} stopOpacity={0.2} />
                      <stop offset="100%" stopColor={C.orange} stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="gGreen" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={C.green} stopOpacity={0.2} />
                      <stop offset="100%" stopColor={C.green} stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="gAmber" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={C.amber} stopOpacity={0.2} />
                      <stop offset="100%" stopColor={C.amber} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 10, fill: "#9ca3af" }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                  <YAxis tick={{ fontSize: 10, fill: "#9ca3af" }} axisLine={false} tickLine={false}
                    tickFormatter={(v) =>
                      chartSeries === "views" ? fmt(v)
                      : chartSeries === "revenue" ? fmtBRL(v)
                      : fmtBRL(v)
                    }
                  />
                  <ReTooltip content={<ChartTip />} />
                  {chartSeries === "views" && (
                    <Area type="monotone" dataKey="views" name="Views"
                      stroke={C.orange} strokeWidth={2} fill="url(#gOrange)" dot={false} />
                  )}
                  {chartSeries === "revenue" && (
                    <Area type="monotone" dataKey="revenue" name="Receita (USD)"
                      stroke={C.green} strokeWidth={2} fill="url(#gGreen)" dot={false} />
                  )}
                  {chartSeries === "rpm" && (
                    <Area type="monotone" dataKey="rpm" name="RPM (USD)"
                      stroke={C.amber} strokeWidth={2} fill="url(#gAmber)" dot={false} />
                  )}
                </AreaChart>
              </ResponsiveContainer>
            </div>

            {/* Content format breakdown */}
            <div className="bg-white rounded-2xl border border-[#e8eaed] p-5 shadow-sm">
              <h2 className="font-bold text-[#0d0d0d]">Formato de Conteúdo</h2>
              <p className="text-xs text-[#9ca3af] mt-0.5 mb-5">Distribuição e performance por tipo</p>

              {[
                {
                  label: "Vídeos", count: stats.vidCount, views: stats.vidViews,
                  revenue: stats.vidRevenue, reactions: stats.vidReactions,
                  color: C.orange, softColor: C.orangeSoft, icon: Play,
                },
                {
                  label: "Fotos / Imagens", count: stats.photoCount, views: stats.photoViews,
                  revenue: stats.photoRevenue, reactions: stats.photoReactions,
                  color: C.blue, softColor: C.blueSoft, icon: ImageIcon,
                },
              ].map((item) => {
                const total = (stats.vidCount + stats.photoCount) || 1;
                const pct = Math.round((item.count / total) * 100);
                const avgViews = item.count > 0 ? item.views / item.count : 0;
                const Icon = item.icon;
                return (
                  <div key={item.label} className="mb-6 last:mb-0">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-lg flex items-center justify-center"
                          style={{ background: item.softColor }}>
                          <Icon size={13} style={{ color: item.color }} />
                        </div>
                        <span className="text-sm font-semibold text-[#0d0d0d]">{item.label}</span>
                      </div>
                      <span className="text-xs font-black" style={{ color: item.color }}>{pct}%</span>
                    </div>
                    <div className="h-1.5 bg-[#f3f4f6] rounded-full mb-3 overflow-hidden">
                      <div className="h-full rounded-full transition-all duration-700"
                        style={{ width: `${pct}%`, background: item.color }} />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      {[
                        ["Posts", String(item.count)],
                        ["Views/post", fmt(avgViews)],
                        ...(isIG ? [] : [["Receita", fmtBRL(item.revenue)] as [string, string]]),
                        ["Reações", fmt(item.reactions)],
                      ].map(([k, v]) => (
                        <div key={k} className="bg-[#f7f8fa] rounded-xl px-3 py-2">
                          <p className="text-[10px] text-[#9ca3af] mb-0.5">{k}</p>
                          <p className="text-sm font-bold text-[#0d0d0d]">{v}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* ── Page Ranking + Engagement Funnel ──────────────────────────── */}
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">

            {/* Page ranking */}
            <div className="bg-white rounded-2xl border border-[#e8eaed] shadow-sm overflow-hidden">
              <div className="px-5 py-4 border-b border-[#f0f0f0]">
                <h2 className="font-bold text-[#0d0d0d]">Ranking de Páginas</h2>
                <p className="text-xs text-[#9ca3af] mt-0.5">Performance comparativa no período selecionado</p>
              </div>
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-[#f5f5f5]">
                    <th className="px-4 py-2.5 text-left text-[#9ca3af] font-semibold uppercase tracking-wider text-[10px] w-7">#</th>
                    <th className="px-4 py-2.5 text-left text-[#9ca3af] font-semibold uppercase tracking-wider text-[10px]">Página</th>
                    <th className="px-4 py-2.5 text-right text-[#9ca3af] font-semibold uppercase tracking-wider text-[10px] whitespace-nowrap">Posts</th>
                    <th className="px-4 py-2.5 text-right text-[#9ca3af] font-semibold uppercase tracking-wider text-[10px]">Views</th>
                    {!isIG && (
                      <th className="px-4 py-2.5 text-right text-[#9ca3af] font-semibold uppercase tracking-wider text-[10px]">Receita</th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {(showAllPages ? stats.pageRanking : stats.pageRanking.slice(0, 7)).map((pg, idx) => {
                    const maxV = stats.pageRanking[0]?.views || 1;
                    const barW = Math.round((pg.views / maxV) * 100);
                    return (
                      <tr key={pg.id} className="border-b border-[#f9f9f9] hover:bg-[#fafafa] transition-colors">
                        <td className="px-4 py-3">
                          <span className={`text-[11px] font-black ${idx < 3 ? "text-[#ff6b00]" : "text-[#d1d5db]"}`}>
                            {idx + 1}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <p className="font-semibold text-[#0d0d0d] truncate max-w-[200px] text-xs">{pg.nome}</p>
                          <div className="w-full h-1 bg-[#f3f4f6] rounded-full mt-1.5 overflow-hidden">
                            <div className="h-full rounded-full" style={{ width: `${barW}%`, background: C.orange }} />
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right text-[#9ca3af]">{pg.posts}</td>
                        <td className="px-4 py-3 text-right font-bold text-[#0d0d0d]">{fmt(pg.views)}</td>
                        {!isIG && (
                          <td className="px-4 py-3 text-right font-semibold" style={{ color: C.green }}>
                            {pg.revenue > 0 ? fmtBRL(pg.revenue) : "—"}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {stats.pageRanking.length > 7 && (
                <div className="px-5 py-3 border-t border-[#f0f0f0]">
                  <button
                    onClick={() => setShowAllPages((v) => !v)}
                    className="text-xs font-semibold flex items-center gap-1 transition-all hover:gap-2"
                    style={{ color: C.orange }}
                  >
                    {showAllPages ? "Ver menos" : `Ver todas (${stats.pageRanking.length})`}
                    <ChevronRight size={12} className={`transition-transform ${showAllPages ? "rotate-90" : ""}`} />
                  </button>
                </div>
              )}
            </div>

            {/* Engagement funnel */}
            <EngagementFunnel
              items={[
                { label: "Visualizações",    value: stats.tViews,     icon: Eye,     color: C.orange },
                ...(stats.tReach > 0 ? [{ label: "Alcance",       value: stats.tReach,     icon: Users,   color: C.amber }] : []),
                { label: "Reações",          value: stats.tReactions, icon: Heart,   color: C.red    },
                { label: "Comentários",      value: stats.tComments,  icon: TrendingUp, color: C.blue },
                { label: "Compartilhamentos", value: stats.tShares,   icon: Share2,  color: C.purple },
                ...(isIG && stats.tSaves > 0    ? [{ label: "Salvamentos",   value: stats.tSaves,   icon: Bookmark, color: "#0891b2" }] : []),
                ...(isIG && stats.tFollows > 0  ? [{ label: "Seguimentos",   value: stats.tFollows, icon: UserPlus, color: C.purple }] : []),
              ].filter((item) => item.value > 0)}
            />
          </div>

          {/* ── Top Posts ──────────────────────────────────────────────────── */}
          <div>
            <div className="flex items-start justify-between mb-3 flex-wrap gap-2">
              <div>
                <h2 className="font-bold text-[#0d0d0d]">Top Posts do Período</h2>
                <p className="text-xs text-[#9ca3af] mt-0.5">Os 6 posts com maior volume de visualizações</p>
              </div>
              {stats.paretoCount > 0 && (
                <div className="inline-flex items-center gap-2 bg-[#fff0e6] rounded-xl px-3 py-2">
                  <Zap size={12} className="text-[#ff6b00]" />
                  <span className="text-xs font-semibold text-[#ff6b00]">
                    {stats.paretoCount} posts geram 80% das views
                  </span>
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {stats.topPosts.map((post, idx) => {
                const maxV = stats.topPosts[0]?._views || 1;
                const barW = Math.round((post._views / maxV) * 100);
                const rankColors = ["#ff6b00", "#f59e0b", "#f59e0b", "#9ca3af", "#9ca3af", "#9ca3af"];
                return (
                  <div
                    key={post.id}
                    className="bg-white rounded-2xl border border-[#e8eaed] p-4 shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all duration-200"
                  >
                    {/* Top row: rank + type badge */}
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-xs font-black" style={{ color: rankColors[idx] ?? "#9ca3af" }}>
                        #{idx + 1}
                      </span>
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                        post._isVideo ? "text-[#ff6b00] bg-[#fff0e6]" : "text-[#6b7280] bg-[#f3f4f6]"
                      }`}>
                        {post._isVideo ? <Play size={8} /> : <ImageIcon size={8} />}
                        {post._isVideo ? "Vídeo" : "Foto"}
                      </span>
                    </div>

                    {/* Title */}
                    <p className="text-sm font-semibold text-[#0d0d0d] leading-snug line-clamp-2 min-h-[2.6rem] mb-2">
                      {post.title ?? `Post ${post.external_post_id.slice(-8)}`}
                    </p>

                    {/* Page + Date */}
                    <p className="text-[11px] text-[#9ca3af] mb-3 truncate">
                      {post.pages?.nome ?? "—"} · {post.published_at?.slice(0, 10) ?? "—"}
                    </p>

                    {/* Views */}
                    <div className="flex items-end justify-between mb-1">
                      <span className="text-[10px] text-[#9ca3af] font-medium">Views</span>
                      <span className="text-lg font-black text-[#0d0d0d] leading-none">{fmt(post._views)}</span>
                    </div>
                    <div className="h-1.5 bg-[#f3f4f6] rounded-full overflow-hidden mb-3">
                      <div className="h-full rounded-full" style={{ width: `${barW}%`, background: C.orange }} />
                    </div>

                    {/* Bottom stats */}
                    <div className="flex items-center justify-between pt-2.5 border-t border-[#f3f4f6]">
                      <div className="flex items-center gap-1 text-[11px] text-[#9ca3af]">
                        <Heart size={10} />
                        <span>{fmt(post._reactions)}</span>
                      </div>
                      {!isIG && post._revenue > 0 && (
                        <span className="text-xs font-bold" style={{ color: C.green }}>
                          {fmtBRL(post._revenue, false)}
                        </span>
                      )}
                      {post._watchAvg > 0 && (
                        <div className="flex items-center gap-1 text-[11px] text-[#9ca3af]">
                          <span>{post._watchAvg.toFixed(0)}s watch</span>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* ── Posting Heatmap + Monthly Scorecard ───────────────────────── */}
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 pb-4">

            <PostingHeatmap grid={stats.heatmap} />

            {/* Monthly scorecard */}
            <div className="bg-white rounded-2xl border border-[#e8eaed] shadow-sm overflow-hidden">
              <div className="px-5 py-4 border-b border-[#f0f0f0]">
                <h2 className="font-bold text-[#0d0d0d]">Scorecard Mensal</h2>
                <p className="text-xs text-[#9ca3af] mt-0.5">Evolução histórica completa por mês</p>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-xs table-fixed">
                  <thead className="sticky top-0 bg-white border-b border-[#f5f5f5] z-10">
                    <tr>
                      <th className="px-4 py-2.5 text-left text-[#9ca3af] font-semibold uppercase tracking-wider text-[10px] w-[22%]">Mês</th>
                      <th className="px-4 py-2.5 text-right text-[#9ca3af] font-semibold uppercase tracking-wider text-[10px] w-[10%]">Posts</th>
                      <th className="px-4 py-2.5 text-right text-[#9ca3af] font-semibold uppercase tracking-wider text-[10px] w-[16%]">Views</th>
                      {!isIG && <th className="px-4 py-2.5 text-right text-[#9ca3af] font-semibold uppercase tracking-wider text-[10px] w-[18%]">Receita</th>}
                      {!isIG && <th className="px-4 py-2.5 text-right text-[#9ca3af] font-semibold uppercase tracking-wider text-[10px] w-[14%]">RPM</th>}
                      <th className="px-4 pr-5 py-2.5 text-right text-[#9ca3af] font-semibold uppercase tracking-wider text-[10px]">MoM</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(showAllMonths ? allMonthly : allMonthly.slice(0, 9)).map((m, idx) => (
                      <tr
                        key={m.month}
                        className={`border-b border-[#f9f9f9] hover:bg-[#fafafa] transition-colors ${idx === 0 ? "bg-[#fff8f4]" : ""}`}
                      >
                        <td className="px-4 py-2.5 font-semibold text-[#0d0d0d] truncate">
                          {formatMonth(m.month).replace(/\/(\d{4})$/, (_, y) => `/${y.slice(2)}`)}
                          {idx === 0 && (
                            <span className="ml-1.5 text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-[#fff0e6] text-[#ff6b00] align-middle">atual</span>
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-right text-[#9ca3af]">{m.posts}</td>
                        <td className="px-4 py-2.5 text-right font-semibold text-[#0d0d0d]">{fmt(m.views)}</td>
                        {!isIG && (
                          <td className="px-4 py-2.5 text-right font-semibold" style={{ color: C.green }}>
                            {m.revenue > 0 ? fmtBRL(m.revenue) : "—"}
                          </td>
                        )}
                        {!isIG && (
                          <td className="px-4 py-2.5 text-right text-[#6b7280]">
                            {m.rpm > 0 ? fmtBRL(m.rpm, false) : "—"}
                          </td>
                        )}
                        <td className="px-4 pr-5 py-2.5 text-right">
                          <Delta v={isIG ? m.momViews : (m.momRevenue ?? m.momViews)} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {allMonthly.length > 9 && (
                <div className="px-5 py-3 border-t border-[#f0f0f0]">
                  <button
                    onClick={() => setShowAllMonths((v) => !v)}
                    className="text-xs font-semibold flex items-center gap-1 hover:gap-2 transition-all"
                    style={{ color: C.orange }}
                  >
                    {showAllMonths ? "Ver menos" : `Ver todos (${allMonthly.length} meses)`}
                    <ChevronRight size={12} />
                  </button>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
