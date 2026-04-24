import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/app/PageHeader";
import { KpiCard } from "@/components/app/KpiCard";
import { StatusBadge } from "@/components/app/StatusBadge";
import { EmptyState } from "@/components/app/EmptyState";
import { formatBRL, formatDateTime, formatMonth } from "@/lib/format";
import { DollarSign, Wallet, UserCheck, FileSpreadsheet, ArrowRight } from "lucide-react";

export const Route = createFileRoute("/admin/dashboard")({
  head: () => ({ meta: [{ title: "Dashboard — Rateio Creator" }] }),
  component: AdminDashboard,
});

interface RecentImport {
  id: string;
  file_name: string;
  status: string;
  created_at: string;
  valid_rows: number;
  total_rows: number;
}

function AdminDashboard() {
  const [loading, setLoading] = useState(true);
  const [totalMonth, setTotalMonth] = useState(0);
  const [totalGeral, setTotalGeral] = useState(0);
  const [totalPosts, setTotalPosts] = useState(0);
  const [recentImports, setRecentImports] = useState<RecentImport[]>([]);
  const [activeMonthRef, setActiveMonthRef] = useState("");

  useEffect(() => {
    const load = async () => {
      const [{ data: postsData }, { data: imports }] = await Promise.all([
        supabase
          .from("posts")
          .select("published_at, monetization_approx"),
        supabase
          .from("csv_imports")
          .select("id, file_name, status, created_at, valid_rows, total_rows")
          .order("created_at", { ascending: false })
          .limit(5),
      ]);

      const posts = postsData ?? [];

      // Acha o mês com mais receita para exibir como "mês de referência"
      const byMonth: Record<string, number> = {};
      let geralSum = 0;
      for (const p of posts) {
        const val = Number(p.monetization_approx ?? 0);
        geralSum += val;
        if (p.published_at) {
          const m = p.published_at.slice(0, 7);
          byMonth[m] = (byMonth[m] ?? 0) + val;
        }
      }

      const sortedMonths = Object.entries(byMonth).sort((a, b) => b[0].localeCompare(a[0]));
      const latestMonth = sortedMonths[0]?.[0] ?? new Date().toISOString().slice(0, 7);
      const latestMonthTotal = byMonth[latestMonth] ?? 0;

      setActiveMonthRef(latestMonth);
      setTotalMonth(latestMonthTotal);
      setTotalGeral(geralSum);
      setTotalPosts(posts.length);
      setRecentImports((imports as RecentImport[]) ?? []);
      setLoading(false);
    };
    load();
  }, []);

  return (
    <div>
      <PageHeader
        title="Dashboard"
        description={`Visão geral — ${activeMonthRef ? formatMonth(activeMonthRef) : "…"}`}
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <KpiCard label="Receita do mês" value={loading ? "…" : formatBRL(totalMonth)} icon={DollarSign} tone="success" />
        <KpiCard label="Receita total (todos CSV)" value={loading ? "…" : formatBRL(totalGeral)} icon={Wallet} tone="warning" />
        <KpiCard label="Total de posts" value={loading ? "…" : totalPosts.toLocaleString("pt-BR")} icon={UserCheck} />
        <KpiCard label="Uploads recentes" value={loading ? "…" : recentImports.length} icon={FileSpreadsheet} />
      </div>

      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 className="font-medium">Importações recentes</h2>
          <Link to="/admin/importacoes" className="text-xs text-primary hover:underline inline-flex items-center gap-1">
            Ver todas <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
        {recentImports.length === 0 ? (
          <div className="p-5">
            <EmptyState
              icon={FileSpreadsheet}
              title="Nenhuma importação ainda"
              description="Envie seu primeiro CSV do Facebook para começar a gerenciar a receita."
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="text-left px-5 py-3 font-medium">Arquivo</th>
                  <th className="text-left px-5 py-3 font-medium">Status</th>
                  <th className="text-right px-5 py-3 font-medium">Linhas</th>
                  <th className="text-left px-5 py-3 font-medium">Quando</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {recentImports.map((imp) => (
                  <tr key={imp.id} className="hover:bg-muted/20">
                    <td className="px-5 py-3">
                      <Link to="/admin/importacoes/$id" params={{ id: imp.id }} className="font-medium hover:underline">
                        {imp.file_name}
                      </Link>
                    </td>
                    <td className="px-5 py-3"><StatusBadge status={imp.status} /></td>
                    <td className="px-5 py-3 text-right tabular-nums">{imp.valid_rows}/{imp.total_rows}</td>
                    <td className="px-5 py-3 text-muted-foreground">{formatDateTime(imp.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
