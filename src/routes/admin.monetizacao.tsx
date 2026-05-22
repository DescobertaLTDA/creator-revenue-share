import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import fbLogo from "@/assets/facebook.png";
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
  BarChart, Bar,
} from "recharts";
import {
  CheckCircle2, Flame, AlertCircle, Activity, Zap, Clock, Lightbulb,
  Trophy, ChevronDown, Rocket, Target, TrendingUp, BarChart2, FileText,
  Eye, Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Sheet, SheetContent } from "@/components/ui/sheet";

export const Route = createFileRoute("/admin/monetizacao")({
  head: () => ({ meta: [{ title: "Playbook de Monetização — Splash Creators" }] }),
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
interface PatternCard {
  icon: "zap" | "flame" | "rocket" | "clock" | "target";
  title: string; desc: string; value: string; positive: boolean | null;
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

// ─── New Computation Functions ────────────────────────────────────────────────

function computePatterns(monetized: PageMonetStat[]): PatternCard[] {
  if (monetized.length === 0) return [];
  const avgDays = monetized.reduce((s, m) => s + (m.daysToMonetize ?? 0), 0) / monetized.length;
  const patterns: PatternCard[] = [];

  // Pattern: video content
  const highVideo = monetized.filter(m => m.videoPct >= 50);
  const lowVideo = monetized.filter(m => m.videoPct < 50);
  if (highVideo.length > 0 && lowVideo.length > 0) {
    const diff = Math.round(
      lowVideo.reduce((s, m) => s + (m.daysToMonetize ?? avgDays), 0) / lowVideo.length -
      highVideo.reduce((s, m) => s + (m.daysToMonetize ?? avgDays), 0) / highVideo.length
    );
    if (diff > 0) {
      patterns.push({
        icon: "zap",
        title: "Vídeos aceleram a rota",
        desc: `Páginas com +50% de vídeos monetizaram ${diff} dias mais rápido que as demais`,
        value: `−${diff} dias`,
        positive: true,
      });
    }
  }

  // Pattern: streak
  const sorted = [...monetized].sort((a, b) => a.longestStreak - b.longestStreak);
  const medStreak = sorted[Math.floor(sorted.length / 2)]?.longestStreak ?? 0;
  if (medStreak > 0) {
    const highS = monetized.filter(m => m.longestStreak >= medStreak);
    const lowS = monetized.filter(m => m.longestStreak < medStreak);
    if (highS.length > 0 && lowS.length > 0) {
      const diff = Math.round(
        lowS.reduce((s, m) => s + (m.daysToMonetize ?? avgDays), 0) / lowS.length -
        highS.reduce((s, m) => s + (m.daysToMonetize ?? avgDays), 0) / highS.length
      );
      if (diff > 0) {
        patterns.push({
          icon: "flame",
          title: "Sequência é o atalho",
          desc: `Streak de ${medStreak}+ dias consecutivos reduziu a jornada em ${diff} dias na média`,
          value: `−${diff} dias`,
          positive: true,
        });
      }
    }
  }

  // Pattern: posts per active day
  const sortedCad = [...monetized].sort((a, b) => a.postsPerActiveDay - b.postsPerActiveDay);
  const medCad = sortedCad[Math.floor(sortedCad.length / 2)]?.postsPerActiveDay ?? 0;
  if (medCad > 0) {
    const highC = monetized.filter(m => m.postsPerActiveDay >= medCad);
    if (highC.length > 0) {
      const avgHighDays = highC.reduce((s, m) => s + (m.daysToMonetize ?? avgDays), 0) / highC.length;
      const diff = Math.round(avgDays - avgHighDays);
      if (diff > 5) {
        patterns.push({
          icon: "rocket",
          title: "Cadência define tudo",
          desc: `${medCad.toFixed(1)}+ posts/dia ativo = monetização ${diff} dias antes da média`,
          value: `−${diff} dias`,
          positive: true,
        });
      }
    }
  }

  // Always: average journey
  patterns.push({
    icon: "clock",
    title: "Média da jornada",
    desc: `Páginas monetizadas levaram ${Math.round(avgDays)} dias do primeiro post ao primeiro pagamento`,
    value: `${Math.round(avgDays)}d`,
    positive: null,
  });

  return patterns.slice(0, 4);
}

function computeInsights(
  stats: PageMonetStat[], monetized: PageMonetStat[],
  warming: PageMonetStat[], template: Template | null
): string[] {
  const insights: string[] = [];
  if (monetized.length > 0) {
    const avgD = Math.round(monetized.reduce((s, m) => s + (m.daysToMonetize ?? 0), 0) / monetized.length);
    insights.push(`${monetized.length} página${monetized.length > 1 ? "s" : ""} ${monetized.length > 1 ? "atingiram" : "atingiu"} monetização — média de ${avgD} dias do zero ao primeiro pagamento.`);
  }
  if (template) {
    const close = warming.filter(s => readinessScore(s, template) >= 70);
    if (close.length > 0) {
      insights.push(`${close.length} página${close.length > 1 ? "s estão" : " está"} acima de 70% de prontidão — são as que mais precisam de postagem constante agora.`);
    }
  }
  const inactive = warming.filter(s => !s.isActive && (s.daysSinceLastPost ?? 0) > 14);
  if (inactive.length > 0) {
    insights.push(`${inactive.length} página${inactive.length > 1 ? "s pararam" : " parou"} de postar há 2+ semanas — risco de perda de tração no algoritmo.`);
  }
  const bestStreak = stats.length > 0 ? stats.reduce((best, s) => s.currentStreak > best.currentStreak ? s : best, stats[0]) : null;
  if (bestStreak && bestStreak.currentStreak >= 3) {
    insights.push(`"${bestStreak.name}" lidera com ${bestStreak.currentStreak} dias consecutivos de publicação.`);
  }
  if (monetized.length > 0 && monetized[0].daysToMonetize) {
    insights.push(`Monetização mais rápida registrada: "${monetized[0].name}" em ${monetized[0].daysToMonetize} dias.`);
  }
  return insights;
}

function buildCumulativeChart(pagePosts: RawPost[]) {
  const byMonth = new Map<string, number>();
  for (const p of pagePosts) {
    if (!p.published_at || !p.views) continue;
    const month = p.published_at.slice(0, 7);
    byMonth.set(month, (byMonth.get(month) ?? 0) + Number(p.views));
  }
  const sorted = [...byMonth.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  let cum = 0;
  return sorted.map(([month, views]) => {
    cum += views;
    const [y, m] = month.split("-");
    return { label: `${m}/${y.slice(2)}`, cumulative: cum, monthly: views };
  });
}

function buildVelocityChart(pagePosts: RawPost[]) {
  const byMonth = new Map<string, { posts: number; views: number }>();
  for (const p of pagePosts) {
    if (!p.published_at) continue;
    const month = p.published_at.slice(0, 7);
    const cur = byMonth.get(month) ?? { posts: 0, views: 0 };
    cur.posts++;
    cur.views += Number(p.views ?? 0);
    byMonth.set(month, cur);
  }
  const sorted = [...byMonth.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  return sorted.slice(-8).map(([month, { posts, views }]) => {
    const [y, m] = month.split("-");
    return { label: `${m}/${y.slice(2)}`, posts, views };
  });
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function MonetizacaoPage() {
  const [pages, setPages] = useState<PageRow[]>([]);
  const [posts, setPosts] = useState<RawPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [gpsPageId, setGpsPageId] = useState<string | null>(null);
  const [drawerPageId, setDrawerPageId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<"all" | "monetized" | "warming" | "inactive">("all");

  useEffect(() => {
    (async () => {
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
    })();
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

  const patterns = useMemo(() => computePatterns(monetized), [monetized]);
  const insights = useMemo(() => computeInsights(stats, monetized, warming, template), [stats, monetized, warming, template]);

  const leaderboard = useMemo(() => {
    const warmingSorted = template
      ? [...warming].sort((a, b) => readinessScore(b, template) - readinessScore(a, template))
      : warming;
    return [...monetized, ...warmingSorted].map(s => ({
      stat: s,
      score: s.isMonetized ? 100 : (template ? readinessScore(s, template) : 0),
      days: template ? estimateDaysNum(s, template) : 9999,
    }));
  }, [monetized, warming, template]);

  const filteredLeaderboard = useMemo(() => {
    if (statusFilter === "all") return leaderboard;
    if (statusFilter === "monetized") return leaderboard.filter(r => r.stat.isMonetized);
    if (statusFilter === "warming") return leaderboard.filter(r => !r.stat.isMonetized && r.stat.isActive);
    if (statusFilter === "inactive") return leaderboard.filter(r => !r.stat.isMonetized && !r.stat.isActive);
    return leaderboard;
  }, [leaderboard, statusFilter]);

  useEffect(() => {
    if (!gpsPageId && warming.length > 0) setGpsPageId(warming[0].id);
    else if (!gpsPageId && monetized.length > 0) setGpsPageId(monetized[0].id);
  }, [warming, monetized, gpsPageId]);

  const gpsStat = useMemo(() => stats.find(s => s.id === gpsPageId) ?? null, [stats, gpsPageId]);
  const gpsPosts = useMemo(() => gpsPageId ? posts.filter(p => p.page_id === gpsPageId) : [], [posts, gpsPageId]);
  const drawerStat = useMemo(() => stats.find(s => s.id === drawerPageId) ?? null, [stats, drawerPageId]);
  const drawerPosts = useMemo(() => drawerPageId ? posts.filter(p => p.page_id === drawerPageId) : [], [posts, drawerPageId]);

  const cumulativeData = useMemo(() => buildCumulativeChart(gpsPosts), [gpsPosts]);
  const velocityData = useMemo(() => buildVelocityChart(gpsPosts), [gpsPosts]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground text-sm">
        <Activity className="h-5 w-5 mr-2 animate-pulse" /> Carregando dados...
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-12">
      {/* ── Header ── */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h1 className="text-2xl font-bold tracking-tight">Playbook de Monetização</h1>
            <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-[#FAA613]/15 text-[#FAA613]">
              <Sparkles className="h-3 w-3" /> Análise em tempo real
            </span>
          </div>
          <p className="text-sm text-muted-foreground">Padrões e GPS de monetização para cada página</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {monetized.length > 0 && (
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-green-500/10 border border-green-200">
              <div className="h-1.5 w-1.5 rounded-full bg-green-500" />
              <span className="text-xs font-semibold text-green-700">{monetized.length} monetizada{monetized.length > 1 ? "s" : ""}</span>
            </div>
          )}
          {warming.length > 0 && (
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-amber-500/10 border border-amber-200">
              <div className="h-1.5 w-1.5 rounded-full bg-amber-500" />
              <span className="text-xs font-semibold text-amber-700">{warming.length} em andamento</span>
            </div>
          )}
        </div>
      </div>

      {/* ── Pattern Discovery Cards ── */}
      {patterns.length > 0 && (
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-3">
            Padrões descobertos — o que funcionou
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {patterns.map((p, i) => <PatternCardComp key={i} pattern={p} />)}
          </div>
        </div>
      )}

      {/* ── Champion Table ── */}
      <div>
        <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
          <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
            Ranking de páginas — score de prontidão
          </p>
          <div className="flex items-center gap-1">
            {(["all", "monetized", "warming", "inactive"] as const).map(f => (
              <button
                key={f}
                onClick={() => setStatusFilter(f)}
                className={cn(
                  "px-2.5 py-1 rounded-lg text-xs font-medium transition-colors",
                  statusFilter === f ? "bg-[#FAA613] text-white" : "text-muted-foreground hover:bg-muted"
                )}
              >
                {f === "all" ? "Todas" : f === "monetized" ? "Monetizadas" : f === "warming" ? "Em andamento" : "Inativas"}
              </button>
            ))}
          </div>
        </div>
        <div className="rounded-2xl border border-border bg-card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th className="text-left px-4 py-2.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground w-8">#</th>
                <th className="text-left px-4 py-2.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Página</th>
                <th className="text-center px-3 py-2.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Score</th>
                <th className="text-right px-3 py-2.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground hidden sm:table-cell">Posts</th>
                <th className="text-right px-3 py-2.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground hidden md:table-cell">Views</th>
                <th className="text-right px-4 py-2.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Status</th>
              </tr>
            </thead>
            <tbody>
              {filteredLeaderboard.map((item, i) => (
                <ChampionRow
                  key={item.stat.id}
                  rank={i + 1}
                  item={item}
                  selected={drawerPageId === item.stat.id}
                  onClick={() => { setDrawerPageId(item.stat.id); setGpsPageId(item.stat.id); }}
                />
              ))}
              {filteredLeaderboard.length === 0 && (
                <tr>
                  <td colSpan={6} className="text-center py-8 text-sm text-muted-foreground">
                    Nenhuma página nesse filtro
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── GPS + Charts ── */}
      {gpsStat && template && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <GpsPanel
            stat={gpsStat}
            template={template}
            pages={pages}
            allStats={stats}
            selectedId={gpsPageId}
            onSelect={setGpsPageId}
          />
          <div className="lg:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-4">
            <CumulativeChart data={cumulativeData} pageName={gpsStat.name} />
            <VelocityChart data={velocityData} pageName={gpsStat.name} />
          </div>
        </div>
      )}

      {/* ── Auto Insights ── */}
      {insights.length > 0 && (
        <div className="rounded-2xl border border-border bg-card p-5">
          <div className="flex items-center gap-2 mb-4">
            <div className="h-8 w-8 rounded-xl flex items-center justify-center shrink-0"
              style={{ background: "linear-gradient(135deg, #F44708, #FAA613)" }}>
              <Lightbulb className="h-4 w-4 text-white" />
            </div>
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wider text-[#F44708]">Insights automáticos</p>
              <p className="text-xs text-muted-foreground">Gerado com base nos dados reais das páginas</p>
            </div>
          </div>
          <div className="space-y-2.5">
            {insights.map((ins, i) => (
              <div key={i} className="flex items-start gap-3">
                <div className="mt-1.5 h-1.5 w-1.5 rounded-full bg-[#FAA613] shrink-0" />
                <p className="text-sm text-foreground leading-relaxed">{ins}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Page Detail Drawer ── */}
      <Sheet open={!!drawerPageId} onOpenChange={open => !open && setDrawerPageId(null)}>
        <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto p-0">
          {drawerStat && template && (
            <PageDrawer stat={drawerStat} template={template} pagePosts={drawerPosts} />
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

// ─── Pattern Card ─────────────────────────────────────────────────────────────

const patternIcons: Record<PatternCard["icon"], React.ComponentType<{ className?: string }>> = {
  zap: Zap, flame: Flame, rocket: Rocket, clock: Clock, target: Target,
};
const patternColors: Record<PatternCard["icon"], { bg: string; icon: string; badge: string; badgeText: string }> = {
  zap:    { bg: "bg-purple-50",  icon: "text-purple-500",  badge: "bg-purple-100", badgeText: "text-purple-700" },
  flame:  { bg: "bg-orange-50",  icon: "text-orange-500",  badge: "bg-orange-100", badgeText: "text-orange-700" },
  rocket: { bg: "bg-blue-50",    icon: "text-blue-500",    badge: "bg-blue-100",   badgeText: "text-blue-700" },
  clock:  { bg: "bg-slate-50",   icon: "text-slate-500",   badge: "bg-slate-100",  badgeText: "text-slate-700" },
  target: { bg: "bg-green-50",   icon: "text-green-500",   badge: "bg-green-100",  badgeText: "text-green-700" },
};

function PatternCardComp({ pattern }: { pattern: PatternCard }) {
  const Icon = patternIcons[pattern.icon];
  const c = patternColors[pattern.icon];
  return (
    <div className="rounded-2xl border border-border bg-card p-4 flex flex-col gap-3">
      <div className={cn("h-9 w-9 rounded-xl flex items-center justify-center shrink-0", c.bg)}>
        <Icon className={cn("h-4 w-4", c.icon)} />
      </div>
      <div className="flex-1">
        <p className="text-sm font-semibold leading-tight">{pattern.title}</p>
        <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{pattern.desc}</p>
      </div>
      <div className={cn("inline-flex self-start items-center px-2.5 py-1 rounded-full text-xs font-bold", c.badge, c.badgeText)}>
        {pattern.value}
      </div>
    </div>
  );
}

// ─── Champion Table Row ───────────────────────────────────────────────────────

function ChampionRow({ rank, item, selected, onClick }: {
  rank: number;
  item: { stat: PageMonetStat; score: number; days: number };
  selected: boolean;
  onClick: () => void;
}) {
  const { stat, score, days } = item;
  const statusBadge = stat.isMonetized
    ? { label: "Monetizada", cls: "bg-green-100 text-green-700" }
    : !stat.isActive
    ? { label: "Inativa", cls: "bg-red-100 text-red-600" }
    : days <= 30
    ? { label: "~" + days + " dias", cls: "bg-amber-100 text-amber-700" }
    : { label: "~" + (days === 9999 ? "?" : days) + " dias", cls: "bg-[#FFF0E8] text-[#F44708]" };

  return (
    <tr
      onClick={onClick}
      className={cn(
        "border-b border-border/50 cursor-pointer transition-colors hover:bg-muted/40",
        selected && "bg-[#FFF8F0]"
      )}
    >
      <td className="px-4 py-3 text-xs font-bold text-muted-foreground">{rank}</td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-2.5">
          <PageAvatar size={28} />
          <div className="min-w-0">
            <p className="text-sm font-semibold truncate max-w-[160px]">{stat.name}</p>
            {stat.isMonetized && stat.daysToMonetize && (
              <p className="text-[10px] text-green-600 font-medium">Monetizou em {stat.daysToMonetize}d</p>
            )}
          </div>
        </div>
      </td>
      <td className="px-3 py-3">
        <div className="flex justify-center">
          <MiniRing pct={score} />
        </div>
      </td>
      <td className="px-3 py-3 text-right text-xs text-muted-foreground hidden sm:table-cell">{stat.posts}</td>
      <td className="px-3 py-3 text-right text-xs text-muted-foreground hidden md:table-cell">{fmt(stat.views)}</td>
      <td className="px-4 py-3 text-right">
        <span className={cn("inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold", statusBadge.cls)}>
          {statusBadge.label}
        </span>
      </td>
    </tr>
  );
}

// ─── GPS Panel ────────────────────────────────────────────────────────────────

function GpsPanel({ stat, template, pages, allStats, selectedId, onSelect }: {
  stat: PageMonetStat; template: Template; pages: PageRow[];
  allStats: PageMonetStat[]; selectedId: string | null; onSelect: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const score = stat.isMonetized ? 100 : readinessScore(stat, template);
  const days = estimateDaysNum(stat, template);

  const gaps = [
    { label: "Views", pct: Math.min((stat.views / template.views) * 100, 100), current: fmt(stat.views), target: fmt(Math.round(template.views)) },
    { label: "Posts", pct: Math.min((stat.posts / template.posts) * 100, 100), current: String(stat.posts), target: String(Math.round(template.posts)) },
    { label: "Engajamento", pct: template.engRate > 0 ? Math.min((stat.engRate / template.engRate) * 100, 100) : 100, current: `${(stat.engRate * 100).toFixed(2)}%`, target: `${(template.engRate * 100).toFixed(2)}%` },
    { label: "Cadência", pct: template.postsPerActiveDay > 0 ? Math.min((stat.postsPerActiveDay / template.postsPerActiveDay) * 100, 100) : 100, current: stat.postsPerActiveDay.toFixed(1), target: template.postsPerActiveDay.toFixed(1) },
  ];

  return (
    <div className="rounded-2xl border border-border bg-card p-5 flex flex-col gap-4">
      <div>
        <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-2">GPS de Monetização</p>
        {/* Page selector */}
        <div className="relative">
          <button
            onClick={() => setOpen(o => !o)}
            className="w-full flex items-center gap-2 bg-muted/50 border border-border rounded-xl px-3 py-2 text-sm hover:border-[#FAA613]/50 transition-colors"
          >
            <PageAvatar size={24} />
            <span className="flex-1 text-left font-medium truncate text-xs">{stat.name}</span>
            <ChevronDown className={cn("h-3.5 w-3.5 text-muted-foreground transition-transform shrink-0", open && "rotate-180")} />
          </button>
          {open && (
            <div className="absolute top-full mt-1 left-0 right-0 bg-white border border-border rounded-xl z-50 overflow-hidden max-h-48 overflow-y-auto">
              {pages.map(p => (
                <button
                  key={p.id}
                  onClick={() => { onSelect(p.id); setOpen(false); }}
                  className={cn("w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-muted transition-colors", selectedId === p.id && "bg-[#FFF0E8]")}
                >
                  <PageAvatar size={20} />
                  <span className="flex-1 text-left truncate">{p.nome}</span>
                  {allStats.find(s => s.id === p.id)?.isMonetized && (
                    <div className="h-1.5 w-1.5 rounded-full bg-green-500 shrink-0" />
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Similarity score */}
      <div className="flex flex-col items-center gap-2 py-2">
        <RingProgress pct={score} size={100} />
        <div className="text-center">
          {stat.isMonetized ? (
            <p className="text-sm font-bold text-green-600">Página Monetizada!</p>
          ) : (
            <>
              <p className="text-sm font-semibold">parecida com páginas que monetizaram</p>
              {days < 9999 && days > 0 && (
                <p className="text-xs text-muted-foreground mt-0.5">Estimativa: ~{days} dias</p>
              )}
            </>
          )}
        </div>
      </div>

      {/* Gaps */}
      <div className="space-y-2.5 border-t border-border pt-3">
        {gaps.map(g => (
          <div key={g.label}>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-muted-foreground">{g.label}</span>
              <span className="text-[10px] font-medium text-muted-foreground">{g.current} / {g.target}</span>
            </div>
            <div className="h-1.5 bg-muted rounded-full overflow-hidden">
              <div
                className="h-1.5 rounded-full transition-all"
                style={{
                  width: `${g.pct}%`,
                  backgroundColor: g.pct >= 80 ? "#16a34a" : g.pct >= 50 ? "#f59e0b" : "#F44708",
                }}
              />
            </div>
          </div>
        ))}
      </div>

      {!stat.isMonetized && stat.isActive && stat.currentStreak > 0 && (
        <div className="flex items-center gap-2 rounded-xl bg-amber-50 border border-amber-100 px-3 py-2">
          <Flame className="h-4 w-4 text-amber-500 shrink-0" />
          <span className="text-xs font-medium text-amber-700">{stat.currentStreak} dias em sequência</span>
        </div>
      )}
      {!stat.isMonetized && !stat.isActive && (
        <div className="flex items-center gap-2 rounded-xl bg-red-50 border border-red-100 px-3 py-2">
          <AlertCircle className="h-4 w-4 text-red-500 shrink-0" />
          <span className="text-xs font-medium text-red-700">
            {stat.daysSinceLastPost}d sem postar — retome a cadência
          </span>
        </div>
      )}
    </div>
  );
}

// ─── Charts ───────────────────────────────────────────────────────────────────

function CumulativeChart({ data, pageName }: { data: { label: string; cumulative: number }[]; pageName: string }) {
  const total = data[data.length - 1]?.cumulative ?? 0;
  return (
    <div className="rounded-2xl border border-border bg-card p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Views acumuladas</p>
          <p className="text-xs text-muted-foreground truncate max-w-[120px]">{pageName}</p>
        </div>
        <p className="text-lg font-extrabold">{fmt(total)}</p>
      </div>
      {data.length > 1 ? (
        <ResponsiveContainer width="100%" height={140}>
          <AreaChart data={data} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="cumGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#F44708" stopOpacity={0.25} />
                <stop offset="95%" stopColor="#F44708" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#F0E0D0" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 9, fill: "#6B6B6B" }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
            <YAxis hide />
            <Tooltip
              formatter={(v: any) => [fmt(Number(v)), "views acumuladas"]}
              contentStyle={{ border: "1px solid #E0E0E0", borderRadius: 10, fontSize: 11 }}
            />
            <Area type="monotone" dataKey="cumulative" stroke="#F44708" strokeWidth={2} fill="url(#cumGrad)" dot={false} />
          </AreaChart>
        </ResponsiveContainer>
      ) : (
        <div className="flex-1 flex items-center justify-center h-36 text-xs text-muted-foreground">
          Dados insuficientes
        </div>
      )}
    </div>
  );
}

function VelocityChart({ data, pageName }: { data: { label: string; posts: number; views: number }[]; pageName: string }) {
  const maxPosts = Math.max(...data.map(d => d.posts), 1);
  return (
    <div className="rounded-2xl border border-border bg-card p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Posts por mês</p>
          <p className="text-xs text-muted-foreground truncate max-w-[120px]">{pageName}</p>
        </div>
        <div className="flex items-center gap-1.5">
          <BarChart2 className="h-4 w-4 text-muted-foreground" />
          <span className="text-xs font-semibold">{data.length} meses</span>
        </div>
      </div>
      {data.length > 1 ? (
        <ResponsiveContainer width="100%" height={140}>
          <BarChart data={data} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#F0E0D0" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 9, fill: "#6B6B6B" }} axisLine={false} tickLine={false} />
            <YAxis hide />
            <Tooltip
              formatter={(v: any, name: string) => [Number(v), name === "posts" ? "posts" : "views"]}
              contentStyle={{ border: "1px solid #E0E0E0", borderRadius: 10, fontSize: 11 }}
            />
            <Bar dataKey="posts" fill="#FAA613" radius={[4, 4, 0, 0]} maxBarSize={32} />
          </BarChart>
        </ResponsiveContainer>
      ) : (
        <div className="flex-1 flex items-center justify-center h-36 text-xs text-muted-foreground">
          Dados insuficientes
        </div>
      )}
    </div>
  );
}

// ─── Page Detail Drawer ───────────────────────────────────────────────────────

function PageDrawer({ stat, template, pagePosts }: {
  stat: PageMonetStat; template: Template; pagePosts: RawPost[];
}) {
  const score = stat.isMonetized ? 100 : readinessScore(stat, template);
  const days = estimateDaysNum(stat, template);
  const milestones = useMemo(() => computeMilestones(stat, template), [stat, template]);

  const metrics = [
    { label: "Posts", value: stat.posts, target: Math.round(template.posts) },
    { label: "Views", value: fmt(stat.views), target: fmt(Math.round(template.views)) },
    { label: "Dias ativos", value: stat.activeDays, target: Math.round(template.activeDays) },
    { label: "Streak máx.", value: `${stat.longestStreak}d`, target: `${Math.round(template.longestStreak)}d` },
    { label: "Engajamento", value: `${(stat.engRate * 100).toFixed(2)}%`, target: `${(template.engRate * 100).toFixed(2)}%` },
    { label: "Posts/dia ativo", value: stat.postsPerActiveDay.toFixed(2), target: template.postsPerActiveDay.toFixed(2) },
  ];

  // Best format
  const formatMap = new Map<string, { views: number; count: number }>();
  for (const p of pagePosts) {
    if (!p.views) continue;
    const t = (p.post_type ?? "").toLowerCase();
    const f = t.includes("video") || t === "reel" ? "Vídeo"
      : t.includes("photo") || t.includes("foto") ? "Foto"
      : t.includes("link") ? "Link" : "Outro";
    const e = formatMap.get(f) ?? { views: 0, count: 0 };
    e.views += Number(p.views); e.count++; formatMap.set(f, e);
  }
  const bestFormat = [...formatMap.entries()].sort((a, b) => (b[1].views / b[1].count) - (a[1].views / a[1].count))[0];

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-5 py-5 border-b border-border">
        <div className="flex items-center gap-3">
          <PageAvatar size={40} />
          <div className="flex-1 min-w-0">
            <h3 className="font-bold text-base truncate">{stat.name}</h3>
            <div className="flex items-center gap-1.5 mt-0.5">
              {stat.isMonetized ? (
                <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-green-100 text-green-700">
                  <CheckCircle2 className="h-3 w-3" /> Monetizada
                </span>
              ) : stat.isActive ? (
                <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">
                  <Activity className="h-3 w-3" /> Em andamento
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-100 text-red-600">
                  <AlertCircle className="h-3 w-3" /> Inativa
                </span>
              )}
              {stat.currentStreak > 0 && (
                <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-orange-100 text-orange-700">
                  <Flame className="h-3 w-3" /> {stat.currentStreak}d seguidos
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-5 space-y-5">
        {/* Score ring */}
        <div className="flex items-center justify-between gap-4 rounded-xl bg-muted/30 p-4">
          <div>
            <p className="text-xs text-muted-foreground">Score de prontidão</p>
            <p className="text-2xl font-extrabold mt-0.5">{score}%</p>
            {!stat.isMonetized && days < 9999 && days > 0 && (
              <p className="text-xs text-muted-foreground">~{days} dias estimados</p>
            )}
          </div>
          <RingProgress pct={score} size={80} dark={false} />
        </div>

        {/* Timeline milestones */}
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-3">
            Jornada de monetização
          </p>
          <div className="space-y-2">
            {milestones.map((m, i) => (
              <div key={i} className="flex items-center gap-3 py-1">
                <MilestoneIconComp status={m.status} />
                <div className="flex-1 min-w-0">
                  <p className={cn("text-xs font-medium", m.status === "pending" && "text-muted-foreground")}>{m.label}</p>
                </div>
                <span className={cn("text-[10px] font-semibold shrink-0",
                  m.status === "done" ? "text-green-600"
                  : m.status === "progress" ? "text-amber-500"
                  : "text-muted-foreground/50"
                )}>{m.detail}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Metrics table */}
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-3">
            Métricas vs meta
          </p>
          <div className="rounded-xl border border-border overflow-hidden">
            {metrics.map((m, i) => (
              <div key={m.label} className={cn("flex items-center justify-between px-3 py-2 text-xs", i % 2 === 0 && "bg-muted/20")}>
                <span className="text-muted-foreground">{m.label}</span>
                <div className="flex items-center gap-2">
                  <span className="font-semibold">{m.value}</span>
                  <span className="text-muted-foreground">/</span>
                  <span className="text-muted-foreground">{m.target}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Best format */}
        {bestFormat && (
          <div className="rounded-xl bg-[#FFF8F0] border border-[#FAA613]/20 p-3 flex items-center gap-3">
            <div className="h-8 w-8 rounded-lg bg-[#FAA613]/20 flex items-center justify-center shrink-0">
              <Trophy className="h-4 w-4 text-[#FAA613]" />
            </div>
            <div>
              <p className="text-xs font-bold text-[#FAA613]">Melhor formato</p>
              <p className="text-sm font-semibold">{bestFormat[0]} — {fmt(Math.round(bestFormat[1].views / bestFormat[1].count))} views/post</p>
            </div>
          </div>
        )}

        {/* Page dates */}
        {stat.firstPostDate && (
          <div className="text-xs text-muted-foreground space-y-1">
            <div className="flex justify-between">
              <span>Primeiro post</span>
              <span className="font-medium">{stat.firstPostDate}</span>
            </div>
            {stat.lastPostDate && (
              <div className="flex justify-between">
                <span>Último post</span>
                <span className="font-medium">{stat.lastPostDate}</span>
              </div>
            )}
            {stat.isMonetized && stat.firstPaymentDate && (
              <div className="flex justify-between">
                <span>Primeiro pagamento</span>
                <span className="font-medium text-green-600">{stat.firstPaymentDate}</span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Small Components ─────────────────────────────────────────────────────────

function MiniRing({ pct }: { pct: number }) {
  const size = 44, sw = 4, r = (size - sw) / 2;
  const circ = 2 * Math.PI * r;
  const dash = (Math.min(pct, 100) / 100) * circ;
  const color = pct >= 75 ? "#16a34a" : pct >= 50 ? "#f59e0b" : "#F44708";
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#F0F0F0" strokeWidth={sw} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={sw}
          strokeDasharray={`${dash} ${circ}`} strokeLinecap="round" />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-[10px] font-bold" style={{ color }}>{pct}%</span>
      </div>
    </div>
  );
}

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

function MilestoneIconComp({ status }: { status: "done" | "progress" | "pending" }) {
  if (status === "done") return <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />;
  if (status === "progress") return <div className="h-4 w-4 rounded-full border-2 border-amber-400 bg-amber-50 shrink-0" />;
  return <div className="h-4 w-4 rounded-full border-2 border-border shrink-0" />;
}

function PageAvatar({ size = 32 }: { name?: string; size?: number }) {
  return (
    <img src={fbLogo} alt="Facebook" className="rounded-full shrink-0 object-contain"
      style={{ width: size, height: size }} />
  );
}
