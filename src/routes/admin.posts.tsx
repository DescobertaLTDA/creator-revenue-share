import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/app/PageHeader";
import { EmptyState } from "@/components/app/EmptyState";
import { formatBRL, formatDateTime } from "@/lib/format";
import { FileText, Loader2, ChevronLeft, ChevronRight } from "lucide-react";

export const Route = createFileRoute("/admin/posts")({
  head: () => ({ meta: [{ title: "Posts — Rateio Creator" }] }),
  component: PostsPage,
});

interface PostRow {
  id: string; external_post_id: string; published_at: string | null; title: string | null;
  views: number | null; reach: number | null; monetization_approx: number | null;
  pages: { nome: string } | null;
}

const PAGE_SIZE = 10;

function PostsPage() {
  const [rows, setRows] = useState<PostRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const from = (page - 1) * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;
      const { data, count } = await supabase
        .from("posts")
        .select("id, external_post_id, published_at, title, views, reach, monetization_approx, pages(nome)", { count: "exact" })
        .order("published_at", { ascending: false })
        .range(from, to);
      setRows((data as unknown as PostRow[]) ?? []);
      setTotal(count ?? 0);
      setLoading(false);
    })();
  }, [page]);

  const totalPages = Math.ceil(total / PAGE_SIZE);

  const getPageNumbers = () => {
    const pages: (number | "...")[] = [];
    if (totalPages <= 7) {
      for (let i = 1; i <= totalPages; i++) pages.push(i);
    } else {
      pages.push(1);
      if (page > 3) pages.push("...");
      for (let i = Math.max(2, page - 1); i <= Math.min(totalPages - 1, page + 1); i++) pages.push(i);
      if (page < totalPages - 2) pages.push("...");
      pages.push(totalPages);
    }
    return pages;
  };

  return (
    <div>
      <PageHeader title="Posts" description="Posts importados de todos os CSVs. Edição de autor manual será habilitada na próxima iteração." />
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        {loading ? (
          <div className="p-10 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground"/></div>
        ) : rows.length === 0 ? (
          <div className="p-6"><EmptyState icon={FileText} title="Nenhum post importado" description="Envie um CSV na aba Importações."/></div>
        ) : (
          <>
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
                      <td className="px-5 py-3 text-right tabular-nums">{r.reach?.toLocaleString("pt-BR") ?? 0}</td>
                      <td className="px-5 py-3 text-right tabular-nums">{r.views?.toLocaleString("pt-BR") ?? 0}</td>
                      <td className="px-5 py-3 text-right tabular-nums">{formatBRL(r.monetization_approx)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-between px-5 py-4 border-t border-border text-sm">
              <span className="text-muted-foreground">
                {total.toLocaleString("pt-BR")} posts · página {page} de {totalPages}
              </span>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="p-1.5 rounded hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>

                {getPageNumbers().map((p, i) =>
                  p === "..." ? (
                    <span key={`dots-${i}`} className="px-2 text-muted-foreground">…</span>
                  ) : (
                    <button
                      key={p}
                      onClick={() => setPage(p as number)}
                      className={`min-w-[32px] h-8 rounded px-2 font-medium transition-colors ${
                        page === p
                          ? "bg-primary text-primary-foreground"
                          : "hover:bg-muted text-foreground"
                      }`}
                    >
                      {p}
                    </button>
                  )
                )}

                <button
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                  className="p-1.5 rounded hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
