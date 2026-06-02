import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { formatBRL } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  Target, Plus, Trash2, Pencil, CheckCircle2, Clock,
  XCircle, Archive, Loader2, AlertTriangle, TrendingUp, Lock,
  Trophy, DollarSign, Eye, Play, ImageIcon,
} from "lucide-react";
import { formatMonth } from "@/lib/format";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/metas")({
  head: () => ({ meta: [{ title: "Metas — Splash Creators" }] }),
  component: MetasPage,
});

// ─── Types ────────────────────────────────────────────────────────────────────

type CalcStatus = "ACTIVE" | "COMPLETED" | "EXPIRED" | "ARCHIVED";
type RiskLevel  = "GREEN" | "YELLOW" | "RED";

interface GoalProgress {
  id: string;
  user_id: string;
  title: string;
  description: string | null;
  target_amount: number;
  start_date: string;
  end_date: string;
  status: string;
  created_at: string;
  completed_at: string | null;
  current_amount: number;
  remaining_amount: number;
  progress_percentage: number;
  days_remaining: number;
  calculated_status: CalcStatus;
  risk_level: RiskLevel;
  is_system: boolean;
}

interface GoalDraft {
  title: string;
  description: string;
  target_amount: string;
  start_date: string;
  end_date: string;
}

// ─── Record section types & helpers ──────────────────────────────────────────

interface RecordMonthData {
  month: string;
  posts: number;
  views: number;
  revenue: number; // USD
  videos: number;
  photos: number;
}

const REC_ORANGE = "#ff6b00";
const REC_ORANGE_LIGHT = "#ffb347";
const REC_GREEN = "#16a34a";
const REC_USD_TO_BRL = 5.70;

const recFmtRound = (n: number) =>
  n >= 1_000_000 ? `${Math.round(n / 1_000_000)}M`
  : n >= 1_000 ? `${Math.round(n / 1_000)}k`
  : `${Math.round(n)}`;

const recFmtBRL = (usd: number): string => {
  const brl = usd * REC_USD_TO_BRL;
  if (brl >= 1_000_000) return `R$ ${(brl / 1_000_000).toFixed(1)}M`;
  if (brl >= 1_000) return `R$ ${(brl / 1_000).toFixed(1)}k`;
  return `R$ ${brl.toFixed(2)}`;
};

function RecordCard({
  label, current, target, fmtFn, icon: Icon,
}: {
  label: string;
  current: number;
  target: number;
  fmtFn: (n: number) => string;
  icon: React.FC<{ size?: number; className?: string }>;
}) {
  const pct = target > 0 ? Math.min(100, (current / target) * 100) : 0;
  const done = current >= target;
  const barColor = done ? REC_GREEN : pct >= 80 ? REC_GREEN : pct >= 50 ? REC_ORANGE : REC_ORANGE_LIGHT;
  const pctColor = done ? REC_GREEN : pct >= 50 ? REC_ORANGE : "#bbb";

  return (
    <div className="bg-card rounded-xl border border-border px-4 py-3 flex flex-col gap-1.5 shadow-sm hover:shadow-md transition-shadow duration-200">
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">{label}</p>
        <div className="w-6 h-6 rounded-full flex items-center justify-center" style={{ background: `${REC_ORANGE}15` }}>
          <Icon size={11} className="text-[#ff6b00]" />
        </div>
      </div>
      <div className="flex items-baseline gap-1.5">
        <span className="text-xl font-bold tracking-tight leading-none">{fmtFn(current)}</span>
        <span className="text-muted-foreground/40 text-xs">/</span>
        <span className="text-xs font-semibold text-muted-foreground">{fmtFn(target)}</span>
      </div>
      <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, background: barColor }} />
      </div>
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-bold" style={{ color: pctColor }}>{pct.toFixed(0)}%</span>
        {target > current && (
          <span className="text-[10px] text-muted-foreground/50">−{fmtFn(target - current)}</span>
        )}
      </div>
    </div>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function emptyDraft(): GoalDraft {
  const today = new Date().toISOString().slice(0, 10);
  const end = new Date();
  end.setDate(end.getDate() + 30);
  return { title: "", description: "", target_amount: "", start_date: today, end_date: end.toISOString().slice(0, 10) };
}

function fmtDate(iso: string) {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y.slice(2)}`;
}

function parseBrl(raw: string): number {
  return parseFloat(raw.replace(/[^\d,]/g, "").replace(",", ".")) || 0;
}

function fmtUsd(n: number): string {
  return `$${n.toFixed(2).replace(".", ",")}`;
}

// ─── Revenue helper (for system goals) ───────────────────────────────────────

async function fetchSystemGoalRevenue(startDate: string, endDate: string): Promise<number> {
  // Try daily_revenue_entries first (authoritative corrected values)
  const { data: entries } = await supabase
    .from("daily_revenue_entries")
    .select("actual_revenue_usd")
    .gte("entry_date", startDate)
    .lte("entry_date", endDate);

  const daily = (entries ?? []).reduce((s, e: any) => s + Number(e.actual_revenue_usd ?? 0), 0);
  if (daily > 0) return parseFloat(daily.toFixed(2));

  // Fallback: sum posts.estimated_usd for the period
  const { data: posts } = await supabase
    .from("posts")
    .select("estimated_usd, monetization_approx")
    .gte("published_at", startDate)
    .lte("published_at", endDate + "T23:59:59");

  const postsRev = (posts ?? []).reduce(
    (s, p: any) => s + Number(p.estimated_usd ?? p.monetization_approx ?? 0),
    0
  );
  return parseFloat(postsRev.toFixed(2));
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export function MetasPage() {
  const { profile } = useAuth();
  const [goals, setGoals] = useState<GoalProgress[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<GoalDraft>(emptyDraft());
  const [saving, setSaving] = useState(false);

  // ── Record data (best month ever vs current month) ─────────────────────────
  const [bestMonth, setBestMonth] = useState<RecordMonthData | null>(null);
  const [currentMonthRec, setCurrentMonthRec] = useState<RecordMonthData | null>(null);
  const [recordLoading, setRecordLoading] = useState(true);

  useEffect(() => {
    const fetchRecords = async () => {
      const { data } = await supabase
        .from("posts")
        .select("published_at, views, monetization_approx, estimated_usd, post_type");

      if (!data) { setRecordLoading(false); return; }

      const agg = new Map<string, RecordMonthData>();
      for (const row of data) {
        if (!row.published_at) continue;
        const key = (row.published_at as string).slice(0, 7);
        if (!agg.has(key)) agg.set(key, { month: key, posts: 0, views: 0, revenue: 0, videos: 0, photos: 0 });
        const d = agg.get(key)!;
        d.posts++;
        d.views += Number(row.views ?? 0);
        const m = Number(row.monetization_approx ?? 0);
        const e = Number(row.estimated_usd ?? 0);
        d.revenue += m > 0 ? m : e;
        const t = ((row.post_type as string | null) ?? "").toLowerCase();
        if (t.includes("video") || t.includes("vídeo") || t.includes("reel")) d.videos++;
        else if (t.includes("foto") || t.includes("photo") || t.includes("image")) d.photos++;
      }

      const today = new Date();
      const curKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;

      let best: RecordMonthData | null = null;
      for (const [, d] of agg) {
        if (!best || d.revenue > best.revenue) best = d;
      }

      setBestMonth(best);
      setCurrentMonthRec(agg.get(curKey) ?? { month: curKey, posts: 0, views: 0, revenue: 0, videos: 0, photos: 0 });
      setRecordLoading(false);
    };

    fetchRecords();
  }, []);

  // ── Ensure system goal exists for current month ───────────────────────────
  const ensureSystemGoal = async (uid: string) => {
    const today = new Date();
    const monthStart = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-01`;

    const { data: existing } = await (supabase as any)
      .from("goals")
      .select("id")
      .eq("user_id", uid)
      .eq("is_system", true)
      .gte("start_date", monthStart)
      .limit(1);

    if (!existing || existing.length === 0) {
      const lastDay = new Date(today.getFullYear(), today.getMonth() + 1, 0);
      const monthEnd = lastDay.toISOString().slice(0, 10);
      await (supabase as any).from("goals").insert({
        name: "meta_saque_facebook",
        metric: "receita",
        target: 100,
        title: "Meta de Saque — Facebook",
        description:
          "O Facebook realiza o pagamento somente ao atingir U$100 de receita no mês. Esta meta é reiniciada automaticamente no início de cada mês.",
        target_amount: 100,
        start_date: monthStart,
        end_date: monthEnd,
        status: "ACTIVE",
        user_id: uid,
        is_system: true,
      });
    }
  };

  const load = async () => {
    if (!profile?.id) return;
    setLoading(true);

    // Ensure monthly system goal exists
    await ensureSystemGoal(profile.id);

    // Fetch view data
    const { data, error } = await (supabase as any)
      .from("vw_goal_progress")
      .select("*")
      .eq("user_id", profile.id)
      .order("created_at", { ascending: false });

    if (error || !data) { setLoading(false); return; }

    // Fetch is_system flags from goals table
    const { data: flagsData } = await (supabase as any)
      .from("goals")
      .select("id, is_system")
      .eq("user_id", profile.id);

    const isSystemMap = new Map<string, boolean>(
      (flagsData ?? []).map((g: any) => [g.id, Boolean(g.is_system)])
    );

    let enriched: GoalProgress[] = (data as GoalProgress[]).map((g) => ({
      ...g,
      is_system: isSystemMap.get(g.id) ?? false,
    }));

    // Override progress for system goals using actual USD revenue.
    // Always call fetchSystemGoalRevenue — the date-bounded query ensures
    // only that month's data is used regardless of what vw_goal_progress returns.
    const today = new Date().toISOString().slice(0, 10);
    for (const g of enriched.filter((g) => g.is_system)) {
      const isExpired = g.end_date < today;

      const revenue = await fetchSystemGoalRevenue(g.start_date, g.end_date);
      const pct = parseFloat(Math.min(100, (revenue / 100) * 100).toFixed(2));

      g.current_amount   = revenue;
      g.remaining_amount = parseFloat(Math.max(0, 100 - revenue).toFixed(2));
      g.progress_percentage = pct;
      g.calculated_status =
        g.status === "ARCHIVED" ? "ARCHIVED" :
        revenue >= 100          ? "COMPLETED" :
        isExpired               ? "EXPIRED"   : "ACTIVE";
      g.risk_level = pct >= 70 ? "GREEN" : pct >= 40 ? "YELLOW" : "RED";

      // Persist EXPIRED/COMPLETED in DB so the UI shows locked state consistently
      if (isExpired && g.status === "ACTIVE") {
        await (supabase as any).from("goals").update({ status: "EXPIRED" }).eq("id", g.id);
        g.status = "EXPIRED";
      }
      if (revenue >= 100 && g.status === "ACTIVE") {
        await (supabase as any).from("goals").update({ status: "COMPLETED" }).eq("id", g.id);
        g.status = "COMPLETED";
      }
    }

    setGoals(enriched);
    setLoading(false);
  };

  useEffect(() => { load(); }, [profile?.id]);

  const openCreate = () => {
    setDraft(emptyDraft());
    setEditingId(null);
    setShowForm(true);
  };

  const openEdit = (g: GoalProgress) => {
    setDraft({
      title: g.title,
      description: g.description ?? "",
      target_amount: g.target_amount.toFixed(2).replace(".", ","),
      start_date: g.start_date,
      end_date: g.end_date,
    });
    setEditingId(g.id);
    setShowForm(true);
  };

  const save = async () => {
    const amount = parseBrl(draft.target_amount);
    if (!draft.title.trim() || amount <= 0 || !draft.start_date || !draft.end_date) return;
    setSaving(true);
    const payload = {
      title: draft.title.trim(),
      name: draft.title.trim(),     // required NOT NULL
      description: draft.description.trim() || null,
      target_amount: amount,
      target: amount,               // required NOT NULL
      metric: "receita" as const,   // required NOT NULL
      start_date: draft.start_date,
      end_date: draft.end_date,
    };
    if (editingId) {
      const { error } = await (supabase as any).from("goals").update(payload).eq("id", editingId);
      if (error) { toast.error("Erro ao salvar"); setSaving(false); return; }
    } else {
      const { error } = await (supabase as any).from("goals").insert({
        ...payload,
        status: "ACTIVE",
        user_id: profile?.id,
        is_system: false,
      });
      if (error) { toast.error("Erro ao criar meta"); setSaving(false); return; }
    }
    setSaving(false);
    setShowForm(false);
    await load();
  };

  const archive = async (id: string) => {
    await (supabase as any).from("goals").update({ status: "ARCHIVED", archived_at: new Date().toISOString() }).eq("id", id);
    await load();
  };

  const destroy = async (id: string) => {
    if (!window.confirm("Excluir esta meta? Essa ação não pode ser desfeita.")) return;
    await (supabase as any).from("goals").delete().eq("id", id);
    setGoals((prev) => prev.filter((g) => g.id !== id));
  };

  const systemGoals = goals.filter((g) => g.is_system);
  const userGoals   = goals.filter((g) => !g.is_system);
  const active      = userGoals.filter((g) => g.calculated_status === "ACTIVE");
  const completed   = userGoals.filter((g) => g.calculated_status === "COMPLETED");
  const expired     = userGoals.filter((g) => g.calculated_status === "EXPIRED");
  const archived    = userGoals.filter((g) => g.calculated_status === "ARCHIVED");

  if (loading) {
    return (
      <div className="flex items-center justify-center py-32">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Metas</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Acompanhe o progresso das suas metas de receita com base nos pagamentos recebidos.
          </p>
        </div>
        <button
          onClick={openCreate}
          className="inline-flex items-center gap-2 h-9 px-4 rounded-xl bg-orange-500 hover:bg-orange-600 text-white text-sm font-semibold transition-colors"
        >
          <Plus className="h-4 w-4" />
          Nova Meta
        </button>
      </div>

      {/* System goals — compact dedicated card */}
      {systemGoals.map((g) => (
        <SystemGoalCard key={g.id} g={g} />
      ))}

      {/* Empty state — only when there are no user goals AND no system goals visible */}
      {userGoals.length === 0 && systemGoals.length === 0 && (
        <div className="rounded-xl border border-border bg-card p-12 flex flex-col items-center gap-3 text-center">
          <div className="h-12 w-12 rounded-full bg-orange-500/10 flex items-center justify-center">
            <Target className="h-6 w-6 text-orange-500" />
          </div>
          <p className="font-semibold">Nenhuma meta criada</p>
          <p className="text-sm text-muted-foreground max-w-xs">
            Defina uma meta de receita com prazo e acompanhe o progresso automaticamente.
          </p>
          <button onClick={openCreate} className="mt-1 inline-flex items-center gap-2 h-9 px-4 rounded-xl bg-orange-500 hover:bg-orange-600 text-white text-sm font-semibold transition-colors">
            <Plus className="h-4 w-4" /> Criar primeira meta
          </button>
        </div>
      )}

      {/* User goal sections */}
      {active.length > 0 && (
        <Section title="Ativas" count={active.length}>
          {active.map((g) => <GoalCard key={g.id} g={g} onEdit={() => openEdit(g)} onArchive={() => archive(g.id)} onDelete={() => destroy(g.id)} />)}
        </Section>
      )}
      {completed.length > 0 && (
        <Section title="Concluídas" count={completed.length} muted>
          {completed.map((g) => <GoalCard key={g.id} g={g} onEdit={() => openEdit(g)} onArchive={() => archive(g.id)} onDelete={() => destroy(g.id)} />)}
        </Section>
      )}
      {expired.length > 0 && (
        <Section title="Expiradas" count={expired.length} muted>
          {expired.map((g) => <GoalCard key={g.id} g={g} onEdit={() => openEdit(g)} onArchive={() => archive(g.id)} onDelete={() => destroy(g.id)} />)}
        </Section>
      )}
      {archived.length > 0 && (
        <Section title="Arquivadas" count={archived.length} muted>
          {archived.map((g) => <GoalCard key={g.id} g={g} onEdit={() => openEdit(g)} onArchive={() => archive(g.id)} onDelete={() => destroy(g.id)} />)}
        </Section>
      )}

      {/* Form Dialog */}
      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editingId ? "Editar Meta" : "Nova Meta"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-1">

            <Field label="Título da meta">
              <input
                type="text"
                placeholder="Ex: Entrada do apartamento"
                value={draft.title}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                className="w-full h-9 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500/30"
              />
            </Field>

            <Field label="Descrição (opcional)">
              <textarea
                placeholder="Detalhes sobre a meta…"
                value={draft.description}
                onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                rows={2}
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500/30 resize-none"
              />
            </Field>

            <Field label="Valor alvo (R$)">
              <input
                type="text"
                inputMode="decimal"
                placeholder="R$ 0,00"
                value={draft.target_amount}
                onChange={(e) => setDraft({ ...draft, target_amount: e.target.value })}
                className="w-full h-9 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500/30"
              />
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Início">
                <input type="date" value={draft.start_date} onChange={(e) => setDraft({ ...draft, start_date: e.target.value })}
                  className="w-full h-9 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500/30" />
              </Field>
              <Field label="Prazo">
                <input type="date" value={draft.end_date} min={draft.start_date} onChange={(e) => setDraft({ ...draft, end_date: e.target.value })}
                  className="w-full h-9 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500/30" />
              </Field>
            </div>

            <div className="flex gap-2 pt-1">
              <button onClick={() => setShowForm(false)}
                className="flex-1 h-9 rounded-xl border border-border text-sm hover:bg-muted transition-colors">
                Cancelar
              </button>
              <button
                onClick={save}
                disabled={!draft.title.trim() || parseBrl(draft.target_amount) <= 0 || saving}
                className="flex-1 h-9 rounded-xl bg-orange-500 hover:bg-orange-600 text-white text-sm font-semibold transition-colors disabled:opacity-40"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin mx-auto" /> : editingId ? "Salvar" : "Criar meta"}
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{label}</label>
      {children}
    </div>
  );
}

function Section({
  title, count, children, muted, icon,
}: {
  title: string; count: number; children: React.ReactNode; muted?: boolean; icon?: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        {icon}
        <h2 className={cn("text-sm font-semibold", muted ? "text-muted-foreground" : "text-foreground")}>{title}</h2>
        <span className="text-xs bg-muted text-muted-foreground px-2 py-0.5 rounded-full">{count}</span>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">{children}</div>
    </div>
  );
}

// ─── System goal compact card ─────────────────────────────────────────────────

function SystemGoalCard({ g }: { g: GoalProgress }) {
  const pct = Math.min(100, Number(g.progress_percentage));
  const isCompleted = g.calculated_status === "COMPLETED";
  const isExpired   = g.calculated_status === "EXPIRED";

  const barColor =
    isExpired            ? "bg-slate-300"   :
    isCompleted          ? "bg-emerald-500" :
    pct >= 70            ? "bg-emerald-500" :
    pct >= 40            ? "bg-amber-400"   : "bg-red-400";

  const pctColor =
    isExpired            ? "text-slate-400"  :
    isCompleted          ? "text-emerald-600":
    pct >= 70            ? "text-emerald-600":
    pct >= 40            ? "text-amber-500"  : "text-red-500";

  const borderClass = isExpired
    ? "border-slate-200 dark:border-slate-700 opacity-70"
    : "border-orange-200 dark:border-orange-800";

  return (
    <div className={`rounded-2xl border bg-card p-4 flex flex-col gap-3 ${borderClass}`}>
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <div className={`shrink-0 h-8 w-8 rounded-full flex items-center justify-center ${isExpired ? "bg-slate-100" : "bg-orange-500/10"}`}>
            <Lock className={`h-3.5 w-3.5 ${isExpired ? "text-slate-400" : "text-orange-500"}`} />
          </div>
          <div className="min-w-0">
            <p className={`text-sm font-semibold leading-tight ${isExpired ? "text-muted-foreground" : ""}`}>{g.title}</p>
            <p className="text-[11px] text-muted-foreground">
              Meta mensal do sistema · {fmtDate(g.start_date)} → {fmtDate(g.end_date)}
            </p>
          </div>
        </div>
        <div className="shrink-0 text-right">
          {isExpired ? (
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Encerrada</p>
          ) : (
            <p className={`text-xl font-bold tabular-nums ${pctColor}`}>{pct.toFixed(0)}%</p>
          )}
          {isCompleted && (
            <p className="text-[10px] text-emerald-600 font-semibold">Pagamento liberado ✓</p>
          )}
        </div>
      </div>

      {/* Progress bar */}
      <div className="space-y-1.5">
        <div className="h-2.5 bg-muted rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-700 ${barColor}`}
            style={{ width: `${pct}%` }}
          />
        </div>
        <div className="flex justify-between text-xs text-muted-foreground tabular-nums">
          <span className={`font-medium ${isExpired ? "text-muted-foreground" : "text-foreground"}`}>{fmtUsd(Number(g.current_amount))}</span>
          <span>de {fmtUsd(Number(g.target_amount))}</span>
        </div>
      </div>
    </div>
  );
}

// ─── User goal card ───────────────────────────────────────────────────────────

function GoalCard({ g, onEdit, onArchive, onDelete }: {
  g: GoalProgress;
  onEdit: () => void;
  onArchive: () => void;
  onDelete: () => void;
}) {
  const pct = Number(g.progress_percentage);
  const isCompleted = g.calculated_status === "COMPLETED";
  const isExpired   = g.calculated_status === "EXPIRED";
  const isArchived  = g.calculated_status === "ARCHIVED";

  const barColor =
    g.risk_level === "GREEN"  ? "bg-emerald-500" :
    g.risk_level === "YELLOW" ? "bg-amber-400" :
    "bg-red-400";

  const borderColor =
    g.is_system             ? "border-orange-300 dark:border-orange-700" :
    isCompleted             ? "border-emerald-200 dark:border-emerald-800" :
    isExpired               ? "border-red-200 dark:border-red-900" :
    isArchived              ? "border-border opacity-60" :
    g.risk_level === "YELLOW" ? "border-amber-200 dark:border-amber-800" :
    g.risk_level === "RED" && !isExpired ? "border-red-200 dark:border-red-900" :
    "border-border";

  // System goals display in USD; user goals display in BRL
  const fmtCurrent = g.is_system
    ? fmtUsd(Number(g.current_amount))
    : formatBRL(Number(g.current_amount));
  const fmtTarget = g.is_system
    ? fmtUsd(Number(g.target_amount))
    : formatBRL(Number(g.target_amount));
  const fmtRemaining = g.is_system
    ? fmtUsd(Number(g.remaining_amount))
    : formatBRL(Number(g.remaining_amount));

  return (
    <div className={cn("rounded-2xl border bg-card p-5 flex flex-col gap-4", borderColor)}>
      {/* Top row */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 mb-0.5 flex-wrap">
            <StatusBadge status={g.calculated_status} daysLeft={Number(g.days_remaining)} />
            {g.is_system && (
              <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-orange-700 bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800 px-2 py-0.5 rounded-full">
                <Lock className="h-3 w-3" /> Meta do Sistema
              </span>
            )}
          </div>
          <p className="text-sm font-semibold truncate">{g.title}</p>
          {g.description && <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{g.description}</p>}
          <p className="text-[11px] text-muted-foreground mt-1">{fmtDate(g.start_date)} → {fmtDate(g.end_date)}</p>
        </div>
        {/* Only show action buttons for non-system goals */}
        {!g.is_system && (
          <div className="flex items-center gap-0.5 shrink-0">
            <button onClick={onEdit} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors">
              <Pencil className="h-3.5 w-3.5" />
            </button>
            {!isArchived && (
              <button onClick={onArchive} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors">
                <Archive className="h-3.5 w-3.5" />
              </button>
            )}
            <button onClick={onDelete} className="p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 text-muted-foreground hover:text-red-500 transition-colors">
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </div>

      {/* Progress */}
      <div className="space-y-2">
        <div className="flex items-end justify-between gap-2">
          <div>
            <p className="text-xl font-bold tabular-nums">{fmtCurrent}</p>
            <p className="text-xs text-muted-foreground">de {fmtTarget}</p>
          </div>
          <div className="flex items-center gap-1.5">
            <RiskIcon level={g.risk_level} />
            <p className={cn("text-2xl font-bold tabular-nums",
              isCompleted ? "text-emerald-600" :
              g.risk_level === "GREEN"  ? "text-emerald-600" :
              g.risk_level === "YELLOW" ? "text-amber-500" :
              "text-red-500"
            )}>
              {pct.toFixed(0)}%
            </p>
          </div>
        </div>

        <div className="h-2 bg-muted rounded-full overflow-hidden">
          <div className={cn("h-full rounded-full transition-all duration-500", barColor)} style={{ width: `${pct}%` }} />
        </div>

        <div className="flex justify-between items-center text-[11px] text-muted-foreground">
          <span>Faltam {fmtRemaining}</span>
          {!isCompleted && !isExpired && !isArchived && (
            <span>{Number(g.days_remaining)}d restantes</span>
          )}
          {isCompleted && g.is_system && (
            <span className="text-emerald-600 font-medium">✓ Pagamento liberado</span>
          )}
        </div>
      </div>
    </div>
  );
}

function StatusBadge({ status, daysLeft }: { status: CalcStatus; daysLeft: number }) {
  if (status === "COMPLETED") return (
    <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-700 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 px-2 py-0.5 rounded-full">
      <CheckCircle2 className="h-3 w-3" /> Concluída
    </span>
  );
  if (status === "EXPIRED") return (
    <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-red-700 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-900 px-2 py-0.5 rounded-full">
      <XCircle className="h-3 w-3" /> Expirada
    </span>
  );
  if (status === "ARCHIVED") return (
    <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-muted-foreground bg-muted border border-border px-2 py-0.5 rounded-full">
      <Archive className="h-3 w-3" /> Arquivada
    </span>
  );
  if (daysLeft <= 3) return (
    <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-amber-700 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 px-2 py-0.5 rounded-full">
      <Clock className="h-3 w-3" /> {daysLeft}d restantes
    </span>
  );
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-blue-700 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 px-2 py-0.5 rounded-full">
      <TrendingUp className="h-3 w-3" /> Ativa
    </span>
  );
}

function RiskIcon({ level }: { level: RiskLevel }) {
  if (level === "GREEN")  return <CheckCircle2 className="h-4 w-4 text-emerald-500" />;
  if (level === "YELLOW") return <AlertTriangle className="h-4 w-4 text-amber-400" />;
  return <AlertTriangle className="h-4 w-4 text-red-400" />;
}
