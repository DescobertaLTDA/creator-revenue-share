import type { ComponentType, ReactNode } from "react";

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon?: ComponentType<{ className?: string }>;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="text-center py-16 px-4 border border-dashed border-border rounded-xl bg-card/50">
      {Icon && (
        <div className="mx-auto h-12 w-12 rounded-full bg-primary-soft flex items-center justify-center mb-4">
          <Icon className="h-6 w-6 text-accent-foreground" />
        </div>
      )}
      <h3 className="text-base font-medium">{title}</h3>
      {description && <p className="text-sm text-muted-foreground mt-1 max-w-md mx-auto">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
