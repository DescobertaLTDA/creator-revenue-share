import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, useMemo, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/admin/projecoes")({
  head: () => ({ meta: [{ title: "Projeções — Splash Creators" }] }),
  component: ProjecoesPage,
});

// ─── Types ─────────────────────────────────────────────────────────────────────

interface RawPost {
  id: string; page_id: string; published_at: string | null;
  views: number | null; estimated_usd: number | null;
}
interface PageRow { id: string; nome: string }
type RhythmKey = "slow" | "medium" | "fast";

const RHYTHMS = [
  { key: "slow"   as RhythmKey, label: "Lento", emoji: "🐢", mult: 0.8 },
  { key: "medium" as RhythmKey, label: "Médio", emoji: "🚀", mult: 1.0, badge: "Atual" },
  { key: "fast"   as RhythmKey, label: "Alto",  emoji: "⚡", mult: 1.3 },
];

// ─── Helpers ───────────────────────────────────────────────────────────────────

function fmtUSD(n: number) {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtBRL(n: number) {
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtViewsPt(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)} mil`;
  return String(n);
}
function viewsStep(v: number) {
  if (v < 5_000) return 500;
  if (v < 20_000) return 1_000;
  if (v < 100_000) return 5_000;
  if (v < 1_000_000) return 50_000;
  return 500_000;
}
function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}
function today() { return new Date(); }
function daysInCurrentMonth() {
  const d = today(); return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
}
function daysElapsedInMonth() { return today().getDate(); }

// ─── Main page ─────────────────────────────────────────────────────────────────

export default function ProjecoesPage() {
  // ── Raw data
  const [pages, setPages]     = useState<PageRow[]>([]);
  const [pageId, setPageId]   = useState<string>("");
  const [loading, setLoading] = useState(true);

  // derived from DB
  const [rpm, setRpm]                   = useState(2.0);
  const [actualRevMonth, setActualRevMonth] = useState(0);

  // ── Simulator controls
  const [postsPerDay, setPostsPerDay]   = useState(1);
  const [avgViews, setAvgViews]         = useState(12_000);
  const [rhythm, setRhythm]             = useState<RhythmKey>("medium");

  // ── Exchange rate
  const [brlRate, setBrlRate] = useState(5.0);

  // ── Load pages
  useEffect(() => {
    supabase.from("pages").select("id, nome").order("nome").then(({ data }) => {
      if (data?.length) { setPages(data); setPageId(data[0].id); }
    });
    fetch("https://open.er-api.com/v6/latest/USD")
      .then(r => r.json()).then(d => { if (d?.rates?.BRL) setBrlRate(d.rates.BRL); })
      .catch(() => {});
  }, []);

  // ── Load post data for selected page
  useEffect(() => {
    if (!pageId) return;
    setLoading(true);

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const iso = thirtyDaysAgo.toISOString().split("T")[0];

    (supabase as any)
      .from("posts")
      .select("id, page_id, published_at, views, estimated_usd")
      .eq("page_id", pageId)
      .gte("published_at", iso)
      .then(({ data }: { data: RawPost[] | null }) => {
        if (!data || data.length === 0) { setLoading(false); return; }

        const totalRev   = data.reduce((s, p) => s + (p.estimated_usd ?? 0), 0);
        const totalViews = data.reduce((s, p) => s + (p.views ?? 0), 0);

        const calcRpm = totalViews > 5_000 && totalRev > 0
          ? (totalRev / totalViews) * 1000
          : 2.0;

        // Avg posts per day in 30d window
        const postCount = data.length;
        const estimatedPostsPerDay = Math.max(1, Math.round(postCount / 30));

        // Avg views per post
        const avgViewsCalc = postCount > 0
          ? Math.round(totalViews / postCount)
          : 10_000;

        setRpm(calcRpm);
        setPostsPerDay(clamp(estimatedPostsPerDay, 1, 30));
        setAvgViews(clamp(avgViewsCalc, 1_000, 10_000_000));

        // Actual this-month revenue
        const monthStart = new Date(); monthStart.setDate(1);
        monthStart.setHours(0, 0, 0, 0);
        const thisMonthPosts = data.filter(p => p.published_at && new Date(p.published_at) >= monthStart);
        setActualRevMonth(thisMonthPosts.reduce((s, p) => s + (p.estimated_usd ?? 0), 0));

        setLoading(false);
      });
  }, [pageId]);

  // ── Projection math
  const projection = useMemo(() => {
    const rhythmMult  = RHYTHMS.find(r => r.key === rhythm)?.mult ?? 1.0;
    const dailyRev    = postsPerDay * (avgViews / 1_000) * rpm * rhythmMult;
    const totalDays   = daysInCurrentMonth();
    const elapsed     = daysElapsedInMonth();
    const daysLeft    = totalDays - elapsed;
    const projectedRev = dailyRev * daysLeft;
    const totalRev    = actualRevMonth + projectedRev;
    const progress    = totalDays > 0 ? elapsed / totalDays : 0;
    const avgDailyActual = elapsed > 0 ? actualRevMonth / elapsed : 0;

    const chartData = Array.from({ length: totalDays }, (_, i) => {
      const day = i + 1;
      if (day <= elapsed) {
        return { day, value: avgDailyActual * day, projected: false };
      } else {
        return { day, value: actualRevMonth + dailyRev * (day - elapsed), projected: true };
      }
    });

    // Uplift: +1 post/day
    const upliftDailyRev = (postsPerDay + 1) * (avgViews / 1_000) * rpm * rhythmMult;
    const upliftExtra = (upliftDailyRev - dailyRev) * daysLeft * brlRate;

    return { dailyRev, projectedRev, totalRev, progress, chartData, daysLeft, upliftExtra };
  }, [postsPerDay, avgViews, rhythm, rpm, actualRevMonth, brlRate]);

  return (
    <div className="space-y-4">
      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Simulador de Ganhos</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Ajuste os controles e veja quanto você pode ganhar</p>
        </div>
        <PageDropdown pages={pages} value={pageId} onChange={setPageId} />
      </div>

      {loading ? (
        <LoadingSkeleton />
      ) : (
        <div className="space-y-4">
          {/* ── Top row: Controls + Hero ── */}
          <div className="grid grid-cols-1 lg:grid-cols-[420px_1fr] gap-4 items-stretch">
            <ControlsPanel
              postsPerDay={postsPerDay}
              setPostsPerDay={setPostsPerDay}
              avgViews={avgViews}
              setAvgViews={setAvgViews}
              rhythm={rhythm}
              setRhythm={setRhythm}
              rpm={rpm}
              setRpm={setRpm}
            />
            <HeroCard
              totalRev={projection.totalRev}
              projectedRev={projection.projectedRev}
              actualRevMonth={actualRevMonth}
              brlRate={brlRate}
              progress={projection.progress}
              daysLeft={projection.daysLeft}
            />
          </div>

          {/* ── Full-width chart ── */}
          <SimpleChart chartData={projection.chartData} totalRev={projection.totalRev} />
        </div>
      )}
    </div>
  );
}

// ─── PageDropdown ───────────────────────────────────────────────────────────────

function PageDropdown({ pages, value, onChange }: { pages: PageRow[]; value: string; onChange: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const selected = pages.find(p => p.id === value);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2 h-9 px-3 rounded-xl border border-border bg-white text-sm font-medium text-foreground hover:bg-accent transition-colors min-w-[180px]"
      >
        <span className="truncate flex-1 text-left">{selected?.nome ?? "Selecionar página"}</span>
        <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-30 bg-white rounded-xl border border-border shadow-lg py-1 min-w-[220px]">
          {pages.map(p => (
            <button
              key={p.id}
              onClick={() => { onChange(p.id); setOpen(false); }}
              className={cn(
                "w-full text-left px-4 py-2 text-sm transition-colors",
                p.id === value ? "bg-[#6D4AFF]/10 text-[#6D4AFF] font-semibold" : "hover:bg-accent text-foreground"
              )}
            >
              {p.nome}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── ControlsPanel ──────────────────────────────────────────────────────────────

function ControlsPanel({
  postsPerDay, setPostsPerDay,
  avgViews, setAvgViews,
  rhythm, setRhythm,
  rpm, setRpm,
}: {
  postsPerDay: number; setPostsPerDay: (v: number) => void;
  avgViews: number; setAvgViews: (v: number) => void;
  rhythm: RhythmKey; setRhythm: (v: RhythmKey) => void;
  rpm: number; setRpm: (v: number) => void;
}) {
  const tip = useMemo(() => {
    if (postsPerDay === 0) return "Tente postar pelo menos 1 vez por dia!";
    if (postsPerDay >= 5) return "Qualidade supera quantidade — mantenha o nível!";
    if (avgViews < 5_000) return "Conteúdo com boas thumbnails costuma ter mais views.";
    if (rhythm === "fast") return "Ritmo alto pode dar um salto — continue assim!";
    return "Você está indo bem. Simule um ritmo mais alto!";
  }, [postsPerDay, avgViews, rhythm]);

  return (
    <div className="bg-white rounded-2xl border border-border p-5 space-y-5 lg:sticky lg:top-4">
      {/* Posts per day */}
      <ControlRow
        label="Posts por dia"
        hint="Mais posts = mais alcance"
        stepper={<>
          <StepButton onClick={() => setPostsPerDay(Math.max(0, postsPerDay - 1))}>−</StepButton>
          <span className="flex-1 text-center text-3xl font-black text-[#6D4AFF]">
            {postsPerDay} <span className="text-sm font-semibold text-muted-foreground">posts</span>
          </span>
          <StepButton onClick={() => setPostsPerDay(Math.min(30, postsPerDay + 1))}>+</StepButton>
        </>}
        slider={
          <input type="range" min={0} max={30} step={1} value={postsPerDay}
            onChange={e => setPostsPerDay(Number(e.target.value))}
            className="w-full accent-[#6D4AFF] h-2 rounded-full" />
        }
      />

      {/* Avg views */}
      <ControlRow
        label="Média de views por post"
        hint="Mais views = mais receita"
        stepper={<>
          <StepButton onClick={() => setAvgViews(Math.max(1_000, avgViews - viewsStep(avgViews)))}>−</StepButton>
          <span className="flex-1 text-center text-3xl font-black text-[#6D4AFF]">
            {fmtViewsPt(avgViews)} <span className="text-sm font-semibold text-muted-foreground">views</span>
          </span>
          <StepButton onClick={() => setAvgViews(Math.min(10_000_000, avgViews + viewsStep(avgViews)))}>+</StepButton>
        </>}
        slider={
          <input type="range" min={1_000} max={10_000_000} step={1_000} value={avgViews}
            onChange={e => setAvgViews(Number(e.target.value))}
            className="w-full accent-[#6D4AFF] h-2 rounded-full" />
        }
      />

      {/* RPM */}
      <ControlRow
        label="RPM (por mil views)"
        hint="Estimado dos seus dados"
        stepper={<>
          <StepButton onClick={() => setRpm(Math.max(0, Math.round((rpm - 0.1) * 10) / 10))}>−</StepButton>
          <span className="flex-1 text-center text-3xl font-black text-[#6D4AFF]">
            ${rpm.toFixed(2)}
          </span>
          <StepButton onClick={() => setRpm(Math.min(100, Math.round((rpm + 0.1) * 10) / 10))}>+</StepButton>
        </>}
        slider={
          <input type="range" min={0} max={100} step={0.1} value={rpm}
            onChange={e => setRpm(Number(e.target.value))}
            className="w-full accent-[#6D4AFF] h-2 rounded-full" />
        }
      />

      {/* Rhythm */}
      <div className="space-y-2">
        <span className="block text-sm font-semibold text-foreground">Ritmo de postagem</span>
        <div className="grid grid-cols-3 gap-2">
          {RHYTHMS.map(r => (
            <button
              key={r.key}
              onClick={() => setRhythm(r.key)}
              className={cn(
                "relative flex flex-col items-center justify-center gap-1 py-3 rounded-xl border-2 text-sm font-semibold transition-all",
                rhythm === r.key
                  ? "border-[#6D4AFF] bg-[#6D4AFF]/10 text-[#6D4AFF]"
                  : "border-border bg-white text-muted-foreground hover:border-[#6D4AFF]/40 hover:text-foreground"
              )}
            >
              {r.badge && (
                <span className="absolute -top-2 left-1/2 -translate-x-1/2 text-[9px] bg-[#6D4AFF] text-white px-1.5 py-0.5 rounded-full font-bold tracking-wide">
                  {r.badge}
                </span>
              )}
              <span className="text-xl">{r.emoji}</span>
              <span>{r.label}</span>
              <span className="text-[11px] font-normal opacity-70">
                {r.mult < 1 ? `${Math.round(r.mult * 100)}%` : r.mult === 1 ? "100%" : `+${Math.round((r.mult - 1) * 100)}%`}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Tip */}
      <div className="bg-[#F3F0FF] rounded-xl px-4 py-3 flex items-center gap-2.5">
        <span className="text-base">💡</span>
        <p className="text-sm text-[#6D4AFF] font-medium leading-snug">{tip}</p>
      </div>
    </div>
  );
}

function ControlRow({ label, hint, stepper, slider }: {
  label: string; hint: string;
  stepper: React.ReactNode; slider: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between">
        <span className="text-sm font-semibold text-foreground">{label}</span>
        <span className="text-[11px] text-muted-foreground">{hint}</span>
      </div>
      <div className="flex items-center gap-3">{stepper}</div>
      {slider}
    </div>
  );
}

function StepButton({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="h-9 w-9 rounded-xl bg-[#EDE9FF] text-[#6D4AFF] text-xl font-bold flex items-center justify-center hover:bg-[#6D4AFF] hover:text-white transition-all shrink-0 shadow-sm"
    >
      {children}
    </button>
  );
}

// ─── HeroCard ───────────────────────────────────────────────────────────────────

function HeroCard({
  totalRev, projectedRev, actualRevMonth, brlRate, progress, daysLeft,
}: {
  totalRev: number; projectedRev: number; actualRevMonth: number;
  brlRate: number; progress: number; daysLeft: number;
}) {
  const totalBRL = totalRev * brlRate;
  const pct = Math.min(100, Math.round(progress * 100));

  return (
    <div
      className="rounded-2xl overflow-hidden flex flex-col justify-between min-h-[280px]"
      style={{ background: "linear-gradient(135deg, #5B35E8 0%, #8B5CF6 60%, #A78BFA 100%)" }}
    >
      <div className="p-6 flex-1 flex flex-col justify-between">
        {/* Top label + badge */}
        <div className="flex items-start justify-between mb-4">
          <p className="text-white/70 text-sm font-medium tracking-wide uppercase text-[11px]">Projeção do mês</p>
          <span className="bg-white/15 backdrop-blur-sm text-white text-xs font-bold px-3 py-1 rounded-full border border-white/20">
            {pct}% do mês
          </span>
        </div>

        {/* Big numbers */}
        <div className="mb-6">
          <p className="text-5xl font-black tracking-tight text-white leading-none mb-2">
            {fmtUSD(totalRev)}
          </p>
          <p className="text-white/75 text-2xl font-bold">{fmtBRL(totalBRL)}</p>
        </div>

        {/* Progress bar */}
        <div>
          <div className="h-2.5 bg-white/20 rounded-full overflow-hidden mb-2">
            <div
              className="h-full rounded-full transition-all duration-700"
              style={{ width: `${pct}%`, background: "linear-gradient(90deg, #fff 0%, rgba(255,255,255,0.85) 100%)" }}
            />
          </div>
          <div className="flex justify-between text-xs text-white/55">
            <span>Realizado: <span className="text-white/80 font-semibold">{fmtUSD(actualRevMonth)}</span></span>
            <span>{daysLeft} dias restantes · Projetado: <span className="text-white/80 font-semibold">+{fmtUSD(projectedRev)}</span></span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── SimpleChart ─────────────────────────────────────────────────────────────────

interface ChartPoint { day: number; value: number; projected: boolean }

function SimpleChart({ chartData, totalRev }: { chartData: ChartPoint[]; totalRev: number }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const W = 900, H = 260, PAD = { top: 20, right: 20, bottom: 28, left: 48 };
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;

  const maxVal = Math.max(...chartData.map(d => d.value), 1);
  const x = (i: number) => PAD.left + (i / (chartData.length - 1)) * innerW;
  const y = (v: number) => PAD.top + innerH - (v / maxVal) * innerH;

  // Split into actual and projected segments
  const splitIdx = chartData.findIndex(d => d.projected);
  const actual = splitIdx > 0 ? chartData.slice(0, splitIdx + 1) : chartData.filter(d => !d.projected);
  const projected = splitIdx > 0 ? chartData.slice(splitIdx) : [];

  function toPath(pts: ChartPoint[]) {
    if (pts.length < 2) return "";
    return pts.map((d, i) => `${i === 0 ? "M" : "L"} ${x(chartData.indexOf(d))} ${y(d.value)}`).join(" ");
  }

  // Area fill
  function toArea(pts: ChartPoint[], color: string) {
    if (pts.length < 2) return null;
    const idxs = pts.map(d => chartData.indexOf(d));
    const first = idxs[0], last = idxs[idxs.length - 1];
    const linePath = pts.map((d, i) => `${i === 0 ? "M" : "L"} ${x(idxs[i])} ${y(d.value)}`).join(" ");
    const areaPath = `${linePath} L ${x(last)} ${PAD.top + innerH} L ${x(first)} ${PAD.top + innerH} Z`;
    return <path d={areaPath} fill={color} opacity={0.15} />;
  }

  const yLabels = [0, 0.25, 0.5, 0.75, 1].map(f => ({ v: maxVal * f, y: y(maxVal * f) }));

  return (
    <div className="bg-white rounded-2xl border border-border p-5">
      <div className="flex items-center justify-between mb-3">
        <p className="text-sm font-semibold text-foreground">Evolução no mês</p>
        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span className="h-0.5 w-5 bg-[#6D4AFF] inline-block rounded" /> Realizado
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-0.5 w-5 border-t-2 border-dashed border-[#9B71FF] inline-block" /> Projeção
          </span>
        </div>
      </div>

      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        style={{ height: 240 }}
      >
        {/* Y grid + labels */}
        {yLabels.map(({ v, y: yy }) => (
          <g key={v}>
            <line x1={PAD.left} y1={yy} x2={W - PAD.right} y2={yy} stroke="#f0eeff" strokeWidth={1} />
            <text x={PAD.left - 6} y={yy + 4} textAnchor="end" fontSize={9} fill="#aaa">
              ${v > 0 ? (v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v.toFixed(0)) : "0"}
            </text>
          </g>
        ))}

        {/* Areas */}
        {toArea(actual, "#6D4AFF")}
        {toArea(projected, "#9B71FF")}

        {/* Lines */}
        {actual.length >= 2 && (
          <path d={toPath(actual)} fill="none" stroke="#6D4AFF" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
        )}
        {projected.length >= 2 && (
          <path d={toPath(projected)} fill="none" stroke="#9B71FF" strokeWidth={2} strokeDasharray="6 3" strokeLinecap="round" strokeLinejoin="round" />
        )}

        {/* X axis day labels */}
        {[1, 8, 15, 22, chartData.length].map(day => {
          const idx = day - 1;
          if (idx < 0 || idx >= chartData.length) return null;
          return (
            <text key={day} x={x(idx)} y={H - 4} textAnchor="middle" fontSize={9} fill="#bbb">
              {day}
            </text>
          );
        })}
      </svg>
    </div>
  );
}

// ─── UpliftTip ──────────────────────────────────────────────────────────────────

function UpliftTip({ upliftExtra, onTry }: { upliftExtra: number; onTry: () => void }) {
  return (
    <div className="bg-[#FFFBEB] border border-[#FDE68A] rounded-2xl p-4 flex items-center justify-between gap-4">
      <div className="flex items-start gap-3">
        <span className="text-2xl mt-0.5">🚀</span>
        <div>
          <p className="text-sm font-bold text-[#92400E]">
            +1 post/dia = +{fmtBRL(upliftExtra)} este mês
          </p>
          <p className="text-xs text-[#B45309] mt-0.5">
            Pequenos ajustes fazem grande diferença no final do mês.
          </p>
        </div>
      </div>
      <button
        onClick={onTry}
        className="shrink-0 bg-[#F59E0B] hover:bg-[#D97706] text-white text-xs font-bold px-4 py-2 rounded-xl transition-colors"
      >
        Testar isso
      </button>
    </div>
  );
}

// ─── LoadingSkeleton ────────────────────────────────────────────────────────────

function LoadingSkeleton() {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-[400px_1fr] gap-5 animate-pulse">
      <div className="bg-white rounded-2xl border border-border p-5 space-y-5">
        {[1, 2, 3].map(i => (
          <div key={i} className="space-y-2">
            <div className="h-4 bg-gray-100 rounded w-1/2" />
            <div className="h-12 bg-gray-100 rounded-xl" />
            <div className="h-2 bg-gray-100 rounded-full" />
          </div>
        ))}
        <div className="h-10 bg-[#F3F0FF]/60 rounded-xl" />
      </div>
      <div className="space-y-4">
        <div className="h-36 rounded-2xl bg-[#6D4AFF]/20" />
        <div className="h-44 bg-white rounded-2xl border border-border" />
      </div>
    </div>
  );
}
