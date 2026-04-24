import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/app/PageHeader";
import { EmptyState } from "@/components/app/EmptyState";
import { StatusBadge } from "@/components/app/StatusBadge";
import { formatBRL, formatMonth } from "@/lib/format";
import { CalendarCheck, Loader2 } from "lucide-react";

export const Route = createFileRoute("/admin/fechamentos")({
  head: () => ({ meta: [{ title: "Fechamentos — Rateio Creator" }] }),
  component: Page,
});

interface Closing { id: string; month_ref: string; status: string; total_gross: number | null; pages: { nome: string } | null; }

function Page() {
  const [rows, setRows] = useState<Closing[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("monthly_closings")
        .select("id, month_ref, status, total_gross, pages(nome)")
        .order("month_ref", { ascending: false });
      setRows((data as unknown as Closing[]) ?? []);
      setLoading(false);
    })();
  }, []);
  return (
    <div>
      <PageHeader title="Fechamentos mensais" description="Criação de fechamentos, snapshot de valores e marcação de pagamentos serão implementados na próxima iteração." />
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        {loading ? <div className="p-10 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground"/></div> :
        rows.length === 0 ? <div className="p-6"><EmptyState icon={CalendarCheck} title="Nenhum fechamento ainda" description="A criação de fechamentos será habilitada em breve."/></div> :
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
            <tr><th className="text-left px-5 py-3 font-medium">Mês</th><th className="text-left px-5 py-3 font-medium">Página</th><th className="text-left px-5 py-3 font-medium">Status</th><th className="text-right px-5 py-3 font-medium">Receita bruta</th></tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map(r => (
              <tr key={r.id} className="hover:bg-muted/20">
                <td className="px-5 py-3 font-medium"><Link to="/admin/fechamentos/$id" params={{id: r.id}} className="hover:underline">{formatMonth(r.month_ref)}</Link></td>
                <td className="px-5 py-3 text-muted-foreground">{r.pages?.nome ?? "—"}</td>
                <td className="px-5 py-3"><StatusBadge status={r.status}/></td>
                <td className="px-5 py-3 text-right tabular-nums">{formatBRL(r.total_gross)}</td>
              </tr>
            ))}
          </tbody>
        </table>}
      </div>
    </div>
  );
}
