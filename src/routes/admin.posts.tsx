import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/app/PageHeader";
import { EmptyState } from "@/components/app/EmptyState";
import { KpiCard } from "@/components/app/KpiCard";
import { formatDateTime, formatMonth } from "@/lib/format";
import {
  FileText, Loader2, ChevronLeft, ChevronRight, DollarSign, Eye, Heart,
  Radio, Trophy, Users, TrendingUp, Activity, BarChart2, Zap, ArrowUp, ArrowDown, ChevronsUpDown,
} from "lucide-react";

const DashboardCharts = lazy(() =>
  import("@/components/app/DashboardCharts").then((m) => ({ default: m.DashboardCharts }))
);

export const Route = createFileRoute("/admin/posts")({
  head: () => ({ meta: [{ title: "Analytics - Splash Creators" }] }),
  component: PostsPage,
});

interface PostRow {
  id: string;
  page_id: string;
  external_post_id: string;
  published_at: string | null;
  title: string | null;
  views: number | null;
  reach: number | null;
  reactions: number | null;
  monetization_approx: number | null;
  estimated_usd: number | null;
  pages: { nome: string } | null;
}

interface PostAuthorRow { post_id: string; collaborator_id: string }

interface SplitRule {
  page_id: string;
  effective_from: string | null;
  collaborator_pct: number;
  active: boolean;
}

interface ColabOption { id: string; nome: string; hashtag: string | null }

interface DayData { dia: string; posts: number; views: number; alcance: number; reacoes: number; receita: number }

interface CollabSummary { id: string; nome: string; hashtag: string | null; posts: number; views: number; reacoes: number; receita: number }

interface MonthStat {
  month: string;
  posts: number;
  views: number;
  reach: number;
  reactions: number;
  revenue: number;
  rpm: number;
  avgViewsPerPost: number;
  avgRevenuePerPost: number;
  engagementRate: number;
}

type SortKey = "published_at" | "_views" | "_reach" | "_reactions" | "_revenue";
type SortDir = "asc" | "desc";

const PAGE_SIZE = 10;
const SEM_COLAB_ID = "__sem_colaborador__";

const fmt = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M`
  : n >= 1_000 ? `${(n / 1_000).toFixed(1)}k`
  : String(Math.round(n));

const fmtPct = (n: number) => `${(n * 100).toFixed(1)}%`;

async function fetchAllRows<T>(query: () => ReturnType<typeof supabase.from>): Promise<T[]> {
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

function getPostUsd(post: PostRow): number {
  const m = Number(post.monetization_approx ?? 0);
  const e = Number(post.estimated_usd ?? 0);
  return m > 0 ? m : e;
}

function getCollaboratorPct(post: PostRow, rulesByPage: Map<string, SplitRule[]>): number {
  const rules = rulesByPage.get(post.page_id) ?? [];
  if (rules.length === 0) return 1;
  const day = (post.published_at ?? "9999-12-31").slice(0, 10);
  for (const rule of rules) {
    if ((rule.effective_from ?? "0000-01-01").slice(0, 10) <= day)
      return Number(rule.collaborator_pct ?? 0) / 100;
  }
  return Number(rules[rules.length - 1]?.collaborator_pct ?? 0) / 100;
}

function ruleEffectiveDay(rule: SplitRule): string {
  return (rule.effective_from ?? "0000-01-01").slice(0, 10);
}

function SortIcon({ col, sortKey, sortDir }: { col: SortKey; sortKey: SortKey; sortDir: SortDir }) {
  if (col !== sortKey) return <ChevronsUpDown className="h-3 w-3 ml-1 text-muted-foreground/50 inline" />;
  return sortDir === "desc"
    ? <ArrowDown className="h-3 w-3 ml-1 text-orange-500 inline" />
    : <ArrowUp className="h-3 w-3 ml-1 text-orange-500 inline" />;
}

function GrowthBadge({ pct }: { pct: number | null }) {
  if (pct === null) return <span className="text-muted-foreground text-xs">—</span>;
  const positive = pct >= 0;
  return (
    <span className={`inline-flex items-center gap-0.5 text-xs font-semibold ${positive ? "text-emerald-500" : "text-red-500"}`}>
      {positive ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
      {Math.abs(pct).toFixed(0)}%
    </span>
  );
}

function PostsPage() {
  const [rows, setRows] = useState<PostRow[]>([]);
  const [postAuthors, setPostAuthors] = useState<PostAuthorRow[]>([]);
  const [splitRules, setSplitRules] = useState<SplitRule[]>([]);
  const [colabs, setColabs] = useState<ColabOption[]>([]);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [sortKey, setSortKey] = useState<SortKey>("published_at");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  useEffect(() => {
    (async () => {
      setLoading(true);
      const [posts, authors, { data: rulesData }, { data: colabsData }] = await Promise.all([
        fetchAllRows<PostRow>(() =>
          supabase
            .from("posts")
            .select("id, page_id, external_post_id, published_at, title, views, reach, reactions, monetization_approx, estimated_usd, pages(nome)")
            .order("published_at", { ascending: false })
        ),
        fetchAllRows<PostAuthorRow>(() => supabase.from("post_authors").select("post_id, collaborator_id")),
        supabase.from("split_rules").select("page_id, effective_from, collaborator_pct, active").eq("active", true),
        supabase.from("collaborators").select("id, nome, hashtag").eq("ativo", true),
      ]);
      setRows(posts);
      setPostAuthors(authors);
      setSplitRules((rulesData as SplitRule[]) ?? []);
      setColabs((colabsData as unknown as ColabOption[]) ?? []);
      setPage(1);
      setLoading(false);
    })();
  }, []);

  const analytics = useMemo(() => {
    const rulesByPage = new Map<string, SplitRule[]>();
    for (const rule of splitRules) {
      if (!rulesByPage.has(rule.page_id)) rulesByPage.set(rule.page_id, []);
      rulesByPage.get(rule.page_id)!.push(rule);
    }
    for (const [, rules] of rulesByPage) rules.sort((a, b) => ruleEffectiveDay(b).localeCompare(ruleEffectiveDay(a)));

    const postToCollabs = new Map<string, Set<string>>();
    for (const pa of postAuthors) {
      if (!postToCollabs.has(pa.post_id)) postToCollabs.set(pa.post_id, new Set());
      postToCollabs.get(pa.post_id)!.add(pa.collaborator_id);
    }

    const colabMap = new Map(colabs.map((c) => [c.id, c]));
    const collabAgg = new Map<string, CollabSummary>();
    const dayAgg = new Map<string, DayData>();
    const monthAgg = new Map<string, { posts: number; views: number; reach: number; reactions: number; revenue: number }>();

    let totalRevenue = 0, totalViews = 0, totalReach = 0, totalReactions = 0, monetizedCount = 0;

    const enriched = rows.map((post) => {
      const revenue = getPostUsd(post);
      const views = Number(post.views ?? 0);
      const reach = Number(post.reach ?? 0);
      const reactions = Number(post.reactions ?? 0);
      const collaboratorPct = getCollaboratorPct(post, rulesByPage);
      const collaboratorPool = revenue * collaboratorPct;
      const authors = Array.from(postToCollabs.get(post.id) ?? []);

      totalRevenue += revenue;
      totalViews += views;
      totalReach += reach;
      totalReactions += reactions;
      if (revenue > 0) monetizedCount++;

      if (post.published_at) {
        const dayKey = post.published_at.slice(0, 10);
        const [, month, day] = dayKey.split("-");
        const label = `${day}/${month}`;
        const cur = dayAgg.get(dayKey) ?? { dia: label, posts: 0, views: 0, alcance: 0, reacoes: 0, receita: 0 };
        cur.posts += 1; cur.views += views; cur.alcance += reach; cur.reacoes += reactions; cur.receita += revenue;
        dayAgg.set(dayKey, cur);

        const monthKey = post.published_at.slice(0, 7);
        const mc = monthAgg.get(monthKey) ?? { posts: 0, views: 0, reach: 0, reactions: 0, revenue: 0 };
        mc.posts += 1; mc.views += views; mc.reach += reach; mc.reactions += reactions; mc.revenue += revenue;
        monthAgg.set(monthKey, mc);
      }

      if (authors.length === 0) {
        const cur = collabAgg.get(SEM_COLAB_ID) ?? { id: SEM_COLAB_ID, nome: "Sem colaborador", hashtag: null, posts: 0, views: 0, reacoes: 0, receita: 0 };
        cur.posts += 1; cur.views += views; cur.reacoes += reactions; cur.receita += collaboratorPool;
        collabAgg.set(SEM_COLAB_ID, cur);
      } else {
        const share = collaboratorPool / authors.length;
        for (const cid of authors) {
          const colab = colabMap.get(cid);
          const cur = collabAgg.get(cid) ?? { id: cid, nome: colab?.nome ?? "Removido", hashtag: colab?.hashtag ?? null, posts: 0, views: 0, reacoes: 0, receita: 0 };
          cur.posts += 1; cur.views += views; cur.reacoes += reactions; cur.receita += share;
          collabAgg.set(cid, cur);
        }
      }

      return { ...post, _revenue: revenue, _views: views, _reach: reach, _reactions: reactions, _collaboratorPool: collaboratorPool };
    });

    const chartData = Array.from(dayAgg.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([, v]) => ({ ...v, receita: parseFloat(v.receita.toFixed(4)) }));

    const monthCount = monthAgg.size || 1;
    const rpm = totalViews > 0 ? (totalRevenue / totalViews) * 1000 : 0;
    const avgViewsPerPost = rows.length > 0 ? totalViews / rows.length : 0;
    const avgRevenuePerPost = rows.length > 0 ? totalRevenue / rows.length : 0;
    const avgPostsPerMonth = rows.length / monthCount;
    const avgViewsPerMonth = totalViews / monthCount;
    const engagementRate = totalViews > 0 ? totalReactions / totalViews : 0;

    // Monthly sorted desc, with MoM growth
    const monthlyArr = Array.from(monthAgg.entries())
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([month, d]): MonthStat => ({
        month,
        ...d,
        rpm: d.views > 0 ? (d.revenue / d.views) * 1000 : 0,
        avgViewsPerPost: d.posts > 0 ? d.views / d.posts : 0,
        avgRevenuePerPost: d.posts > 0 ? d.revenue / d.posts : 0,
        engagementRate: d.views > 0 ? d.reactions / d.views : 0,
      }));

    return {
      totalPosts: rows.length,
      totalRevenue, totalViews, totalReach, totalReactions, monetizedCount,
      rpm, avgViewsPerPost, avgRevenuePerPost, avgPostsPerMonth, avgViewsPerMonth, engagementRate,
      monthCount,
      chartData,
      monthlyData: monthlyArr,
      collabs: Array.from(collabAgg.values()).sort((a, b) => b.receita - a.receita),
      tableRows: enriched,
    };
  }, [rows, postAuthors, splitRules, colabs]);

  // Sorted + paginated table
  const sortedRows = useMemo(() => {
    return [...analytics.tableRows].sort((a, b) => {
      const va = (a as any)[sortKey] ?? "";
      const vb = (b as any)[sortKey] ?? "";
      const cmp = typeof va === "number" ? va - vb : String(va).localeCompare(String(vb));
      return sortDir === "desc" ? -cmp : cmp;
    });
  }, [analytics.tableRows, sortKey, sortDir]);

  const totalPages = Math.max(1, Math.ceil(analytics.totalPosts / PAGE_SIZE));
  const paginated = sortedRows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => d === "desc" ? "asc" : "desc");
    else { setSortKey(key); setSortDir("desc"); }
    setPage(1);
  };

  const getPageNumbers = () => {
    const pages: (number | "...")[] = [];
    if (totalPages <= 7) { for (let i = 1; i <= totalPages; i++) pages.push(i); }
    else {
      pages.push(1);
      if (page > 3) pages.push("...");
      for (let i = Math.max(2, page - 1); i <= Math.min(totalPages - 1, page + 1); i++) pages.push(i);
      if (page < totalPages - 2) pages.push("...");
      pages.push(totalPages);
    }
    return pages;
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Analytics"
        description="Métricas completas de receita, performance e evolução mensal."
      />

      {loading ? (
        <div className="p-10 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
      ) : analytics.totalPosts === 0 ? (
        <div className="bg-card border border-border rounded-lg p-6">
          <EmptyState icon={FileText} title="Nenhum post importado" description="Envie um CSV na aba Importações." />
        </div>
      ) : (
        <>
          {/* ── KPI row 1: totais ── */}
          <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-3">
            <KpiCard label="Receita total (USD)" value={`$${analytics.totalRevenue.toFixed(2)}`} icon={DollarSign} tone="success" />
            <KpiCard label="Total de posts" value={analytics.totalPosts.toLocaleString("pt-BR")} icon={FileText} />
            <KpiCard label="Total de views" value={fmt(analytics.totalViews)} icon={Eye} />
            <KpiCard label="Total de alcance" value={fmt(analytics.totalReach)} icon={Radio} />
            <KpiCard label="Total de reações" value={fmt(analytics.totalReactions)} icon={Heart} />
          </div>

          {/* ── KPI row 2: médias & indicadores ── */}
          <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
            <KpiCard
              label="RPM médio"
              value={`$${analytics.rpm.toFixed(3)}`}
              sub="por 1.000 views"
              icon={TrendingUp}
            />
            <KpiCard
              label="Média views/post"
              value={fmt(analytics.avgViewsPerPost)}
              icon={Eye}
            />
            <KpiCard
              label="Média receita/post"
              value={`$${analytics.avgRevenuePerPost.toFixed(3)}`}
              icon={DollarSign}
            />
            <KpiCard
              label="Média posts/mês"
              value={analytics.avgPostsPerMonth.toFixed(1)}
              sub={`${analytics.monthCount} meses`}
              icon={BarChart2}
            />
            <KpiCard
              label="Média views/mês"
              value={fmt(analytics.avgViewsPerMonth)}
              icon={Activity}
            />
            <KpiCard
              label="Taxa de engajamento"
              value={fmtPct(analytics.engagementRate)}
              sub={`${analytics.monetizedCount} posts monetizados`}
              icon={Zap}
            />
          </div>

          {/* ── Gráfico diário ── */}
          {analytics.chartData.length > 0 && (
            <Suspense fallback={<div className="h-48 bg-muted/30 rounded-lg animate-pulse" />}>
              <DashboardCharts data={analytics.chartData} />
            </Suspense>
          )}

          {/* ── Evolução mensal ── */}
          {analytics.monthlyData.length > 0 && (
            <div className="bg-card border border-border rounded-xl overflow-hidden">
              <div className="px-5 py-4 border-b border-border">
                <h2 className="font-semibold text-sm">Evolução mensal</h2>
                <p className="text-xs text-muted-foreground mt-0.5">Comparativo mês a mês — {analytics.monthlyData.length} meses com dados</p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
                    <tr>
                      <th className="text-left px-5 py-3 font-medium">Mês</th>
                      <th className="text-right px-4 py-3 font-medium">Posts</th>
                      <th className="text-right px-4 py-3 font-medium">Views</th>
                      <th className="text-right px-4 py-3 font-medium">Receita (USD)</th>
                      <th className="text-right px-4 py-3 font-medium">RPM</th>
                      <th className="text-right px-4 py-3 font-medium">Avg Views/Post</th>
                      <th className="text-right px-4 py-3 font-medium">Avg Rec/Post</th>
                      <th className="text-right px-4 py-3 font-medium">Engajamento</th>
                      <th className="text-right px-4 py-3 font-medium">MoM Views</th>
                      <th className="text-right px-4 py-3 font-medium">MoM Receita</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {analytics.monthlyData.map((m, idx) => {
                      const prev = analytics.monthlyData[idx + 1];
                      const momViews = prev && prev.views > 0 ? ((m.views - prev.views) / prev.views) * 100 : null;
                      const momRev = prev && prev.revenue > 0 ? ((m.revenue - prev.revenue) / prev.revenue) * 100 : null;
                      return (
                        <tr key={m.month} className="hover:bg-muted/20">
                          <td className="px-5 py-3 font-medium">{formatMonth(m.month)}</td>
                          <td className="px-4 py-3 text-right tabular-nums">{m.posts}</td>
                          <td className="px-4 py-3 text-right tabular-nums">{fmt(m.views)}</td>
                          <td className="px-4 py-3 text-right tabular-nums font-semibold text-emerald-600">${m.revenue.toFixed(2)}</td>
                          <td className="px-4 py-3 text-right tabular-nums">${m.rpm.toFixed(3)}</td>
                          <td className="px-4 py-3 text-right tabular-nums">{fmt(m.avgViewsPerPost)}</td>
                          <td className="px-4 py-3 text-right tabular-nums">${m.avgRevenuePerPost.toFixed(3)}</td>
                          <td className="px-4 py-3 text-right tabular-nums">{fmtPct(m.engagementRate)}</td>
                          <td className="px-4 py-3 text-right"><GrowthBadge pct={momViews} /></td>
                          <td className="px-4 py-3 text-right"><GrowthBadge pct={momRev} /></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ── Colaboradores ── */}
          <div className="bg-card border border-border rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-border">
              <h2 className="font-semibold text-sm">Colaboradores (split)</h2>
            </div>
            <div className="sm:hidden divide-y divide-border">
              {analytics.collabs.slice(0, 20).map((c) => (
                <div key={c.id} className="flex items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <p className="font-medium text-sm truncate">{c.nome}</p>
                    <p className="text-xs text-muted-foreground">{c.hashtag ? `#${c.hashtag}` : "—"} · {c.posts} posts · {fmt(c.views)} views</p>
                  </div>
                  <p className="font-semibold text-emerald-600 tabular-nums shrink-0">${c.receita.toFixed(2)}</p>
                </div>
              ))}
            </div>
            <div className="hidden sm:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="text-left px-5 py-3 font-medium">Colaborador</th>
                    <th className="text-right px-4 py-3 font-medium">Posts</th>
                    <th className="text-right px-4 py-3 font-medium">Views</th>
                    <th className="text-right px-4 py-3 font-medium">Avg Views/Post</th>
                    <th className="text-right px-4 py-3 font-medium">Reações</th>
                    <th className="text-right px-4 py-3 font-medium">Engajamento</th>
                    <th className="text-right px-4 py-3 font-medium">Ganhos (USD)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {analytics.collabs.slice(0, 25).map((c) => (
                    <tr key={c.id} className="hover:bg-muted/20">
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-2">
                          <Users className="h-4 w-4 text-muted-foreground shrink-0" />
                          <div>
                            <p className="font-medium">{c.nome}</p>
                            <p className="text-xs text-muted-foreground">{c.hashtag ? `#${c.hashtag}` : "—"}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">{c.posts}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{fmt(c.views)}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{c.posts > 0 ? fmt(c.views / c.posts) : "—"}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{fmt(c.reacoes)}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{c.views > 0 ? fmtPct(c.reacoes / c.views) : "—"}</td>
                      <td className="px-4 py-3 text-right tabular-nums font-semibold text-emerald-600">${c.receita.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* ── Tabela de posts (com sort) ── */}
          <div className="bg-card border border-border rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-border flex items-center justify-between gap-2">
              <div>
                <h2 className="font-semibold text-sm">Tabela de posts</h2>
                <p className="text-xs text-muted-foreground mt-0.5">Clique nos cabeçalhos para ordenar</p>
              </div>
              <div className="hidden sm:inline-flex text-xs text-muted-foreground items-center gap-1">
                <Trophy className="h-3 w-3" /> monetization_approx / estimated_usd
              </div>
            </div>

            <div className="sm:hidden divide-y divide-border">
              {paginated.map((r) => (
                <div key={r.id} className="px-4 py-3 space-y-1">
                  <p className="text-sm font-medium line-clamp-1">{r.title ?? r.external_post_id}</p>
                  <p className="text-xs text-muted-foreground">{r.pages?.nome ?? "—"} · {formatDateTime(r.published_at)}</p>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    <span>{fmt(r._views)} views</span>
                    <span>{fmt(r._reactions)} reações</span>
                    <span className="font-semibold text-emerald-600 text-sm ml-auto">${r._revenue.toFixed(2)}</span>
                  </div>
                </div>
              ))}
            </div>

            <div className="hidden sm:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="text-left px-5 py-3 font-medium">Post</th>
                    <th className="text-left px-4 py-3 font-medium">Página</th>
                    <th className="text-left px-4 py-3 font-medium cursor-pointer select-none hover:text-foreground" onClick={() => toggleSort("published_at")}>
                      Publicado <SortIcon col="published_at" sortKey={sortKey} sortDir={sortDir} />
                    </th>
                    <th className="text-right px-4 py-3 font-medium cursor-pointer select-none hover:text-foreground" onClick={() => toggleSort("_reach")}>
                      Alcance <SortIcon col="_reach" sortKey={sortKey} sortDir={sortDir} />
                    </th>
                    <th className="text-right px-4 py-3 font-medium cursor-pointer select-none hover:text-foreground" onClick={() => toggleSort("_views")}>
                      Views <SortIcon col="_views" sortKey={sortKey} sortDir={sortDir} />
                    </th>
                    <th className="text-right px-4 py-3 font-medium cursor-pointer select-none hover:text-foreground" onClick={() => toggleSort("_reactions")}>
                      Reações <SortIcon col="_reactions" sortKey={sortKey} sortDir={sortDir} />
                    </th>
                    <th className="text-right px-4 py-3 font-medium cursor-pointer select-none hover:text-foreground" onClick={() => toggleSort("_revenue")}>
                      Receita (USD) <SortIcon col="_revenue" sortKey={sortKey} sortDir={sortDir} />
                    </th>
                    <th className="text-right px-4 py-3 font-medium">Split colab</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {paginated.map((r) => (
                    <tr key={r.id} className="hover:bg-muted/20">
                      <td className="px-5 py-3 max-w-[220px] truncate">{r.title ?? r.external_post_id}</td>
                      <td className="px-4 py-3 text-muted-foreground">{r.pages?.nome ?? "—"}</td>
                      <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{formatDateTime(r.published_at)}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{r._reach.toLocaleString("pt-BR")}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{r._views.toLocaleString("pt-BR")}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{r._reactions.toLocaleString("pt-BR")}</td>
                      <td className="px-4 py-3 text-right tabular-nums font-semibold">${r._revenue.toFixed(2)}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-emerald-600">${r._collaboratorPool.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-between px-5 py-4 border-t border-border text-sm">
              <span className="text-muted-foreground text-xs sm:text-sm">
                {analytics.totalPosts.toLocaleString("pt-BR")} posts · p. {page}/{totalPages}
              </span>
              <div className="flex items-center gap-1">
                <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}
                  className="p-2 rounded-lg hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed">
                  <ChevronLeft className="h-4 w-4" />
                </button>
                {getPageNumbers().map((p, i) =>
                  p === "..." ? (
                    <span key={`dots-${i}`} className="px-1.5 text-muted-foreground text-xs">…</span>
                  ) : (
                    <button key={p} onClick={() => setPage(p as number)}
                      className={`min-w-[36px] h-9 rounded-lg px-2 text-sm font-medium transition-colors ${page === p ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}>
                      {p}
                    </button>
                  )
                )}
                <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages}
                  className="p-2 rounded-lg hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed">
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
