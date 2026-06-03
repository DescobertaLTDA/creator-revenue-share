import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, useMemo, lazy, Suspense, useRef, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { StatusBadge } from "@/components/app/StatusBadge";
import { EmptyState } from "@/components/app/EmptyState";
import { KpiCard } from "@/components/app/KpiCard";
import { formatBRL, formatDateTime, formatMonth } from "@/lib/format";
import { setPendingImportFile } from "@/lib/pending-import";
import {
  DollarSign, Eye, TrendingUp, Upload, ArrowRight,
  FileSpreadsheet, CheckCircle2, Clock, ChevronRight, ChevronLeft,
  Target, Zap, Users, X, CloudUpload,
  Heart, MessageSquare, Share2, Maximize2, Calendar,
} from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
// recharts is intentionally NOT imported here — all recharts usage lives in
// lazy-loaded components (ProjectionChart, DashboardCharts) so that recharts
// is never statically bundled into this chunk. Static recharts imports cause
// a TDZ "Cannot access before initialization" crash in production bundles due
// to recharts' internal circular dependencies.

const DashboardCharts = lazy(() =>
  import("@/components/app/DashboardCharts").then((m) => ({ default: m.DashboardCharts }))
);

const ProjectionChart = lazy(() =>
  import("@/components/app/ProjectionChart").then((m) => ({ default: m.ProjectionChart }))
);

const DollarChart = lazy(() =>
  import("@/components/app/DollarChart").then((m) => ({ default: m.DollarChart }))
);

export const Route = createFileRoute("/admin/dashboard")({
  head: () => ({ meta: [{ title: "Dashboard - Gestão de Páginas" }] }),
  component: AdminDashboard,
});

// ─── Types ────────────────────────────────────────────────────────────────────

interface RecentImport {
  id: string;
  file_name: string;
  status: string;
  created_at: string;
  valid_rows: number;
  total_rows: number;
  detected_pages_count: number | null;
}

interface RawPost {
  id: string;
  page_id: string;
  published_at: string | null;
  monetization_approx: number | null;
  estimated_usd: number | null;
  views: number | null;
  reach: number | null;
  reactions: number | null;
  comments: number | null;
  shares: number | null;
  title: string | null;
  post_type: string | null;
  permalink: string | null;
  source: "facebook" | "instagram" | null;
}

interface PostAuthorRow {
  post_id: string;
  collaborator_id: string;
}

interface SplitRule {
  page_id: string;
  effective_from: string | null;
  collaborator_pct: number;
  active: boolean;
}

type BonusDistributionMode = "views" | "revenue" | "hybrid";

interface ManualBonusRow {
  id: string;
  bonus_date: string;
  amount_usd: number | string;
  distribution_mode: BonusDistributionMode;
  active: boolean;
}

interface DailyEntry {
  entry_date: string;
  actual_revenue_usd: number | null;
  actual_views: number | null;
  actual_followers: number | null;
  page_id: string | null;
}

interface PageOption { id: string; name: string; source?: "facebook" | "instagram" }
interface ColabOption { id: string; nome: string; hashtag: string | null; avatar_url: string | null }

interface DayData {
  dia: string;
  posts: number;
  views: number;
  alcance: number;
  reacoes: number;
  receita: number;
}

interface ColabCard {
  id: string;
  nome: string;
  hashtag: string | null;
  avatar_url: string | null;
  posts: number;
  views: number;
  reacoes: number;
  receita: number;
}

interface PageStat {
  id: string;
  name: string;
  posts: number;
  views: number;
  reactions: number;
  comments: number;
  shares: number;
  revenue: number;
  rpm: number;
  engagementRate: number;
  isMonetized: boolean;
  score: number;
  videoCount: number;
  imageCount: number;
}

// ─── Skeleton shimmer ─────────────────────────────────────────────────────────

function Sk({ w = "w-full", h = "h-4", className = "" }: { w?: string; h?: string; className?: string }) {
  return <div className={`animate-pulse rounded-md bg-[#E8E8E8] ${w} ${h} ${className}`} />;
}

const SEM_COLAB_ID = "__sem_colaborador__";

const METRIC_TABS_DEF = [
  { key: "receita", label: "Receita" },
] as const;

// ─── Module-level cache (survives route navigation) ───────────────────────────

interface DashCache {
  posts: RawPost[];
  postAuthors: PostAuthorRow[];
  pages: PageOption[];
  colabs: ColabOption[];
  splitRules: SplitRule[];
  imports: RecentImport[];
  ts: number;
}
let _dashCache: DashCache | null = null;
const CACHE_TTL = 3 * 60 * 1000; // 3 minutes

// ─── Utils ───────────────────────────────────────────────────────────────────

const fmt = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M`
  : n >= 1_000 ? `${(n / 1_000).toFixed(1)}k`
  : String(Math.round(n));

async function fetchAllRows<T>(
  query: () => ReturnType<typeof supabase.from>
): Promise<T[]> {
  const PAGE = 1000;
  let from = 0;
  const all: T[] = [];
  while (true) {
    const { data, error } = await (query() as any).range(from, from + PAGE - 1);
    if (error || !data || data.length === 0) break;
    all.push(...data);
    if (data.length < PAGE) break;
    from += data.length;
  }
  return all;
}

function getMonthCountdown(): string {
  const now = new Date();
  // Last moment of the current month
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
  const diff = Math.max(0, end.getTime() - now.getTime());
  const totalSec = Math.floor(diff / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `${String(h).padStart(3, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function fetchUsdBrl(): Promise<number | null> {
  return fetch("https://economia.awesomeapi.com.br/json/last/USD-BRL")
    .then((r) => r.json())
    .then((d) => parseFloat(d.USDBRL.bid))
    .catch(() => null);
}

function getPostUsd(post: RawPost): number {
  const monetizationApprox = Number(post.monetization_approx ?? 0);
  const estimatedUsd = Number(post.estimated_usd ?? 0);
  return monetizationApprox > 0 ? monetizationApprox : estimatedUsd;
}

function getCollaboratorPct(post: RawPost, rulesByPage: Map<string, SplitRule[]>): number {
  const rules = rulesByPage.get(post.page_id) ?? [];
  if (rules.length === 0) return 1;
  const publishedDay = (post.published_at ?? "9999-12-31").slice(0, 10);
  for (const rule of rules) {
    const effectiveDay = (rule.effective_from ?? "0000-01-01").slice(0, 10);
    if (effectiveDay <= publishedDay) return Number(rule.collaborator_pct ?? 0) / 100;
  }
  return Number(rules[rules.length - 1]?.collaborator_pct ?? 0) / 100;
}

function ruleEffectiveDay(rule: SplitRule): string {
  return (rule.effective_from ?? "0000-01-01").slice(0, 10);
}

// Absolute thresholds: what a page must achieve to earn 100% on each dimension.
// Calibrated so R$10,000/month revenue → score near 100.
const SCORE_CAPS = {
  revenueMonthlyUsd: 2_000,  // ≈ R$10k/month
  rpm: 1.00,                  // $1.00 RPM
  viewsMonthly: 3_000_000,   // 3M views/month
  engagementRate: 0.03,       // 3% (reactions+comments+shares / views)
  postsMonthly: 80,           // 80 posts/month
};

function computePageScores(stats: Omit<PageStat, "score">[], periodMonths = 1): PageStat[] {
  return stats.map((p) => {
    const monthlyRevenue = p.revenue / periodMonths;
    const monthlyViews = p.views / periodMonths;
    const monthlyPosts = p.posts / periodMonths;

    const revenueScore = Math.min(monthlyRevenue / SCORE_CAPS.revenueMonthlyUsd, 1) * 100;
    const rpmScore     = Math.min(p.rpm            / SCORE_CAPS.rpm,               1) * 100;
    const viewsScore   = Math.min(monthlyViews     / SCORE_CAPS.viewsMonthly,      1) * 100;
    const engScore     = Math.min(p.engagementRate / SCORE_CAPS.engagementRate,    1) * 100;
    const postScore    = Math.min(monthlyPosts      / SCORE_CAPS.postsMonthly,     1) * 100;

    const raw = revenueScore * 0.35 + rpmScore * 0.25 + viewsScore * 0.20
              + engScore * 0.12 + postScore * 0.08;

    return { ...p, score: Math.min(Math.round(raw), 100) };
  });
}

function scoreColor(score: number): string {
  if (score >= 71) return "bg-emerald-50 text-emerald-700 border border-emerald-200";
  if (score >= 41) return "bg-amber-50 text-amber-700 border border-amber-200";
  return "bg-red-50 text-red-700 border border-red-200";
}

function scoreDot(score: number): string {
  if (score >= 71) return "bg-emerald-500";
  if (score >= 41) return "bg-amber-400";
  return "bg-red-500";
}

// ─── Goals (localStorage) ─────────────────────────────────────────────────────

const GOALS_KEY = "dashboard_goals_v1";

interface Goals {
  receita: number;
  views: number;
  rpm: number;
}

function loadGoals(): Goals {
  try {
    const raw = localStorage.getItem(GOALS_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return { receita: 5000, views: 2000000, rpm: 3.0 };
}

function saveGoals(g: Goals) {
  localStorage.setItem(GOALS_KEY, JSON.stringify(g));
}

// ─── Sparkline component ──────────────────────────────────────────────────────

function MiniSparkline({ data }: { data: number[] }) {
  if (data.length < 2) return <span className="text-xs text-[#6B6B6B]">—</span>;
  const max = Math.max(...data, 1);
  const w = 48; const h = 20;
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * w;
    const y = h - (v / max) * h;
    return `${x},${y}`;
  }).join(" ");
  const last = data[data.length - 1];
  const first = data[0];
  const up = last >= first;
  return (
    <svg width={w} height={h} className="overflow-visible">
      <polyline points={pts} fill="none" stroke={up ? "#16a34a" : "#dc2626"} strokeWidth={1.5} />
    </svg>
  );
}

// ─── Progress bar ─────────────────────────────────────────────────────────────

function GoalBar({ label, current, target, formatVal }: {
  label: string; current: number; target: number; formatVal: (n: number) => string;
}) {
  const pct = Math.min((current / Math.max(target, 0.01)) * 100, 100);
  const ok = pct >= 100;
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-sm">
        <span className="text-[#1A0A00]">{label}</span>
        <span className="tabular-nums font-medium">
          {formatVal(current)}
          <span className="text-[#6B6B6B] font-normal"> / {formatVal(target)}</span>
        </span>
      </div>
      <div className="h-1.5 bg-[#FFF0E8] rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${ok ? "bg-emerald-500" : "bg-gradient-to-r from-[#F44708] to-[#FAA613]"}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="text-xs text-[#6B6B6B]">{pct.toFixed(0)}% da meta</p>
    </div>
  );
}

// ─── Speedometer ─────────────────────────────────────────────────────────────

function DashSpeedometer({ score }: { score: number }) {
  const [display, setDisplay] = useState(score);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = () => { if (timerRef.current) clearTimeout(timerRef.current); };

  const runAnimation = useCallback(() => {
    const peak = 94; // tries to reach here but can't quite make 100
    let frame = 0;

    // Phase 1: rise toward peak (60 steps, ~1.4s) — eases out near top
    const rise = () => {
      frame++;
      const t = frame / 60;
      const eased = 1 - Math.pow(1 - t, 3); // ease-out cubic
      setDisplay(score + (peak - score) * eased);
      if (frame < 60) {
        timerRef.current = setTimeout(rise, 23);
      } else {
        // pause at peak pretending to try harder
        timerRef.current = setTimeout(struggle, 350);
      }
    };

    // Phase 2: tiny final push that fails
    let struggleFrame = 0;
    const struggle = () => {
      struggleFrame++;
      const wobble = Math.sin(struggleFrame * 1.2) * 2; // small shake
      setDisplay(peak + wobble);
      if (struggleFrame < 8) {
        timerRef.current = setTimeout(struggle, 80);
      } else {
        timerRef.current = setTimeout(fall, 200);
      }
    };

    // Phase 3: fall back to real score (40 steps, ~1s) — ease-in
    let fallFrame = 0;
    const fall = () => {
      fallFrame++;
      const t = fallFrame / 40;
      const eased = t * t; // ease-in quad — accelerates as it falls
      setDisplay(peak - (peak - score) * eased);
      if (fallFrame < 40) {
        timerRef.current = setTimeout(fall, 25);
      } else {
        setDisplay(score); // snap to exact value
      }
    };

    rise();
  }, [score]);

  useEffect(() => {
    setDisplay(score);
    // Fire once after 3s on mount (so user sees it quickly the first time)
    timerRef.current = setTimeout(runAnimation, 3000);
    // Then repeat every 2 minutes
    const interval = setInterval(runAnimation, 2 * 60 * 1000);
    return () => { clearTimer(); clearInterval(interval); };
  }, [score, runAnimation]);

  const pct = Math.min(Math.max(display, 0), 100);
  const color = pct >= 75 ? "#16a34a" : pct >= 50 ? "#f59e0b" : pct >= 25 ? "#f97316" : "#F44708";
  const cx = 52, cy = 48, r = 36, sw = 8;
  const arcLen = Math.PI * r;
  const fillLen = (pct / 100) * arcLen;
  const bgPath = `M ${cx - r},${cy} A ${r},${r} 0 0,1 ${cx + r},${cy}`;
  const needleAngle = Math.PI - (pct / 100) * Math.PI;
  const nx = cx + (r - 7) * Math.cos(needleAngle);
  const ny = cy - (r - 7) * Math.sin(needleAngle);
  const ticks = [0, 25, 50, 75, 100].map((t) => {
    const a = Math.PI - (t / 100) * Math.PI;
    const inner = r + sw / 2 + 2;
    const outer = r + sw / 2 + 7;
    return { x1: cx + inner * Math.cos(a), y1: cy - inner * Math.sin(a), x2: cx + outer * Math.cos(a), y2: cy - outer * Math.sin(a) };
  });
  return (
    <svg width="104" height="64" viewBox="0 0 104 64">
      <path d={bgPath} fill="none" stroke="#FFF0E8" strokeWidth={sw} strokeLinecap="round" />
      <path d={bgPath} fill="none" stroke={color} strokeWidth={sw} strokeLinecap="round"
        strokeDasharray={`${fillLen} ${arcLen}`} />
      {ticks.map((t, i) => (
        <line key={i} x1={t.x1} y1={t.y1} x2={t.x2} y2={t.y2} stroke="#FFD9C0" strokeWidth="1.5" />
      ))}
      <text x={cx - r - 1} y={cy + 13} fontSize="8" fill="#6B6B6B" textAnchor="middle">0</text>
      <text x={cx + r + 1} y={cy + 13} fontSize="8" fill="#6B6B6B" textAnchor="middle">100</text>
      <line x1={cx} y1={cy} x2={nx} y2={ny} stroke={color} strokeWidth="2.5" strokeLinecap="round" />
      <circle cx={cx} cy={cy} r="5" fill={color} />
      <circle cx={cx} cy={cy} r="2.5" fill="white" />
    </svg>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

function AdminDashboard() {
  const navigate = useNavigate();
  const { profile } = useAuth();
  // Initialise directly from cache so there is zero loading flash on re-navigation
  const [loading, setLoading] = useState(() => !(_dashCache && Date.now() - _dashCache.ts < CACHE_TTL));
  const [allPosts, setAllPosts] = useState<RawPost[]>(() => _dashCache?.posts ?? []);
  const [postAuthors, setPostAuthors] = useState<PostAuthorRow[]>(() => _dashCache?.postAuthors ?? []);
  const [splitRules, setSplitRules] = useState<SplitRule[]>(() => _dashCache?.splitRules ?? []);
  const [pages, setPages] = useState<PageOption[]>(() => _dashCache?.pages ?? []);
  const [colabs, setColabs] = useState<ColabOption[]>(() => _dashCache?.colabs ?? []);
  const [manualBonuses, setManualBonuses] = useState<ManualBonusRow[]>([]);
  const [dailyEntries, setDailyEntries] = useState<DailyEntry[]>([]);
  const [prevMonthRevenue, setPrevMonthRevenue] = useState<number | null>(null);
  const [dollarHistory, setDollarHistory] = useState<{ date: string; rate: number }[]>([]);
  const [dollarLoading, setDollarLoading] = useState(true);
  const [dollarError, setDollarError] = useState(false);
  // Accumulated unpaid closing balance from previous months (< $100 threshold)
  const [pendingBalance, setPendingBalance] = useState<number>(0);
  const [recentImports, setRecentImports] = useState<RecentImport[]>(() => _dashCache?.imports ?? []);
  const [usdBrl, setUsdBrl] = useState<number | null>(null);
  const [myCollabId, setMyCollabId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"overview" | "charts">("overview");
  const [chartMetric, setChartMetric] = useState<"receita" | "views" | "curtidas" | "comentarios" | "compartilhamentos" | "seguidores">("receita");

  const [showImportModal, setShowImportModal] = useState(false);

  const [showManual, setShowManual] = useState(true);
  const [filterPage, setFilterPage] = useState("all");
  const [filterColab, setFilterColab] = useState("all");
  const [filterFrom, setFilterFrom] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
  });
  const [filterTo, setFilterTo] = useState(() => new Date().toISOString().slice(0, 10));

  const usdIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const load = () =>
      fetchUsdBrl().then((v) => {
        if (v) setUsdBrl(v);
      });
    load();
    usdIntervalRef.current = setInterval(load, 60_000);
    return () => { if (usdIntervalRef.current) clearInterval(usdIntervalRef.current); };
  }, []);

  // Fetch the collaborator linked to the current user's profile (if any)
  useEffect(() => {
    if (!profile?.id) return;
    (supabase as any)
      .from("collaborators")
      .select("id")
      .eq("profile_id", profile.id)
      .maybeSingle()
      .then(({ data }: { data: { id: string } | null }) => {
        setMyCollabId(data?.id ?? null);
      });
  }, [profile?.id]);

  // Fetch total pending balance = sum of total_gross of all open closings from past months (company-wide)
  useEffect(() => {
    const curMonth = new Date().toISOString().slice(0, 7);
    (supabase as any)
      .from("monthly_closings")
      .select("total_gross, month_ref, status")
      .eq("status", "aberto")
      .then(({ data }: any) => {
        // Filter past months in JS (PostgREST lt filter on text dates can be unreliable)
        const total = (data ?? [])
          .filter((e: any) => e.month_ref < curMonth)
          .reduce((s: number, e: any) => s + Number(e.total_gross ?? 0), 0);
        setPendingBalance(total);
      });
  }, []);

  useEffect(() => {
    const applyCache = (cache: DashCache) => {
      setAllPosts(cache.posts);
      setPostAuthors(cache.postAuthors);
      setPages(cache.pages);
      setColabs(cache.colabs);
      setSplitRules(cache.splitRules);
      setRecentImports(cache.imports);
      setLoading(false);
    };

    const doLoad = async (background: boolean) => {
      // Scope posts query to current filter range to avoid paginating ALL historical posts.
      // Extra 90-day buffer back so collaborator bonus computation has prior-month data.
      const dateFrom = (() => {
        if (!filterFrom) return "2020-01-01";
        const d = new Date(filterFrom);
        d.setDate(d.getDate() - 90);
        return d.toISOString().slice(0, 10);
      })();
      const dateTo = filterTo || new Date().toISOString().slice(0, 10);

      const [posts, pas, { data: pagesData }, { data: colabsData }, { data: rulesData }, { data: imports }] =
        await Promise.all([
          fetchAllRows<RawPost>(() =>
            supabase.from("posts").select(
              "id, page_id, published_at, monetization_approx, estimated_usd, views, reach, reactions, comments, shares, title, post_type, permalink, source"
            ).gte("published_at", dateFrom).lte("published_at", dateTo + "T23:59:59")
          ),
          fetchAllRows<PostAuthorRow>(() =>
            supabase.from("post_authors").select("post_id, collaborator_id")
          ),
          supabase.from("pages").select("id, nome"),
          // Include avatar_url in same query — avoids a sequential round-trip
          (supabase as any).from("collaborators").select("id, nome, hashtag, avatar_url").eq("ativo", true),
          supabase.from("split_rules").select("page_id, effective_from, collaborator_pct, active").eq("active", true),
          supabase.from("csv_imports")
            .select("id, file_name, status, created_at, valid_rows, total_rows, detected_pages_count")
            .order("created_at", { ascending: false })
            .limit(5),
        ]);

      const fresh: DashCache = {
        posts,
        postAuthors: pas,
        pages: (() => {
          // Derive source for each page from posts (most common source wins)
          const pageSourceCount = new Map<string, { facebook: number; instagram: number }>();
          for (const post of posts) {
            const src = (post as any).source ?? "facebook";
            const cur = pageSourceCount.get(post.page_id) ?? { facebook: 0, instagram: 0 };
            cur[src as "facebook" | "instagram"] = (cur[src as "facebook" | "instagram"] ?? 0) + 1;
            pageSourceCount.set(post.page_id, cur);
          }
          return (pagesData ?? []).map((p: any) => {
            const counts = pageSourceCount.get(p.id);
            const source = counts && counts.instagram > counts.facebook ? "instagram" : "facebook";
            return { id: p.id, name: p.nome, source };
          });
        })(),
        colabs: (colabsData ?? []).map((c: any) => ({ id: c.id, nome: c.nome, hashtag: c.hashtag, avatar_url: c.avatar_url ?? null })),
        splitRules: (rulesData as SplitRule[]) ?? [],
        imports: (imports ?? []) as RecentImport[],
        ts: Date.now(),
      };
      _dashCache = fresh;
      applyCache(fresh);
      if (!background) setLoading(false);
    };

    const now = Date.now();
    if (_dashCache && now - _dashCache.ts < CACHE_TTL) {
      // State already populated from cache via lazy useState initialisers.
      // Silently refresh in background so data stays fresh.
      doLoad(true);
    } else {
      doLoad(false);
    }
  }, []);

  // Fetch daily revenue entries whenever the date filter changes
  useEffect(() => {
    const fetchEntries = async () => {
      const from = filterFrom || "2020-01-01";
      const to = filterTo || new Date().toISOString().slice(0, 10);
      const { data } = await (supabase as any)
        .from("daily_revenue_entries")
        .select("entry_date, actual_revenue_usd, actual_views, actual_followers, page_id")
        .gte("entry_date", from)
        .lte("entry_date", to);
      setDailyEntries((data ?? []) as DailyEntry[]);
    };
    fetchEntries();
  }, [filterFrom, filterTo]);

  // Fetch previous month total revenue — respects filterPage
  useEffect(() => {
    const fetchPrevMonth = async () => {
      const baseMonth = filterFrom ? filterFrom.slice(0, 7) : (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; })();
      const [y, m] = baseMonth.split("-").map(Number);
      const prevD = new Date(y, m - 2, 1);
      const prevRef = `${prevD.getFullYear()}-${String(prevD.getMonth() + 1).padStart(2, "0")}`;
      const prevLastDay = new Date(prevD.getFullYear(), prevD.getMonth() + 1, 0).getDate();
      let query = (supabase as any)
        .from("daily_revenue_entries")
        .select("actual_revenue_usd")
        .gte("entry_date", `${prevRef}-01`)
        .lte("entry_date", `${prevRef}-${String(prevLastDay).padStart(2, "0")}`);
      if (filterPage !== "all") query = query.eq("page_id", filterPage);
      const { data } = await query;
      const total = (data ?? []).reduce((s: number, e: { actual_revenue_usd: number | null }) => s + Number(e.actual_revenue_usd ?? 0), 0);
      setPrevMonthRevenue(total);
    };
    fetchPrevMonth();
  }, [filterFrom, filterPage]);

  // Fetch 30-day USD/BRL history — tries Frankfurter first, falls back to AwesomeAPI
  useEffect(() => {
    const fetchDollar = async () => {
      setDollarLoading(true);
      setDollarError(false);
      try {
        const end = new Date().toISOString().slice(0, 10);
        const startD = new Date(); startD.setDate(startD.getDate() - 45); // ask 45d, use last 30 with data
        const start = startD.toISOString().slice(0, 10);

        // ── Attempt 1: Frankfurter (ECB data, reliable) ──
        let points: { date: string; rate: number }[] = [];
        try {
          const res = await fetch(
            `https://api.frankfurter.app/${start}..${end}?from=USD&to=BRL`,
            { signal: AbortSignal.timeout(6000) }
          );
          if (res.ok) {
            const json = await res.json();
            points = Object.entries(json.rates as Record<string, { BRL: number }>)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([dateStr, v]) => {
                const [, mo, dd] = dateStr.split("-");
                return { date: `${dd}/${mo}`, rate: v.BRL };
              });
          }
        } catch { /* try fallback */ }

        // ── Attempt 2: AwesomeAPI (Brazilian, has BRL) ──
        if (points.length === 0) {
          const res2 = await fetch(
            "https://economia.awesomeapi.com.br/json/daily/USD-BRL/30",
            { signal: AbortSignal.timeout(6000) }
          );
          if (res2.ok) {
            const arr = await res2.json() as { timestamp: string; bid: string }[];
            points = arr
              .map(e => {
                const d = new Date(Number(e.timestamp) * 1000);
                const dd = String(d.getDate()).padStart(2, "0");
                const mo = String(d.getMonth() + 1).padStart(2, "0");
                return { date: `${dd}/${mo}`, rate: parseFloat(e.bid) };
              })
              .reverse();
          }
        }

        if (points.length > 0) {
          setDollarHistory(points);
        } else {
          setDollarError(true);
        }
      } catch {
        setDollarError(true);
      } finally {
        setDollarLoading(false);
      }
    };
    fetchDollar();
  }, []); // fetch once on mount

  useEffect(() => {
    const loadManualBonuses = async () => {
      const { data, error } = await (supabase as any)
        .from("manual_bonus_entries")
        .select("id, bonus_date, amount_usd, distribution_mode, active")
        .eq("active", true);
      if (!error) setManualBonuses((data ?? []) as ManualBonusRow[]);
    };
    loadManualBonuses();
    const channel = supabase.channel("admin-dash-bonus")
      .on("postgres_changes", { event: "*", schema: "public", table: "manual_bonus_entries" }, loadManualBonuses)
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  useEffect(() => {
    const channel = supabase.channel("admin-dash-colabs")
      .on("postgres_changes", { event: "*", schema: "public", table: "collaborators" }, async () => {
        const { data } = await supabase.from("collaborators").select("id, nome, hashtag").eq("ativo", true);
        const avatarMap2 = new Map<string, string>();
        try {
          const { data: ar, error: ae } = await (supabase as any).from("collaborators").select("id, avatar_url").eq("ativo", true);
          if (!ae && ar) for (const r of ar) if (r.avatar_url) avatarMap2.set(r.id, r.avatar_url);
        } catch { /* ignore */ }
        setColabs((data ?? []).map((c: any) => ({ id: c.id, nome: c.nome, hashtag: c.hashtag, avatar_url: avatarMap2.get(c.id) ?? null })));
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const refresh = async () => {
      const pas = await fetchAllRows<PostAuthorRow>(() =>
        supabase.from("post_authors").select("post_id, collaborator_id")
      );
      setPostAuthors(pas);
    };
    const channel = supabase.channel("admin-dash-authors")
      .on("postgres_changes", { event: "*", schema: "public", table: "post_authors" }, () => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(refresh, 350);
      })
      .subscribe();
    return () => { if (timer) clearTimeout(timer); supabase.removeChannel(channel); };
  }, []);

  // ─── Manual KPI totals (must be before `computed` destructuring) ────────────

  const manualKpiTotals = useMemo(() => {
    let revenue = 0; let views = 0;
    for (const e of dailyEntries) {
      if (filterPage !== "all" && e.page_id !== filterPage) continue;
      if (filterFrom && e.entry_date < filterFrom) continue;
      if (filterTo && e.entry_date > filterTo) continue;
      if (e.actual_revenue_usd != null) revenue += Number(e.actual_revenue_usd);
      if (e.actual_views != null) views += Number(e.actual_views);
    }
    return { revenue, views };
  }, [dailyEntries, filterPage, filterFrom, filterTo]);

  // ─── Computations ──────────────────────────────────────────────────────────

  const computed = useMemo(() => {
    const rulesByPage = new Map<string, SplitRule[]>();
    for (const rule of splitRules) {
      if (!rulesByPage.has(rule.page_id)) rulesByPage.set(rule.page_id, []);
      rulesByPage.get(rule.page_id)!.push(rule);
    }
    for (const [, rules] of rulesByPage) {
      rules.sort((a, b) => ruleEffectiveDay(b).localeCompare(ruleEffectiveDay(a)));
    }

    const postToCollabs = new Map<string, Set<string>>();
    for (const pa of postAuthors) {
      if (!postToCollabs.has(pa.post_id)) postToCollabs.set(pa.post_id, new Set());
      postToCollabs.get(pa.post_id)!.add(pa.collaborator_id);
    }

    // Prev month for bonus distribution
    const baseMonth = filterFrom ? filterFrom.slice(0, 7) : new Date().toISOString().slice(0, 7);
    const [bY, bM] = baseMonth.split("-").map(Number);
    const prevD = new Date(bY, bM - 2, 1);
    const prevMonthRef = `${prevD.getFullYear()}-${String(prevD.getMonth() + 1).padStart(2, "0")}`;
    const prevFrom = `${prevMonthRef}-01`;
    const [pY, pM] = prevMonthRef.split("-").map(Number);
    const prevLastDay = new Date(pY, pM, 0).getDate();
    const prevTo = `${prevMonthRef}-${String(prevLastDay).padStart(2, "0")}`;

    const prevViewsByColab = new Map<string, number>();
    for (const p of allPosts) {
      if (!p.published_at) continue;
      const day = p.published_at.slice(0, 10);
      if (day < prevFrom || day > prevTo) continue;
      const collaboratorIds = Array.from(postToCollabs.get(p.id) ?? []);
      if (collaboratorIds.length === 0) continue;
      const views = Number(p.views ?? 0);
      for (const cid of collaboratorIds) {
        prevViewsByColab.set(cid, (prevViewsByColab.get(cid) ?? 0) + views);
      }
    }
    const totalPrevViews = Array.from(prevViewsByColab.values()).reduce((a, b) => a + b, 0);

    const colabPostIds =
      filterColab !== "all" && filterColab !== SEM_COLAB_ID
        ? new Set(postAuthors.filter((pa) => pa.collaborator_id === filterColab).map((pa) => pa.post_id))
        : null;

    const filtered = allPosts.filter((p) => {
      if (filterPage !== "all" && p.page_id !== filterPage) return false;
      const postCollabs = postToCollabs.get(p.id) ?? new Set<string>();
      if (filterColab === SEM_COLAB_ID && postCollabs.size > 0) return false;
      if (colabPostIds && !colabPostIds.has(p.id)) return false;
      if (filterFrom && p.published_at && p.published_at.slice(0, 10) < filterFrom) return false;
      if (filterTo && p.published_at && p.published_at.slice(0, 10) > filterTo) return false;
      return true;
    });

    const byMonth: Record<string, number> = {};
    const byDay: Record<string, DayData> = {};
    const colabAgg = new Map<string, ColabCard>();
    const pageAgg = new Map<string, Omit<PageStat, "score">>();
    const pageRevPostCounts = new Map<string, number>();
    const colabMap = new Map(colabs.map((c) => [c.id, c]));
    const pageMap = new Map(pages.map((p) => [p.id, p.name]));

    let geralUsd = 0;
    let viewsSum = 0;
    let reacoesSum = 0;

    for (const p of filtered) {
      const val = getPostUsd(p);
      const views = Number(p.views ?? 0);
      const reacoes = Number(p.reactions ?? 0);
      const comments = Number(p.comments ?? 0);
      const shares = Number(p.shares ?? 0);
      const reach = Number(p.reach ?? 0);

      geralUsd += val;
      viewsSum += views;
      reacoesSum += reacoes;

      // Per-page aggregation
      const pageName = pageMap.get(p.page_id) ?? p.page_id.slice(0, 8);
      if (!pageAgg.has(p.page_id)) {
        pageAgg.set(p.page_id, {
          id: p.page_id, name: pageName,
          posts: 0, views: 0, reactions: 0, comments: 0, shares: 0, revenue: 0,
          rpm: 0, engagementRate: 0, isMonetized: false,
          videoCount: 0, imageCount: 0,
        });
      }
      const ps = pageAgg.get(p.page_id)!;
      ps.posts += 1;
      ps.views += views;
      ps.reactions += reacoes;
      ps.comments += comments;
      ps.shares += shares;
      ps.revenue += val;
      if (val > 0) pageRevPostCounts.set(p.page_id, (pageRevPostCounts.get(p.page_id) ?? 0) + 1);
      const t = (p.post_type ?? "").toLowerCase();
      if (t.includes("video") || t === "reel") ps.videoCount += 1;
      else if (t.includes("foto") || t.includes("photo") || t.includes("image")) ps.imageCount += 1;

      if (p.published_at) {
        const m = p.published_at.slice(0, 7);
        byMonth[m] = (byMonth[m] ?? 0) + val;
        const dayKey = p.published_at.slice(0, 10);
        const [, month, day] = dayKey.split("-");
        const label = `${day}/${month}`;
        if (!byDay[dayKey]) byDay[dayKey] = { dia: label, posts: 0, views: 0, alcance: 0, reacoes: 0, receita: 0 };
        byDay[dayKey].posts += 1;
        byDay[dayKey].views += views;
        byDay[dayKey].alcance += reach;
        byDay[dayKey].reacoes += reacoes;
        byDay[dayKey].receita += val;
      }

      const collaboratorIds = Array.from(postToCollabs.get(p.id) ?? []);
      const collaboratorPct = getCollaboratorPct(p, rulesByPage);
      const collaboratorRevenue = val * collaboratorPct;

      if (collaboratorIds.length === 0) {
        const cur = colabAgg.get(SEM_COLAB_ID) ?? { id: SEM_COLAB_ID, nome: "Sem colaborador", hashtag: null, avatar_url: null, posts: 0, views: 0, reacoes: 0, receita: 0 };
        cur.posts += 1; cur.views += views; cur.reacoes += reacoes; cur.receita += collaboratorRevenue;
        colabAgg.set(SEM_COLAB_ID, cur);
      } else {
        const share = collaboratorRevenue / collaboratorIds.length;
        for (const colabId of collaboratorIds) {
          const colab = colabMap.get(colabId);
          const targetId = colab ? colabId : SEM_COLAB_ID;
          const cur = colabAgg.get(targetId) ?? { id: targetId, nome: colab ? colab.nome : "Sem colaborador", hashtag: colab ? colab.hashtag : null, avatar_url: colab ? colab.avatar_url : null, posts: 0, views: 0, reacoes: 0, receita: 0 };
          cur.posts += 1; cur.views += views; cur.reacoes += reacoes; cur.receita += share;
          colabAgg.set(targetId, cur);
        }
      }
    }

    // Finalize per-page RPM, engagement, and monetization status (≥3 revenue posts)
    for (const [id, ps] of pageAgg) {
      ps.rpm = ps.views > 0 ? (ps.revenue / ps.views) * 1000 : 0;
      ps.engagementRate = ps.views > 0 ? (ps.reactions + ps.comments + ps.shares) / ps.views : 0;
      ps.isMonetized = (pageRevPostCounts.get(id) ?? 0) >= 3;
    }

    const purePostsUsd = geralUsd; // CSV-only total, before manual corrections

    // Snapshot of byDay before corrections — used for CSV-only chart when toggle is OFF
    const byDayCsv: typeof byDay = {};
    for (const [k, v] of Object.entries(byDay)) byDayCsv[k] = { ...v };

    // Daily revenue corrections — use actual_revenue_usd from daily_revenue_entries.
    // Entries are now per-page (page_id). When a specific page is selected, only
    // apply corrections for that page. When "all", sum across all pages per day.
    let totalDailyBonus = 0;
    let totalDailyViews = 0; // actual_views from daily entries — distributed to collabs below
    {
      // Group entries by date, summing only entries that match the page filter
      const actualByDate = new Map<string, number>();
      const actualViewsByDate = new Map<string, number>();
      for (const e of dailyEntries) {
        if (filterFrom && e.entry_date < filterFrom) continue;
        if (filterTo && e.entry_date > filterTo) continue;
        if (filterPage !== "all" && e.page_id !== filterPage) continue;
        if (e.actual_revenue_usd !== null)
          actualByDate.set(e.entry_date, (actualByDate.get(e.entry_date) ?? 0) + Number(e.actual_revenue_usd));
        if (e.actual_views != null)
          actualViewsByDate.set(e.entry_date, (actualViewsByDate.get(e.entry_date) ?? 0) + Number(e.actual_views));
      }
      for (const [date, actual] of actualByDate) {
        const postsRevForDay = byDay[date]?.receita ?? 0;
        const correction = actual - postsRevForDay;
        totalDailyBonus += correction;
        const bonusMonth = date.slice(0, 7);
        byMonth[bonusMonth] = (byMonth[bonusMonth] ?? 0) + correction;
        if (byDay[date]) {
          byDay[date].receita += correction;
        } else if (actual > 0) {
          const [, mo, d] = date.split("-");
          byDay[date] = { dia: `${d}/${mo}`, posts: 0, views: 0, alcance: 0, reacoes: 0, receita: actual };
        }
      }
      for (const [date, views] of actualViewsByDate) {
        // Add actual_views into byDay so the chart shows correct views too
        if (byDay[date]) {
          // Only top-up if manual views exceed CSV views (avoid double-count)
          if (views > byDay[date].views) byDay[date].views = views;
        }
        totalDailyViews += views;
      }
      geralUsd += totalDailyBonus;
    }

    const filteredBonuses = manualBonuses.filter((bonus) => {
      if (!bonus.active) return false;
      if (filterFrom && bonus.bonus_date < filterFrom) return false;
      if (filterTo && bonus.bonus_date > filterTo) return false;
      return true;
    });

    // Merge colabs
    const merged = new Map(colabAgg);
    for (const c of colabs) {
      if (!merged.has(c.id)) merged.set(c.id, { id: c.id, nome: c.nome, hashtag: c.hashtag, avatar_url: c.avatar_url, posts: 0, views: 0, reacoes: 0, receita: 0 });
    }
    if (!merged.has(SEM_COLAB_ID)) merged.set(SEM_COLAB_ID, { id: SEM_COLAB_ID, nome: "Sem colaborador", hashtag: null, avatar_url: null, posts: 0, views: 0, reacoes: 0, receita: 0 });

    // CSV-only snapshot (before any manual bonus distribution)
    const mergedCsvSnapshot = new Map(Array.from(merged.entries()).map(([k, v]) => [k, { ...v }]));

    const baseRevenueByColab = new Map<string, number>();
    for (const [id, item] of merged.entries()) {
      if (id !== SEM_COLAB_ID) baseRevenueByColab.set(id, Number(item.receita ?? 0));
    }

    if (totalDailyBonus > 0) {
      if (totalPrevViews > 0) {
        for (const [cid, views] of prevViewsByColab.entries()) {
          const share = (views / totalPrevViews) * totalDailyBonus;
          const item = merged.get(cid);
          if (item) item.receita += share;
        }
      } else {
        const eligibleIds = Array.from(merged.keys()).filter((id) => id !== SEM_COLAB_ID);
        if (eligibleIds.length > 0) {
          const share = totalDailyBonus / eligibleIds.length;
          for (const id of eligibleIds) merged.get(id)!.receita += share;
        }
      }
    }

    // Distribute actual_views from daily entries to collaborators using the same
    // proportional weights as revenue (prevViewsByColab, or equal split as fallback).
    // This ensures the ranking shows meaningful view counts even when the current
    // period has no CSV posts with view data yet.
    if (totalDailyViews > 0) {
      if (totalPrevViews > 0) {
        for (const [cid, w] of prevViewsByColab.entries()) {
          const share = (w / totalPrevViews) * totalDailyViews;
          const item = merged.get(cid);
          if (item) item.views += share;
        }
      } else {
        // Equal split among all collaborators (no previous view data available)
        const eligibleIds = Array.from(merged.keys()).filter((id) => id !== SEM_COLAB_ID);
        if (eligibleIds.length > 0) {
          const share = totalDailyViews / eligibleIds.length;
          for (const id of eligibleIds) merged.get(id)!.views += share;
        }
      }
    }

    for (const bonus of filteredBonuses) {
      const usd = Number(bonus.amount_usd ?? 0);
      if (!Number.isFinite(usd) || usd <= 0) continue;
      geralUsd += usd;
      const bonusMonth = bonus.bonus_date.slice(0, 7);
      byMonth[bonusMonth] = (byMonth[bonusMonth] ?? 0) + usd;
      const [, month, day] = bonus.bonus_date.split("-");
      const label = `${day}/${month}`;
      const currentDay = byDay[bonus.bonus_date] ?? { dia: label, posts: 0, views: 0, alcance: 0, reacoes: 0, receita: 0 };
      currentDay.receita += usd;
      byDay[bonus.bonus_date] = currentDay;

      const eligibleIds = Array.from(merged.keys()).filter((id) => id !== SEM_COLAB_ID);
      if (eligibleIds.length === 0) { merged.get(SEM_COLAB_ID)!.receita += usd; continue; }
      const totalViews = eligibleIds.reduce((sum, id) => sum + Number(merged.get(id)?.views ?? 0), 0);
      const totalRevenue = eligibleIds.reduce((sum, id) => sum + Number(baseRevenueByColab.get(id) ?? 0), 0);
      const weights = new Map<string, number>();
      let totalWeight = 0;
      for (const id of eligibleIds) {
        const item = merged.get(id)!;
        const viewShare = totalViews > 0 ? item.views / totalViews : 0;
        const revenueShare = totalRevenue > 0 ? Number(baseRevenueByColab.get(id) ?? 0) / totalRevenue : 0;
        let weight = bonus.distribution_mode === "views" ? viewShare
          : bonus.distribution_mode === "revenue" ? revenueShare
          : (totalViews > 0 && totalRevenue > 0) ? (viewShare + revenueShare) / 2
          : totalViews > 0 ? viewShare : totalRevenue > 0 ? revenueShare : 0;
        weights.set(id, weight);
        totalWeight += weight;
      }
      if (totalWeight <= 0) { merged.get(SEM_COLAB_ID)!.receita += usd; continue; }
      let remaining = usd;
      eligibleIds.forEach((id, index) => {
        const normalizedWeight = (weights.get(id) ?? 0) / totalWeight;
        const share = index === eligibleIds.length - 1 ? remaining : usd * normalizedWeight;
        remaining -= share;
        merged.get(id)!.receita += share;
      });
    }

    const sortedMonths = Object.entries(byMonth).sort((a, b) => b[0].localeCompare(a[0]));
    const latestMonth = sortedMonths[0]?.[0] ?? new Date().toISOString().slice(0, 7);

    const chartData = Object.entries(byDay)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([, v]) => ({ ...v, receita: parseFloat(v.receita.toFixed(4)) }));

    const chartDataCsv = Object.entries(byDayCsv)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([, v]) => ({ ...v, receita: parseFloat(v.receita.toFixed(4)) }));

    // Revenue projection: avg of last 7 days
    const last7 = chartData.slice(-7);
    const avgDaily = last7.length > 0 ? last7.reduce((s, d) => s + d.receita, 0) / last7.length : 0;

    // Per-page scores (period normalisation applied in computePageScores)
    const periodDays = filterFrom && filterTo
      ? Math.max(1, (new Date(filterTo).getTime() - new Date(filterFrom).getTime()) / 86400000 + 1)
      : 30;
    const periodMonths = periodDays / 30;
    const pageStatsRaw = Array.from(pageAgg.values());
    const pageStats = computePageScores(pageStatsRaw, periodMonths).sort((a, b) => b.score - a.score);

    // Average RPM — total revenue (incl. corrections) ÷ views of monetized pages only
    const totalRevenue = geralUsd;
    const monetizedPages = Array.from(pageAgg.values()).filter((p) => p.isMonetized);
    const monetizedViews = monetizedPages.reduce((s, p) => s + p.views, 0);
    const avgRpm = monetizedViews > 0 ? (totalRevenue / monetizedViews) * 1000 : 0;
    const avgScore = pageStats.length > 0 ? Math.round(pageStats.reduce((s, p) => s + p.score, 0) / pageStats.length) : 0;

    // Sparkline per page (last 14 days of revenue)
    const today = new Date().toISOString().slice(0, 10);
    const sparklineByPage = new Map<string, number[]>();
    for (const p of allPosts) {
      if (!p.published_at) continue;
      const day = p.published_at.slice(0, 10);
      if (day < filterFrom || day > today) continue;
      const val = getPostUsd(p);
      if (!sparklineByPage.has(p.page_id)) sparklineByPage.set(p.page_id, Array(14).fill(0));
      const arr = sparklineByPage.get(p.page_id)!;
      const daysAgo = Math.floor((new Date(today).getTime() - new Date(day).getTime()) / 86400000);
      if (daysAgo < 14) arr[13 - daysAgo] += val;
    }

    // Sparkline per collaborator (last 14 days of revenue share)
    const sparklineByColab = new Map<string, number[]>();
    for (const p of filtered) {
      if (!p.published_at) continue;
      const day = p.published_at.slice(0, 10);
      const daysAgo = Math.floor((new Date(today).getTime() - new Date(day).getTime()) / 86400000);
      if (daysAgo >= 14) continue;
      const val = getPostUsd(p);
      const collaboratorIds = Array.from(postToCollabs.get(p.id) ?? []);
      const targets = collaboratorIds.length > 0 ? collaboratorIds : [SEM_COLAB_ID];
      const colabPct = getCollaboratorPct(p, rulesByPage);
      const share = (val * colabPct) / targets.length;
      for (const cid of targets) {
        if (!sparklineByColab.has(cid)) sparklineByColab.set(cid, Array(14).fill(0));
        sparklineByColab.get(cid)![13 - daysAgo] += share;
      }
    }

    return {
      kpis: {
        totalMonth: geralUsd,
        totalMonthCsv: purePostsUsd,
        totalGeral: geralUsd,
        totalPosts: filtered.length,
        totalViews: viewsSum,
        totalReacoes: reacoesSum,
        avgRpm,
        avgScore,
      },
      chartData,
      chartDataCsv,
      activeMonthRef: latestMonth,
      collabCards: Array.from(merged.values()).sort((a, b) => b.receita - a.receita || (a.nome ?? "").localeCompare(b.nome ?? "", "pt-BR")),
      collabCardsCsv: Array.from(mergedCsvSnapshot.values()).sort((a, b) => b.receita - a.receita || (a.nome ?? "").localeCompare(b.nome ?? "", "pt-BR")),
      rulesByPage,
      postToCollabs,
      pageStats,
      avgDaily,
      projections: {
        today: avgDaily,
        days7: avgDaily * 7,
        days28: avgDaily * 28,
      },
      sparklineByPage,
      sparklineByColab,
    };
  }, [allPosts, postAuthors, splitRules, colabs, manualBonuses, dailyEntries, filterPage, filterColab, filterFrom, filterTo, pages]);

  const {
    kpis, chartData, chartDataCsv, activeMonthRef, collabCards, collabCardsCsv,
    rulesByPage, postToCollabs, pageStats, projections, sparklineByPage, sparklineByColab,
  } = computed;

  const activeCollabCards = showManual ? collabCards : collabCardsCsv;

  // Current user's personal collaborator card (if they are linked to a collaborator)
  const myCard = myCollabId ? activeCollabCards.find(c => c.id === myCollabId) ?? null : null;
  // Respects all active filters (page, date, manual toggle) — same as every other KPI.
  const myReceita = myCard?.receita ?? 0;

  const { totalMonth: correctedTotalMonth, totalMonthCsv, totalViews: csvTotalViews, avgRpm: csvAvgRpm, avgScore } = kpis;

  // When a specific collaborator is selected, use their individual card data for KPIs
  const selectedColabOn = filterColab !== "all" && filterColab !== SEM_COLAB_ID
    ? collabCards.find(c => c.id === filterColab) ?? null
    : null;
  const selectedColabOff = filterColab !== "all" && filterColab !== SEM_COLAB_ID
    ? collabCardsCsv.find(c => c.id === filterColab) ?? null
    : null;

  // ON = show corrected totals (CSV posts + manual corrections); OFF = pure CSV posts only
  const totalMonth = selectedColabOn
    ? (showManual ? selectedColabOn.receita : (selectedColabOff?.receita ?? 0))
    : (showManual ? correctedTotalMonth : totalMonthCsv);
  const effectiveTotalMonthCsv = selectedColabOff?.receita ?? totalMonthCsv;
  const totalViews = selectedColabOn
    ? (showManual ? selectedColabOn.views : (selectedColabOff?.views ?? 0))
    : (showManual && manualKpiTotals.views > 0 ? manualKpiTotals.views : csvTotalViews);
  const effectiveCsvTotalViews = selectedColabOff?.views ?? csvTotalViews;
  const avgRpm = totalViews > 0 && totalMonth > 0
    ? (totalMonth / totalViews) * 1000
    : csvAvgRpm;

  const [auditColabId, setAuditColabId] = useState<string | null>(null);

  const auditData = useMemo(() => {
    if (!auditColabId) return null;
    const colab = auditColabId === SEM_COLAB_ID
      ? { nome: "Sem colaborador", hashtag: null }
      : colabs.find((c) => c.id === auditColabId);
    const card = collabCards.find((c) => c.id === auditColabId);
    const posts = allPosts
      .filter((p) => {
        if (filterPage !== "all" && p.page_id !== filterPage) return false;
        if (filterFrom && p.published_at && p.published_at.slice(0, 10) < filterFrom) return false;
        if (filterTo && p.published_at && p.published_at.slice(0, 10) > filterTo) return false;
        if (auditColabId === SEM_COLAB_ID) return (postToCollabs.get(p.id)?.size ?? 0) === 0;
        return postToCollabs.get(p.id)?.has(auditColabId) ?? false;
      })
      .map((p) => {
        const postUsd = getPostUsd(p);
        const collaboratorPct = getCollaboratorPct(p, rulesByPage);
        const collaboratorPool = postUsd * collaboratorPct;
        const numAuthors = Math.max(1, postToCollabs.get(p.id)?.size ?? 1);
        const share = auditColabId === SEM_COLAB_ID ? collaboratorPool : collaboratorPool / numAuthors;
        return { ...p, postUsd, collaboratorPct, collaboratorPool, numAuthors, share };
      })
      .sort((a, b) => (b.published_at ?? "").localeCompare(a.published_at ?? ""));
    const typeBreakdown = posts.reduce<Record<string, { count: number; views: number; share: number }>>((acc, p) => {
      const t = p.post_type ?? "outro";
      if (!acc[t]) acc[t] = { count: 0, views: 0, share: 0 };
      acc[t].count += 1; acc[t].views += Number(p.views ?? 0); acc[t].share += p.share;
      return acc;
    }, {});
    return { colab, card, posts, typeBreakdown };
  }, [auditColabId, allPosts, postToCollabs, rulesByPage, colabs, collabCards, filterPage, filterFrom, filterTo]);

  // Paleta de cores para múltiplas páginas
  const PAGE_COLORS = [
    "#F44708", "#FAA613", "#FAC46A", "#e11d48", "#d97706",
    "#16a34a", "#0284c7", "#0ea5e9", "#db2777", "#059669",
  ];

  // All multi-page metrics computed in a single loop
  const multiPageAllMetrics = useMemo(() => {
    if (filterPage !== "all") return null;
    type MK = "receita" | "views" | "curtidas" | "comentarios" | "compartilhamentos";
    const mkeys: MK[] = ["receita", "views", "curtidas", "comentarios", "compartilhamentos"];
    const byPageDay: Record<MK, Map<string, Map<string, number>>> = {
      receita: new Map(), views: new Map(), curtidas: new Map(),
      comentarios: new Map(), compartilhamentos: new Map(),
    };
    const pageTotal: Record<MK, Map<string, number>> = {
      receita: new Map(), views: new Map(), curtidas: new Map(),
      comentarios: new Map(), compartilhamentos: new Map(),
    };

    for (const p of allPosts) {
      if (!p.published_at) continue;
      const day = p.published_at.slice(0, 10);
      if (filterFrom && day < filterFrom) continue;
      if (filterTo && day > filterTo) continue;
      const vals: Record<MK, number> = {
        receita: getPostUsd(p),
        views: Number(p.views ?? 0),
        curtidas: Number(p.reactions ?? 0),
        comentarios: Number(p.comments ?? 0),
        compartilhamentos: Number(p.shares ?? 0),
      };
      for (const mk of mkeys) {
        const v = vals[mk];
        if (v <= 0) continue;
        if (!byPageDay[mk].has(p.page_id)) byPageDay[mk].set(p.page_id, new Map());
        const dm = byPageDay[mk].get(p.page_id)!;
        dm.set(day, (dm.get(day) ?? 0) + v);
        pageTotal[mk].set(p.page_id, (pageTotal[mk].get(p.page_id) ?? 0) + v);
      }
    }

    const pageNameById = new Map(pages.map((p) => [p.id, p.name]));

    const buildDataset = (mk: MK) => {
      const pageIds = Array.from(pageTotal[mk].entries())
        .filter(([, t]) => t > 0)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)
        .map(([id]) => id);
      if (pageIds.length === 0) return null;
      const allDays = new Set<string>();
      for (const pid of pageIds) {
        const dm = byPageDay[mk].get(pid);
        if (dm) for (const d of dm.keys()) allDays.add(d);
      }
      const data = Array.from(allDays).sort().map((day) => {
        const [, mo, d] = day.split("-");
        const entry: Record<string, any> = { dia: `${d}/${mo}` };
        for (const pid of pageIds) entry[pid] = byPageDay[mk].get(pid)?.get(day) ?? 0;
        return entry;
      });
      return { data, pageIds, pageNameById, pageTotal: pageTotal[mk] };
    };

    return {
      receita: buildDataset("receita"),
      views: buildDataset("views"),
      curtidas: buildDataset("curtidas"),
      comentarios: buildDataset("comentarios"),
      compartilhamentos: buildDataset("compartilhamentos"),
    };
  }, [allPosts, filterFrom, filterTo, filterPage, pages]);

  // Single-page non-revenue metric chart data
  const singlePageMetricData = useMemo(() => {
    if (filterPage === "all" || chartMetric === "receita") return null;
    if (chartMetric === "seguidores") {
      // followers come from manual entries, not posts
      const byDay = new Map<string, number>();
      for (const e of dailyEntries) {
        if (e.actual_followers == null) continue;
        if (filterPage !== "all" && e.page_id !== filterPage) continue;
        const day = e.entry_date;
        if (filterFrom && day < filterFrom) continue;
        if (filterTo && day > filterTo) continue;
        byDay.set(day, (byDay.get(day) ?? 0) + Number(e.actual_followers));
      }
      return Array.from(byDay.entries())
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([day, value]) => {
          const [, mo, d] = day.split("-");
          return { dia: `${d}/${mo}`, value };
        });
    }
    const fieldMap: Record<string, keyof RawPost> = {
      views: "views", curtidas: "reactions",
      comentarios: "comments", compartilhamentos: "shares",
    };
    const field = fieldMap[chartMetric];
    const byDay = new Map<string, number>();
    for (const p of allPosts) {
      if (p.page_id !== filterPage || !p.published_at) continue;
      const day = p.published_at.slice(0, 10);
      if (filterFrom && day < filterFrom) continue;
      if (filterTo && day > filterTo) continue;
      byDay.set(day, (byDay.get(day) ?? 0) + Number((p as any)[field] ?? 0));
    }
    return Array.from(byDay.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([day, value]) => {
        const [, mo, d] = day.split("-");
        return { dia: `${d}/${mo}`, value };
      });
  }, [allPosts, filterPage, filterFrom, filterTo, chartMetric, dailyEntries]);

  // ── Mission best-month state — declared here so projectionChartData useMemo
  //    (below) can reference allTimeAvgDaily without hitting TDZ.
  //    Previously these were declared ~250 lines later, causing a guaranteed
  //    Temporal Dead Zone crash on every first render.
  const [missionBest, setMissionBest] = useState<{
    posts: number; views: number; usd: number;
    reactions: number; comments: number; shares: number;
    reach: number; monetized: number;
    revenue: number; followers: number; daysRevenue: number; rpm: number;
  } | null>(null);
  const [missionBestIG, setMissionBestIG] = useState<{
    posts: number; views: number; usd: number;
    reactions: number; comments: number; shares: number;
    reach: number; monetized: number; rpm: number;
  } | null>(null);
  const [allTimeAvgDaily, setAllTimeAvgDaily] = useState<number>(0);

  // Projection chart data: full history real + future projection
  // Uses allTimeAvgDaily (weighted avg across ALL historical months) if available, else last-7-days avg
  // Map "dd/mm" → actual_revenue_usd — declared BEFORE projectionChartData so it
  // can be used to seed the cumulative starting point when there is no CSV data.
  const dailyActualByDia = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of dailyEntries) {
      if (e.actual_revenue_usd == null) continue;
      if (filterPage !== "all" && e.page_id !== filterPage) continue;
      const [, mo, d] = e.entry_date.split("-");
      map.set(`${d}/${mo}`, (map.get(`${d}/${mo}`) ?? 0) + Number(e.actual_revenue_usd));
    }
    return map;
  }, [dailyEntries, filterPage]);

  // Projection chart data — same formula as the Projeções (Forecast) tab:
  //   realized = cumulative daily manual entries up to today (null for future)
  //   proj / optimistic / conservative = branch from today's actual total forward
  //   rate = thisMonthRev / elapsed  (current-month daily pace)
  const projectionChartData = useMemo(() => {
    type Row = {
      dia: string;
      real: number | null;
      proj: number | null;
      optimistic: number | null;
      conservative: number | null;
      isToday: boolean;
    };

    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const elapsed = now.getDate();
    const totalDays = new Date(year, now.getMonth() + 1, 0).getDate();
    const curMonthKey = `${year}-${month}`;

    // Daily revenue map from manual entries filtered by page
    const dailyRevByDay = new Map<string, number>();
    for (const e of dailyEntries) {
      if (e.actual_revenue_usd == null) continue;
      if (filterPage !== "all" && e.page_id !== filterPage) continue;
      dailyRevByDay.set(e.entry_date, (dailyRevByDay.get(e.entry_date) ?? 0) + Number(e.actual_revenue_usd));
    }

    // Current month total from manual entries
    const thisMonthRev = [...dailyRevByDay.entries()]
      .filter(([date]) => date.startsWith(curMonthKey))
      .reduce((s, [, v]) => s + v, 0);

    // Daily rate: current month avg; fallback to allTimeAvgDaily or projections.today
    const actualDailyRate =
      elapsed > 0 && thisMonthRev > 0
        ? thisMonthRev / elapsed
        : allTimeAvgDaily > 0
          ? allTimeAvgDaily
          : projections.today;

    let cumRealized = 0;
    const result: Row[] = [];
    for (let day = 1; day <= totalDays; day++) {
      const dateStr = `${year}-${month}-${String(day).padStart(2, "0")}`;
      const dayRev = dailyRevByDay.get(dateStr) ?? 0;
      if (day <= elapsed) cumRealized += dayRev;
      const daysFromToday = day - elapsed;
      result.push({
        dia: String(day),
        real: day <= elapsed ? cumRealized : null,
        proj: day >= elapsed ? +(thisMonthRev + Math.max(0, daysFromToday) * actualDailyRate).toFixed(6) : null,
        optimistic: day >= elapsed ? +(thisMonthRev + Math.max(0, daysFromToday) * actualDailyRate * 1.72).toFixed(6) : null,
        conservative: day >= elapsed ? +(thisMonthRev + Math.max(0, daysFromToday) * actualDailyRate * 0.65).toFixed(6) : null,
        isToday: day === elapsed,
      });
    }
    return result;
  }, [dailyEntries, filterPage, allTimeAvgDaily, projections]);

  // Map "dd/mm" → actual_views (filtered by selected page, for single-page overlay)
  const dailyActualViewsByDia = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of dailyEntries) {
      if (e.actual_views == null) continue;
      if (filterPage !== "all" && e.page_id !== filterPage) continue;
      const [, mo, d] = e.entry_date.split("-");
      map.set(`${d}/${mo}`, (map.get(`${d}/${mo}`) ?? 0) + Number(e.actual_views));
    }
    return map;
  }, [dailyEntries, filterPage]);

  // Map pageId → (dia "dd/mm" → actual_views) for multi-page overlay
  const dailyActualViewsByPage = useMemo(() => {
    const outer = new Map<string, Map<string, number>>();
    for (const e of dailyEntries) {
      if (e.actual_views == null || !e.page_id) continue;
      const [, mo, d] = e.entry_date.split("-");
      const dia = `${d}/${mo}`;
      if (!outer.has(e.page_id)) outer.set(e.page_id, new Map());
      const inner = outer.get(e.page_id)!;
      inner.set(dia, (inner.get(dia) ?? 0) + Number(e.actual_views));
    }
    return outer;
  }, [dailyEntries]);

  // Map pageId → (dia "dd/mm" → actual_followers) for followers chart
  const dailyActualFollowersByPage = useMemo(() => {
    const outer = new Map<string, Map<string, number>>();
    for (const e of dailyEntries) {
      if (e.actual_followers == null || !e.page_id) continue;
      const [, mo, d] = e.entry_date.split("-");
      const dia = `${d}/${mo}`;
      if (!outer.has(e.page_id)) outer.set(e.page_id, new Map());
      const inner = outer.get(e.page_id)!;
      inner.set(dia, (inner.get(dia) ?? 0) + Number(e.actual_followers));
    }
    return outer;
  }, [dailyEntries]);

  // Multi-page followers dataset (same structure as multiPageAllMetrics entries)
  const multiPageFollowersDataset = useMemo(() => {
    if (filterPage !== "all" || dailyActualFollowersByPage.size === 0) return null;
    const pageNameById = new Map(pages.map((p) => [p.id, p.name]));
    const pageTotal = new Map<string, number>();
    for (const [pid, dias] of dailyActualFollowersByPage) {
      let total = 0;
      for (const v of dias.values()) total += v;
      pageTotal.set(pid, total);
    }
    const pageIds = Array.from(pageTotal.entries())
      .filter(([, t]) => t > 0)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([id]) => id);
    if (pageIds.length === 0) return null;
    const allDays = new Set<string>();
    for (const pid of pageIds) {
      const dm = dailyActualFollowersByPage.get(pid);
      if (dm) for (const d of dm.keys()) allDays.add(d);
    }
    // allDays contains "dd/mm" — sort by converting back to comparable form
    const sortedDays = Array.from(allDays).sort((a, b) => {
      const [da, ma] = a.split("/"); const [db, mb] = b.split("/");
      return `${ma}${da}`.localeCompare(`${mb}${db}`);
    });
    const data = sortedDays.map((dia) => {
      const entry: Record<string, any> = { dia };
      for (const pid of pageIds) entry[pid] = dailyActualFollowersByPage.get(pid)?.get(dia) ?? null;
      return entry;
    });
    return { data, pageIds, pageNameById, pageTotal };
  }, [dailyActualFollowersByPage, filterPage, pages]);

  // Scores always computed across ALL pages (date-filtered only, never page-filtered)
  // so a single-page view doesn't self-normalize to 100.
  const globalPageScores = useMemo(() => {
    const pageMap = new Map(pages.map((p) => [p.id, p.name]));
    const agg = new Map<string, Omit<PageStat, "score">>();
    const revCounts = new Map<string, number>();
    for (const p of allPosts) {
      if (filterFrom && p.published_at && p.published_at.slice(0, 10) < filterFrom) continue;
      if (filterTo && p.published_at && p.published_at.slice(0, 10) > filterTo) continue;
      const pageName = pageMap.get(p.page_id) ?? p.page_id.slice(0, 8);
      if (!agg.has(p.page_id)) {
        agg.set(p.page_id, {
          id: p.page_id, name: pageName,
          posts: 0, views: 0, reactions: 0, comments: 0, shares: 0, revenue: 0,
          rpm: 0, engagementRate: 0, isMonetized: false, videoCount: 0, imageCount: 0,
        });
      }
      const ps = agg.get(p.page_id)!;
      const val = getPostUsd(p);
      const views = Number(p.views ?? 0);
      ps.posts += 1; ps.views += views;
      ps.reactions += Number(p.reactions ?? 0);
      ps.comments += Number(p.comments ?? 0);
      ps.shares += Number(p.shares ?? 0);
      ps.revenue += val;
      if (val > 0) revCounts.set(p.page_id, (revCounts.get(p.page_id) ?? 0) + 1);
      const t = (p.post_type ?? "").toLowerCase();
      if (t.includes("video") || t === "reel") ps.videoCount += 1;
      else if (t.includes("foto") || t.includes("photo") || t.includes("image")) ps.imageCount += 1;
    }
    for (const [id, ps] of agg) {
      ps.rpm = ps.views > 0 ? (ps.revenue / ps.views) * 1000 : 0;
      ps.engagementRate = ps.views > 0 ? (ps.reactions + ps.comments + ps.shares) / ps.views : 0;
      ps.isMonetized = (revCounts.get(id) ?? 0) >= 3;
    }
    const periodDays = filterFrom && filterTo
      ? Math.max(1, (new Date(filterTo).getTime() - new Date(filterFrom).getTime()) / 86400000 + 1)
      : 30;
    const scored = computePageScores(Array.from(agg.values()), periodDays / 30);
    return new Map(scored.map((p) => [p.id, p.score]));
  }, [allPosts, filterFrom, filterTo, pages]);

  // Apply global scores onto the (possibly page-filtered) pageStats
  const pageStatsWithGlobalScores = useMemo(
    () => pageStats.map((ps) => ({ ...ps, score: globalPageScores.get(ps.id) ?? ps.score })),
    [pageStats, globalPageScores],
  );

  // A page is monetized only if ≥3 posts generated revenue (1-2 posts = likely system bug)
  const monetizedPageIds = useMemo(() => {
    const counts = new Map<string, number>();
    for (const p of allPosts) {
      if (getPostUsd(p) > 0) counts.set(p.page_id, (counts.get(p.page_id) ?? 0) + 1);
    }
    const ids = new Set<string>();
    for (const [id, count] of counts) {
      if (count >= 3) ids.add(id);
    }
    return ids;
  }, [allPosts]);

  // ─── Render ────────────────────────────────────────────────────────────────

  // ── Hero sparkline (30-day revenue curve) ──────────────────────────────────
  const heroSparkData = chartData.slice(-30).map((d) => d.receita);

  // ── Insights ──────────────────────────────────────────────────────────────
  const insightTopColab = activeCollabCards.find((c) => c.posts > 0);
  const insightPeakDay = chartData.length > 0
    ? chartData.reduce((best, d) => d.receita > best.receita ? d : best, chartData[0])
    : null;
  const manualDelta = showManual ? totalMonth - effectiveTotalMonthCsv : 0;
  const manualDeltaPct = effectiveTotalMonthCsv > 0.001 ? (manualDelta / effectiveTotalMonthCsv) * 100 : 0;

  // ── Previous month posts + views (computed from allPosts, no extra fetch) ──
  const prevMonthStats = useMemo(() => {
    const baseMonth = filterFrom ? filterFrom.slice(0, 7) : new Date().toISOString().slice(0, 7);
    const [y, m] = baseMonth.split("-").map(Number);
    const prevD = new Date(y, m - 2, 1);
    const prevRef = `${prevD.getFullYear()}-${String(prevD.getMonth() + 1).padStart(2, "0")}`;
    const monthNames = ["jan","fev","mar","abr","mai","jun","jul","ago","set","out","nov","dez"];
    const label = `${monthNames[prevD.getMonth()]}/${String(prevD.getFullYear()).slice(2)}`;
    let posts = 0, views = 0;
    for (const p of allPosts) {
      if (!p.published_at) continue;
      if (!p.published_at.startsWith(prevRef)) continue;
      if (filterPage !== "all" && p.page_id !== filterPage) continue;
      posts += 1;
      views += Number(p.views ?? 0);
    }
    return { posts, views, label };
  }, [allPosts, filterFrom, filterPage]);

  // ── Top 5 colaboradores do mês passado (fallback quando período atual vazio) ──
  const prevMonthTopColabs = useMemo(() => {
    const baseMonth = filterFrom ? filterFrom.slice(0, 7) : new Date().toISOString().slice(0, 7);
    const [y, m] = baseMonth.split("-").map(Number);
    const prevD = new Date(y, m - 2, 1);
    const prevRef = `${prevD.getFullYear()}-${String(prevD.getMonth() + 1).padStart(2, "0")}`;
    const postsByColab = new Map<string, number>();
    for (const p of allPosts) {
      if (!p.published_at || !p.published_at.startsWith(prevRef)) continue;
      const collabIds = postToCollabs.get(p.id) ?? new Set<string>();
      for (const colabId of collabIds) {
        postsByColab.set(colabId, (postsByColab.get(colabId) ?? 0) + 1);
      }
    }
    return Array.from(postsByColab.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([id]) => activeCollabCards.find((c) => c.id === id) ?? null)
      .filter((c): c is NonNullable<typeof c> => c !== null);
  }, [allPosts, filterFrom, postToCollabs, activeCollabCards]);

  // ── Month countdown timer ─────────────────────────────────────────────────
  const [monthCountdown, setMonthCountdown] = useState(getMonthCountdown);
  useEffect(() => {
    const id = setInterval(() => setMonthCountdown(getMonthCountdown()), 1000);
    return () => clearInterval(id);
  }, []);

  const avgScoreVal = !loading && pageStatsWithGlobalScores.length > 0
    ? Math.round(pageStatsWithGlobalScores.reduce((s, p) => s + p.score, 0) / pageStatsWithGlobalScores.length)
    : 0;

  // ── Mission best-month benchmarks: full DB fetch, independent of date filter ──
  // (missionBest and allTimeAvgDaily state are declared earlier in the file,
  //  before projectionChartData useMemo, to avoid TDZ crash.)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // Fetch ALL posts (FB + IG) for best-ever computation
        type PostRow = { published_at: string; monetization_approx: number | null; estimated_usd: number | null; views: number | null; reactions: number | null; comments: number | null; shares: number | null; reach: number | null; source: string | null };
        const allHistPosts: PostRow[] = [];
        let from = 0;
        while (true) {
          const { data, error } = await (supabase as any)
            .from("posts")
            .select("published_at,monetization_approx,estimated_usd,views,reactions,comments,shares,reach,source")
            .not("published_at", "is", null)
            .range(from, from + 999);
          if (error || !data || data.length === 0) break;
          allHistPosts.push(...data);
          if (data.length < 1000) break;
          from += data.length;
        }

        // Monthly aggregates helper
        type PM = { posts: number; usd: number; views: number; reactions: number; comments: number; shares: number; reach: number; monetized: number };
        const aggregateByMonth = (posts: PostRow[]) => {
          const byM = new Map<string, PM>();
          for (const p of posts) {
            const mo = p.published_at.slice(0, 7);
            if (!byM.has(mo)) byM.set(mo, { posts: 0, usd: 0, views: 0, reactions: 0, comments: 0, shares: 0, reach: 0, monetized: 0 });
            const m = byM.get(mo)!;
            const usd = Number(p.monetization_approx ?? p.estimated_usd ?? 0);
            m.posts += 1; m.usd += usd;
            if (usd > 0) m.monetized += 1;
            m.views += Number(p.views ?? 0);
            m.reactions += Number(p.reactions ?? 0);
            m.comments += Number(p.comments ?? 0);
            m.shares += Number(p.shares ?? 0);
            m.reach += Number(p.reach ?? 0);
          }
          return byM;
        };

        const fbPosts = allHistPosts.filter((p) => (p.source ?? "facebook") === "facebook");
        const igPosts = allHistPosts.filter((p) => p.source === "instagram");
        const pByM = aggregateByMonth(fbPosts);
        const pByMIG = aggregateByMonth(igPosts);

        // Fetch ALL daily entries
        const { data: entrData } = await (supabase as any)
          .from("daily_revenue_entries")
          .select("entry_date,actual_revenue_usd,actual_followers");
        type EM = { revenue: number; followers: number; days: Set<string> };
        const eByM = new Map<string, EM>();
        for (const e of (entrData ?? [])) {
          const mo = e.entry_date.slice(0, 7);
          if (!eByM.has(mo)) eByM.set(mo, { revenue: 0, followers: 0, days: new Set() });
          const m = eByM.get(mo)!;
          if (e.actual_revenue_usd != null && Number(e.actual_revenue_usd) > 0) {
            m.revenue += Number(e.actual_revenue_usd);
            m.days.add(e.entry_date);
          }
          if (e.actual_followers != null) m.followers += Number(e.actual_followers);
        }

        // Find best month for each metric
        const b = { posts: 1, views: 1, usd: 1, reactions: 1, comments: 1, shares: 1, reach: 1, monetized: 1, revenue: 1, followers: 1, days: 1, rpm: 0.001 };
        for (const m of pByM.values()) {
          if (m.posts > b.posts) b.posts = m.posts;
          if (m.usd > b.usd) b.usd = m.usd;
          if (m.views > b.views) b.views = m.views;
          if (m.reactions > b.reactions) b.reactions = m.reactions;
          if (m.comments > b.comments) b.comments = m.comments;
          if (m.shares > b.shares) b.shares = m.shares;
          if (m.reach > b.reach) b.reach = m.reach;
          if (m.monetized > b.monetized) b.monetized = m.monetized;
          const rpm = m.views > 0 ? (m.usd / m.views) * 1000 : 0;
          if (rpm > b.rpm) b.rpm = rpm;
        }
        for (const m of eByM.values()) {
          if (m.revenue > b.revenue) b.revenue = m.revenue;
          if (m.followers > b.followers) b.followers = m.followers;
          if (m.days.size > b.days) b.days = m.days.size;
        }

        // Weighted avg daily CSV revenue across ALL months (recent months weight more)
        // Weight = chronological index (oldest=1, newest=N) → recent data matters more
        const sortedMonths = Array.from(pByM.entries())
          .filter(([, m]) => m.usd > 0)
          .sort((a, b) => a[0].localeCompare(b[0]));
        let wSum = 0, wTotal = 0;
        for (let i = 0; i < sortedMonths.length; i++) {
          const [mo, m] = sortedMonths[i];
          const [y, mn] = mo.split("-").map(Number);
          const daysInMonth = new Date(y, mn, 0).getDate();
          const dailyAvg = m.usd / daysInMonth;
          const weight = i + 1; // recent = higher index = higher weight
          wSum += dailyAvg * weight;
          wTotal += weight;
        }
        const computedAllTimeAvgDaily = wTotal > 0 ? wSum / wTotal : 0;

        // Compute IG bests
        const ig = { posts: 1, views: 1, usd: 1, reactions: 1, comments: 1, shares: 1, reach: 1, monetized: 1, rpm: 0.001 };
        for (const m of pByMIG.values()) {
          if (m.posts > ig.posts) ig.posts = m.posts;
          if (m.usd > ig.usd) ig.usd = m.usd;
          if (m.views > ig.views) ig.views = m.views;
          if (m.reactions > ig.reactions) ig.reactions = m.reactions;
          if (m.comments > ig.comments) ig.comments = m.comments;
          if (m.shares > ig.shares) ig.shares = m.shares;
          if (m.reach > ig.reach) ig.reach = m.reach;
          if (m.monetized > ig.monetized) ig.monetized = m.monetized;
          const igRpm = m.views > 0 ? (m.usd / m.views) * 1000 : 0;
          if (igRpm > ig.rpm) ig.rpm = igRpm;
        }

        if (!cancelled) {
          setMissionBest({
            posts: b.posts, views: b.views, usd: b.usd,
            reactions: b.reactions, comments: b.comments, shares: b.shares,
            reach: b.reach, monetized: b.monetized,
            revenue: b.revenue, followers: b.followers,
            daysRevenue: b.days, rpm: b.rpm,
          });
          setMissionBestIG({
            posts: ig.posts, views: ig.views, usd: ig.usd,
            reactions: ig.reactions, comments: ig.comments, shares: ig.shares,
            reach: ig.reach, monetized: ig.monetized, rpm: ig.rpm,
          });
          setAllTimeAvgDaily(computedAllTimeAvgDaily);
        }
      } catch (_) { /* silent */ }
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Mission current-period values: react to filterFrom / filterTo ──────────
  const missionCur = useMemo(() => {
    let posts = 0, views = 0, usd = 0, reactions = 0, comments = 0, shares = 0, reach = 0, monetized = 0;
    for (const p of allPosts) {
      if ((p.source ?? "facebook") !== "facebook") continue;
      if (filterFrom && p.published_at && p.published_at.slice(0, 10) < filterFrom) continue;
      if (filterTo   && p.published_at && p.published_at.slice(0, 10) > filterTo)   continue;
      posts += 1;
      const rev = getPostUsd(p);
      usd += rev;
      if (rev > 0) monetized += 1;
      views     += Number(p.views     ?? 0);
      reactions += Number(p.reactions ?? 0);
      comments  += Number(p.comments  ?? 0);
      shares    += Number(p.shares    ?? 0);
      reach     += Number(p.reach     ?? 0);
    }
    let revenue = 0, followers = 0;
    const daysSet = new Set<string>();
    for (const e of dailyEntries) {
      if (e.actual_revenue_usd != null && Number(e.actual_revenue_usd) > 0) {
        revenue += Number(e.actual_revenue_usd);
        daysSet.add(e.entry_date);
      }
      if (e.actual_followers != null) followers += Number(e.actual_followers);
    }
    const rpm = views > 0 ? (usd / views) * 1000 : 0;
    return { posts, views, usd, reactions, comments, shares, reach, monetized, revenue, followers, daysRevenue: daysSet.size, rpm };
  }, [allPosts, dailyEntries, filterFrom, filterTo]);

  const missionCurIG = useMemo(() => {
    let posts = 0, views = 0, usd = 0, reactions = 0, comments = 0, shares = 0, reach = 0, monetized = 0;
    for (const p of allPosts) {
      if (p.source !== "instagram") continue;
      if (filterFrom && p.published_at && p.published_at.slice(0, 10) < filterFrom) continue;
      if (filterTo   && p.published_at && p.published_at.slice(0, 10) > filterTo)   continue;
      posts += 1;
      const rev = getPostUsd(p);
      usd += rev;
      if (rev > 0) monetized += 1;
      views     += Number(p.views     ?? 0);
      reactions += Number(p.reactions ?? 0);
      comments  += Number(p.comments  ?? 0);
      shares    += Number(p.shares    ?? 0);
      reach     += Number(p.reach     ?? 0);
    }
    const rpm = views > 0 ? (usd / views) * 1000 : 0;
    return { posts, views, usd, reactions, comments, shares, reach, monetized, rpm };
  }, [allPosts, filterFrom, filterTo]);

  return (
    <div className="space-y-6">

      {/* ── Header ── */}
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-lg sm:text-2xl font-bold tracking-tight text-[#1A0A00] truncate">
            Bem-vindo, {profile?.nome?.split(" ")[0] ?? "usuário"} 👋
          </h1>
          <p className="text-xs sm:text-sm text-[#6B6B6B] mt-0.5 truncate">
            {activeMonthRef ? formatMonth(activeMonthRef) : "—"}
            {usdBrl && <span className="ml-2 hidden sm:inline">· USD 1 = {formatBRL(usdBrl)}</span>}
          </p>
        </div>
        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
          <div className="flex rounded-xl border border-[#E0E0E0] overflow-hidden text-xs sm:text-sm bg-white">
            <button onClick={() => setActiveTab("overview")}
              className={`flex items-center gap-1 px-2.5 sm:px-3 py-2 font-medium transition-colors ${activeTab === "overview" ? "bg-[#F44708] text-white" : "text-[#6B6B6B] hover:bg-[#FFF0E8]"}`}>
              <TrendingUp className="h-3 w-3 sm:h-3.5 sm:w-3.5" />
              <span className="hidden xs:inline sm:inline">Visão Geral</span>
            </button>
            <button onClick={() => setActiveTab("charts")}
              className={`flex items-center gap-1 px-2.5 sm:px-3 py-2 font-medium transition-colors ${activeTab === "charts" ? "bg-[#F44708] text-white" : "text-[#6B6B6B] hover:bg-[#FFF0E8]"}`}>
              <Eye className="h-3 w-3 sm:h-3.5 sm:w-3.5" />
              <span className="hidden xs:inline sm:inline">Gráficos</span>
            </button>
          </div>
          <button onClick={() => setShowImportModal(true)}
            className="flex items-center gap-1.5 px-3 sm:px-4 py-2 bg-gradient-to-r from-[#F44708] to-[#FF5A00] text-white text-xs sm:text-sm font-semibold rounded-xl shadow-[0_4px_14px_rgba(244,71,8,0.35)] hover:from-[#D93D07] transition-all">
            <Upload className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
            <span className="hidden sm:inline">Importar CSV</span>
          </button>
        </div>
      </div>

      {/* ── Quick Import Modal ── */}
      {showImportModal && (
        <QuickImportModal
          onClose={() => setShowImportModal(false)}
          onFile={(file) => {
            setPendingImportFile(file);
            setShowImportModal(false);
            navigate({ to: "/admin/importacoes" });
          }}
        />
      )}

      {activeTab === "charts" && !loading && chartData.length > 0 && (
        <Suspense fallback={<div className="h-48 bg-[#FFF0E8] rounded-2xl animate-pulse" />}>
          <DashboardCharts data={chartData} />
        </Suspense>
      )}

      {activeTab === "overview" && (
        <>

          {/* ═══════════════ HERO CARD ═══════════════ */}
          <div className="relative w-full rounded-2xl sm:rounded-3xl overflow-hidden text-white"
            style={{ background: "linear-gradient(135deg,#FF5A00 0%,#FF3D00 100%)", boxShadow: "0 20px 50px rgba(255,90,0,.18)" }}>
            <div className="pointer-events-none absolute -top-16 -right-16 h-64 w-64 rounded-full bg-white/5" />
            <div className="pointer-events-none absolute -bottom-12 -left-12 h-48 w-48 rounded-full bg-white/5" />
            <div className="relative p-5 sm:p-8 pb-4 sm:pb-6">
              {/* Top: label + sparkline */}
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-[10px] sm:text-xs font-semibold uppercase tracking-[.15em] text-white/70 mb-2 sm:mb-3">
                    {myCard ? "Receita Total das Páginas" : "Receita do Período"}
                  </p>
                  {loading ? (
                    <div className="space-y-2">
                      <div className="h-10 sm:h-16 w-48 sm:w-64 rounded-xl bg-white/20 animate-pulse" />
                      <div className="h-3 sm:h-4 w-24 sm:w-32 rounded bg-white/15 animate-pulse" />
                    </div>
                  ) : (
                    <>
                      <p className="font-extrabold leading-none tabular-nums"
                        style={{ fontSize: "clamp(32px, 9vw, 64px)" }}>
                        {usdBrl ? formatBRL(totalMonth * usdBrl) : `$${totalMonth.toFixed(2)}`}
                      </p>
                      <div className="flex items-center gap-2 sm:gap-3 mt-2 sm:mt-3 flex-wrap">
                        {usdBrl && <span className="text-xs sm:text-base font-semibold text-white/80 tabular-nums">${totalMonth.toFixed(2)} USD</span>}
                        {showManual && manualDelta > 0.001 && (
                          <span className="flex items-center gap-1 bg-white/15 rounded-full px-2.5 sm:px-3 py-0.5 sm:py-1 text-xs sm:text-sm font-bold">
                            ▲ {manualDeltaPct > 0 ? `${manualDeltaPct.toFixed(0)}%` : ""} vs CSV
                          </span>
                        )}
                      </div>
                    </>
                  )}
                </div>
                {!loading && heroSparkData.length >= 2 && (
                  <div className="shrink-0 hidden sm:block">
                    <HeroSparkline data={heroSparkData} />
                  </div>
                )}
              </div>
              {/* Bottom: metrics grid — mobile: 4 cols, desktop: 6/7 cols */}
              <div className={`mt-5 sm:mt-8 pt-4 sm:pt-6 border-t border-white/20 grid gap-2 sm:gap-4 grid-cols-4 ${myCard ? "sm:grid-cols-8" : "sm:grid-cols-8"}`}>
                {/* 0 Saldo Pendente — total de fechamentos abertos de meses passados, desktop only */}
                <div className="hidden sm:block">
                  <p className="text-[9px] sm:text-[11px] font-semibold uppercase tracking-wider text-white/60 mb-0.5 sm:mb-1">Saldo Pend.</p>
                  {loading ? <div className="h-5 sm:h-7 w-16 sm:w-24 rounded bg-white/20 animate-pulse" />
                    : <p className="text-base sm:text-xl font-bold tabular-nums leading-tight">{usdBrl ? formatBRL(pendingBalance * usdBrl) : `$${pendingBalance.toFixed(2)}`}</p>}
                  {usdBrl && pendingBalance > 0 && <p className="text-[9px] sm:text-xs text-white/50 mt-0.5 tabular-nums">${pendingBalance.toFixed(2)} USD</p>}
                  {pendingBalance === 0 && !loading && <p className="text-[9px] sm:text-xs text-white/50 mt-0.5">acumulado</p>}
                </div>
                {/* 1 RPM */}
                <div>
                  <p className="text-[9px] sm:text-[11px] font-semibold uppercase tracking-wider text-white/60 mb-0.5 sm:mb-1">RPM</p>
                  {loading ? <div className="h-5 sm:h-7 w-16 sm:w-24 rounded bg-white/20 animate-pulse" />
                    : <p className="text-base sm:text-xl font-bold tabular-nums leading-tight">{usdBrl ? formatBRL(avgRpm * usdBrl) : `$${avgRpm.toFixed(3)}`}</p>}
                  <p className="text-[9px] sm:text-xs text-white/50 mt-0.5">por mil views</p>
                </div>
                {/* 2 Views */}
                <div>
                  <p className="text-[9px] sm:text-[11px] font-semibold uppercase tracking-wider text-white/60 mb-0.5 sm:mb-1">Views</p>
                  {loading ? <div className="h-5 sm:h-7 w-14 sm:w-20 rounded bg-white/20 animate-pulse" />
                    : <p className="text-base sm:text-xl font-bold tabular-nums leading-tight">{fmt(totalViews)}</p>}
                  <p className="text-[9px] sm:text-xs text-white/50 mt-0.5">{kpis.totalPosts} posts</p>
                </div>
                {/* 3 Score */}
                <div>
                  <p className="text-[9px] sm:text-[11px] font-semibold uppercase tracking-wider text-white/60 mb-0.5 sm:mb-1">Score</p>
                  {loading ? <div className="h-5 sm:h-7 w-10 sm:w-16 rounded bg-white/20 animate-pulse" />
                    : <p className="text-base sm:text-xl font-bold tabular-nums leading-tight">{avgScoreVal}<span className="text-xs font-normal text-white/60">/100</span></p>}
                  <p className="text-[9px] sm:text-xs text-white/50 mt-0.5">{pageStatsWithGlobalScores.length} págs</p>
                </div>
                {/* 4 Mês Passado — hidden on mobile when user is a collaborator
                    (Sua Receita takes the 4th mobile slot instead) */}
                <div className={myCard ? "hidden sm:block" : ""}>
                  <p className="text-[9px] sm:text-[11px] font-semibold uppercase tracking-wider text-white/60 mb-0.5 sm:mb-1">Mês Ant.</p>
                  {loading || prevMonthRevenue === null ? <div className="h-5 sm:h-7 w-16 sm:w-24 rounded bg-white/20 animate-pulse" />
                    : <p className="text-base sm:text-xl font-bold tabular-nums leading-tight">{usdBrl ? formatBRL(prevMonthRevenue * usdBrl) : `$${prevMonthRevenue.toFixed(2)}`}</p>}
                  {usdBrl && prevMonthRevenue !== null && <p className="text-[9px] sm:text-xs text-white/50 mt-0.5 tabular-nums hidden sm:block">${prevMonthRevenue.toFixed(2)} USD</p>}
                </div>
                {/* 5 Sua Receita — mobile + desktop (4th slot on mobile for collaborators) */}
                {myCard && (
                  <div>
                    <p className="text-[9px] sm:text-[11px] font-semibold uppercase tracking-wider text-white/60 mb-0.5 sm:mb-1">Seus Ganhos</p>
                    {loading ? <div className="h-5 sm:h-7 w-16 sm:w-24 rounded bg-white/20 animate-pulse" />
                      : <p className="text-base sm:text-xl font-bold tabular-nums leading-tight">{usdBrl ? formatBRL(myReceita * usdBrl) : `$${myReceita.toFixed(2)}`}</p>}
                    {usdBrl && <p className="text-[9px] sm:text-xs text-white/50 mt-0.5 tabular-nums">${myReceita.toFixed(2)} USD</p>}
                  </div>
                )}
                {/* 6 Posts — só desktop */}
                <div className="hidden sm:block">
                  <p className="text-[9px] sm:text-[11px] font-semibold uppercase tracking-wider text-white/60 mb-0.5 sm:mb-1">Posts</p>
                  {loading ? <div className="h-5 sm:h-7 w-10 sm:w-16 rounded bg-white/20 animate-pulse" />
                    : <p className="text-base sm:text-xl font-bold tabular-nums leading-tight">{kpis.totalPosts}</p>}
                  {!loading && <p className="text-[9px] sm:text-xs text-white/50 mt-0.5 tabular-nums">atual vs {prevMonthStats.posts}</p>}
                </div>
                {/* 7 Views comparativo — só desktop */}
                <div className="hidden sm:block">
                  <p className="text-[9px] sm:text-[11px] font-semibold uppercase tracking-wider text-white/60 mb-0.5 sm:mb-1">Views Ant.</p>
                  {loading ? <div className="h-5 sm:h-7 w-14 sm:w-20 rounded bg-white/20 animate-pulse" />
                    : <p className="text-base sm:text-xl font-bold tabular-nums leading-tight">{fmt(prevMonthStats.views)}</p>}
                  {!loading && <p className="text-[9px] sm:text-xs text-white/50 mt-0.5">{prevMonthStats.label}</p>}
                </div>
              </div>
            </div>
          </div>

          {/* ═══════════════ FILTER BAR ═══════════════ */}
          {/* Helper to render page options */}
          {(() => {
            const fb = pages.filter((p) => (p.source ?? "facebook") === "facebook");
            const ig = pages.filter((p) => p.source === "instagram");
            const hasBoth = fb.length > 0 && ig.length > 0;
            const pageOptions = hasBoth ? (
              <><optgroup label="Facebook">{fb.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</optgroup>
              <optgroup label="Instagram">{ig.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</optgroup></>
            ) : pages.map((p) => <option key={p.id} value={p.id}>{p.name}</option>);

            const toggle = (
              <button onClick={() => setShowManual((v) => !v)} className="flex items-center focus:outline-none" aria-pressed={showManual}>
                <div className={`relative flex items-center h-6 w-[58px] rounded-full px-1 transition-colors duration-200 ${showManual ? "bg-[#F44708]" : "bg-[#D0D0D0]"}`}>
                  <span className={`absolute text-[9px] font-bold text-white tracking-wide transition-all duration-200 ${showManual ? "left-2" : "right-2"}`}>{showManual ? "ON" : "OFF"}</span>
                  <span className={`relative z-10 h-4 w-4 rounded-full bg-white shadow-md transition-all duration-200 shrink-0 ${showManual ? "translate-x-[30px]" : "translate-x-0"}`} />
                </div>
              </button>
            );

            return (
              <div className="bg-white border border-[#EFEFEF] rounded-2xl overflow-hidden" style={{ boxShadow: "0 4px 20px rgba(0,0,0,.04)" }}>

                {/* ── Mobile grid (< sm) ── */}
                <div className="sm:hidden grid grid-cols-2 divide-x divide-y divide-[#F0F0F0]">
                  <div className="flex flex-col gap-0.5 px-4 py-3">
                    <label className="text-[9px] font-semibold uppercase tracking-wider text-[#9B9B9B]">Página</label>
                    <select value={filterPage} onChange={(e) => setFilterPage(e.target.value)}
                      className="border-0 bg-transparent text-xs font-medium text-[#1A0A00] focus:outline-none w-full truncate">
                      <option value="all">Todas</option>{pageOptions}
                    </select>
                  </div>
                  <div className="flex flex-col gap-0.5 px-4 py-3">
                    <label className="text-[9px] font-semibold uppercase tracking-wider text-[#9B9B9B]">Colaborador</label>
                    <select value={filterColab} onChange={(e) => setFilterColab(e.target.value)}
                      className="border-0 bg-transparent text-xs font-medium text-[#1A0A00] focus:outline-none w-full truncate">
                      <option value="all">Todos</option>
                      <option value={SEM_COLAB_ID}>Sem colaborador</option>
                      {colabs.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
                    </select>
                  </div>
                  <div className="flex flex-col gap-0.5 px-4 py-3">
                    <label className="text-[9px] font-semibold uppercase tracking-wider text-[#9B9B9B]">De</label>
                    <input type="date" value={filterFrom} onChange={(e) => setFilterFrom(e.target.value)}
                      className="border-0 bg-transparent text-xs font-medium text-[#1A0A00] focus:outline-none w-full" />
                  </div>
                  <div className="flex flex-col gap-0.5 px-4 py-3">
                    <label className="text-[9px] font-semibold uppercase tracking-wider text-[#9B9B9B]">Até</label>
                    <input type="date" value={filterTo} onChange={(e) => setFilterTo(e.target.value)}
                      className="border-0 bg-transparent text-xs font-medium text-[#1A0A00] focus:outline-none w-full" />
                  </div>
                  <div className="col-span-2 flex items-center justify-between px-4 py-3 border-t border-[#F0F0F0]">
                    <div className="flex items-center gap-2">
                      <label className="text-[9px] font-semibold uppercase tracking-wider text-[#9B9B9B]">Dados Manuais</label>
                      {toggle}
                    </div>
                    {(filterPage !== "all" || filterColab !== "all") && (
                      <button onClick={() => { setFilterPage("all"); setFilterColab("all"); }}
                        className="text-xs font-medium text-[#F44708]">Limpar</button>
                    )}
                  </div>
                </div>

                {/* ── Desktop pill bar (≥ sm) ── */}
                <div className="hidden sm:flex items-center gap-3 px-5 min-h-[64px] flex-wrap">
                  <div className="flex flex-col gap-0.5 py-3 min-w-0">
                    <label className="text-[10px] font-semibold uppercase tracking-wider text-[#9B9B9B]">Página</label>
                    <select value={filterPage} onChange={(e) => setFilterPage(e.target.value)}
                      className="border-0 bg-transparent text-sm font-medium text-[#1A0A00] focus:outline-none cursor-pointer min-w-[160px] max-w-[200px]">
                      <option value="all">Todas as páginas</option>{pageOptions}
                    </select>
                  </div>
                  <div className="w-px h-8 bg-[#F0F0F0] shrink-0" />
                  <div className="flex flex-col gap-0.5 py-3">
                    <label className="text-[10px] font-semibold uppercase tracking-wider text-[#9B9B9B]">Colaborador</label>
                    <select value={filterColab} onChange={(e) => setFilterColab(e.target.value)}
                      className="border-0 bg-transparent text-sm font-medium text-[#1A0A00] focus:outline-none cursor-pointer min-w-[120px]">
                      <option value="all">Todos</option>
                      <option value={SEM_COLAB_ID}>Sem colaborador</option>
                      {colabs.map((c) => <option key={c.id} value={c.id}>{c.nome}{c.hashtag ? ` (#${c.hashtag})` : ""}</option>)}
                    </select>
                  </div>
                  <div className="w-px h-8 bg-[#F0F0F0] shrink-0" />
                  <div className="flex flex-col gap-0.5 py-3">
                    <label className="text-[10px] font-semibold uppercase tracking-wider text-[#9B9B9B]">De</label>
                    <input type="date" value={filterFrom} onChange={(e) => setFilterFrom(e.target.value)}
                      className="border-0 bg-transparent text-sm font-medium text-[#1A0A00] focus:outline-none cursor-pointer" />
                  </div>
                  <div className="w-px h-8 bg-[#F0F0F0] shrink-0" />
                  <div className="flex flex-col gap-0.5 py-3">
                    <label className="text-[10px] font-semibold uppercase tracking-wider text-[#9B9B9B]">Até</label>
                    <input type="date" value={filterTo} onChange={(e) => setFilterTo(e.target.value)}
                      className="border-0 bg-transparent text-sm font-medium text-[#1A0A00] focus:outline-none cursor-pointer" />
                  </div>
                  <div className="w-px h-8 bg-[#F0F0F0] shrink-0" />
                  <div className="flex flex-col gap-0.5 py-3">
                    <label className="text-[10px] font-semibold uppercase tracking-wider text-[#9B9B9B]">Dados Manuais</label>
                    <button onClick={() => setShowManual((v) => !v)} className="flex items-center focus:outline-none" aria-pressed={showManual}>
                      <div className={`relative flex items-center h-7 w-[68px] rounded-full px-1 transition-colors duration-200 ${showManual ? "bg-[#F44708]" : "bg-[#D0D0D0]"}`}>
                        <span className={`absolute text-[10px] font-bold text-white tracking-wide transition-all duration-200 ${showManual ? "left-2.5" : "right-2.5"}`}>{showManual ? "ON" : "OFF"}</span>
                        <span className={`relative z-10 h-5 w-5 rounded-full bg-white shadow-md transition-all duration-200 shrink-0 ${showManual ? "translate-x-[34px]" : "translate-x-0"}`} />
                      </div>
                    </button>
                  </div>
                  {(filterPage !== "all" || filterColab !== "all") && (
                    <><div className="w-px h-8 bg-[#F0F0F0] shrink-0" />
                    <button onClick={() => { setFilterPage("all"); setFilterColab("all"); }}
                      className="text-xs font-medium text-[#F44708] hover:text-[#D93D07] transition-colors py-3">
                      Limpar filtros
                    </button></>
                  )}
                </div>

              </div>
            );
          })()}

          {/* ═══════════════ MISSÕES ═══════════════ */}
          {!loading && (missionBest || missionBestIG) && (() => {
            const n = (v: number) =>
              v >= 1e9 ? `${(v / 1e9).toFixed(1)}B`
              : v >= 1e6 ? `${(v / 1e6).toFixed(1)}M`
              : v >= 1e3 ? `${(v / 1e3).toFixed(0)}k`
              : `${Math.round(v)}`;
            const u = (v: number) => `$${v.toFixed(0)}`;
            const r = (v: number) => `$${v.toFixed(2)}`;

            type MissionDef = { icon: React.ElementType; label: string; cur: number; best: number; fmt: (v: number) => string };

            const missionsFB: MissionDef[] = missionBest ? [
              { icon: DollarSign,      label: "Meta $100",      cur: missionCur.revenue,     best: 100,                     fmt: r },
              { icon: Eye,             label: "Views",          cur: missionCur.views,       best: missionBest.views,       fmt: n },
              { icon: DollarSign,      label: "Receita CSV",    cur: missionCur.usd,         best: missionBest.usd,         fmt: u },
              { icon: Zap,             label: "Ganhos Reais",   cur: missionCur.revenue,     best: missionBest.revenue,     fmt: u },
              { icon: Heart,           label: "Reações",        cur: missionCur.reactions,   best: missionBest.reactions,   fmt: n },
              { icon: MessageSquare,   label: "Comentários",    cur: missionCur.comments,    best: missionBest.comments,    fmt: n },
              { icon: Share2,          label: "Compartilhados", cur: missionCur.shares,      best: missionBest.shares,      fmt: n },
              { icon: Maximize2,       label: "Alcance",        cur: missionCur.reach,       best: missionBest.reach,       fmt: n },
              { icon: Users,           label: "Seguidores",     cur: missionCur.followers,   best: missionBest.followers,   fmt: n },
              { icon: CheckCircle2,    label: "Monetizados",    cur: missionCur.monetized,   best: missionBest.monetized,   fmt: n },
              { icon: Calendar,        label: "Dias c/ Ganho",  cur: missionCur.daysRevenue, best: missionBest.daysRevenue, fmt: n },
              { icon: Target,          label: "RPM",            cur: missionCur.rpm,         best: missionBest.rpm,         fmt: r },
            ] : [];

            const missionsIG: MissionDef[] = missionBestIG ? [
              { icon: Eye,             label: "Views",          cur: missionCurIG.views,     best: missionBestIG.views,     fmt: n },
              { icon: DollarSign,      label: "Receita CSV",    cur: missionCurIG.usd,       best: missionBestIG.usd,       fmt: u },
              { icon: Heart,           label: "Reações",        cur: missionCurIG.reactions, best: missionBestIG.reactions, fmt: n },
              { icon: MessageSquare,   label: "Comentários",    cur: missionCurIG.comments,  best: missionBestIG.comments,  fmt: n },
              { icon: Share2,          label: "Compartilhados", cur: missionCurIG.shares,    best: missionBestIG.shares,    fmt: n },
              { icon: Maximize2,       label: "Alcance",        cur: missionCurIG.reach,     best: missionBestIG.reach,     fmt: n },
              { icon: CheckCircle2,    label: "Monetizados",    cur: missionCurIG.monetized, best: missionBestIG.monetized, fmt: n },
              { icon: Target,          label: "RPM",            cur: missionCurIG.rpm,       best: missionBestIG.rpm,       fmt: r },
            ] : [];

            const MissionRow = ({ missions, accentColor, innerBg }: { missions: MissionDef[]; accentColor: string; innerBg: string }) => (
              <div
                className="flex gap-1 overflow-x-auto pb-1"
                style={{ scrollbarWidth: "none", msOverflowStyle: "none" } as React.CSSProperties}
              >
                {missions.map(({ icon, label, cur, best, fmt }) => (
                  <MissionStoryCard
                    key={label}
                    icon={icon}
                    label={label}
                    progress={best > 0 ? cur / best : 0}
                    value={fmt(cur)}
                    goal={fmt(best)}
                    accentColor={accentColor}
                    innerBg={innerBg}
                  />
                ))}
              </div>
            );

            return (
              <div className="space-y-3">
                {/* Section header */}
                <div className="flex items-baseline gap-2">
                  <p className="text-[10px] font-semibold uppercase tracking-[.18em] text-[#9B9B9B]">
                    Missões do Mês
                  </p>
                  <span className="text-[10px] font-mono font-semibold text-[#C0C0C0] tracking-widest tabular-nums">
                    · {monthCountdown}
                  </span>
                </div>

                {/* Facebook card */}
                {missionsFB.length > 0 && (
                  <div className="rounded-2xl border border-[#1877F2]/20 bg-[#EEF4FF] px-4 pt-3 pb-4">
                    <div className="flex items-center gap-2 mb-3">
                      {/* Facebook "f" logo */}
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="#1877F2">
                        <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
                      </svg>
                      <span className="text-xs font-bold text-[#1877F2] uppercase tracking-wider">Facebook</span>
                    </div>
                    <MissionRow missions={missionsFB} accentColor="#1877F2" innerBg="#DDEAFF" />
                  </div>
                )}

                {/* Instagram card */}
                {missionsIG.length > 0 && (
                  <div className="rounded-2xl border border-[#C13584]/20 px-4 pt-3 pb-4"
                    style={{ background: "linear-gradient(135deg, #fdf0ff 0%, #fff0f7 50%, #fff4ec 100%)" }}>
                    <div className="flex items-center gap-2 mb-3">
                      {/* Instagram gradient logo */}
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                        <defs>
                          <linearGradient id="igGrad" x1="0" y1="1" x2="1" y2="0">
                            <stop offset="0%" stopColor="#FCAF45"/>
                            <stop offset="30%" stopColor="#E1306C"/>
                            <stop offset="70%" stopColor="#833AB4"/>
                          </linearGradient>
                        </defs>
                        <path fill="url(#igGrad)" d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z"/>
                      </svg>
                      <span className="text-xs font-bold uppercase tracking-wider"
                        style={{ background: "linear-gradient(90deg, #833AB4, #E1306C, #FCAF45)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
                        Instagram
                      </span>
                    </div>
                    <MissionRow missions={missionsIG} accentColor="#C13584" innerBg="#fde8f5" />
                  </div>
                )}
              </div>
            );
          })()}

          {/* ═══════════════ RANKING CAROUSEL ═══════════════ */}
          {(() => {
            const currentCards = activeCollabCards.filter((c) => c.id !== SEM_COLAB_ID && c.receita > 0.001).slice(0, 8);
            const isFallback = currentCards.length === 0;
            const displayCards = isFallback ? prevMonthTopColabs : currentCards;

            // rank accent colours: gold / silver / bronze / neutral
            const rankAccent = [
              { bg: "#FFF7E6", border: "#F5C842", label: "#B8860B" },
              { bg: "#F5F5F5", border: "#B0B0B0", label: "#6B6B6B" },
              { bg: "#FFF1EB", border: "#E07A50", label: "#C05A30" },
            ];
            const defaultAccent = { bg: "#FAFAFA", border: "#E8E8E8", label: "#9B9B9B" };

            return (
              <div className="bg-white border border-[#F1F1F1] rounded-2xl overflow-hidden" style={{ boxShadow: "0 4px 20px rgba(0,0,0,.04)" }}>
                {/* Header */}
                <div className="flex items-center justify-between px-4 sm:px-5 pt-4 sm:pt-5 pb-3">
                  <div>
                    <h2 className="text-sm sm:text-base font-bold text-[#1A0A00]">Ranking</h2>
                    <p className="text-[11px] text-[#9B9B9B] mt-0.5">
                      {isFallback ? "Top colaboradores · mês passado" : "Colaboradores no período"}
                    </p>
                  </div>
                  <button onClick={() => navigate({ to: "/admin/colaboradores" })} className="text-xs font-semibold text-[#F44708] hover:text-[#D93D07] transition-colors">
                    Ver todos →
                  </button>
                </div>

                {/* Carousel */}
                <div
                  className="flex gap-2 px-4 sm:px-5 pb-4 sm:pb-5 overflow-x-auto"
                  style={{ scrollbarWidth: "none", msOverflowStyle: "none" } as React.CSSProperties}
                >
                  {loading ? (
                    [1,2,3,4,5].map(i => (
                      <div key={i} className="flex-none w-[130px] rounded-2xl border border-[#F1F1F1] p-3 space-y-2">
                        <Sk w="w-8" h="h-4" className="rounded-full" />
                        <Sk w="w-10" h="h-10" className="rounded-full" />
                        <Sk w="w-16" h="h-3" />
                        <Sk w="w-12" h="h-2.5" />
                        <Sk w="w-14" h="h-4" />
                      </div>
                    ))
                  ) : displayCards.length === 0 ? (
                    <p className="text-xs text-[#9B9B9B] py-6 px-2">Nenhum colaborador no período</p>
                  ) : displayCards.map((card, i) => {
                    const displayReceita = isFallback ? 0 : card.receita;
                    const displayViews   = isFallback ? 0 : card.views;
                    const receitaOn  = collabCards.find(c => c.id === card.id)?.receita ?? card.receita;
                    const receitaOff = collabCardsCsv.find(c => c.id === card.id)?.receita ?? card.receita;
                    const delta = !isFallback && showManual && receitaOff > 0.001 ? ((receitaOn - receitaOff) / receitaOff) * 100 : null;
                    const accent = rankAccent[i] ?? defaultAccent;
                    const isFirst = i === 0;

                    return (
                      <button
                        key={card.id}
                        onClick={() => setAuditColabId(card.id)}
                        className="flex-none flex flex-col gap-2 p-3 rounded-2xl transition-all active:scale-95 text-left"
                        style={{
                          minWidth: isFirst ? 148 : 132,
                          background: accent.bg,
                          border: `1.5px solid ${accent.border}`,
                        }}
                      >
                        {/* Rank label */}
                        <div className="flex items-center justify-between w-full">
                          <span
                            className="text-[10px] font-black uppercase tracking-widest"
                            style={{ color: accent.label }}
                          >
                            {i === 0 ? "1º lugar" : i === 1 ? "2º lugar" : i === 2 ? "3º lugar" : `${i + 1}º`}
                          </span>
                          {delta !== null && (
                            <span className={`text-[9px] font-bold px-1 py-0.5 rounded-full ${delta >= 0 ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-600"}`}>
                              {delta >= 0 ? "▲" : "▼"}{Math.abs(delta).toFixed(0)}%
                            </span>
                          )}
                        </div>

                        {/* Avatar */}
                        <div
                          className="relative flex items-center justify-center"
                          style={{ width: isFirst ? 52 : 44, height: isFirst ? 52 : 44 }}
                        >
                          <GoalRing revenueUsd={displayReceita} size={isFirst ? 52 : 44} />
                          <ColabInitials nome={card.nome} idx={i} size={isFirst ? 42 : 34} avatarUrl={card.avatar_url} />
                        </div>

                        {/* Name */}
                        <div>
                          <p className={`text-xs font-bold leading-tight truncate max-w-[110px] ${isFallback ? "text-[#9B9B9B]" : "text-[#1A0A00]"}`}>
                            {card.nome.split(" ")[0]}
                          </p>
                          <p className="text-[10px] text-[#9B9B9B] tabular-nums mt-0.5">
                            {isFallback ? "—" : `${fmt(Math.round(displayViews))} views`}
                          </p>
                        </div>

                        {/* Revenue — main focus */}
                        <p className={`text-sm font-black tabular-nums mt-auto ${isFallback ? "text-[#C0C0C0]" : "text-[#1A0A00]"}`}>
                          {isFallback ? "R$ 0,00" : (usdBrl ? formatBRL(displayReceita * usdBrl) : `$${displayReceita.toFixed(2)}`)}
                        </p>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })()}

          {/* ═══════════════ CHART ═══════════════ */}
          {loading ? (
            <div className="bg-white border border-[#F1F1F1] rounded-2xl p-4 sm:p-6 space-y-4" style={{ boxShadow: "0 4px 20px rgba(0,0,0,.04)" }}>
              <div className="space-y-2"><Sk w="w-32 sm:w-40" h="h-4 sm:h-5" /><Sk w="w-40 sm:w-56" h="h-3" /></div>
              <Sk w="w-full" h="h-[260px] sm:h-[320px]" className="rounded-xl" />
            </div>
          ) : (
            <div className="bg-white border border-[#F1F1F1] rounded-2xl p-4 sm:p-6" style={{ boxShadow: "0 4px 20px rgba(0,0,0,.04)" }}>
              <div className="mb-4 sm:mb-5">
                <h2 className="text-sm sm:text-base font-bold text-[#1A0A00]">Receita + Projeção</h2>
                <p className="text-xs text-[#9B9B9B] mt-0.5 hidden sm:block">
                  Histórico de receita · 3 cenários de projeção
                </p>
              </div>
              {/* Fixed height so chart always renders */}
              <div className="h-[260px] sm:h-[320px]">
                <Suspense fallback={<div className="w-full h-full bg-[#FFF8F5] rounded-xl animate-pulse" />}>
                  <ProjectionChart
                    projectionChartData={projectionChartData}
                    usdBrl={usdBrl}
                  />
                </Suspense>
              </div>
              {/* Scenario legend */}
              <div className="flex flex-wrap gap-x-4 gap-y-1.5 mt-3 pt-3 border-t border-[#F1F1F1]">
                <span className="flex items-center gap-1.5 text-[11px] text-[#6B6B6B]">
                  <span className="h-0.5 w-5 bg-[#F44708] rounded-full inline-block" />Real
                </span>
                <span className="flex items-center gap-1.5 text-[11px] text-[#6B6B6B]">
                  <span className="h-0.5 w-5 border-t-2 border-dashed border-emerald-500 inline-block" />Otimista
                </span>
                <span className="flex items-center gap-1.5 text-[11px] text-[#6B6B6B]">
                  <span className="h-0.5 w-5 border-t-2 border-dashed border-[#F44708] inline-block" />Provável
                </span>
                <span className="flex items-center gap-1.5 text-[11px] text-[#6B6B6B]">
                  <span className="h-0.5 w-5 border-t-2 border-dashed border-slate-400 inline-block" />Conservador
                </span>
              </div>
            </div>
          )}

          {/* ═══════════════ DOLLAR CHART ═══════════════ */}
          <div className="bg-white border border-[#F1F1F1] rounded-2xl p-4 sm:p-6" style={{ boxShadow: "0 4px 20px rgba(0,0,0,.04)" }}>
            <div className="flex items-start justify-between mb-3">
              <div>
                <h2 className="text-sm sm:text-base font-bold text-[#1A0A00]">Dólar · USD/BRL</h2>
                <p className="text-xs text-[#9B9B9B] mt-0.5">Histórico 30 dias · atualizado diariamente</p>
              </div>
              <span className="text-[10px] font-medium text-[#9B9B9B] bg-[#F5F5F5] rounded-full px-2 py-0.5 mt-0.5 shrink-0">ao vivo</span>
            </div>
            {dollarLoading ? (
              <div className="space-y-2">
                <Sk w="w-32" h="h-7" />
                <Sk w="w-full" h="h-[140px] sm:h-[160px]" className="rounded-xl" />
              </div>
            ) : dollarError ? (
              <div className="flex flex-col items-center justify-center h-[140px] gap-2 text-[#9B9B9B]">
                <span className="text-2xl">📡</span>
                <p className="text-xs text-center">Não foi possível carregar os dados.<br/>Verifique a conexão e recarregue.</p>
              </div>
            ) : (
              <div className="h-[140px] sm:h-[180px]">
                <Suspense fallback={<div className="w-full h-full bg-[#FFF8F5] rounded-xl animate-pulse" />}>
                  <DollarChart data={dollarHistory} />
                </Suspense>
              </div>
            )}
          </div>


        </>
      )}

      {/* ── Audit Dialog ── */}
      <Dialog open={!!auditColabId} onOpenChange={(o) => { if (!o) setAuditColabId(null); }}>
        <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {auditData?.colab?.nome ?? "—"}
              {auditData?.colab?.hashtag && (
                <span className="text-xs font-normal text-[#6B6B6B] font-mono">#{auditData.colab.hashtag}</span>
              )}
            </DialogTitle>
            <p className="text-xs text-[#6B6B6B]">
              {filterFrom && filterTo ? `${filterFrom} → ${filterTo}` : "Todos os períodos"} · {auditData?.posts.length ?? 0} posts
            </p>
          </DialogHeader>
          {auditData && (
            <div className="flex-1 overflow-y-auto space-y-4 pr-1">
              <div className="grid grid-cols-3 gap-3">
                {[
                  { label: "Posts", value: auditData.posts.length.toLocaleString("pt-BR") },
                  { label: "Views", value: fmt(auditData.posts.reduce((s, p) => s + Number(p.views ?? 0), 0)) },
                  { label: "Total (USD)", value: `$${(auditData.card?.receita ?? 0).toFixed(2)}` },
                ].map(({ label, value }) => (
                  <div key={label} className="border border-[#E0E0E0] rounded-xl p-3 text-center">
                    <p className="text-[10px] uppercase tracking-wider text-[#6B6B6B] font-medium">{label}</p>
                    <p className="text-lg font-semibold tabular-nums mt-0.5">{value}</p>
                  </div>
                ))}
              </div>
              {Object.keys(auditData.typeBreakdown).length > 0 && (
                <div className="border border-[#E0E0E0] rounded-xl p-3">
                  <p className="text-[10px] uppercase tracking-wider text-[#6B6B6B] font-medium mb-2">Por tipo</p>
                  <div className="flex flex-wrap gap-2">
                    {Object.entries(auditData.typeBreakdown).map(([type, info]) => (
                      <span key={type} className="inline-flex items-center gap-1.5 text-xs bg-[#FFF0E8] rounded-lg px-2.5 py-1">
                        <span className="font-medium capitalize">{type}</span>
                        <span className="text-[#6B6B6B]">·</span>
                        <span>{info.count} posts</span>
                        <span className="text-[#6B6B6B]">·</span>
                        <span>{fmt(info.views)} views</span>
                        <span className="text-[#6B6B6B]">·</span>
                        <span className="font-semibold">${info.share.toFixed(2)}</span>
                      </span>
                    ))}
                  </div>
                </div>
              )}
              <div className="border border-[#E0E0E0] rounded-xl overflow-hidden">
                <table className="w-full text-xs">
                  <thead className="bg-[#FFF0E8] text-[10px] uppercase text-[#6B6B6B]">
                    <tr>
                      <th className="text-left px-3 py-2 font-medium">Data</th>
                      <th className="text-left px-3 py-2 font-medium">Título / Tipo</th>
                      <th className="text-right px-3 py-2 font-medium">Views</th>
                      <th className="text-right px-3 py-2 font-medium">Reações</th>
                      <th className="text-right px-3 py-2 font-medium">Receita</th>
                      <th className="text-right px-3 py-2 font-medium">Split%</th>
                      <th className="text-right px-3 py-2 font-medium">Sua parte</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#F0E0D0]">
                    {auditData.posts.map((p) => (
                      <tr key={p.id} className="hover:bg-[#FFF0E8]">
                        <td className="px-3 py-2 text-[#6B6B6B] whitespace-nowrap">{p.published_at ? p.published_at.slice(0, 10) : "—"}</td>
                        <td className="px-3 py-2 max-w-[200px]">
                          {p.permalink ? (
                            <a href={p.permalink} target="_blank" rel="noopener noreferrer"
                              className="truncate block underline underline-offset-2 text-[#F44708] hover:text-[#6B6B6B] transition-colors"
                              onClick={(e) => e.stopPropagation()}>
                              {p.title ?? p.id.slice(0, 8)}
                            </a>
                          ) : (
                            <span className="truncate block">{p.title ?? p.id.slice(0, 8)}</span>
                          )}
                          {p.post_type && <span className="text-[10px] text-[#6B6B6B] capitalize">{p.post_type}</span>}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">{fmt(Number(p.views ?? 0))}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{Number(p.reactions ?? 0).toLocaleString("pt-BR")}</td>
                        <td className="px-3 py-2 text-right tabular-nums">${p.postUsd.toFixed(2)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{(p.collaboratorPct * 100).toFixed(0)}%</td>
                        <td className="px-3 py-2 text-right tabular-nums font-semibold">${p.share.toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Colaboradores Section ────────────────────────────────────────────────────

const AVATAR_GRADIENTS = [
  ["#F44708", "#FAA613"],
  ["#8B5CF6", "#C084FC"],
  ["#0EA5E9", "#38BDF8"],
  ["#10B981", "#34D399"],
  ["#F59E0B", "#FCD34D"],
  ["#EF4444", "#FC8181"],
  ["#6366F1", "#A5B4FC"],
];

function ColabInitials({ nome, idx, size = 44, avatarUrl }: { nome: string | null | undefined; idx: number; size?: number; avatarUrl?: string | null }) {
  if (avatarUrl) {
    return (
      <img
        src={avatarUrl}
        alt={nome ?? ""}
        width={size}
        height={size}
        style={{ width: size, height: size, borderRadius: "50%", objectFit: "cover", display: "block", flexShrink: 0 }}
      />
    );
  }
  const [a, b] = AVATAR_GRADIENTS[idx % AVATAR_GRADIENTS.length];
  const safeName = nome || "?";
  const initials = safeName
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join("");
  const gid = `ag-${idx}`;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ borderRadius: "50%", display: "block", flexShrink: 0 }}>
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={a} />
          <stop offset="100%" stopColor={b} />
        </linearGradient>
      </defs>
      <circle cx={size / 2} cy={size / 2} r={size / 2} fill={`url(#${gid})`} />
      <text
        x={size / 2} y={size / 2 + size * 0.14}
        textAnchor="middle" fontSize={size * 0.32}
        fontWeight="700" fill="white" fontFamily="system-ui, sans-serif"
      >{initials}</text>
    </svg>
  );
}

function ColabSparkline({ data, idx }: { data: number[]; idx: number }) {
  const w = 172; const h = 36;
  if (!data || data.every((v) => v === 0)) return <div style={{ width: w, height: h }} />;
  const max = Math.max(...data, 0.001);
  const points = data.map((v, i) => {
    const x = (i / (data.length - 1)) * w;
    const y = h - 2 - ((v / max) * (h - 4));
    return [x, y] as [number, number];
  });
  const polyPts = points.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const [lx, ly] = points[points.length - 1];
  const [fx] = points[0];
  const areaD = `M${polyPts.split(" ").join(" L")} L${lx.toFixed(1)},${h} L${fx.toFixed(1)},${h} Z`;
  const gid2 = `csg-${idx}`;
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ display: "block" }}>
      <defs>
        <linearGradient id={gid2} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#F44708" stopOpacity={0.2} />
          <stop offset="100%" stopColor="#F44708" stopOpacity={0} />
        </linearGradient>
      </defs>
      <path d={areaD} fill={`url(#${gid2})`} />
      <polyline points={polyPts} fill="none" stroke="#F44708" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function RankBadge({ rank }: { rank: number }) {
  const bg = rank === 1 ? "bg-amber-400" : rank === 2 ? "bg-slate-400" : rank === 3 ? "bg-orange-400" : "bg-[#E0E0E0]";
  const text = rank <= 3 ? "text-white" : "text-[#6B6B6B]";
  return (
    <span className={`absolute -top-1.5 -left-1.5 h-5 w-5 rounded-full ${bg} border-2 border-white flex items-center justify-center text-[9px] font-black ${text} z-10 shadow-sm`}>
      {rank}
    </span>
  );
}

function ColaboradorCard({ item, rank, sparkline, usdBrl, onClick, idx, receitaOn, receitaOff, showDelta }: {
  item: ColabCard; rank: number; sparkline: number[];
  usdBrl: number | null; onClick: () => void; idx: number;
  receitaOn: number; receitaOff: number; showDelta: boolean;
}) {
  const delta = showDelta && receitaOff > 0.001 ? ((receitaOn - receitaOff) / receitaOff) * 100 : null;

  return (
    <button
      onClick={onClick}
      className="group flex-none w-[172px] bg-white border border-[#EAEAEA] rounded-2xl overflow-hidden hover:border-[#F44708]/40 hover:shadow-[0_4px_20px_rgba(244,71,8,0.10)] transition-all duration-200 text-left"
    >
      <div className="px-4 pt-5 pb-3">
        <div className="relative inline-block mb-3">
          <RankBadge rank={rank} />
          <ColabInitials nome={item.nome} idx={idx} size={44} avatarUrl={item.avatar_url} />
        </div>
        <p className="text-[13px] font-semibold text-[#1A0A00] leading-tight truncate mb-0.5">{item.nome}</p>
        <p className="text-[11px] text-[#9B9B9B] tabular-nums">
          {item.posts} posts · {fmt(item.views)} views
        </p>
        <div className="mt-3">
          <p className="text-[17px] font-black text-[#1A0A00] tabular-nums leading-none">
            {usdBrl ? formatBRL(item.receita * usdBrl) : `$${item.receita.toFixed(2)}`}
          </p>
          <div className="flex items-center gap-1.5 mt-0.5">
            <p className="text-[11px] text-[#9B9B9B] tabular-nums">${item.receita.toFixed(2)}</p>
            {delta !== null && (
              <span className={`text-[10px] font-bold tabular-nums ${delta >= 0 ? "text-[#16a34a]" : "text-[#dc2626]"}`}>
                {delta >= 0 ? "▲" : "▼"}{Math.abs(delta).toFixed(0)}%
              </span>
            )}
          </div>
        </div>
      </div>
      <ColabSparkline data={sparkline} idx={idx} />
    </button>
  );
}

function ColabSection({ cards, sparklineByColab, usdBrl, onCardClick, receitaOnById, receitaOffById, showDelta }: {
  cards: ColabCard[];
  sparklineByColab: Map<string, number[]>;
  usdBrl: number | null;
  onCardClick: (id: string) => void;
  receitaOnById: Map<string, number>;
  receitaOffById: Map<string, number>;
  showDelta: boolean;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const scroll = (dir: "left" | "right") => {
    scrollRef.current?.scrollBy({ left: dir === "right" ? 220 : -220, behavior: "smooth" });
  };
  return (
    <div className="bg-white border border-[#E0E0E0] rounded-2xl p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2.5">
          <div className="h-8 w-8 rounded-xl bg-gradient-to-br from-[#FFF0E8] to-[#FFD9C0] flex items-center justify-center shrink-0">
            <Users className="h-4 w-4 text-[#F44708]" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-[#1A0A00]">Colaboradores</h2>
            <p className="text-[11px] text-[#9B9B9B]">Performance dos colaboradores no período</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => navigate({ to: "/admin/colaboradores" })}
            className="hidden sm:flex items-center gap-1 text-xs text-[#F44708] font-medium border border-[#F44708]/30 rounded-lg px-3 py-1.5 hover:bg-[#FFF0E8] transition-colors"
          >
            Ver todos
          </button>
          <button onClick={() => scroll("left")}
            className="h-7 w-7 rounded-lg border border-[#E0E0E0] flex items-center justify-center text-[#9B9B9B] hover:text-[#F44708] hover:border-[#F44708]/40 transition-colors">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button onClick={() => scroll("right")}
            className="h-7 w-7 rounded-lg border border-[#E0E0E0] flex items-center justify-center text-[#9B9B9B] hover:text-[#F44708] hover:border-[#F44708]/40 transition-colors">
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>
      <div ref={scrollRef} className="flex gap-3 overflow-x-auto pb-1" style={{ scrollbarWidth: "none" }}>
        {cards.map((card, i) => (
          <ColaboradorCard
            key={card.id} item={card} rank={i + 1}
            sparkline={sparklineByColab.get(card.id) ?? Array(14).fill(0)}
            usdBrl={usdBrl} onClick={() => onCardClick(card.id)} idx={i}
            receitaOn={receitaOnById.get(card.id) ?? card.receita}
            receitaOff={receitaOffById.get(card.id) ?? card.receita}
            showDelta={showDelta}
          />
        ))}
      </div>
    </div>
  );
}

// ─── HeroSparkline ────────────────────────────────────────────────────────────

function HeroSparkline({ data }: { data: number[] }) {
  const w = 200; const h = 64;
  if (data.length < 2) return null;
  const max = Math.max(...data, 0.001);
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * w;
    const y = h - 4 - (v / max) * (h - 8);
    return [x, y] as [number, number];
  });
  const polyPts = pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const [lx, ly] = pts[pts.length - 1];
  const [fx] = pts[0];
  const areaD = `M${pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" L")} L${lx.toFixed(1)},${h} L${fx.toFixed(1)},${h} Z`;
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ display: "block", opacity: 0.85 }}>
      <defs>
        <linearGradient id="heroGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="white" stopOpacity={0.3} />
          <stop offset="100%" stopColor="white" stopOpacity={0} />
        </linearGradient>
      </defs>
      <path d={areaD} fill="url(#heroGrad)" />
      <polyline points={polyPts} fill="none" stroke="white" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={lx} cy={ly} r={3} fill="white" />
    </svg>
  );
}

// ─── GoalRing ($100 Facebook monthly goal) ────────────────────────────────────

function GoalRing({ revenueUsd, size = 40 }: { revenueUsd: number; size?: number }) {
  const sw = 2.5;
  const r = (size - sw) / 2;
  const circ = 2 * Math.PI * r;
  const pct = Math.min(1, Math.max(0, revenueUsd / 100));
  const offset = circ * (1 - pct);
  const color =
    pct >= 1     ? "#16a34a"  // green  — atingiu!
    : pct >= 0.8 ? "#3b82f6"  // blue   — quase lá
    : pct >= 0.5 ? "#f59e0b"  // amber  — no caminho
    : "#f44708";               // orange — início
  return (
    <svg
      width={size} height={size}
      style={{ position: "absolute", inset: 0, transform: "rotate(-90deg)", pointerEvents: "none" }}
    >
      {/* track */}
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#e5e7eb" strokeWidth={sw} />
      {/* progress */}
      <circle
        cx={size / 2} cy={size / 2} r={r}
        fill="none" stroke={color} strokeWidth={sw}
        strokeDasharray={circ} strokeDashoffset={offset}
        strokeLinecap="round"
        style={{ transition: "stroke-dashoffset 0.6s ease, stroke 0.4s ease" }}
      />
    </svg>
  );
}

// ─── RankingSparkline ─────────────────────────────────────────────────────────

function RankingSparkline({ data }: { data: number[] }) {
  const w = 40; const h = 20;
  if (!data || data.every((v) => v === 0)) return <div style={{ width: w, height: h }} />;
  const max = Math.max(...data, 0.001);
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * w;
    const y = h - 2 - (v / max) * (h - 4);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const last = data[data.length - 1];
  const first = data[0];
  const up = last >= first;
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ display: "block", flexShrink: 0 }}>
      <polyline points={pts.join(" ")} fill="none" stroke={up ? "#16a34a" : "#dc2626"} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ─── Mission Story Card ────────────────────────────────────────────────────────

function MissionStoryCard({
  icon: Icon,
  label,
  progress,
  value,
  goal,
  accentColor = "#F44708",
  innerBg = "#FFF3EE",
}: {
  icon: React.ElementType;
  label: string;
  progress: number;   // 0..1
  value: string;
  goal: string;
  accentColor?: string;
  innerBg?: string;
}) {
  const [hovered, setHovered] = useState(false);
  const size = 68;
  const sw = 3.5;
  const r = size / 2 - sw - 2; // ~29
  const circ = +(2 * Math.PI * r).toFixed(2);
  const clamped = Math.min(1, Math.max(0, progress));
  const offset = +(circ * (1 - clamped)).toFixed(2);
  const done = clamped >= 1;
  const ringColor = done ? "#16a34a" : accentColor;
  const pct = Math.round(clamped * 100);

  return (
    <div
      className="flex-1 min-w-[72px] flex flex-col items-center gap-1 select-none cursor-pointer"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Ring + icon */}
      <div
        className="relative"
        style={{
          width: size, height: size,
          transition: "transform 0.2s ease, filter 0.2s ease",
          transform: hovered ? "scale(1.08)" : "scale(1)",
          filter: hovered ? "drop-shadow(0 2px 6px rgba(0,0,0,0.18))" : "none",
        }}
      >
        <svg
          width={size} height={size}
          viewBox={`0 0 ${size} ${size}`}
          style={{ transform: "rotate(-90deg)", display: "block" }}
        >
          {/* track */}
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#EBEBEB" strokeWidth={sw} />
          {/* progress arc */}
          <circle
            cx={size / 2} cy={size / 2} r={r}
            fill="none" stroke={ringColor} strokeWidth={sw}
            strokeDasharray={circ}
            strokeDashoffset={offset}
            strokeLinecap="round"
            style={{ transition: "stroke-dashoffset 0.55s ease, stroke 0.3s ease" }}
          />
        </svg>
        {/* Inner circle — icon or % overlay on hover */}
        <div
          className="absolute rounded-full flex items-center justify-center overflow-hidden"
          style={{
            inset: sw + 3,
            background: hovered ? "rgba(26,10,0,0.78)" : done ? "#F0FDF4" : innerBg,
            transition: "background 0.2s ease",
          }}
        >
          {hovered ? (
            <span
              style={{
                fontSize: pct >= 100 ? 13 : 14,
                fontWeight: 700,
                color: "#FFFFFF",
                lineHeight: 1,
                letterSpacing: "-0.5px",
              }}
            >
              {pct}%
            </span>
          ) : (
            <Icon
              className="shrink-0"
              style={{
                width: 20, height: 20,
                color: done ? "#16a34a" : accentColor,
              }}
            />
          )}
        </div>
      </div>
      {/* Current value */}
      <span className="text-[11px] font-bold text-[#1A0A00] tabular-nums leading-none">{value}</span>
      {/* Label */}
      <span className="text-[9px] font-medium text-[#9B9B9B] text-center leading-tight">{label}</span>
    </div>
  );
}

// ─── Quick Import Modal ────────────────────────────────────────────────────────

function QuickImportModal({
  onClose,
  onFile,
}: {
  onClose: () => void;
  onFile: (file: File) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const handleFiles = (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    onFile(file);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-sm bg-card rounded-2xl border border-border shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-4">
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-xl bg-[#FFF0E8] flex items-center justify-center">
              <CloudUpload className="h-4 w-4 text-[#F44708]" />
            </div>
            <div>
              <p className="text-sm font-bold text-foreground">Importar CSV</p>
              <p className="text-xs text-muted-foreground">Ganhos, Views ou Posts</p>
            </div>
          </div>
          <button onClick={onClose} className="h-7 w-7 rounded-lg flex items-center justify-center text-muted-foreground hover:bg-muted transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Drop zone */}
        <div className="px-5 pb-5">
          <div
            onClick={() => fileRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => { e.preventDefault(); setDragging(false); handleFiles(e.dataTransfer.files); }}
            className={`flex flex-col items-center justify-center gap-3 p-8 rounded-xl border-2 border-dashed cursor-pointer transition-colors ${
              dragging
                ? "border-[#F44708] bg-[#FFF0E8]"
                : "border-border hover:border-[#F44708] hover:bg-[#FFF8F5]"
            }`}
          >
            <div className={`h-12 w-12 rounded-2xl flex items-center justify-center transition-colors ${dragging ? "bg-[#F44708]" : "bg-[#FFF0E8]"}`}>
              <Upload className={`h-5 w-5 ${dragging ? "text-white" : "text-[#F44708]"}`} />
            </div>
            <div className="text-center">
              <p className="text-sm font-semibold text-foreground">
                {dragging ? "Solte o arquivo aqui" : "Clique ou arraste o arquivo"}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">Arquivos .csv do Facebook ou Instagram</p>
            </div>
            <button
              type="button"
              className="px-4 py-2 bg-[#F44708] hover:bg-[#D93D07] text-white text-xs font-semibold rounded-lg transition-colors"
            >
              Selecionar arquivo
            </button>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept=".csv"
            className="hidden"
            onChange={(e) => handleFiles(e.target.files)}
          />
        </div>
      </div>
    </div>
  );
}
