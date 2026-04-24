import { createFileRoute, Link } from "@tanstack/react-router";
import { SimplePage } from "@/components/app/SimplePage";
import { ArrowLeft } from "lucide-react";

export const Route = createFileRoute("/admin/fechamentos/$id")({
  component: () => (
    <div>
      <Link to="/admin/fechamentos" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-4">
        <ArrowLeft className="h-4 w-4" /> Voltar
      </Link>
      <SimplePage title="Detalhe do fechamento" description="Lista por colaborador, ações de pagamento e geração de PDF serão implementadas em breve." />
    </div>
  ),
});
