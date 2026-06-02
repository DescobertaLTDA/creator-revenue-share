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
}

export function ProjectionChart({
  projectionChartData,
  showManual,
  dailyActualByDia,
  usdBrl,
}: Props) {
  const chartData = (() => {
    if (!showManual) return projectionChartData;

    // Build base rows with actual overlay
    const rows: Array<ProjectionRow & { actual: number | null }> =
      projectionChartData.map((row) => ({
        ...row,
        actual: dailyActualByDia.get(row.dia) ?? null,
      }));

    // Include days that have manual data but are NOT in projectionChartData
    // (e.g. current month days before today when no CSV has been imported yet)
    const existingDias = new Set(projectionChartData.map((r) => r.dia));
    for (const [dia, actual] of dailyActualByDia) {
      if (!existingDias.has(dia)) {
        rows.push({ dia, real: null, proj: null, optimistic: null, conservative: null, actual });
      }
    }

    // Sort chronologically by dd/mm
    rows.sort((a, b) => {
      const [ad, am] = a.dia.split("/").map(Number);
      const [bd, bm] = b.dia.split("/").map(Number);
      return am !== bm ? am - bm : ad - bd;
    });

    // Bridge: fill projection values onto ALL days that have actual/real data
    // so the dashed projection lines span the full chart (from 01/06 onwards),
    // not just floating from the first future day.
    const firstProjRow = rows.find((r) => r.proj != null);
    if (firstProjRow) {
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i] as any;
        if ((r.actual != null || r.real != null) && rows[i].proj == null) {
          rows[i] = {
            ...rows[i],
            proj: firstProjRow.proj,
            optimistic: firstProjRow.optimistic,
            conservative: firstProjRow.conservative,
          };
        }
      }
    }

    return rows;
  })();

  // Base the Y-axis ceiling on real/actual values only so that projection
  // lines (which can be much larger) don't dwarf the historical data.
  const realMax = Math.max(
    0,
    ...chartData.map((r) => r.real ?? 0),
    ...(showManual ? chartData.map((r: any) => r.actual ?? 0) : []),
  );
  // If we have real data use 1.4× its peak; otherwise fall through to recharts auto.
  const yMax: number | undefined = realMax > 0 ? realMax * 1.4 : undefined;

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


      </ComposedChart>
    </ResponsiveContainer>
  );
}
