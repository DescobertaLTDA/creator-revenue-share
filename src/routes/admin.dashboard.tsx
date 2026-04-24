import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/app/PageHeader";
import { KpiCard } from "@/components/app/KpiCard";
import { StatusBadge } from "@/components/app/StatusBadge";
import { EmptyState } from "@/components/app/EmptyState";
import { formatBRL, formatDateTime, formatMonth } from "@/lib/format";
import { DollarSign, Wallet, FileSpreadsheet, ArrowRight, TrendingUp, Eye, Users, Heart } from "lucide-react";
import {
  ResponsiveContainer, LineChart, Line, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from "recharts";

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

interface DayData {
  dia: string;
  posts: number;
  views: number;
  alcance: number;
  reacoes: number;
  receita: number;
}

const fmt = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M`
  : n >= 1_000 ? `${(n / 1_000).toFixed(1)}k`
  : String(n);

function AdminDashboard() {
  const [loading, setLoading] = useState(true);
  const [totalMonth, setTotalMonth] = useState(0);
  const [totalGeral, setTotalGeral] = useState(0);
  const [totalPosts, setTotalPosts] = useState(0);
  const [totalViews, setTotalViews] = useState(0);
  const [totalReacoes, setTotalReacoes] = useState(0);
  const [recentImports, setRecentImports] = useState<RecentImport[]>([]);
  const [activeMonthRef, setActiveMonthRef] = useState("");
  const [chartData, setChartData] = useState<DayData[]>([]);
  const [usdBrl, setUsdBrl] = useState<number | null>(null);

  useEffect(() => {
    fetch("https://economia.awesomeapi.com.br/json/last/USD-BRL")
      .then((r) => r.json())
      .then((d) => setUsdBrl(parseFloat(d.USDBRL.bid)))
      .catch(() => null);
  }, []);

  useEffect(() => {
    const load = async () => {
      const [{ data: postsData }, { data: imports }] = await Promise.all([
        supabase
          .from("posts")
          .select("published_at, monetization_approx, views, reach, reactions"),
        supabase
          .from("csv_imports")
          .select("id, file_name, status, created_at, valid_rows, total_rows")
          .order("created_at", { ascending: false })
          .limit(5),
      ]);

      const posts = postsData ?? [];

      const byMonth: Record<string, number> = {};
      const byDay: Record<string, DayData> = {};
      let geralSum = 0;
      let viewsSum = 0;
      let reacoesSum = 0;

      for (const p of posts) {
        const val = Number(p.monetization_approx ?? 0);
        const views = Number(p.views ?? 0);
        const reacoes = Number(p.reactions ?? 0);
        const reach = Number(p.reach ?? 0);
        geralSum += val;
        viewsSum += views;
        reacoesSum += reacoes;

        if (p.published_at) {
          const m = p.published_at.slice(0, 7);
          byMonth[m] = (byMonth[m] ?? 0) + val;

          const dayKey = p.published_at.slice(0, 10);
          const [year, month, day] = dayKey.split("-");
          const label = `${day}/${month}`;
          if (!byDay[dayKey]) {
            byDay[dayKey] = { dia: label, posts: 0, views: 0, alcance: 0, reacoes: 0, receita: 0 };
          }
          byDay[dayKey].posts += 1;
          byDay[dayKey].views += views;
          byDay[dayKey].alcance += reach;
          byDay[dayKey].reacoes += reacoes;
          byDay[dayKey].receita += val;
        }
      }

      const sortedMonths = Object.entries(byMonth).sort((a, b) => b[0].localeCompare(a[0]));
      const latestMonth = sortedMonths[0]?.[0] ?? new Date().toISOString().slice(0, 7);

      const chart = Object.entries(byDay)
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([, v]) => ({ ...v, receita: parseFloat(v.receita.toFixed(2)) }));

      setActiveMonthRef(latestMonth);
      setTotalMonth(byMonth[latestMonth] ?? 0);
      setTotalGeral(geralSum);
      setTotalPosts(posts.length);
      setTotalViews(viewsSum);
      setTotalReacoes(reacoesSum);
      setChartData(chart);
      setRecentImports((imports as RecentImport[]) ?? []);
      setLoading(false);
    };
    load();
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <PageHeader
          title="Dashboard"
          description={`Visão geral — ${activeMonthRef ? formatMonth(activeMonthRef) : "…"}`}
        />
        {usdBrl && (
          <div className="text-right text-sm mt-1">
            <span className="text-muted-foreground">Dólar hoje</span>
            <p className="font-semibold text-lg">{formatBRL(usdBrl)}</p>
          </div>
        )}
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard label="Receita do mês (BRL)" value={loading ? "…" : formatBRL(totalMonth)} icon={DollarSign} tone="success" />
        <KpiCard
          label="Receita total (BRL)"
          value={loading ? "…" : formatBRL(totalGeral)}
          icon={Wallet}
          tone="warning"
        />
        <KpiCard label="Total de views" value={loading ? "…" : fmt(totalViews)} icon={Eye} />
        <KpiCard label="Total de reações" value={loading ? "…" : fmt(totalReacoes)} icon={Heart} />
      </div>

      {/* Receita em USD */}
      {usdBrl && !loading && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="bg-card border border-border rounded-xl p-4 flex items-center justify-between">
            <div>
              <p className="text-xs uppercase text-muted-foreground font-medium">Receita total em USD</p>
              <p className="text-2xl font-bold mt-1">${(totalGeral / usdBrl).toFixed(2)}</p>
            </div>
            <DollarSign className="h-8 w-8 text-green-500 opacity-60" />
          </div>
          <div className="bg-card border border-border rounded-xl p-4 flex items-center justify-between">
            <div>
              <p className="text-xs uppercase text-muted-foreground font-medium">Total de posts importados</p>
              <p className="text-2xl font-bold mt-1">{totalPosts.toLocaleString("pt-BR")}</p>
            </div>
            <TrendingUp className="h-8 w-8 text-blue-500 opacity-60" />
          </div>
        </div>
      )}

      {/* Gráfico: Receita por dia */}
      {chartData.length > 0 && (
        <div className="bg-card border border-border rounded-xl p-5">
          <h2 className="font-medium mb-4">Receita por dia (BRL)</h2>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={chartData} margin={{ top: 0, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
              <XAxis dataKey="dia" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `R$${v}`} width={52} />
              <Tooltip formatter={(v: number) => formatBRL(v)} labelFormatter={(l) => `Dia: ${l}`} />
              <Bar dataKey="receita" name="Receita" fill="#16a34a" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Gráfico: Views e Alcance por dia */}
      {chartData.length > 0 && (
        <div className="bg-card border border-border rounded-xl p-5">
          <h2 className="font-medium mb-4">Views e Alcance por dia</h2>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={chartData} margin={{ top: 0, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
              <XAxis dataKey="dia" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={fmt} width={52} />
              <Tooltip formatter={(v: number) => v.toLocaleString("pt-BR")} labelFormatter={(l) => `Dia: ${l}`} />
              <Legend />
              <Line type="monotone" dataKey="views" name="Views" stroke="#16a34a" dot={false} strokeWidth={2} />
              <Line type="monotone" dataKey="alcance" name="Alcance" stroke="#dc2626" dot={false} strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Gráfico: Posts e Reações por dia */}
      {chartData.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="bg-card border border-border rounded-xl p-5">
            <h2 className="font-medium mb-4">Posts publicados por dia</h2>
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={chartData} margin={{ top: 0, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis dataKey="dia" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} width={32} allowDecimals={false} />
                <Tooltip labelFormatter={(l) => `Dia: ${l}`} />
                <Bar dataKey="posts" name="Posts" fill="#16a34a" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="bg-card border border-border rounded-xl p-5">
            <h2 className="font-medium mb-4">Reações por dia</h2>
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={chartData} margin={{ top: 0, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis dataKey="dia" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={fmt} width={42} />
                <Tooltip formatter={(v: number) => v.toLocaleString("pt-BR")} labelFormatter={(l) => `Dia: ${l}`} />
                <Bar dataKey="reacoes" name="Reações" fill="#dc2626" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Importações recentes */}
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
