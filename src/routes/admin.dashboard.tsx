import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState, useMemo, lazy, Suspense, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/app/PageHeader";
import { KpiCard } from "@/components/app/KpiCard";
import { StatusBadge } from "@/components/app/StatusBadge";
import { EmptyState } from "@/components/app/EmptyState";
import { formatBRL, formatDateTime, formatMonth } from "@/lib/format";
import { DollarSign, Wallet, FileSpreadsheet, ArrowRight, TrendingUp, Eye, Heart } from "lucide-react";

const DashboardCharts = lazy(() =>
  import("@/components/app/DashboardCharts").then((m) => ({ default: m.DashboardCharts }))
);

export const Route = createFileRoute("/admin/dashboard")({
  head: () => ({ meta: [{ title: "Dashboard — Rateio Creator" }] }),
  component: AdminDashboard,
});

interface RecentImport {
  id: string;
  file_name: string;
  status: string;
  created_at: string;
  valid_rows: number;
  total_rows: number;
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
}

interface PostAuthorRow {
  post_id: string;
  collaborator_id: string;
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

const fmt = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M`
  : n >= 1_000 ? `${(n / 1_000).toFixed(1)}k`
  : String(n);

async function fetchAllRows<T>(
  query: () => ReturnType<typeof supabase.from>
): Promise<T[]> {
  const PAGE = 5000;
  let from = 0;
  const all: T[] = [];
  while (true) {
    const { data, error } = await (query() as any).range(from, from + PAGE - 1);
    if (error || !data || data.length === 0) break;
    all.push(...data);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return all;
}

function fetchUsdBrl(): Promise<number | null> {
  return fetch("https://economia.awesomeapi.com.br/json/last/USD-BRL")
    .then((r) => r.json())
    .then((d) => parseFloat(d.USDBRL.bid))
    .catch(() => null);
}

function AdminDashboard() {
  const [loading, setLoading] = useState(true);
  const [allPosts, setAllPosts] = useState<RawPost[]>([]);
  const [postAuthors, setPostAuthors] = useState<PostAuthorRow[]>([]);
  const [pages, setPages] = useState<PageOption[]>([]);
  const [colabs, setColabs] = useState<ColabOption[]>([]);
  const [recentImports, setRecentImports] = useState<RecentImport[]>([]);
  const [usdBrl, setUsdBrl] = useState<number | null>(null);
  const [usdUpdated, setUsdUpdated] = useState<Date | null>(null);

  // Filters
  const [filterPage, setFilterPage] = useState("all");
  const [filterColab, setFilterColab] = useState("all");
  const [filterFrom, setFilterFrom] = useState("");
  const [filterTo, setFilterTo] = useState("");

  const usdIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Load USD and poll every 60s
  useEffect(() => {
    const load = () =>
      fetchUsdBrl().then((v) => {
        if (v) { setUsdBrl(v); setUsdUpdated(new Date()); }
      });
    load();
    usdIntervalRef.current = setInterval(load, 60_000);
    return () => { if (usdIntervalRef.current) clearInterval(usdIntervalRef.current); };
  }, []);

  // Load all data
  useEffect(() => {
    const load = async () => {
      const [posts, pas, { data: pagesData }, { data: colabsData }, { data: imports }] =
        await Promise.all([
          fetchAllRows<RawPost>(() =>
            supabase
              .from("posts")
              .select("id, page_id, published_at, monetization_approx, estimated_usd, views, reach, reactions")
          ),
          fetchAllRows<PostAuthorRow>(() =>
            supabase.from("post_authors").select("post_id, collaborator_id")
          ),
          supabase.from("pages").select("id, nome"),
          supabase.from("collaborators").select("id, nome, hashtag").eq("ativo", true),
          supabase
            .from("csv_imports")
            .select("id, file_name, status, created_at, valid_rows, total_rows")
            .order("created_at", { ascending: false })
            .limit(5),
        ]);

      setAllPosts(posts);
      setPostAuthors(pas);
      setPages((pagesData ?? []).map((p: any) => ({ id: p.id, name: p.nome })));
      setColabs((colabsData ?? []).map((c: any) => ({ id: c.id, nome: c.nome, hashtag: c.hashtag })));
      setRecentImports((imports ?? []) as RecentImport[]);
      setLoading(false);
    };
    load();
  }, []);

  // Client-side filtering + aggregation
  const { kpis, chartData, activeMonthRef } = useMemo(() => {
    const colabPostIds =
      filterColab !== "all"
        ? new Set(postAuthors.filter((pa) => pa.collaborator_id === filterColab).map((pa) => pa.post_id))
        : null;

    const filtered = allPosts.filter((p) => {
      if (filterPage !== "all" && p.page_id !== filterPage) return false;
      if (colabPostIds && !colabPostIds.has(p.id)) return false;
      if (filterFrom && p.published_at && p.published_at.slice(0, 10) < filterFrom) return false;
      if (filterTo && p.published_at && p.published_at.slice(0, 10) > filterTo) return false;
      return true;
    });

    const byMonth: Record<string, number> = {};
    const byDay: Record<string, DayData> = {};
    let geralUsd = 0;
    let viewsSum = 0;
    let reacoesSum = 0;

    for (const p of filtered) {
      const monetizationApprox = Number(p.monetization_approx ?? 0);
      const estimatedUsd = Number(p.estimated_usd ?? 0);
      const val = monetizationApprox > 0 ? monetizationApprox : estimatedUsd;
      const views = Number(p.views ?? 0);
      const reacoes = Number(p.reactions ?? 0);
      const reach = Number(p.reach ?? 0);
      geralUsd += val;
      viewsSum += views;
      reacoesSum += reacoes;

      if (p.published_at) {
        const m = p.published_at.slice(0, 7);
        byMonth[m] = (byMonth[m] ?? 0) + val;

        const dayKey = p.published_at.slice(0, 10);
        const [, month, day] = dayKey.split("-");
        const label = `${day}/${month}`;
        if (!byDay[dayKey]) {
          byDay[dayKey] = { dia: label, posts: 0, views: 0, alcance: 0, reacoes: 0, receita: 0 };
        }
        byDay[dayKey].posts += 1;
        byDay[dayKey].views += views;
        byDay[dayKey].alcance += reach;
        byDay[dayKey].reacoes += reacoes;
        byDay[dayKey].receita += val;
      }
    }

    const sortedMonths = Object.entries(byMonth).sort((a, b) => b[0].localeCompare(a[0]));
    const latestMonth = sortedMonths[0]?.[0] ?? new Date().toISOString().slice(0, 7);

    const chart = Object.entries(byDay)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([, v]) => ({ ...v, receita: parseFloat(v.receita.toFixed(4)) }));

    return {
      kpis: {
        totalMonth: byMonth[latestMonth] ?? 0,
        totalGeral: geralUsd,
        totalPosts: filtered.length,
        totalViews: viewsSum,
        totalReacoes: reacoesSum,
      },
      chartData: chart,
      activeMonthRef: latestMonth,
    };
  }, [allPosts, postAuthors, filterPage, filterColab, filterFrom, filterTo]);

  const { totalMonth, totalGeral, totalPosts, totalViews, totalReacoes } = kpis;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <PageHeader
          title="Dashboard"
          description={`Visão geral — ${activeMonthRef ? formatMonth(activeMonthRef) : "…"}`}
        />
        {usdBrl && (
          <div className="text-right text-sm mt-1 shrink-0">
            <span className="text-muted-foreground text-xs">Dólar agora</span>
            <p className="font-semibold text-lg leading-tight">{formatBRL(usdBrl)}</p>
            {usdUpdated && (
              <p className="text-[10px] text-muted-foreground">
                atualizado {usdUpdated.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
              </p>
            )}
          </div>
        )}
      </div>

      {/* Filters */}
      <div className="bg-card border border-border rounded-xl px-4 py-3 flex flex-wrap gap-3 items-end">
        <div className="flex flex-col gap-1">
          <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Página</label>
          <select
            value={filterPage}
            onChange={(e) => setFilterPage(e.target.value)}
            className="h-8 rounded-md border border-input bg-background px-2 text-sm min-w-[140px]"
          >
            <option value="all">Todas as páginas</option>
            {pages.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Colaborador</label>
          <select
            value={filterColab}
            onChange={(e) => setFilterColab(e.target.value)}
            className="h-8 rounded-md border border-input bg-background px-2 text-sm min-w-[160px]"
          >
            <option value="all">Todos</option>
            {colabs.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nome}{c.hashtag ? ` (#${c.hashtag})` : ""}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">De</label>
          <input
            type="date"
            value={filterFrom}
            onChange={(e) => setFilterFrom(e.target.value)}
            className="h-8 rounded-md border border-input bg-background px-2 text-sm"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Até</label>
          <input
            type="date"
            value={filterTo}
            onChange={(e) => setFilterTo(e.target.value)}
            className="h-8 rounded-md border border-input bg-background px-2 text-sm"
          />
        </div>
        {(filterPage !== "all" || filterColab !== "all" || filterFrom || filterTo) && (
          <button
            onClick={() => { setFilterPage("all"); setFilterColab("all"); setFilterFrom(""); setFilterTo(""); }}
            className="h-8 px-3 rounded-md text-xs border border-border hover:bg-muted transition-colors"
          >
            Limpar filtros
          </button>
        )}
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          label="Receita do mês (USD)"
          value={loading ? "…" : `$${totalMonth.toFixed(2)}`}
          hint={usdBrl ? `≈ ${formatBRL(totalMonth * usdBrl)}` : undefined}
          icon={DollarSign}
          tone="success"
        />
        <KpiCard
          label="Receita total (USD)"
          value={loading ? "…" : `$${totalGeral.toFixed(2)}`}
          hint={usdBrl ? `≈ ${formatBRL(totalGeral * usdBrl)}` : undefined}
          icon={Wallet}
          tone="warning"
        />
        <KpiCard label="Total de views" value={loading ? "…" : fmt(totalViews)} icon={Eye} />
        <KpiCard label="Total de reações" value={loading ? "…" : fmt(totalReacoes)} icon={Heart} />
      </div>

      {/* Posts count + BRL total */}
      {!loading && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="bg-card border border-border rounded-xl p-4 flex items-center justify-between">
            <div>
              <p className="text-xs uppercase text-muted-foreground font-medium tracking-widest">Posts no filtro</p>
              <p className="text-2xl font-bold mt-1">{totalPosts.toLocaleString("pt-BR")}</p>
              {allPosts.length !== totalPosts && (
                <p className="text-xs text-muted-foreground">{allPosts.length.toLocaleString("pt-BR")} no total</p>
              )}
            </div>
            <TrendingUp className="h-8 w-8 text-[#16a34a] opacity-60" />
          </div>
          {usdBrl && (
            <div className="bg-card border border-border rounded-xl p-4 flex items-center justify-between">
              <div>
                <p className="text-xs uppercase text-muted-foreground font-medium tracking-widest">Total em BRL (cotação atual)</p>
                <p className="text-2xl font-bold mt-1">{formatBRL(totalGeral * usdBrl)}</p>
                <p className="text-xs text-muted-foreground mt-0.5">USD 1 = {formatBRL(usdBrl)}</p>
              </div>
              <DollarSign className="h-8 w-8 text-[#16a34a] opacity-60" />
            </div>
          )}
        </div>
      )}

      {/* Gráficos */}
      {!loading && chartData.length > 0 && (
        <Suspense fallback={<div className="h-48 bg-muted/30 rounded-xl animate-pulse" />}>
          <DashboardCharts data={chartData} />
        </Suspense>
      )}

      {/* Importações recentes */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 className="font-medium">Importações recentes</h2>
          <Link to="/admin/importacoes" className="text-xs text-primary hover:underline inline-flex items-center gap-1">
            Ver todas <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
        {recentImports.length === 0 ? (
          <div className="p-5">
            <EmptyState
              icon={FileSpreadsheet}
              title="Nenhuma importação ainda"
              description="Envie seu primeiro CSV do Facebook para começar a gerenciar a receita."
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="text-left px-5 py-3 font-medium">Arquivo</th>
                  <th className="text-left px-5 py-3 font-medium">Status</th>
                  <th className="text-right px-5 py-3 font-medium">Linhas</th>
                  <th className="text-left px-5 py-3 font-medium">Quando</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {recentImports.map((imp) => (
                  <tr key={imp.id} className="hover:bg-muted/20">
                    <td className="px-5 py-3">
                      <Link to="/admin/importacoes/$id" params={{ id: imp.id }} className="font-medium hover:underline">
                        {imp.file_name}
                      </Link>
                    </td>
                    <td className="px-5 py-3"><StatusBadge status={imp.status} /></td>
                    <td className="px-5 py-3 text-right tabular-nums">{imp.valid_rows}/{imp.total_rows}</td>
                    <td className="px-5 py-3 text-muted-foreground">{formatDateTime(imp.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
