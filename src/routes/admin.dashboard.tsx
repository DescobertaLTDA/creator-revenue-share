import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState, useMemo, lazy, Suspense, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/app/PageHeader";
import { KpiCard } from "@/components/app/KpiCard";
import { StatusBadge } from "@/components/app/StatusBadge";
import { EmptyState } from "@/components/app/EmptyState";
import { formatBRL, formatDateTime, formatMonth } from "@/lib/format";
import { DollarSign, Wallet, FileSpreadsheet, ArrowRight, TrendingUp, Eye, Heart } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";

const DashboardCharts = lazy(() =>
  import("@/components/app/DashboardCharts").then((m) => ({ default: m.DashboardCharts }))
);

export const Route = createFileRoute("/admin/dashboard")({
  head: () => ({ meta: [{ title: "Dashboard - Splash Creators" }] }),
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
              .select("id, page_id, published_at, monetization_approx, estimated_usd, views, reach, reactions, title, post_type, permalink")
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

  const { kpis, chartData, activeMonthRef, collabCards, rulesByPage, postToCollabs } = useMemo(() => {
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

    // Daily revenue entries: replace posts estimate with actual revenue for covered days.
    // Correction = actual - posts (can be negative when posts overestimated).
    const filteredDaily = dailyEntries.filter(
      (e) => e.actual_revenue_usd !== null &&
        (!filterFrom || e.entry_date >= filterFrom) &&
        (!filterTo || e.entry_date <= filterTo)
    );
    let totalDailyBonus = 0;
    for (const entry of filteredDaily) {
      const actual = Number(entry.actual_revenue_usd);
      const postsRevForDay = byDay[entry.entry_date]?.receita ?? 0;
      const correction = actual - postsRevForDay; // may be negative
      totalDailyBonus += correction;
      const bonusMonth = entry.entry_date.slice(0, 7);
      byMonth[bonusMonth] = (byMonth[bonusMonth] ?? 0) + correction;
      if (byDay[entry.entry_date]) {
        byDay[entry.entry_date].receita += correction;
      } else if (actual > 0) {
        const [, mo, d] = entry.entry_date.split("-");
        byDay[entry.entry_date] = { dia: `${d}/${mo}`, posts: 0, views: 0, alcance: 0, reacoes: 0, receita: actual };
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
      rulesByPage,
      postToCollabs,
    };
  }, [allPosts, postAuthors, splitRules, colabs, manualBonuses, dailyEntries, filterPage, filterColab, filterFrom, filterTo]);

  const { totalMonth, totalGeral, totalPosts, totalViews, totalReacoes } = kpis;

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
      acc[t].count += 1;
      acc[t].views += Number(p.views ?? 0);
      acc[t].share += p.share;
      return acc;
    }, {});

    return { colab, card, posts, typeBreakdown };
  }, [auditColabId, allPosts, postToCollabs, rulesByPage, colabs, collabCards, filterPage, filterFrom, filterTo]);

  return (
    <div className="space-y-5">

      {/* ── Header ── */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {activeMonthRef ? formatMonth(activeMonthRef) : "—"}
          </p>
        </div>
        {usdBrl && (
          <div className="text-right shrink-0">
            <p className="text-xs text-muted-foreground">USD/BRL agora</p>
            <p className="text-lg font-semibold tabular-nums">{formatBRL(usdBrl)}</p>
            {usdUpdated && (
              <p className="text-[10px] text-muted-foreground">
                {usdUpdated.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
              </p>
            )}
          </div>
        )}
      </div>

      {/* ── Filtros ── */}
      <div className="border border-border rounded-lg px-4 py-3 bg-card">
        <div className="grid grid-cols-2 sm:flex sm:flex-wrap gap-3 items-end">
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Página</label>
            <select value={filterPage} onChange={(e) => setFilterPage(e.target.value)}
              className="h-9 rounded-md border border-input bg-background px-2 text-sm w-full sm:min-w-[140px]">
              <option value="all">Todas as páginas</option>
              {pages.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Colaborador</label>
            <select value={filterColab} onChange={(e) => setFilterColab(e.target.value)}
              className="h-9 rounded-md border border-input bg-background px-2 text-sm w-full sm:min-w-[160px]">
              <option value="all">Todos</option>
              <option value={SEM_COLAB_ID}>Sem colaborador</option>
              {colabs.map((c) => <option key={c.id} value={c.id}>{c.nome}{c.hashtag ? ` (#${c.hashtag})` : ""}</option>)}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">De</label>
            <input type="date" value={filterFrom} onChange={(e) => setFilterFrom(e.target.value)}
              className="h-9 rounded-md border border-input bg-background px-2 text-sm w-full" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Até</label>
            <input type="date" value={filterTo} onChange={(e) => setFilterTo(e.target.value)}
              className="h-9 rounded-md border border-input bg-background px-2 text-sm w-full" />
          </div>
          {(filterPage !== "all" || filterColab !== "all" || filterFrom || filterTo) && (
            <button onClick={() => { setFilterPage("all"); setFilterColab("all"); setFilterFrom(""); setFilterTo(""); }}
              className="h-9 px-3 rounded-md text-xs text-muted-foreground border border-border hover:bg-muted transition-colors col-span-2 sm:col-span-1">
              Limpar
            </button>
          )}
        </div>
      </div>

      {/* ── KPIs principais ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: "Receita do mês", value: loading ? "—" : `$${totalMonth.toFixed(2)}`, sub: usdBrl ? formatBRL(totalMonth * usdBrl) : null, icon: DollarSign },
          { label: "Receita total", value: loading ? "—" : `$${totalGeral.toFixed(2)}`, sub: usdBrl ? formatBRL(totalGeral * usdBrl) : null, icon: Wallet },
          { label: "Views", value: loading ? "—" : fmt(totalViews), sub: null, icon: Eye },
          { label: "Reações", value: loading ? "—" : fmt(totalReacoes), sub: null, icon: Heart },
        ].map(({ label, value, sub, icon: Icon }) => (
          <div key={label} className="border border-border rounded-lg p-4 bg-card">
            <div className="flex items-center justify-between mb-2">
              <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
              <Icon className="h-3.5 w-3.5 text-muted-foreground" />
            </div>
            <p className="text-xl font-semibold tabular-nums">{value}</p>
            {sub && <p className="text-xs text-muted-foreground mt-0.5 tabular-nums">{sub}</p>}
          </div>
        ))}
      </div>

      {/* ── Destaque BRL + Posts ── */}
      {!loading && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {usdBrl && (
            <div className="border border-border rounded-lg p-5 bg-card">
              <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground mb-1">Total recebido (BRL)</p>
              <p className="text-3xl font-bold tabular-nums tracking-tight">{formatBRL(totalGeral * usdBrl)}</p>
              <p className="text-xs text-muted-foreground mt-1">USD 1 = {formatBRL(usdBrl)}</p>
            </div>
          )}
          <div className="border border-border rounded-lg p-5 bg-card">
            <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground mb-1">Posts no filtro</p>
            <p className="text-3xl font-bold tabular-nums tracking-tight">{totalPosts.toLocaleString("pt-BR")}</p>
            {allPosts.length !== totalPosts && (
              <p className="text-xs text-muted-foreground mt-1">{allPosts.length.toLocaleString("pt-BR")} no total</p>
            )}
          </div>
        </div>
      )}

      {/* ── Colaboradores ── */}
      {!loading && (
        <div className="border border-border rounded-lg bg-card overflow-hidden">
          <div className="px-5 py-3.5 border-b border-border">
            <h2 className="text-sm font-medium">Distribuição por colaborador</h2>
          </div>
          {collabCards.length === 0 ? (
            <p className="text-sm text-muted-foreground p-5">Nenhum colaborador no filtro atual.</p>
          ) : (
            <div className="divide-y divide-border">
              {collabCards.slice(0, 12).map((item) => (
                <div key={item.id} className="px-5 py-3.5 flex items-center justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">{item.nome}</p>
                    <p className="text-xs text-muted-foreground">
                      {item.hashtag ? `#${item.hashtag} · ` : ""}{item.posts.toLocaleString("pt-BR")} posts · {fmt(item.views)} views
                    </p>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <div className="text-right">
                      {usdBrl ? (
                        <>
                          <p className="text-sm font-semibold tabular-nums">{formatBRL(item.receita * usdBrl)}</p>
                          <p className="text-xs text-muted-foreground tabular-nums">${item.receita.toFixed(2)}</p>
                        </>
                      ) : (
                        <p className="text-sm font-semibold tabular-nums">${item.receita.toFixed(2)}</p>
                      )}
                    </div>
                    <button
                      onClick={() => setAuditColabId(item.id)}
                      className="shrink-0 px-3 py-1.5 rounded-md bg-[#0a0a0a] text-white text-xs font-medium hover:bg-neutral-800 transition-colors"
                    >
                      Analisar
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Gráficos ── */}
      {!loading && chartData.length > 0 && (
        <Suspense fallback={<div className="h-48 bg-muted/20 rounded-lg animate-pulse" />}>
          <DashboardCharts data={chartData} />
        </Suspense>
      )}

      {/* ── Importações recentes ── */}
      <div className="border border-border rounded-lg bg-card overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-border">
          <h2 className="text-sm font-medium">Importações recentes</h2>
          <Link to="/admin/importacoes" className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1 transition-colors">
            Ver todas <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
        {recentImports.length === 0 ? (
          <div className="p-5">
            <EmptyState icon={FileSpreadsheet} title="Nenhuma importação ainda"
              description="Envie seu primeiro CSV do Facebook para começar." />
          </div>
        ) : (
          <>
            <div className="sm:hidden divide-y divide-border">
              {recentImports.map((imp) => (
                <div key={imp.id} className="px-4 py-3 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <Link to="/admin/importacoes/$id" params={{ id: imp.id }}
                      className="text-sm font-medium hover:underline truncate block">{imp.file_name}</Link>
                    <p className="text-xs text-muted-foreground mt-0.5">{formatDateTime(imp.created_at)} · {imp.valid_rows}/{imp.total_rows} linhas</p>
                  </div>
                  <StatusBadge status={imp.status} />
                </div>
              ))}
            </div>
            <div className="hidden sm:block">
              <table className="w-full text-sm">
                <thead className="bg-muted/30 text-[11px] uppercase text-muted-foreground">
                  <tr>
                    <th className="text-left px-5 py-3 font-medium">Arquivo</th>
                    <th className="text-left px-5 py-3 font-medium">Status</th>
                    <th className="text-right px-5 py-3 font-medium">Linhas</th>
                    <th className="text-left px-5 py-3 font-medium">Data</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {recentImports.map((imp) => (
                    <tr key={imp.id} className="hover:bg-muted/20">
                      <td className="px-5 py-3">
                        <Link to="/admin/importacoes/$id" params={{ id: imp.id }} className="hover:underline">{imp.file_name}</Link>
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
      {/* ── Audit Dialog ── */}
      <Dialog open={!!auditColabId} onOpenChange={(o) => { if (!o) setAuditColabId(null); }}>
        <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {auditData?.colab?.nome ?? "—"}
              {auditData?.colab?.hashtag && (
                <span className="text-xs font-normal text-muted-foreground font-mono">#{auditData.colab.hashtag}</span>
              )}
            </DialogTitle>
            <p className="text-xs text-muted-foreground">
              {filterFrom && filterTo ? `${filterFrom} → ${filterTo}` : "Todos os períodos"} · {auditData?.posts.length ?? 0} posts
            </p>
          </DialogHeader>

          {auditData && (
            <div className="flex-1 overflow-y-auto space-y-4 pr-1">
              {/* Summary cards */}
              <div className="grid grid-cols-3 gap-3">
                {[
                  { label: "Posts", value: auditData.posts.length.toLocaleString("pt-BR") },
                  { label: "Views", value: fmt(auditData.posts.reduce((s, p) => s + Number(p.views ?? 0), 0)) },
                  { label: "Total (USD)", value: `$${(auditData.card?.receita ?? 0).toFixed(2)}` },
                ].map(({ label, value }) => (
                  <div key={label} className="border border-border rounded-lg p-3 text-center">
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">{label}</p>
                    <p className="text-lg font-semibold tabular-nums mt-0.5">{value}</p>
                  </div>
                ))}
              </div>

              {/* Type breakdown */}
              {Object.keys(auditData.typeBreakdown).length > 0 && (
                <div className="border border-border rounded-lg p-3">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-2">Por tipo</p>
                  <div className="flex flex-wrap gap-2">
                    {Object.entries(auditData.typeBreakdown).map(([type, info]) => (
                      <span key={type} className="inline-flex items-center gap-1.5 text-xs bg-muted/50 rounded-md px-2.5 py-1">
                        <span className="font-medium capitalize">{type}</span>
                        <span className="text-muted-foreground">·</span>
                        <span>{info.count} posts</span>
                        <span className="text-muted-foreground">·</span>
                        <span>{fmt(info.views)} views</span>
                        <span className="text-muted-foreground">·</span>
                        <span className="font-semibold">${info.share.toFixed(2)}</span>
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Posts table */}
              <div className="border border-border rounded-lg overflow-hidden">
                <table className="w-full text-xs">
                  <thead className="bg-muted/40 text-[10px] uppercase text-muted-foreground">
                    <tr>
                      <th className="text-left px-3 py-2 font-medium">Data</th>
                      <th className="text-left px-3 py-2 font-medium">Título / Tipo</th>
                      <th className="text-right px-3 py-2 font-medium">Views</th>
                      <th className="text-right px-3 py-2 font-medium">Reações</th>
                      <th className="text-right px-3 py-2 font-medium">Receita</th>
                      <th className="text-right px-3 py-2 font-medium">Split%</th>
                      <th className="text-right px-3 py-2 font-medium">Sua parte</th>
                      <th className="px-3 py-2" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {auditData.posts.map((p) => (
                      <tr key={p.id} className="hover:bg-muted/20">
                        <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">
                          {p.published_at ? p.published_at.slice(0, 10) : "—"}
                        </td>
                        <td className="px-3 py-2 max-w-[200px]">
                          {p.permalink ? (
                            <a
                              href={p.permalink}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="truncate block underline underline-offset-2 text-foreground hover:text-muted-foreground transition-colors"
                              onClick={(e) => e.stopPropagation()}
                            >
                              {p.title ?? p.id.slice(0, 8)}
                            </a>
                          ) : (
                            <span className="truncate block text-foreground">{p.title ?? p.id.slice(0, 8)}</span>
                          )}
                          {p.post_type && (
                            <span className="text-[10px] text-muted-foreground capitalize">{p.post_type}</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">{fmt(Number(p.views ?? 0))}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{Number(p.reactions ?? 0).toLocaleString("pt-BR")}</td>
                        <td className="px-3 py-2 text-right tabular-nums">${p.postUsd.toFixed(2)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{(p.collaboratorPct * 100).toFixed(0)}%</td>
                        <td className="px-3 py-2 text-right tabular-nums font-semibold">${p.share.toFixed(2)}</td>
                        <td className="px-3 py-2">
                          {p.permalink ? (
                            <a
                              href={p.permalink}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              className="inline-block px-2.5 py-1 rounded-md bg-[#0a0a0a] text-white text-[10px] font-medium hover:bg-neutral-800 transition-colors whitespace-nowrap"
                            >
                              Conferir
                            </a>
                          ) : (
                            <span className="inline-block px-2.5 py-1 rounded-md bg-muted text-muted-foreground text-[10px] whitespace-nowrap">Sem link</span>
                          )}
                        </td>
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

