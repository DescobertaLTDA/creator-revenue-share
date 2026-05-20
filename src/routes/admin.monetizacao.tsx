import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { formatBRL } from "@/lib/format";
import { TrendingUp, Clock, FileText, Eye, CheckCircle2, Flame, BarChart2 } from "lucide-react";

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

interface PageMonetStat {
  id: string;
  name: string;
  isMonetized: boolean;
  firstPostDate: string | null;
  firstPaymentDate: string | null;
  daysToMonetize: number | null;
  postsBeforeMonetize: number;
  viewsBeforeMonetize: number;
  avgViewsPerPostBefore: number;
  engRateBefore: number;
  videoPctBefore: number;
  // current (non-monetized pages)
  currentPosts: number;
  currentViews: number;
  daysSinceFirst: number | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmt = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M`
  : n >= 1_000 ? `${(n / 1_000).toFixed(0)}k`
  : String(Math.round(n));

const daysBetween = (a: string, b: string) =>
  Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86_400_000);

function getUsd(p: RawPost) {
  return Number(p.monetization_approx ?? 0) > 0
    ? Number(p.monetization_approx)
    : Number(p.estimated_usd ?? 0);
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
    const pagePosts = (byPage.get(page.id) ?? []).sort(
      (a, b) => (a.published_at ?? "").localeCompare(b.published_at ?? "")
    );

    const firstPostDate = pagePosts[0]?.published_at?.slice(0, 10) ?? null;
    const firstPayIdx = pagePosts.findIndex((p) => getUsd(p) > 0);
    const isMonetized = firstPayIdx >= 0;
    const firstPaymentDate = isMonetized
      ? pagePosts[firstPayIdx].published_at?.slice(0, 10) ?? null
      : null;

    const prePosts = isMonetized ? pagePosts.slice(0, firstPayIdx) : pagePosts;
    const postsBeforeMonetize = prePosts.length;

    let viewsBefore = 0, reactBefore = 0, commentsBefore = 0, sharesBefore = 0, videosBefore = 0;
    for (const p of prePosts) {
      const v = Number(p.views ?? 0);
      viewsBefore += v;
      reactBefore += Number(p.reactions ?? 0);
      commentsBefore += Number(p.comments ?? 0);
      sharesBefore += Number(p.shares ?? 0);
      const t = (p.post_type ?? "").toLowerCase();
      if (t.includes("video") || t === "reel") videosBefore += 1;
    }

    const avgViewsPerPostBefore = postsBeforeMonetize > 0 ? viewsBefore / postsBeforeMonetize : 0;
    const engRateBefore = viewsBefore > 0 ? (reactBefore + commentsBefore + sharesBefore) / viewsBefore : 0;
    const videoPctBefore = postsBeforeMonetize > 0 ? (videosBefore / postsBeforeMonetize) * 100 : 0;

    const daysToMonetize =
      isMonetized && firstPostDate && firstPaymentDate
        ? daysBetween(firstPostDate, firstPaymentDate)
        : null;

    const daysSinceFirst = firstPostDate ? daysBetween(firstPostDate, today) : null;

    return {
      id: page.id,
      name: page.nome,
      isMonetized,
      firstPostDate,
      firstPaymentDate,
      daysToMonetize,
      postsBeforeMonetize,
      viewsBeforeMonetize: viewsBefore,
      avgViewsPerPostBefore,
      engRateBefore,
      videoPctBefore,
      currentPosts: pagePosts.length,
      currentViews: pagePosts.reduce((s, p) => s + Number(p.views ?? 0), 0),
      daysSinceFirst,
    };
  });
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function MonetizacaoPage() {
  const [pages, setPages] = useState<PageRow[]>([]);
  const [posts, setPosts] = useState<RawPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [usdBrl, setUsdBrl] = useState<number | null>(null);

  useEffect(() => {
    fetch("https://economia.awesomeapi.com.br/json/last/USD-BRL")
      .then((r) => r.json())
      .then((d) => setUsdBrl(parseFloat(d.USDBRL.bid)))
      .catch(() => null);
  }, []);

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

  const monetized = stats.filter((s) => s.isMonetized);
  const warming = stats.filter((s) => !s.isMonetized && s.firstPostDate);

  // Template averages from monetized pages
  const template = useMemo(() => {
    if (monetized.length === 0) return null;
    const avg = (arr: number[]) => arr.reduce((s, v) => s + v, 0) / arr.length;
    return {
      days: avg(monetized.map((m) => m.daysToMonetize ?? 0)),
      posts: avg(monetized.map((m) => m.postsBeforeMonetize)),
      views: avg(monetized.map((m) => m.viewsBeforeMonetize)),
      avgViewsPerPost: avg(monetized.map((m) => m.avgViewsPerPostBefore)),
      engRate: avg(monetized.map((m) => m.engRateBefore)),
      videoPct: avg(monetized.map((m) => m.videoPctBefore)),
    };
  }, [monetized]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground text-sm">
        Carregando dados...
      </div>
    );
  }

  return (
    <div className="space-y-8 pb-10">
      <div>
        <h1 className="text-2xl font-bold text-[#1a0533]">Monetização</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Entenda o padrão das páginas que já monetizaram e acompanhe as que estão em aquecimento.
        </p>
      </div>

      {/* ── Template cards ── */}
      {template && (
        <div>
          <h2 className="text-sm font-semibold text-[#6200b3] uppercase tracking-wider mb-3">
            Padrão das páginas monetizadas ({monetized.length} páginas)
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {[
              { icon: Clock, label: "Dias até monetizar", value: `${Math.round(template.days)} dias` },
              { icon: FileText, label: "Posts antes", value: `${Math.round(template.posts)} posts` },
              { icon: Eye, label: "Views acumuladas", value: fmt(template.views) },
              { icon: Eye, label: "Views/post médio", value: fmt(template.avgViewsPerPost) },
              { icon: TrendingUp, label: "Engajamento médio", value: `${(template.engRate * 100).toFixed(2)}%` },
              { icon: BarChart2, label: "% Vídeo/Reel", value: `${Math.round(template.videoPct)}%` },
            ].map(({ icon: Icon, label, value }) => (
              <div key={label} className="bg-white border border-[#e8e0f5] rounded-2xl p-4 shadow-sm">
                <div className="flex items-center gap-2 mb-2">
                  <div className="h-7 w-7 rounded-lg bg-[#f3e8ff] flex items-center justify-center">
                    <Icon className="h-3.5 w-3.5 text-[#6200b3]" />
                  </div>
                </div>
                <p className="text-lg font-bold text-[#1a0533]">{value}</p>
                <p className="text-[11px] text-muted-foreground mt-0.5">{label}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Warming pages ── */}
      {warming.length > 0 && template && (
        <div>
          <h2 className="text-sm font-semibold text-[#6200b3] uppercase tracking-wider mb-3">
            Em aquecimento ({warming.length} páginas)
          </h2>
          <div className="space-y-3">
            {warming
              .sort((a, b) => (b.currentViews) - (a.currentViews))
              .map((s) => {
                const postsPct = Math.min((s.currentPosts / template.posts) * 100, 100);
                const viewsPct = Math.min((s.currentViews / template.views) * 100, 100);
                const daysPct = s.daysSinceFirst ? Math.min((s.daysSinceFirst / template.days) * 100, 100) : 0;
                const overallPct = Math.round((postsPct + viewsPct + daysPct) / 3);
                const color = overallPct >= 75 ? "#16a34a" : overallPct >= 40 ? "#f59e0b" : "#6200b3";
                return (
                  <div key={s.id} className="bg-white border border-[#e8e0f5] rounded-2xl p-5 shadow-sm">
                    <div className="flex items-center justify-between mb-3 gap-4 flex-wrap">
                      <div className="flex items-center gap-2">
                        <Flame className="h-4 w-4 text-[#f59e0b]" />
                        <span className="font-semibold text-[#1a0533]">{s.name}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-bold" style={{ color }}>{overallPct}% do padrão</span>
                      </div>
                    </div>
                    <div className="w-full h-2 bg-[#f3e8ff] rounded-full mb-4">
                      <div
                        className="h-2 rounded-full transition-all"
                        style={{ width: `${overallPct}%`, backgroundColor: color }}
                      />
                    </div>
                    <div className="grid grid-cols-3 gap-3 text-center">
                      <MetricVsTemplate
                        label="Posts"
                        current={s.currentPosts}
                        target={Math.round(template.posts)}
                        format={(v) => String(v)}
                        pct={postsPct}
                      />
                      <MetricVsTemplate
                        label="Views"
                        current={s.currentViews}
                        target={Math.round(template.views)}
                        format={fmt}
                        pct={viewsPct}
                      />
                      <MetricVsTemplate
                        label="Dias ativos"
                        current={s.daysSinceFirst ?? 0}
                        target={Math.round(template.days)}
                        format={(v) => `${v}d`}
                        pct={daysPct}
                      />
                    </div>
                  </div>
                );
              })}
          </div>
        </div>
      )}

      {/* ── Monetized pages detail ── */}
      {monetized.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-[#6200b3] uppercase tracking-wider mb-3">
            Páginas monetizadas — jornada até o 1º pagamento
          </h2>
          <div className="bg-white border border-[#e8e0f5] rounded-2xl shadow-sm overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#f3e8ff] bg-[#faf5ff]">
                  {["Página", "1º post", "1º pagamento", "Dias", "Posts antes", "Views antes", "Views/post", "Engaj.", "% Vídeo"].map((h) => (
                    <th key={h} className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-[#7c6f8e]">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {monetized
                  .sort((a, b) => (a.daysToMonetize ?? 999) - (b.daysToMonetize ?? 999))
                  .map((s, i) => (
                    <tr key={s.id} className={i % 2 === 0 ? "bg-white" : "bg-[#faf5ff]"}>
                      <td className="px-4 py-3 font-medium text-[#1a0533] flex items-center gap-2">
                        <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0" />
                        {s.name}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{s.firstPostDate ? fmtDate(s.firstPostDate) : "—"}</td>
                      <td className="px-4 py-3 text-muted-foreground">{s.firstPaymentDate ? fmtDate(s.firstPaymentDate) : "—"}</td>
                      <td className="px-4 py-3 font-semibold text-[#6200b3]">{s.daysToMonetize ?? "—"}</td>
                      <td className="px-4 py-3">{s.postsBeforeMonetize}</td>
                      <td className="px-4 py-3">{fmt(s.viewsBeforeMonetize)}</td>
                      <td className="px-4 py-3">{fmt(s.avgViewsPerPostBefore)}</td>
                      <td className="px-4 py-3">{(s.engRateBefore * 100).toFixed(2)}%</td>
                      <td className="px-4 py-3">{Math.round(s.videoPctBefore)}%</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {stats.length === 0 && (
        <div className="flex flex-col items-center justify-center h-64 text-muted-foreground text-sm gap-2">
          <TrendingUp className="h-8 w-8 opacity-30" />
          <p>Nenhuma página encontrada.</p>
        </div>
      )}
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function MetricVsTemplate({
  label, current, target, format, pct,
}: {
  label: string;
  current: number;
  target: number;
  format: (v: number) => string;
  pct: number;
}) {
  const color = pct >= 75 ? "#16a34a" : pct >= 40 ? "#f59e0b" : "#6200b3";
  return (
    <div className="bg-[#faf5ff] rounded-xl p-3">
      <p className="text-[11px] text-muted-foreground mb-1">{label}</p>
      <p className="font-bold text-[#1a0533] text-sm">{format(current)}</p>
      <p className="text-[10px] mt-0.5" style={{ color }}>
        meta: {format(target)} ({Math.round(pct)}%)
      </p>
    </div>
  );
}

function fmtDate(d: string) {
  const [y, m, day] = d.split("-");
  return `${day}/${m}/${y.slice(2)}`;
}
