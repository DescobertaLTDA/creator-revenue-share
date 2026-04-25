import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/app/PageHeader";
import { EmptyState } from "@/components/app/EmptyState";
import { KpiCard } from "@/components/app/KpiCard";
import { formatDateTime } from "@/lib/format";
import { FileText, Loader2, ChevronLeft, ChevronRight, DollarSign, Eye, Heart, Radio, Trophy, Users } from "lucide-react";

const DashboardCharts = lazy(() =>
  import("@/components/app/DashboardCharts").then((m) => ({ default: m.DashboardCharts }))
);

export const Route = createFileRoute("/admin/posts")({
  head: () => ({ meta: [{ title: "Posts - Rateio Creator" }] }),
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

interface ColabOption {
  id: string;
  nome: string;
  hashtag: string | null;
}

interface DayData {
  dia: string;
  posts: number;
  views: number;
  alcance: number;
  reacoes: number;
  receita: number;
}

interface CollabSummary {
  id: string;
  nome: string;
  hashtag: string | null;
  posts: number;
  views: number;
  reacoes: number;
  receita: number;
}

const PAGE_SIZE = 10;
const SEM_COLAB_ID = "__sem_colaborador__";

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

function getPostUsd(post: PostRow): number {
  const monetizationApprox = Number(post.monetization_approx ?? 0);
  const estimatedUsd = Number(post.estimated_usd ?? 0);
  return monetizationApprox > 0 ? monetizationApprox : estimatedUsd;
}

function getCollaboratorPct(post: PostRow, rulesByPage: Map<string, SplitRule[]>): number {
  const rules = rulesByPage.get(post.page_id) ?? [];
  if (rules.length === 0) return 0;
  const publishedDay = (post.published_at ?? "9999-12-31").slice(0, 10);
  for (const rule of rules) {
    const effectiveDay = (rule.effective_from ?? "0000-01-01").slice(0, 10);
    if (effectiveDay <= publishedDay) {
      return Number(rule.collaborator_pct ?? 0) / 100;
    }
  }
  // Fallback: se todas as regras comecam apos o post, aplica a mais antiga ativa.
  return Number(rules[rules.length - 1]?.collaborator_pct ?? 0) / 100;
}


function ruleEffectiveDay(rule: SplitRule): string {
  return (rule.effective_from ?? "0000-01-01").slice(0, 10);
}function PostsPage() {
  const [rows, setRows] = useState<PostRow[]>([]);
  const [postAuthors, setPostAuthors] = useState<PostAuthorRow[]>([]);
  const [splitRules, setSplitRules] = useState<SplitRule[]>([]);
  const [colabs, setColabs] = useState<ColabOption[]>([]);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);

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
        fetchAllRows<PostAuthorRow>(() =>
          supabase.from("post_authors").select("post_id, collaborator_id")
        ),
        supabase
          .from("split_rules")
          .select("page_id, effective_from, collaborator_pct, active")
          .eq("active", true),
        supabase.from("collaborators").select("id, nome, hashtag").eq("ativo", true),
      ]);

      setRows(posts);
      setPostAuthors(authors);
      setSplitRules((rulesData as SplitRule[]) ?? []);
      setColabs((colabsData as ColabOption[]) ?? []);
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
    for (const [, rules] of rulesByPage) {
      rules.sort((a, b) => ruleEffectiveDay(b).localeCompare(ruleEffectiveDay(a)));
    }

    const postToCollabs = new Map<string, Set<string>>();
    for (const pa of postAuthors) {
      if (!postToCollabs.has(pa.post_id)) postToCollabs.set(pa.post_id, new Set());
      postToCollabs.get(pa.post_id)!.add(pa.collaborator_id);
    }

    const colabMap = new Map(colabs.map((c) => [c.id, c]));
    const collabAgg = new Map<string, CollabSummary>();

    const dayAgg = new Map<string, DayData>();

    let totalRevenue = 0;
    let totalViews = 0;
    let totalReach = 0;
    let totalReactions = 0;

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

      if (post.published_at) {
        const dayKey = post.published_at.slice(0, 10);
        const [, month, day] = dayKey.split("-");
        const label = `${day}/${month}`;
        const current = dayAgg.get(dayKey) ?? {
          dia: label,
          posts: 0,
          views: 0,
          alcance: 0,
          reacoes: 0,
          receita: 0,
        };
        current.posts += 1;
        current.views += views;
        current.alcance += reach;
        current.reacoes += reactions;
        current.receita += revenue;
        dayAgg.set(dayKey, current);
      }

      if (authors.length === 0) {
        const current = collabAgg.get(SEM_COLAB_ID) ?? {
          id: SEM_COLAB_ID,
          nome: "Sem colaborador",
          hashtag: null,
          posts: 0,
          views: 0,
          reacoes: 0,
          receita: 0,
        };
        current.posts += 1;
        current.views += views;
        current.reacoes += reactions;
        current.receita += collaboratorPool;
        collabAgg.set(SEM_COLAB_ID, current);
      } else {
        const share = collaboratorPool / authors.length;
        for (const collaboratorId of authors) {
          const colab = colabMap.get(collaboratorId);
          const current = collabAgg.get(collaboratorId) ?? {
            id: collaboratorId,
            nome: colab?.nome ?? "Colaborador removido",
            hashtag: colab?.hashtag ?? null,
            posts: 0,
            views: 0,
            reacoes: 0,
            receita: 0,
          };
          current.posts += 1;
          current.views += views;
          current.reacoes += reactions;
          current.receita += share;
          collabAgg.set(collaboratorId, current);
        }
      }

      return {
        ...post,
        _revenue: revenue,
        _views: views,
        _reach: reach,
        _reactions: reactions,
        _collaboratorPool: collaboratorPool,
      };
    });

    const chartData = Array.from(dayAgg.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([, value]) => ({ ...value, receita: parseFloat(value.receita.toFixed(4)) }));

    const byRevenue = [...enriched].sort((a, b) => b._revenue - a._revenue);
    const byViews = [...enriched].sort((a, b) => b._views - a._views);
    const byReactions = [...enriched].sort((a, b) => b._reactions - a._reactions);

    return {
      totalPosts: rows.length,
      totalRevenue,
      totalViews,
      totalReach,
      totalReactions,
      chartData,
      topRevenue: byRevenue.slice(0, 5),
      topViews: byViews.slice(0, 5),
      topReactions: byReactions.slice(0, 5),
      collabs: Array.from(collabAgg.values()).sort((a, b) => b.receita - a.receita),
      tableRows: enriched,
    };
  }, [rows, postAuthors, splitRules, colabs]);

  const totalPages = Math.max(1, Math.ceil(analytics.totalPosts / PAGE_SIZE));
  const paginated = analytics.tableRows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const getPageNumbers = () => {
    const pages: (number | "...")[] = [];
    if (totalPages <= 7) {
      for (let i = 1; i <= totalPages; i++) pages.push(i);
    } else {
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
        title="Posts"
        description="Dashboard completo com receita, desempenho e ranking de posts e colaboradores."
      />

      {loading ? (
        <div className="p-10 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground"/></div>
      ) : analytics.totalPosts === 0 ? (
        <div className="bg-card border border-border rounded-lg p-6">
          <EmptyState icon={FileText} title="Nenhum post importado" description="Envie um CSV na aba Importacoes."/>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-3 sm:gap-4">
            <KpiCard label="Receita total (USD)" value={`$${analytics.totalRevenue.toFixed(2)}`} icon={DollarSign} tone="success" />
            <KpiCard label="Total de posts" value={analytics.totalPosts.toLocaleString("pt-BR")} icon={FileText} />
            <KpiCard label="Total de views" value={fmt(analytics.totalViews)} icon={Eye} />
            <KpiCard label="Total de alcance" value={fmt(analytics.totalReach)} icon={Radio} />
            <KpiCard label="Total de reacoes" value={fmt(analytics.totalReactions)} icon={Heart} />
          </div>

          {analytics.chartData.length > 0 && (
            <Suspense fallback={<div className="h-48 bg-muted/30 rounded-lg animate-pulse" />}>
              <DashboardCharts data={analytics.chartData} />
            </Suspense>
          )}

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-card border border-border rounded-lg p-5">
              <h2 className="font-medium mb-3">Top 5 por receita</h2>
              <div className="space-y-3">
                {analytics.topRevenue.map((post, idx) => (
                  <div key={post.id} className="border border-border rounded-lg p-3">
                    <p className="text-xs text-muted-foreground">#{idx + 1}</p>
                    <p className="text-sm font-medium line-clamp-2">{post.title ?? post.external_post_id}</p>
                    <p className="text-xs text-muted-foreground mt-1">{post.pages?.nome ?? "-"} • {formatDateTime(post.published_at)}</p>
                    <p className="text-sm font-semibold text-[#16a34a] mt-1">${post._revenue.toFixed(2)}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-card border border-border rounded-lg p-5">
              <h2 className="font-medium mb-3">Top 5 por views</h2>
              <div className="space-y-3">
                {analytics.topViews.map((post, idx) => (
                  <div key={post.id} className="border border-border rounded-lg p-3">
                    <p className="text-xs text-muted-foreground">#{idx + 1}</p>
                    <p className="text-sm font-medium line-clamp-2">{post.title ?? post.external_post_id}</p>
                    <p className="text-xs text-muted-foreground mt-1">{post.pages?.nome ?? "-"}</p>
                    <p className="text-sm font-semibold mt-1">{post._views.toLocaleString("pt-BR")} views</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-card border border-border rounded-lg p-5">
              <h2 className="font-medium mb-3">Top 5 por reacoes</h2>
              <div className="space-y-3">
                {analytics.topReactions.map((post, idx) => (
                  <div key={post.id} className="border border-border rounded-lg p-3">
                    <p className="text-xs text-muted-foreground">#{idx + 1}</p>
                    <p className="text-sm font-medium line-clamp-2">{post.title ?? post.external_post_id}</p>
                    <p className="text-xs text-muted-foreground mt-1">{post.pages?.nome ?? "-"}</p>
                    <p className="text-sm font-semibold mt-1">{post._reactions.toLocaleString("pt-BR")} reacoes</p>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="bg-card border border-border rounded-lg overflow-hidden">
            <div className="px-4 sm:px-5 py-4 border-b border-border">
              <h2 className="font-medium">Colaboradores (split)</h2>
            </div>
            {/* Mobile card view */}
            <div className="sm:hidden divide-y divide-border">
              {analytics.collabs.slice(0, 20).map((collab) => (
                <div key={collab.id} className="flex items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <p className="font-medium text-sm truncate">{collab.nome}</p>
                    <p className="text-xs text-muted-foreground">{collab.hashtag ? `#${collab.hashtag}` : "Sem hashtag"} · {collab.posts} posts · {fmt(collab.views)} views</p>
                  </div>
                  <p className="font-semibold text-[#16a34a] tabular-nums shrink-0">${collab.receita.toFixed(2)}</p>
                </div>
              ))}
            </div>
            {/* Desktop table */}
            <div className="hidden sm:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="text-left px-5 py-3 font-medium">Colaborador</th>
                    <th className="text-right px-5 py-3 font-medium">Posts</th>
                    <th className="text-right px-5 py-3 font-medium">Views</th>
                    <th className="text-right px-5 py-3 font-medium">Reações</th>
                    <th className="text-right px-5 py-3 font-medium">Ganhos (USD)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {analytics.collabs.slice(0, 20).map((collab) => (
                    <tr key={collab.id}>
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-2">
                          <Users className="h-4 w-4 text-muted-foreground" />
                          <div>
                            <p className="font-medium">{collab.nome}</p>
                            <p className="text-xs text-muted-foreground">{collab.hashtag ? `#${collab.hashtag}` : "Sem hashtag"}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-3 text-right tabular-nums">{collab.posts.toLocaleString("pt-BR")}</td>
                      <td className="px-5 py-3 text-right tabular-nums">{collab.views.toLocaleString("pt-BR")}</td>
                      <td className="px-5 py-3 text-right tabular-nums">{collab.reacoes.toLocaleString("pt-BR")}</td>
                      <td className="px-5 py-3 text-right tabular-nums font-semibold text-[#16a34a]">${collab.receita.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="bg-card border border-border rounded-lg overflow-hidden">
            <div className="px-4 sm:px-5 py-4 border-b border-border flex items-center justify-between gap-2">
              <h2 className="font-medium">Tabela de posts</h2>
              <div className="hidden sm:inline-flex text-xs text-muted-foreground items-center gap-1">
                <Trophy className="h-3 w-3" /> monetization_approx
              </div>
            </div>

            {/* Mobile card list */}
            <div className="sm:hidden divide-y divide-border">
              {paginated.map((r) => (
                <div key={r.id} className="px-4 py-3 space-y-1">
                  <p className="text-sm font-medium line-clamp-1">{r.title ?? r.external_post_id}</p>
                  <p className="text-xs text-muted-foreground">{r.pages?.nome ?? "-"} · {formatDateTime(r.published_at)}</p>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    <span>{fmt(r._views)} views</span>
                    <span>{fmt(r._reactions)} reações</span>
                    <span className="font-semibold text-[#16a34a] text-sm ml-auto">${r._revenue.toFixed(2)}</span>
                  </div>
                </div>
              ))}
            </div>

            {/* Desktop table */}
            <div className="hidden sm:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="text-left px-5 py-3 font-medium">Post</th>
                    <th className="text-left px-5 py-3 font-medium">Página</th>
                    <th className="text-left px-5 py-3 font-medium">Publicado</th>
                    <th className="text-right px-5 py-3 font-medium">Alcance</th>
                    <th className="text-right px-5 py-3 font-medium">Views</th>
                    <th className="text-right px-5 py-3 font-medium">Reações</th>
                    <th className="text-right px-5 py-3 font-medium">Receita (USD)</th>
                    <th className="text-right px-5 py-3 font-medium">Split colab</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {paginated.map((r) => (
                    <tr key={r.id} className="hover:bg-muted/20">
                      <td className="px-5 py-3 max-w-[240px] truncate">{r.title ?? r.external_post_id}</td>
                      <td className="px-5 py-3 text-muted-foreground">{r.pages?.nome ?? "-"}</td>
                      <td className="px-5 py-3 text-muted-foreground">{formatDateTime(r.published_at)}</td>
                      <td className="px-5 py-3 text-right tabular-nums">{r._reach.toLocaleString("pt-BR")}</td>
                      <td className="px-5 py-3 text-right tabular-nums">{r._views.toLocaleString("pt-BR")}</td>
                      <td className="px-5 py-3 text-right tabular-nums">{r._reactions.toLocaleString("pt-BR")}</td>
                      <td className="px-5 py-3 text-right tabular-nums">${r._revenue.toFixed(2)}</td>
                      <td className="px-5 py-3 text-right tabular-nums text-[#16a34a]">${r._collaboratorPool.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-between px-4 sm:px-5 py-4 border-t border-border text-sm">
              <span className="text-muted-foreground text-xs sm:text-sm">
                {analytics.totalPosts.toLocaleString("pt-BR")} posts · p. {page}/{totalPages}
              </span>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="p-2 rounded-lg hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>

                {getPageNumbers().map((p, i) =>
                  p === "..." ? (
                    <span key={`dots-${i}`} className="px-1.5 text-muted-foreground text-xs">…</span>
                  ) : (
                    <button
                      key={p}
                      onClick={() => setPage(p as number)}
                      className={`min-w-[36px] h-9 rounded-lg px-2 text-sm font-medium transition-colors ${
                        page === p ? "bg-primary text-primary-foreground" : "hover:bg-muted text-foreground"
                      }`}
                    >
                      {p}
                    </button>
                  )
                )}

                <button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                  className="p-2 rounded-lg hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed"
                >
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

