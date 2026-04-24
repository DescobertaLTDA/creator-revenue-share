import {
  ResponsiveContainer, LineChart, Line, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from "recharts";

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

export function DashboardCharts({ data }: { data: DayData[] }) {
  if (data.length === 0) return null;

  return (
    <div className="space-y-4">
      {/* Receita por dia */}
      <div className="bg-card border border-border rounded-xl p-5">
        <h2 className="font-medium mb-4">Receita por dia (USD)</h2>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={data} margin={{ top: 0, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(0 0% 88%)" />
            <XAxis dataKey="dia" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `$${v}`} width={52} />
            <Tooltip formatter={(v: number) => `$${v.toFixed(2)}`} labelFormatter={(l) => `Dia: ${l}`} />
            <Bar dataKey="receita" name="Receita (USD)" fill="#16a34a" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Views e Alcance */}
      <div className="bg-card border border-border rounded-xl p-5">
        <h2 className="font-medium mb-4">Views e Alcance por dia</h2>
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={data} margin={{ top: 0, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(0 0% 88%)" />
            <XAxis dataKey="dia" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} tickFormatter={fmt} width={52} />
            <Tooltip formatter={(v: number) => v.toLocaleString("pt-BR")} labelFormatter={(l) => `Dia: ${l}`} />
            <Legend />
            <Line type="monotone" dataKey="views" name="Views" stroke="#16a34a" dot={false} strokeWidth={2} />
            <Line type="monotone" dataKey="alcance" name="Alcance" stroke="#dc2626" dot={false} strokeWidth={2} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Posts e Reações */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-card border border-border rounded-xl p-5">
          <h2 className="font-medium mb-4">Posts publicados por dia</h2>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={data} margin={{ top: 0, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(0 0% 88%)" />
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
            <BarChart data={data} margin={{ top: 0, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(0 0% 88%)" />
              <XAxis dataKey="dia" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={fmt} width={42} />
              <Tooltip formatter={(v: number) => v.toLocaleString("pt-BR")} labelFormatter={(l) => `Dia: ${l}`} />
              <Bar dataKey="reacoes" name="Reações" fill="#dc2626" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
