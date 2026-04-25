import type { ComponentType, ReactNode } from "react";

export function KpiCard({
  label,
  value,
  icon: Icon,
  hint,
  tone = "default",
}: {
  label: string;
  value: ReactNode;
  icon?: ComponentType<{ className?: string }>;
  hint?: string;
  tone?: "default" | "success" | "warning" | "destructive";
}) {
  const iconColor: Record<string, string> = {
    default:     "text-foreground",
    success:     "text-[#16a34a]",
    warning:     "text-[#d97706]",
    destructive: "text-[#dc2626]",
  };

  return (
    <div className="bg-card border border-border rounded-lg p-4 flex items-start justify-between gap-4">
      <div className="space-y-0.5 min-w-0">
        <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">{label}</p>
        <p className="text-xl font-semibold tracking-tight text-foreground">{value}</p>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
      {Icon && (
        <div className="shrink-0 mt-0.5">
          <Icon className={`h-4 w-4 ${iconColor[tone]}`} />
        </div>
      )}
    </div>
  );
}
