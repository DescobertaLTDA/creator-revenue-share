import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useWriteGuard } from "@/hooks/use-write-guard";
import { formatBRL, formatMonth, formatDateTime } from "@/lib/format";
import { toast } from "sonner";
import {
  ArrowLeft, Loader2, CheckCircle2, Clock, Download,
  Lock, X, DollarSign, Users, Zap, TrendingUp,
  Filter, Shield, ChevronRight, AlertCircle, FileText,
} from "lucide-react";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/admin/fechamentos/$id")({
  head: () => ({ meta: [{ title: "Fechamento — Splash Creators" }] }),
  component: ClosingDetail,
});

// ─── Types ────────────────────────────────────────────────────────────────────

interface Closing {
  id: string;
  month_ref: string;
  status: string;
  total_gross: number | null;
  closed_at: string | null;
  created_at: string;
  pages: { nome: string } | null;
}

interface Item {
  id: string;
  collaborator_id: string;
  gross_revenue: number;
  collaborator_pct: number;
  amount_due: number;
  adjustments: number;
  final_amount: number;
  payment_status: string;
  paid_at: string | null;
  payment_note: string | null;
  collaborators: { nome: string; hashtag: string | null; avatar_url: string | null } | null;
}

interface PaymentNote {
  method: string;
  date: string;
  txId: string;
  amountBrl: number;
  obs: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function parseNote(raw: string | null): PaymentNote {
  const today = new Date().toISOString().slice(0, 10);
  if (!raw) return { method: "PIX", date: today, txId: "", amountBrl: 0, obs: "" };
  try { return { ...{ method: "PIX", date: today, txId: "", amountBrl: 0, obs: "" }, ...JSON.parse(raw) }; }
  catch { return { method: "PIX", date: today, txId: "", amountBrl: 0, obs: "" }; }
}

function initials(nome: string) {
  const p = nome.trim().split(/\s+/);
  return p.length === 1 ? p[0].slice(0, 2).toUpperCase() : (p[0][0] + p[p.length - 1][0]).toUpperCase();
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function ColabAvatar({ nome, url, size = 36 }: { nome: string; url: string | null; size?: number }) {
  if (url) return <img src={url} alt={nome} style={{ width: size, height: size }} className="rounded-full object-cover shrink-0" />;
  return (
    <div style={{ width: size, height: size, fontSize: size * 0.36 }}
      className="rounded-full bg-orange-500/15 text-orange-400 flex items-center justify-center font-semibold shrink-0 select-none">
      {initials(nome)}
    </div>
  );
}

type PStatus = "a_pagar" | "pago_fora" | "ajustado" | string;

function StatusBadge({ status }: { status: PStatus }) {
  const map: Record<string, { label: string; cls: string; icon: React.ReactNode }> = {
    a_pagar: { label: "Pendente", cls: "bg-amber-500/12 text-amber-600 border-amber-400/20", icon: <Clock className="h-3 w-3" /> },
    pago_fora: { label: "Pago", cls: "bg-emerald-500/12 text-emerald-600 border-emerald-400/20", icon: <CheckCircle2 className="h-3 w-3" /> },
    ajustado: { label: "Revisão", cls: "bg-slate-500/12 text-slate-500 border-slate-400/20", icon: <AlertCircle className="h-3 w-3" /> },
  };
  const s = map[status] ?? map.a_pagar;
  return (
    <span className={cn("inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium border", s.cls)}>
      {s.icon}{s.label}
    </span>
  );
}

function MethodBadge({ method }: { method: string }) {
  const colors: Record<string, string> = {
    PIX: "text-emerald-600",
    Wise: "text-blue-500",
    PayPal: "text-blue-700",
    Banco: "text-slate-500",
  };
  const icons: Record<string, string> = { PIX: "◆", Wise: "⬡", PayPal: "⬟", Banco: "▣" };
  return (
    <span className={cn("inline-flex items-center gap-1 text-sm font-medium", colors[method] ?? "text-muted-foreground")}>
      <span className="text-[10px]">{icons[method] ?? "●"}</span>
      {method}
    </span>
  );
}

function StepItem({ n, label, sub, state }: {
  n: number; label: string; sub: string;
  state: "done" | "active" | "pending";
}) {
  return (
    <div className="flex flex-col items-center gap-1.5 min-w-0 flex-1">
      <div className={cn(
        "w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold border-2 transition-all",
        state === "done" && "bg-emerald-500 border-emerald-500 text-white",
        state === "active" && "bg-orange-500 border-orange-500 text-white",
        state === "pending" && "bg-background border-border text-muted-foreground",
      )}>
        {state === "done" ? <CheckCircle2 className="h-4 w-4" /> : n}
      </div>
      <div className="text-center">
        <p className={cn("text-xs font-semibold", state === "pending" ? "text-muted-foreground" : "text-foreground")}>{label}</p>
        <p className={cn("text-[10px] mt-0.5", state === "active" ? "text-orange-500 font-medium" : "text-muted-foreground")}>{sub}</p>
      </div>
    </div>
  );
}

function ProgressLine({ filled }: { filled: boolean }) {
  return (
    <div className="flex-1 flex items-center justify-center mt-[-18px]">
      <div className={cn("h-0.5 w-full", filled ? "bg-emerald-500" : "bg-border")} />
    </div>
  );
}

// ─── Payment panel ────────────────────────────────────────────────────────────

function PaymentPanel({
  item,
  usdBrl,
  isFechado,
  onConfirm,
  onClose,
}: {
  item: Item;
  usdBrl: number;
  isFechado: boolean;
  onConfirm: (itemId: string, note: PaymentNote) => Promise<void>;
  onClose: () => void;
}) {
  const stored = useMemo(() => parseNote(item.payment_note), [item.payment_note]);
  const [method, setMethod] = useState(stored.method);
  const [date, setDate] = useState(stored.date || new Date().toISOString().slice(0, 10));
  const [txId, setTxId] = useState(stored.txId);
  const [amountBrl, setAmountBrl] = useState(stored.amountBrl || parseFloat((item.final_amount * usdBrl).toFixed(2)));
  const [obs, setObs] = useState(stored.obs);
  const [saving, setSaving] = useState(false);

  const nome = item.collaborators?.nome ?? "—";
  const handle = item.collaborators?.hashtag ? `@${item.collaborators.hashtag}` : "";
  const isPago = item.payment_status === "pago_fora";

  const handleConfirm = async () => {
    setSaving(true);
    await onConfirm(item.id, { method, date, txId, amountBrl, obs });
    setSaving(false);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
        <h3 className="font-semibold text-sm">{isPago ? "Detalhes do pagamento" : "Registrar pagamento"}</h3>
        <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted transition-colors text-muted-foreground hover:text-foreground">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
        {/* Collaborator identity */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <ColabAvatar nome={nome} url={item.collaborators?.avatar_url ?? null} size={44} />
            <div>
              <p className="font-semibold text-sm">{nome}</p>
              {handle && <p className="text-xs text-muted-foreground">{handle}</p>}
            </div>
          </div>
          <StatusBadge status={item.payment_status} />
        </div>

        {/* Resumo do repasse */}
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">Resumo do repasse</p>
          <div className="rounded-xl border border-border overflow-hidden">
            <div className="flex items-center justify-between px-4 py-2.5 text-sm">
              <span className="text-muted-foreground">Receita posts</span>
              <span className="tabular-nums font-medium">${item.amount_due.toFixed(2)}</span>
            </div>
            <div className="flex items-center justify-between px-4 py-2.5 text-sm border-t border-border">
              <span className="text-muted-foreground">Receita residual</span>
              <span className="tabular-nums font-medium">${item.adjustments.toFixed(2)}</span>
            </div>
            <div className="flex items-center justify-between px-4 py-2.5 text-sm border-t border-border">
              <span className="text-muted-foreground">Total (USD)</span>
              <span className="tabular-nums font-semibold">${item.final_amount.toFixed(2)}</span>
            </div>
            <div className="flex items-center justify-between px-4 py-2.5 text-sm border-t border-border">
              <span className="text-muted-foreground">Cotação (USD/BRL)</span>
              <span className="tabular-nums">{usdBrl.toFixed(2)}</span>
            </div>
            <div className="flex items-center justify-between px-4 py-3 bg-orange-500/5 border-t border-orange-500/20">
              <span className="font-semibold text-sm">Total (BRL)</span>
              <span className="font-bold text-orange-500 tabular-nums text-sm">{formatBRL(item.final_amount * usdBrl)}</span>
            </div>
          </div>
        </div>

        {/* Payment form */}
        <div className="space-y-3">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Dados do pagamento</p>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Método</label>
              <select
                value={method}
                onChange={(e) => setMethod(e.target.value)}
                disabled={isFechado}
                className="w-full h-9 rounded-lg border border-input bg-background px-3 text-sm disabled:opacity-60"
              >
                <option>PIX</option>
                <option>Wise</option>
                <option>PayPal</option>
                <option>Banco</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Data do pagamento</label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                disabled={isFechado}
                className="w-full h-9 rounded-lg border border-input bg-background px-3 text-sm disabled:opacity-60"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">ID da transação</label>
            <Input
              value={txId}
              onChange={(e) => setTxId(e.target.value)}
              placeholder="PIX-239182-ABCD"
              disabled={isFechado}
              className="h-9 text-sm"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Valor pago (BRL)</label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">R$</span>
              <Input
                type="number"
                step="0.01"
                value={amountBrl}
                onChange={(e) => setAmountBrl(parseFloat(e.target.value) || 0)}
                disabled={isFechado}
                className="h-9 text-sm pl-9"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Observações (opcional)</label>
            <input
              value={obs}
              onChange={(e) => setObs(e.target.value)}
              disabled={isFechado}
              placeholder="Ex.: Pagamento realizado via Pix."
              className="w-full h-9 rounded-lg border border-input bg-background px-3 text-sm disabled:opacity-60 placeholder:text-muted-foreground"
            />
          </div>
        </div>
      </div>

      {/* Footer CTA */}
      {!isFechado && (
        <div className="px-5 py-4 border-t border-border shrink-0">
          <button
            onClick={handleConfirm}
            disabled={saving}
            className="w-full h-11 rounded-xl bg-orange-500 hover:bg-orange-600 text-white font-semibold text-sm transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
            {saving ? "Confirmando…" : "Confirmar pagamento"}
          </button>
          {isPago && (
            <button
              onClick={() => onConfirm(item.id, { method: "a_pagar_revert" as any, date: "", txId: "", amountBrl: 0, obs: "" })}
              className="w-full mt-2 h-9 rounded-xl border border-border text-muted-foreground text-sm hover:bg-muted transition-colors"
            >
              Desfazer pagamento
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

type Tab = "all" | "pago" | "pendente" | "revisao";

function ClosingDetail() {
  const { id } = Route.useParams();
  const { guard, WriteGuardDialog } = useWriteGuard();
  const [closing, setClosing] = useState<Closing | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [usdBrl, setUsdBrl] = useState(5.02);
  const [approving, setApproving] = useState(false);
  const [tab, setTab] = useState<Tab>("all");
  const [selectedItem, setSelectedItem] = useState<Item | null>(null);

  useEffect(() => {
    fetch("https://economia.awesomeapi.com.br/json/last/USD-BRL")
      .then((r) => r.json())
      .then((d) => setUsdBrl(parseFloat(d.USDBRL.bid)))
      .catch(() => null);
  }, []);

  const load = async () => {
    setLoading(true);
    const [{ data: c }, { data: its }] = await Promise.all([
      supabase
        .from("monthly_closings")
        .select("id, month_ref, status, total_gross, closed_at, created_at, pages(nome)")
        .eq("id", id)
        .single(),
      supabase
        .from("monthly_closing_items")
        .select("id, collaborator_id, gross_revenue, collaborator_pct, amount_due, adjustments, final_amount, payment_status, paid_at, payment_note, collaborators(nome, hashtag, avatar_url)")
        .eq("closing_id", id)
        .order("final_amount", { ascending: false }),
    ]);
    setClosing(c as unknown as Closing);
    setItems((its as unknown as Item[]) ?? []);
    setLoading(false);
  };

  useEffect(() => { load(); }, [id]);

  const isFechado = closing?.status === "fechado";

  const approve = async () => {
    setApproving(true);
    const { error } = await supabase
      .from("monthly_closings")
      .update({ status: "fechado", closed_at: new Date().toISOString() })
      .eq("id", id);
    if (error) toast.error("Erro ao finalizar", { description: error.message });
    else { toast.success("Fechamento finalizado!"); await load(); }
    setApproving(false);
  };

  const reopen = async () => {
    const { error } = await supabase
      .from("monthly_closings")
      .update({ status: "aberto", closed_at: null })
      .eq("id", id);
    if (error) toast.error("Erro", { description: error.message });
    else { toast.success("Fechamento reaberto"); await load(); }
  };

  const confirmPayment = async (itemId: string, note: PaymentNote) => {
    // "desfazer" path
    const isRevert = (note as any).method === "a_pagar_revert";
    const update = isRevert
      ? { payment_status: "a_pagar", paid_at: null, payment_note: null }
      : {
          payment_status: "pago_fora",
          paid_at: new Date().toISOString(),
          payment_note: JSON.stringify(note),
        };
    const { error } = await supabase.from("monthly_closing_items").update(update).eq("id", itemId);
    if (error) { toast.error("Erro", { description: error.message }); return; }
    toast.success(isRevert ? "Pagamento desfeito" : "Pagamento confirmado!");
    await load();
    // update selectedItem inline
    setSelectedItem((prev) => prev?.id === itemId
      ? { ...prev, payment_status: isRevert ? "a_pagar" : "pago_fora", paid_at: isRevert ? null : new Date().toISOString(), payment_note: isRevert ? null : JSON.stringify(note) }
      : prev
    );
  };

  // ── Derived values ──────────────────────────────────────────────────────────
  const totalFinal = items.reduce((s, it) => s + it.final_amount, 0);
  const totalPago = items.filter((it) => it.payment_status === "pago_fora").reduce((s, it) => s + it.final_amount, 0);
  const totalPendente = items.filter((it) => it.payment_status === "a_pagar").reduce((s, it) => s + it.final_amount, 0);
  const countPago = items.filter((it) => it.payment_status === "pago_fora").length;
  const countPendente = items.filter((it) => it.payment_status === "a_pagar").length;
  const countRevisao = items.filter((it) => it.payment_status === "ajustado").length;
  const pctDistribuido = totalFinal > 0 ? (totalPago / totalFinal) * 100 : 0;

  const filtered = useMemo(() => {
    if (tab === "pago") return items.filter((it) => it.payment_status === "pago_fora");
    if (tab === "pendente") return items.filter((it) => it.payment_status === "a_pagar");
    if (tab === "revisao") return items.filter((it) => it.payment_status === "ajustado");
    return items;
  }, [items, tab]);

  // ── Stepper state ───────────────────────────────────────────────────────────
  const allPaid = items.length > 0 && countPendente === 0;
  const somePaid = countPago > 0;
  const step3state = allPaid ? "done" : somePaid ? "active" : "pending";
  const step4state = isFechado ? "done" : "pending";

  // ── Loading ─────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex items-center justify-center py-32">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!closing) {
    return (
      <div className="space-y-4 py-8">
        <Link to="/admin/fechamentos" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Voltar
        </Link>
        <p className="text-muted-foreground">Fechamento não encontrado.</p>
      </div>
    );
  }

  return (
    <div className="space-y-5 pb-10">
      <WriteGuardDialog />

      {/* Back link */}
      <Link
        to="/admin/fechamentos"
        className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Fechamentos
      </Link>

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            Fechamento — {formatMonth(closing.month_ref)}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Revise, confirme e registre os pagamentos dos colaboradores.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0 flex-wrap">
          <button
            onClick={() => toast.info("Comprovantes em desenvolvimento")}
            className="inline-flex items-center gap-2 h-9 px-4 rounded-lg border border-border text-sm font-medium hover:bg-muted transition-colors"
          >
            <FileText className="h-4 w-4" />
            Gerar comprovantes
          </button>
          {!isFechado ? (
            <button
              onClick={guard(approve)}
              disabled={approving}
              className="inline-flex items-center gap-2 h-9 px-4 rounded-lg bg-orange-500 hover:bg-orange-600 text-white text-sm font-semibold transition-colors disabled:opacity-70"
            >
              {approving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Shield className="h-4 w-4" />}
              Finalizar fechamento
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5 h-9 px-4 rounded-lg bg-emerald-500/10 text-emerald-600 text-sm font-semibold border border-emerald-500/20">
                <Lock className="h-3.5 w-3.5" /> Finalizado
              </span>
              <button
                onClick={guard(reopen)}
                className="h-9 px-4 rounded-lg border border-border text-sm hover:bg-muted transition-colors"
              >
                Reabrir
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ── KPI Cards ──────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {/* Receita total */}
        <div className="rounded-xl border border-border bg-card p-5">
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Receita total</p>
            <div className="h-7 w-7 rounded-lg bg-orange-500/10 flex items-center justify-center">
              <DollarSign className="h-3.5 w-3.5 text-orange-500" />
            </div>
          </div>
          <p className="text-2xl font-bold tracking-tight tabular-nums">${totalFinal.toFixed(2)}</p>
          <p className="text-xs text-muted-foreground mt-1">{formatBRL(totalFinal * usdBrl)}</p>
        </div>
        {/* Total distribuído */}
        <div className="rounded-xl border border-border bg-card p-5">
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Total distribuído</p>
            <div className="h-7 w-7 rounded-lg bg-emerald-500/10 flex items-center justify-center">
              <TrendingUp className="h-3.5 w-3.5 text-emerald-600" />
            </div>
          </div>
          <p className="text-2xl font-bold tracking-tight tabular-nums">${totalPago.toFixed(2)}</p>
          <div className="mt-2 space-y-1">
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground">{pctDistribuido.toFixed(1)}% do total</p>
            </div>
            <div className="h-1.5 rounded-full bg-muted overflow-hidden">
              <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${pctDistribuido}%` }} />
            </div>
          </div>
        </div>
        {/* Pendentes */}
        <div className="rounded-xl border border-border bg-card p-5">
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Pendentes</p>
            <div className="h-7 w-7 rounded-lg bg-amber-500/10 flex items-center justify-center">
              <Zap className="h-3.5 w-3.5 text-amber-500" />
            </div>
          </div>
          <p className="text-2xl font-bold tracking-tight tabular-nums">${totalPendente.toFixed(2)}</p>
          <div className="mt-2 space-y-1">
            <p className="text-xs text-muted-foreground">
              {totalFinal > 0 ? ((totalPendente / totalFinal) * 100).toFixed(1) : "0.0"}% do total
            </p>
            <div className="h-1.5 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full rounded-full bg-amber-400 transition-all"
                style={{ width: `${totalFinal > 0 ? (totalPendente / totalFinal) * 100 : 0}%` }}
              />
            </div>
          </div>
        </div>
        {/* Colaboradores pagos */}
        <div className="rounded-xl border border-border bg-card p-5">
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Colaboradores pagos</p>
            <div className="h-7 w-7 rounded-lg bg-slate-500/10 flex items-center justify-center">
              <Users className="h-3.5 w-3.5 text-slate-500" />
            </div>
          </div>
          <p className="text-2xl font-bold tracking-tight tabular-nums">{countPago}/{items.length}</p>
          <div className="mt-2 space-y-1">
            <p className="text-xs text-muted-foreground">
              {items.length > 0 ? ((countPago / items.length) * 100).toFixed(1) : "0.0"}% concluído
            </p>
            <div className="h-1.5 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full rounded-full bg-gradient-to-r from-orange-400 to-emerald-500 transition-all"
                style={{ width: `${items.length > 0 ? (countPago / items.length) * 100 : 0}%` }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* ── Stepper ─────────────────────────────────────────────────────────── */}
      <div className="rounded-xl border border-border bg-card px-6 py-5">
        <div className="flex items-start">
          <StepItem n={1} label="Receita consolidada" sub="Concluído" state="done" />
          <ProgressLine filled={true} />
          <StepItem n={2} label="Split calculado" sub="Concluído" state="done" />
          <ProgressLine filled={somePaid} />
          <StepItem
            n={3}
            label="Pagamentos registrados"
            sub={allPaid ? "Concluído" : somePaid ? "Em andamento" : "Pendente"}
            state={step3state}
          />
          <ProgressLine filled={isFechado} />
          <StepItem
            n={4}
            label="Fechamento concluído"
            sub={isFechado ? "Concluído" : "Pendente"}
            state={step4state}
          />
        </div>
      </div>

      {/* ── Table area ──────────────────────────────────────────────────────── */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        {/* Tabs + actions */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-border gap-3 flex-wrap">
          <div className="flex items-center gap-0.5">
            {([ ["all", "Todos", items.length], ["pago", "Pagos", countPago], ["pendente", "Pendentes", countPendente], ["revisao", "Revisão", countRevisao] ] as [Tab, string, number][]).map(([key, label, count]) => (
              <button
                key={key}
                onClick={() => setTab(key)}
                className={cn(
                  "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors",
                  tab === key
                    ? "bg-orange-500/10 text-orange-500"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
              >
                {label}
                <span className={cn(
                  "px-1.5 py-0.5 rounded-full text-[10px] font-bold",
                  tab === key ? "bg-orange-500/20 text-orange-600" : "bg-muted text-muted-foreground"
                )}>
                  {count}
                </span>
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <button className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-border text-xs text-muted-foreground hover:bg-muted transition-colors">
              <Filter className="h-3.5 w-3.5" /> Filtros
            </button>
            <button className="h-8 w-8 rounded-lg border border-border flex items-center justify-center text-muted-foreground hover:bg-muted transition-colors">
              <Download className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {items.length === 0 ? (
          <div className="py-16 text-center text-sm text-muted-foreground">Nenhum item neste fechamento.</div>
        ) : (
          <>
            {/* Mobile cards */}
            <div className="sm:hidden divide-y divide-border">
              {filtered.map((item) => {
                const nome = item.collaborators?.nome ?? "—";
                return (
                  <button
                    key={item.id}
                    onClick={() => setSelectedItem(item)}
                    className="w-full text-left px-4 py-4 hover:bg-muted/30 transition-colors"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-3 min-w-0">
                        <ColabAvatar nome={nome} url={item.collaborators?.avatar_url ?? null} size={36} />
                        <div className="min-w-0">
                          <p className="font-semibold text-sm truncate">{nome}</p>
                          <p className="text-xs text-muted-foreground">
                            ${item.final_amount.toFixed(2)} · {formatBRL(item.final_amount * usdBrl)}
                          </p>
                        </div>
                      </div>
                      <StatusBadge status={item.payment_status} />
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Desktop table */}
            <div className="hidden sm:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    <th className="text-left px-5 py-3">Colaborador</th>
                    <th className="text-right px-4 py-3">Receita Posts<br /><span className="font-normal normal-case tracking-normal">(USD)</span></th>
                    <th className="text-right px-4 py-3">Receita Residual<br /><span className="font-normal normal-case tracking-normal">(USD)</span></th>
                    <th className="text-right px-4 py-3">Total USD</th>
                    <th className="text-right px-4 py-3">Cotação<br /><span className="font-normal normal-case tracking-normal">(USD/BRL)</span></th>
                    <th className="text-right px-4 py-3">Total BRL</th>
                    <th className="px-4 py-3">Método</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3 text-center">Comprovante</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((item) => {
                    const nome = item.collaborators?.nome ?? "—";
                    const handle = item.collaborators?.hashtag;
                    const note = parseNote(item.payment_note);
                    const isSelected = selectedItem?.id === item.id;

                    return (
                      <tr
                        key={item.id}
                        onClick={() => setSelectedItem(item)}
                        className={cn(
                          "border-b border-border/50 cursor-pointer transition-colors",
                          isSelected
                            ? "bg-orange-500/5 border-l-2 border-l-orange-500"
                            : "hover:bg-muted/20",
                        )}
                      >
                        <td className="px-5 py-3.5">
                          <div className="flex items-center gap-3">
                            <ColabAvatar nome={nome} url={item.collaborators?.avatar_url ?? null} size={34} />
                            <div>
                              <p className="font-semibold">{nome}</p>
                              {handle && <p className="text-xs text-muted-foreground">@{handle}</p>}
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3.5 text-right tabular-nums">${item.amount_due.toFixed(2)}</td>
                        <td className="px-4 py-3.5 text-right tabular-nums text-muted-foreground">${item.adjustments.toFixed(2)}</td>
                        <td className="px-4 py-3.5 text-right tabular-nums font-semibold">${item.final_amount.toFixed(2)}</td>
                        <td className="px-4 py-3.5 text-right tabular-nums text-muted-foreground">{usdBrl.toFixed(2)}</td>
                        <td className="px-4 py-3.5 text-right tabular-nums font-medium">{formatBRL(item.final_amount * usdBrl)}</td>
                        <td className="px-4 py-3.5">
                          {item.payment_status === "pago_fora" && note.method
                            ? <MethodBadge method={note.method} />
                            : <span className="text-muted-foreground">—</span>}
                        </td>
                        <td className="px-4 py-3.5">
                          <StatusBadge status={item.payment_status} />
                          {item.paid_at && (
                            <p className="text-[10px] text-muted-foreground mt-0.5">{formatDateTime(item.paid_at)}</p>
                          )}
                        </td>
                        <td className="px-4 py-3.5 text-center">
                          {item.payment_status === "pago_fora" ? (
                            <button
                              onClick={(e) => { e.stopPropagation(); toast.info("Comprovante em desenvolvimento"); }}
                              className="inline-flex items-center justify-center h-7 w-7 rounded-lg hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
                            >
                              <Download className="h-3.5 w-3.5" />
                            </button>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}

                  {/* Totals row */}
                  <tr className="bg-muted/30 text-sm font-semibold">
                    <td className="px-5 py-3">
                      <span className="flex items-center gap-2 text-muted-foreground">
                        <Users className="h-3.5 w-3.5" />
                        Total · {items.length} colaboradores
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      ${items.reduce((s, it) => s + it.amount_due, 0).toFixed(2)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                      ${items.reduce((s, it) => s + it.adjustments, 0).toFixed(2)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-orange-500">
                      ${totalFinal.toFixed(2)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-muted-foreground text-xs font-normal">
                      {usdBrl.toFixed(2)} (média)
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {formatBRL(totalFinal * usdBrl)}
                    </td>
                    <td />
                    <td className="px-4 py-3 text-xs font-normal text-muted-foreground">{countPago}/{items.length} pagos</td>
                    <td />
                  </tr>
                </tbody>
              </table>
            </div>

            {/* Frozen notice */}
            {isFechado && closing.closed_at && (
              <div className="flex items-center justify-center gap-1.5 py-3 border-t border-border text-xs text-muted-foreground">
                <Lock className="h-3 w-3" />
                Valores congelados em {formatDateTime(closing.closed_at)}
              </div>
            )}
          </>
        )}
      </div>

      {/* ── Bottom summary ───────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* Left: text summary */}
        <div className="rounded-xl border border-border bg-card p-5 space-y-3">
          <p className="text-sm font-semibold">Resumo do fechamento</p>
          <div className="space-y-2">
            {[
              { label: "Receita total", value: `$${totalFinal.toFixed(2)}` },
              { label: "Total distribuído", value: `$${totalPago.toFixed(2)}` },
              { label: "Total pendente", value: `$${totalPendente.toFixed(2)}` },
              { label: "Diferença cambial", value: formatBRL((totalFinal - totalPago) * usdBrl * -0.001) },
            ].map((row) => (
              <div key={row.label} className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">{row.label}</span>
                <span className="font-medium tabular-nums">{row.value}</span>
              </div>
            ))}
          </div>
          {/* Donut-like progress */}
          <div className="pt-2 border-t border-border">
            <div className="flex items-center gap-3">
              <div className="relative h-14 w-14 shrink-0">
                <svg viewBox="0 0 36 36" className="w-14 h-14 -rotate-90">
                  <circle cx="18" cy="18" r="14" fill="none" stroke="currentColor" className="text-muted/30" strokeWidth="4" />
                  <circle
                    cx="18" cy="18" r="14" fill="none"
                    stroke="#f97316"
                    strokeWidth="4"
                    strokeDasharray={`${pctDistribuido * 0.879} 100`}
                    strokeLinecap="round"
                  />
                </svg>
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="text-[9px] font-bold text-orange-500">{pctDistribuido.toFixed(0)}%</span>
                </div>
              </div>
              <div>
                <p className="text-sm font-semibold">{pctDistribuido.toFixed(1)}% distribuído</p>
                <p className="text-xs text-muted-foreground">{countPago} de {items.length} colaboradores pagos</p>
              </div>
            </div>
          </div>
        </div>

        {/* Right: next steps */}
        <div className="rounded-xl border border-border bg-card p-5 space-y-3">
          <p className="text-sm font-semibold">Próximos passos</p>
          <div className="space-y-2.5">
            {[
              { label: "Registrar os pagamentos pendentes", done: countPendente === 0, active: countPendente > 0 },
              { label: "Gerar e enviar os comprovantes", done: false, active: countPendente === 0 && !isFechado },
              { label: "Finalizar fechamento do período", done: isFechado, active: false, locked: countPendente > 0 },
            ].map((step) => (
              <div key={step.label} className="flex items-start gap-2.5">
                <div className={cn(
                  "mt-0.5 h-4 w-4 rounded-full shrink-0 flex items-center justify-center",
                  step.done ? "bg-emerald-500/15" : step.active ? "bg-orange-500/15" : "bg-muted"
                )}>
                  {step.done
                    ? <CheckCircle2 className="h-3 w-3 text-emerald-500" />
                    : step.locked
                    ? <Lock className="h-2.5 w-2.5 text-muted-foreground" />
                    : <div className={cn("h-1.5 w-1.5 rounded-full", step.active ? "bg-orange-500" : "bg-muted-foreground/40")} />
                  }
                </div>
                <p className={cn("text-sm", step.done ? "line-through text-muted-foreground" : step.active ? "text-foreground font-medium" : "text-muted-foreground")}>
                  {step.label}
                </p>
              </div>
            ))}
          </div>
          {!isFechado && countPendente === 0 && items.length > 0 && (
            <p className="text-xs text-muted-foreground border-t border-border pt-3">
              Após finalizar, os valores não poderão ser alterados.
            </p>
          )}
        </div>
      </div>

      {/* ── Payment panel (Sheet) ─────────────────────────────────────────────── */}
      <Sheet open={!!selectedItem} onOpenChange={(o) => { if (!o) setSelectedItem(null); }}>
        <SheetContent side="right" className="w-[360px] sm:w-[400px] p-0 overflow-hidden flex flex-col">
          {selectedItem && (
            <PaymentPanel
              item={selectedItem}
              usdBrl={usdBrl}
              isFechado={isFechado}
              onConfirm={confirmPayment}
              onClose={() => setSelectedItem(null)}
            />
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
