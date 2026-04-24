import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/app/PageHeader";
import { EmptyState } from "@/components/app/EmptyState";
import { formatBRL, formatDateTime } from "@/lib/format";
import { FileText, Loader2 } from "lucide-react";

export const Route = createFileRoute("/admin/posts")({
  head: () => ({ meta: [{ title: "Posts — Rateio Creator" }] }),
  component: PostsPage,
});

interface PostRow {
  id: string; external_post_id: string; published_at: string | null; title: string | null;
  views: number | null; reach: number | null; monetization_approx: number | null;
  pages: { nome: string } | null;
}

function PostsPage() {
  const [rows, setRows] = useState<PostRow[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("posts")
        .select("id, external_post_id, published_at, title, views, reach, monetization_approx, pages(nome)")
        .order("published_at", { ascending: false })
        .limit(200);
      setRows((data as unknown as PostRow[]) ?? []);
      setLoading(false);
    })();
  }, []);
  return (
    <div>
      <PageHeader title="Posts" description="Posts importados de todos os CSVs. Edição de autor manual será habilitada na próxima iteração." />
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        {loading ? <div className="p-10 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground"/></div> :
        rows.length === 0 ? <div className="p-6"><EmptyState icon={FileText} title="Nenhum post importado" description="Envie um CSV na aba Importações."/></div> :
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="text-left px-5 py-3 font-medium">Post</th>
                <th className="text-left px-5 py-3 font-medium">Página</th>
                <th className="text-left px-5 py-3 font-medium">Publicado</th>
                <th className="text-right px-5 py-3 font-medium">Alcance</th>
                <th className="text-right px-5 py-3 font-medium">Views</th>
                <th className="text-right px-5 py-3 font-medium">Receita</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map(r => (
                <tr key={r.id} className="hover:bg-muted/20">
                  <td className="px-5 py-3 max-w-xs truncate">{r.title ?? r.external_post_id}</td>
                  <td className="px-5 py-3 text-muted-foreground">{r.pages?.nome ?? "—"}</td>
                  <td className="px-5 py-3 text-muted-foreground">{formatDateTime(r.published_at)}</td>
                  <td className="px-5 py-3 text-right tabular-nums">{r.reach ?? 0}</td>
                  <td className="px-5 py-3 text-right tabular-nums">{r.views ?? 0}</td>
                  <td className="px-5 py-3 text-right tabular-nums">{formatBRL(r.monetization_approx)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>}
      </div>
    </div>
  );
}
