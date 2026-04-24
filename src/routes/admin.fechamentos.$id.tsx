import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/app/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatBRL, formatMonth, formatDateTime, formatPct } from "@/lib/format";
import { toast } from "sonner";
import {
  ArrowLeft, Loader2, CheckCircle2, Clock, Ban,
  Lock, Pencil, Save, X, DollarSign,
} from "lucide-react";

export const Route = createFileRoute("/admin/fechamentos/$id")({
  head: () => ({ meta: [{ title: "Detalhe do fechamento — Rateio Creator" }] }),
  component: ClosingDetail,
});

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
  collaborators: { nome: string; hashtag: string | null } | null;
  // local edit state
  _editAdj?: string;
  _editNote?: string;
  _editing?: boolean;
}

const STATUS_LABELS: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  a_pagar: { label: "Pendente", color: "bg-amber-500/10 text-amber-600", icon: <Clock className="h-3 w-3" /> },
  pago_fora: { label: "Pago", color: "bg-[#16a34a]/10 text-[#16a34a]", icon: <CheckCircle2 className="h-3 w-3" /> },
  ajustado: { label: "Ajustado", color: "bg-blue-500/10 text-blue-600", icon: <DollarSign className="h-3 w-3" /> },
};

function ClosingDetail() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const [closing, setClosing] = useState<Closing | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [usdBrl, setUsdBrl] = useState<number | null>(null);
  const [approving, setApproving] = useState(false);

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
        .select("id, collaborator_id, gross_revenue, collaborator_pct, amount_due, adjustments, final_amount, payment_status, paid_at, payment_note, collaborators(nome, hashtag)")
        .eq("closing_id", id)
        .order("gross_revenue", { ascending: false }),
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
    if (error) { toast.error("Erro ao aprovar", { description: error.message }); }
    else { toast.success("Fechamento aprovado!"); await load(); }
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

  const startEdit = (itemId: string) => {
    setItems((prev) => prev.map((it) =>
      it.id === itemId
        ? { ...it, _editing: true, _editAdj: String(it.adjustments), _editNote: it.payment_note ?? "" }
        : it
    ));
  };

  const cancelEdit = (itemId: string) => {
    setItems((prev) => prev.map((it) => it.id === itemId ? { ...it, _editing: false } : it));
  };

  const saveEdit = async (item: Item) => {
    const adj = parseFloat(item._editAdj ?? "0") || 0;
    const final = parseFloat((item.amount_due + adj).toFixed(4));
    const { error } = await supabase
      .from("monthly_closing_items")
      .update({ adjustments: adj, final_amount: final, payment_note: item._editNote ?? null, updated_at: new Date().toISOString() })
      .eq("id", item.id);
    if (error) { toast.error("Erro ao salvar", { description: error.message }); return; }
    toast.success("Salvo");
    await load();
  };

  const setPaymentStatus = async (item: Item, newStatus: string) => {
    const update: Record<string, unknown> = {
      payment_status: newStatus,
      updated_at: new Date().toISOString(),
    };
    if (newStatus === "pago_fora") update.paid_at = new Date().toISOString();
    else update.paid_at = null;

    const { error } = await supabase
      .from("monthly_closing_items")
      .update(update)
      .eq("id", item.id);
    if (error) { toast.error("Erro", { description: error.message }); return; }
    toast.success(newStatus === "pago_fora" ? "Marcado como pago!" : "Status atualizado");
    await load();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!closing) {
    return (
      <div className="space-y-4">
        <Link to="/admin/fechamentos" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Voltar
        </Link>
        <p className="text-muted-foreground">Fechamento não encontrado.</p>
      </div>
    );
  }

  const totalFinal = items.reduce((s, it) => s + it.final_amount, 0);
  const totalPago = items.filter((it) => it.payment_status === "pago_fora").reduce((s, it) => s + it.final_amount, 0);
  const totalPendente = items.filter((it) => it.payment_status === "a_pagar").reduce((s, it) => s + it.final_amount, 0);
  const countPago = items.filter((it) => it.payment_status === "pago_fora").length;
  const countPendente = items.filter((it) => it.payment_status === "a_pagar").length;

  return (
    <div className="space-y-6">
      {/* Back */}
      <Link to="/admin/fechamentos" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Voltar
      </Link>

      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <PageHeader
          title={`Fechamento — ${formatMonth(closing.month_ref)}`}
          description={`${closing.pages?.nome ?? "—"} · Gerado em ${formatDateTime(closing.created_at)}${closing.closed_at ? ` · Aprovado em ${formatDateTime(closing.closed_at)}` : ""}`}
        />
        <div className="flex items-center gap-2 mt-1">
          {!isFechado ? (
            <Button onClick={approve} disabled={approving} className="gap-2">
              {approving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              Aprovar fechamento
            </Button>
          ) : (
            <>
              <span className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-medium bg-[#16a34a]/10 text-[#16a34a]">
                <Lock className="h-3 w-3" /> Aprovado
              </span>
              <Button variant="outline" size="sm" onClick={reopen}>Reabrir</Button>
            </>
          )}
        </div>
      </div>

      {/* Summary KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: "Total a pagar (USD)", value: `$${totalFinal.toFixed(2)}`, sub: usdBrl ? `≈ ${formatBRL(totalFinal * usdBrl)}` : undefined, accent: true },
          { label: "Já pago (USD)", value: `$${totalPago.toFixed(2)}`, sub: `${countPago} colab${countPago !== 1 ? "s" : ""}` },
          { label: "Pendente (USD)", value: `$${totalPendente.toFixed(2)}`, sub: `${countPendente} colab${countPendente !== 1 ? "s" : ""}` },
          { label: "Receita bruta (USD)", value: `$${Number(closing.total_gross ?? 0).toFixed(2)}`, sub: closing.pages?.nome },
        ].map((k) => (
          <div key={k.label} className={`bg-card border rounded-xl p-4 ${k.accent ? "border-[#16a34a]/30" : "border-border"}`}>
            <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">{k.label}</p>
            <p className={`text-xl font-bold mt-1 ${k.accent ? "text-[#16a34a]" : ""}`}>{k.value}</p>
            {k.sub && <p className="text-xs text-muted-foreground mt-0.5">{k.sub}</p>}
          </div>
        ))}
      </div>

      {/* Items table */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-border flex items-center justify-between">
          <h2 className="font-semibold">Pagamentos por colaborador</h2>
          {!isFechado && <p className="text-xs text-muted-foreground">Edite ajustes antes de aprovar o fechamento</p>}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="text-left px-5 py-3 font-medium">Colaborador</th>
                <th className="text-right px-5 py-3 font-medium">Receita bruta</th>
                <th className="text-right px-5 py-3 font-medium">Split %</th>
                <th className="text-right px-5 py-3 font-medium">A receber</th>
                <th className="text-right px-5 py-3 font-medium">Ajuste</th>
                <th className="text-right px-5 py-3 font-medium">Final (USD)</th>
                <th className="text-right px-5 py-3 font-medium">Final (BRL)</th>
                <th className="text-left px-5 py-3 font-medium">Status</th>
                <th className="px-5 py-3 font-medium">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {items.map((item) => {
                const st = STATUS_LABELS[item.payment_status] ?? STATUS_LABELS.a_pagar;
                const finalBrl = usdBrl ? item.final_amount * usdBrl : null;

                return (
                  <tr key={item.id} className="hover:bg-muted/20 align-top">
                    {/* Collaborator */}
                    <td className="px-5 py-3">
                      <p className="font-medium">{item.collaborators?.nome ?? "—"}</p>
                      {item.collaborators?.hashtag && (
                        <p className="text-xs text-muted-foreground">#{item.collaborators.hashtag}</p>
                      )}
                      {item._editing && (
                        <div className="mt-2">
                          <p className="text-xs text-muted-foreground mb-1">Observação</p>
                          <Input
                            value={item._editNote ?? ""}
                            onChange={(e) => setItems((prev) => prev.map((it) => it.id === item.id ? { ...it, _editNote: e.target.value } : it))}
                            placeholder="Nota de pagamento…"
                            className="h-7 text-xs"
                          />
                        </div>
                      )}
                      {!item._editing && item.payment_note && (
                        <p className="text-xs text-muted-foreground italic mt-0.5">{item.payment_note}</p>
                      )}
                    </td>

                    {/* Gross */}
                    <td className="px-5 py-3 text-right tabular-nums">${item.gross_revenue.toFixed(2)}</td>

                    {/* Split pct */}
                    <td className="px-5 py-3 text-right tabular-nums text-muted-foreground">{formatPct(item.collaborator_pct)}</td>

                    {/* Amount due */}
                    <td className="px-5 py-3 text-right tabular-nums">${item.amount_due.toFixed(2)}</td>

                    {/* Adjustments */}
                    <td className="px-5 py-3 text-right tabular-nums">
                      {item._editing ? (
                        <Input
                          type="number"
                          step="0.01"
                          value={item._editAdj ?? "0"}
                          onChange={(e) => setItems((prev) => prev.map((it) => it.id === item.id ? { ...it, _editAdj: e.target.value } : it))}
                          className="h-7 text-xs w-24 text-right ml-auto"
                        />
                      ) : (
                        <span className={item.adjustments !== 0 ? (item.adjustments > 0 ? "text-[#16a34a]" : "text-destructive") : "text-muted-foreground"}>
                          {item.adjustments > 0 ? "+" : ""}{item.adjustments.toFixed(2)}
                        </span>
                      )}
                    </td>

                    {/* Final USD */}
                    <td className="px-5 py-3 text-right tabular-nums font-semibold">
                      ${item._editing
                        ? (item.amount_due + (parseFloat(item._editAdj ?? "0") || 0)).toFixed(2)
                        : item.final_amount.toFixed(2)}
                    </td>

                    {/* Final BRL */}
                    <td className="px-5 py-3 text-right tabular-nums text-muted-foreground text-xs">
                      {finalBrl != null ? formatBRL(finalBrl) : "—"}
                    </td>

                    {/* Status badge */}
                    <td className="px-5 py-3">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${st.color}`}>
                        {st.icon} {st.label}
                      </span>
                      {item.paid_at && (
                        <p className="text-[10px] text-muted-foreground mt-0.5">{formatDateTime(item.paid_at)}</p>
                      )}
                    </td>

                    {/* Actions */}
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {item._editing ? (
                          <>
                            <button
                              onClick={() => saveEdit(item)}
                              className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs bg-primary text-white hover:bg-primary/90"
                            >
                              <Save className="h-3 w-3" /> Salvar
                            </button>
                            <button
                              onClick={() => cancelEdit(item.id)}
                              className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs border border-border hover:bg-muted"
                            >
                              <X className="h-3 w-3" /> Cancelar
                            </button>
                          </>
                        ) : (
                          <>
                            {!isFechado && (
                              <button
                                onClick={() => startEdit(item.id)}
                                className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs border border-border hover:bg-muted"
                              >
                                <Pencil className="h-3 w-3" /> Editar
                              </button>
                            )}
                            {item.payment_status !== "pago_fora" && (
                              <button
                                onClick={() => setPaymentStatus(item, "pago_fora")}
                                className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs bg-[#16a34a]/10 text-[#16a34a] hover:bg-[#16a34a]/20"
                              >
                                <CheckCircle2 className="h-3 w-3" /> Pago
                              </button>
                            )}
                            {item.payment_status === "pago_fora" && (
                              <button
                                onClick={() => setPaymentStatus(item, "a_pagar")}
                                className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs border border-border text-muted-foreground hover:bg-muted"
                              >
                                <Ban className="h-3 w-3" /> Desfazer
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}

              {/* Totals row */}
              {items.length > 0 && (
                <tr className="bg-muted/30 font-semibold text-sm">
                  <td className="px-5 py-3">Total</td>
                  <td className="px-5 py-3 text-right tabular-nums">
                    ${items.reduce((s, it) => s + it.gross_revenue, 0).toFixed(2)}
                  </td>
                  <td className="px-5 py-3" />
                  <td className="px-5 py-3 text-right tabular-nums">
                    ${items.reduce((s, it) => s + it.amount_due, 0).toFixed(2)}
                  </td>
                  <td className="px-5 py-3 text-right tabular-nums">
                    {(() => {
                      const adj = items.reduce((s, it) => s + it.adjustments, 0);
                      return <span className={adj !== 0 ? (adj > 0 ? "text-[#16a34a]" : "text-destructive") : ""}>{adj > 0 ? "+" : ""}{adj.toFixed(2)}</span>;
                    })()}
                  </td>
                  <td className="px-5 py-3 text-right tabular-nums text-[#16a34a]">
                    ${totalFinal.toFixed(2)}
                  </td>
                  <td className="px-5 py-3 text-right tabular-nums text-muted-foreground text-xs">
                    {usdBrl ? formatBRL(totalFinal * usdBrl) : "—"}
                  </td>
                  <td className="px-5 py-3">
                    <span className="text-xs text-muted-foreground">{countPago}/{items.length} pagos</span>
                  </td>
                  <td />
                </tr>
              )}
            </tbody>
          </table>

          {items.length === 0 && (
            <div className="p-8 text-center text-sm text-muted-foreground">
              Nenhum item neste fechamento.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
