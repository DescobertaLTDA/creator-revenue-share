import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  TrendingUp, Clock, FileText, Eye, CheckCircle2, Flame,
  Heart, MessageCircle, Share2, Zap, Activity, CalendarDays,
  AlertCircle, ArrowRight,
} from "lucide-react";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/admin/monetizacao")({
  head: () => ({ meta: [{ title: "Monetização — Gestão de Páginas" }] }),
  component: MonetizacaoPage,
});

// ─── Types ────────────────────────────────────────────────────────────────────

interface RawPost {
  id: string;
  page_id: string;
  published_at: string | null;
  monetization_approx: number | null;
  estimated_usd: number | null;
  views: number | null;
  reactions: number | null;
  comments: number | null;
  shares: number | null;
  post_type: string | null;
}

interface PageRow { id: string; nome: string }

interface PostBucket {
  views: number; reactions: number; comments: number; shares: number; videos: number; count: number;
  dates: string[];
}

interface PageMonetStat {
  id: string;
  name: string;
  isMonetized: boolean;
  firstPostDate: string | null;
  lastPostDate: string | null;
  firstPaymentDate: string | null;
  daysToMonetize: number | null;
  // pre-monetization (or all posts for warming pages)
  posts: number;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  videos: number;
  activeDays: number;
  longestStreak: number;
  postsPerActiveDay: number;
  avgViewsPerPost: number;
  avgLikes: number;
  avgComments: number;
  avgShares: number;
  engRate: number;
  videoPct: number;
  viewsPerActiveDay: number;
  // warming-only
  currentStreak: number;
  daysSinceLastPost: number | null;
  isActive: boolean;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmt = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M`
  : n >= 1_000 ? `${Math.round(n / 1_000)}k`
  : String(Math.round(n));

const fmtDate = (d: string) => {
  const [y, m, day] = d.split("-");
  return `${day}/${m}/${y.slice(2)}`;
};

const daysBetween = (a: string, b: string) =>
  Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86_400_000);

function getUsd(p: RawPost) {
  return Number(p.monetization_approx ?? 0) > 0
    ? Number(p.monetization_approx)
    : Number(p.estimated_usd ?? 0);
}

function calcStreaks(sortedDates: string[]): { longest: number; current: number } {
  if (sortedDates.length === 0) return { longest: 0, current: 0 };
  const uniqueDays = [...new Set(sortedDates.map((d) => d.slice(0, 10)))].sort();
  let longest = 1, run = 1;
  for (let i = 1; i < uniqueDays.length; i++) {
    if (daysBetween(uniqueDays[i - 1], uniqueDays[i]) === 1) {
      run++;
      longest = Math.max(longest, run);
    } else {
      run = 1;
    }
  }
  const today = new Date().toISOString().slice(0, 10);
  const last = uniqueDays[uniqueDays.length - 1];
  let current = 0;
  if (daysBetween(last, today) <= 1) {
    current = 1;
    for (let i = uniqueDays.length - 2; i >= 0; i--) {
      if (daysBetween(uniqueDays[i], uniqueDays[i + 1]) === 1) current++;
      else break;
    }
  }
  return { longest: Math.max(longest, 1), current };
}

function sumBucket(posts: RawPost[]): PostBucket {
  let views = 0, reactions = 0, comments = 0, shares = 0, videos = 0;
  const dates: string[] = [];
  for (const p of posts) {
    views += Number(p.views ?? 0);
    reactions += Number(p.reactions ?? 0);
    comments += Number(p.comments ?? 0);
    shares += Number(p.shares ?? 0);
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
    const arr = byPage.get(p.page_id) ?? [];
    arr.push(p);
    byPage.set(p.page_id, arr);
  }

  return pages.map((page) => {
    const all = (byPage.get(page.id) ?? []).sort(
      (a, b) => (a.published_at ?? "").localeCompare(b.published_at ?? "")
    );

    const firstPostDate = all[0]?.published_at?.slice(0, 10) ?? null;
    const lastPostDate = all[all.length - 1]?.published_at?.slice(0, 10) ?? null;
    const firstPayIdx = all.findIndex((p) => getUsd(p) > 0);
    const isMonetized = firstPayIdx >= 0;
    const firstPaymentDate = isMonetized
      ? all[firstPayIdx].published_at?.slice(0, 10) ?? null
      : null;
    const daysToMonetize =
      isMonetized && firstPostDate && firstPaymentDate
        ? daysBetween(firstPostDate, firstPaymentDate)
        : null;

    // For monetized pages: analyze the pre-monetization window
    // For warming pages: analyze all posts
    const bucket = sumBucket(isMonetized ? all.slice(0, firstPayIdx) : all);

    const activeDays = new Set(bucket.dates.map((d) => d.slice(0, 10))).size;
    const { longest: longestStreak, current: currentStreak } = calcStreaks(bucket.dates);
    const daysSinceLastPost = lastPostDate ? daysBetween(lastPostDate, today) : null;
    const isActive = daysSinceLastPost !== null && daysSinceLastPost <= 7;

    const n = bucket.count;
    return {
      id: page.id,
      name: page.nome,
      isMonetized,
      firstPostDate,
      lastPostDate,
      firstPaymentDate,
      daysToMonetize,
      posts: n,
      views: bucket.views,
      likes: bucket.reactions,
      comments: bucket.comments,
      shares: bucket.shares,
      videos: bucket.videos,
      activeDays,
      longestStreak,
      postsPerActiveDay: activeDays > 0 ? n / activeDays : 0,
      avgViewsPerPost: n > 0 ? bucket.views / n : 0,
      avgLikes: n > 0 ? bucket.reactions / n : 0,
      avgComments: n > 0 ? bucket.comments / n : 0,
      avgShares: n > 0 ? bucket.shares / n : 0,
      engRate: bucket.views > 0 ? (bucket.reactions + bucket.comments + bucket.shares) / bucket.views : 0,
      videoPct: n > 0 ? (bucket.videos / n) * 100 : 0,
      viewsPerActiveDay: activeDays > 0 ? bucket.views / activeDays : 0,
      currentStreak,
      daysSinceLastPost,
      isActive,
    };
  });
}

function readinessScore(s: PageMonetStat, tpl: Template): number {
  const viewsPct = Math.min(s.views / tpl.views, 1);
  const postsPct = Math.min(s.posts / tpl.posts, 1);
  const engPct = tpl.engRate > 0 ? Math.min(s.engRate / tpl.engRate, 1) : 1;
  const cadPct = tpl.postsPerActiveDay > 0 ? Math.min(s.postsPerActiveDay / tpl.postsPerActiveDay, 1) : 1;
  // weights sum to 100 — result is already 0-100, no extra multiplication
  return Math.round(viewsPct * 40 + postsPct * 35 + engPct * 15 + cadPct * 10);
}

interface Template {
  days: number; posts: number; views: number;
  avgViewsPerPost: number; engRate: number; videoPct: number;
  activeDays: number; postsPerActiveDay: number; longestStreak: number;
  avgLikes: number; avgComments: number; avgShares: number;
  viewsPerActiveDay: number;
  // ranges
  minViews: number; maxViews: number;
  minPosts: number; maxPosts: number;
  minDays: number; maxDays: number;
}

// ─── Component ────────────────────────────────────────────────────────────────

type Tab = "template" | "aquecimento" | "monetizadas";

export default function MonetizacaoPage() {
  const [pages, setPages] = useState<PageRow[]>([]);
  const [posts, setPosts] = useState<RawPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("aquecimento");

  useEffect(() => {
    const load = async () => {
      const [{ data: pagesData }, postsData] = await Promise.all([
        supabase.from("pages").select("id, nome"),
        (async () => {
          const PAGE = 1000;
          let from = 0;
          const all: RawPost[] = [];
          while (true) {
            const { data, error } = await supabase
              .from("posts")
              .select("id, page_id, published_at, monetization_approx, estimated_usd, views, reactions, comments, shares, post_type")
              .range(from, from + PAGE - 1);
            if (error || !data || data.length === 0) break;
            all.push(...(data as RawPost[]));
            if (data.length < PAGE) break;
            from += data.length;
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
  const monetized = useMemo(() => stats.filter((s) => s.isMonetized).sort((a, b) => (a.daysToMonetize ?? 999) - (b.daysToMonetize ?? 999)), [stats]);
  const warming = useMemo(() => stats.filter((s) => !s.isMonetized && s.firstPostDate), [stats]);

  const template = useMemo((): Template | null => {
    if (monetized.length === 0) return null;
    const avg = (arr: number[]) => arr.reduce((s, v) => s + v, 0) / arr.length;
    const vals = {
      days: avg(monetized.map((m) => m.daysToMonetize ?? 0)),
      posts: avg(monetized.map((m) => m.posts)),
      views: avg(monetized.map((m) => m.views)),
      avgViewsPerPost: avg(monetized.map((m) => m.avgViewsPerPost)),
      engRate: avg(monetized.map((m) => m.engRate)),
      videoPct: avg(monetized.map((m) => m.videoPct)),
      activeDays: avg(monetized.map((m) => m.activeDays)),
      postsPerActiveDay: avg(monetized.map((m) => m.postsPerActiveDay)),
      longestStreak: avg(monetized.map((m) => m.longestStreak)),
      avgLikes: avg(monetized.map((m) => m.avgLikes)),
      avgComments: avg(monetized.map((m) => m.avgComments)),
      avgShares: avg(monetized.map((m) => m.avgShares)),
      viewsPerActiveDay: avg(monetized.map((m) => m.viewsPerActiveDay)),
      minViews: Math.min(...monetized.map((m) => m.views)),
      maxViews: Math.max(...monetized.map((m) => m.views)),
      minPosts: Math.min(...monetized.map((m) => m.posts)),
      maxPosts: Math.max(...monetized.map((m) => m.posts)),
      minDays: Math.min(...monetized.map((m) => m.daysToMonetize ?? 0)),
      maxDays: Math.max(...monetized.map((m) => m.daysToMonetize ?? 0)),
    };
    return vals;
  }, [monetized]);

  const warmingSorted = useMemo(() => {
    if (!template) return warming;
    return [...warming].sort((a, b) => readinessScore(b, template) - readinessScore(a, template));
  }, [warming, template]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground text-sm">
        <Activity className="h-5 w-5 mr-2 animate-pulse" />
        Carregando dados...
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-12">
      {/* ── Header ── */}
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold text-[#1a0533]">Monetização</h1>
        <p className="text-sm text-muted-foreground">
          Padrão das páginas que já monetizaram · acompanhamento das que estão em aquecimento
        </p>
      </div>

      {/* ── Summary strip ── */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "Monetizadas", value: monetized.length, color: "text-green-600", bg: "bg-green-50" },
          { label: "Em aquecimento", value: warming.filter((s) => s.isActive).length, color: "text-amber-600", bg: "bg-amber-50" },
          { label: "Inativas", value: warming.filter((s) => !s.isActive).length, color: "text-red-500", bg: "bg-red-50" },
        ].map((c) => (
          <div key={c.label} className={cn("rounded-2xl border border-border p-4 bg-white shadow-sm flex flex-col gap-1")}>
            <span className={cn("text-2xl font-bold", c.color)}>{c.value}</span>
            <span className="text-xs text-muted-foreground">{c.label}</span>
          </div>
        ))}
      </div>

      {/* ── Tab bar ── */}
      <div className="flex gap-1 bg-[#f5f0ff] p-1 rounded-xl w-fit">
        {([
          { id: "template", label: `Padrão (${monetized.length})` },
          { id: "aquecimento", label: `Em Aquecimento (${warming.length})` },
          { id: "monetizadas", label: `Monetizadas (${monetized.length})` },
        ] as { id: Tab; label: string }[]).map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              "px-4 py-2 text-sm font-medium rounded-lg transition-all",
              tab === t.id
                ? "bg-white text-[#6200b3] shadow-sm"
                : "text-[#7c6f8e] hover:text-[#6200b3]"
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Tab: Template ── */}
      {tab === "template" && template && (
        <TemplateTab monetized={monetized} template={template} />
      )}

      {/* ── Tab: Aquecimento ── */}
      {tab === "aquecimento" && template && (
        <AquecimentoTab pages={warmingSorted} template={template} />
      )}

      {/* ── Tab: Monetizadas ── */}
      {tab === "monetizadas" && (
        <MonetizadasTab pages={monetized} />
      )}
    </div>
  );
}

// ─── Template Tab ─────────────────────────────────────────────────────────────

function TemplateTab({ monetized, template }: { monetized: PageMonetStat[]; template: Template }) {
  const metrics = [
    {
      icon: Clock, label: "Dias até monetizar",
      avg: `${Math.round(template.days)}d`,
      range: `${template.minDays}d – ${template.maxDays}d`,
      detail: "Desde o 1º post até o 1º pagamento",
    },
    {
      icon: FileText, label: "Posts publicados",
      avg: `${Math.round(template.posts)}`,
      range: `${template.minPosts} – ${template.maxPosts}`,
      detail: "Posts antes do 1º pagamento",
    },
    {
      icon: Eye, label: "Views acumuladas",
      avg: fmt(template.views),
      range: `${fmt(template.minViews)} – ${fmt(template.maxViews)}`,
      detail: "Views totais antes da monetização",
    },
    {
      icon: Eye, label: "Views / post",
      avg: fmt(template.avgViewsPerPost),
      range: null,
      detail: "Média de views por publicação",
    },
    {
      icon: CalendarDays, label: "Dias ativos",
      avg: `${Math.round(template.activeDays)}d`,
      range: null,
      detail: "Dias com pelo menos 1 post",
    },
    {
      icon: Zap, label: "Posts / dia ativo",
      avg: template.postsPerActiveDay.toFixed(1),
      range: null,
      detail: "Cadência real de publicação",
    },
    {
      icon: Zap, label: "Maior sequência",
      avg: `${Math.round(template.longestStreak)}d`,
      range: null,
      detail: "Maior streak de dias consecutivos",
    },
    {
      icon: TrendingUp, label: "Engajamento",
      avg: `${(template.engRate * 100).toFixed(2)}%`,
      range: null,
      detail: "(Likes + Comentários + Shares) / Views",
    },
    {
      icon: Heart, label: "Likes / post",
      avg: fmt(template.avgLikes),
      range: null,
      detail: "Média de reações por post",
    },
    {
      icon: MessageCircle, label: "Comentários / post",
      avg: fmt(template.avgComments),
      range: null,
      detail: "Média de comentários por post",
    },
    {
      icon: Share2, label: "Shares / post",
      avg: fmt(template.avgShares),
      range: null,
      detail: "Média de compartilhamentos por post",
    },
    {
      icon: Eye, label: "Views / dia ativo",
      avg: fmt(template.viewsPerActiveDay),
      range: null,
      detail: "Views totais por dia de publicação",
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm text-muted-foreground mb-4">
          Médias calculadas com base nas <strong>{monetized.length} páginas monetizadas</strong>, considerando apenas os posts publicados <em>antes</em> do primeiro pagamento recebido.
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {metrics.map(({ icon: Icon, label, avg, range, detail }) => (
            <div key={label} className="bg-white border border-[#e8e0f5] rounded-2xl p-4 shadow-sm">
              <div className="flex items-center gap-2 mb-3">
                <div className="h-8 w-8 rounded-xl bg-[#f3e8ff] flex items-center justify-center shrink-0">
                  <Icon className="h-4 w-4 text-[#6200b3]" />
                </div>
                <span className="text-xs text-muted-foreground leading-tight">{label}</span>
              </div>
              <p className="text-2xl font-bold text-[#1a0533]">{avg}</p>
              {range && (
                <p className="text-[11px] text-[#6200b3] font-medium mt-1">range: {range}</p>
              )}
              <p className="text-[11px] text-muted-foreground mt-1">{detail}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Per-page breakdown */}
      <div>
        <h3 className="text-sm font-semibold text-[#1a0533] mb-3">Detalhes por página</h3>
        <div className="bg-white border border-[#e8e0f5] rounded-2xl overflow-hidden shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#f3e8ff] bg-[#faf5ff]">
                {["Página", "Dias", "Posts", "Dias ativos", "Posts/dia", "Streak max", "Views", "Views/dia", "Engaj."].map((h) => (
                  <th key={h} className="px-3 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-[#7c6f8e] whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {monetized.map((s, i) => (
                <tr key={s.id} className={i % 2 === 0 ? "bg-white" : "bg-[#faf5ff]"}>
                  <td className="px-3 py-3 font-medium text-[#1a0533] flex items-center gap-2">
                    <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0" />
                    {s.name}
                  </td>
                  <td className="px-3 py-3 font-semibold text-[#6200b3]">{s.daysToMonetize ?? "—"}</td>
                  <td className="px-3 py-3">{s.posts}</td>
                  <td className="px-3 py-3">{s.activeDays}</td>
                  <td className="px-3 py-3">{s.postsPerActiveDay.toFixed(1)}</td>
                  <td className="px-3 py-3">{s.longestStreak}</td>
                  <td className="px-3 py-3">{fmt(s.views)}</td>
                  <td className="px-3 py-3">{fmt(s.viewsPerActiveDay)}</td>
                  <td className="px-3 py-3">{(s.engRate * 100).toFixed(2)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ─── Aquecimento Tab ──────────────────────────────────────────────────────────

function AquecimentoTab({ pages, template }: { pages: PageMonetStat[]; template: Template }) {
  if (pages.length === 0) {
    return (
      <div className="flex items-center justify-center h-40 text-muted-foreground text-sm gap-2">
        <Flame className="h-5 w-5 opacity-30" />
        Nenhuma página em aquecimento.
      </div>
    );
  }

  const active = pages.filter((p) => p.isActive);
  const inactive = pages.filter((p) => !p.isActive);

  return (
    <div className="space-y-6">
      {active.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-green-700">
            Ativas — postando nos últimos 7 dias ({active.length})
          </h3>
          {active.map((s) => (
            <WarmingCard key={s.id} s={s} template={template} />
          ))}
        </div>
      )}
      {inactive.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-red-500">
            Inativas — sem posts nos últimos 7 dias ({inactive.length})
          </h3>
          {inactive.map((s) => (
            <WarmingCard key={s.id} s={s} template={template} />
          ))}
        </div>
      )}
    </div>
  );
}

function WarmingCard({ s, template }: { s: PageMonetStat; template: Template }) {
  const score = readinessScore(s, template);
  const scoreColor = score >= 75 ? "#16a34a" : score >= 50 ? "#f59e0b" : score >= 25 ? "#f97316" : "#7c3aed";
  const scoreLabel = score >= 75 ? "Quase lá" : score >= 50 ? "Em progresso" : score >= 25 ? "Aquecendo" : "Início";

  const viewsPct = Math.min((s.views / template.views) * 100, 100);
  const postsPct = Math.min((s.posts / template.posts) * 100, 100);
  const engPct = template.engRate > 0 ? Math.min((s.engRate / template.engRate) * 100, 100) : 0;
  const cadPct = template.postsPerActiveDay > 0 ? Math.min((s.postsPerActiveDay / template.postsPerActiveDay) * 100, 100) : 0;

  return (
    <div className="bg-white border border-[#e8e0f5] rounded-2xl shadow-sm overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-[#f3e8ff]">
        {/* Name + badges */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <div className={cn("h-2 w-2 rounded-full shrink-0", s.isActive ? "bg-green-500" : "bg-red-400")} />
            <span className="font-semibold text-[#1a0533] truncate">{s.name}</span>
            {!s.isActive && s.daysSinceLastPost !== null && (
              <span className="text-xs text-red-400 shrink-0 flex items-center gap-1">
                <AlertCircle className="h-3 w-3" />
                {s.daysSinceLastPost}d sem postar
              </span>
            )}
            {s.currentStreak > 0 && (
              <span className="text-xs text-amber-600 shrink-0 flex items-center gap-1">
                <Flame className="h-3 w-3" />
                {s.currentStreak}d seguidos
              </span>
            )}
          </div>
          <span className="mt-1.5 inline-block text-xs font-medium px-2 py-0.5 rounded-full" style={{ color: scoreColor, backgroundColor: `${scoreColor}18` }}>
            {scoreLabel}
          </span>
        </div>

        {/* Speedometer — right side */}
        <div className="shrink-0 ml-4 flex flex-col items-center">
          <Speedometer score={score} />
        </div>
      </div>

      {/* Progress bars */}
      <div className="px-5 pt-3 pb-2 space-y-2">
        {[
          { label: "Views", pct: viewsPct, current: fmt(s.views), target: fmt(template.views) },
          { label: "Posts", pct: postsPct, current: String(s.posts), target: String(Math.round(template.posts)) },
          { label: "Engajamento", pct: engPct, current: `${(s.engRate * 100).toFixed(2)}%`, target: `${(template.engRate * 100).toFixed(2)}%` },
          { label: "Cadência", pct: cadPct, current: `${s.postsPerActiveDay.toFixed(1)}/dia`, target: `${template.postsPerActiveDay.toFixed(1)}/dia` },
        ].map(({ label, pct, current, target }) => {
          const c = pct >= 75 ? "#16a34a" : pct >= 40 ? "#f59e0b" : "#6200b3";
          return (
            <div key={label} className="flex items-center gap-3">
              <span className="text-[11px] text-muted-foreground w-24 shrink-0">{label}</span>
              <div className="flex-1 h-1.5 bg-[#f3e8ff] rounded-full">
                <div className="h-1.5 rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: c }} />
              </div>
              <span className="text-[11px] font-medium text-[#1a0533] w-16 text-right shrink-0">{current}</span>
              <ArrowRight className="h-3 w-3 text-muted-foreground shrink-0" />
              <span className="text-[11px] text-muted-foreground w-16 shrink-0">{target}</span>
            </div>
          );
        })}
      </div>

      {/* Metrics grid */}
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 px-5 pb-4 pt-2">
        <MiniMetric icon={CalendarDays} label="Dias ativos" value={`${s.activeDays}d`} sub={`de ${s.firstPostDate ? Math.max(daysBetween(s.firstPostDate, new Date().toISOString().slice(0,10)), 1) : "?"}d totais`} />
        <MiniMetric icon={Zap} label="Posts/dia" value={s.postsPerActiveDay.toFixed(1)} sub={`meta: ${template.postsPerActiveDay.toFixed(1)}`} />
        <MiniMetric icon={Flame} label="Maior streak" value={`${s.longestStreak}d`} sub={`meta: ${Math.round(template.longestStreak)}d`} />
        <MiniMetric icon={Heart} label="Likes/post" value={fmt(s.avgLikes)} sub={`meta: ${fmt(template.avgLikes)}`} />
        <MiniMetric icon={MessageCircle} label="Coment./post" value={fmt(s.avgComments)} sub={`meta: ${fmt(template.avgComments)}`} />
        <MiniMetric icon={Share2} label="Shares/post" value={fmt(s.avgShares)} sub={`meta: ${fmt(template.avgShares)}`} />
      </div>
    </div>
  );
}

// ─── Speedometer ─────────────────────────────────────────────────────────────

function Speedometer({ score }: { score: number }) {
  const pct = Math.min(Math.max(score, 0), 100);
  const color = pct >= 75 ? "#16a34a" : pct >= 50 ? "#f59e0b" : pct >= 25 ? "#f97316" : "#7c3aed";

  const cx = 44, cy = 42, r = 30, sw = 7;
  const arcLen = Math.PI * r; // semicircle length
  const fillLen = (pct / 100) * arcLen;
  const bgPath = `M ${cx - r},${cy} A ${r},${r} 0 0,1 ${cx + r},${cy}`;

  // Needle: 0% = left (π), 100% = right (0)
  const needleAngle = Math.PI - (pct / 100) * Math.PI;
  const nx = cx + (r - 6) * Math.cos(needleAngle);
  const ny = cy - (r - 6) * Math.sin(needleAngle);

  // Ticks at 0, 25, 50, 75, 100
  const ticks = [0, 25, 50, 75, 100].map((t) => {
    const a = Math.PI - (t / 100) * Math.PI;
    const inner = r + sw / 2 + 2;
    const outer = r + sw / 2 + 6;
    return {
      x1: cx + inner * Math.cos(a), y1: cy - inner * Math.sin(a),
      x2: cx + outer * Math.cos(a), y2: cy - outer * Math.sin(a),
    };
  });

  return (
    <div className="flex flex-col items-center gap-0.5 select-none" title={`${pct}/100 — probabilidade de monetização`}>
      <svg width="88" height="56" viewBox="0 0 88 56">
        {/* Track */}
        <path d={bgPath} fill="none" stroke="#f3e8ff" strokeWidth={sw} strokeLinecap="round" />
        {/* Fill */}
        <path d={bgPath} fill="none" stroke={color} strokeWidth={sw} strokeLinecap="round"
          strokeDasharray={`${fillLen} ${arcLen}`} />
        {/* Ticks */}
        {ticks.map((t, i) => (
          <line key={i} x1={t.x1} y1={t.y1} x2={t.x2} y2={t.y2} stroke="#ddd6fe" strokeWidth="1.5" />
        ))}
        {/* 0 / 100 labels */}
        <text x={cx - r - 1} y={cy + 13} fontSize="7.5" fill="#9d8fb0" textAnchor="middle">0</text>
        <text x={cx + r + 1} y={cy + 13} fontSize="7.5" fill="#9d8fb0" textAnchor="middle">100</text>
        {/* Needle */}
        <line x1={cx} y1={cy} x2={nx} y2={ny} stroke={color} strokeWidth="2.5" strokeLinecap="round" />
        {/* Hub */}
        <circle cx={cx} cy={cy} r="4" fill={color} />
        <circle cx={cx} cy={cy} r="2" fill="white" />
        {/* Score */}
        <text x={cx} y={cy + 15} fontSize="12" fontWeight="bold" fill={color} textAnchor="middle">{pct}</text>
      </svg>
    </div>
  );
}

function MiniMetric({ icon: Icon, label, value, sub }: {
  icon: React.ComponentType<{ className?: string }>;
  label: string; value: string; sub: string;
}) {
  return (
    <div className="bg-[#faf5ff] rounded-xl p-2.5 flex flex-col gap-0.5">
      <div className="flex items-center gap-1.5 mb-1">
        <Icon className="h-3 w-3 text-[#6200b3]" />
        <span className="text-[10px] text-muted-foreground">{label}</span>
      </div>
      <p className="font-bold text-[#1a0533] text-sm">{value}</p>
      <p className="text-[10px] text-muted-foreground">{sub}</p>
    </div>
  );
}

// ─── Monetizadas Tab ──────────────────────────────────────────────────────────

function MonetizadasTab({ pages }: { pages: PageMonetStat[] }) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Métricas calculadas apenas com os posts publicados <em>antes</em> do primeiro pagamento recebido.
      </p>
      <div className="bg-white border border-[#e8e0f5] rounded-2xl shadow-sm overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[#f3e8ff] bg-[#faf5ff]">
              {[
                "Página", "1º post", "1º pgto", "Dias", "Posts",
                "Dias ativos", "Posts/dia", "Streak", "Views", "Views/dia",
                "Likes/p", "Coment./p", "Shares/p", "Engaj.", "% Vídeo",
              ].map((h) => (
                <th key={h} className="px-3 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-[#7c6f8e] whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pages.map((s, i) => (
              <tr key={s.id} className={i % 2 === 0 ? "bg-white hover:bg-[#faf5ff]" : "bg-[#faf5ff] hover:bg-[#f3e8ff]"}>
                <td className="px-3 py-3 font-medium text-[#1a0533]">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0" />
                    <span className="whitespace-nowrap">{s.name}</span>
                  </div>
                </td>
                <td className="px-3 py-3 text-muted-foreground whitespace-nowrap">{s.firstPostDate ? fmtDate(s.firstPostDate) : "—"}</td>
                <td className="px-3 py-3 text-muted-foreground whitespace-nowrap">{s.firstPaymentDate ? fmtDate(s.firstPaymentDate) : "—"}</td>
                <td className="px-3 py-3 font-bold text-[#6200b3]">{s.daysToMonetize ?? "—"}</td>
                <td className="px-3 py-3">{s.posts}</td>
                <td className="px-3 py-3">{s.activeDays}</td>
                <td className="px-3 py-3">{s.postsPerActiveDay.toFixed(1)}</td>
                <td className="px-3 py-3">{s.longestStreak}</td>
                <td className="px-3 py-3">{fmt(s.views)}</td>
                <td className="px-3 py-3">{fmt(s.viewsPerActiveDay)}</td>
                <td className="px-3 py-3">{fmt(s.avgLikes)}</td>
                <td className="px-3 py-3">{fmt(s.avgComments)}</td>
                <td className="px-3 py-3">{fmt(s.avgShares)}</td>
                <td className="px-3 py-3">{(s.engRate * 100).toFixed(2)}%</td>
                <td className="px-3 py-3">{Math.round(s.videoPct)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
