import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, useMemo, lazy, Suspense, useRef, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { StatusBadge } from "@/components/app/StatusBadge";
import { EmptyState } from "@/components/app/EmptyState";
import { formatBRL, formatDateTime, formatMonth } from "@/lib/format";
import {
  DollarSign, Eye, TrendingUp, Upload, ArrowRight,
  FileSpreadsheet, CheckCircle2, Clock, ChevronRight,
  Target, Zap, Coins, ChevronDown,
} from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip,
  LineChart, Line, Legend, ComposedChart,
} from "recharts";

const DashboardCharts = lazy(() =>
  import("@/components/app/DashboardCharts").then((m) => ({ default: m.DashboardCharts }))
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

interface PageOption { id: string; name: string }
interface ColabOption { id: string; nome: string; hashtag: string | null }

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

const SEM_COLAB_ID = "__sem_colaborador__";

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
  : String(n);

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
  if (rules.length === 0) return 0;
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

// ─── PageSelect ───────────────────────────────────────────────────────────────

function PageSelect({
  pages,
  value,
  onChange,
  monetizedIds,
}: {
  pages: PageOption[];
  value: string;
  onChange: (v: string) => void;
  monetizedIds: Set<string>;
}) {
  const [open, setOpen] = useState(false);
  const [dropPos, setDropPos] = useState({ top: 0, left: 0, width: 0 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (
        triggerRef.current?.contains(e.target as Node) ||
        dropRef.current?.contains(e.target as Node)
      ) return;
      setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  // Close on scroll/resize so it doesn't float away, but ignore scrolls inside the dropdown itself
  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (dropRef.current && e.target instanceof Node && dropRef.current.contains(e.target)) return;
      setOpen(false);
    };
    const closeResize = () => setOpen(false);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", closeResize);
    return () => { window.removeEventListener("scroll", close, true); window.removeEventListener("resize", closeResize); };
  }, [open]);

  function openDrop() {
    if (!triggerRef.current) return;
    const r = triggerRef.current.getBoundingClientRect();
    setDropPos({ top: r.bottom + 6, left: r.left, width: Math.max(r.width, 240) });
    setOpen((o) => !o);
  }

  const selected = value === "all" ? null : pages.find((p) => p.id === value) ?? null;
  const monetized = pages.filter((p) => monetizedIds.has(p.id));
  const nonMonetized = pages.filter((p) => !monetizedIds.has(p.id));

  function Item({ page }: { page: PageOption }) {
    const isM = monetizedIds.has(page.id);
    const active = value === page.id;
    return (
      <button
        onClick={() => { onChange(page.id); setOpen(false); }}
        className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors text-left ${
          active
            ? "bg-[#F44708] text-white"
            : "text-[#1A0A00] hover:bg-[#FFF0E8]"
        }`}
      >
        <Coins className={`h-3.5 w-3.5 shrink-0 ${active ? "text-white/80" : isM ? "text-emerald-500" : "text-red-400"}`} />
        <span className="truncate">{page.name}</span>
        {active && <span className="ml-auto text-white/60 text-xs">✓</span>}
      </button>
    );
  }

  return (
    <div className="w-full sm:min-w-[200px]">
      {/* Trigger */}
      <button
        ref={triggerRef}
        onClick={openDrop}
        className={`w-full h-8 flex items-center gap-2 px-3 rounded-lg border text-sm transition-all bg-white ${
          open
            ? "border-[#F44708] ring-2 ring-[#F44708]/15"
            : "border-[#E0E0E0] hover:border-[#FAA613]"
        }`}
      >
        {selected ? (
          <>
            <Coins className={`h-3.5 w-3.5 shrink-0 ${monetizedIds.has(selected.id) ? "text-emerald-500" : "text-red-400"}`} />
            <span className="flex-1 truncate text-left font-medium text-[#1A0A00]">{selected.name}</span>
          </>
        ) : (
          <span className="flex-1 text-left text-[#6B6B6B]">Todas as páginas</span>
        )}
        <ChevronDown className={`h-3.5 w-3.5 shrink-0 text-[#6B6B6B] transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
      </button>

      {/* Dropdown — fixed to escape overflow:hidden parents */}
      {open && (
        <div
          ref={dropRef}
          style={{ position: "fixed", top: dropPos.top, left: dropPos.left, minWidth: dropPos.width, zIndex: 9999 }}
          className="bg-white border border-[#E0E0E0] rounded-2xl overflow-hidden"
        >
          {/* "Todas as páginas" option */}
          <div className="p-2 border-b border-[#FFF0E8]">
            <button
              onClick={() => { onChange("all"); setOpen(false); }}
              className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-semibold transition-colors ${
                value === "all"
                  ? "bg-[#F44708] text-white"
                  : "text-[#1A0A00] hover:bg-[#FFF0E8]"
              }`}
            >
              <span className="h-3.5 w-3.5 shrink-0" />
              Todas as páginas
              {value === "all" && <span className="ml-auto text-white/70 text-xs">✓</span>}
            </button>
          </div>

          <div className="max-h-72 overflow-y-auto p-2 space-y-3">
            {monetized.length > 0 && (
              <div>
                <div className="flex items-center gap-1.5 px-3 py-1.5">
                  <Coins className="h-3 w-3 text-emerald-500" />
                  <span className="text-[10px] font-bold uppercase tracking-widest text-emerald-600">Monetizadas</span>
                </div>
                <div className="space-y-px">
                  {monetized.map((p) => <Item key={p.id} page={p} />)}
                </div>
              </div>
            )}

            {nonMonetized.length > 0 && (
              <div>
                <div className="flex items-center gap-1.5 px-3 py-1.5">
                  <Coins className="h-3 w-3 text-red-400" />
                  <span className="text-[10px] font-bold uppercase tracking-widest text-red-500">Não Monetizadas</span>
                </div>
                <div className="space-y-px">
                  {nonMonetized.map((p) => <Item key={p.id} page={p} />)}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function KpiCard({
  label, value, sub, delta, fmtDelta, icon: Icon,
}: {
  label: string;
  value: string;
  sub: string | null;
  delta: number;
  fmtDelta: (n: number) => string;
  icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <div className="bg-white border border-[#E0E0E0] rounded-2xl p-5 transition-colors">
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs font-medium text-[#6B6B6B] uppercase tracking-wider">{label}</p>
        <div className="h-8 w-8 rounded-xl bg-gradient-to-br from-[#FFF0E8] to-[#FFD9C0] flex items-center justify-center">
          <Icon className="h-4 w-4 text-[#F44708]" />
        </div>
      </div>
      <p className="text-2xl font-bold tracking-tight tabular-nums text-[#1A0A00]">{value}</p>
      <div className="flex items-center gap-2 mt-1">
        {sub && <p className="text-xs text-[#6B6B6B]">{sub}</p>}
        {delta !== 0 && (
          <span className={`text-xs font-semibold ${delta > 0 ? "text-[#16a34a]" : "text-[#dc2626]"}`}>
            {delta > 0 ? "+" : ""}{fmtDelta(delta)}
          </span>
        )}
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

function AdminDashboard() {
  const navigate = useNavigate();
  // Initialise directly from cache so there is zero loading flash on re-navigation
  const [loading, setLoading] = useState(() => !(_dashCache && Date.now() - _dashCache.ts < CACHE_TTL));
  const [allPosts, setAllPosts] = useState<RawPost[]>(() => _dashCache?.posts ?? []);
  const [postAuthors, setPostAuthors] = useState<PostAuthorRow[]>(() => _dashCache?.postAuthors ?? []);
  const [splitRules, setSplitRules] = useState<SplitRule[]>(() => _dashCache?.splitRules ?? []);
  const [pages, setPages] = useState<PageOption[]>(() => _dashCache?.pages ?? []);
  const [colabs, setColabs] = useState<ColabOption[]>(() => _dashCache?.colabs ?? []);
  const [manualBonuses, setManualBonuses] = useState<ManualBonusRow[]>([]);
  const [dailyEntries, setDailyEntries] = useState<DailyEntry[]>([]);
  const [recentImports, setRecentImports] = useState<RecentImport[]>(() => _dashCache?.imports ?? []);
  const [usdBrl, setUsdBrl] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState<"overview" | "charts">("overview");
  const [chartMetric, setChartMetric] = useState<"receita" | "views" | "curtidas" | "comentarios" | "compartilhamentos" | "seguidores">("receita");

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
      const [posts, pas, { data: pagesData }, { data: colabsData }, { data: rulesData }, { data: imports }] =
        await Promise.all([
          fetchAllRows<RawPost>(() =>
            supabase.from("posts").select(
              "id, page_id, published_at, monetization_approx, estimated_usd, views, reach, reactions, comments, shares, title, post_type, permalink"
            )
          ),
          fetchAllRows<PostAuthorRow>(() =>
            supabase.from("post_authors").select("post_id, collaborator_id")
          ),
          supabase.from("pages").select("id, nome"),
          supabase.from("collaborators").select("id, nome, hashtag").eq("ativo", true),
          supabase.from("split_rules").select("page_id, effective_from, collaborator_pct, active").eq("active", true),
          supabase.from("csv_imports")
            .select("id, file_name, status, created_at, valid_rows, total_rows, detected_pages_count")
            .order("created_at", { ascending: false })
            .limit(5),
        ]);

      const fresh: DashCache = {
        posts,
        postAuthors: pas,
        pages: (pagesData ?? []).map((p: any) => ({ id: p.id, name: p.nome })),
        colabs: (colabsData ?? []).map((c: any) => ({ id: c.id, nome: c.nome, hashtag: c.hashtag })),
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
        setColabs((data ?? []).map((c: any) => ({ id: c.id, nome: c.nome, hashtag: c.hashtag })));
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
      const share = views / collaboratorIds.length;
      for (const cid of collaboratorIds) {
        prevViewsByColab.set(cid, (prevViewsByColab.get(cid) ?? 0) + share);
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
        const cur = colabAgg.get(SEM_COLAB_ID) ?? { id: SEM_COLAB_ID, nome: "Sem colaborador", hashtag: null, posts: 0, views: 0, reacoes: 0, receita: 0 };
        cur.posts += 1; cur.views += views; cur.reacoes += reacoes; cur.receita += collaboratorRevenue;
        colabAgg.set(SEM_COLAB_ID, cur);
      } else {
        const share = collaboratorRevenue / collaboratorIds.length;
        for (const colabId of collaboratorIds) {
          const colab = colabMap.get(colabId);
          const targetId = colab ? colabId : SEM_COLAB_ID;
          const cur = colabAgg.get(targetId) ?? { id: targetId, nome: colab ? colab.nome : "Sem colaborador", hashtag: colab ? colab.hashtag : null, posts: 0, views: 0, reacoes: 0, receita: 0 };
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
    {
      // Group entries by date, summing only entries that match the page filter
      const actualByDate = new Map<string, number>();
      for (const e of dailyEntries) {
        if (e.actual_revenue_usd === null) continue;
        if (filterFrom && e.entry_date < filterFrom) continue;
        if (filterTo && e.entry_date > filterTo) continue;
        if (filterPage !== "all" && e.page_id !== filterPage) continue;
        actualByDate.set(e.entry_date, (actualByDate.get(e.entry_date) ?? 0) + Number(e.actual_revenue_usd));
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
      if (!merged.has(c.id)) merged.set(c.id, { id: c.id, nome: c.nome, hashtag: c.hashtag, posts: 0, views: 0, reacoes: 0, receita: 0 });
    }
    if (!merged.has(SEM_COLAB_ID)) merged.set(SEM_COLAB_ID, { id: SEM_COLAB_ID, nome: "Sem colaborador", hashtag: null, posts: 0, views: 0, reacoes: 0, receita: 0 });

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
      collabCards: Array.from(merged.values()).sort((a, b) => b.receita - a.receita || a.nome.localeCompare(b.nome, "pt-BR")),
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
    };
  }, [allPosts, postAuthors, splitRules, colabs, manualBonuses, dailyEntries, filterPage, filterColab, filterFrom, filterTo, pages]);

  const {
    kpis, chartData, chartDataCsv, activeMonthRef, collabCards,
    rulesByPage, postToCollabs, pageStats, projections, sparklineByPage,
  } = computed;

  const { totalMonth: correctedTotalMonth, totalMonthCsv, totalViews: csvTotalViews, avgRpm: csvAvgRpm, avgScore } = kpis;

  // ON = show corrected totals (CSV posts + manual corrections); OFF = pure CSV posts only
  const totalMonth = showManual ? correctedTotalMonth : totalMonthCsv;
  const totalViews = showManual && manualKpiTotals.views > 0 ? manualKpiTotals.views : csvTotalViews;
  const avgRpm = showManual && totalViews > 0 && totalMonth > 0
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

  // Projection chart data: last 30 days real + future projection only if filterTo is beyond today
  // Orange line always = pure CSV posts revenue; green line = actual_revenue_usd (manual)
  const projectionChartData = useMemo(() => {
    const hist = chartDataCsv.slice(-30).map((d) => ({ dia: d.dia, real: d.receita, proj: null as number | null }));
    const last = chartDataCsv[chartDataCsv.length - 1];
    const todayStr = new Date().toISOString().slice(0, 10);
    // Only show projection days beyond today if filterTo is in the future
    const projEnd = filterTo && filterTo > todayStr ? filterTo : todayStr;
    const futuro: { dia: string; real: null; proj: number }[] = [];
    for (let i = 1; i <= 28; i++) {
      const d = new Date(todayStr);
      d.setDate(d.getDate() + i);
      const dateStr = d.toISOString().slice(0, 10);
      if (dateStr > projEnd) break;
      const [, mo, dy] = dateStr.split("-");
      futuro.push({ dia: `${dy}/${mo}`, real: null, proj: projections.today });
    }
    if (last) hist[hist.length - 1] = { ...hist[hist.length - 1], proj: projections.today };
    return [...hist, ...futuro];
  }, [chartDataCsv, projections, filterTo]);

  // Map "dd/mm" → actual_revenue_usd for overlay on revenue charts (filtered by selected page)
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

  return (
    <div className="space-y-5 pb-8">

      {/* ── Tab header ── */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Dashboard</h1>
          <p className="text-sm text-[#6B6B6B] mt-0.5">
            {activeMonthRef ? formatMonth(activeMonthRef) : "—"}
            {usdBrl && <span className="ml-2 text-[#6B6B6B]">· USD 1 = {formatBRL(usdBrl)}</span>}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <div className="flex rounded-lg border border-[#E0E0E0] overflow-hidden text-sm">
            <button onClick={() => setActiveTab("overview")}
              className={`px-3 py-1.5 font-medium transition-colors ${activeTab === "overview" ? "bg-[#F44708] text-white" : "text-[#6B6B6B] hover:bg-[#FFF0E8]"}`}>
              Visão Geral
            </button>
            <button onClick={() => setActiveTab("charts")}
              className={`px-3 py-1.5 font-medium transition-colors ${activeTab === "charts" ? "bg-[#F44708] text-white" : "text-[#6B6B6B] hover:bg-[#FFF0E8]"}`}>
              Gráficos
            </button>
          </div>
          <button onClick={() => navigate({ to: "/admin/importacoes" })}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-gradient-to-r from-[#F44708] to-[#FAA613] text-white text-sm font-medium rounded-xl hover:from-[#D93D07] hover:to-[#E09010] transition-all">
            <Upload className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Importar CSV</span>
          </button>
        </div>
      </div>

      {/* ── Filtros ── */}
      <div className="border border-[#E0E0E0] rounded-xl px-4 py-3 bg-white">
        <div className="grid grid-cols-2 sm:flex sm:flex-wrap gap-3 items-end">
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-medium uppercase tracking-wider text-[#6B6B6B]">Página</label>
            <PageSelect
              pages={pages}
              value={filterPage}
              onChange={setFilterPage}
              monetizedIds={monetizedPageIds}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-medium uppercase tracking-wider text-[#6B6B6B]">Colaborador</label>
            <select value={filterColab} onChange={(e) => setFilterColab(e.target.value)}
              className="h-8 rounded-lg border border-[#E0E0E0] bg-white px-2 text-sm w-full sm:min-w-[160px]">
              <option value="all">Todos</option>
              <option value={SEM_COLAB_ID}>Sem colaborador</option>
              {colabs.map((c) => <option key={c.id} value={c.id}>{c.nome}{c.hashtag ? ` (#${c.hashtag})` : ""}</option>)}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-medium uppercase tracking-wider text-[#6B6B6B]">De</label>
            <input type="date" value={filterFrom} onChange={(e) => setFilterFrom(e.target.value)}
              className="h-8 rounded-lg border border-[#E0E0E0] bg-white px-2 text-sm" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-medium uppercase tracking-wider text-[#6B6B6B]">Até</label>
            <input type="date" value={filterTo} onChange={(e) => setFilterTo(e.target.value)}
              className="h-8 rounded-lg border border-[#E0E0E0] bg-white px-2 text-sm" />
          </div>
          {(filterPage !== "all" || filterColab !== "all") && (
            <button onClick={() => { setFilterPage("all"); setFilterColab("all"); }}
              className="h-8 px-3 rounded-lg text-xs text-[#6B6B6B] border border-[#E0E0E0] hover:bg-[#FFF0E8] transition-colors">
              Limpar
            </button>
          )}
          {/* Manual data toggle */}
          <div className="flex flex-col gap-1 col-span-2 sm:col-span-1">
            <label className="text-[10px] font-medium uppercase tracking-wider text-[#6B6B6B]">Dados manuais</label>
            <button
              onClick={() => setShowManual((v) => !v)}
              className="h-8 flex items-center focus:outline-none"
              aria-pressed={showManual}
            >
              <div className={`relative flex items-center h-8 w-[72px] rounded-full px-1 transition-colors duration-200 ${showManual ? "bg-[#F44708]" : "bg-[#D0D0D0]"}`}>
                {/* track label */}
                <span className={`absolute text-[10px] font-bold text-white tracking-wide transition-all duration-200 ${showManual ? "left-2.5" : "right-2.5"}`}>
                  {showManual ? "ON" : "OFF"}
                </span>
                {/* thumb */}
                <span className={`relative z-10 h-6 w-6 rounded-full bg-white shadow-md transition-all duration-200 shrink-0 ${showManual ? "translate-x-[36px]" : "translate-x-0"}`} />
              </div>
            </button>
          </div>
        </div>
      </div>

      {activeTab === "charts" && !loading && chartData.length > 0 && (
        <Suspense fallback={<div className="h-48 bg-[#FFF0E8] rounded-xl animate-pulse" />}>
          <DashboardCharts data={chartData} />
        </Suspense>
      )}

      {activeTab === "overview" && (
        <>
          {/* ── KPI Strip ── */}
          {(() => {
            const avgScore = !loading && pageStatsWithGlobalScores.length > 0
              ? Math.round(pageStatsWithGlobalScores.reduce((s, p) => s + p.score, 0) / pageStatsWithGlobalScores.length)
              : 0;
            const scoreColor = avgScore >= 75 ? "#16a34a" : avgScore >= 50 ? "#f59e0b" : avgScore >= 25 ? "#f97316" : "#F44708";
            return (
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                {/* Receita do Período */}
                <KpiCard
                  label="Receita do Período"
                  value={loading ? "—" : usdBrl ? formatBRL(totalMonth * usdBrl) : `$${totalMonth.toFixed(2)}`}
                  sub={usdBrl && !loading ? `$${totalMonth.toFixed(2)} USD` : null}
                  delta={showManual && !loading ? totalMonth - totalMonthCsv : 0}
                  fmtDelta={(n) => usdBrl ? formatBRL(Math.abs(n) * usdBrl) : `$${Math.abs(n).toFixed(2)}`}
                  icon={DollarSign}
                />
                {/* RPM Médio */}
                <KpiCard
                  label="RPM Médio"
                  value={loading ? "—" : usdBrl ? formatBRL(avgRpm * usdBrl) : `$${avgRpm.toFixed(4)}`}
                  sub="por mil visualizações"
                  delta={showManual && !loading ? avgRpm - csvAvgRpm : 0}
                  fmtDelta={(n) => usdBrl ? formatBRL(Math.abs(n) * usdBrl) : `$${Math.abs(n).toFixed(4)}`}
                  icon={Zap}
                />
                {/* Visualizações */}
                <KpiCard
                  label="Visualizações"
                  value={loading ? "—" : fmt(totalViews)}
                  sub={`${kpis.totalPosts.toLocaleString("pt-BR")} posts`}
                  delta={showManual && !loading ? totalViews - csvTotalViews : 0}
                  fmtDelta={(n) => fmt(Math.abs(n))}
                  icon={Eye}
                />
              </div>

                {/* Score Médio — com velocímetro */}
                <div className="bg-white border border-[#E0E0E0] rounded-2xl p-5 transition-colors flex flex-col">
                  <div className="flex items-center justify-between mb-1">
                    <p className="text-xs font-medium text-[#6B6B6B] uppercase tracking-wider">Score Médio</p>
                    <div className="h-8 w-8 rounded-xl bg-gradient-to-br from-[#FFF0E8] to-[#FFD9C0] flex items-center justify-center">
                      <TrendingUp className="h-4 w-4 text-[#F44708]" />
                    </div>
                  </div>
                  {loading ? (
                    <p className="text-2xl font-bold text-[#1A0A00] mt-2">—</p>
                  ) : (
                    <div className="flex items-end gap-3">
                      <DashSpeedometer score={avgScore} />
                      <div className="pb-1">
                        <p className="text-2xl font-bold tabular-nums" style={{ color: scoreColor }}>{avgScore}<span className="text-sm font-normal text-[#6B6B6B]">/100</span></p>
                        <p className="text-xs text-[#6B6B6B] mt-0.5">{pageStatsWithGlobalScores.length} páginas</p>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })()}

          {/* ── Gráfico com abas de métricas ── */}
          {(() => {
            const METRIC_TABS = [
              { key: "receita" as const,           label: "Receita" },
              { key: "views" as const,              label: "Views" },
              { key: "seguidores" as const,         label: "Seguidores" },
              { key: "curtidas" as const,           label: "Curtidas" },
              { key: "comentarios" as const,        label: "Comentários" },
              { key: "compartilhamentos" as const,  label: "Compartilhamentos" },
            ];

            const fmtMetricVal = (v: number) => {
              if (chartMetric === "receita") return usdBrl ? formatBRL(v * usdBrl) : `$${v.toFixed(4)}`;
              return v >= 1_000_000 ? `${(v / 1_000_000).toFixed(1)}M`
                : v >= 1_000 ? `${(v / 1_000).toFixed(1)}k`
                : v.toLocaleString("pt-BR");
            };

            const activeDataset = filterPage === "all"
              ? (chartMetric === "seguidores" ? multiPageFollowersDataset : multiPageAllMetrics?.[chartMetric] ?? null)
              : null;

            return (
              <div className="bg-white border border-[#E0E0E0] rounded-2xl p-5">
                {/* Header: title + tabs */}
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
                  <div>
                    <h2 className="text-sm font-semibold">
                      {filterPage === "all" ? "Métricas por Página" : "Métricas" + (chartMetric === "receita" ? " + Projeção" : "")}
                    </h2>
                    <p className="text-xs text-[#6B6B6B] mt-0.5">
                      {filterPage === "all" ? "Uma área por página" : chartMetric === "receita" ? "Histórico real e projeção 28 dias" : "Histórico do período"}
                    </p>
                  </div>
                  {/* Tabs */}
                  <div className="flex flex-wrap gap-1">
                    {METRIC_TABS.map(({ key, label }) => (
                      <button
                        key={key}
                        onClick={() => setChartMetric(key)}
                        className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors whitespace-nowrap ${
                          chartMetric === key
                            ? "bg-[#F44708] text-white"
                            : "text-[#6B6B6B] border border-[#E0E0E0] hover:bg-[#FFF0E8]"
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="h-80">
                  <ResponsiveContainer width="100%" height="100%">
                    {filterPage === "all" && activeDataset && activeDataset.data.length > 0 ? (
                      <ComposedChart
                        data={chartMetric === "receita" && showManual
                          ? activeDataset.data.map((row) => ({ ...row, __actual: dailyActualByDia.get(row.dia) ?? null }))
                          : chartMetric === "views" && showManual
                          ? activeDataset.data.map((row) => {
                              const extra: Record<string, number | null> = {};
                              for (const pid of activeDataset.pageIds) {
                                extra[`__actual_${pid}`] = dailyActualViewsByPage.get(pid)?.get(row.dia) ?? null;
                              }
                              return { ...row, ...extra };
                            })
                          : activeDataset.data}
                        margin={{ top: 4, right: 8, left: 0, bottom: 0 }}
                      >
                        <defs>
                          {activeDataset.pageIds.map((pid, i) => (
                            <linearGradient key={pid} id={`grad-${i}`} x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor={PAGE_COLORS[i % PAGE_COLORS.length]} stopOpacity={0.45} />
                              <stop offset="95%" stopColor={PAGE_COLORS[i % PAGE_COLORS.length]} stopOpacity={0.05} />
                            </linearGradient>
                          ))}
                          <linearGradient id="gradActualMulti" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#F44708" stopOpacity={0.75} />
                            <stop offset="95%" stopColor="#F44708" stopOpacity={0.15} />
                          </linearGradient>
                        </defs>
                        <XAxis dataKey="dia" tick={{ fontSize: 10, fill: "#6B6B6B" }} interval="preserveStartEnd" axisLine={false} tickLine={false} />
                        <YAxis hide />
                        <Tooltip
                          formatter={(v: any, name: string) => {
                            if (v === null || Number(v) === 0) return null as any;
                            return [fmtMetricVal(Number(v)), name];
                          }}
                          labelStyle={{ color: "#1A0A00", fontSize: 11, fontWeight: 600 }}
                          contentStyle={{ border: "1px solid #E0E0E0", borderRadius: 12, fontSize: 11, boxShadow: "none" }}
                        />
                        <Legend content={() => null} />
                        {activeDataset.pageIds.map((pid, i) => (
                          <Area
                            key={pid}
                            type="monotone"
                            dataKey={pid}
                            name={activeDataset.pageNameById.get(pid) ?? "Sem nome"}
                            stroke="none"
                            strokeWidth={0}
                            fill={`url(#grad-${i})`}
                            dot={false}
                            connectNulls
                          />
                        ))}
                        {chartMetric === "receita" && showManual && (
                          <Area
                            type="monotone"
                            dataKey="__actual"
                            name="Real Recebido"
                            stroke="none"
                            strokeWidth={0}
                            fill="url(#gradActualMulti)"
                            dot={false}
                            connectNulls
                            legendType="none"
                          />
                        )}
                        {chartMetric === "views" && showManual && activeDataset.pageIds.map((pid, i) => (
                          <Area
                            key={`__actual_${pid}`}
                            type="monotone"
                            dataKey={`__actual_${pid}`}
                            name={`${activeDataset.pageNameById.get(pid) ?? "Sem nome"} (manual)`}
                            stroke="none"
                            strokeWidth={0}
                            fill={PAGE_COLORS[i % PAGE_COLORS.length]}
                            fillOpacity={0.5}
                            dot={false}
                            connectNulls
                            legendType="none"
                          />
                        ))}
                      </ComposedChart>
                    ) : filterPage !== "all" && chartMetric === "receita" ? (
                      <ComposedChart
                        data={showManual ? projectionChartData.map((row) => ({ ...row, actual: dailyActualByDia.get(row.dia) ?? null })) : projectionChartData}
                        margin={{ top: 4, right: 0, left: 0, bottom: 0 }}
                      >
                        <defs>
                          <linearGradient id="gradReal" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#F44708" stopOpacity={0.25} />
                            <stop offset="95%" stopColor="#F44708" stopOpacity={0} />
                          </linearGradient>
                          <linearGradient id="gradProj" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#FAC46A" stopOpacity={0.25} />
                            <stop offset="95%" stopColor="#FAC46A" stopOpacity={0} />
                          </linearGradient>
                          <linearGradient id="gradActual" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#F44708" stopOpacity={0.75} />
                            <stop offset="95%" stopColor="#F44708" stopOpacity={0.15} />
                          </linearGradient>
                        </defs>
                        <XAxis dataKey="dia" tick={{ fontSize: 10, fill: "#6B6B6B" }} interval="preserveStartEnd" axisLine={false} tickLine={false} />
                        <YAxis hide />
                        <Tooltip
                          formatter={(v: any) => v !== null ? (usdBrl ? formatBRL(Number(v) * usdBrl) : `$${Number(v).toFixed(4)}`) : "—"}
                          labelStyle={{ color: "#1A0A00", fontSize: 11 }}
                          contentStyle={{ border: "1px solid #E0E0E0", borderRadius: 10, fontSize: 11 }}
                        />
                        <Legend content={() => null} />
                        <Area type="monotone" dataKey="real" stroke="none" strokeWidth={0} fill="url(#gradReal)" dot={false} connectNulls={false} legendType="none" />
                        <Area type="monotone" dataKey="proj" stroke="none" strokeWidth={0} fill="url(#gradProj)" dot={false} connectNulls={false} legendType="none" />
                        {showManual && <Area type="monotone" dataKey="actual" stroke="none" strokeWidth={0} fill="url(#gradActual)" dot={false} connectNulls={false} legendType="none" />}
                      </ComposedChart>
                    ) : singlePageMetricData && singlePageMetricData.length > 0 ? (
                      <ComposedChart
                        data={chartMetric === "views" && showManual
                          ? singlePageMetricData.map((row) => ({ ...row, actual: dailyActualViewsByDia.get(row.dia) ?? null }))
                          : singlePageMetricData}
                        margin={{ top: 4, right: 8, left: 0, bottom: 0 }}
                      >
                        <defs>
                          <linearGradient id="gradSingle" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#F44708" stopOpacity={0.3} />
                            <stop offset="95%" stopColor="#F44708" stopOpacity={0} />
                          </linearGradient>
                          <linearGradient id="gradSingleActual" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#F44708" stopOpacity={0.75} />
                            <stop offset="95%" stopColor="#F44708" stopOpacity={0.15} />
                          </linearGradient>
                        </defs>
                        <XAxis dataKey="dia" tick={{ fontSize: 10, fill: "#6B6B6B" }} interval="preserveStartEnd" axisLine={false} tickLine={false} />
                        <YAxis hide />
                        <Tooltip
                          formatter={(v: any, name: string) => {
                            if (v === null) return null as any;
                            const label = name === "actual" ? "Views Manuais" : (METRIC_TABS.find((t) => t.key === chartMetric)?.label ?? chartMetric);
                            return [fmtMetricVal(Number(v)), label];
                          }}
                          labelStyle={{ color: "#1A0A00", fontSize: 11 }}
                          contentStyle={{ border: "1px solid #E0E0E0", borderRadius: 10, fontSize: 11 }}
                        />
                        <Legend content={() => null} />
                        <Area type="monotone" dataKey="value" stroke="none" strokeWidth={0} fill="url(#gradSingle)" dot={false} connectNulls legendType="none" />
                        {chartMetric === "views" && showManual && (
                          <Area type="monotone" dataKey="actual" stroke="none" strokeWidth={0} fill="url(#gradSingleActual)" dot={false} connectNulls legendType="none" />
                        )}
                      </ComposedChart>
                    ) : (
                      <AreaChart data={[]} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                        <XAxis tick={{ fontSize: 10, fill: "#6B6B6B" }} axisLine={false} tickLine={false} />
                        <YAxis hide />
                      </AreaChart>
                    )}
                  </ResponsiveContainer>
                </div>

                {filterPage === "all" && !activeDataset && (
                  <p className="text-center text-xs text-[#6B6B6B] mt-2">Nenhum dado para esta métrica no período</p>
                )}
              </div>
            );
          })()}

          {/* ── Colaboradores ── */}
          {!loading && collabCards.filter((c) => c.id !== SEM_COLAB_ID && c.posts > 0).length > 0 && (
            <div className="bg-white border border-[#E0E0E0] rounded-xl overflow-hidden">
              <div className="px-5 py-3.5 border-b border-[#F0E0D0]">
                <h2 className="text-sm font-semibold">Colaboradores</h2>
              </div>
              <div className="divide-y divide-[#FFF0E8]">
                {collabCards.filter((c) => c.posts > 0).slice(0, 10).map((item) => (
                  <div key={item.id} className="px-5 py-3 flex items-center justify-between gap-4 hover:bg-[#FFF0E8]/50 transition-colors">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">{item.nome}</p>
                      <p className="text-xs text-[#6B6B6B]">
                        {item.hashtag ? `#${item.hashtag} · ` : ""}{item.posts.toLocaleString("pt-BR")} posts · {fmt(item.views)} views
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <div className="text-right">
                        {usdBrl ? (
                          <>
                            <p className="text-sm font-semibold tabular-nums">{formatBRL(item.receita * usdBrl)}</p>
                            <p className="text-xs text-[#6B6B6B] tabular-nums">${item.receita.toFixed(2)}</p>
                          </>
                        ) : (
                          <p className="text-sm font-semibold tabular-nums">${item.receita.toFixed(2)}</p>
                        )}
                      </div>
                      <button onClick={() => setAuditColabId(item.id)}
                        className="px-2.5 py-1.5 rounded-lg bg-[#F44708] text-white text-xs font-medium hover:bg-[#D93D07] transition-colors">
                        Ver
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
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

