import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, useMemo, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import fbLogo from "@/assets/facebook.png";
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from "recharts";
import {
  CheckCircle2, Flame, AlertCircle, Activity, Rocket, Target,
  ChevronDown, Search, BarChart2, Zap, Eye, FileText, TrendingUp,
  LayoutGrid, User, ArrowUp, Info,
} from "lucide-react";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/admin/monetizacao")({
  head: () => ({ meta: [{ title: "Monetização — Splash Creators" }] }),
  component: MonetizacaoPage,
});

// ─── Types ────────────────────────────────────────────────────────────────────

interface RawPost {
  id: string; page_id: string; published_at: string | null;
  monetization_approx: number | null; estimated_usd: number | null;
  views: number | null; reactions: number | null; comments: number | null;
  shares: number | null; post_type: string | null;
}
interface PageRow { id: string; nome: string }
interface PostBucket {
  views: number; reactions: number; comments: number; shares: number;
  videos: number; count: number; dates: string[];
}
interface PageMonetStat {
  id: string; name: string; isMonetized: boolean;
  firstPostDate: string | null; lastPostDate: string | null;
  firstPaymentDate: string | null; daysToMonetize: number | null;
  posts: number; views: number; likes: number; comments: number;
  shares: number; videos: number; activeDays: number; longestStreak: number;
  postsPerActiveDay: number; avgViewsPerPost: number; avgLikes: number;
  avgComments: number; avgShares: number; engRate: number; videoPct: number;
  viewsPerActiveDay: number; currentStreak: number;
  daysSinceLastPost: number | null; isActive: boolean;
}
interface Template {
  days: number; posts: number; views: number; avgViewsPerPost: number;
  engRate: number; videoPct: number; activeDays: number;
  postsPerActiveDay: number; longestStreak: number; avgLikes: number;
  avgComments: number; avgShares: number; viewsPerActiveDay: number;
  minViews: number; maxViews: number; minPosts: number; maxPosts: number;
  minDays: number; maxDays: number;
}
interface Milestone {
  label: string; detail: string; status: "done" | "progress" | "pending";
}

// ─── Core Helpers ─────────────────────────────────────────────────────────────

const fmt = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M`
  : n >= 1_000 ? `${Math.round(n / 1_000)}k`
  : String(Math.round(n));

const daysBetween = (a: string, b: string) =>
  Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86_400_000);

function getUsd(p: RawPost) {
  return Number(p.monetization_approx ?? 0) > 0 ? Number(p.monetization_approx) : Number(p.estimated_usd ?? 0);
}

function calcStreaks(sortedDates: string[]): { longest: number; current: number } {
  if (!sortedDates.length) return { longest: 0, current: 0 };
  const days = [...new Set(sortedDates.map(d => d.slice(0, 10)))].sort();
  let longest = 1, run = 1;
  for (let i = 1; i < days.length; i++) {
    if (daysBetween(days[i - 1], days[i]) === 1) { run++; longest = Math.max(longest, run); } else { run = 1; }
  }
  const today = new Date().toISOString().slice(0, 10);
  const last = days[days.length - 1];
  let current = 0;
  if (daysBetween(last, today) <= 1) {
    current = 1;
    for (let i = days.length - 2; i >= 0; i--) {
      if (daysBetween(days[i], days[i + 1]) === 1) current++; else break;
    }
  }
  return { longest: Math.max(longest, 1), current };
}

function sumBucket(posts: RawPost[]): PostBucket {
  let views = 0, reactions = 0, comments = 0, shares = 0, videos = 0;
  const dates: string[] = [];
  for (const p of posts) {
    views += Number(p.views ?? 0); reactions += Number(p.reactions ?? 0);
    comments += Number(p.comments ?? 0); shares += Number(p.shares ?? 0);
    const t = (p.post_type ?? "").toLowerCase();
    if (t.includes("video") || t === "reel") videos++;
    if (p.published_at) dates.push(p.published_at);
  }
  return { views, reactions, comments, shares, videos, count: posts.length, dates };
}

function buildStats(pages: PageRow[], posts: RawPost[]): PageMonetStat[] {
  const today = new Date().toISOString().slice(0, 10);
  const byPage = new Map<string, RawPost[]>();
  for (const p of posts) {
    if (!p.published_at) continue;
    const arr = byPage.get(p.page_id) ?? []; arr.push(p); byPage.set(p.page_id, arr);
  }
  return pages.map(page => {
    const all = (byPage.get(page.id) ?? []).sort((a, b) => (a.published_at ?? "").localeCompare(b.published_at ?? ""));
    const firstPostDate = all[0]?.published_at?.slice(0, 10) ?? null;
    const lastPostDate = all[all.length - 1]?.published_at?.slice(0, 10) ?? null;
    const revenueIdxs = all.reduce<number[]>((acc, p, i) => { if (getUsd(p) > 0) acc.push(i); return acc; }, []);
    const isMonetized = revenueIdxs.length >= 3;
    const firstPayIdx = isMonetized ? revenueIdxs[0] : -1;
    const firstPaymentDate = isMonetized ? all[firstPayIdx].published_at?.slice(0, 10) ?? null : null;
    const daysToMonetize = isMonetized && firstPostDate && firstPaymentDate ? daysBetween(firstPostDate, firstPaymentDate) : null;
    const bucket = sumBucket(isMonetized ? all.slice(0, firstPayIdx) : all);
    const activeDays = new Set(bucket.dates.map(d => d.slice(0, 10))).size;
    const { longest: longestStreak, current: currentStreak } = calcStreaks(bucket.dates);
    const daysSinceLastPost = lastPostDate ? daysBetween(lastPostDate, today) : null;
    const isActive = daysSinceLastPost !== null && daysSinceLastPost <= 7;
    const n = bucket.count;
    return {
      id: page.id, name: page.nome, isMonetized, firstPostDate, lastPostDate,
      firstPaymentDate, daysToMonetize, posts: n, views: bucket.views,
      likes: bucket.reactions, comments: bucket.comments, shares: bucket.shares,
      videos: bucket.videos, activeDays, longestStreak,
      postsPerActiveDay: activeDays > 0 ? n / activeDays : 0,
      avgViewsPerPost: n > 0 ? bucket.views / n : 0,
      avgLikes: n > 0 ? bucket.reactions / n : 0,
      avgComments: n > 0 ? bucket.comments / n : 0,
      avgShares: n > 0 ? bucket.shares / n : 0,
      engRate: bucket.views > 0 ? (bucket.reactions + bucket.comments + bucket.shares) / bucket.views : 0,
      videoPct: n > 0 ? (bucket.videos / n) * 100 : 0,
      viewsPerActiveDay: activeDays > 0 ? bucket.views / activeDays : 0,
      currentStreak, daysSinceLastPost, isActive,
    };
  });
}

function readinessScore(s: PageMonetStat, tpl: Template): number {
  const viewsPct = Math.min(s.views / tpl.views, 1);
  const postsPct = Math.min(s.posts / tpl.posts, 1);
  const engPct = tpl.engRate > 0 ? Math.min(s.engRate / tpl.engRate, 1) : 1;
  const cadPct = tpl.postsPerActiveDay > 0 ? Math.min(s.postsPerActiveDay / tpl.postsPerActiveDay, 1) : 1;
  return Math.round(viewsPct * 40 + postsPct * 35 + engPct * 15 + cadPct * 10);
}

function estimateDaysNum(s: PageMonetStat, tpl: Template): number {
  if (s.isMonetized) return 0;
  if (s.postsPerActiveDay <= 0 && s.viewsPerActiveDay <= 0) return 9999;
  const postsGap = Math.max(0, tpl.posts - s.posts);
  const viewsGap = Math.max(0, tpl.views - s.views);
  const postsDays = s.postsPerActiveDay > 0 && postsGap > 0 ? postsGap / s.postsPerActiveDay : 0;
  const viewsDays = s.viewsPerActiveDay > 0 && viewsGap > 0 ? viewsGap / s.viewsPerActiveDay : 0;
  return Math.max(0, Math.ceil(Math.max(postsDays, viewsDays)));
}

function computeMilestones(s: PageMonetStat, tpl: Template): Milestone[] {
  const postsR = Math.min(s.posts / Math.max(tpl.posts, 1), 1);
  const viewsR = Math.min(s.views / Math.max(tpl.views, 1), 1);
  const engR = tpl.engRate > 0 ? Math.min(s.engRate / tpl.engRate, 1) : 1;
  return [
    { label: "Página criada", detail: "Concluído", status: "done" },
    {
      label: `${Math.round(tpl.posts)} posts publicados`,
      detail: postsR >= 1 ? "Concluído" : `${Math.round(postsR * 100)}% do caminho`,
      status: postsR >= 1 ? "done" : postsR >= 0.25 ? "progress" : "pending",
    },
    {
      label: `${fmt(tpl.views)} views acumuladas`,
      detail: viewsR >= 1 ? "Concluído" : `${Math.round(viewsR * 100)}% do caminho`,
      status: viewsR >= 1 ? "done" : viewsR >= 0.25 ? "progress" : "pending",
    },
    {
      label: "Engajamento consistente",
      detail: engR >= 1 ? "Concluído" : `${Math.round(engR * 100)}% do caminho`,
      status: engR >= 1 ? "done" : engR >= 0.5 ? "progress" : "pending",
    },
    { label: "Monetização ativada", detail: s.isMonetized ? "Concluído" : "Pendente", status: s.isMonetized ? "done" : "pending" },
  ];
}

function computeDayOfWeek(posts: RawPost[]) {
  const map = new Map<number, { total: number; count: number }>();
  const names = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
  for (const p of posts) {
    if (!p.published_at || !p.views) continue;
    const dt = new Date(p.published_at.length === 10 ? p.published_at + "T12:00:00" : p.published_at);
    if (isNaN(dt.getTime())) continue;
    const d = dt.getDay();
    const e = map.get(d) ?? { total: 0, count: 0 };
    e.total += Number(p.views); e.count++; map.set(d, e);
  }
  return [0, 1, 2, 3, 4, 5, 6].map(d => ({
    day: d, name: names[d],
    avg: map.has(d) ? map.get(d)!.total / map.get(d)!.count : 0,
  }));
}

function computeFormats(posts: RawPost[]) {
  const map = new Map<string, { total: number; count: number }>();
  for (const p of posts) {
    if (!p.views) continue;
    const t = (p.post_type ?? "").toLowerCase();
    const f = t.includes("video") || t === "reel" ? "Vídeos"
      : t.includes("photo") || t.includes("foto") ? "Fotos"
      : t.includes("link") ? "Links"
      : t.includes("text") ? "Textos"
      : "Outros";
    const e = map.get(f) ?? { total: 0, count: 0 };
    e.total += Number(p.views); e.count++; map.set(f, e);
  }
  const rows = [...map.entries()].map(([format, { total, count }]) => ({ format, avg: total / count, count }));
  rows.sort((a, b) => b.avg - a.avg);
  return rows;
}

function computeNextGoal(s: PageMonetStat, tpl: Template) {
  if (s.isMonetized) return null;
  const candidates = [
    { label: "views acumuladas", current: s.views, target: Math.round(tpl.views), unit: "views", ratio: s.views / tpl.views },
    { label: "posts publicados", current: s.posts, target: Math.round(tpl.posts), unit: "posts", ratio: s.posts / tpl.posts },
  ].filter(g => g.ratio < 1).sort((a, b) => a.ratio - b.ratio);
  return candidates[0] ?? null;
}

function computeWeeklyFocus(s: PageMonetStat, tpl: Template, pagePosts: RawPost[]) {
  const cutoff = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
  const recent = pagePosts.filter(p => p.published_at && p.published_at.slice(0, 10) >= cutoff);
  const postsThisWeek = recent.length;
  const targetPerWeek = Math.max(3, Math.round(tpl.postsPerActiveDay * 5));
  const recentFormats = new Set(recent.map(p => {
    const t = (p.post_type ?? "").toLowerCase();
    return t.includes("video") || t === "reel" ? "video" : t.includes("photo") || t.includes("foto") ? "photo" : "other";
  }));
  const streakTarget = Math.max(3, Math.min(7, Math.round(tpl.longestStreak / 3)));
  return [
    { action: `Postar ${targetPerWeek}x na semana`, done: postsThisWeek >= targetPerWeek },
    { action: `Manter ${streakTarget} dias seguidos`, done: s.currentStreak >= streakTarget },
    { action: "Responder comentários diariamente", done: false },
    { action: "Testar um formato diferente", done: recentFormats.size >= 2 },
  ];
}

function computePercentile(s: PageMonetStat, allStats: PageMonetStat[], tpl: Template | null) {
  if (!tpl) return 50;
  const myScore = s.isMonetized ? 100 : readinessScore(s, tpl);
  const all = allStats.map(st => st.isMonetized ? 100 : readinessScore(st, tpl));
  const below = all.filter(sc => sc < myScore).length;
  return Math.round((below / Math.max(all.length - 1, 1)) * 100);
}

// ─── Main Page ────────────────────────────────────────────────────────────────

type ViewMode = "individual" | "geral";

export default function MonetizacaoPage() {
  const [pages, setPages] = useState<PageRow[]>([]);
  const [posts, setPosts] = useState<RawPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [view, setView] = useState<ViewMode>("individual");

  useEffect(() => {
    const load = async () => {
      const [{ data: pagesData }, postsData] = await Promise.all([
        supabase.from("pages").select("id, nome"),
        (async () => {
          const PAGE = 1000; let from = 0; const all: RawPost[] = [];
          while (true) {
            const { data, error } = await supabase.from("posts")
              .select("id, page_id, published_at, monetization_approx, estimated_usd, views, reactions, comments, shares, post_type")
              .range(from, from + PAGE - 1);
            if (error || !data || !data.length) break;
            all.push(...(data as RawPost[]));
            if (data.length < PAGE) break; from += data.length;
          }
          return all;
        })(),
      ]);
      setPages((pagesData ?? []) as PageRow[]);
      setPosts(postsData);
      setLoading(false);
    };
    load();
  }, []);

  const stats = useMemo(() => buildStats(pages, posts), [pages, posts]);
  const monetized = useMemo(() =>
    stats.filter(s => s.isMonetized).sort((a, b) => (a.daysToMonetize ?? 999) - (b.daysToMonetize ?? 999)), [stats]);
  const warming = useMemo(() => stats.filter(s => !s.isMonetized && s.firstPostDate), [stats]);

  const template = useMemo((): Template | null => {
    if (!monetized.length) return null;
    const avg = (arr: number[]) => arr.reduce((s, v) => s + v, 0) / arr.length;
    return {
      days: avg(monetized.map(m => m.daysToMonetize ?? 0)),
      posts: avg(monetized.map(m => m.posts)),
      views: avg(monetized.map(m => m.views)),
      avgViewsPerPost: avg(monetized.map(m => m.avgViewsPerPost)),
      engRate: avg(monetized.map(m => m.engRate)),
      videoPct: avg(monetized.map(m => m.videoPct)),
      activeDays: avg(monetized.map(m => m.activeDays)),
      postsPerActiveDay: avg(monetized.map(m => m.postsPerActiveDay)),
      longestStreak: avg(monetized.map(m => m.longestStreak)),
      avgLikes: avg(monetized.map(m => m.avgLikes)),
      avgComments: avg(monetized.map(m => m.avgComments)),
      avgShares: avg(monetized.map(m => m.avgShares)),
      viewsPerActiveDay: avg(monetized.map(m => m.viewsPerActiveDay)),
      minViews: Math.min(...monetized.map(m => m.views)),
      maxViews: Math.max(...monetized.map(m => m.views)),
      minPosts: Math.min(...monetized.map(m => m.posts)),
      maxPosts: Math.max(...monetized.map(m => m.posts)),
      minDays: Math.min(...monetized.map(m => m.daysToMonetize ?? 0)),
      maxDays: Math.max(...monetized.map(m => m.daysToMonetize ?? 0)),
    };
  }, [monetized]);

  const warmingSorted = useMemo(() =>
    template ? [...warming].sort((a, b) => readinessScore(b, template) - readinessScore(a, template)) : warming,
    [warming, template]);

  const leaderboard = useMemo(() => {
    const allSorted = [...monetized, ...warmingSorted];
    return allSorted.map(s => ({
      stat: s,
      score: s.isMonetized ? 100 : (template ? readinessScore(s, template) : 0),
      days: template ? estimateDaysNum(s, template) : 9999,
    }));
  }, [monetized, warmingSorted, template]);

  useEffect(() => {
    if (!selectedId) {
      if (warmingSorted.length > 0) setSelectedId(warmingSorted[0].id);
      else if (monetized.length > 0) setSelectedId(monetized[0].id);
    }
  }, [warmingSorted, monetized, selectedId]);

  const selectedStat = useMemo(() => stats.find(s => s.id === selectedId) ?? null, [stats, selectedId]);
  const pagePosts = useMemo(() => selectedId ? posts.filter(p => p.page_id === selectedId) : [], [posts, selectedId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground text-sm">
        <Activity className="h-5 w-5 mr-2 animate-pulse" /> Carregando dados...
      </div>
    );
  }

  return (
    <div className="space-y-5 pb-12">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight" style={{ color: "#1A0A00" }}>Monetização</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Transforme consistência em receita.</p>
      </div>

      {/* Filter row */}
      <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-3 items-end">
        <PageDropdown
          pages={pages} stats={stats} selectedId={selectedId}
          onSelect={setSelectedId}
        />
        <ViewToggle view={view} onView={setView} />
      </div>

      {/* Content */}
      {view === "individual" && selectedStat && template ? (
        <IndividualDashboard
          s={selectedStat} template={template} pagePosts={pagePosts}
          allStats={stats}
        />
      ) : (
        <OverviewGrid monetized={monetized} warmingSorted={warmingSorted} template={template} />
      )}
    </div>
  );
}

// ─── Page Dropdown ────────────────────────────────────────────────────────────

function PageDropdown({ pages, stats, selectedId, onSelect }: {
  pages: PageRow[]; stats: PageMonetStat[]; selectedId: string | null; onSelect: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const selectedStat = stats.find(s => s.id === selectedId);
  const monetizedIds = new Set(stats.filter(s => s.isMonetized).map(s => s.id));
  const today = new Date().toISOString().slice(0, 10);
  const ageDays = selectedStat?.firstPostDate ? daysBetween(selectedStat.firstPostDate, today) : null;

  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);

  const filtered = pages.filter(p => p.nome.toLowerCase().includes(query.toLowerCase()));
  const mon = filtered.filter(p => monetizedIds.has(p.id));
  const notMon = filtered.filter(p => !monetizedIds.has(p.id));

  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">Página selecionada</p>
      <div className="relative" ref={ref}>
        <button onClick={() => setOpen(o => !o)}
          className="w-full flex items-center gap-2.5 bg-white border border-border rounded-xl px-3 py-2.5 text-sm hover:border-[#F44708] transition-colors">
          {selectedStat && <PageAvatar name={selectedStat.name} size={28} />}
          <div className="flex-1 text-left min-w-0">
            <div className="font-semibold truncate" style={{ color: "#1A0A00" }}>{selectedStat?.name ?? "Selecionar"}</div>
            {selectedStat && ageDays !== null && (
              <div className="text-[11px] text-muted-foreground">
                {selectedStat.posts} posts · ativa há {ageDays}d
              </div>
            )}
          </div>
          {selectedStat && monetizedIds.has(selectedStat.id) && (
            <span className="h-2 w-2 rounded-full bg-green-500 shrink-0" />
          )}
          <ChevronDown className={cn("h-4 w-4 text-muted-foreground shrink-0 transition-transform", open && "rotate-180")} />
        </button>

        {open && (
          <div className="absolute top-full mt-1.5 left-0 right-0 bg-white border border-border rounded-xl z-50 overflow-hidden">
            <div className="p-2 border-b border-border">
              <div className="flex items-center gap-2 bg-muted rounded-lg px-2.5 py-1.5">
                <Search className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <input autoFocus value={query} onChange={e => setQuery(e.target.value)}
                  placeholder="Buscar página..." className="flex-1 bg-transparent text-sm outline-none" />
              </div>
            </div>
            <div className="max-h-64 overflow-y-auto py-1">
              {mon.length > 0 && (
                <>
                  <p className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-green-600">Monetizadas</p>
                  {mon.map(p => <PageOption key={p.id} page={p} stats={stats} selectedId={selectedId} onSelect={id => { onSelect(id); setOpen(false); setQuery(""); }} />)}
                </>
              )}
              {notMon.length > 0 && (
                <>
                  <p className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-red-500">Não monetizadas</p>
                  {notMon.map(p => <PageOption key={p.id} page={p} stats={stats} selectedId={selectedId} onSelect={id => { onSelect(id); setOpen(false); setQuery(""); }} />)}
                </>
              )}
              {filtered.length === 0 && (
                <p className="text-center text-sm text-muted-foreground py-4">Nenhuma página</p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function PageOption({ page, stats, selectedId, onSelect }: {
  page: PageRow; stats: PageMonetStat[]; selectedId: string | null; onSelect: (id: string) => void;
}) {
  const stat = stats.find(s => s.id === page.id);
  const isSelected = selectedId === page.id;
  return (
    <button onClick={() => onSelect(page.id)}
      className={cn("w-full flex items-center gap-2.5 px-3 py-2 text-sm hover:bg-muted transition-colors", isSelected && "bg-[#FFF0E8]")}>
      <PageAvatar name={page.nome} size={28} />
      <div className="flex-1 text-left min-w-0">
        <div className="font-medium truncate" style={{ color: "#1A0A00" }}>{page.nome}</div>
        {stat && <div className="text-[11px] text-muted-foreground">{stat.posts} posts</div>}
      </div>
      {isSelected && <div className="h-1.5 w-1.5 rounded-full bg-[#F44708] shrink-0" />}
    </button>
  );
}

// ─── View Toggle ──────────────────────────────────────────────────────────────

function ViewToggle({ view, onView }: { view: ViewMode; onView: (v: ViewMode) => void }) {
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">Visualização</p>
      <div className="flex items-center bg-[#FFF0E8] rounded-xl p-1 gap-1 h-[42px]">
        <button onClick={() => onView("individual")}
          className={cn("flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all whitespace-nowrap",
            view === "individual" ? "bg-[#F44708] text-white" : "text-muted-foreground hover:text-[#F44708]")}>
          <User className="h-3.5 w-3.5" />
          Página
        </button>
        <button onClick={() => onView("geral")}
          className={cn("flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all whitespace-nowrap",
            view === "geral" ? "bg-[#F44708] text-white" : "text-muted-foreground hover:text-[#F44708]")}>
          <LayoutGrid className="h-3.5 w-3.5" />
          Geral
        </button>
      </div>
    </div>
  );
}

// ─── Individual Dashboard ─────────────────────────────────────────────────────

function IndividualDashboard({ s, template, pagePosts, allStats: _allStats }: {
  s: PageMonetStat; template: Template; pagePosts: RawPost[];
  allStats: PageMonetStat[];
}) {
  const score = s.isMonetized ? 100 : readinessScore(s, template);
  const days = estimateDaysNum(s, template);
  const milestones = useMemo(() => computeMilestones(s, template), [s, template]);
  const nextGoal = useMemo(() => computeNextGoal(s, template), [s, template]);

  const viewsChartData = useMemo(() => {
    const byDay = new Map<string, number>();
    for (const p of pagePosts) {
      if (!p.published_at || !p.views) continue;
      const day = p.published_at.slice(0, 10);
      byDay.set(day, (byDay.get(day) ?? 0) + Number(p.views));
    }
    return [...byDay.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, views]) => ({
        dia: date.slice(5).replace("-", "/"),
        views,
      }));
  }, [pagePosts]);

  const estimateText = s.isMonetized ? "Monetizada!"
    : days === 9999 ? "Calculando..."
    : days <= 0 ? "Pronto!"
    : `~${days} dias`;

  const estimateSub = s.isMonetized ? `Monetizou em ${s.daysToMonetize} dias`
    : days === 9999 ? "Poste mais para calcular"
    : "Se continuar nesse ritmo";

  const metrics = [
    { label: "Posts", value: s.posts, target: Math.round(template.posts), pct: Math.min((s.posts / template.posts) * 100, 100), color: "#F44708" },
    { label: "Views", value: s.views, target: Math.round(template.views), pct: Math.min((s.views / template.views) * 100, 100), color: "#0ea5e9" },
    { label: "Dias ativos", value: s.activeDays, target: Math.round(template.activeDays), pct: Math.min((s.activeDays / template.activeDays) * 100, 100), color: "#10b981" },
    { label: "Streak máx.", value: s.longestStreak, target: Math.round(template.longestStreak), pct: Math.min((s.longestStreak / template.longestStreak) * 100, 100), color: "#f59e0b", suffix: "d" },
  ];

  return (
    <div className="space-y-4">
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      {/* ── Card 1: Progresso ── */}
      <div className="bg-white border border-border rounded-2xl p-6 flex flex-col gap-5">
        <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Progresso</p>
        <div className="flex flex-col items-center gap-3">
          <RingProgress pct={score} size={96} dark={false} />
          <div className="text-center">
            <div className="text-2xl font-extrabold" style={{ color: "#1A0A00" }}>{estimateText}</div>
            <p className="text-xs text-muted-foreground mt-1">{estimateSub}</p>
          </div>
        </div>
        <div className="space-y-2.5 border-t border-border pt-4">
          {milestones.map((m, i) => (
            <div key={i} className="flex items-center gap-2.5">
              <MilestoneIconLight status={m.status} />
              <span className={cn("text-xs flex-1 leading-snug",
                m.status === "done" ? "text-foreground font-medium"
                : m.status === "progress" ? "text-foreground"
                : "text-muted-foreground"
              )}>{m.label}</span>
              <span className={cn("text-[10px] font-medium shrink-0",
                m.status === "done" ? "text-green-600"
                : m.status === "progress" ? "text-amber-500"
                : "text-muted-foreground/50"
              )}>{m.detail}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ── Card 2: Métricas ── */}
      <div className="bg-white border border-border rounded-2xl p-6 flex flex-col gap-5">
        <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Métricas</p>
        <div className="flex-1 space-y-5">
          {metrics.map(({ label, value, target, pct, color, suffix }) => (
            <div key={label}>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium" style={{ color: "#1A0A00" }}>{label}</span>
                <span className="text-xs text-muted-foreground">{fmt(value)}{suffix ?? ""} / {fmt(target)}{suffix ?? ""}</span>
              </div>
              <div className="h-2 bg-muted rounded-full overflow-hidden">
                <div className="h-2 rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: color }} />
              </div>
              <p className="text-[11px] font-semibold mt-1.5 text-right" style={{ color }}>{Math.round(pct)}%</p>
            </div>
          ))}
        </div>
      </div>

      {/* ── Card 3: O que falta ── */}
      <div className="bg-white border border-border rounded-2xl p-6 flex flex-col gap-5">
        <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">O que falta</p>
        {s.isMonetized ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-4 py-4">
            <div className="h-16 w-16 rounded-2xl bg-green-50 flex items-center justify-center">
              <CheckCircle2 className="h-8 w-8 text-green-500" />
            </div>
            <div className="text-center">
              <p className="font-bold" style={{ color: "#1A0A00" }}>Página Monetizada!</p>
              {s.daysToMonetize && (
                <p className="text-xs text-muted-foreground mt-1">Alcançou em {s.daysToMonetize} dias</p>
              )}
            </div>
          </div>
        ) : nextGoal ? (
          <div className="flex-1 flex flex-col justify-center gap-5">
            <div>
              <p className="text-4xl font-extrabold" style={{ color: "#1A0A00" }}>
                {fmt(nextGoal.target - nextGoal.current)}
              </p>
              <p className="text-sm text-muted-foreground mt-1.5">{nextGoal.label} ainda faltam</p>
            </div>
            <div className="space-y-2">
              <div className="flex justify-between text-[11px] text-muted-foreground">
                <span>{fmt(nextGoal.current)} atual</span>
                <span>meta: {fmt(nextGoal.target)}</span>
              </div>
              <div className="h-3 bg-muted rounded-full overflow-hidden">
                <div className="h-3 rounded-full bg-[#F44708] transition-all"
                  style={{ width: `${Math.min((nextGoal.current / nextGoal.target) * 100, 100)}%` }} />
              </div>
              <p className="text-xs font-semibold text-[#F44708] text-right">
                {Math.round(Math.min((nextGoal.current / nextGoal.target) * 100, 100))}% completo
              </p>
            </div>
            {days < 9999 && days > 0 && (
              <div className="rounded-xl bg-[#FFF0E8] px-4 py-3 text-center">
                <p className="text-sm font-bold text-[#F44708]">~{days} dias</p>
                <p className="text-[11px] text-[#F44708]/70 mt-0.5">estimativa de monetização</p>
              </div>
            )}
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
            Sem dados suficientes
          </div>
        )}
      </div>
    </div>

    {/* ── Views Chart ── */}
    {viewsChartData.length > 1 && (
      <div className="bg-white border border-border rounded-2xl p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <p className="text-sm font-semibold" style={{ color: "#1A0A00" }}>Views por dia</p>
            <p className="text-xs text-muted-foreground mt-0.5">{s.name}</p>
          </div>
          <div className="text-right">
            <p className="text-lg font-extrabold" style={{ color: "#1A0A00" }}>{fmt(s.views)}</p>
            <p className="text-[11px] text-muted-foreground">total acumulado</p>
          </div>
        </div>
        <ResponsiveContainer width="100%" height={180}>
          <AreaChart data={viewsChartData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="viewsGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#F44708" stopOpacity={0.25} />
                <stop offset="95%" stopColor="#F44708" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#F0E0D0" vertical={false} />
            <XAxis
              dataKey="dia"
              tick={{ fontSize: 10, fill: "#6B6B6B" }}
              axisLine={false}
              tickLine={false}
              interval="preserveStartEnd"
            />
            <YAxis hide />
            <Tooltip
              formatter={(v: any) => [fmt(Number(v)), "views"]}
              labelStyle={{ color: "#1A0A00", fontSize: 11, fontWeight: 600 }}
              contentStyle={{ border: "1px solid #E0E0E0", borderRadius: 10, fontSize: 11 }}
            />
            <Area
              type="monotone"
              dataKey="views"
              stroke="#F44708"
              strokeWidth={2}
              fill="url(#viewsGrad)"
              dot={false}
              connectNulls
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    )}
    </div>
  );
}

function MilestoneIconLight({ status }: { status: "done" | "progress" | "pending" }) {
  if (status === "done") return <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />;
  if (status === "progress") return <div className="h-4 w-4 rounded-full border-2 border-amber-400 bg-amber-50 shrink-0" />;
  return <div className="h-4 w-4 rounded-full border-2 border-border shrink-0" />;
}

// ─── Sidebar Panel ────────────────────────────────────────────────────────────

function SidebarPanel({ s, template, pagePosts, leaderboard, allStats, selectedId }: {
  s: PageMonetStat; template: Template; pagePosts: RawPost[];
  leaderboard: { stat: PageMonetStat; score: number; days: number }[];
  allStats: PageMonetStat[]; selectedId: string | null;
}) {
  const nextGoal = useMemo(() => computeNextGoal(s, template), [s, template]);
  const weeklyFocus = useMemo(() => computeWeeklyFocus(s, template, pagePosts), [s, template, pagePosts]);

  return (
    <div className="space-y-4 xl:sticky xl:top-6">
      {nextGoal && <NextGoalCard goal={nextGoal} />}
      <WeeklyFocusCard weeklyFocus={weeklyFocus} />
      <PagesLeaderboard leaderboard={leaderboard} selectedId={selectedId} />
    </div>
  );
}

// ─── Previsão Card (hero) ─────────────────────────────────────────────────────

function PrevisaoCard({ s, score, days, milestones }: {
  s: PageMonetStat; score: number; days: number; milestones: Milestone[];
}) {
  const estimateText = s.isMonetized ? "Monetizada!"
    : days === 9999 ? "Calculando..."
    : days <= 0 ? "Pronto para monetizar!"
    : `${days} dias`;

  const subText = s.isMonetized ? `Monetizou em ${s.daysToMonetize} dias`
    : days === 9999 ? "Poste mais para calcular"
    : "Se você continuar nesse ritmo";

  const isGood = s.isMonetized || days <= 30;

  return (
    <div className="relative overflow-hidden rounded-2xl p-6 text-white"
      style={{ background: s.isMonetized
        ? "linear-gradient(135deg, #16a34a 0%, #15803d 100%)"
        : "linear-gradient(135deg, #F44708 0%, #E03A07 55%, #C03006 100%)" }}>
      <div className="absolute -top-12 -right-12 h-48 w-48 rounded-full opacity-10"
        style={{ background: "radial-gradient(circle, #fff 0%, transparent 70%)" }} />
      <div className="absolute -bottom-8 right-32 h-32 w-32 rounded-full opacity-8"
        style={{ background: "radial-gradient(circle, #fff 0%, transparent 70%)" }} />

      <div className="relative flex flex-col sm:flex-row sm:items-center gap-6">
        {/* Left: text */}
        <div className="flex-1 space-y-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-white/60">
              {s.isMonetized ? "Status da página" : "Previsão de monetização"}
            </p>
            <p className="text-white/80 text-sm mt-0.5">{s.name}</p>
          </div>
          <div>
            <div className={cn("font-black tracking-tight leading-none", estimateText.length > 15 ? "text-3xl" : "text-4xl")}>
              {estimateText}
            </div>
            <p className="text-sm text-white/70 mt-2">{subText}</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="inline-flex items-center gap-1 text-xs font-bold px-2.5 py-1 rounded-full bg-white/15 text-white/80">
              {score}% concluído
            </span>
            {!s.isMonetized && s.currentStreak > 0 && (
              <span className="inline-flex items-center gap-1 text-xs font-bold px-2.5 py-1 rounded-full bg-white/15 text-white/80">
                🔥 {s.currentStreak} dias seguidos
              </span>
            )}
            {isGood && !s.isMonetized && (
              <span className="inline-flex items-center gap-1 text-xs font-bold px-2.5 py-1 rounded-full bg-white/15 text-white/80">
                🚀 No caminho certo
              </span>
            )}
          </div>
        </div>

        {/* Right: ring + milestones */}
        <div className="shrink-0 flex flex-col items-center gap-4">
          <RingProgress pct={score} size={96} />
          <div className="space-y-1.5 w-52">
            {milestones.map((m, i) => (
              <div key={i} className="flex items-start gap-2">
                <MilestoneIcon status={m.status} />
                <div className="flex-1 min-w-0">
                  <span className="text-xs text-white/80">{m.label}</span>
                </div>
                <span className={cn("text-[11px] shrink-0 font-medium",
                  m.status === "done" ? "text-green-300"
                  : m.status === "progress" ? "text-amber-300"
                  : "text-white/40"
                )}>
                  {m.detail}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function MilestoneIcon({ status }: { status: "done" | "progress" | "pending" }) {
  if (status === "done") return <CheckCircle2 className="h-3.5 w-3.5 text-green-300 shrink-0 mt-0.5" />;
  if (status === "progress") return <div className="h-3.5 w-3.5 rounded-full border-2 border-amber-300 bg-amber-300/20 shrink-0 mt-0.5" />;
  return <div className="h-3.5 w-3.5 rounded-full border-2 border-white/30 shrink-0 mt-0.5" />;
}

// ─── Ring Progress ────────────────────────────────────────────────────────────

function RingProgress({ pct, size = 100, dark = true }: { pct: number; size?: number; dark?: boolean }) {
  const sw = Math.round(size * 0.1);
  const r = (size - sw) / 2;
  const circ = 2 * Math.PI * r;
  const dash = (Math.min(pct, 100) / 100) * circ;
  const color = pct >= 75 ? "#4ade80" : pct >= 50 ? "#fbbf24" : pct >= 25 ? "#fb923c" : "#a78bfa";
  const trackColor = dark ? "rgba(255,255,255,0.15)" : "#e5e7eb";
  const textColor = dark ? "#fff" : "#1A0A00";
  const subColor = dark ? "rgba(255,255,255,0.5)" : "#9ca3af";
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={trackColor} strokeWidth={sw} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={sw}
          strokeDasharray={`${dash} ${circ}`} strokeLinecap="round" />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-0.5">
        <span className="font-extrabold leading-none" style={{ fontSize: size * 0.22, color: textColor }}>{pct}%</span>
        <span className="leading-none" style={{ fontSize: size * 0.09, color: subColor }}>pronto</span>
      </div>
    </div>
  );
}

// ─── Stats Strip ──────────────────────────────────────────────────────────────

function StatsStrip({ s, template }: { s: PageMonetStat; template: Template }) {
  const metrics = [
    { label: "Posts", value: fmt(s.posts), target: fmt(Math.round(template.posts)), pct: Math.min((s.posts / template.posts) * 100, 100), color: "#F44708" },
    { label: "Views", value: fmt(s.views), target: fmt(Math.round(template.views)), pct: Math.min((s.views / template.views) * 100, 100), color: "#0ea5e9" },
    { label: "Dias ativos", value: fmt(s.activeDays), target: fmt(Math.round(template.activeDays)), pct: Math.min((s.activeDays / template.activeDays) * 100, 100), color: "#10b981" },
    { label: "Streak máx.", value: `${s.longestStreak}d`, target: `${Math.round(template.longestStreak)}d`, pct: Math.min((s.longestStreak / template.longestStreak) * 100, 100), color: "#f59e0b" },
  ];
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      {metrics.map(({ label, value, target, pct, color }) => (
        <div key={label} className="bg-white border border-border rounded-xl p-3.5">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] text-muted-foreground font-medium">{label}</span>
            <span className="text-[10px] text-muted-foreground">/ {target}</span>
          </div>
          <div className="text-lg font-bold mb-2" style={{ color: "#1A0A00" }}>{value}</div>
          <div className="h-1.5 bg-muted rounded-full overflow-hidden">
            <div className="h-1.5 rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: color }} />
          </div>
          <div className="flex items-center gap-1 mt-1.5">
            <ArrowUp className="h-3 w-3 shrink-0" style={{ color }} />
            <span className="text-[11px] font-semibold" style={{ color }}>{Math.round(pct)}%</span>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Best Day Card ────────────────────────────────────────────────────────────

function BestDayCard({ dayData }: { dayData: { day: number; name: string; avg: number }[] }) {
  const maxAvg = Math.max(...dayData.map(d => d.avg), 1);
  const bestDay = dayData.reduce((a, b) => a.avg > b.avg ? a : b, dayData[0]);
  const hasData = maxAvg > 1;

  return (
    <div className="bg-white border border-border rounded-2xl p-5 flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <div className="h-8 w-8 rounded-xl bg-[#FFF0E8] flex items-center justify-center shrink-0">
          <BarChart2 className="h-4 w-4 text-[#F44708]" />
        </div>
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wider text-[#F44708]">Melhor Dia</p>
          <p className="text-xs text-muted-foreground">Pico de engajamento</p>
        </div>
      </div>

      {hasData ? (
        <>
          <div>
            <p className="text-2xl font-extrabold" style={{ color: "#1A0A00" }}>{bestDay.name}</p>
            <p className="text-xs text-muted-foreground mt-0.5">Poste nesse dia para alcançar mais pessoas</p>
          </div>
          <div className="flex items-end gap-1 h-14">
            {dayData.map(d => {
              const h = maxAvg > 0 ? Math.max((d.avg / maxAvg) * 100, 4) : 4;
              const isB = d.day === bestDay.day;
              return (
                <div key={d.day} className="flex-1 flex flex-col items-center gap-1">
                  <div className="w-full rounded-sm" style={{
                    height: `${h}%`,
                    backgroundColor: isB ? "#F44708" : "#FFF0E8",
                    minHeight: "4px",
                  }} />
                  <span className="text-[9px] text-muted-foreground">{d.name}</span>
                </div>
              );
            })}
          </div>
        </>
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center gap-2 py-4 text-muted-foreground">
          <BarChart2 className="h-8 w-8 opacity-20" />
          <p className="text-xs text-center">Poste mais para descobrir o melhor dia</p>
        </div>
      )}
    </div>
  );
}

// ─── Best Format Card ─────────────────────────────────────────────────────────

function BestFormatCard({ fmtData }: { fmtData: { format: string; avg: number; count: number }[] }) {
  const best = fmtData[0];
  const overall = fmtData.length > 0 ? fmtData.reduce((s, f) => s + f.avg * f.count, 0) / fmtData.reduce((s, f) => s + f.count, 0) : 0;
  const improvement = best && overall > 0 ? Math.round(((best.avg - overall) / overall) * 100) : 0;
  const formatIcons: Record<string, React.ComponentType<{ className?: string }>> = {
    "Vídeos": Zap, "Fotos": Eye, "Links": TrendingUp, "Textos": FileText,
  };
  const Icon = best ? (formatIcons[best.format] ?? BarChart2) : BarChart2;

  return (
    <div className="bg-white border border-border rounded-2xl p-5 flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <div className="h-8 w-8 rounded-xl bg-[#FFF0E8] flex items-center justify-center shrink-0">
          <Zap className="h-4 w-4 text-[#F44708]" />
        </div>
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wider text-[#F44708]">Melhor Formato</p>
          <p className="text-xs text-muted-foreground">Por média de views</p>
        </div>
      </div>

      {best ? (
        <>
          <div>
            <p className="text-2xl font-extrabold" style={{ color: "#1A0A00" }}>{best.format}</p>
            {improvement > 0 ? (
              <p className="text-xs text-muted-foreground mt-0.5">
                {improvement}% acima da média — <strong>{best.count} publicações</strong>
              </p>
            ) : (
              <p className="text-xs text-muted-foreground mt-0.5">{best.count} publicações</p>
            )}
          </div>
          <div className="space-y-2">
            {fmtData.slice(0, 4).map(f => {
              const pct = best.avg > 0 ? Math.round((f.avg / best.avg) * 100) : 0;
              const FIcon = formatIcons[f.format] ?? BarChart2;
              return (
                <div key={f.format} className="flex items-center gap-2">
                  <FIcon className="h-3 w-3 text-muted-foreground shrink-0" />
                  <span className="text-[11px] text-muted-foreground w-14 shrink-0">{f.format}</span>
                  <div className="flex-1 h-1.5 bg-[#FFD9C0] rounded-full">
                    <div className="h-1.5 rounded-full bg-[#F44708]" style={{ width: `${pct}%` }} />
                  </div>
                  <span className="text-[11px] font-medium w-10 text-right shrink-0" style={{ color: "#1A0A00" }}>{fmt(f.avg)}</span>
                </div>
              );
            })}
          </div>
        </>
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center gap-2 py-4 text-muted-foreground">
          <Icon className="h-8 w-8 opacity-20" />
          <p className="text-xs text-center">Sem dados de formato ainda</p>
        </div>
      )}
    </div>
  );
}

// ─── Motivational Banner ──────────────────────────────────────────────────────

function MotivationalBanner({ percentile }: { percentile: number }) {
  return (
    <div className="bg-gradient-to-r from-[#F44708]/8 via-[#FAA613]/5 to-[#F44708]/8 border border-border rounded-2xl p-5 flex items-center gap-4">
      <div className="h-12 w-12 rounded-2xl flex items-center justify-center shrink-0"
        style={{ background: "linear-gradient(135deg, #F44708, #FAA613)" }}>
        <Rocket className="h-6 w-6 text-white" />
      </div>
      <div className="flex-1">
        <p className="text-sm font-bold" style={{ color: "#1A0A00" }}>
          Você está acima de {percentile}% das suas páginas!
        </p>
        <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
          Continue postando com consistência — a monetização vem com tempo e ritmo.
        </p>
      </div>
      <div className="shrink-0 text-right">
        <div className="text-2xl font-black" style={{ color: "#F44708" }}>{percentile}%</div>
        <div className="text-[10px] text-muted-foreground">percentil</div>
      </div>
    </div>
  );
}

// ─── Next Goal Card ───────────────────────────────────────────────────────────

function NextGoalCard({ goal }: { goal: { label: string; current: number; target: number; unit: string } }) {
  const pct = Math.min((goal.current / goal.target) * 100, 100);
  const remaining = goal.target - goal.current;

  return (
    <div className="bg-white border border-border rounded-2xl p-4">
      <div className="flex items-center gap-2 mb-3">
        <div className="h-7 w-7 rounded-lg bg-orange-50 flex items-center justify-center shrink-0">
          <Target className="h-3.5 w-3.5 text-orange-500" />
        </div>
        <p className="text-[11px] font-bold uppercase tracking-wider text-orange-500">Próxima Meta</p>
      </div>
      <p className="text-xl font-extrabold" style={{ color: "#1A0A00" }}>
        Faltam {fmt(remaining)} {goal.unit === "views" ? "views" : "posts"}
      </p>
      <p className="text-[11px] text-muted-foreground mt-0.5 mb-3">
        para atingir a meta de {goal.label}.
      </p>
      <div className="space-y-1.5">
        <div className="flex justify-between text-[11px] text-muted-foreground">
          <span>{fmt(goal.current)} / {fmt(goal.target)}</span>
          <span>{Math.round(pct)}%</span>
        </div>
        <div className="h-2 bg-muted rounded-full overflow-hidden">
          <div className="h-2 rounded-full bg-orange-400 transition-all" style={{ width: `${pct}%` }} />
        </div>
      </div>
    </div>
  );
}

// ─── Weekly Focus Card ────────────────────────────────────────────────────────

function WeeklyFocusCard({ weeklyFocus }: { weeklyFocus: { action: string; done: boolean }[] }) {
  const done = weeklyFocus.filter(f => f.done).length;
  const focusPct = Math.round((done / weeklyFocus.length) * 100);

  return (
    <div className="bg-white border border-border rounded-2xl p-4">
      <div className="flex items-center justify-between mb-3">
        <p className="text-[11px] font-bold uppercase tracking-wider text-[#F44708]">Foco da Semana</p>
        <div className="relative shrink-0" style={{ width: 40, height: 40 }}>
          <svg width="40" height="40" style={{ transform: "rotate(-90deg)" }}>
            <circle cx="20" cy="20" r="16" fill="none" stroke="#FFF0E8" strokeWidth="5" />
            <circle cx="20" cy="20" r="16" fill="none" stroke="#F44708" strokeWidth="5"
              strokeDasharray={`${(focusPct / 100) * 2 * Math.PI * 16} ${2 * Math.PI * 16}`}
              strokeLinecap="round" />
          </svg>
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-[10px] font-bold" style={{ color: "#F44708" }}>{focusPct}%</span>
          </div>
        </div>
      </div>
      <div className="space-y-2.5">
        {weeklyFocus.map((f, i) => (
          <div key={i} className="flex items-center gap-2.5">
            {f.done
              ? <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
              : <div className="h-4 w-4 rounded-full border-2 border-border shrink-0" />
            }
            <span className={cn("text-xs leading-snug", f.done ? "text-foreground" : "text-muted-foreground")}>{f.action}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Pages Leaderboard ────────────────────────────────────────────────────────

function PagesLeaderboard({ leaderboard, selectedId }: {
  leaderboard: { stat: PageMonetStat; score: number; days: number }[];
  selectedId: string | null;
}) {
  const visible = leaderboard.slice(0, 6);

  return (
    <div className="bg-white border border-border rounded-2xl p-4">
      <div className="flex items-center justify-between mb-3">
        <p className="text-[11px] font-bold uppercase tracking-wider text-[#F44708]">Ranking de páginas</p>
        <span className="text-[10px] text-muted-foreground">{leaderboard.length} páginas</span>
      </div>
      <div className="space-y-2.5">
        {visible.map((item, i) => {
          const isSelected = item.stat.id === selectedId;
          const daysText = item.stat.isMonetized ? "Monetizada ✅"
            : item.days === 9999 ? "Calculando..."
            : item.days <= 0 ? "Pronto!"
            : `~${item.days} dias`;
          const barColor = item.score >= 75 ? "#16a34a" : item.score >= 50 ? "#f59e0b" : "#F44708";
          return (
            <div key={item.stat.id}
              className={cn("flex items-center gap-2.5 p-2 rounded-xl transition-colors", isSelected && "bg-[#FFF0E8]")}>
              <span className="text-xs font-bold text-muted-foreground w-4 shrink-0 text-center">{i + 1}</span>
              <PageAvatar name={item.stat.name} size={26} />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold truncate" style={{ color: "#1A0A00" }}>{item.stat.name}</p>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <div className="flex-1 h-1 bg-[#FFD9C0] rounded-full overflow-hidden">
                    <div className="h-1 rounded-full" style={{ width: `${item.score}%`, backgroundColor: barColor }} />
                  </div>
                  <span className={cn("text-[10px]", item.stat.isMonetized ? "text-green-600" : "text-muted-foreground")}>{daysText}</span>
                </div>
              </div>
              <span className="text-[11px] font-bold shrink-0" style={{ color: barColor }}>{item.score}%</span>
            </div>
          );
        })}
      </div>
      {leaderboard.length > 6 && (
        <button className="w-full mt-3 text-xs text-[#F44708] font-medium border border-border rounded-xl py-2 hover:bg-muted transition-colors">
          Ver todas as {leaderboard.length} páginas
        </button>
      )}
    </div>
  );
}

// ─── Overview Grid ────────────────────────────────────────────────────────────

function OverviewGrid({ monetized, warmingSorted, template }: {
  monetized: PageMonetStat[]; warmingSorted: PageMonetStat[]; template: Template | null;
}) {
  const all = [...monetized, ...warmingSorted];
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold" style={{ color: "#1A0A00" }}>
          Todas as páginas <span className="text-muted-foreground font-normal">({all.length})</span>
        </p>
        <span className="text-xs text-muted-foreground">Ordenadas por progresso</span>
      </div>
      {all.map(s => {
        const score = s.isMonetized ? 100 : (template ? readinessScore(s, template) : 0);
        const days = template ? estimateDaysNum(s, template) : 9999;

        if (s.isMonetized) {
          return (
            <div key={s.id} className="bg-gradient-to-r from-green-50 to-emerald-50 border border-green-200 rounded-2xl p-4 flex items-center gap-4">
              <div className="h-10 w-10 rounded-xl bg-green-100 flex items-center justify-center shrink-0">
                <CheckCircle2 className="h-5 w-5 text-green-600" />
              </div>
              <div className="flex-1">
                <div className="font-semibold" style={{ color: "#1A0A00" }}>{s.name}</div>
                <div className="text-sm font-semibold text-green-700 mt-0.5">
                  Monetizada{s.daysToMonetize ? ` em ${s.daysToMonetize} dias` : ""} ✨
                </div>
              </div>
              <div className="shrink-0">
                <OverviewRing pct={100} />
              </div>
            </div>
          );
        }

        const viewsPct = template ? Math.min((s.views / template.views) * 100, 100) : 0;
        const postsPct = template ? Math.min((s.posts / template.posts) * 100, 100) : 0;
        const daysText = days === 9999 ? "Calculando..." : days <= 0 ? "Pronto!" : `~${days} dias para monetizar`;
        const dotColor = !s.isActive ? "#f43f5e" : days <= 30 ? "#f59e0b" : days <= 90 ? "#a855f7" : "#94a3b8";

        return (
          <div key={s.id} className="bg-white border border-border rounded-2xl p-4">
            <div className="flex items-start gap-4">
              <div className="flex-1 min-w-0 space-y-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <div className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: dotColor }} />
                  <span className="font-semibold text-sm" style={{ color: "#1A0A00" }}>{s.name}</span>
                  {!s.isActive && s.daysSinceLastPost !== null && (
                    <span className="text-xs text-red-400 flex items-center gap-0.5">
                      <AlertCircle className="h-3 w-3" />{s.daysSinceLastPost}d sem postar
                    </span>
                  )}
                  {s.currentStreak > 0 && (
                    <span className="text-xs text-amber-600 flex items-center gap-0.5">
                      <Flame className="h-3 w-3" />{s.currentStreak}d seguidos
                    </span>
                  )}
                </div>
                <div className="inline-flex items-center px-3 py-1.5 rounded-full text-xs font-semibold"
                  style={{ backgroundColor: days <= 30 ? "#fef9c3" : "#FFF0E8", color: days <= 30 ? "#a16207" : "#F44708" }}>
                  {daysText}
                </div>
                <div className="space-y-2">
                  {[
                    { label: "Views", pct: viewsPct, cur: s.views, tgt: template?.views ?? 0 },
                    { label: "Posts", pct: postsPct, cur: s.posts, tgt: Math.round(template?.posts ?? 0) },
                  ].map(b => (
                    <div key={b.label} className="flex items-center gap-2">
                      <span className="text-[11px] text-muted-foreground w-10 shrink-0">{b.label}</span>
                      <div className="flex-1 h-1.5 bg-[#FFD9C0] rounded-full overflow-hidden">
                        <div className="h-1.5 rounded-full" style={{
                          width: `${b.pct}%`,
                          backgroundColor: b.pct >= 75 ? "#16a34a" : b.pct >= 40 ? "#f59e0b" : "#F44708",
                        }} />
                      </div>
                      <span className="text-[11px] font-medium w-10 text-right shrink-0" style={{ color: "#1A0A00" }}>{fmt(b.cur)}</span>
                      <span className="text-[11px] text-muted-foreground shrink-0">/</span>
                      <span className="text-[11px] text-muted-foreground w-10 shrink-0">{fmt(b.tgt)}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="shrink-0 self-center">
                <OverviewRing pct={score} />
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function OverviewRing({ pct }: { pct: number }) {
  const size = 64, sw = 6, r = (size - sw) / 2;
  const circ = 2 * Math.PI * r;
  const dash = (Math.min(pct, 100) / 100) * circ;
  const color = pct >= 75 ? "#16a34a" : pct >= 50 ? "#f59e0b" : "#F44708";
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#FFF0E8" strokeWidth={sw} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={sw}
          strokeDasharray={`${dash} ${circ}`} strokeLinecap="round" />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-xs font-bold" style={{ color }}>{pct}%</span>
      </div>
    </div>
  );
}

// ─── Page Avatar ──────────────────────────────────────────────────────────────

function PageAvatar({ size = 32 }: { name?: string; size?: number }) {
  return (
    <img
      src={fbLogo}
      alt="Facebook"
      className="rounded-full shrink-0 object-contain"
      style={{ width: size, height: size }}
    />
  );
}
