import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/app/PageHeader";
import { KpiCard } from "@/components/app/KpiCard";
import { formatBRL, formatPct } from "@/lib/format";
import {
  DollarSign, TrendingUp, Users, Zap, ChevronRight, X,
} from "lucide-react";
import { Slider } from "@/components/ui/slider";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";

export const Route = createFileRoute("/admin/central-receita")({
  head: () => ({ meta: [{ title: "Central de Receita — Splash Creators" }] }),
  component: CentralReceita,
});

// ─── Types ─────────────────────────────────────────────────────────────────

interface CollabRow {
  id: string;
  nome: string;
  avatar_url: string | null;
  hashtag: string | null;
  ativo: boolean;
}

interface PostAuthorRow { post_id: string; collaborator_id: string }

interface PostRow {
  id: string;
  page_id: string;
  published_at: string | null;
  monetization_approx: number | null;
  views: number | null;
}

interface SplitRule {
  page_id: string;
  collaborator_pct: number;
  active: boolean;
  effective_from: string | null;
}

interface DailyEntry { actual_revenue_usd: number | null; entry_date: string }

// ─── Helpers ────────────────────────────────────────────────────────────────

const USD_BRL = 5.02;

function monthBounds(iso: string) {
  const [y, m] = iso.split("-").map(Number);
  const last = new Date(y, m, 0).getDate();
  return {
    from: `${iso}-01`,
    to: `${iso}-${String(last).padStart(2, "0")}T23:59:59`,
  };
}

function prevMonth(iso: string) {
  const [y, m] = iso.split("-").map(Number);
  const d = new Date(y, m - 2, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function initials(nome: string) {
  const parts = nome.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function Avatar({ nome, url, size = 32 }: { nome: string; url: string | null; size?: number }) {
  if (url) {
    return (
      <img
        src={url}
        alt={nome}
        style={{ width: size, height: size }}
        className="rounded-full object-cover shrink-0"
      />
    );
  }
  return (
    <div
      style={{ width: size, height: size, fontSize: size * 0.35 }}
      className="rounded-full bg-orange-500/20 text-orange-400 flex items-center justify-center font-semibold shrink-0"
    >
      {initials(nome)}
    </div>
  );
}

function BarFill({ pct }: { pct: number }) {
  return (
    <div className="flex items-center gap-2 min-w-[80px]">
      <div className="flex-1 h-1.5 rounded-full bg-white/10 overflow-hidden">
        <div
          className="h-full rounded-full bg-orange-500"
          style={{ width: `${Math.min(100, pct)}%` }}
        />
      </div>
      <span className="text-xs text-muted-foreground w-10 text-right tabular-nums">
        {pct.toFixed(1)}%
      </span>
    </div>
  );
}

// ─── Data types ─────────────────────────────────────────────────────────────

interface ColabRevenue {
  id: string;
  nome: string;
  avatar_url: string | null;
  hashtag: string | null;
  ativo: boolean;
  postCount: number;
  postsRevenue: number;
  historicalPct: number;
  residualShare: number;
  totalUsd: number;
  totalBrl: number;
  splitPct: number;
}

// ─── Main component ──────────────────────────────────────────────────────────

function CentralReceita() {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<ColabRevenue[]>([]);
  const [totalActual, setTotalActual] = useState(0);
  const [totalPostsRevenue, setTotalPostsRevenue] = useState(0);
  const [activeCount, setActiveCount] = useState(0);
  const [selected, setSelected] = useState<ColabRevenue | null>(null);
  const [simValue, setSimValue] = useState(1000);

  const thisMonth = new Date().toISOString().slice(0, 7);

  useEffect(() => {
    loadAll();
  }, []);

  async function loadAll() {
    setLoading(true);
    try {
      const curBounds = monthBounds(thisMonth);
      const prevMonthRef = prevMonth(thisMonth);
      const prevBounds = monthBounds(prevMonthRef);

      // 1. Active collaborators
      const { data: collabs } = await supabase
        .from("collaborators")
        .select("id, nome, avatar_url, hashtag, ativo");
      const allCollabs: CollabRow[] = (collabs ?? []) as CollabRow[];
      const activeCollabs = allCollabs.filter((c) => c.ativo);
      setActiveCount(activeCollabs.length);

      // 2. Current month posts
      const { data: curPosts } = await supabase
        .from("posts")
        .select("id, page_id, published_at, monetization_approx, views")
        .gte("published_at", curBounds.from)
        .lte("published_at", curBounds.to);
      const curPostsArr: PostRow[] = (curPosts ?? []) as PostRow[];

      // 3. Previous month posts (for historical %)
      const { data: prevPosts } = await supabase
        .from("posts")
        .select("id, views")
        .gte("published_at", prevBounds.from)
        .lte("published_at", prevBounds.to);
      const prevPostsArr = (prevPosts ?? []) as { id: string; views: number | null }[];

      // 4. Post authors for both months
      const curPostIds = curPostsArr.map((p) => p.id);
      const prevPostIds = prevPostsArr.map((p) => p.id);
      const allPostIds = [...new Set([...curPostIds, ...prevPostIds])];

      let paData: PostAuthorRow[] = [];
      if (allPostIds.length > 0) {
        const { data: pa } = await supabase
          .from("post_authors")
          .select("post_id, collaborator_id")
          .in("post_id", allPostIds);
        paData = (pa ?? []) as PostAuthorRow[];
      }

      const curPaByPost: Record<string, string[]> = {};
      const prevPaByPost: Record<string, string[]> = {};
      for (const pa of paData) {
        if (curPostIds.includes(pa.post_id)) {
          if (!curPaByPost[pa.post_id]) curPaByPost[pa.post_id] = [];
          curPaByPost[pa.post_id].push(pa.collaborator_id);
        }
        if (prevPostIds.includes(pa.post_id)) {
          if (!prevPaByPost[pa.post_id]) prevPaByPost[pa.post_id] = [];
          prevPaByPost[pa.post_id].push(pa.collaborator_id);
        }
      }

      // 5. Split rules (latest active per page)
      const { data: splitData } = await supabase
        .from("split_rules")
        .select("page_id, collaborator_pct, active, effective_from")
        .eq("active", true)
        .order("effective_from", { ascending: false });
      const splitRules: SplitRule[] = (splitData ?? []) as SplitRule[];

      // Latest rule per page
      const splitByPage: Record<string, number> = {};
      for (const r of splitRules) {
        if (!(r.page_id in splitByPage)) {
          splitByPage[r.page_id] = r.collaborator_pct;
        }
      }

      // 6. Daily revenue entries (current month)
      const { data: dailyData } = await supabase
        .from("daily_revenue_entries")
        .select("actual_revenue_usd, entry_date")
        .gte("entry_date", curBounds.from)
        .lte("entry_date", curBounds.to);
      const dailyArr: DailyEntry[] = (dailyData ?? []) as DailyEntry[];
      const totalActualUsd = dailyArr.reduce((s, d) => s + Number(d.actual_revenue_usd ?? 0), 0);
      setTotalActual(totalActualUsd);

      // ── Compute posts revenue per collaborator ──────────────────────────
      const postsRevByColab: Record<string, number> = {};
      const postCountByColab: Record<string, number> = {};
      let totalPosts = 0;

      for (const post of curPostsArr) {
        const authors = curPaByPost[post.id] ?? [];
        if (authors.length === 0) continue;
        const splitPct = splitByPage[post.page_id] ?? 50;
        const mono = Number(post.monetization_approx ?? 0);
        const share = (mono * (splitPct / 100)) / authors.length;
        totalPosts += mono * (splitPct / 100); // total posts revenue (all collabs)
        for (const cid of authors) {
          postsRevByColab[cid] = (postsRevByColab[cid] ?? 0) + share;
          postCountByColab[cid] = (postCountByColab[cid] ?? 0) + 1;
        }
      }
      setTotalPostsRevenue(totalPosts);

      const residual = Math.max(0, totalActualUsd - totalPosts);

      // ── Historical % (prev month views per colab) ───────────────────────
      const prevViewsByColab: Record<string, number> = {};
      const prevViewsByPost: Record<string, number> = {};
      for (const p of prevPostsArr) prevViewsByPost[p.id] = Number(p.views ?? 0);
      for (const pa of paData) {
        if (!prevPostIds.includes(pa.post_id)) continue;
        prevViewsByColab[pa.collaborator_id] =
          (prevViewsByColab[pa.collaborator_id] ?? 0) + (prevViewsByPost[pa.post_id] ?? 0);
      }
      const totalPrevViews = Object.values(prevViewsByColab).reduce((a, b) => a + b, 0);

      // ── Build rows ───────────────────────────────────────────────────────
      const colabMap: Record<string, CollabRow> = {};
      for (const c of allCollabs) colabMap[c.id] = c;

      // All collaborators that appear in current month OR are active
      const cidSet = new Set([
        ...Object.keys(postsRevByColab),
        ...activeCollabs.map((c) => c.id),
      ]);

      const result: ColabRevenue[] = [];
      for (const cid of cidSet) {
        const colab = colabMap[cid];
        if (!colab) continue;
        const postsRev = postsRevByColab[cid] ?? 0;
        const histPct = totalPrevViews > 0
          ? ((prevViewsByColab[cid] ?? 0) / totalPrevViews) * 100
          : 0;
        const residualShare = residual * (histPct / 100);
        const totalUsd = postsRev + residualShare;

        // Determine split % (avg across pages this collab posted on current month)
        const postsOfColab = curPostsArr.filter((p) => (curPaByPost[p.id] ?? []).includes(cid));
        const splitPctAvg = postsOfColab.length > 0
          ? postsOfColab.reduce((s, p) => s + (splitByPage[p.page_id] ?? 50), 0) / postsOfColab.length
          : 50;

        result.push({
          id: cid,
          nome: colab.nome,
          avatar_url: colab.avatar_url,
          hashtag: colab.hashtag,
          ativo: colab.ativo,
          postCount: postCountByColab[cid] ?? 0,
          postsRevenue: postsRev,
          historicalPct: histPct,
          residualShare,
          totalUsd,
          totalBrl: totalUsd * USD_BRL,
          splitPct: splitPctAvg,
        });
      }

      result.sort((a, b) => b.totalUsd - a.totalUsd);
      setRows(result);
    } finally {
      setLoading(false);
    }
  }

  const totalResidual = Math.max(0, totalActual - totalPostsRevenue);

  const simRows = useMemo(() => {
    const totalHistPct = rows.reduce((s, r) => s + r.historicalPct, 0) || 100;
    return rows.map((r) => {
      // posts revenue scales proportionally from current
      const postsShare = totalPostsRevenue > 0
        ? (r.postsRevenue / totalPostsRevenue) * simValue * 0.6
        : 0;
      const residualSim = simValue * 0.4 * (r.historicalPct / totalHistPct);
      return { ...r, simTotal: postsShare + residualSim };
    }).sort((a, b) => b.simTotal - a.simTotal);
  }, [rows, simValue, totalPostsRevenue]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Central de Receita"
        description="Distribuição de receita e participação dos colaboradores"
        icon={<DollarSign className="h-5 w-5" />}
      />

      {/* KPI cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard
          label="Receita Total"
          value={loading ? "…" : `$${totalActual.toFixed(2)}`}
          sub={loading ? "" : formatBRL(totalActual * USD_BRL)}
          icon={DollarSign}
        />
        <KpiCard
          label="Receita dos Posts"
          value={loading ? "…" : `$${totalPostsRevenue.toFixed(2)}`}
          sub={loading ? "" : formatBRL(totalPostsRevenue * USD_BRL)}
          icon={TrendingUp}
        />
        <KpiCard
          label="Receita Residual"
          value={loading ? "…" : `$${totalResidual.toFixed(2)}`}
          sub={loading ? "" : formatBRL(totalResidual * USD_BRL)}
          icon={Zap}
        />
        <KpiCard
          label="Colaboradores Ativos"
          value={loading ? "…" : String(activeCount)}
          sub="este mês"
          icon={Users}
        />
      </div>

      {/* Main table */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="px-4 py-3 border-b border-border flex items-center justify-between">
          <p className="text-sm font-semibold">Distribuição por Colaborador</p>
          <span className="text-xs text-muted-foreground">
            {thisMonth.replace("-", "/")} · câmbio ${USD_BRL}
          </span>
        </div>

        {loading ? (
          <div className="py-16 text-center text-sm text-muted-foreground">Carregando…</div>
        ) : rows.length === 0 ? (
          <div className="py-16 text-center text-sm text-muted-foreground">
            Nenhum dado para o mês atual.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-xs text-muted-foreground">
                  <th className="px-4 py-2.5 text-left font-medium">Colaborador</th>
                  <th className="px-3 py-2.5 text-right font-medium">Posts</th>
                  <th className="px-3 py-2.5 text-right font-medium">Receita Posts</th>
                  <th className="px-3 py-2.5 font-medium min-w-[140px]">Participação Hist.</th>
                  <th className="px-3 py-2.5 text-right font-medium">Residual</th>
                  <th className="px-3 py-2.5 text-right font-medium">Total USD</th>
                  <th className="px-3 py-2.5 text-right font-medium">Total BRL</th>
                  <th className="px-3 py-2.5 text-right font-medium">Split %</th>
                  <th className="px-2 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr
                    key={r.id}
                    className="border-b border-border/50 hover:bg-white/[0.02] cursor-pointer transition-colors"
                    onClick={() => setSelected(r)}
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <span className="text-xs text-muted-foreground w-5 text-right tabular-nums shrink-0">
                          {i + 1}
                        </span>
                        <Avatar nome={r.nome} url={r.avatar_url} size={32} />
                        <div className="min-w-0">
                          <p className="font-medium truncate max-w-[140px]">{r.nome}</p>
                          {r.hashtag && (
                            <p className="text-xs text-muted-foreground truncate">#{r.hashtag}</p>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums text-muted-foreground">
                      {r.postCount}
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums font-medium">
                      ${r.postsRevenue.toFixed(2)}
                    </td>
                    <td className="px-3 py-3">
                      <BarFill pct={r.historicalPct} />
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums text-muted-foreground">
                      ${r.residualShare.toFixed(2)}
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums font-semibold text-orange-400">
                      ${r.totalUsd.toFixed(2)}
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums">
                      {formatBRL(r.totalBrl)}
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums text-muted-foreground text-xs">
                      {r.splitPct.toFixed(0)}%
                    </td>
                    <td className="px-2 py-3">
                      <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Simulator */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="px-4 py-3 border-b border-border flex items-center justify-between">
          <p className="text-sm font-semibold">Simulador de Receita</p>
          <span className="text-xs text-muted-foreground font-mono">
            Se a página faturar ${simValue.toLocaleString()}
          </span>
        </div>
        <div className="px-4 pt-4 pb-2">
          <Slider
            min={100}
            max={10000}
            step={100}
            value={[simValue]}
            onValueChange={([v]) => setSimValue(v)}
            className="mb-4"
          />
        </div>
        {simRows.length > 0 && (
          <div className="overflow-x-auto pb-2">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-muted-foreground border-b border-border">
                  <th className="px-4 py-2 text-left font-medium">Colaborador</th>
                  <th className="px-3 py-2 text-right font-medium">Estimativa USD</th>
                  <th className="px-3 py-2 text-right font-medium">Estimativa BRL</th>
                  <th className="px-3 py-2 font-medium min-w-[120px]">% do total</th>
                </tr>
              </thead>
              <tbody>
                {simRows.slice(0, 8).map((r) => {
                  const simTotal = simRows.reduce((s, x) => s + x.simTotal, 0) || 1;
                  return (
                    <tr key={r.id} className="border-b border-border/50">
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2">
                          <Avatar nome={r.nome} url={r.avatar_url} size={24} />
                          <span className="truncate max-w-[120px]">{r.nome}</span>
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums font-semibold text-orange-400">
                        ${r.simTotal.toFixed(2)}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums">
                        {formatBRL(r.simTotal * USD_BRL)}
                      </td>
                      <td className="px-3 py-2.5">
                        <BarFill pct={(r.simTotal / simTotal) * 100} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Detail drawer */}
      <Sheet open={!!selected} onOpenChange={(o) => { if (!o) setSelected(null); }}>
        <SheetContent className="w-[340px] sm:w-[400px] overflow-y-auto">
          {selected && (
            <>
              <SheetHeader className="pb-4">
                <div className="flex items-center gap-3">
                  <Avatar nome={selected.nome} url={selected.avatar_url} size={44} />
                  <div>
                    <SheetTitle>{selected.nome}</SheetTitle>
                    {selected.hashtag && (
                      <p className="text-xs text-muted-foreground mt-0.5">#{selected.hashtag}</p>
                    )}
                  </div>
                </div>
              </SheetHeader>

              <div className="space-y-4">
                {/* Revenue breakdown */}
                <div className="rounded-lg border border-border bg-muted/30 divide-y divide-border">
                  <DrawerRow label="Posts publicados" value={String(selected.postCount)} />
                  <DrawerRow label="Split %" value={`${selected.splitPct.toFixed(0)}%`} />
                </div>

                <div className="rounded-lg border border-border bg-muted/30 divide-y divide-border">
                  <DrawerRow
                    label="Receita dos Posts (USD)"
                    value={`$${selected.postsRevenue.toFixed(2)}`}
                    highlight
                  />
                  <DrawerRow
                    label="Receita dos Posts (BRL)"
                    value={formatBRL(selected.postsRevenue * USD_BRL)}
                  />
                </div>

                <div className="rounded-lg border border-border bg-muted/30 divide-y divide-border">
                  <DrawerRow
                    label="Participação Histórica"
                    value={formatPct(selected.historicalPct)}
                  />
                  <DrawerRow
                    label="Receita Residual (USD)"
                    value={`$${selected.residualShare.toFixed(2)}`}
                    highlight
                  />
                  <DrawerRow
                    label="Receita Residual (BRL)"
                    value={formatBRL(selected.residualShare * USD_BRL)}
                  />
                </div>

                <div className="rounded-lg border border-orange-500/30 bg-orange-500/5 divide-y divide-orange-500/20">
                  <DrawerRow
                    label="Receita Total (USD)"
                    value={`$${selected.totalUsd.toFixed(2)}`}
                    highlight
                    orange
                  />
                  <DrawerRow
                    label="Receita Total (BRL)"
                    value={formatBRL(selected.totalBrl)}
                    orange
                  />
                </div>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function DrawerRow({
  label,
  value,
  highlight = false,
  orange = false,
}: {
  label: string;
  value: string;
  highlight?: boolean;
  orange?: boolean;
}) {
  return (
    <div className="flex items-center justify-between px-3 py-2.5">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span
        className={
          orange
            ? "text-sm font-semibold text-orange-400 tabular-nums"
            : highlight
            ? "text-sm font-semibold tabular-nums"
            : "text-sm tabular-nums"
        }
      >
        {value}
      </span>
    </div>
  );
}
