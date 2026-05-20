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

const GRID = "#f0ebfa";
const TICK = { fontSize: 11, fill: "#9d8fb0" };

export function DashboardCharts({ data }: { data: DayData[] }) {
  if (data.length === 0) return null;

  return (
    <div className="space-y-4">
      <div className="bg-white border border-[#e8e0f5] rounded-2xl p-5 shadow-sm">
        <h2 className="text-sm font-semibold mb-4 text-[#1a0533]">Receita por dia (USD)</h2>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={data} margin={{ top: 0, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
            <XAxis dataKey="dia" tick={TICK} axisLine={false} tickLine={false} />
            <YAxis tick={TICK} tickFormatter={(v) => `$${v}`} width={52} axisLine={false} tickLine={false} />
            <Tooltip
              formatter={(v: number) => [`$${v.toFixed(2)}`, "Receita"]}
              labelFormatter={(l) => `Dia: ${l}`}
              contentStyle={{ border: "1px solid #e8e0f5", borderRadius: 8, fontSize: 11 }}
            />
            <Bar dataKey="receita" name="Receita (USD)" fill="#6200b3" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="bg-white border border-[#e8e0f5] rounded-2xl p-5 shadow-sm">
        <h2 className="text-sm font-semibold mb-4 text-[#1a0533]">Views e Alcance por dia</h2>
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={data} margin={{ top: 0, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
            <XAxis dataKey="dia" tick={TICK} axisLine={false} tickLine={false} />
            <YAxis tick={TICK} tickFormatter={fmt} width={52} axisLine={false} tickLine={false} />
            <Tooltip formatter={(v: number) => v.toLocaleString("pt-BR")} labelFormatter={(l) => `Dia: ${l}`}
              contentStyle={{ border: "1px solid #e8e0f5", borderRadius: 8, fontSize: 11 }} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Line type="monotone" dataKey="views" name="Views" stroke="#6200b3" dot={false} strokeWidth={2} />
            <Line type="monotone" dataKey="alcance" name="Alcance" stroke="#ea7af4" strokeDasharray="4 3" />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white border border-[#e8e0f5] rounded-2xl p-5 shadow-sm">
          <h2 className="text-sm font-semibold mb-4 text-[#1a0533]">Posts publicados por dia</h2>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={data} margin={{ top: 0, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
              <XAxis dataKey="dia" tick={TICK} axisLine={false} tickLine={false} />
              <YAxis tick={TICK} width={32} allowDecimals={false} axisLine={false} tickLine={false} />
              <Tooltip labelFormatter={(l) => `Dia: ${l}`} contentStyle={{ border: "1px solid #e8e0f5", borderRadius: 8, fontSize: 11 }} />
              <Bar dataKey="posts" name="Posts" fill="#b43e8f" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="bg-white border border-[#e8e0f5] rounded-2xl p-5 shadow-sm">
          <h2 className="text-sm font-semibold mb-4 text-[#1a0533]">Reações por dia</h2>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={data} margin={{ top: 0, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
              <XAxis dataKey="dia" tick={TICK} axisLine={false} tickLine={false} />
              <YAxis tick={TICK} tickFormatter={fmt} width={42} axisLine={false} tickLine={false} />
              <Tooltip formatter={(v: number) => v.toLocaleString("pt-BR")} labelFormatter={(l) => `Dia: ${l}`}
                contentStyle={{ border: "1px solid #e8e0f5", borderRadius: 8, fontSize: 11 }} />
              <Bar dataKey="reacoes" name="Reações" fill="#c4b5fd" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}

