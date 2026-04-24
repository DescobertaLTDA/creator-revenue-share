import type { ReactNode } from "react";
import { PageHeader } from "./PageHeader";
import { EmptyState } from "./EmptyState";
import { Construction } from "lucide-react";

export function SimplePage({ title, description, children }: { title: string; description?: string; children?: ReactNode }) {
  return (
    <div>
      <PageHeader title={title} description={description} />
      {children ?? (
        <EmptyState
          icon={Construction}
          title="Em construção"
          description="Esta seção faz parte do MVP e será implementada na próxima iteração. A estrutura do banco, RLS e navegação já estão prontas."
        />
      )}
    </div>
  );
}
