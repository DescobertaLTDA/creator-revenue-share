import { cn } from "@/lib/utils";

const variants: Record<string, string> = {
  aberto: "bg-warning/20 text-warning-foreground",
  fechado: "bg-success/15 text-success",
  a_pagar: "bg-warning/20 text-warning-foreground",
  pago_fora: "bg-success/15 text-success",
  ajustado: "bg-primary-soft text-accent-foreground",
  processando: "bg-primary-soft text-accent-foreground",
  concluido: "bg-success/15 text-success",
  falha: "bg-destructive/10 text-destructive",
  parcial: "bg-warning/20 text-warning-foreground",
  manual: "bg-muted text-muted-foreground",
  hashtag: "bg-primary-soft text-accent-foreground",
};

const labels: Record<string, string> = {
  aberto: "Aberto",
  fechado: "Fechado",
  a_pagar: "A pagar",
  pago_fora: "Pago fora",
  ajustado: "Ajustado",
  processando: "Processando",
  concluido: "Concluído",
  falha: "Falha",
  parcial: "Parcial",
  manual: "Manual",
  hashtag: "Hashtag",
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
        variants[status] ?? "bg-muted text-muted-foreground"
      )}
    >
      {labels[status] ?? status}
    </span>
  );
}
