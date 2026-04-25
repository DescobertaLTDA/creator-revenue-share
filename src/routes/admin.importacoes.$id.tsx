import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/app/PageHeader";
import { StatusBadge } from "@/components/app/StatusBadge";
import { EmptyState } from "@/components/app/EmptyState";
import { formatDateTime, formatDate } from "@/lib/format";
import { ArrowLeft, AlertTriangle, FileSpreadsheet, Loader2 } from "lucide-react";

export const Route = createFileRoute("/admin/importacoes/$id")({
  head: () => ({ meta: [{ title: "Detalhe da importação — Rateio Creator" }] }),
  component: ImportDetail,
});

interface ImportData {
  id: string;
  file_name: string;
  file_path: string | null;
  status: string;
  created_at: string;
  total_rows: number;
  valid_rows: number;
  invalid_rows: number;
  inserted_rows: number;
  updated_rows: number;
  duplicated_rows: number;
  detected_pages_count: number;
  period_start: string | null;
  period_end: string | null;
  error_message: string | null;
}

interface ImportError {
  id: string;
  row_number: number;
  field_name: string | null;
  error_message: string;
}

function ImportDetail() {
  const { id } = Route.useParams();
  const [imp, setImp] = useState<ImportData | null>(null);
  const [errors, setErrors] = useState<ImportError[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const [{ data: impData }, { data: errs }] = await Promise.all([
        supabase.from("csv_imports").select("*").eq("id", id).maybeSingle(),
        supabase
          .from("csv_import_errors")
          .select("id, row_number, field_name, error_message")
          .eq("import_id", id)
          .order("row_number")
          .limit(200),
      ]);
      setImp((impData as ImportData) ?? null);
      setErrors((errs as ImportError[]) ?? []);
      setLoading(false);
    })();
  }, [id]);

  if (loading) {
    return (
      <div className="p-10 flex justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!imp) {
    return (
      <EmptyState
        icon={FileSpreadsheet}
        title="Importação não encontrada"
        action={<Link to="/admin/importacoes" className="text-primary text-sm hover:underline">Voltar</Link>}
      />
    );
  }

  return (
    <div>
      <Link to="/admin/importacoes" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-4">
        <ArrowLeft className="h-4 w-4" /> Voltar para importações
      </Link>
      <PageHeader
        title={imp.file_name}
        description={`Importado em ${formatDateTime(imp.created_at)}`}
        actions={<StatusBadge status={imp.status} />}
      />

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-8">
        {[
          { l: "Total", v: imp.total_rows },
          { l: "Válidas", v: imp.valid_rows },
          { l: "Inválidas", v: imp.invalid_rows, danger: imp.invalid_rows > 0 },
          { l: "Inseridas", v: imp.inserted_rows },
          { l: "Atualizadas", v: imp.updated_rows },
          { l: "Páginas", v: imp.detected_pages_count },
        ].map((k) => (
          <div key={k.l} className="bg-card border border-border rounded-lg p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wider">{k.l}</p>
            <p className={`text-xl font-semibold tabular-nums ${k.danger ? "text-destructive" : ""}`}>{k.v}</p>
          </div>
        ))}
      </div>

      {imp.period_start && (
        <div className="mb-8 text-sm text-muted-foreground">
          Período detectado: <span className="text-foreground">{formatDate(imp.period_start)} → {formatDate(imp.period_end)}</span>
        </div>
      )}

      <div className="bg-card border border-border rounded-lg overflow-hidden">
        <div className="flex items-center gap-2 px-5 py-4 border-b border-border">
          <AlertTriangle className="h-4 w-4 text-warning-foreground" />
          <h2 className="font-medium">Erros por linha</h2>
          <span className="text-xs text-muted-foreground">({errors.length})</span>
        </div>
        {errors.length === 0 ? (
          <div className="p-6 text-sm text-muted-foreground text-center">Nenhum erro — todas as linhas foram processadas.</div>
        ) : (
          <div className="overflow-x-auto max-h-[500px]">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs uppercase text-muted-foreground sticky top-0">
                <tr>
                  <th className="text-left px-5 py-3 font-medium">Linha</th>
                  <th className="text-left px-5 py-3 font-medium">Campo</th>
                  <th className="text-left px-5 py-3 font-medium">Erro</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {errors.map((e) => (
                  <tr key={e.id}>
                    <td className="px-5 py-2 tabular-nums">{e.row_number}</td>
                    <td className="px-5 py-2 text-muted-foreground">{e.field_name ?? "—"}</td>
                    <td className="px-5 py-2">{e.error_message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
