import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { PageHeader } from "@/components/app/PageHeader";
import { StatusBadge } from "@/components/app/StatusBadge";
import { EmptyState } from "@/components/app/EmptyState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { parseFacebookCsv, hashFile } from "@/features/csv/parser";
import { formatDateTime } from "@/lib/format";
import { toast } from "sonner";
import { Upload, FileSpreadsheet, Loader2, Search } from "lucide-react";

export const Route = createFileRoute("/admin/importacoes")({
  head: () => ({ meta: [{ title: "Importações — Rateio Creator" }] }),
  component: ImportacoesPage,
});

interface ImportRow {
  id: string;
  file_name: string;
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
}

function ImportacoesPage() {
  const { profile } = useAuth();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);
  const [imports, setImports] = useState<ImportRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("");

  const load = async () => {
    setLoading(true);
    let query = supabase
      .from("csv_imports")
      .select("id, file_name, status, created_at, total_rows, valid_rows, invalid_rows, inserted_rows, updated_rows, duplicated_rows, detected_pages_count, period_start, period_end")
      .order("created_at", { ascending: false })
      .limit(100);
    if (statusFilter) query = query.eq("status", statusFilter as "processando" | "concluido" | "falha" | "parcial");
    const { data, error } = await query;
    if (error) toast.error("Erro ao carregar", { description: error.message });
    setImports((data as ImportRow[]) ?? []);
    setLoading(false);
  };

  useEffect(() => { load(); }, [statusFilter]);

  const filtered = imports.filter((i) =>
    !q ? true : i.file_name.toLowerCase().includes(q.toLowerCase())
  );

  const onUpload = async (file: File) => {
    if (!profile) return;
    setUploading(true);
    const toastId = toast.loading("Processando CSV…");
    try {
      const text = await file.text();
      const hash = await hashFile(file);

      // Duplicidade por hash
      const { data: existing } = await supabase
        .from("csv_imports")
        .select("id")
        .eq("file_hash", hash)
        .maybeSingle();
      if (existing) {
        toast.warning("Arquivo já importado", { id: toastId, description: "Este CSV já foi processado anteriormente." });
        setUploading(false);
        return;
      }

      const parsed = parseFacebookCsv(text);

      // 1) cria registro de importação
      const { data: imp, error: impErr } = await supabase
        .from("csv_imports")
        .insert({
          uploaded_by: profile.id,
          file_name: file.name,
          file_hash: hash,
          status: "processando",
          total_rows: parsed.totalRows,
          valid_rows: parsed.rows.length,
          invalid_rows: parsed.errors.length,
          detected_pages_count: parsed.detectedPages.size,
          period_start: parsed.periodStart ? parsed.periodStart.toISOString().slice(0, 10) : null,
          period_end: parsed.periodEnd ? parsed.periodEnd.toISOString().slice(0, 10) : null,
        })
        .select()
        .single();
      if (impErr || !imp) throw impErr ?? new Error("Falha ao registrar importação");

      // 1.5) upload opcional do arquivo bruto para bucket privado
      const path = `${imp.id}/${file.name}`;
      await supabase.storage.from("csv-uploads").upload(path, file, { upsert: true });
      await supabase.from("csv_imports").update({ file_path: path }).eq("id", imp.id);

      // 2) insere erros de parsing
      if (parsed.errors.length > 0) {
        await supabase.from("csv_import_errors").insert(
          parsed.errors.map((e) => ({
            import_id: imp.id,
            row_number: e.row_number,
            field_name: e.field_name,
            error_message: e.error_message,
            raw_payload: e.raw_payload as unknown as never,
          }))
        );
      }

      // 3) upsert de páginas detectadas
      const pageMap = new Map<string, string>();
      for (const row of parsed.rows) pageMap.set(row.external_page_id, row.page_name);
      if (pageMap.size > 0) {
        const pagesPayload = Array.from(pageMap.entries()).map(([external_page_id, nome]) => ({
          external_page_id,
          nome,
        }));
        await supabase.from("pages").upsert(pagesPayload, { onConflict: "external_page_id", ignoreDuplicates: false });
      }
      const { data: allPages } = await supabase
        .from("pages")
        .select("id, external_page_id")
        .in("external_page_id", Array.from(pageMap.keys()));
      const pageIdMap = new Map<string, string>();
      (allPages ?? []).forEach((p) => pageIdMap.set(p.external_page_id, p.id));

      // 4) upsert de posts
      let inserted = 0;
      let updated = 0;
      const CHUNK = 200;
      for (let i = 0; i < parsed.rows.length; i += CHUNK) {
        const slice = parsed.rows.slice(i, i + CHUNK);
        const payload = slice
          .map((r) => {
            const pageId = pageIdMap.get(r.external_page_id);
            if (!pageId) return null;
            return {
              page_id: pageId,
              external_post_id: r.external_post_id,
              published_at: r.published_at ? r.published_at.toISOString() : null,
              title: r.title,
              description: r.description,
              permalink: r.permalink,
              post_type: r.post_type,
              language: r.language,
              views: r.views,
              reach: r.reach,
              reactions: r.reactions,
              comments: r.comments,
              shares: r.shares,
              clicks_total: r.clicks_total,
              clicks_other: r.clicks_other,
              link_clicks: r.link_clicks,
              monetization_approx: r.monetization_approx,
              estimated_usd: r.estimated_usd,
              source_import_id: imp.id,
            };
          })
          .filter((x): x is NonNullable<typeof x> => x !== null);

        const { data: upserted, error: upErr } = await supabase
          .from("posts")
          .upsert(payload, { onConflict: "page_id,external_post_id" })
          .select("id, created_at, updated_at");
        if (upErr) throw upErr;
        for (const p of upserted ?? []) {
          if (p.created_at === p.updated_at) inserted++;
          else updated++;
        }
      }

      // 5) matching de hashtags → post_authors
      const { data: collaborators } = await supabase
        .from("collaborators")
        .select("id, hashtag")
        .eq("ativo", true)
        .not("hashtag", "is", null);

      if (collaborators && collaborators.length > 0) {
        // busca todos os posts recém-upsertados com suas descrições
        const allPageIds = Array.from(pageIdMap.values());
        const { data: allPosts } = await supabase
          .from("posts")
          .select("id, description, title")
          .in("page_id", allPageIds);

        const authorRows: { post_id: string; collaborator_id: string; source: string }[] = [];

        for (const post of allPosts ?? []) {
          const text = `${post.title ?? ""} ${post.description ?? ""}`.toLowerCase();
          for (const col of collaborators) {
            if (!col.hashtag) continue;
            // match de palavra inteira: #hashtag não seguido de letra/número
            const regex = new RegExp(`#${col.hashtag.toLowerCase()}(?![a-z0-9_])`, "i");
            if (regex.test(text)) {
              authorRows.push({ post_id: post.id, collaborator_id: col.id, source: "hashtag" });
            }
          }
        }

        if (authorRows.length > 0) {
          await supabase
            .from("post_authors")
            .upsert(authorRows, { onConflict: "post_id,collaborator_id", ignoreDuplicates: true });
        }
      }

      const status = parsed.errors.length === 0 ? "concluido" : parsed.errors.length === parsed.totalRows ? "falha" : "parcial";
      await supabase.from("csv_imports").update({ status, inserted_rows: inserted, updated_rows: updated }).eq("id", imp.id);

      // Auditoria
      await supabase.from("audit_logs").insert({
        actor_profile_id: profile.id,
        action: "csv_import",
        entity: "csv_imports",
        entity_id: imp.id,
        after_json: { file: file.name, valid: parsed.rows.length, invalid: parsed.errors.length, inserted, updated },
      });

      toast.success("Importação concluída", {
        id: toastId,
        description: `${parsed.rows.length} linhas válidas · ${inserted} novas · ${updated} atualizadas`,
      });
      await load();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erro desconhecido";
      toast.error("Falha na importação", { id: toastId, description: msg });
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <div>
      <PageHeader
        title="Importações CSV"
        description="Envie o CSV exportado do Facebook. O sistema é idempotente: linhas já importadas são atualizadas, não duplicadas."
        actions={
          <>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => e.target.files?.[0] && onUpload(e.target.files[0])}
            />
            <Button onClick={() => fileRef.current?.click()} disabled={uploading}>
              {uploading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Upload className="h-4 w-4 mr-2" />}
              Enviar CSV
            </Button>
          </>
        }
      />

      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Buscar por arquivo…" value={q} onChange={(e) => setQ(e.target.value)} className="pl-9" />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="h-10 rounded-md border border-input bg-background px-3 text-sm"
        >
          <option value="">Todos os status</option>
          <option value="processando">Processando</option>
          <option value="concluido">Concluído</option>
          <option value="parcial">Parcial</option>
          <option value="falha">Falha</option>
        </select>
      </div>

      <div className="bg-card border border-border rounded-xl overflow-hidden">
        {loading ? (
          <div className="p-10 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : filtered.length === 0 ? (
          <div className="p-6">
            <EmptyState
              icon={FileSpreadsheet}
              title="Nenhuma importação encontrada"
              description="Envie seu primeiro CSV para começar."
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="text-left px-5 py-3 font-medium">Arquivo</th>
                  <th className="text-left px-5 py-3 font-medium">Status</th>
                  <th className="text-right px-5 py-3 font-medium">Válidas</th>
                  <th className="text-right px-5 py-3 font-medium">Inválidas</th>
                  <th className="text-right px-5 py-3 font-medium">Novas/Atual.</th>
                  <th className="text-right px-5 py-3 font-medium">Páginas</th>
                  <th className="text-left px-5 py-3 font-medium">Quando</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtered.map((imp) => (
                  <tr key={imp.id} className="hover:bg-muted/20">
                    <td className="px-5 py-3">
                      <Link to="/admin/importacoes/$id" params={{ id: imp.id }} className="font-medium hover:underline">
                        {imp.file_name}
                      </Link>
                    </td>
                    <td className="px-5 py-3"><StatusBadge status={imp.status} /></td>
                    <td className="px-5 py-3 text-right tabular-nums">{imp.valid_rows}</td>
                    <td className="px-5 py-3 text-right tabular-nums text-destructive">{imp.invalid_rows}</td>
                    <td className="px-5 py-3 text-right tabular-nums text-muted-foreground">{imp.inserted_rows}/{imp.updated_rows}</td>
                    <td className="px-5 py-3 text-right tabular-nums">{imp.detected_pages_count}</td>
                    <td className="px-5 py-3 text-muted-foreground">{formatDateTime(imp.created_at)}</td>
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
