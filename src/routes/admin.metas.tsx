import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { formatBRL } from "@/lib/format";
import {
  Target, Plus, Trash2, Pencil, CheckCircle2, Clock, XCircle,
  DollarSign, Eye, Heart, FileText, TrendingUp,
} from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";

export const Route = createFileRoute("/admin/metas")({
  head: () => ({ meta: [{ title: "Metas — Gestão de Páginas" }] }),
  component: MetasPage,
});

// ─── Types ───────────────────────────────────────────────────────────────────

type MetricKey = "receita" | "views" | "curtidas" | "posts" | "compartilhamentos";

interface Goal {
  id: string;
  name: string;
  metric: MetricKey;
  target: number;
  startDate: string;
  endDate: string;
  createdAt: string;
}

interface RawPost {
  published_at: string | null;
  monetization_approx: number | null;
  estimated_usd: number | null;
  views: number | null;
  reactions: number | null;
  shares: number | null;
}

// ─── DB mapping ──────────────────────────────────────────────────────────────

function mapGoal(row: any): Goal {
  return {
    id: row.id,
    name: row.name,
    metric: row.metric as MetricKey,
    target: Number(row.target),
    startDate: row.start_date,
    endDate: row.end_date,
    createdAt: row.created_at,
  };
}

function toDbPayload(draft: Omit<Goal, "id" | "createdAt">) {
  return {
    name: draft.name,
    metric: draft.metric,
    target: draft.target,
    start_date: draft.startDate,
    end_date: draft.endDate,
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getPostUsd(p: RawPost): number {
  const m = Number(p.monetization_approx ?? 0);
  const e = Number(p.estimated_usd ?? 0);
  return m > 0 ? m : e;
}

const METRIC_CONFIG: Record<MetricKey, { label: string; icon: React.ComponentType<{ className?: string }>; unit: string; step: number }> = {
  receita:           { label: "Receita (USD)",        icon: DollarSign, unit: "$",  step: 100 },
  views:             { label: "Visualizações",         icon: Eye,        unit: "",   step: 100000 },
  curtidas:          { label: "Curtidas",              icon: Heart,      unit: "",   step: 1000 },
  posts:             { label: "Posts publicados",      icon: FileText,   unit: "",   step: 10 },
  compartilhamentos: { label: "Compartilhamentos",     icon: TrendingUp, unit: "",   step: 1000 },
};

function fmtValue(metric: MetricKey, value: number, usdBrl: number | null): string {
  if (metric === "receita") {
    return usdBrl ? formatBRL(value * usdBrl) : `$${value.toFixed(2)}`;
  }
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return value.toLocaleString("pt-BR");
}

function daysLeft(endDate: string): number {
  const today = new Date().toISOString().slice(0, 10);
  return Math.ceil((new Date(endDate).getTime() - new Date(today).getTime()) / 86400000);
}

function goalStatus(pct: number, endDate: string): "completed" | "expired" | "active" {
  if (pct >= 100) return "completed";
  const today = new Date().toISOString().slice(0, 10);
  if (today > endDate) return "expired";
  return "active";
}

function fmtDate(iso: string): string {
  const [, m, d] = iso.split("-");
  return `${d}/${m}`;
}

function emptyDraft(): Omit<Goal, "id" | "createdAt"> {
  const today = new Date().toISOString().slice(0, 10);
  const end = new Date();
  end.setDate(end.getDate() + 30);
  return {
    name: "",
    metric: "receita",
    target: 1000,
    startDate: today,
    endDate: end.toISOString().slice(0, 10),
  };
}

// ─── Page ────────────────────────────────────────────────────────────────────

export function MetasPage() {
  const [goals, setGoals] = useState<Goal[]>([]);
  const [loadingGoals, setLoadingGoals] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [allPosts, setAllPosts] = useState<RawPost[]>([]);
  const [loadingPosts, setLoadingPosts] = useState(true);
  const [usdBrl, setUsdBrl] = useState<number | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingGoal, setEditingGoal] = useState<Goal | null>(null);
  const [draft, setDraft] = useState<Omit<Goal, "id" | "createdAt">>(emptyDraft);
  // Raw text shown in the target input — kept separate so we can format on blur
  const [targetText, setTargetText] = useState("");

  // Load goals from Supabase
  useEffect(() => {
    const fetchGoals = async () => {
      const { data, error } = await (supabase as any)
        .from("goals")
        .select("*")
        .order("created_at", { ascending: false });
      if (!error && data) setGoals((data as any[]).map(mapGoal));
      setLoadingGoals(false);
    };
    fetchGoals();

    // Real-time sync across devices
    const channel = supabase.channel("goals-sync")
      .on("postgres_changes", { event: "*", schema: "public", table: "goals" }, fetchGoals)
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  // Fetch posts for progress calculation
  useEffect(() => {
    const fetchPosts = async () => {
      const PAGE = 1000;
      let from = 0;
      const all: RawPost[] = [];
      while (true) {
        const { data, error } = await supabase
          .from("posts")
          .select("published_at, monetization_approx, estimated_usd, views, reactions, shares")
          .range(from, from + PAGE - 1);
        if (error || !data || data.length === 0) break;
        all.push(...(data as RawPost[]));
        if (data.length < PAGE) break;
        from += data.length;
      }
      setAllPosts(all);
      setLoadingPosts(false);
    };
    fetchPosts();
    fetch("https://economia.awesomeapi.com.br/json/last/USD-BRL")
      .then((r) => r.json())
      .then((d) => setUsdBrl(parseFloat(d.USDBRL.bid)))
      .catch(() => {});
  }, []);

  // Compute progress for each goal
  const goalProgress = useMemo(() => {
    return goals.map((goal) => {
      const posts = allPosts.filter((p) => {
        if (!p.published_at) return false;
        const day = p.published_at.slice(0, 10);
        return day >= goal.startDate && day <= goal.endDate;
      });

      let current = 0;
      switch (goal.metric) {
        case "receita":           current = posts.reduce((s, p) => s + getPostUsd(p), 0); break;
        case "views":             current = posts.reduce((s, p) => s + Number(p.views ?? 0), 0); break;
        case "curtidas":          current = posts.reduce((s, p) => s + Number(p.reactions ?? 0), 0); break;
        case "posts":             current = posts.length; break;
        case "compartilhamentos": current = posts.reduce((s, p) => s + Number(p.shares ?? 0), 0); break;
      }

      const pct = Math.min((current / Math.max(goal.target, 0.0001)) * 100, 100);
      const status = goalStatus(pct, goal.endDate);
      const days = daysLeft(goal.endDate);
      return { ...goal, current, pct, status, daysLeft: days };
    });
  }, [goals, allPosts]);

  const sorted = useMemo(() => {
    const order = { active: 0, completed: 1, expired: 2 };
    return [...goalProgress].sort((a, b) => order[a.status] - order[b.status] || new Date(a.endDate).getTime() - new Date(b.endDate).getTime());
  }, [goalProgress]);

  const active = sorted.filter((g) => g.status === "active");
  const completed = sorted.filter((g) => g.status === "completed");
  const expired = sorted.filter((g) => g.status === "expired");

  // For receita: the user inputs BRL; we store USD. Convert on the boundary.
  const brlToUsd = (brl: number) => (usdBrl && usdBrl > 0 ? brl / usdBrl : brl);
  const usdToBrl = (usd: number) => (usdBrl && usdBrl > 0 ? usd * usdBrl : usd);

  const fmtTargetDisplay = (d: typeof draft) =>
    d.metric === "receita"
      ? usdToBrl(d.target).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
      : String(d.target);

  const openCreate = () => {
    const d = emptyDraft();
    setDraft(d);
    setTargetText(fmtTargetDisplay(d));
    setEditingGoal(null);
    setShowForm(true);
  };
  const openEdit = (g: Goal) => {
    const d = { name: g.name, metric: g.metric, target: g.target, startDate: g.startDate, endDate: g.endDate };
    setDraft(d);
    setTargetText(fmtTargetDisplay(d));
    setEditingGoal(g);
    setShowForm(true);
  };

  const saveForm = async () => {
    if (!draft.name.trim() || draft.target <= 0) return;
    setSaving(true);
    setSaveError(null);
    const payload = toDbPayload(draft);
    if (editingGoal) {
      const { error } = await (supabase as any).from("goals").update(payload).eq("id", editingGoal.id);
      setSaving(false);
      if (error) { setSaveError("Erro ao salvar: " + error.message); return; }
      setGoals(prev => prev.map(g => g.id === editingGoal.id ? { ...g, ...draft } : g));
    } else {
      const { data: newRow, error } = await (supabase as any).from("goals").insert(payload).select().single();
      setSaving(false);
      if (error) { setSaveError("Erro ao salvar: " + error.message); return; }
      if (newRow) setGoals(prev => [mapGoal(newRow), ...prev]);
    }
    setShowForm(false);
  };

  const deleteGoal = async (id: string) => {
    setGoals((prev) => prev.filter((g) => g.id !== id));
    await (supabase as any).from("goals").delete().eq("id", id);
  };

  return (
    <div className="space-y-6 pb-10">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Metas</h1>
          <p className="text-sm text-[#7c6f8e] mt-0.5">Crie e acompanhe metas de receita, views e engajamento</p>
        </div>
        <button
          onClick={openCreate}
          className="flex items-center gap-1.5 px-4 py-2 bg-gradient-to-r from-[#6200b3] to-[#b43e8f] text-white text-sm font-medium rounded-xl hover:from-[#3b0086] hover:to-[#8f2d6f] transition-all shadow-sm"
        >
          <Plus className="h-4 w-4" />
          Nova Meta
        </button>
      </div>

      {/* Loading skeleton */}
      {loadingGoals && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="bg-white border border-[#e8e0f5] rounded-2xl p-5 h-40 animate-pulse" />
          ))}
        </div>
      )}

      {/* Empty state */}
      {!loadingGoals && goals.length === 0 && (
        <div className="bg-white border border-[#e8e0f5] rounded-2xl p-16 text-center shadow-sm">
          <div className="h-12 w-12 rounded-2xl bg-[#f3e8ff] flex items-center justify-center mx-auto mb-4">
            <Target className="h-6 w-6 text-[#6200b3]" />
          </div>
          <p className="font-semibold text-[#1a0533]">Nenhuma meta criada</p>
          <p className="text-sm text-[#9d8fb0] mt-1 mb-4">Defina metas de receita, views ou curtidas com prazo</p>
          <button onClick={openCreate} className="px-5 py-2 bg-[#6200b3] text-white text-sm font-medium rounded-xl hover:bg-[#4a0090] transition-colors">
            Criar primeira meta
          </button>
        </div>
      )}

      {!loadingGoals && (
        <>
          {active.length > 0 && (
            <Section title="Ativas" count={active.length}>
              {active.map((g) => <GoalCard key={g.id} g={g} usdBrl={usdBrl} onEdit={() => openEdit(g)} onDelete={() => deleteGoal(g.id)} loading={loadingPosts} />)}
            </Section>
          )}
          {completed.length > 0 && (
            <Section title="Concluídas" count={completed.length} muted>
              {completed.map((g) => <GoalCard key={g.id} g={g} usdBrl={usdBrl} onEdit={() => openEdit(g)} onDelete={() => deleteGoal(g.id)} loading={loadingPosts} />)}
            </Section>
          )}
          {expired.length > 0 && (
            <Section title="Expiradas" count={expired.length} muted>
              {expired.map((g) => <GoalCard key={g.id} g={g} usdBrl={usdBrl} onEdit={() => openEdit(g)} onDelete={() => deleteGoal(g.id)} loading={loadingPosts} />)}
            </Section>
          )}
        </>
      )}

      {/* Form Dialog */}
      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editingGoal ? "Editar Meta" : "Nova Meta"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-1">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-[#7c6f8e] uppercase tracking-wider">Nome da meta</label>
              <input
                type="text"
                placeholder="Ex: 1M de views em maio"
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                className="w-full h-9 rounded-lg border border-[#e8e0f5] px-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#6200b3]/30"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-[#7c6f8e] uppercase tracking-wider">Métrica</label>
              <div className="grid grid-cols-2 gap-2">
                {(Object.keys(METRIC_CONFIG) as MetricKey[]).map((mk) => {
                  const { label, icon: Icon } = METRIC_CONFIG[mk];
                  return (
                    <button
                      key={mk}
                      onClick={() => {
                        const next = { ...draft, metric: mk };
                        setDraft(next);
                        setTargetText(fmtTargetDisplay(next));
                      }}
                      className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border text-sm font-medium transition-colors ${
                        draft.metric === mk
                          ? "bg-[#6200b3] text-white border-[#6200b3]"
                          : "border-[#e8e0f5] text-[#4a3560] hover:bg-[#f3e8ff]"
                      }`}
                    >
                      <Icon className="h-3.5 w-3.5 shrink-0" />
                      <span className="truncate">{label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-[#7c6f8e] uppercase tracking-wider">
                {draft.metric === "receita" ? "Meta — Receita (em R$)" : `Meta — ${METRIC_CONFIG[draft.metric].label}`}
              </label>
              {draft.metric === "receita" ? (
                <input
                  type="text"
                  inputMode="decimal"
                  placeholder="R$ 0,00"
                  value={targetText}
                  onChange={(e) => {
                    const raw = e.target.value;
                    setTargetText(raw);
                    // Parse: strip anything that isn't digit, comma or dot
                    const num = parseFloat(raw.replace(/[^\d,]/g, "").replace(",", ".")) || 0;
                    setDraft((d) => ({ ...d, target: brlToUsd(num) }));
                  }}
                  onFocus={(e) => {
                    // Show bare number for easy editing
                    const brl = usdToBrl(draft.target);
                    setTargetText(brl > 0 ? brl.toFixed(2).replace(".", ",") : "");
                    e.target.select();
                  }}
                  onBlur={() => {
                    if (draft.target > 0) setTargetText(fmtTargetDisplay(draft));
                  }}
                  className="w-full h-9 rounded-lg border border-[#e8e0f5] px-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#6200b3]/30"
                />
              ) : (
                <input
                  type="text"
                  inputMode="numeric"
                  placeholder="0"
                  value={targetText}
                  onChange={(e) => {
                    const raw = e.target.value.replace(/\D/g, "");
                    setTargetText(raw);
                    setDraft((d) => ({ ...d, target: parseInt(raw, 10) || 0 }));
                  }}
                  className="w-full h-9 rounded-lg border border-[#e8e0f5] px-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#6200b3]/30"
                />
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-[#7c6f8e] uppercase tracking-wider">Início</label>
                <input
                  type="date"
                  value={draft.startDate}
                  onChange={(e) => setDraft({ ...draft, startDate: e.target.value })}
                  className="w-full h-9 rounded-lg border border-[#e8e0f5] px-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#6200b3]/30"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-[#7c6f8e] uppercase tracking-wider">Prazo</label>
                <input
                  type="date"
                  value={draft.endDate}
                  min={draft.startDate}
                  onChange={(e) => setDraft({ ...draft, endDate: e.target.value })}
                  className="w-full h-9 rounded-lg border border-[#e8e0f5] px-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#6200b3]/30"
                />
              </div>
            </div>

            {saveError && (
              <p className="text-xs text-red-500 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{saveError}</p>
            )}
            <div className="flex gap-2 pt-1">
              <button
                onClick={() => setShowForm(false)}
                className="flex-1 h-9 rounded-xl border border-[#e8e0f5] text-sm text-[#4a3560] hover:bg-[#f3e8ff] transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={saveForm}
                disabled={!draft.name.trim() || draft.target <= 0 || saving}
                className="flex-1 h-9 rounded-xl bg-[#6200b3] text-white text-sm font-medium hover:bg-[#4a0090] transition-colors disabled:opacity-40"
              >
                {saving ? "Salvando…" : editingGoal ? "Salvar" : "Criar meta"}
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function Section({ title, count, children, muted }: { title: string; count: number; children: React.ReactNode; muted?: boolean }) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <h2 className={`text-sm font-semibold ${muted ? "text-[#9d8fb0]" : "text-[#1a0533]"}`}>{title}</h2>
        <span className="text-xs bg-[#f3e8ff] text-[#7c6f8e] px-2 py-0.5 rounded-full">{count}</span>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {children}
      </div>
    </div>
  );
}

type GoalWithProgress = Goal & { current: number; pct: number; status: "active" | "completed" | "expired"; daysLeft: number };

function GoalCard({ g, usdBrl, onEdit, onDelete, loading }: {
  g: GoalWithProgress;
  usdBrl: number | null;
  onEdit: () => void;
  onDelete: () => void;
  loading: boolean;
}) {
  const { label, icon: Icon } = METRIC_CONFIG[g.metric];
  const isCompleted = g.status === "completed";
  const isExpired = g.status === "expired";

  const barColor = isCompleted ? "bg-emerald-500"
    : isExpired ? "bg-red-400"
    : g.pct >= 75 ? "bg-gradient-to-r from-[#6200b3] to-[#b43e8f]"
    : g.pct >= 40 ? "bg-gradient-to-r from-[#6200b3] to-[#ea7af4]"
    : "bg-[#6200b3]";

  const statusBadge = isCompleted
    ? <span className="flex items-center gap-1 text-[10px] font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full"><CheckCircle2 className="h-3 w-3" />Concluída</span>
    : isExpired
    ? <span className="flex items-center gap-1 text-[10px] font-medium text-red-700 bg-red-50 border border-red-200 px-2 py-0.5 rounded-full"><XCircle className="h-3 w-3" />Expirada</span>
    : g.daysLeft <= 3
    ? <span className="flex items-center gap-1 text-[10px] font-medium text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full"><Clock className="h-3 w-3" />{g.daysLeft}d restantes</span>
    : <span className="text-[10px] font-medium text-[#9d8fb0]">{g.daysLeft}d restantes</span>;

  return (
    <div className={`bg-white border rounded-2xl p-5 shadow-sm flex flex-col gap-4 ${isCompleted ? "border-emerald-200" : isExpired ? "border-red-100" : "border-[#e8e0f5]"}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className={`h-8 w-8 rounded-xl flex items-center justify-center shrink-0 ${isCompleted ? "bg-emerald-50" : "bg-[#f3e8ff]"}`}>
            <Icon className={`h-4 w-4 ${isCompleted ? "text-emerald-600" : "text-[#6200b3]"}`} />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold truncate">{g.name}</p>
            <p className="text-[11px] text-[#9d8fb0]">{label} · {fmtDate(g.startDate)} – {fmtDate(g.endDate)}</p>
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button onClick={onEdit} className="p-1.5 rounded-lg hover:bg-[#f3e8ff] text-[#9d8fb0] hover:text-[#6200b3] transition-colors">
            <Pencil className="h-3.5 w-3.5" />
          </button>
          <button onClick={onDelete} className="p-1.5 rounded-lg hover:bg-red-50 text-[#9d8fb0] hover:text-red-500 transition-colors">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-end justify-between gap-2">
          <div>
            {loading ? (
              <div className="h-6 w-20 bg-[#f3e8ff] rounded animate-pulse" />
            ) : (
              <p className="text-xl font-bold tabular-nums tracking-tight">
                {fmtValue(g.metric, g.current, usdBrl)}
              </p>
            )}
            <p className="text-xs text-[#9d8fb0]">de {fmtValue(g.metric, g.target, usdBrl)}</p>
          </div>
          <div className="text-right">
            <p className={`text-2xl font-bold tabular-nums ${isCompleted ? "text-emerald-600" : isExpired && g.pct < 30 ? "text-red-500" : "text-[#6200b3]"}`}>
              {g.pct.toFixed(0)}%
            </p>
          </div>
        </div>

        <div className="h-2 bg-[#f3e8ff] rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-500 ${barColor}`}
            style={{ width: `${g.pct}%` }}
          />
        </div>

        <div className="flex justify-between items-center">
          {statusBadge}
          {!isCompleted && !isExpired && g.metric === "receita" && usdBrl && g.current < g.target && (
            <span className="text-[10px] text-[#9d8fb0]">
              falta {fmtValue(g.metric, g.target - g.current, usdBrl)}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
