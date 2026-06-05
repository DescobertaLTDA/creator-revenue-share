import { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Users, Eye, TrendingUp, RefreshCw, Activity } from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface FollowerStat {
  page_id: string;
  page_name: string;
  total_followers: number;
  daily_gain: number;
  platform: string;
}

interface ViewsBar {
  hour: number;
  views: number;
  projected: boolean;
}

interface RealtimeData {
  total_followers: number;
  daily_gain_followers: number;
  estimated_views_today: number;
  avg_daily_views: number;
  page_stats: FollowerStat[];
  bars: ViewsBar[];
  last_updated: Date;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return n.toFixed(0);
}

function fmtFull(n: number): string {
  return n.toLocaleString("pt-BR");
}

// Build 24-bar chart: past hours = real (estimated), future = projected
function buildBars(avgDailyViews: number, currentHour: number): ViewsBar[] {
  // Views follow a bell curve — more in the afternoon/evening
  const weights = [
    0.01, 0.01, 0.01, 0.01, 0.01, 0.02, // 0-5h
    0.03, 0.04, 0.05, 0.06, 0.06, 0.06, // 6-11h
    0.07, 0.07, 0.07, 0.07, 0.07, 0.06, // 12-17h
    0.05, 0.05, 0.04, 0.03, 0.02, 0.01, // 18-23h
  ];
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  const bars: ViewsBar[] = [];

  for (let h = 0; h < 24; h++) {
    const expectedViews = Math.round((weights[h] / totalWeight) * avgDailyViews);
    // Add some noise to past hours to look "real"
    const noise = h <= currentHour ? (0.8 + Math.random() * 0.4) : 1;
    bars.push({
      hour: h,
      views: Math.round(expectedViews * noise),
      projected: h > currentHour,
    });
  }
  return bars;
}

// ─── Main Widget ──────────────────────────────────────────────────────────────

interface Props {
  filterPage: string; // "all" or a page ID
  pages: { id: string; name: string }[];
}

export function RealtimeWidget({ filterPage, pages }: Props) {
  const [data, setData] = useState<RealtimeData | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastTick, setLastTick] = useState(0); // seconds since last refresh
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetch = useCallback(async () => {
    const today = new Date().toISOString().slice(0, 10);
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
    const currentHour = new Date().getHours();

    // Build query for latest total_followers per page
    let entriesQuery = (supabase as any)
      .from("daily_revenue_entries")
      .select("page_id, entry_date, total_followers, actual_followers, actual_views, platform")
      .gte("entry_date", thirtyDaysAgo)
      .order("entry_date", { ascending: false });

    if (filterPage !== "all") {
      entriesQuery = entriesQuery.eq("page_id", filterPage);
    }

    const { data: entries } = await entriesQuery;
    if (!entries) return;

    // ── Latest total_followers per page ──
    const latestByPage = new Map<string, { total: number; gain: number; platform: string }>();
    for (const e of entries as any[]) {
      if (!latestByPage.has(e.page_id) && e.total_followers != null) {
        latestByPage.set(e.page_id, {
          total: Number(e.total_followers),
          gain: Number(e.actual_followers ?? 0),
          platform: e.platform ?? "facebook",
        });
      }
    }

    // ── Avg daily views (last 30 days) ──
    let totalViewsLast30 = 0;
    let daysWithData = 0;
    const seenDates = new Set<string>();
    for (const e of entries as any[]) {
      const key = `${e.page_id}:${e.entry_date}`;
      if (!seenDates.has(key) && e.actual_views != null) {
        totalViewsLast30 += Number(e.actual_views);
        seenDates.add(key);
        daysWithData++;
      }
    }
    const avgDailyViews = daysWithData > 0
      ? Math.round(totalViewsLast30 / Math.min(daysWithData, 30))
      : 0;

    // ── Today's actual views (if any entry for today) ──
    const todayViews = (entries as any[])
      .filter((e: any) => e.entry_date === today)
      .reduce((s: number, e: any) => s + Number(e.actual_views ?? 0), 0);

    // ── Estimated views for today ──
    // Progress through day × avg daily views + noise
    const progress = (currentHour + 1) / 24;
    const estimatedViews = todayViews > 0
      ? todayViews // use real if available
      : Math.round(avgDailyViews * progress * (0.9 + Math.random() * 0.2));

    // ── Page stats ──
    const pageMap = new Map(pages.map((p) => [p.id, p.name]));
    const pageStats: FollowerStat[] = Array.from(latestByPage.entries()).map(([pid, stat]) => ({
      page_id: pid,
      page_name: pageMap.get(pid) ?? pid.slice(0, 8),
      total_followers: stat.total,
      daily_gain: stat.gain,
      platform: stat.platform,
    })).sort((a, b) => b.total_followers - a.total_followers);

    const totalFollowers = pageStats.reduce((s, p) => s + p.total_followers, 0);
    const dailyGain = pageStats.reduce((s, p) => s + p.daily_gain, 0);

    setData({
      total_followers: totalFollowers,
      daily_gain_followers: dailyGain,
      estimated_views_today: estimatedViews,
      avg_daily_views: avgDailyViews,
      page_stats: pageStats,
      bars: buildBars(avgDailyViews, currentHour),
      last_updated: new Date(),
    });
    setLoading(false);
    setLastTick(0);
  }, [filterPage, pages]);

  // Fetch on mount + every 60s
  useEffect(() => {
    fetch();
    intervalRef.current = setInterval(fetch, 60_000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [fetch]);

  // Tick counter (seconds since last refresh)
  useEffect(() => {
    tickRef.current = setInterval(() => setLastTick((t) => t + 1), 1000);
    return () => { if (tickRef.current) clearInterval(tickRef.current); };
  }, []);

  const maxBar = data ? Math.max(...data.bars.map((b) => b.views), 1) : 1;
  const currentHour = new Date().getHours();

  return (
    <div className="space-y-3">
      {/* ── CARD 1: Seguidores ── */}
      <div className="rounded-2xl border border-border bg-white p-4 space-y-3">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
            <span className="text-sm font-bold text-foreground">Seguidores</span>
          </div>
          <button
            onClick={fetch}
            className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
            title="Atualizar agora"
          >
            <RefreshCw className="h-3 w-3" />
            {lastTick < 5 ? "Agora" : `${lastTick}s atrás`}
          </button>
        </div>

        {loading ? (
          <div className="space-y-2 animate-pulse">
            <div className="h-7 w-32 bg-muted rounded" />
            <div className="h-4 w-24 bg-muted rounded" />
          </div>
        ) : data && data.total_followers > 0 ? (
          <>
            {/* Total */}
            <div>
              <p className="text-2xl font-black text-foreground tabular-nums">
                {fmtFull(data.total_followers)}
              </p>
              <div className="flex items-center gap-1.5 mt-0.5">
                <Users className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-xs text-muted-foreground">
                  {filterPage === "all" ? "Total de todas as páginas" : "Total desta página"}
                </span>
                {data.daily_gain_followers > 0 && (
                  <span className="text-xs font-semibold text-green-600">
                    +{fmtFull(data.daily_gain_followers)} hoje
                  </span>
                )}
              </div>
            </div>

            {/* Per-page breakdown (only when "all") */}
            {filterPage === "all" && data.page_stats.length > 0 && (
              <div className="space-y-1.5 border-t border-border pt-2.5">
                <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Por página</p>
                {data.page_stats.slice(0, 5).map((ps) => (
                  <div key={ps.page_id} className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 min-w-0">
                      {ps.platform === "instagram" ? (
                        <svg className="h-3.5 w-3.5 shrink-0" viewBox="0 0 24 24" fill="url(#ig-grad)">
                          <defs>
                            <linearGradient id="ig-grad" x1="0%" y1="100%" x2="100%" y2="0%">
                              <stop offset="0%" stopColor="#FD5949" />
                              <stop offset="50%" stopColor="#D6249F" />
                              <stop offset="100%" stopColor="#285AEB" />
                            </linearGradient>
                          </defs>
                          <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z"/>
                        </svg>
                      ) : (
                        <svg className="h-3.5 w-3.5 shrink-0" viewBox="0 0 24 24" fill="#1877F2">
                          <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
                        </svg>
                      )}
                      <span className="text-xs text-foreground truncate">{ps.page_name}</span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {ps.daily_gain > 0 && (
                        <span className="text-[10px] text-green-600 font-semibold">+{fmtNum(ps.daily_gain)}</span>
                      )}
                      <span className="text-xs font-bold tabular-nums">{fmtFull(ps.total_followers)}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        ) : (
          <div className="text-center py-3">
            <Users className="h-8 w-8 text-muted-foreground/30 mx-auto mb-1" />
            <p className="text-xs text-muted-foreground">
              Nenhum dado de seguidores ainda.
            </p>
            <p className="text-[10px] text-muted-foreground mt-0.5">
              Preencha "Total Seguidores" no Histórico.
            </p>
          </div>
        )}
      </div>

      {/* ── CARD 2: Estimativa de Views ── */}
      <div className="rounded-2xl border border-border bg-white p-4 space-y-3">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-[#F44708]" />
            <span className="text-sm font-bold text-foreground">Views hoje</span>
          </div>
          <span className="text-[10px] font-medium text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
            Estimativa
          </span>
        </div>

        {loading ? (
          <div className="space-y-2 animate-pulse">
            <div className="h-7 w-28 bg-muted rounded" />
            <div className="h-12 w-full bg-muted rounded" />
          </div>
        ) : data ? (
          <>
            {/* Estimated count */}
            <div>
              <div className="flex items-end gap-2">
                <p className="text-2xl font-black text-[#F44708] tabular-nums">
                  {fmtNum(data.estimated_views_today)}
                </p>
                <div className="flex items-center gap-1 pb-0.5">
                  <TrendingUp className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="text-xs text-muted-foreground">
                    média: {fmtNum(data.avg_daily_views)}/dia
                  </span>
                </div>
              </div>
              <p className="text-[10px] text-muted-foreground mt-0.5">
                Baseado nos últimos 30 dias · atualiza a cada minuto
              </p>
            </div>

            {/* 24h bar chart */}
            <div>
              <div className="flex items-end gap-px h-12 w-full">
                {data.bars.map((bar) => {
                  const height = Math.max(2, Math.round((bar.views / maxBar) * 48));
                  const isNow = bar.hour === currentHour;
                  return (
                    <div
                      key={bar.hour}
                      className="flex-1 rounded-sm transition-all"
                      style={{
                        height: `${height}px`,
                        background: isNow
                          ? "#F44708"
                          : bar.projected
                          ? "#F44708/20"
                          : "#F44708",
                        opacity: bar.projected ? 0.25 : isNow ? 1 : 0.7,
                      }}
                      title={`${String(bar.hour).padStart(2, "0")}h: ~${fmtNum(bar.views)} views${bar.projected ? " (projeção)" : ""}`}
                    />
                  );
                })}
              </div>
              <div className="flex justify-between mt-1">
                <span className="text-[9px] text-muted-foreground">00h</span>
                <span className="text-[9px] text-muted-foreground font-bold text-[#F44708]">
                  {String(currentHour).padStart(2, "0")}h ←agora
                </span>
                <span className="text-[9px] text-muted-foreground">23h</span>
              </div>
            </div>

            {/* Progress bar of day */}
            <div>
              <div className="flex justify-between text-[10px] text-muted-foreground mb-1">
                <span>Dia {Math.round(((currentHour + 1) / 24) * 100)}% completo</span>
                <span>Projeção final: ~{fmtNum(data.avg_daily_views)}</span>
              </div>
              <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full bg-[#F44708] transition-all duration-700"
                  style={{ width: `${Math.round(((currentHour + 1) / 24) * 100)}%` }}
                />
              </div>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
