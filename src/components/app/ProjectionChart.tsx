// ProjectionChart — lazy-loaded so recharts is never statically bundled
// into the admin.dashboard chunk (avoids TDZ circular-dependency crashes).
import { formatBRL } from "@/lib/format";
import {
  ResponsiveContainer, ComposedChart, Area,
  XAxis, YAxis, Tooltip, Legend,
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
  baseDaily: number;
}

export function ProjectionChart({
  projectionChartData,
  showManual,
  dailyActualByDia,
  usdBrl,
  baseDaily,
}: Props) {
  const chartData = (() => {
    if (!showManual) return projectionChartData;

    // Days that already have projection data (from CSV history or future rows)
    const existingDias = new Set(projectionChartData.map((r) => r.dia));

    // For manual-only days (no CSV), compute straight-line projection values
    // using the same formula: proj = baseDaily × dayOfMonth
    const extraRows: Array<ProjectionRow & { actual: number | null }> =
      [...dailyActualByDia.entries()]
        .filter(([dia]) => !existingDias.has(dia))
        .map(([dia, val]) => {
          const [dd] = dia.split("/").map(Number);
          return {
            dia, real: null,
            proj: +(baseDaily * dd).toFixed(6),
            optimistic: +(baseDaily * 1.72 * dd).toFixed(6),
            conservative: +(baseDaily * 0.65 * dd).toFixed(6),
            actual: val,
          };
        });

    const rows: Array<ProjectionRow & { actual: number | null }> = [
      ...projectionChartData.map((row) => ({
        ...row,
        actual: dailyActualByDia.get(row.dia) ?? null,
      })),
      ...extraRows,
    ];

    // Sort chronologically by dd/mm
    rows.sort((a, b) => {
      const [ad, am] = a.dia.split("/").map(Number);
      const [bd, bm] = b.dia.split("/").map(Number);
      return am !== bm ? am - bm : ad - bd;
    });

    // Convert per-day actual values to a running cumulative total so the
    // manual overlay grows like the straight-line projection.
    let cumActual = 0;
    for (const row of rows) {
      const r = row as any;
      if (r.actual != null) {
        cumActual += r.actual;
        r.actual = cumActual;
      }
    }

    return rows;
  })();

  // Y-axis: scale to the optimistic end-of-month value so all 3 scenario lines
  // fit. Real/actual data will occupy the lower portion of the chart early in
  // the month and grow to fill it as the month progresses.
  const yMax: number | undefined = (() => {
    const top = Math.max(
      0,
      ...chartData.map((r) => r.optimistic ?? 0),
      ...chartData.map((r) => r.real ?? 0),
      ...(showManual ? chartData.map((r: any) => r.actual ?? 0) : []),
    );
    return top > 0 ? top * 1.08 : undefined;
  })();

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
        <YAxis hide domain={[0, yMax ?? ((dataMax: number) => dataMax * 1.05)]} />

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
        {/* Manual / actual overlay — visible stroke so it's readable early in month */}
        {showManual && (
          <Area
            type="monotone"
            dataKey="actual"
            stroke="#F44708"
            strokeWidth={2}
            fill="url(#gradActualOverlay)"
            dot={false}
            connectNulls={false}
            legendType="none"
          />
        )}


      </ComposedChart>
    </ResponsiveContainer>
  );
}
