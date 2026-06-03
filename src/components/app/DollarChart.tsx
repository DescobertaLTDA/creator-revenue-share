// DollarChart — lazy-loaded to keep recharts out of the main dashboard chunk
import {
  ResponsiveContainer, AreaChart, Area,
  XAxis, YAxis, Tooltip, CartesianGrid,
} from "recharts";

export interface DollarPoint {
  date: string; // "dd/mm"
  rate: number;
}

interface Props {
  data: DollarPoint[];
}

export function DollarChart({ data }: Props) {
  if (data.length === 0) return null;

  const rates = data.map((d) => d.rate);
  const min = Math.min(...rates);
  const max = Math.max(...rates);
  const padding = (max - min) * 0.3 || 0.05;
  const first = data[0].rate;
  const last  = data[data.length - 1].rate;
  const change = ((last - first) / first) * 100;
  const isUp   = change >= 0;

  return (
    <div className="flex flex-col h-full">
      {/* Mini KPI row */}
      <div className="flex items-end gap-3 mb-3 px-1">
        <span className="text-2xl font-black tabular-nums text-[#1A0A00]">
          R$ {last.toFixed(4)}
        </span>
        <span
          className={`text-xs font-bold mb-0.5 px-1.5 py-0.5 rounded-full ${
            isUp ? "bg-red-100 text-red-600" : "bg-emerald-100 text-emerald-700"
          }`}
        >
          {isUp ? "▲" : "▼"} {Math.abs(change).toFixed(2)}% (30d)
        </span>
        <span className="text-[10px] text-[#9B9B9B] mb-0.5 ml-auto">
          {data[0].date} → {data[data.length - 1].date}
        </span>
      </div>

      {/* Chart */}
      <div className="flex-1 min-h-0">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="gradDollar" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%"  stopColor={isUp ? "#EF4444" : "#10B981"} stopOpacity={0.18} />
                <stop offset="95%" stopColor={isUp ? "#EF4444" : "#10B981"} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#F0EDE8" vertical={false} />
            <XAxis
              dataKey="date"
              tick={{ fontSize: 9, fill: "#9B9B9B" }}
              interval="preserveStartEnd"
              axisLine={false}
              tickLine={false}
              height={16}
            />
            <YAxis hide domain={[min - padding, max + padding]} />
            <Tooltip
              formatter={(v: any) => [`R$ ${Number(v).toFixed(4)}`, "USD → BRL"]}
              labelFormatter={(l) => `Dia ${l}`}
              labelStyle={{ color: "#1A0A00", fontSize: 10, fontWeight: 600 }}
              contentStyle={{
                border: "1px solid #F1F1F1",
                borderRadius: 10,
                fontSize: 10,
                boxShadow: "0 4px 12px rgba(0,0,0,.06)",
              }}
            />
            <Area
              type="monotone"
              dataKey="rate"
              stroke={isUp ? "#EF4444" : "#10B981"}
              strokeWidth={1.8}
              fill="url(#gradDollar)"
              dot={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
