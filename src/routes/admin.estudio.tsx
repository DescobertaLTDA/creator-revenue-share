import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";
import {
  FlaskConical, Plus, Link2, Eye, TrendingUp, ChevronRight,
  X, Save, Clock, Music, Mic2, Film, Hash, AlignLeft,
  BarChart3, Sparkles, Target, Video,
} from "lucide-react";

export const Route = createFileRoute("/admin/estudio")({
  component: EstudioPage,
});

// ─── Types ──────────────────────────────────────────────────────────────────
interface ReelLab {
  id: string;
  tracking_code: string;
  page_id: string | null;
  collaborator_id: string | null;
  post_id: string | null;
  title: string;
  script: string | null;
  hook_type: string | null;
  topic_angle: string | null;
  duration_s: number | null;
  animal_count: number | null;
  narration_type: string | null;
  music_style: string | null;
  scene_types: string[] | null;
  scene_count: number | null;
  production_time_min: number | null;
  notes: string | null;
  status: "rascunho" | "publicado" | "linkado";
  published_at: string | null;
  created_at: string;
}

interface ReelLabSnapshot {
  id: string;
  lab_id: string;
  captured_at: string;
  day_since_publish: number | null;
  views: number | null;
  reach: number | null;
  reactions: number | null;
  comments: number | null;
  shares: number | null;
  revenue_usd: number | null;
}

interface Page { id: string; nome: string; }
interface Collaborator { id: string; nome: string; }

// ─── Options ────────────────────────────────────────────────────────────────
const HOOK_OPTIONS = [
  { value: "pergunta", label: "❓ Pergunta" },
  { value: "chocante", label: "😱 Chocante" },
  { value: "countdown", label: "🔢 Countdown" },
  { value: "misterio", label: "🔮 Mistério" },
  { value: "afirmacao", label: "💬 Afirmação" },
];

const NARRATION_OPTIONS = [
  { value: "capcut", label: "🎙 CapCut TTS" },
  { value: "elevenlabs", label: "🤖 ElevenLabs" },
  { value: "propria", label: "🎤 Voz própria" },
];

const MUSIC_OPTIONS = [
  { value: "dramatica", label: "🎭 Dramática" },
  { value: "suspense", label: "😰 Suspense" },
  { value: "acao", label: "⚡ Ação" },
  { value: "epica", label: "🏆 Épica" },
  { value: "suave", label: "🌿 Suave" },
  { value: "sem_musica", label: "🔇 Sem música" },
];

const SCENE_OPTIONS = [
  "natureza", "close_animal", "grupo", "slow_motion",
  "aerea", "noturno", "aquatico", "selvagem",
];

const ANIMAL_COUNT_OPTIONS = [3, 5, 10];

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  rascunho: { label: "Rascunho", color: "bg-gray-500/20 text-gray-300" },
  publicado: { label: "Publicado", color: "bg-blue-500/20 text-blue-400" },
  linkado: { label: "Linkado", color: "bg-green-500/20 text-green-400" },
};

// ─── Helpers ─────────────────────────────────────────────────────────────────
function fmt(n: number | null | undefined): string {
  if (n == null) return "—";
  return n.toLocaleString("pt-BR");
}

function fmtUsd(n: number | null | undefined): string {
  if (n == null) return "—";
  return `$${Number(n).toFixed(4)}`;
}

// ─── Main page ────────────────────────────────────────────────────────────────
function EstudioPage() {
  const { profile } = useAuth();
  const [tab, setTab] = useState<"experimentos" | "insights">("experimentos");
  const [reels, setReels] = useState<ReelLab[]>([]);
  const [snapshots, setSnapshots] = useState<ReelLabSnapshot[]>([]);
  const [pages, setPages] = useState<Page[]>([]);
  const [collaborators, setCollaborators] = useState<Collaborator[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [selectedReel, setSelectedReel] = useState<ReelLab | null>(null);

  const isAdmin = profile?.role === "admin";

  useEffect(() => {
    loadAll();
  }, []);

  async function loadAll() {
    setLoading(true);
    const [{ data: r }, { data: s }, { data: p }, { data: c }] = await Promise.all([
      (supabase as any).from("reel_lab").select("*").order("created_at", { ascending: false }),
      (supabase as any).from("reel_lab_snapshots").select("*").order("captured_at", { ascending: true }),
      supabase.from("pages").select("id, nome").order("nome"),
      supabase.from("collaborators").select("id, nome").order("nome"),
    ]);
    setReels((r ?? []) as ReelLab[]);
    setSnapshots((s ?? []) as ReelLabSnapshot[]);
    setPages((p ?? []) as Page[]);
    setCollaborators((c ?? []) as Collaborator[]);
    setLoading(false);
  }

  // KPIs
  const totalReels = reels.length;
  const linkedReels = reels.filter((r) => r.status === "linkado").length;
  const snapshotsWithViews = snapshots.filter((s) => s.views != null);
  const avgViews =
    snapshotsWithViews.length > 0
      ? Math.round(snapshotsWithViews.reduce((a, s) => a + (s.views ?? 0), 0) / snapshotsWithViews.length)
      : null;
  const bestReel = useMemo(() => {
    if (!reels.length) return null;
    const totals = new Map<string, number>();
    for (const s of snapshots) {
      totals.set(s.lab_id, (totals.get(s.lab_id) ?? 0) + (s.views ?? 0));
    }
    let best: ReelLab | null = null;
    let bestViews = 0;
    for (const r of reels) {
      const v = totals.get(r.id) ?? 0;
      if (v > bestViews) { bestViews = v; best = r; }
    }
    return best ? { reel: best, views: bestViews } : null;
  }, [reels, snapshots]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-[#FAA613]/10">
            <FlaskConical className="h-5 w-5 text-[#FAA613]" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-foreground">Estúdio</h1>
            <p className="text-sm text-muted-foreground">Laboratório de Reels — teste, mede, otimiza</p>
          </div>
        </div>
        {isAdmin && (
          <button
            onClick={() => setShowForm(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[#FAA613] hover:bg-[#FAA613]/90 text-black font-semibold text-sm transition-colors"
          >
            <Plus className="h-4 w-4" />
            Novo Reel
          </button>
        )}
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard icon={<FlaskConical className="h-4 w-4" />} label="Experimentos" value={totalReels.toString()} />
        <KpiCard icon={<Link2 className="h-4 w-4" />} label="Linkados" value={linkedReels.toString()} sub={totalReels ? `${Math.round((linkedReels / totalReels) * 100)}%` : undefined} />
        <KpiCard icon={<Eye className="h-4 w-4" />} label="Média de Views" value={avgViews != null ? fmt(avgViews) : "—"} />
        <KpiCard
          icon={<TrendingUp className="h-4 w-4" />}
          label="Melhor Reel"
          value={bestReel ? `[${bestReel.reel.tracking_code}]` : "—"}
          sub={bestReel ? fmt(bestReel.views) + " views" : undefined}
        />
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border">
        {(["experimentos", "insights"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              "px-4 py-2 text-sm font-medium capitalize transition-colors border-b-2 -mb-px",
              tab === t
                ? "border-[#FAA613] text-[#FAA613]"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            {t === "experimentos" ? "Experimentos" : "Insights"}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20 text-muted-foreground">Carregando…</div>
      ) : tab === "experimentos" ? (
        <ExperimentsTab
          reels={reels}
          snapshots={snapshots}
          pages={pages}
          onSelect={setSelectedReel}
        />
      ) : (
        <InsightsTab reels={reels} snapshots={snapshots} />
      )}

      {/* New reel modal */}
      {showForm && (
        <ReelFormModal
          pages={pages}
          collaborators={collaborators}
          onClose={() => setShowForm(false)}
          onSaved={() => { setShowForm(false); loadAll(); }}
        />
      )}

      {/* Detail drawer */}
      {selectedReel && (
        <ReelDetailDrawer
          reel={selectedReel}
          snapshots={snapshots.filter((s) => s.lab_id === selectedReel.id)}
          pages={pages}
          collaborators={collaborators}
          onClose={() => setSelectedReel(null)}
          onUpdated={() => { setSelectedReel(null); loadAll(); }}
        />
      )}
    </div>
  );
}

// ─── KPI Card ─────────────────────────────────────────────────────────────────
function KpiCard({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-2">
      <div className="flex items-center gap-2 text-muted-foreground text-xs">{icon}{label}</div>
      <p className="text-2xl font-bold text-foreground">{value}</p>
      {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}

// ─── Experiments Tab ──────────────────────────────────────────────────────────
function ExperimentsTab({
  reels, snapshots, pages, onSelect,
}: {
  reels: ReelLab[];
  snapshots: ReelLabSnapshot[];
  pages: Page[];
  onSelect: (r: ReelLab) => void;
}) {
  const pageMap = useMemo(() => new Map(pages.map((p) => [p.id, p.nome])), [pages]);

  const latestSnap = useMemo(() => {
    const m = new Map<string, ReelLabSnapshot>();
    for (const s of snapshots) {
      const prev = m.get(s.lab_id);
      if (!prev || s.captured_at > prev.captured_at) m.set(s.lab_id, s);
    }
    return m;
  }, [snapshots]);

  if (!reels.length) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-muted-foreground gap-3">
        <FlaskConical className="h-10 w-10 opacity-30" />
        <p className="text-sm">Nenhum experimento cadastrado ainda.</p>
        <p className="text-xs">Clique em "Novo Reel" para começar.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {reels.map((reel) => {
        const snap = latestSnap.get(reel.id);
        const st = STATUS_LABELS[reel.status];
        return (
          <button
            key={reel.id}
            onClick={() => onSelect(reel)}
            className="w-full text-left rounded-xl border border-border bg-card hover:bg-accent/40 transition-colors p-4"
          >
            <div className="flex items-start gap-3">
              <div className="flex flex-col items-center gap-1 shrink-0">
                <span className="font-mono text-xs font-bold text-[#FAA613] bg-[#FAA613]/10 px-2 py-0.5 rounded">
                  {reel.tracking_code}
                </span>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="font-semibold text-sm text-foreground truncate">{reel.title}</p>
                  <span className={cn("text-[10px] font-semibold px-1.5 py-0.5 rounded-full", st.color)}>
                    {st.label}
                  </span>
                </div>
                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                  {reel.page_id && <span>📄 {pageMap.get(reel.page_id) ?? "—"}</span>}
                  {reel.duration_s && <span>⏱ {reel.duration_s}s</span>}
                  {reel.narration_type && <span>🎙 {NARRATION_OPTIONS.find(o => o.value === reel.narration_type)?.label ?? reel.narration_type}</span>}
                  {reel.music_style && <span>🎵 {MUSIC_OPTIONS.find(o => o.value === reel.music_style)?.label ?? reel.music_style}</span>}
                  {reel.animal_count && <span>🦁 {reel.animal_count} animais</span>}
                  {reel.hook_type && <span>🪝 {HOOK_OPTIONS.find(o => o.value === reel.hook_type)?.label ?? reel.hook_type}</span>}
                </div>
              </div>
              <div className="shrink-0 text-right space-y-0.5">
                {snap?.views != null && (
                  <p className="text-sm font-bold text-foreground">{fmt(snap.views)}</p>
                )}
                {snap?.views != null && (
                  <p className="text-[10px] text-muted-foreground">views</p>
                )}
                {snap?.revenue_usd != null && (
                  <p className="text-xs text-green-400">{fmtUsd(snap.revenue_usd)}</p>
                )}
              </div>
              <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
            </div>
          </button>
        );
      })}
    </div>
  );
}

// ─── Insights Tab ─────────────────────────────────────────────────────────────
function InsightsTab({ reels, snapshots }: { reels: ReelLab[]; snapshots: ReelLabSnapshot[] }) {
  const reelMap = useMemo(() => new Map(reels.map((r) => [r.id, r])), [reels]);

  function avgByField<K extends keyof ReelLab>(
    field: K,
    options: { value: string; label: string }[]
  ) {
    const sums = new Map<string, { total: number; count: number }>();
    for (const s of snapshots) {
      if (s.views == null) continue;
      const reel = reelMap.get(s.lab_id);
      if (!reel) continue;
      const val = String(reel[field] ?? "");
      if (!val) continue;
      const prev = sums.get(val) ?? { total: 0, count: 0 };
      sums.set(val, { total: prev.total + s.views, count: prev.count + 1 });
    }
    return options
      .map((o) => {
        const d = sums.get(o.value);
        return { label: o.label, avg: d ? Math.round(d.total / d.count) : null, count: d?.count ?? 0 };
      })
      .filter((x) => x.count > 0)
      .sort((a, b) => (b.avg ?? 0) - (a.avg ?? 0));
  }

  const byNarration = avgByField("narration_type", NARRATION_OPTIONS);
  const byMusic = avgByField("music_style", MUSIC_OPTIONS);
  const byHook = avgByField("hook_type", HOOK_OPTIONS);
  const byAnimal = avgByField(
    "animal_count",
    ANIMAL_COUNT_OPTIONS.map((n) => ({ value: String(n), label: `🦁 ${n} animais` }))
  );

  if (!snapshots.some((s) => s.views != null)) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-muted-foreground gap-3">
        <BarChart3 className="h-10 w-10 opacity-30" />
        <p className="text-sm">Dados insuficientes para gerar insights.</p>
        <p className="text-xs">Linke reels ao CSV importado para ver correlações.</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <InsightTable title="🎙 Narração × Média de Views" rows={byNarration} />
      <InsightTable title="🎵 Estilo de Música × Média de Views" rows={byMusic} />
      <InsightTable title="🪝 Tipo de Hook × Média de Views" rows={byHook} />
      <InsightTable title="🦁 Qtd. Animais × Média de Views" rows={byAnimal} />
    </div>
  );
}

function InsightTable({ title, rows }: { title: string; rows: { label: string; avg: number | null; count: number }[] }) {
  const maxAvg = Math.max(...rows.map((r) => r.avg ?? 0));
  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-3">
      <p className="text-sm font-semibold text-foreground">{title}</p>
      {rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">Sem dados.</p>
      ) : (
        <div className="space-y-2">
          {rows.map((r) => (
            <div key={r.label} className="space-y-0.5">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">{r.label}</span>
                <span className="font-mono font-semibold text-foreground">
                  {r.avg != null ? fmt(r.avg) : "—"}
                  <span className="text-muted-foreground font-normal ml-1">({r.count})</span>
                </span>
              </div>
              <div className="h-1.5 rounded-full bg-border overflow-hidden">
                <div
                  className="h-full rounded-full bg-[#FAA613]"
                  style={{ width: maxAvg > 0 ? `${((r.avg ?? 0) / maxAvg) * 100}%` : "0%" }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Reel Form Modal ──────────────────────────────────────────────────────────
interface FormState {
  title: string;
  page_id: string;
  collaborator_id: string;
  script: string;
  hook_type: string;
  topic_angle: string;
  duration_s: string;
  animal_count: string;
  narration_type: string;
  music_style: string;
  scene_types: string[];
  scene_count: string;
  production_time_min: string;
  notes: string;
}

const EMPTY_FORM: FormState = {
  title: "", page_id: "", collaborator_id: "", script: "",
  hook_type: "", topic_angle: "", duration_s: "", animal_count: "",
  narration_type: "", music_style: "", scene_types: [], scene_count: "",
  production_time_min: "", notes: "",
};

function ReelFormModal({
  pages, collaborators, onClose, onSaved,
}: {
  pages: Page[];
  collaborators: Collaborator[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { profile } = useAuth();
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function set<K extends keyof FormState>(k: K, v: FormState[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  function toggleScene(s: string) {
    setForm((f) => ({
      ...f,
      scene_types: f.scene_types.includes(s)
        ? f.scene_types.filter((x) => x !== s)
        : [...f.scene_types, s],
    }));
  }

  async function handleSave() {
    if (!form.title.trim()) { setError("Título é obrigatório."); return; }
    setSaving(true);
    setError(null);

    // Determine next tracking code from existing records
    const { data: existing } = await (supabase as any)
      .from("reel_lab")
      .select("tracking_code")
      .order("created_at", { ascending: false });
    let maxNum = 0;
    for (const row of existing ?? []) {
      const m = row.tracking_code.match(/LAB-(\d+)/);
      if (m) maxNum = Math.max(maxNum, parseInt(m[1], 10));
    }
    const tracking_code = `LAB-${String(maxNum + 1).padStart(3, "0")}`;

    const payload = {
      tracking_code,
      title: form.title.trim(),
      page_id: form.page_id || null,
      collaborator_id: form.collaborator_id || null,
      script: form.script || null,
      hook_type: form.hook_type || null,
      topic_angle: form.topic_angle || null,
      duration_s: form.duration_s ? Number(form.duration_s) : null,
      animal_count: form.animal_count ? Number(form.animal_count) : null,
      narration_type: form.narration_type || null,
      music_style: form.music_style || null,
      scene_types: form.scene_types.length ? form.scene_types : null,
      scene_count: form.scene_count ? Number(form.scene_count) : null,
      production_time_min: form.production_time_min ? Number(form.production_time_min) : null,
      notes: form.notes || null,
      status: "rascunho",
      created_by: profile?.id ?? null,
    };

    const { error: err } = await (supabase as any).from("reel_lab").insert(payload);
    if (err) { setError(err.message); setSaving(false); return; }
    onSaved();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-end">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative w-full max-w-lg h-full bg-background border-l border-border flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <div className="flex items-center gap-2">
            <FlaskConical className="h-5 w-5 text-[#FAA613]" />
            <h2 className="font-bold text-foreground">Novo Reel</h2>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-md text-muted-foreground hover:bg-accent">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {error && <p className="text-xs text-red-400 bg-red-400/10 px-3 py-2 rounded-lg">{error}</p>}

          <Field label="Título do reel *" icon={<Video className="h-3.5 w-3.5" />}>
            <input
              value={form.title}
              onChange={(e) => set("title", e.target.value)}
              placeholder="Ex: 10 animais mais rápidos do mundo"
              className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-[#FAA613]/50"
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Página" icon={<Hash className="h-3.5 w-3.5" />}>
              <select value={form.page_id} onChange={(e) => set("page_id", e.target.value)} className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-[#FAA613]/50">
                <option value="">— Selecione —</option>
                {pages.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
              </select>
            </Field>
            <Field label="Colaborador" icon={<Mic2 className="h-3.5 w-3.5" />}>
              <select value={form.collaborator_id} onChange={(e) => set("collaborator_id", e.target.value)} className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-[#FAA613]/50">
                <option value="">— Selecione —</option>
                {collaborators.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
              </select>
            </Field>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <Field label="Duração (s)" icon={<Clock className="h-3.5 w-3.5" />}>
              <input type="number" min={0} value={form.duration_s} onChange={(e) => set("duration_s", e.target.value)} placeholder="90" className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-[#FAA613]/50" />
            </Field>
            <Field label="Prod. (min)" icon={<Clock className="h-3.5 w-3.5" />}>
              <input type="number" min={0} value={form.production_time_min} onChange={(e) => set("production_time_min", e.target.value)} placeholder="45" className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-[#FAA613]/50" />
            </Field>
            <Field label="Cenas" icon={<Film className="h-3.5 w-3.5" />}>
              <input type="number" min={0} value={form.scene_count} onChange={(e) => set("scene_count", e.target.value)} placeholder="12" className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-[#FAA613]/50" />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Narração" icon={<Mic2 className="h-3.5 w-3.5" />}>
              <select value={form.narration_type} onChange={(e) => set("narration_type", e.target.value)} className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-[#FAA613]/50">
                <option value="">— Selecione —</option>
                {NARRATION_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </Field>
            <Field label="Estilo musical" icon={<Music className="h-3.5 w-3.5" />}>
              <select value={form.music_style} onChange={(e) => set("music_style", e.target.value)} className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-[#FAA613]/50">
                <option value="">— Selecione —</option>
                {MUSIC_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Hook" icon={<Sparkles className="h-3.5 w-3.5" />}>
              <select value={form.hook_type} onChange={(e) => set("hook_type", e.target.value)} className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-[#FAA613]/50">
                <option value="">— Selecione —</option>
                {HOOK_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </Field>
            <Field label="Qtd. animais" icon={<Target className="h-3.5 w-3.5" />}>
              <select value={form.animal_count} onChange={(e) => set("animal_count", e.target.value)} className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-[#FAA613]/50">
                <option value="">— Selecione —</option>
                {ANIMAL_COUNT_OPTIONS.map((n) => <option key={n} value={n}>🦁 {n} animais</option>)}
              </select>
            </Field>
          </div>

          <Field label="Ângulo / tópico" icon={<AlignLeft className="h-3.5 w-3.5" />}>
            <input value={form.topic_angle} onChange={(e) => set("topic_angle", e.target.value)} placeholder="Ex: Sobrevivência, Comparação de velocidade" className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-[#FAA613]/50" />
          </Field>

          <Field label="Tipos de cena" icon={<Film className="h-3.5 w-3.5" />}>
            <div className="flex flex-wrap gap-2 mt-1">
              {SCENE_OPTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => toggleScene(s)}
                  className={cn(
                    "px-2.5 py-1 rounded-full text-xs font-medium border transition-colors",
                    form.scene_types.includes(s)
                      ? "bg-[#FAA613]/20 border-[#FAA613]/50 text-[#FAA613]"
                      : "bg-transparent border-border text-muted-foreground hover:border-foreground/30"
                  )}
                >
                  {s.replace("_", " ")}
                </button>
              ))}
            </div>
          </Field>

          <Field label="Roteiro / descrição" icon={<AlignLeft className="h-3.5 w-3.5" />}>
            <textarea
              value={form.script}
              onChange={(e) => set("script", e.target.value)}
              rows={4}
              placeholder="Cole o roteiro ou pontos-chave do reel aqui..."
              className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-[#FAA613]/50 resize-none"
            />
          </Field>

          <Field label="Notas / observações" icon={<AlignLeft className="h-3.5 w-3.5" />}>
            <textarea
              value={form.notes}
              onChange={(e) => set("notes", e.target.value)}
              rows={2}
              placeholder="Observações extras..."
              className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-[#FAA613]/50 resize-none"
            />
          </Field>
        </div>

        <div className="px-5 py-4 border-t border-border shrink-0 flex gap-3">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-lg border border-border text-sm text-muted-foreground hover:bg-accent transition-colors">
            Cancelar
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex-1 py-2.5 rounded-lg bg-[#FAA613] hover:bg-[#FAA613]/90 text-black font-semibold text-sm transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
          >
            <Save className="h-4 w-4" />
            {saving ? "Salvando…" : "Salvar Reel"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Reel Detail Drawer ───────────────────────────────────────────────────────
function ReelDetailDrawer({
  reel, snapshots, pages, collaborators, onClose, onUpdated,
}: {
  reel: ReelLab;
  snapshots: ReelLabSnapshot[];
  pages: Page[];
  collaborators: Collaborator[];
  onClose: () => void;
  onUpdated: () => void;
}) {
  const pageMap = useMemo(() => new Map(pages.map((p) => [p.id, p.nome])), [pages]);
  const collabMap = useMemo(() => new Map(collaborators.map((c) => [c.id, c.nome])), [collaborators]);
  const [addingSnap, setAddingSnap] = useState(false);
  const [snapForm, setSnapForm] = useState({ views: "", reach: "", reactions: "", comments: "", shares: "", revenue_usd: "" });
  const [savingSnap, setSavingSnap] = useState(false);

  async function saveSnapshot() {
    setSavingSnap(true);
    const { error } = await (supabase as any).from("reel_lab_snapshots").insert({
      lab_id: reel.id,
      views: snapForm.views ? Number(snapForm.views) : null,
      reach: snapForm.reach ? Number(snapForm.reach) : null,
      reactions: snapForm.reactions ? Number(snapForm.reactions) : null,
      comments: snapForm.comments ? Number(snapForm.comments) : null,
      shares: snapForm.shares ? Number(snapForm.shares) : null,
      revenue_usd: snapForm.revenue_usd ? Number(snapForm.revenue_usd) : null,
      day_since_publish: reel.published_at
        ? Math.floor((Date.now() - new Date(reel.published_at).getTime()) / 86400000)
        : null,
    });
    setSavingSnap(false);
    if (!error) { setAddingSnap(false); setSnapForm({ views: "", reach: "", reactions: "", comments: "", shares: "", revenue_usd: "" }); onUpdated(); }
  }

  const st = STATUS_LABELS[reel.status];

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-end">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative w-full max-w-lg h-full bg-background border-l border-border flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <span className="font-mono text-sm font-bold text-[#FAA613] bg-[#FAA613]/10 px-2 py-0.5 rounded shrink-0">
              {reel.tracking_code}
            </span>
            <p className="font-bold text-foreground truncate">{reel.title}</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-md text-muted-foreground hover:bg-accent shrink-0">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {/* Status + meta */}
          <div className="flex flex-wrap gap-2 items-center">
            <span className={cn("text-xs font-semibold px-2 py-1 rounded-full", st.color)}>{st.label}</span>
            {reel.page_id && <span className="text-xs text-muted-foreground">📄 {pageMap.get(reel.page_id)}</span>}
            {reel.collaborator_id && <span className="text-xs text-muted-foreground">👤 {collabMap.get(reel.collaborator_id)}</span>}
            {reel.published_at && <span className="text-xs text-muted-foreground">📅 {new Date(reel.published_at).toLocaleDateString("pt-BR")}</span>}
          </div>

          {/* Attributes grid */}
          <div className="grid grid-cols-2 gap-3">
            {reel.duration_s != null && <Attr label="Duração" value={`${reel.duration_s}s`} />}
            {reel.animal_count != null && <Attr label="Animais" value={`🦁 ${reel.animal_count}`} />}
            {reel.narration_type && <Attr label="Narração" value={NARRATION_OPTIONS.find(o => o.value === reel.narration_type)?.label ?? reel.narration_type} />}
            {reel.music_style && <Attr label="Música" value={MUSIC_OPTIONS.find(o => o.value === reel.music_style)?.label ?? reel.music_style} />}
            {reel.hook_type && <Attr label="Hook" value={HOOK_OPTIONS.find(o => o.value === reel.hook_type)?.label ?? reel.hook_type} />}
            {reel.scene_count != null && <Attr label="Cenas" value={String(reel.scene_count)} />}
            {reel.production_time_min != null && <Attr label="Produção" value={`${reel.production_time_min} min`} />}
            {reel.topic_angle && <Attr label="Tópico" value={reel.topic_angle} />}
          </div>

          {reel.scene_types && reel.scene_types.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-muted-foreground mb-1.5">Tipos de cena</p>
              <div className="flex flex-wrap gap-1.5">
                {reel.scene_types.map((s) => (
                  <span key={s} className="text-xs px-2 py-0.5 rounded-full bg-[#FAA613]/10 text-[#FAA613]">{s.replace("_", " ")}</span>
                ))}
              </div>
            </div>
          )}

          {reel.script && (
            <div>
              <p className="text-xs font-semibold text-muted-foreground mb-1.5">Roteiro</p>
              <p className="text-sm text-foreground/80 whitespace-pre-wrap bg-muted/30 rounded-lg px-3 py-2">{reel.script}</p>
            </div>
          )}

          {reel.notes && (
            <div>
              <p className="text-xs font-semibold text-muted-foreground mb-1.5">Notas</p>
              <p className="text-sm text-foreground/80 bg-muted/30 rounded-lg px-3 py-2">{reel.notes}</p>
            </div>
          )}

          {/* Snapshots */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-semibold text-foreground">📸 Snapshots de performance</p>
              <button
                onClick={() => setAddingSnap(!addingSnap)}
                className="text-xs text-[#FAA613] hover:underline"
              >
                + Adicionar
              </button>
            </div>

            {addingSnap && (
              <div className="rounded-xl border border-border bg-card p-4 mb-3 space-y-3">
                <p className="text-xs font-semibold text-muted-foreground">Novo snapshot (agora)</p>
                <div className="grid grid-cols-3 gap-2">
                  {(["views", "reach", "reactions", "comments", "shares"] as const).map((k) => (
                    <div key={k}>
                      <label className="text-[10px] text-muted-foreground capitalize">{k}</label>
                      <input type="number" min={0} value={snapForm[k]} onChange={(e) => setSnapForm(f => ({ ...f, [k]: e.target.value }))} className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-[#FAA613]/50 mt-0.5" placeholder="0" />
                    </div>
                  ))}
                  <div>
                    <label className="text-[10px] text-muted-foreground">Revenue USD</label>
                    <input type="number" step="0.0001" min={0} value={snapForm.revenue_usd} onChange={(e) => setSnapForm(f => ({ ...f, revenue_usd: e.target.value }))} className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-[#FAA613]/50 mt-0.5" placeholder="0.0000" />
                  </div>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => setAddingSnap(false)} className="flex-1 py-1.5 rounded-lg border border-border text-xs text-muted-foreground hover:bg-accent">Cancelar</button>
                  <button onClick={saveSnapshot} disabled={savingSnap} className="flex-1 py-1.5 rounded-lg bg-[#FAA613] text-black text-xs font-semibold disabled:opacity-60">
                    {savingSnap ? "…" : "Salvar"}
                  </button>
                </div>
              </div>
            )}

            {snapshots.length === 0 ? (
              <p className="text-xs text-muted-foreground">Nenhum snapshot ainda.</p>
            ) : (
              <div className="space-y-2">
                {[...snapshots].reverse().map((s) => (
                  <div key={s.id} className="rounded-lg border border-border bg-card/50 px-3 py-2">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[10px] text-muted-foreground">
                        {new Date(s.captured_at).toLocaleString("pt-BR")}
                        {s.day_since_publish != null && ` · dia ${s.day_since_publish}`}
                      </span>
                    </div>
                    <div className="grid grid-cols-3 gap-x-4 gap-y-0.5 text-xs">
                      {s.views != null && <SnapStat label="Views" value={fmt(s.views)} />}
                      {s.reach != null && <SnapStat label="Alcance" value={fmt(s.reach)} />}
                      {s.reactions != null && <SnapStat label="Reações" value={fmt(s.reactions)} />}
                      {s.comments != null && <SnapStat label="Comentários" value={fmt(s.comments)} />}
                      {s.shares != null && <SnapStat label="Compartilhou" value={fmt(s.shares)} />}
                      {s.revenue_usd != null && <SnapStat label="Receita" value={fmtUsd(s.revenue_usd)} />}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Attr({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-muted/30 px-3 py-2">
      <p className="text-[10px] text-muted-foreground">{label}</p>
      <p className="text-sm font-medium text-foreground">{value}</p>
    </div>
  );
}

function SnapStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="text-muted-foreground">{label}: </span>
      <span className="font-semibold text-foreground">{value}</span>
    </div>
  );
}

function Field({ label, icon, children }: { label: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        {icon}{label}
      </label>
      {children}
    </div>
  );
}
