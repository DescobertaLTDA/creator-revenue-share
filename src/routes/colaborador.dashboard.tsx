import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/app/PageHeader";
import { KpiCard } from "@/components/app/KpiCard";
import { StatusBadge } from "@/components/app/StatusBadge";
import { EmptyState } from "@/components/app/EmptyState";
import { formatBRL, formatMonth } from "@/lib/format";
import { Wallet, DollarSign, CalendarCheck, Loader2 } from "lucide-react";

export const Route = createFileRoute("/colaborador/dashboard")({
  head: () => ({ meta: [{ title: "Meu painel — Rateio Creator" }] }),
  component: Page,
});

interface Item { id: string; final_amount: number; payment_status: string; gross_revenue: number;
  monthly_closings: { month_ref: string; pages: { nome: string } | null } | null; }

function Page() {
  const { profile } = useAuth();
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data: cols } = await supabase.from("collaborators").select("id").eq("profile_id", profile?.id ?? "");
      const colIds = (cols ?? []).map(c => c.id);
      if (colIds.length === 0) { setLoading(false); return; }
      const { data } = await supabase.from("monthly_closing_items")
        .select("id, final_amount, payment_status, gross_revenue, monthly_closings(month_ref, pages(nome))")
        .in("collaborator_id", colIds)
        .order("created_at", { ascending: false });
      setItems((data as unknown as Item[]) ?? []);
      setLoading(false);
    })();
  }, [profile?.id]);

  const thisMonth = new Date().toISOString().slice(0, 7);
  const current = items.filter(i => i.monthly_closings?.month_ref === thisMonth);
  const totalMonth = current.reduce((s, i) => s + Number(i.final_amount ?? 0), 0);
  const pending = items.filter(i => i.payment_status === "a_pagar").reduce((s, i) => s + Number(i.final_amount ?? 0), 0);

  return (
    <div>
      <PageHeader title={`Olá, ${profile?.nome ?? ""}`} description="Acompanhe seu histórico de receita e pagamentos." />
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
        <KpiCard label={`Receita — ${formatMonth(thisMonth)}`} value={loading ? "…" : formatBRL(totalMonth)} icon={DollarSign} tone="success" />
        <KpiCard label="Aguardando pagamento" value={loading ? "…" : formatBRL(pending)} icon={Wallet} tone="warning" />
        <KpiCard label="Fechamentos" value={loading ? "…" : items.length} icon={CalendarCheck} />
      </div>

      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-border"><h2 className="font-medium">Histórico</h2></div>
        {loading ? <div className="p-10 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground"/></div> :
        items.length === 0 ? <div className="p-6"><EmptyState icon={CalendarCheck} title="Sem fechamentos" description="Quando o admin publicar um fechamento, ele aparece aqui."/></div> :
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
            <tr><th className="text-left px-5 py-3 font-medium">Mês</th><th className="text-left px-5 py-3 font-medium">Página</th><th className="text-right px-5 py-3 font-medium">Bruto</th><th className="text-right px-5 py-3 font-medium">Valor final</th><th className="text-left px-5 py-3 font-medium">Status</th></tr>
          </thead>
          <tbody className="divide-y divide-border">
            {items.map(i => (
              <tr key={i.id}>
                <td className="px-5 py-3 font-medium">{i.monthly_closings ? formatMonth(i.monthly_closings.month_ref) : "—"}</td>
                <td className="px-5 py-3 text-muted-foreground">{i.monthly_closings?.pages?.nome ?? "—"}</td>
                <td className="px-5 py-3 text-right tabular-nums">{formatBRL(i.gross_revenue)}</td>
                <td className="px-5 py-3 text-right tabular-nums font-medium">{formatBRL(i.final_amount)}</td>
                <td className="px-5 py-3"><StatusBadge status={i.payment_status}/></td>
              </tr>
            ))}
          </tbody>
        </table>}
      </div>
    </div>
  );
}
