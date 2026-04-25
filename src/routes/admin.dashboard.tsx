import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState, useMemo, lazy, Suspense, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/app/PageHeader";
import { KpiCard } from "@/components/app/KpiCard";
import { StatusBadge } from "@/components/app/StatusBadge";
import { EmptyState } from "@/components/app/EmptyState";
import { formatBRL, formatDateTime, formatMonth } from "@/lib/format";
import { DollarSign, Wallet, FileSpreadsheet, ArrowRight, TrendingUp, Eye, Heart, Users } from "lucide-react";

const DashboardCharts = lazy(() =>
  import("@/components/app/DashboardCharts").then((m) => ({ default: m.DashboardCharts }))
);

export const Route = createFileRoute("/admin/dashboard")({
  head: () => ({ meta: [{ title: "Dashboard - Rateio Creator" }] }),
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
    if (effectiveDay <= publishedDay) {
      return Number(rule.collaborator_pct ?? 0) / 100;
    }
  }
  // Fallback: se todas as regras comecam apos o post, aplica a mais antiga ativa.
  return Number(rules[rules.length - 1]?.collaborator_pct ?? 0) / 100;
}


function ruleEffectiveDay(rule: SplitRule): string {
  return (rule.effective_from ?? "0000-01-01").slice(0, 10);
}

function AdminDashboard() {
  const [loading, setLoading] = useState(true);
  const [allPosts, setAllPosts] = useState<RawPost[]>([]);
  const [postAuthors, setPostAuthors] = useState<PostAuthorRow[]>([]);
  const [splitRules, setSplitRules] = useState<SplitRule[]>([]);
  const [pages, setPages] = useState<PageOption[]>([]);
  const [colabs, setColabs] = useState<ColabOption[]>([]);
  const [manualBonuses, setManualBonuses] = useState<ManualBonusRow[]>([]);
  const [dailyEntries, setDailyEntries] = useState<DailyEntry[]>([]);
  const [recentImports, setRecentImports] = useState<RecentImport[]>([]);
  const [usdBrl, setUsdBrl] = useState<number | null>(null);
  const [usdUpdated, setUsdUpdated] = useState<Date | null>(null);

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
        if (v) {
          setUsdBrl(v);
          setUsdUpdated(new Date());
        }
      });
    load();
    usdIntervalRef.current = setInterval(load, 60_000);
    return () => {
      if (usdIntervalRef.current) clearInterval(usdIntervalRef.current);
    };
  }, []);

  useEffect(() => {
    const load = async () => {
      const [posts, pas, { data: pagesData }, { data: colabsData }, { data: rulesData }, { data: imports }, { data: dailyData }] =
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
            .from("split_rules")
            .select("page_id, effective_from, collaborator_pct, active")
            .eq("active", true),
          supabase
            .from("csv_imports")
            .select("id, file_name, status, created_at, valid_rows, total_rows")
            .order("created_at", { ascending: false })
            .limit(5),
          (supabase as any).from("daily_revenue_entries").select("entry_date, actual_revenue_usd"),
        ]);

      setAllPosts(posts);
      setPostAuthors(pas);
      setSplitRules((rulesData as SplitRule[]) ?? []);
      setPages((pagesData ?? []).map((p: any) => ({ id: p.id, name: p.nome })));
      setColabs((colabsData ?? []).map((c: any) => ({ id: c.id, nome: c.nome, hashtag: c.hashtag })));
      setRecentImports((imports ?? []) as RecentImport[]);
      setDailyEntries((dailyData ?? []) as unknown as DailyEntry[]);
      setLoading(false);
    };
    load();
  }, []);

  useEffect(() => {
    const loadManualBonuses = async () => {
      const { data, error } = await (supabase as any)
        .from("manual_bonus_entries")
        .select("id, bonus_date, amount_usd, distribution_mode, active")
        .eq("active", true);

      if (error) {
        const message = String(error.message ?? "");
        if (message.includes("manual_bonus_entries")) {
          setManualBonuses([]);
          return;
        }
        setManualBonuses([]);
        return;
      }

      setManualBonuses((data ?? []) as ManualBonusRow[]);
    };

    loadManualBonuses();

    const channel = supabase
      .channel("admin-dashboard-manual-bonus")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "manual_bonus_entries" },
        loadManualBonuses
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  useEffect(() => {
    const channel = supabase
      .channel("admin-dashboard-collaborators")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "collaborators" },
        async () => {
          const { data: colabsData } = await supabase
            .from("collaborators")
            .select("id, nome, hashtag")
            .eq("ativo", true);

          setColabs((colabsData ?? []).map((c: any) => ({ id: c.id, nome: c.nome, hashtag: c.hashtag })));
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;

    const refreshPostAuthors = async () => {
      const pas = await fetchAllRows<PostAuthorRow>(() =>
        supabase.from("post_authors").select("post_id, collaborator_id")
      );
      setPostAuthors(pas);
    };

    const scheduleRefresh = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        refreshPostAuthors();
      }, 350);
    };

    const channel = supabase
      .channel("admin-dashboard-post-authors")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "post_authors" },
        scheduleRefresh
      )
      .subscribe();

    return () => {
      if (timer) clearTimeout(timer);
      supabase.removeChannel(channel);
    };
  }, []);

  useEffect(() => {
    if (filterColab !== "all" && filterColab !== SEM_COLAB_ID && !colabs.some((c) => c.id === filterColab)) {
      setFilterColab("all");
    }
  }, [colabs, filterColab]);

  const { kpis, chartData, activeMonthRef, collabCards } = useMemo(() => {
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

    // Compute previous month for daily bonus distribution
    const baseMonth = filterFrom ? filterFrom.slice(0, 7) : new Date().toISOString().slice(0, 7);
    const [bY, bM] = baseMonth.split("-").map(Number);
    const prevD = new Date(bY, bM - 2, 1);
    const prevMonthRef = `${prevD.getFullYear()}-${String(prevD.getMonth() + 1).padStart(2, "0")}`;
    const prevFrom = `${prevMonthRef}-01`;
    const [pY, pM] = prevMonthRef.split("-").map(Number);
    const prevLastDay = new Date(pY, pM, 0).getDate();
    const prevTo = `${prevMonthRef}-${String(prevLastDay).padStart(2, "0")}`;

    // Views per collaborator in prev month (from all posts, not just filtered)
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

    const colabMap = new Map(colabs.map((c) => [c.id, c]));

    let geralUsd = 0;
    let viewsSum = 0;
    let reacoesSum = 0;

    for (const p of filtered) {
      const val = getPostUsd(p);
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

      const collaboratorIds = Array.from(postToCollabs.get(p.id) ?? []);
      const collaboratorPct = getCollaboratorPct(p, rulesByPage);
      const collaboratorRevenue = val * collaboratorPct;

      if (collaboratorIds.length === 0) {
        const current = colabAgg.get(SEM_COLAB_ID) ?? {
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
        current.reacoes += reacoes;
        current.receita += collaboratorRevenue;
        colabAgg.set(SEM_COLAB_ID, current);
      } else {
        const share = collaboratorRevenue / collaboratorIds.length;
        for (const colabId of collaboratorIds) {
          const colab = colabMap.get(colabId);
          const targetId = colab ? colabId : SEM_COLAB_ID;
          const current = colabAgg.get(targetId) ?? {
            id: targetId,
            nome: colab ? colab.nome : "Sem colaborador",
            hashtag: colab ? colab.hashtag : null,
            posts: 0,
            views: 0,
            reacoes: 0,
            receita: 0,
          };
          current.posts += 1;
          current.views += views;
          current.reacoes += reacoes;
          current.receita += share;
          colabAgg.set(targetId, current);
        }
      }
    }

    // Daily revenue entries bonus (actual_revenue - posts_revenue for covered days)
    const filteredDaily = dailyEntries.filter(
      (e) => (!filterFrom || e.entry_date >= filterFrom) && (!filterTo || e.entry_date <= filterTo)
    );
    let totalDailyBonus = 0;
    for (const entry of filteredDaily) {
      const actual = Number(entry.actual_revenue_usd ?? 0);
      const postsRevForDay = byDay[entry.entry_date]?.receita ?? 0;
      const bonus = actual - postsRevForDay;
      if (bonus > 0) {
        totalDailyBonus += bonus;
        const bonusMonth = entry.entry_date.slice(0, 7);
        byMonth[bonusMonth] = (byMonth[bonusMonth] ?? 0) + bonus;
        if (byDay[entry.entry_date]) {
          byDay[entry.entry_date].receita += bonus;
        } else {
          const [, mo, d] = entry.entry_date.split("-");
          byDay[entry.entry_date] = { dia: `${d}/${mo}`, posts: 0, views: 0, alcance: 0, reacoes: 0, receita: bonus };
        }
      }
    }
    geralUsd += totalDailyBonus;

    const filteredBonuses = manualBonuses.filter((bonus) => {
      if (!bonus.active) return false;
      if (filterFrom && bonus.bonus_date < filterFrom) return false;
      if (filterTo && bonus.bonus_date > filterTo) return false;
      return true;
    });

    const merged = new Map(colabAgg);
    for (const c of colabs) {
      if (!merged.has(c.id)) {
        merged.set(c.id, {
          id: c.id,
          nome: c.nome,
          hashtag: c.hashtag,
          posts: 0,
          views: 0,
          reacoes: 0,
          receita: 0,
        });
      }
    }
    if (!merged.has(SEM_COLAB_ID)) {
      merged.set(SEM_COLAB_ID, {
        id: SEM_COLAB_ID,
        nome: "Sem colaborador",
        hashtag: null,
        posts: 0,
        views: 0,
        reacoes: 0,
        receita: 0,
      });
    }

    const baseRevenueByColab = new Map<string, number>();
    for (const [id, item] of merged.entries()) {
      if (id === SEM_COLAB_ID) continue;
      baseRevenueByColab.set(id, Number(item.receita ?? 0));
    }

    // Distribute daily bonus by prev month views %
    if (totalDailyBonus > 0) {
      if (totalPrevViews > 0) {
        for (const [cid, views] of prevViewsByColab.entries()) {
          const bonusShare = (views / totalPrevViews) * totalDailyBonus;
          const item = merged.get(cid);
          if (item) item.receita += bonusShare;
        }
      } else {
        // Fallback: equal split among all collaborators
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
      const currentDay = byDay[bonus.bonus_date] ?? {
        dia: label,
        posts: 0,
        views: 0,
        alcance: 0,
        reacoes: 0,
        receita: 0,
      };
      currentDay.receita += usd;
      byDay[bonus.bonus_date] = currentDay;

      const eligibleIds = Array.from(merged.keys()).filter((id) => id !== SEM_COLAB_ID);
      if (eligibleIds.length === 0) {
        merged.get(SEM_COLAB_ID)!.receita += usd;
        continue;
      }

      const totalViews = eligibleIds.reduce((sum, id) => sum + Number(merged.get(id)?.views ?? 0), 0);
      const totalRevenue = eligibleIds.reduce((sum, id) => sum + Number(baseRevenueByColab.get(id) ?? 0), 0);

      const weights = new Map<string, number>();
      let totalWeight = 0;
      for (const id of eligibleIds) {
        const item = merged.get(id)!;
        const viewShare = totalViews > 0 ? item.views / totalViews : 0;
        const revenueShare = totalRevenue > 0 ? Number(baseRevenueByColab.get(id) ?? 0) / totalRevenue : 0;

        let weight = 0;
        if (bonus.distribution_mode === "views") {
          weight = viewShare;
        } else if (bonus.distribution_mode === "revenue") {
          weight = revenueShare;
        } else {
          const hasViews = totalViews > 0;
          const hasRevenue = totalRevenue > 0;
          if (hasViews && hasRevenue) weight = (viewShare + revenueShare) / 2;
          else if (hasViews) weight = viewShare;
          else if (hasRevenue) weight = revenueShare;
          else weight = 0;
        }

        weights.set(id, weight);
        totalWeight += weight;
      }

      if (totalWeight <= 0) {
        merged.get(SEM_COLAB_ID)!.receita += usd;
        continue;
      }

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
      collabCards: Array.from(merged.values()).sort((a, b) => b.receita - a.receita || a.nome.localeCompare(b.nome, "pt-BR")),
    };
  }, [allPosts, postAuthors, splitRules, colabs, manualBonuses, dailyEntries, filterPage, filterColab, filterFrom, filterTo]);

  const { totalMonth, totalGeral, totalPosts, totalViews, totalReacoes } = kpis;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <PageHeader
          title="Dashboard"
          description={`Visao geral - ${activeMonthRef ? formatMonth(activeMonthRef) : "..."}`}
        />
        {usdBrl && (
          <div className="text-right text-sm mt-1 shrink-0">
            <span className="text-muted-foreground text-xs">Dolar agora</span>
            <p className="font-semibold text-lg leading-tight">{formatBRL(usdBrl)}</p>
            {usdUpdated && (
              <p className="text-[10px] text-muted-foreground">
                atualizado {usdUpdated.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
              </p>
            )}
          </div>
        )}
      </div>

      <div className="bg-card border border-border rounded-lg px-4 py-3">
        <div className="grid grid-cols-2 sm:flex sm:flex-wrap gap-3 items-end">
          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Página</label>
            <select
              value={filterPage}
              onChange={(e) => setFilterPage(e.target.value)}
              className="h-10 rounded-lg border border-input bg-background px-2 text-sm w-full sm:min-w-[140px]"
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
              className="h-10 rounded-lg border border-input bg-background px-2 text-sm w-full sm:min-w-[160px]"
            >
              <option value="all">Todos</option>
              <option value={SEM_COLAB_ID}>Sem colaborador</option>
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
              className="h-10 rounded-lg border border-input bg-background px-2 text-sm w-full"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Até</label>
            <input
              type="date"
              value={filterTo}
              onChange={(e) => setFilterTo(e.target.value)}
              className="h-10 rounded-lg border border-input bg-background px-2 text-sm w-full"
            />
          </div>
          {(filterPage !== "all" || filterColab !== "all" || filterFrom || filterTo) && (
            <button
              onClick={() => { setFilterPage("all"); setFilterColab("all"); setFilterFrom(""); setFilterTo(""); }}
              className="h-10 px-3 rounded-lg text-xs border border-border hover:bg-muted transition-colors col-span-2 sm:col-span-1"
            >
              Limpar filtros
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <KpiCard
          label="Receita do mes (USD)"
          value={loading ? "..." : `$${totalMonth.toFixed(2)}`}
          hint={usdBrl ? `~ ${formatBRL(totalMonth * usdBrl)}` : undefined}
          icon={DollarSign}
          tone="success"
        />
        <KpiCard
          label="Receita total (USD)"
          value={loading ? "..." : `$${totalGeral.toFixed(2)}`}
          hint={usdBrl ? `~ ${formatBRL(totalGeral * usdBrl)}` : undefined}
          icon={Wallet}
          tone="warning"
        />
        <KpiCard label="Total de views" value={loading ? "..." : fmt(totalViews)} icon={Eye} />
        <KpiCard label="Total de reacoes" value={loading ? "..." : fmt(totalReacoes)} icon={Heart} />
      </div>

      {!loading && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="bg-card border border-border rounded-lg p-4 flex items-center justify-between">
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
            <div className="bg-card border border-border rounded-lg p-4 flex items-center justify-between">
              <div>
                <p className="text-xs uppercase text-muted-foreground font-medium tracking-widest">Total em BRL (cotacao atual)</p>
                <p className="text-2xl font-bold mt-1">{formatBRL(totalGeral * usdBrl)}</p>
                <p className="text-xs text-muted-foreground mt-0.5">USD 1 = {formatBRL(usdBrl)}</p>
              </div>
              <DollarSign className="h-8 w-8 text-[#16a34a] opacity-60" />
            </div>
          )}
        </div>
      )}

      {!loading && (
        <div className="bg-card border border-border rounded-lg p-5">
          <div className="mb-4">
            <h2 className="font-medium">Colaboradores (regra de split)</h2>
          </div>

          {collabCards.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum colaborador encontrado no filtro atual.</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
              {collabCards.slice(0, 12).map((item) => (
                <div key={item.id} className="rounded-lg border border-border p-4 flex items-center gap-4 sm:block">
                  <div className="flex items-start justify-between gap-3 sm:mb-3">
                    <div className="min-w-0">
                      <p className="font-semibold leading-tight truncate">{item.nome}</p>
                      <p className="text-xs text-muted-foreground">
                        {item.hashtag ? `#${item.hashtag}` : "Sem hashtag"}
                      </p>
                    </div>
                    <Users className="h-4 w-4 text-muted-foreground shrink-0" />
                  </div>
                  <div className="flex-1 sm:mt-0">
                    {usdBrl ? (
                      <>
                        <p className="text-lg sm:text-xl font-bold text-[#16a34a]">{formatBRL(item.receita * usdBrl)}</p>
                        <p className="text-xs text-muted-foreground">~ ${item.receita.toFixed(2)}</p>
                      </>
                    ) : (
                      <p className="text-lg sm:text-xl font-bold text-[#16a34a]">${item.receita.toFixed(2)}</p>
                    )}
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {item.posts.toLocaleString("pt-BR")} posts · {fmt(item.views)} views
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {!loading && chartData.length > 0 && (
        <Suspense fallback={<div className="h-48 bg-muted/30 rounded-lg animate-pulse" />}>
          <DashboardCharts data={chartData} />
        </Suspense>
      )}

      <div className="bg-card border border-border rounded-lg overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 className="font-medium">Importacoes recentes</h2>
          <Link to="/admin/importacoes" className="text-xs text-primary hover:underline inline-flex items-center gap-1">
            Ver todas <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
        {recentImports.length === 0 ? (
          <div className="p-5">
            <EmptyState
              icon={FileSpreadsheet}
              title="Nenhuma importacao ainda"
              description="Envie seu primeiro CSV do Facebook para comecar a gerenciar a receita."
            />
          </div>
        ) : (
          <>
            {/* Mobile card list */}
            <div className="sm:hidden divide-y divide-border">
              {recentImports.map((imp) => (
                <div key={imp.id} className="px-4 py-3 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <Link to="/admin/importacoes/$id" params={{ id: imp.id }} className="font-medium text-sm hover:underline truncate block">
                      {imp.file_name}
                    </Link>
                    <p className="text-xs text-muted-foreground mt-0.5">{formatDateTime(imp.created_at)} · {imp.valid_rows}/{imp.total_rows} linhas</p>
                  </div>
                  <StatusBadge status={imp.status} />
                </div>
              ))}
            </div>
            {/* Desktop table */}
            <div className="hidden sm:block overflow-x-auto">
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
          </>
        )}
      </div>
    </div>
  );
}

