// ProjectionChart — lazy-loaded so recharts is never statically bundled
// into the admin.dashboard chunk (avoids TDZ circular-dependency crashes).
import { formatBRL } from "@/lib/format";
import {
  ResponsiveContainer, ComposedChart, Area,
  XAxis, YAxis, Tooltip, Legend, Brush,
} from "recharts";

export interface ProjectionRow {
  dia: string;
  real: number | null;
  proj: number | null;
  optimistic: number | null;
  conservative: number | null;
}

interface Props {
  projectionChartData: ProjectionRow[];
  showManual: boolean;
  dailyActualByDia: Map<string, number>;
  usdBrl: number | null;
}

export function ProjectionChart({
  projectionChartData,
  showManual,
  dailyActualByDia,
  usdBrl,
}: Props) {
  const chartData = showManual
    ? projectionChartData.map((row) => ({
        ...row,
        actual: dailyActualByDia.get(row.dia) ?? null,
      }))
    : projectionChartData;

  const hasEnoughData = projectionChartData.length > 1;

  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart
        data={chartData}
        margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
      >
        <defs>
          <linearGradient id="gradReal" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#F44708" stopOpacity={0.25} />
            <stop offset="95%" stopColor="#F44708" stopOpacity={0} />
          </linearGradient>
          <linearGradient id="gradOptimistic" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#10B981" stopOpacity={0.15} />
            <stop offset="95%" stopColor="#10B981" stopOpacity={0} />
          </linearGradient>
          <linearGradient id="gradActualOverlay" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#F44708" stopOpacity={0.6} />
            <stop offset="95%" stopColor="#F44708" stopOpacity={0.05} />
          </linearGradient>
        </defs>

        <XAxis
          dataKey="dia"
          tick={{ fontSize: 10, fill: "#9B9B9B" }}
          interval="preserveStartEnd"
          axisLine={false}
          tickLine={false}
          height={20}
        />
        <YAxis hide domain={[0, (dataMax: number) => dataMax * 1.05]} />

        <Tooltip
          formatter={(v: any, name: string) => {
            if (v === null || v === undefined) return null as any;
            const val = usdBrl
              ? formatBRL(Number(v) * usdBrl)
              : `$${Number(v).toFixed(4)}`;
            const labels: Record<string, string> = {
              real: "Real",
              proj: "Provável",
              optimistic: "Otimista",
              conservative: "Conservador",
              actual: "Manual",
            };
            return [val, labels[name] ?? name];
          }}
          labelStyle={{ color: "#1A0A00", fontSize: 11, fontWeight: 600 }}
          contentStyle={{
            border: "1px solid #F1F1F1",
            borderRadius: 12,
            fontSize: 11,
            boxShadow: "0 8px 24px rgba(0,0,0,.08)",
          }}
        />
        <Legend content={() => null} />

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
        />
        {/* Optimistic scenario — green dashed */}
        <Area
          type="monotone"
          dataKey="optimistic"
          stroke="#10B981"
          strokeWidth={1.5}
          strokeDasharray="5 3"
          fill="url(#gradOptimistic)"
          dot={false}
          connectNulls={false}
          legendType="none"
        />
        {/* Probable scenario — orange dashed */}
        <Area
          type="monotone"
          dataKey="proj"
          stroke="#F44708"
          strokeWidth={1.5}
          strokeDasharray="5 3"
          fill="none"
          dot={false}
          connectNulls={false}
          legendType="none"
        />
        {/* Conservative scenario — slate dashed */}
        <Area
          type="monotone"
          dataKey="conservative"
          stroke="#94A3B8"
          strokeWidth={1.5}
          strokeDasharray="5 3"
          fill="none"
          dot={false}
          connectNulls={false}
          legendType="none"
        />
        {/* Manual / actual overlay */}
        {showManual && (
          <Area
            type="monotone"
            dataKey="actual"
            stroke="none"
            strokeWidth={0}
            fill="url(#gradActualOverlay)"
            dot={false}
            connectNulls={false}
            legendType="none"
          />
        )}

        {/* Brush — scrollable range selector, shows last 30 days by default.
            Guard: only render when ≥2 data points; endIndex=-1 or
            startIndex===endIndex crashes recharts. */}
        {hasEnoughData && (
          <Brush
            dataKey="dia"
            height={24}
            stroke="#E8D0C0"
            fill="#FFF8F5"
            travellerWidth={8}
            startIndex={Math.max(0, projectionChartData.length - 31)}
            endIndex={projectionChartData.length - 1}
            tickFormatter={() => ""}
          />
        )}
      </ComposedChart>
    </ResponsiveContainer>
  );
}
