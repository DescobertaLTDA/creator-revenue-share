import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, useMemo, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  CheckCircle2, Flame, AlertCircle, Activity, Rocket, Target,
  ChevronDown, Search, BarChart2, Zap, Eye, FileText, TrendingUp,
  LayoutGrid, User,
} from "lucide-react";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/admin/monetizacao")({
  head: () => ({ meta: [{ title: "Monetização — Gestão de Páginas" }] }),
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

// ─── Dashboard Helpers ────────────────────────────────────────────────────────

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

  // Leaderboard: monetized first (day=0), then by estimated days asc
  const leaderboard = useMemo(() => {
    const allSorted = [...monetized, ...warmingSorted];
    return allSorted.map(s => ({
      stat: s,
      score: s.isMonetized ? 100 : (template ? readinessScore(s, template) : 0),
      days: template ? estimateDaysNum(s, template) : 9999,
    }));
  }, [monetized, warmingSorted, template]);

  // Auto-select first warming page
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
        <h1 className="text-2xl font-bold text-[#1a0533]">Monetização</h1>
        <p className="text-sm text-muted-foreground">Transforme consistência em receita.</p>
      </div>

      {/* Top bar: page selector + view toggle */}
      <TopBar
        pages={pages} stats={stats} template={template}
        selectedId={selectedId} onSelect={setSelectedId}
        view={view} onView={setView}
      />

      {/* Content */}
      {view === "individual" && selectedStat && template ? (
        <IndividualDashboard
          s={selectedStat} template={template} pagePosts={pagePosts}
          leaderboard={leaderboard} allStats={stats} selectedId={selectedId}
        />
      ) : (
        <OverviewGrid monetized={monetized} warmingSorted={warmingSorted} template={template} />
      )}
    </div>
  );
}

// ─── Top Bar ──────────────────────────────────────────────────────────────────

function TopBar({
  pages, stats, template, selectedId, onSelect, view, onView,
}: {
  pages: PageRow[]; stats: PageMonetStat[]; template: Template | null;
  selectedId: string | null; onSelect: (id: string) => void;
  view: ViewMode; onView: (v: ViewMode) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const selectedStat = stats.find(s => s.id === selectedId);
  const today = new Date().toISOString().slice(0, 10);
  const ageDays = selectedStat?.firstPostDate ? daysBetween(selectedStat.firstPostDate, today) : null;

  useEffect(() => {
    if (!open) return;
    const handle = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [open]);

  const monetizedIds = new Set(stats.filter(s => s.isMonetized).map(s => s.id));
  const filtered = pages.filter(p => p.nome.toLowerCase().includes(query.toLowerCase()));
  const mon = filtered.filter(p => monetizedIds.has(p.id));
  const notMon = filtered.filter(p => !monetizedIds.has(p.id));

  return (
    <div className="flex items-center gap-4 flex-wrap">
      {/* Page dropdown */}
      <div className="relative" ref={ref}>
        <button
          onClick={() => setOpen(o => !o)}
          className="flex items-center gap-2.5 bg-white border border-[#d8d0eb] rounded-xl px-3 py-2.5 text-sm font-medium text-[#1a0533] hover:border-[#6200b3] transition-colors min-w-48 shadow-sm"
        >
          {selectedStat && <PageAvatar name={selectedStat.name} size={24} />}
          <span className="flex-1 text-left truncate">{selectedStat?.name ?? "Selecionar página"}</span>
          {selectedStat && monetizedIds.has(selectedStat.id) && (
            <span className="h-2 w-2 rounded-full bg-green-500 shrink-0" />
          )}
          <ChevronDown className={cn("h-4 w-4 text-muted-foreground shrink-0 transition-transform", open && "rotate-180")} />
        </button>

        {open && (
          <div className="absolute top-full mt-2 left-0 w-72 bg-white border border-[#e8e0f5] rounded-2xl shadow-xl z-50 overflow-hidden">
            <div className="p-2 border-b border-[#f3e8ff]">
              <div className="flex items-center gap-2 bg-[#faf5ff] rounded-lg px-3 py-1.5">
                <Search className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <input
                  autoFocus
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  placeholder="Buscar página..."
                  className="flex-1 bg-transparent text-sm outline-none text-[#1a0533] placeholder:text-muted-foreground"
                />
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

      {/* Page info */}
      {selectedStat && (
        <div className="flex items-center gap-4 text-sm text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <FileText className="h-3.5 w-3.5" />
            {selectedStat.posts} posts
          </span>
          {ageDays !== null && (
            <span className="flex items-center gap-1.5">
              <Activity className="h-3.5 w-3.5" />
              Ativa há {ageDays} dias
            </span>
          )}
        </div>
      )}

      {/* Spacer */}
      <div className="flex-1" />

      {/* View toggle */}
      <div className="flex items-center bg-[#f3e8ff] rounded-xl p-1 gap-1">
        <button
          onClick={() => onView("individual")}
          className={cn("flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all", view === "individual" ? "bg-[#6200b3] text-white shadow-sm" : "text-[#7c6f8e] hover:text-[#6200b3]")}
        >
          <User className="h-3.5 w-3.5" />
          Página individual
        </button>
        <button
          onClick={() => onView("geral")}
          className={cn("flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all", view === "geral" ? "bg-[#6200b3] text-white shadow-sm" : "text-[#7c6f8e] hover:text-[#6200b3]")}
        >
          <LayoutGrid className="h-3.5 w-3.5" />
          Visão geral
        </button>
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
    <button
      onClick={() => onSelect(page.id)}
      className={cn("w-full flex items-center gap-2.5 px-3 py-2 text-sm hover:bg-[#faf5ff] transition-colors", isSelected && "bg-[#f3e8ff]")}
    >
      <PageAvatar name={page.nome} size={28} />
      <div className="flex-1 text-left min-w-0">
        <div className="font-medium text-[#1a0533] truncate">{page.nome}</div>
        {stat && <div className="text-[11px] text-muted-foreground">{stat.posts} posts</div>}
      </div>
      {isSelected && <CheckCircle2 className="h-4 w-4 text-[#6200b3] shrink-0" />}
    </button>
  );
}

// ─── Individual Dashboard ─────────────────────────────────────────────────────

function IndividualDashboard({ s, template, pagePosts, leaderboard, allStats, selectedId }: {
  s: PageMonetStat; template: Template; pagePosts: RawPost[];
  leaderboard: { stat: PageMonetStat; score: number; days: number }[];
  allStats: PageMonetStat[]; selectedId: string | null;
}) {
  const score = s.isMonetized ? 100 : readinessScore(s, template);
  const days = estimateDaysNum(s, template);
  const milestones = useMemo(() => computeMilestones(s, template), [s, template]);
  const dayData = useMemo(() => computeDayOfWeek(pagePosts), [pagePosts]);
  const fmtData = useMemo(() => computeFormats(pagePosts), [pagePosts]);
  const nextGoal = useMemo(() => computeNextGoal(s, template), [s, template]);
  const weeklyFocus = useMemo(() => computeWeeklyFocus(s, template, pagePosts), [s, template, pagePosts]);
  const percentile = useMemo(() => computePercentile(s, allStats, template), [s, allStats, template]);

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        Mostrando dados apenas da página selecionada.
      </p>

      {/* Main grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Left 2 cols */}
        <div className="lg:col-span-2 space-y-4">
          <PrevisaoCard s={s} score={score} days={days} milestones={milestones} />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <BestDayCard dayData={dayData} />
            <BestFormatCard fmtData={fmtData} />
          </div>
        </div>

        {/* Right col */}
        <div className="space-y-4">
          {nextGoal && <NextGoalCard goal={nextGoal} />}
          <PagesLeaderboard leaderboard={leaderboard} selectedId={selectedId} />
        </div>
      </div>

      {/* Bottom motivational card */}
      <MotivationalCard percentile={percentile} weeklyFocus={weeklyFocus} />
    </div>
  );
}

// ─── Previsão Card ────────────────────────────────────────────────────────────

function PrevisaoCard({ s, score, days, milestones }: {
  s: PageMonetStat; score: number; days: number; milestones: Milestone[];
}) {
  const estimateText = s.isMonetized ? "Monetizada! 🎉"
    : days === 9999 ? "Calculando..."
    : days <= 0 ? "Pronto para monetizar! 🚀"
    : `${days} dias 🚀`;

  const subText = s.isMonetized ? `Monetizou em ${s.daysToMonetize} dias`
    : days === 9999 ? "Poste mais para calcular"
    : "Se você continuar nesse ritmo!";

  return (
    <div className="bg-white border border-[#e8e0f5] rounded-2xl shadow-sm p-5">
      <p className="text-[11px] font-bold uppercase tracking-wider text-[#6200b3] mb-4">
        Previsão de Monetização
      </p>
      <div className="flex items-start gap-6">
        {/* Left: text */}
        <div className="flex-1 min-w-0 flex flex-col justify-between gap-4">
          <div>
            <p className="text-sm text-[#7c6f8e] font-medium">
              {s.isMonetized ? `${s.name} está` : `${s.name} monetiza em`}
            </p>
            <p className={cn("font-extrabold mt-1 leading-tight",
              estimateText.length > 12 ? "text-3xl" : "text-4xl",
              s.isMonetized ? "text-green-600" : days <= 30 ? "text-amber-600" : "text-[#6200b3]"
            )}>
              {estimateText}
            </p>
            <p className="text-xs text-muted-foreground mt-2">{subText}</p>
          </div>
          {/* Ring on mobile */}
          <div className="sm:hidden flex justify-center mt-2">
            <RingProgress pct={score} size={90} />
          </div>
        </div>

        {/* Right: ring + checklist */}
        <div className="shrink-0 flex flex-col items-center gap-4 hidden sm:flex">
          <RingProgress pct={score} size={100} />
          <div className="space-y-1.5 w-52">
            {milestones.map((m, i) => (
              <div key={i} className="flex items-start gap-2">
                <MilestoneIcon status={m.status} />
                <div className="flex-1 min-w-0">
                  <span className={cn("text-xs", m.status === "done" ? "text-[#1a0533]" : "text-muted-foreground")}>
                    {m.label}
                  </span>
                </div>
                <span className={cn("text-[11px] shrink-0",
                  m.status === "done" ? "text-green-600 font-medium"
                  : m.status === "progress" ? "text-amber-600 font-medium"
                  : "text-muted-foreground"
                )}>
                  {m.detail}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Milestones on mobile */}
      <div className="sm:hidden mt-4 space-y-1.5 border-t border-[#f3e8ff] pt-4">
        {milestones.map((m, i) => (
          <div key={i} className="flex items-center gap-2">
            <MilestoneIcon status={m.status} />
            <span className="flex-1 text-xs text-muted-foreground truncate">{m.label}</span>
            <span className={cn("text-[11px] shrink-0",
              m.status === "done" ? "text-green-600 font-medium"
              : m.status === "progress" ? "text-amber-600 font-medium"
              : "text-muted-foreground"
            )}>{m.detail}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function MilestoneIcon({ status }: { status: "done" | "progress" | "pending" }) {
  if (status === "done") return <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0 mt-0.5" />;
  if (status === "progress") return <div className="h-3.5 w-3.5 rounded-full border-2 border-amber-500 bg-amber-100 shrink-0 mt-0.5" />;
  return <div className="h-3.5 w-3.5 rounded-full border-2 border-[#d8d0eb] bg-[#f3e8ff] shrink-0 mt-0.5" />;
}

// ─── Ring Progress ────────────────────────────────────────────────────────────

function RingProgress({ pct, size = 100 }: { pct: number; size?: number }) {
  const sw = Math.round(size * 0.1);
  const r = (size - sw) / 2;
  const circ = 2 * Math.PI * r;
  const dash = (Math.min(pct, 100) / 100) * circ;
  const color = pct >= 75 ? "#16a34a" : pct >= 50 ? "#f59e0b" : pct >= 25 ? "#f97316" : "#7c3aed";
  const cx = size / 2, cy = size / 2;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="#f3e8ff" strokeWidth={sw} />
        <circle cx={cx} cy={cy} r={r} fill="none" stroke={color} strokeWidth={sw}
          strokeDasharray={`${dash} ${circ}`} strokeLinecap="round" />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-0.5">
        <span className="font-extrabold leading-none" style={{ color, fontSize: size * 0.2 }}>{pct}%</span>
        <span className="text-muted-foreground leading-none" style={{ fontSize: size * 0.09 }}>concluído</span>
      </div>
    </div>
  );
}

// ─── Best Day Card ────────────────────────────────────────────────────────────

function BestDayCard({ dayData }: { dayData: { day: number; name: string; avg: number }[] }) {
  const maxAvg = Math.max(...dayData.map(d => d.avg), 1);
  const bestDay = dayData.reduce((a, b) => a.avg > b.avg ? a : b, dayData[0]);
  const hasData = maxAvg > 1;

  return (
    <div className="bg-white border border-[#e8e0f5] rounded-2xl shadow-sm p-5 flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <div className="h-8 w-8 rounded-xl bg-[#f3e8ff] flex items-center justify-center shrink-0">
          <BarChart2 className="h-4 w-4 text-[#6200b3]" />
        </div>
        <p className="text-[11px] font-bold uppercase tracking-wider text-[#6200b3]">Melhor Dia</p>
      </div>

      {hasData ? (
        <>
          <div>
            <p className="text-2xl font-extrabold text-[#1a0533]">{bestDay.name}</p>
            <p className="text-xs text-muted-foreground mt-0.5">Seu pico de engajamento</p>
            <p className="text-xs text-muted-foreground">Poste nesse dia para alcançar mais pessoas!</p>
          </div>
          <div className="flex items-end gap-1 h-14">
            {dayData.map(d => {
              const h = maxAvg > 0 ? Math.max((d.avg / maxAvg) * 100, 4) : 4;
              const isB = d.day === bestDay.day;
              return (
                <div key={d.day} className="flex-1 flex flex-col items-center gap-1">
                  <div className="w-full rounded-sm" style={{
                    height: `${h}%`,
                    backgroundColor: isB ? "#6200b3" : "#e8e0f5",
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
    <div className="bg-white border border-[#e8e0f5] rounded-2xl shadow-sm p-5 flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <div className="h-8 w-8 rounded-xl bg-[#f3e8ff] flex items-center justify-center shrink-0">
          <Zap className="h-4 w-4 text-[#6200b3]" />
        </div>
        <p className="text-[11px] font-bold uppercase tracking-wider text-[#6200b3]">Melhor Formato</p>
      </div>

      {best ? (
        <>
          <div>
            <p className="text-2xl font-extrabold text-[#1a0533]">{best.format}</p>
            {improvement > 0 ? (
              <p className="text-xs text-muted-foreground mt-0.5">
                {improvement}% acima da média — <strong>{best.count} publicações</strong>
              </p>
            ) : (
              <p className="text-xs text-muted-foreground mt-0.5">{best.count} publicações</p>
            )}
            <p className="text-xs text-muted-foreground mt-1">Média de {fmt(best.avg)} views por post</p>
          </div>
          <div className="space-y-2">
            {fmtData.slice(0, 4).map(f => {
              const pct = best.avg > 0 ? Math.round((f.avg / best.avg) * 100) : 0;
              const FIcon = formatIcons[f.format] ?? BarChart2;
              return (
                <div key={f.format} className="flex items-center gap-2">
                  <FIcon className="h-3 w-3 text-muted-foreground shrink-0" />
                  <span className="text-[11px] text-muted-foreground w-14 shrink-0">{f.format}</span>
                  <div className="flex-1 h-1.5 bg-[#f3e8ff] rounded-full">
                    <div className="h-1.5 rounded-full bg-[#6200b3]" style={{ width: `${pct}%` }} />
                  </div>
                  <span className="text-[11px] font-medium text-[#1a0533] w-10 text-right shrink-0">{fmt(f.avg)}</span>
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

// ─── Next Goal Card ───────────────────────────────────────────────────────────

function NextGoalCard({ goal }: { goal: { label: string; current: number; target: number; unit: string } }) {
  const pct = Math.min((goal.current / goal.target) * 100, 100);
  const remaining = goal.target - goal.current;

  return (
    <div className="bg-white border border-[#e8e0f5] rounded-2xl shadow-sm p-5">
      <div className="flex items-center gap-2 mb-4">
        <div className="h-8 w-8 rounded-xl bg-orange-50 flex items-center justify-center shrink-0">
          <Target className="h-4 w-4 text-orange-500" />
        </div>
        <p className="text-[11px] font-bold uppercase tracking-wider text-orange-500">Próxima Meta</p>
      </div>
      <p className="text-2xl font-extrabold text-[#1a0533]">
        Faltam {fmt(remaining)} {goal.unit === "views" ? "views" : "posts"}
      </p>
      <p className="text-xs text-muted-foreground mt-1 mb-4">
        para atingir a meta de {goal.label}.
      </p>
      <div className="space-y-2">
        <div className="flex justify-between text-[11px] text-muted-foreground">
          <span>{fmt(goal.current)} / {fmt(goal.target)}</span>
          <span>{Math.round(pct)}%</span>
        </div>
        <div className="h-2 bg-[#f3e8ff] rounded-full overflow-hidden">
          <div className="h-2 rounded-full bg-orange-400" style={{ width: `${pct}%` }} />
        </div>
      </div>
    </div>
  );
}

// ─── Pages Leaderboard ────────────────────────────────────────────────────────

function PagesLeaderboard({ leaderboard, selectedId }: {
  leaderboard: { stat: PageMonetStat; score: number; days: number }[];
  selectedId: string | null;
}) {
  const visible = leaderboard.slice(0, 5);

  return (
    <div className="bg-white border border-[#e8e0f5] rounded-2xl shadow-sm p-5 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-[#1a0533]">Suas páginas</p>
        {leaderboard.length > 5 && (
          <span className="text-xs text-[#6200b3] font-medium">Ver todas</span>
        )}
      </div>
      <div className="space-y-3">
        {visible.map((item, i) => {
          const isSelected = item.stat.id === selectedId;
          const daysText = item.stat.isMonetized ? "Monetizada ✅"
            : item.days === 9999 ? "Calculando..."
            : item.days <= 0 ? "Pronto!"
            : `Monetiza em ${item.days} dias`;
          return (
            <div key={item.stat.id} className={cn("flex items-center gap-2.5 p-2 rounded-xl transition-colors", isSelected && "bg-[#f3e8ff]")}>
              <span className="text-xs font-bold text-muted-foreground w-4 shrink-0">{i + 1}</span>
              <PageAvatar name={item.stat.name} size={28} />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-[#1a0533] truncate">{item.stat.name}</p>
                <p className={cn("text-[11px]", item.stat.isMonetized ? "text-green-600" : "text-muted-foreground")}>{daysText}</p>
                <div className="mt-1 h-1 bg-[#f3e8ff] rounded-full overflow-hidden">
                  <div className="h-1 rounded-full" style={{
                    width: `${item.score}%`,
                    backgroundColor: item.score >= 75 ? "#16a34a" : item.score >= 50 ? "#f59e0b" : "#6200b3",
                  }} />
                </div>
              </div>
              <span className="text-[11px] font-bold text-[#6200b3] shrink-0">{item.score}%</span>
            </div>
          );
        })}
      </div>
      {leaderboard.length > 5 && (
        <button className="w-full text-xs text-[#6200b3] font-medium border border-[#d8d0eb] rounded-xl py-2 hover:bg-[#faf5ff] transition-colors">
          Ver todas as {leaderboard.length} páginas
        </button>
      )}
    </div>
  );
}

// ─── Motivational Card ────────────────────────────────────────────────────────

function MotivationalCard({ percentile, weeklyFocus }: {
  percentile: number; weeklyFocus: { action: string; done: boolean }[];
}) {
  const done = weeklyFocus.filter(f => f.done).length;
  const focusPct = Math.round((done / weeklyFocus.length) * 100);

  return (
    <div className="bg-gradient-to-r from-[#6200b3]/8 via-[#8b00ff]/5 to-[#6200b3]/8 border border-[#d8d0eb] rounded-2xl shadow-sm p-5">
      <div className="flex flex-col sm:flex-row items-start gap-6">
        {/* Left: motivational */}
        <div className="flex items-start gap-4 flex-1">
          <div className="h-14 w-14 rounded-2xl bg-gradient-to-br from-[#6200b3] to-[#9b30ff] flex items-center justify-center shrink-0">
            <Rocket className="h-7 w-7 text-white" />
          </div>
          <div>
            <p className="text-base font-bold text-[#1a0533]">
              Você está acima de {percentile}% das suas páginas!
            </p>
            <p className="text-sm text-muted-foreground mt-1 leading-relaxed">
              Seu desempenho está ótimo. Continue postando com consistência — a monetização vem com tempo e ritmo.
            </p>
          </div>
        </div>

        {/* Right: weekly focus */}
        <div className="shrink-0 flex items-center gap-5 bg-white/60 rounded-xl p-4 border border-[#e8e0f5]">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-[#6200b3] mb-3">Foco da Semana</p>
            <div className="space-y-2">
              {weeklyFocus.map((f, i) => (
                <div key={i} className="flex items-center gap-2">
                  {f.done
                    ? <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0" />
                    : <div className="h-3.5 w-3.5 rounded-full border-2 border-[#d8d0eb] shrink-0" />
                  }
                  <span className={cn("text-xs", f.done ? "text-[#1a0533]" : "text-muted-foreground")}>{f.action}</span>
                </div>
              ))}
            </div>
          </div>
          {/* Focus donut */}
          <div className="relative shrink-0" style={{ width: 64, height: 64 }}>
            <svg width="64" height="64" style={{ transform: "rotate(-90deg)" }}>
              <circle cx="32" cy="32" r="26" fill="none" stroke="#f3e8ff" strokeWidth="7" />
              <circle cx="32" cy="32" r="26" fill="none" stroke="#6200b3" strokeWidth="7"
                strokeDasharray={`${(focusPct / 100) * 2 * Math.PI * 26} ${2 * Math.PI * 26}`}
                strokeLinecap="round" />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-sm font-bold text-[#6200b3]">{focusPct}%</span>
              <span className="text-[9px] text-muted-foreground leading-tight text-center">das ações{"\n"}concluídas</span>
            </div>
          </div>
        </div>
      </div>
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
        <h2 className="text-sm font-semibold text-[#1a0533]">
          Todas as páginas <span className="text-muted-foreground font-normal">({all.length})</span>
        </h2>
        <span className="text-xs text-muted-foreground">Ordenadas por progresso</span>
      </div>
      {all.map(s => {
        const score = s.isMonetized ? 100 : (template ? readinessScore(s, template) : 0);
        const days = template ? estimateDaysNum(s, template) : 9999;
        if (s.isMonetized) {
          return (
            <div key={s.id} className="bg-gradient-to-r from-green-50 to-emerald-50 border border-green-200 rounded-2xl shadow-sm p-4 flex items-center gap-4">
              <div className="h-10 w-10 rounded-xl bg-green-100 flex items-center justify-center shrink-0">
                <CheckCircle2 className="h-5 w-5 text-green-600" />
              </div>
              <div className="flex-1">
                <div className="font-semibold text-[#1a0533]">{s.name}</div>
                <div className="text-sm font-semibold text-green-700 mt-0.5">
                  Monetizada{s.daysToMonetize ? ` em ${s.daysToMonetize} dias` : ""} ✨
                </div>
              </div>
            </div>
          );
        }
        const viewsPct = template ? Math.min((s.views / template.views) * 100, 100) : 0;
        const postsPct = template ? Math.min((s.posts / template.posts) * 100, 100) : 0;
        const daysText = days === 9999 ? "Calculando..." : days <= 0 ? "Pronto!" : `~${days} dias para monetizar`;
        const dotColor = !s.isActive ? "#f43f5e" : days <= 30 ? "#f59e0b" : days <= 90 ? "#a855f7" : "#94a3b8";
        return (
          <div key={s.id} className="bg-white border border-[#e8e0f5] rounded-2xl shadow-sm p-4">
            <div className="flex items-start gap-4">
              <div className="flex-1 min-w-0 space-y-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <div className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: dotColor }} />
                  <span className="font-semibold text-[#1a0533] text-sm">{s.name}</span>
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
                  style={{ backgroundColor: days <= 30 ? "#fef9c3" : "#faf5ff", color: days <= 30 ? "#a16207" : "#6200b3" }}>
                  {daysText}
                </div>
                <div className="space-y-2">
                  {[
                    { label: "Views", pct: viewsPct, cur: s.views, tgt: template?.views ?? 0 },
                    { label: "Posts", pct: postsPct, cur: s.posts, tgt: Math.round(template?.posts ?? 0) },
                  ].map(b => (
                    <div key={b.label} className="flex items-center gap-2">
                      <span className="text-[11px] text-muted-foreground w-10 shrink-0">{b.label}</span>
                      <div className="flex-1 h-1.5 bg-[#f3e8ff] rounded-full overflow-hidden">
                        <div className="h-1.5 rounded-full" style={{
                          width: `${b.pct}%`,
                          backgroundColor: b.pct >= 75 ? "#16a34a" : b.pct >= 40 ? "#f59e0b" : "#6200b3",
                        }} />
                      </div>
                      <span className="text-[11px] font-medium text-[#1a0533] w-10 text-right shrink-0">{fmt(b.cur)}</span>
                      <span className="text-[11px] text-muted-foreground shrink-0">/</span>
                      <span className="text-[11px] text-muted-foreground w-10 shrink-0">{fmt(b.tgt)}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="shrink-0 self-center">
                <RingProgress pct={score} size={72} />
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Page Avatar ──────────────────────────────────────────────────────────────

const AVATAR_COLORS = ["#6200b3", "#0ea5e9", "#16a34a", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#06b6d4"];

function PageAvatar({ name, size = 32 }: { name: string; size?: number }) {
  const color = AVATAR_COLORS[name.charCodeAt(0) % AVATAR_COLORS.length];
  const initials = name.slice(0, 2).toUpperCase();
  return (
    <div className="rounded-full flex items-center justify-center text-white font-bold shrink-0"
      style={{ width: size, height: size, backgroundColor: color, fontSize: size * 0.35 }}>
      {initials}
    </div>
  );
}
