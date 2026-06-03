// ProjectionChart — lazy-loaded so recharts is never statically bundled
// into the admin.dashboard chunk (avoids TDZ circular-dependency crashes).
import { formatBRL } from "@/lib/format";
import {
  ResponsiveContainer, ComposedChart, Area, Line,
  XAxis, YAxis, Tooltip, CartesianGrid, ReferenceLine,
} from "recharts";

export interface ProjectionRow {
  dia: string;
  real: number | null;
  proj: number | null;
  optimistic: number | null;
  conservative: number | null;
  isToday?: boolean;
}

interface Props {
  projectionChartData: ProjectionRow[];
  usdBrl: number | null;
}

export function ProjectionChart({ projectionChartData, usdBrl }: Props) {
  const todayLabel = projectionChartData.find((r) => r.isToday)?.dia ?? null;

  const yMax: number | undefined = (() => {
    const top = Math.max(
      0,
      ...projectionChartData.map((r) => r.optimistic ?? 0),
      ...projectionChartData.map((r) => r.real ?? 0),
    );
    return top > 0 ? top * 1.08 : undefined;
  })();

  const fmt = (v: number) =>
    usdBrl ? formatBRL(v * usdBrl) : `$${v.toFixed(2)}`;

  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart
        data={projectionChartData}
        margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
      >
        <defs>
          <linearGradient id="gradReal" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#F44708" stopOpacity={0.25} />
            <stop offset="95%" stopColor="#F44708" stopOpacity={0} />
          </linearGradient>
        </defs>

        <CartesianGrid strokeDasharray="3 3" stroke="#F0EDE8" vertical={false} />

        <XAxis
          dataKey="dia"
          tick={{ fontSize: 10, fill: "#9B9B9B" }}
          interval="preserveStartEnd"
          axisLine={false}
          tickLine={false}
          height={20}
        />
        <YAxis hide domain={[0, yMax ?? ((dataMax: number) => dataMax * 1.05)]} />

        {todayLabel && (
          <ReferenceLine
            x={todayLabel}
            stroke="#F44708"
            strokeDasharray="4 3"
            strokeWidth={1.5}
            label={{ value: "Hoje", position: "insideTopRight", fontSize: 9, fill: "#F44708", fontWeight: 600 }}
          />
        )}

        <Tooltip
          formatter={(v: any, name: string) => {
            if (v === null || v === undefined) return null as any;
            const labels: Record<string, string> = {
              real: "Realizado",
              proj: "Provável",
              optimistic: "Otimista",
              conservative: "Conservador",
            };
            return [fmt(Number(v)), labels[name] ?? name];
          }}
          labelFormatter={(label) => `Dia ${label}`}
          labelStyle={{ color: "#1A0A00", fontSize: 11, fontWeight: 600 }}
          contentStyle={{
            border: "1px solid #F1F1F1",
            borderRadius: 12,
            fontSize: 11,
            boxShadow: "0 8px 24px rgba(0,0,0,.08)",
          }}
        />

        {/* Historical real revenue area */}
        <Area
          type="monotone"
          dataKey="real"
          stroke="#F44708"
          strokeWidth={2}
          fill="url(#gradReal)"
          dot={false}
          connectNulls={false}
          legendType="none"
          name="real"
        />
        {/* Optimistic scenario — green dashed line */}
        <Line
          type="monotone"
          dataKey="optimistic"
          stroke="#10B981"
          strokeWidth={1.5}
          strokeDasharray="5 3"
          dot={false}
          connectNulls={false}
          legendType="none"
          name="optimistic"
        />
        {/* Probable scenario — orange dashed line */}
        <Line
          type="monotone"
          dataKey="proj"
          stroke="#F44708"
          strokeWidth={1.5}
          strokeDasharray="5 3"
          dot={false}
          connectNulls={false}
          legendType="none"
          name="proj"
        />
        {/* Conservative scenario — slate dashed line */}
        <Line
          type="monotone"
          dataKey="conservative"
          stroke="#94A3B8"
          strokeWidth={1.5}
          strokeDasharray="5 3"
          dot={false}
          connectNulls={false}
          legendType="none"
          name="conservative"
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
