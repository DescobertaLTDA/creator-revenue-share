import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState, useRef, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  ComposedChart, Area, Line, Bar, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid, ReferenceLine,
} from "recharts";
import {
  Eye, TrendingUp, TrendingDown, Heart, ArrowUp, ArrowDown,
  Loader2, Play, ImageIcon, ChevronDown, ChevronRight,
  BarChart2, Zap, Target, Info, DollarSign, Users, Share2,
  MessageSquare, Bookmark, UserPlus,
  X, Trash2, Link2, CheckCircle2, Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/admin/posts")({
  head: () => ({ meta: [{ title: "Analytics — Splash Creators" }] }),
  component: AnalyticsPage,
});

// ─── Types ────────────────────────────────────────────────────────────────────

type Platform = "all" | "facebook" | "instagram";

interface PostRow {
  id: string;
  page_id: string;
  published_at: string | null;
  title: string | null;
  description: string | null;
  post_type: string | null;
  source: string | null;
  views: number | null;
  reach: number | null;
  reactions: number | null;
  comments: number | null;
  shares: number | null;
  saves: number | null;
  follows_gained: number | null;
  monetization_approx: number | null;
  estimated_usd: number | null;
  watch_seconds_avg: number | null;
  video_duration_s: number | null;
  thumbnail_url: string | null;
  pages: { nome: string; id: string } | null;
}

interface MonthPoint {
  label: string;
  month: string;
  posts: number;
  views: number;
  revenue: number;
  reactions: number;
  comments: number;
  shares: number;
  rpm: number;
  avgViews: number;
  // trend lines (filled by regression)
  viewsTrend?: number;
  revenueTrend?: number;
  rpmTrend?: number;
  avgViewsTrend?: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function fetchAllRows<T>(query: () => any): Promise<T[]> {
  const PAGE = 1000;
  let from = 0;
  const all: T[] = [];
  while (true) {
    const { data, error } = await query().range(from, from + PAGE - 1);
    if (error || !data || data.length === 0) break;
    all.push(...data);
    if (data.length < PAGE) break;
    from += data.length;
  }
  return all;
}

function postUsd(p: PostRow): number {
  const m = Number(p.monetization_approx ?? 0);
  const e = Number(p.estimated_usd ?? 0);
  return m > 0 ? m : e;
}

function isVideo(p: PostRow): boolean {
  const t = (p.post_type ?? "").toLowerCase();
  return t.includes("video") || t.includes("vídeo") || t.includes("reel");
}

const USD_TO_BRL = 5.02;

const fmtV = (n: number): string =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M`
  : n >= 1_000 ? `${(n / 1_000).toFixed(1)}k`
  : n.toFixed(0);

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

const fmtBRL = (usd: number, compact = true): string => {
  const brl = usd * USD_TO_BRL;
  if (!compact) return `R$ ${brl.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (brl >= 1_000_000) return `R$ ${(brl / 1_000_000).toFixed(1)}M`;
  if (brl >= 1_000)     return `R$ ${(brl / 1_000).toFixed(1)}k`;
  return `R$ ${brl.toFixed(2)}`;
};

/** Simple linear regression — returns y-values for the same x indices */
function linReg(data: number[]): number[] {
  const n = data.length;
  if (n < 2) return [...data];
  const sumX  = (n * (n - 1)) / 2;
  const sumX2 = (n * (n - 1) * (2 * n - 1)) / 6;
  const sumY  = data.reduce((s, v) => s + v, 0);
  const sumXY = data.reduce((s, v, i) => s + i * v, 0);
  const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
  const intercept = (sumY - slope * sumX) / n;
  return data.map((_, i) => Math.max(0, intercept + slope * i));
}

const MONTHS_SHORT = ["jan","fev","mar","abr","mai","jun","jul","ago","set","out","nov","dez"];
function shortMonth(key: string): string {
  const [y, m] = key.split("-");
  return `${MONTHS_SHORT[Number(m) - 1]}/${y.slice(2)}`;
}

// ─── Shared chart tooltip ──────────────────────────────────────────────────────

function ChartTip({ active, payload, label, fmtY }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-border rounded-xl shadow-lg px-4 py-3 min-w-[160px]">
      <p className="text-xs font-bold text-muted-foreground mb-2">{label}</p>
      {payload.map((p: any) =>
        p.value != null && (
          <div key={p.name} className="flex items-center justify-between gap-4 text-xs">
            <span className="flex items-center gap-1.5">
              <div className="h-2 w-2 rounded-full shrink-0" style={{ background: p.color }} />
              <span className="text-muted-foreground">{
                p.name === "views" ? "Views" :
                p.name === "viewsTrend" ? "Tendência" :
                p.name === "revenue" ? "Receita (USD)" :
                p.name === "revenueTrend" ? "Tendência" :
                p.name === "rpm" ? "RPM" :
                p.name === "rpmTrend" ? "Tendência" :
                p.name === "avgViews" ? "Views/post" :
                p.name === "avgViewsTrend" ? "Tendência" :
                p.name === "reactions" ? "Reações" :
                p.name === "comments" ? "Comentários" :
                p.name === "shares" ? "Compartilhamentos" :
                p.name === "posts" ? "Posts" : p.name
              }</span>
            </span>
            <span className="font-semibold">
              {typeof fmtY === "function" ? fmtY(p.value, p.name) : fmtV(p.value)}
            </span>
          </div>
        )
      )}
    </div>
  );
}

// ─── KPI card (identical to Projeções) ───────────────────────────────────────

function KpiCard({ label, value, sub, trend, highlight }: {
  label: string; value: string; sub: string;
  trend?: "up" | "down" | null; highlight?: boolean;
}) {
  return (
    <div className="rounded-2xl border border-border bg-white p-4 flex flex-col gap-2">
      <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="text-2xl font-black leading-none tracking-tight">{value}</p>
      <div className="flex items-center gap-1">
        {trend === "up" && <TrendingUp className="h-3 w-3 text-[#F44708] shrink-0" />}
        {trend === "down" && <TrendingDown className="h-3 w-3 text-muted-foreground shrink-0" />}
        <p className={cn("text-[10px]", highlight ? "text-[#F44708] font-semibold" : "text-muted-foreground")}>{sub}</p>
      </div>
    </div>
  );
}

// ─── Page dropdown (same as Projeções) ────────────────────────────────────────

function PageDropdown({ pages, value, onChange }: {
  pages: { id: string; nome: string }[]; value: string; onChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const sel = pages.find((p) => p.id === value);

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 h-9 px-3 rounded-xl border border-border bg-white text-sm font-medium hover:bg-accent transition-colors min-w-[170px]"
      >
        <span className="truncate flex-1 text-left text-xs">{sel?.nome ?? "Todas as páginas"}</span>
        <ChevronDown className={cn("h-3.5 w-3.5 text-muted-foreground shrink-0 transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 bg-white rounded-xl border border-border py-1 min-w-[220px] shadow-lg max-h-72 overflow-y-auto">
          <button
            onClick={() => { onChange("all"); setOpen(false); }}
            className={cn("w-full px-3 py-2 text-left text-sm transition-colors hover:bg-muted",
              value === "all" && "bg-[#FFF0E8] text-[#F44708] font-semibold")}
          >
            Todas as páginas
          </button>
          {pages.map((p) => (
            <button key={p.id} onClick={() => { onChange(p.id); setOpen(false); }}
              className={cn("w-full px-3 py-2 text-left text-sm transition-colors hover:bg-muted truncate",
                p.id === value && "bg-[#FFF0E8] text-[#F44708] font-semibold")}>
              {p.nome}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Platform toggle ──────────────────────────────────────────────────────────

function PlatformToggle({ value, onChange }: { value: Platform; onChange: (p: Platform) => void }) {
  return (
    <div className="flex items-center bg-muted rounded-xl p-0.5 shrink-0">
      {(["all", "facebook", "instagram"] as Platform[]).map((p) => (
        <button
          key={p}
          onClick={() => onChange(p)}
          className={cn(
            "px-3 py-1.5 rounded-lg text-xs font-semibold transition-all whitespace-nowrap",
            value === p ? "bg-white shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
          )}
        >
          {p === "all" ? "Todos" : p === "facebook" ? "Facebook" : "Instagram"}
        </button>
      ))}
    </div>
  );
}

// ─── Hero card (same gradient style as Projeções) ────────────────────────────

function HeroCard({ totalViews, totalRevenue, totalPosts, momViews, momRevenue, isIG, periodLabel }: {
  totalViews: number; totalRevenue: number; totalPosts: number;
  momViews: number | null; momRevenue: number | null;
  isIG: boolean; periodLabel: string;
}) {
  const viewsMom = momViews != null ? momViews : null;
  const revMom   = momRevenue != null ? momRevenue : null;

  return (
    <div className="rounded-2xl overflow-hidden relative"
      style={{ background: "linear-gradient(135deg, #F44708 0%, #E84A10 40%, #C03A08 100%)" }}>
      <div className="absolute -top-10 -right-10 h-64 w-64 rounded-full opacity-10"
        style={{ background: "radial-gradient(circle, #fff 0%, transparent 70%)" }} />
      <div className="px-6 py-5 flex items-center gap-6 flex-wrap relative">

        {/* Views */}
        <div className="shrink-0">
          <p className="text-[10px] font-bold uppercase tracking-widest text-white/60 mb-1">Views no período</p>
          <p className="text-4xl font-black tracking-tight text-white leading-none">{fmtV(totalViews)}</p>
          {viewsMom != null && (
            <div className="flex items-center gap-1 mt-1">
              {viewsMom >= 0
                ? <ArrowUp className="h-3 w-3 text-white/70" />
                : <ArrowDown className="h-3 w-3 text-white/70" />}
              <span className="text-[11px] text-white/70 font-semibold">
                {Math.abs(viewsMom).toFixed(1)}% vs mês ant.
              </span>
            </div>
          )}
        </div>

        <div className="w-px h-10 bg-white/20 shrink-0 hidden sm:block" />

        {/* Posts */}
        <div className="shrink-0">
          <p className="text-[10px] font-bold uppercase tracking-widest text-white/60 mb-1">Posts publicados</p>
          <p className="text-2xl font-black text-white leading-none">{totalPosts}</p>
          <p className="text-[11px] text-white/60 mt-0.5">{fmtV(totalPosts > 0 ? totalViews / totalPosts : 0)} views/post</p>
        </div>

        {!isIG && (
          <>
            <div className="w-px h-10 bg-white/20 shrink-0 hidden sm:block" />
            <div className="shrink-0">
              <p className="text-[10px] font-bold uppercase tracking-widest text-white/60 mb-1">Receita no período</p>
              <p className="text-2xl font-black text-white leading-none">{fmtBRL(totalRevenue)}</p>
              {revMom != null && (
                <div className="flex items-center gap-1 mt-1">
                  {revMom >= 0
                    ? <ArrowUp className="h-3 w-3 text-white/70" />
                    : <ArrowDown className="h-3 w-3 text-white/70" />}
                  <span className="text-[11px] text-white/70 font-semibold">
                    {Math.abs(revMom).toFixed(1)}% vs mês ant.
                  </span>
                </div>
              )}
            </div>
          </>
        )}

        <div className="ml-auto shrink-0">
          <span className="inline-flex items-center gap-1.5 text-[11px] font-bold px-3 py-1.5 rounded-full bg-white/15 text-white/90">
            {periodLabel}
          </span>
        </div>
      </div>
    </div>
  );
}

// ─── Chart legend row (same pattern as Projeções) ────────────────────────────

function Legend({ items }: { items: { label: string; color: string; dashed?: boolean }[] }) {
  return (
    <div className="flex items-center gap-3 flex-wrap text-[10px] text-muted-foreground">
      {items.map((item) => (
        <span key={item.label} className="flex items-center gap-1.5">
          {item.dashed
            ? <span className="inline-block w-5 border-t-2 border-dashed" style={{ borderColor: item.color }} />
            : <span className="inline-block h-0.5 w-5 rounded" style={{ background: item.color }} />}
          {item.label}
        </span>
      ))}
    </div>
  );
}

// ─── Main analytics chart (Views) ─────────────────────────────────────────────

function ViewsTrendChart({ data }: { data: MonthPoint[] }) {
  return (
    <div className="rounded-2xl border border-border bg-white p-5">
      <div className="flex items-start justify-between flex-wrap gap-3 mb-4">
        <div>
          <p className="text-sm font-semibold">Evolução de Views</p>
          <p className="text-xs text-muted-foreground mt-0.5">Total mensal acumulado</p>
        </div>
        <Legend items={[
          { label: "Views realizados", color: "#F44708" },
          { label: "Linha de tendência", color: "#F44708", dashed: true },
        ]} />
      </div>
      <ResponsiveContainer width="100%" height={230}>
        <ComposedChart data={data} margin={{ top: 4, right: 4, left: 0, bottom: 4 }}>
          <defs>
            <linearGradient id="aViewsFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#F44708" stopOpacity={0.18} />
              <stop offset="95%" stopColor="#F44708" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#F4F4F4" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 9, fill: "#aaa" }} axisLine={false} tickLine={false} />
          <YAxis tickFormatter={fmtV} tick={{ fontSize: 9, fill: "#aaa" }} axisLine={false} tickLine={false} width={40} />
          <Tooltip content={<ChartTip fmtY={(v: number) => fmtV(v)} />} />
          <Area dataKey="views" stroke="#F44708" strokeWidth={2.5} fill="url(#aViewsFill)"
            dot={false} activeDot={{ r: 4, fill: "#F44708" }} />
          <Line dataKey="viewsTrend" stroke="#F44708" strokeWidth={1.5} strokeDasharray="7 4"
            dot={false} connectNulls />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

// ─── Revenue trend chart ───────────────────────────────────────────────────────

function RevenueTrendChart({ data }: { data: MonthPoint[] }) {
  return (
    <div className="rounded-2xl border border-border bg-white p-5">
      <div className="flex items-start justify-between flex-wrap gap-3 mb-4">
        <div>
          <p className="text-sm font-semibold">Evolução de Receita</p>
          <p className="text-xs text-muted-foreground mt-0.5">Receita mensal em USD</p>
        </div>
        <Legend items={[
          { label: "Receita real", color: "#10b981" },
          { label: "Tendência", color: "#10b981", dashed: true },
        ]} />
      </div>
      <ResponsiveContainer width="100%" height={200}>
        <ComposedChart data={data} margin={{ top: 4, right: 4, left: 0, bottom: 4 }}>
          <defs>
            <linearGradient id="aRevFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#10b981" stopOpacity={0.18} />
              <stop offset="95%" stopColor="#10b981" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#F4F4F4" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 9, fill: "#aaa" }} axisLine={false} tickLine={false} />
          <YAxis tickFormatter={(v) => `$${v.toFixed(0)}`} tick={{ fontSize: 9, fill: "#aaa" }} axisLine={false} tickLine={false} width={40} />
          <Tooltip content={<ChartTip fmtY={(v: number) => `$${v.toFixed(2)}`} />} />
          <Area dataKey="revenue" stroke="#10b981" strokeWidth={2.5} fill="url(#aRevFill)"
            dot={false} activeDot={{ r: 4, fill: "#10b981" }} />
          <Line dataKey="revenueTrend" stroke="#10b981" strokeWidth={1.5} strokeDasharray="7 4"
            dot={false} connectNulls />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

// ─── RPM trend chart ──────────────────────────────────────────────────────────

function RpmTrendChart({ data }: { data: MonthPoint[] }) {
  const maxRpm = Math.max(...data.map((d) => d.rpm), 0.06);
  return (
    <div className="rounded-2xl border border-border bg-white p-5">
      <div className="flex items-start justify-between flex-wrap gap-3 mb-4">
        <div>
          <p className="text-sm font-semibold">RPM Mensal</p>
          <p className="text-xs text-muted-foreground mt-0.5">Receita por mil visualizações</p>
        </div>
        <Legend items={[
          { label: "RPM real", color: "#FAA613" },
          { label: "Tendência", color: "#FAA613", dashed: true },
          { label: "Meta $0.06", color: "#94a3b8", dashed: true },
        ]} />
      </div>
      <ResponsiveContainer width="100%" height={200}>
        <ComposedChart data={data} margin={{ top: 4, right: 4, left: 0, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#F4F4F4" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 9, fill: "#aaa" }} axisLine={false} tickLine={false} />
          <YAxis
            tickFormatter={(v) => `$${v.toFixed(3)}`}
            tick={{ fontSize: 9, fill: "#aaa" }} axisLine={false} tickLine={false} width={44}
            domain={[0, Math.max(maxRpm * 1.2, 0.1)]}
          />
          <Tooltip content={<ChartTip fmtY={(v: number) => `$${v.toFixed(4)}`} />} />
          <ReferenceLine y={0.06} stroke="#94a3b8" strokeDasharray="5 3" strokeWidth={1.5} />
          <Line dataKey="rpm" stroke="#FAA613" strokeWidth={2.5}
            dot={{ r: 3, fill: "#FAA613", strokeWidth: 0 }} activeDot={{ r: 5, fill: "#FAA613" }}
            connectNulls />
          <Line dataKey="rpmTrend" stroke="#FAA613" strokeWidth={1.5} strokeDasharray="7 4"
            dot={false} connectNulls />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

// ─── Views per post efficiency chart ─────────────────────────────────────────

function EfficiencyChart({ data }: { data: MonthPoint[] }) {
  return (
    <div className="rounded-2xl border border-border bg-white p-5">
      <div className="flex items-start justify-between flex-wrap gap-3 mb-4">
        <div>
          <p className="text-sm font-semibold">Views por Post</p>
          <p className="text-xs text-muted-foreground mt-0.5">Eficiência média mensal</p>
        </div>
        <Legend items={[
          { label: "Média real", color: "#93c5fd" },
          { label: "Tendência", color: "#93c5fd", dashed: true },
        ]} />
      </div>
      <ResponsiveContainer width="100%" height={200}>
        <ComposedChart data={data} margin={{ top: 4, right: 4, left: 0, bottom: 4 }}>
          <defs>
            <linearGradient id="aEffFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#93c5fd" stopOpacity={0.22} />
              <stop offset="95%" stopColor="#93c5fd" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#F4F4F4" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 9, fill: "#aaa" }} axisLine={false} tickLine={false} />
          <YAxis tickFormatter={fmtV} tick={{ fontSize: 9, fill: "#aaa" }} axisLine={false} tickLine={false} width={40} />
          <Tooltip content={<ChartTip fmtY={(v: number) => fmtV(v)} />} />
          <Area dataKey="avgViews" stroke="#93c5fd" strokeWidth={2} fill="url(#aEffFill)"
            dot={false} activeDot={{ r: 4, fill: "#93c5fd" }} />
          <Line dataKey="avgViewsTrend" stroke="#93c5fd" strokeWidth={1.5} strokeDasharray="7 4"
            dot={false} connectNulls />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

// ─── Engagement multi-line chart ──────────────────────────────────────────────

function EngagementChart({ data }: { data: MonthPoint[] }) {
  return (
    <div className="rounded-2xl border border-border bg-white p-5">
      <div className="flex items-start justify-between flex-wrap gap-3 mb-4">
        <div>
          <p className="text-sm font-semibold">Engajamento Mensal</p>
          <p className="text-xs text-muted-foreground mt-0.5">Reações, comentários e compartilhamentos</p>
        </div>
        <Legend items={[
          { label: "Reações", color: "#F44708" },
          { label: "Comentários", color: "#FAA613" },
          { label: "Compartilhamentos", color: "#94a3b8" },
        ]} />
      </div>
      <ResponsiveContainer width="100%" height={200}>
        <ComposedChart data={data} margin={{ top: 4, right: 4, left: 0, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#F4F4F4" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 9, fill: "#aaa" }} axisLine={false} tickLine={false} />
          <YAxis tickFormatter={fmtV} tick={{ fontSize: 9, fill: "#aaa" }} axisLine={false} tickLine={false} width={40} />
          <Tooltip content={<ChartTip fmtY={(v: number) => fmtV(v)} />} />
          <Line dataKey="reactions" name="reactions" stroke="#F44708" strokeWidth={2}
            dot={{ r: 2, fill: "#F44708", strokeWidth: 0 }} activeDot={{ r: 4 }} connectNulls />
          <Line dataKey="comments" name="comments" stroke="#FAA613" strokeWidth={2}
            dot={{ r: 2, fill: "#FAA613", strokeWidth: 0 }} activeDot={{ r: 4 }} connectNulls />
          <Line dataKey="shares" name="shares" stroke="#94a3b8" strokeWidth={2}
            dot={{ r: 2, fill: "#94a3b8", strokeWidth: 0 }} activeDot={{ r: 4 }} connectNulls />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

// ─── Posts per month bar chart ────────────────────────────────────────────────

function PostsBarChart({ data }: { data: MonthPoint[] }) {
  const curMonth = new Date().toISOString().slice(0, 7);
  return (
    <div className="rounded-2xl border border-border bg-white p-5">
      <div className="flex items-start justify-between flex-wrap gap-3 mb-4">
        <div>
          <p className="text-sm font-semibold">Posts Publicados</p>
          <p className="text-xs text-muted-foreground mt-0.5">Cadência mensal de publicação</p>
        </div>
        <Legend items={[
          { label: "Posts", color: "#F44708" },
          { label: "Tendência", color: "#F44708", dashed: true },
        ]} />
      </div>
      <ResponsiveContainer width="100%" height={200}>
        <ComposedChart data={data} margin={{ top: 4, right: 4, left: 0, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#F4F4F4" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 9, fill: "#aaa" }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fontSize: 9, fill: "#aaa" }} axisLine={false} tickLine={false} width={30} />
          <Tooltip content={<ChartTip fmtY={(v: number) => String(Math.round(v))} />} />
          <Bar dataKey="posts" name="posts" fill="#F44708" radius={[3, 3, 0, 0]}
            fillOpacity={0.85}
            // Highlight current month
            label={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

// ─── Page ranking panel (like ScenariosPanel in Projeções) ───────────────────

function PageRankingPanel({ ranking, isIG }: {
  ranking: { id: string; nome: string; posts: number; views: number; revenue: number }[];
  isIG: boolean;
}) {
  const [showAll, setShowAll] = useState(false);
  const shown = showAll ? ranking : ranking.slice(0, 5);
  const maxV = ranking[0]?.views || 1;

  return (
    <div className="rounded-2xl border border-border bg-white p-5 flex flex-col gap-4">
      <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
        Ranking de páginas
      </p>
      <div className="space-y-2 flex-1">
        {shown.map((pg, idx) => {
          const barW = Math.round((pg.views / maxV) * 100);
          return (
            <div key={pg.id}
              className={cn("rounded-xl p-3", idx === 0 ? "bg-[#FFF8F2] border border-[#FAA613]/30" : "bg-muted/30")}>
              <div className="flex items-center justify-between mb-1.5">
                <span className={cn("text-xs font-bold truncate max-w-[140px]",
                  idx === 0 ? "text-[#F44708]" : idx < 3 ? "text-foreground" : "text-muted-foreground")}>
                  {idx + 1}. {pg.nome}
                </span>
                <span className="text-xs font-bold text-foreground tabular-nums shrink-0 ml-2">{fmtV(pg.views)}</span>
              </div>
              <div className="h-1 bg-border rounded-full overflow-hidden">
                <div className="h-full rounded-full" style={{ width: `${barW}%`, background: idx === 0 ? "#F44708" : "#FAA613" }} />
              </div>
              {!isIG && pg.revenue > 0 && (
                <p className="text-[10px] text-muted-foreground mt-1">{fmtBRL(pg.revenue)} · {pg.posts} posts</p>
              )}
            </div>
          );
        })}
      </div>
      {ranking.length > 5 && (
        <button onClick={() => setShowAll((v) => !v)}
          className="flex items-center justify-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors pt-1 border-t border-border">
          {showAll ? "Ver menos" : `Ver todas (${ranking.length})`}
          <ChevronRight className={cn("h-3.5 w-3.5 transition-transform", showAll && "rotate-90")} />
        </button>
      )}
    </div>
  );
}

// ─── Content format panel (like ScenariosPanel) ───────────────────────────────

function ContentFormatPanel({ vidCount, photoCount, vidViews, photoViews, vidRevenue, photoRevenue, isIG }: {
  vidCount: number; photoCount: number;
  vidViews: number; photoViews: number;
  vidRevenue: number; photoRevenue: number;
  isIG: boolean;
}) {
  const total = vidCount + photoCount || 1;
  const items = [
    {
      label: "Vídeos / Reels", count: vidCount, views: vidViews, revenue: vidRevenue,
      color: "text-[#F44708]", bg: "bg-[#FFF8F2] border border-[#FAA613]/30",
      icon: Play, pct: Math.round((vidCount / total) * 100),
    },
    {
      label: "Fotos / Imagens", count: photoCount, views: photoViews, revenue: photoRevenue,
      color: "text-muted-foreground", bg: "bg-muted/30",
      icon: ImageIcon, pct: Math.round((photoCount / total) * 100),
    },
  ];

  return (
    <div className="rounded-2xl border border-border bg-white p-5 flex flex-col gap-4">
      <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
        Formato de conteúdo
      </p>
      <div className="space-y-2 flex-1 flex flex-col justify-center">
        {items.map((item) => {
          const Icon = item.icon;
          const avgV = item.count > 0 ? item.views / item.count : 0;
          return (
            <div key={item.label} className={cn("rounded-xl p-3.5", item.bg)}>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Icon className={cn("h-3.5 w-3.5", item.color)} />
                  <span className={cn("text-xs font-bold", item.color)}>{item.label}</span>
                  <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded-full">{item.pct}%</span>
                </div>
              </div>
              <p className="text-xl font-extrabold text-foreground">{item.count}</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                {fmtV(avgV)} views/post
                {!isIG && item.revenue > 0 && ` · ${fmtBRL(item.revenue)}`}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Platform badge ───────────────────────────────────────────────────────────

function PlatformBadge({ source }: { source: string | null }) {
  if (source === "instagram") {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-teal-50 text-teal-600 uppercase tracking-wide shrink-0">
        Instagram
      </span>
    );
  }
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-50 text-blue-600 uppercase tracking-wide shrink-0">
      Facebook
    </span>
  );
}

// ─── Post edit modal ──────────────────────────────────────────────────────────

function PostEditModal({
  post: initialPost,
  postIndex,
  onClose,
  onSaved,
}: {
  post: PostRow;
  postIndex: number;
  onClose: () => void;
  onSaved: (updated: PostRow) => void;
}) {
  const [post, setPost] = useState<PostRow>(initialPost);
  const [description, setDescription] = useState(initialPost.description ?? "");
  const [saving, setSaving] = useState(false);
  const [imgError, setImgError] = useState(false);
  const [imageUrlInput, setImageUrlInput] = useState("");

  const revenue = postUsd(post);
  const brl = revenue * USD_TO_BRL;

  // Close on Escape
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, [onClose]);

  const handleApplyUrl = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    if (!imageUrlInput.trim()) return;
    setPost((p) => ({ ...p, thumbnail_url: imageUrlInput.trim() }));
    setImgError(false);
    setImageUrlInput("");
  }, [imageUrlInput]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      const { error } = await supabase
        .from("posts")
        .update({ description: description || null, thumbnail_url: post.thumbnail_url } as any)
        .eq("id", post.id);
      if (!error) onSaved({ ...post, description: description || null });
    } catch {}
    setSaving(false);
  }, [description, post, onSaved]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-6"
      style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(6px)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      {/*
        Modal 16:9: max-w-5xl (~1024px) → height = 1024 × 9/16 = 576px
        Layout: header fixo + corpo em 2 colunas (imagem | controles)
      */}
      <div
        className="bg-white rounded-2xl w-full max-w-5xl shadow-2xl flex flex-col overflow-hidden"
        style={{ aspectRatio: "16 / 9" }}
      >
        {/* ── Header ── */}
        <div className="flex items-center gap-3 px-5 py-3 border-b border-border shrink-0">
          <div className="h-8 w-8 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0" style={{ background: "#F44708" }}>
            {postIndex + 1}
          </div>
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <p className="font-bold text-sm truncate">{post.pages?.nome ?? "Página"}</p>
            <span className="text-xs text-muted-foreground shrink-0">{fmtDate(post.published_at)}</span>
            <PlatformBadge source={post.source} />
          </div>
          <button onClick={onClose} className="h-7 w-7 rounded-full flex items-center justify-center text-muted-foreground hover:bg-muted transition-colors shrink-0">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* ── Body: 2 colunas ── */}
        <div className="flex-1 grid grid-cols-[1fr_1fr] min-h-0">

          {/* ── Coluna esquerda: imagem ocupa tudo ── */}
          <div className="relative bg-gray-100 overflow-hidden">
            {post.thumbnail_url && !imgError ? (
              <img
                src={post.thumbnail_url}
                alt="Thumbnail"
                className="absolute inset-0 w-full h-full object-cover"
                onError={() => setImgError(true)}
              />
            ) : (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-gray-300">
                <ImageIcon className="h-14 w-14" />
                <p className="text-sm text-gray-400">Sem imagem</p>
              </div>
            )}
          </div>

          {/* ── Coluna direita: controles, scrollável ── */}
          <div className="flex flex-col border-l border-border min-h-0">
            <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">

              {/* Info box */}
              {post.thumbnail_url && !imgError ? (
                <div className="bg-green-50 border border-green-200 rounded-xl px-3 py-2.5 flex items-start gap-2">
                  <CheckCircle2 className="h-3.5 w-3.5 text-green-600 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-[11px] font-bold text-green-700">IMAGEM ATUAL</p>
                    <p className="text-[11px] text-green-700 mt-0.5">Thumbnail vinculada a este post.</p>
                  </div>
                </div>
              ) : null}

              {/* Buttons */}
              <div className="flex flex-col gap-2">
                <button
                  onClick={() => document.getElementById("img-url-input")?.focus()}
                  className="flex items-center justify-center gap-2 h-9 rounded-xl text-sm font-semibold text-white w-full transition-opacity hover:opacity-90"
                  style={{ background: "#F44708" }}
                >
                  <ImageIcon className="h-4 w-4" />
                  Trocar imagem
                </button>
                {post.thumbnail_url && (
                  <button
                    onClick={() => { setPost((p) => ({ ...p, thumbnail_url: null })); setImgError(false); }}
                    className="flex items-center justify-center gap-2 h-9 rounded-xl text-sm font-medium border border-border bg-white hover:bg-red-50 hover:border-red-200 hover:text-red-600 transition-colors w-full"
                  >
                    <Trash2 className="h-4 w-4" />
                    Remover imagem
                  </button>
                )}
              </div>

              {/* URL import */}
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <div className="flex-1 h-px bg-border" />
                  <span className="text-[9px] font-bold text-muted-foreground uppercase tracking-wide whitespace-nowrap shrink-0">
                    OU IMPORTAR AUTOMATICAMENTE
                  </span>
                  <div className="flex-1 h-px bg-border" />
                </div>
                <div className="flex gap-2">
                  <div className="flex-1 relative">
                    <Link2 className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground pointer-events-none" />
                    <input
                      id="img-url-input"
                      type="text"
                      value={imageUrlInput}
                      onChange={(e) => setImageUrlInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          if (!imageUrlInput.trim()) return;
                          setPost((p) => ({ ...p, thumbnail_url: imageUrlInput.trim() }));
                          setImgError(false);
                          setImageUrlInput("");
                        }
                      }}
                      placeholder="URL da imagem (opcional)"
                      className="w-full h-8 pl-8 pr-2 rounded-lg border border-border bg-white text-xs focus:outline-none focus:ring-2 focus:ring-[#F44708]/30"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      if (!imageUrlInput.trim()) return;
                      setPost((p) => ({ ...p, thumbnail_url: imageUrlInput.trim() }));
                      setImgError(false);
                      setImageUrlInput("");
                    }}
                    className="h-8 px-3 rounded-lg text-xs font-semibold text-white bg-gray-900 hover:bg-gray-700 transition-colors flex items-center gap-1 shrink-0"
                  >
                    <Link2 className="h-3 w-3" />
                    Importar
                  </button>
                </div>
                <p className="text-[10px] text-muted-foreground mt-1 pl-1">Sem URL: busca automática pelo Google</p>
              </div>

              {/* Texto da imagem (OCR — futuro) */}
              <div className="rounded-xl border border-dashed border-border bg-muted/20 p-3 flex flex-col gap-2">
                <div className="flex items-center gap-1.5">
                  <Sparkles className="h-3.5 w-3.5 text-[#F44708]" />
                  <p className="text-[11px] font-bold text-foreground">Texto da imagem</p>
                  <span className="ml-auto text-[9px] font-semibold text-muted-foreground bg-muted px-2 py-0.5 rounded-full uppercase tracking-wide">
                    Em breve
                  </span>
                </div>
                <p className="text-[10px] text-muted-foreground leading-relaxed">
                  Extração automática do texto presente na imagem via API de OCR. Em breve disponível.
                </p>
                <button
                  disabled
                  className="flex items-center justify-center gap-1.5 h-7 rounded-lg text-[11px] font-semibold text-muted-foreground bg-muted cursor-not-allowed opacity-60 w-full"
                >
                  <Sparkles className="h-3 w-3" />
                  Extrair texto
                </button>
              </div>

              {/* Metrics */}
              <div className="grid grid-cols-4 gap-1.5">
                {([
                  { Icon: Eye,           label: "Views",   value: post.views,     color: "text-orange-500" },
                  { Icon: Heart,         label: "Reações", value: post.reactions, color: "text-rose-500" },
                  { Icon: MessageSquare, label: "Coment.", value: post.comments,  color: "text-blue-500" },
                  { Icon: Share2,        label: "Shares",  value: post.shares,    color: "text-green-500" },
                ] as const).map(({ Icon, label, value, color }) => (
                  <div key={label} className="rounded-xl border border-border bg-muted/20 p-2 flex flex-col items-center gap-1">
                    <Icon className={cn(`h-3.5 w-3.5 ${color}`)} />
                    <p className="text-xs font-bold text-foreground tabular-nums">{fmtV(Number(value ?? 0))}</p>
                    <p className="text-[9px] text-muted-foreground">{label}</p>
                  </div>
                ))}
              </div>

              {/* Revenue */}
              {revenue > 0 && (
                <div className="rounded-xl bg-green-50 border border-green-200 px-3 py-2 flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-green-700 font-bold text-xs">
                    <DollarSign className="h-3.5 w-3.5" />
                    {`R$ ${brl.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                  </div>
                  <span className="text-[11px] text-green-600 font-medium">${revenue.toFixed(2)} USD</span>
                </div>
              )}

              {/* Description */}
              <div className="flex flex-col gap-1.5 flex-1">
                <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Descrição</p>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  maxLength={2200}
                  placeholder="Escreva a descrição do post..."
                  className="flex-1 w-full min-h-[80px] px-3 py-2 rounded-xl border border-border text-xs leading-relaxed bg-white focus:outline-none focus:ring-2 focus:ring-[#F44708]/30 resize-none"
                />
                <p className="text-[10px] text-muted-foreground text-right">{description.length}/2200</p>
              </div>
            </div>

            {/* ── Footer ── */}
            <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-border shrink-0">
              <button onClick={onClose} className="h-9 px-4 rounded-xl border border-border bg-white text-xs font-medium hover:bg-muted transition-colors">
                Cancelar
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="h-9 px-4 rounded-xl text-xs font-semibold text-white flex items-center gap-1.5 transition-opacity disabled:opacity-60"
                style={{ background: "#F44708" }}
              >
                {saving
                  ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Salvando...</>
                  : <>Salvar alterações →</>
                }
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Top posts table ──────────────────────────────────────────────────────────

function TopPostsPanel({ posts, isIG, onEditPost }: {
  posts: { id: string; title: string | null; pageName: string; date: string; views: number; revenue: number; reactions: number; isVideo: boolean; watchAvg: number }[];
  isIG: boolean;
  onEditPost?: (postId: string) => void;
}) {
  return (
    <div className="rounded-2xl border border-border bg-white overflow-hidden">
      <div className="px-5 py-4 border-b border-border">
        <p className="text-sm font-semibold">Top Posts</p>
        <p className="text-xs text-muted-foreground mt-0.5">
          10 posts com maior volume de visualizações no período
          {onEditPost && <span className="ml-1 text-[#F44708]">· Clique para editar</span>}
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-muted/30 border-b border-border">
              <th className="px-4 py-2.5 text-left text-[10px] font-bold uppercase tracking-wider text-muted-foreground w-8">#</th>
              <th className="px-4 py-2.5 text-left text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Post</th>
              <th className="px-4 py-2.5 text-center text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Tipo</th>
              <th className="px-4 py-2.5 text-right text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Views</th>
              <th className="px-4 py-2.5 text-right text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Reações</th>
              {!isIG && <th className="px-4 py-2.5 text-right text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Receita</th>}
            </tr>
          </thead>
          <tbody>
            {posts.map((p, idx) => {
              const maxV = posts[0]?.views || 1;
              const barW = Math.round((p.views / maxV) * 100);
              return (
                <tr
                  key={p.id}
                  className={cn(
                    "border-b border-border/50 transition-colors",
                    onEditPost ? "cursor-pointer hover:bg-[#FFF8F2]" : "hover:bg-muted/20"
                  )}
                  onClick={() => onEditPost?.(p.id)}
                >
                  <td className="px-4 py-3">
                    <span className={cn("font-black text-[11px]",
                      idx === 0 ? "text-[#F44708]" : idx < 3 ? "text-[#FAA613]" : "text-muted-foreground/50")}>
                      {idx + 1}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <p className="font-semibold text-foreground truncate max-w-[220px]">
                      {p.title ?? `Post ${p.id.slice(-8)}`}
                    </p>
                    <p className="text-muted-foreground mt-0.5">{p.pageName} · {p.date}</p>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className={cn("inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold",
                      p.isVideo ? "text-[#F44708] bg-[#FFF0E8]" : "text-muted-foreground bg-muted/40")}>
                      {p.isVideo ? <Play className="h-2.5 w-2.5" /> : <ImageIcon className="h-2.5 w-2.5" />}
                      {p.isVideo ? "Vídeo" : "Foto"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex flex-col items-end gap-1">
                      <span className="font-bold text-foreground">{fmtV(p.views)}</span>
                      <div className="w-16 h-1 bg-muted rounded-full overflow-hidden">
                        <div className="h-full rounded-full" style={{ width: `${barW}%`, background: "#F44708" }} />
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right text-muted-foreground">{fmtV(p.reactions)}</td>
                  {!isIG && (
                    <td className="px-4 py-3 text-right font-semibold" style={{ color: p.revenue > 0 ? "#10b981" : undefined }}>
                      {p.revenue > 0 ? fmtBRL(p.revenue, false) : "—"}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

function AnalyticsPage() {
  const [rows, setRows] = useState<PostRow[]>([]);
  const [allPages, setAllPages] = useState<{ id: string; nome: string }[]>([]);
  const [loading, setLoading] = useState(true);

  const [platform, setPlatform] = useState<Platform>("all");
  const [filterPage, setFilterPage] = useState("all");

  // Edit modal state
  const [editPost, setEditPost] = useState<PostRow | null>(null);
  const [editPostIndex, setEditPostIndex] = useState(0);

  // Load all data once
  useEffect(() => {
    (async () => {
      setLoading(true);
      const [posts, { data: pagesData }] = await Promise.all([
        fetchAllRows<PostRow>(() =>
          supabase.from("posts").select([
            "id", "page_id", "published_at", "title", "description", "post_type", "source",
            "views", "reach", "reactions", "comments", "shares", "saves", "follows_gained",
            "monetization_approx", "estimated_usd", "watch_seconds_avg", "video_duration_s",
            "thumbnail_url",
            "pages(id, nome)",
          ].join(", ")).order("published_at", { ascending: false })
        ),
        supabase.from("pages").select("id, nome").order("nome"),
      ]);
      setRows(posts);
      setAllPages((pagesData as any[]) ?? []);
      setLoading(false);
    })();
  }, []);

  // Filtered rows by platform + page
  const filtered = useMemo(() => {
    let r = [...rows];
    if (platform === "facebook") r = r.filter((p) => p.source === "facebook" || !p.source);
    if (platform === "instagram") r = r.filter((p) => p.source === "instagram");
    if (filterPage !== "all") r = r.filter((p) => p.page_id === filterPage);
    return r;
  }, [rows, platform, filterPage]);

  const isIG = platform === "instagram";

  // Monthly aggregation (ALL time, for charts)
  const { monthlyData, totals, pageRanking, topPosts, paretoCount } = useMemo(() => {
    const monthMap = new Map<string, { posts: number; views: number; revenue: number; reactions: number; comments: number; shares: number }>();
    const pageMap  = new Map<string, { id: string; nome: string; posts: number; views: number; revenue: number }>();
    let tViews = 0, tRevenue = 0, tReactions = 0, tComments = 0, tShares = 0;
    let tSaves = 0, tFollows = 0, tReach = 0;
    let vidCount = 0, photoCount = 0, vidViews = 0, photoViews = 0, vidRevenue = 0, photoRevenue = 0;

    const enriched = filtered.map((p) => ({
      ...p,
      _views:    Number(p.views ?? 0),
      _revenue:  postUsd(p),
      _reactions: Number(p.reactions ?? 0),
      _isVideo:  isVideo(p),
      _watchAvg: Number(p.watch_seconds_avg ?? 0),
    }));

    for (const p of enriched) {
      tViews    += p._views;
      tRevenue  += p._revenue;
      tReactions += p._reactions;
      tComments += Number(p.comments ?? 0);
      tShares   += Number(p.shares ?? 0);
      tSaves    += Number(p.saves ?? 0);
      tFollows  += Number(p.follows_gained ?? 0);
      tReach    += Number(p.reach ?? 0);

      if (p._isVideo) { vidCount++; vidViews += p._views; vidRevenue += p._revenue; }
      else            { photoCount++; photoViews += p._views; photoRevenue += p._revenue; }

      if (p.published_at) {
        const mk = p.published_at.slice(0, 7);
        const mc = monthMap.get(mk) ?? { posts: 0, views: 0, revenue: 0, reactions: 0, comments: 0, shares: 0 };
        mc.posts++; mc.views += p._views; mc.revenue += p._revenue;
        mc.reactions += p._reactions; mc.comments += Number(p.comments ?? 0); mc.shares += Number(p.shares ?? 0);
        monthMap.set(mk, mc);
      }

      const pgId = p.page_id;
      const pgName = p.pages?.nome ?? pgId;
      const pg = pageMap.get(pgId) ?? { id: pgId, nome: pgName, posts: 0, views: 0, revenue: 0 };
      pg.posts++; pg.views += p._views; pg.revenue += p._revenue;
      pageMap.set(pgId, pg);
    }

    // Sort months ascending for chart
    const sorted = Array.from(monthMap.entries()).sort((a, b) => a[0].localeCompare(b[0]));

    // Compute regression trend lines
    const viewsArr   = sorted.map(([, d]) => d.views);
    const revenueArr = sorted.map(([, d]) => d.revenue);
    const rpmArr     = sorted.map(([, d]) => d.views > 0 ? (d.revenue / d.views) * 1000 : 0);
    const avgVArr    = sorted.map(([, d]) => d.posts > 0 ? d.views / d.posts : 0);

    const viewsTrends   = linReg(viewsArr);
    const revenueTrends = linReg(revenueArr);
    const rpmTrends     = linReg(rpmArr);
    const avgVTrends    = linReg(avgVArr);

    const monthlyData: MonthPoint[] = sorted.map(([month, d], idx) => ({
      label: shortMonth(month),
      month,
      posts: d.posts,
      views: d.views,
      revenue: d.revenue,
      reactions: d.reactions,
      comments: d.comments,
      shares: d.shares,
      rpm: d.views > 0 ? (d.revenue / d.views) * 1000 : 0,
      avgViews: d.posts > 0 ? d.views / d.posts : 0,
      viewsTrend:   viewsTrends[idx],
      revenueTrend: revenueTrends[idx],
      rpmTrend:     rpmTrends[idx],
      avgViewsTrend: avgVTrends[idx],
    }));

    // MoM for last two months
    const last = sorted[sorted.length - 1]?.[1];
    const prev = sorted[sorted.length - 2]?.[1];
    const momViews   = prev && prev.views > 0 ? ((last.views - prev.views) / prev.views) * 100 : null;
    const momRevenue = prev && prev.revenue > 0 ? ((last.revenue - prev.revenue) / prev.revenue) * 100 : null;

    // Page ranking
    const pageRanking = Array.from(pageMap.values()).sort((a, b) => b.views - a.views);

    // Top posts (by views)
    const topPosts = [...enriched]
      .sort((a, b) => b._views - a._views)
      .slice(0, 10)
      .map((p) => ({
        id: p.id,
        title: p.title,
        pageName: p.pages?.nome ?? "—",
        date: p.published_at?.slice(0, 10) ?? "—",
        views: p._views,
        revenue: p._revenue,
        reactions: p._reactions,
        isVideo: p._isVideo,
        watchAvg: p._watchAvg,
      }));

    // Pareto
    const byViews = [...enriched].sort((a, b) => b._views - a._views);
    let cumV = 0, paretoCount = 0;
    for (const p of byViews) { cumV += p._views; paretoCount++; if (cumV >= tViews * 0.8) break; }

    return {
      monthlyData,
      totals: { tViews, tRevenue, tReactions, tComments, tShares, tSaves, tFollows, tReach,
        vidCount, photoCount, vidViews, photoViews, vidRevenue, photoRevenue,
        totalPosts: filtered.length,
        momViews: momViews ?? null,
        momRevenue: momRevenue ?? null,
        rpm: tViews > 0 ? (tRevenue / tViews) * 1000 : 0,
        engRate: tViews > 0 ? (tReactions / tViews) * 100 : 0,
        avgViewsPerPost: filtered.length > 0 ? tViews / filtered.length : 0,
      },
      pageRanking,
      topPosts,
      paretoCount,
    };
  }, [filtered]);

  // Period label
  const periodLabel = useMemo(() => {
    if (!monthlyData.length) return "Sem dados";
    const first = monthlyData[0].label;
    const last  = monthlyData[monthlyData.length - 1].label;
    return first === last ? first : `${first} — ${last}`;
  }, [monthlyData]);

  const handleEditPost = useCallback((postId: string) => {
    const post = rows.find((r) => r.id === postId);
    if (!post) return;
    const idx = topPosts.findIndex((p) => p.id === postId);
    setEditPost(post);
    setEditPostIndex(idx >= 0 ? idx : 0);
  }, [rows, topPosts]);

  // Loading
  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground text-sm">
        <Loader2 className="h-5 w-5 mr-2 animate-spin text-[#F44708]" />
        Carregando Analytics...
      </div>
    );
  }

  const noData = !filtered.length || !monthlyData.length;

  return (
    <div className="space-y-5">

      {/* ── Header ── */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Analytics</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Histórico completo de performance, tendências e distribuição de conteúdo.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <PlatformToggle value={platform} onChange={(p) => { setPlatform(p); }} />
          <PageDropdown pages={allPages} value={filterPage} onChange={setFilterPage} />
        </div>
      </div>

      {noData ? (
        <div className="rounded-2xl border border-border bg-white p-20 flex flex-col items-center gap-4">
          <BarChart2 className="h-10 w-10 text-muted-foreground/30" />
          <p className="font-semibold text-foreground">Nenhum dado disponível</p>
          <p className="text-sm text-muted-foreground">Importe CSVs ou ajuste os filtros de plataforma e página.</p>
        </div>
      ) : (
        <>
          {/* ── Hero ── */}
          <HeroCard
            totalViews={totals.tViews}
            totalRevenue={totals.tRevenue}
            totalPosts={totals.totalPosts}
            momViews={totals.momViews}
            momRevenue={totals.momRevenue}
            isIG={isIG}
            periodLabel={periodLabel}
          />

          {/* ── KPI row ── */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {!isIG ? (
              <>
                <KpiCard
                  label="RPM Médio"
                  value={`$${totals.rpm.toFixed(4)}`}
                  sub={totals.rpm >= 0.06 ? "Acima da meta $0.06" : "Abaixo de $0.06"}
                  trend={totals.rpm >= 0.06 ? "up" : "down"}
                  highlight={totals.rpm >= 0.06}
                />
                <KpiCard
                  label="Views por post"
                  value={fmtV(totals.avgViewsPerPost)}
                  sub="Eficiência média"
                  trend={null}
                />
              </>
            ) : (
              <>
                <KpiCard
                  label="Seguimentos"
                  value={fmtV(totals.tFollows)}
                  sub="Novos seguidores"
                  trend={null}
                />
                <KpiCard
                  label="Salvamentos"
                  value={fmtV(totals.tSaves)}
                  sub="Posts salvos"
                  trend={null}
                />
              </>
            )}
            <KpiCard
              label="Engajamento"
              value={`${totals.engRate.toFixed(2)}%`}
              sub="Reações / visualizações"
              trend={totals.engRate > 0.5 ? "up" : null}
              highlight={totals.engRate > 0.5}
            />
            <KpiCard
              label="Alcance total"
              value={fmtV(totals.tReach)}
              sub="Pessoas alcançadas"
              trend={null}
            />
          </div>

          {/* ── Pareto banner ── */}
          {paretoCount > 0 && (
            <div className="rounded-2xl border border-border bg-white px-5 py-3.5 flex items-center justify-between gap-4 flex-wrap">
              <div className="flex items-center gap-2.5 text-sm">
                <div className="h-7 w-7 rounded-lg bg-[#FFF0E8] flex items-center justify-center shrink-0">
                  <Target className="h-3.5 w-3.5 text-[#F44708]" />
                </div>
                <span className="text-muted-foreground">
                  Apenas{" "}
                  <span className="font-bold text-foreground">{paretoCount} posts</span>
                  {" "}representam{" "}
                  <span className="font-bold text-foreground">80% de todas as views</span>
                  {" "}— Princípio de Pareto.
                </span>
              </div>
              <span className="text-[10px] text-muted-foreground shrink-0">
                {filtered.length} posts totais
              </span>
            </div>
          )}

          {/* ── Views chart + Page ranking ── */}
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-4">
            <ViewsTrendChart data={monthlyData} />
            <PageRankingPanel ranking={pageRanking} isIG={isIG} />
          </div>

          {/* ── Revenue chart + Content format ── */}
          {!isIG && (
            <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-4">
              <RevenueTrendChart data={monthlyData} />
              <ContentFormatPanel
                vidCount={totals.vidCount} photoCount={totals.photoCount}
                vidViews={totals.vidViews} photoViews={totals.photoViews}
                vidRevenue={totals.vidRevenue} photoRevenue={totals.photoRevenue}
                isIG={isIG}
              />
            </div>
          )}

          {/* ── RPM + Views/post efficiency ── */}
          {!isIG && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <RpmTrendChart data={monthlyData} />
              <EfficiencyChart data={monthlyData} />
            </div>
          )}

          {/* ── Engagement + Posts per month ── */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <EngagementChart data={monthlyData} />
            <PostsBarChart data={monthlyData} />
          </div>

          {/* ── Top posts ── */}
          <TopPostsPanel posts={topPosts} isIG={isIG} onEditPost={handleEditPost} />
        </>
      )}

      {/* ── Edit modal ── */}
      {editPost && (
        <PostEditModal
          post={editPost}
          postIndex={editPostIndex}
          onClose={() => setEditPost(null)}
          onSaved={(updated) => {
            setRows((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
            setEditPost(null);
          }}
        />
      )}
    </div>
  );
}
