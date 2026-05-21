import type { ComponentType } from "react";

interface KpiCardProps {
  label: string;
  value: string;
  sub?: string | null;
  delta?: number;
  fmtDelta?: (n: number) => string;
  icon: ComponentType<{ className?: string }>;
  tone?: "default" | "success" | "warning" | "danger";
}

export function KpiCard({ label, value, sub, delta = 0, fmtDelta, icon: Icon, tone = "default" }: KpiCardProps) {
  const iconBg = tone === "success" ? "from-[#ECFDF5] to-[#D1FAE5]" : "from-[#FFF0E8] to-[#FFD9C0]";
  const iconColor = tone === "success" ? "text-[#16a34a]" : "text-[#F44708]";
  return (
    <div className="bg-white border border-[#E0E0E0] rounded-2xl p-5 transition-colors">
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs font-medium text-[#6B6B6B] uppercase tracking-wider">{label}</p>
        <div className={`h-8 w-8 rounded-xl bg-gradient-to-br ${iconBg} flex items-center justify-center`}>
          <Icon className={`h-4 w-4 ${iconColor}`} />
        </div>
      </div>
      <p className="text-2xl font-bold tracking-tight tabular-nums text-[#1A0A00]">{value}</p>
      <div className="flex items-center gap-2 mt-1">
        {sub && <p className="text-xs text-[#6B6B6B]">{sub}</p>}
        {delta !== 0 && fmtDelta && (
          <span className={`text-xs font-semibold ${delta > 0 ? "text-[#16a34a]" : "text-[#dc2626]"}`}>
            {delta > 0 ? "+" : ""}{fmtDelta(delta)}
          </span>
        )}
      </div>
    </div>
  );
}
