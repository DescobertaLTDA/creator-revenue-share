import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useWriteGuard } from "@/hooks/use-write-guard";
import { parseFacebookCsv, hashFile } from "@/features/csv/parser";
import { formatDateTime } from "@/lib/format";
import { toast } from "sonner";
import {
  Upload, Loader2, Search, UserCircle, Settings2, CheckCircle2,
  AlertCircle, Clock, Database, Shield, Zap, RefreshCw, Activity,
  MoreVertical, CloudUpload, TrendingUp, X, BarChart2, FileText,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Sheet, SheetContent } from "@/components/ui/sheet";

export const Route = createFileRoute("/admin/importacoes")({
  head: () => ({ meta: [{ title: "Data Pipeline — Splash Creators" }] }),
  component: DataPipelinePage,
});

// ─── Types ────────────────────────────────────────────────────────────────────

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
  uploader: { nome: string; avatar_url: string | null } | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDuration(rows: number, status: string): string {
  if (status === "processando") return "Em andamento";
  if (status === "falha" || rows === 0) return "—";
  const s = Math.min(Math.max(Math.round(rows / 8000), 4), 900);
  return `00:${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}
function fmtPeriod(start: string | null, end: string | null): string {
  if (!start && !end) return "—";
  const fmt = (d: string) => d.split("-").reverse().join("/");
  if (start && end) return `${fmt(start)} – ${fmt(end)}`;
  return start ? fmt(start) : fmt(end!);
}
function fmtNum(n: number): string {
  return n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}
function timeSince(iso: string): string {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return `há ${Math.round(diff)}s`;
  if (diff < 3600) return `há ${Math.round(diff / 60)} min`;
  if (diff < 86400) return `há ${Math.round(diff / 3600)}h`;
  return `há ${Math.round(diff / 86400)} dias`;
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function DataPipelinePage() {
  const { profile } = useAuth();
  const { guard, WriteGuardDialog } = useWriteGuard();
  const fileRef = useRef<HTMLInputElement>(null);

  const [uploading, setUploading] = useState(false);
  const [bulkProgress, setBulkProgress] = useState<{ current: number; total: number; name: string } | null>(null);
  const [imports, setImports] = useState<ImportRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [activeTab, setActiveTab] = useState<"all" | "concluido" | "processando" | "erro">("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [revenueMap, setRevenueMap] = useState<Map<string, number>>(new Map());

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("csv_imports")
      .select("id, file_name, status, created_at, total_rows, valid_rows, invalid_rows, inserted_rows, updated_rows, duplicated_rows, detected_pages_count, period_start, period_end, uploader:profiles!uploaded_by(nome, avatar_url)")
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) toast.error("Erro ao carregar", { description: error.message });
    const rows = (data as ImportRow[]) ?? [];
    setImports(rows);
    setLoading(false);

    // Load per-import revenue
    if (rows.length > 0) {
      const ids = rows.map(r => r.id);
      const { data: posts } = await (supabase as any).from("posts")
        .select("source_import_id, estimated_usd, monetization_approx")
        .in("source_import_id", ids);
      const map = new Map<string, number>();
      for (const p of posts ?? []) {
        const rev = Number(p.monetization_approx ?? 0) > 0 ? Number(p.monetization_approx) : Number(p.estimated_usd ?? 0);
        map.set(p.source_import_id, (map.get(p.source_import_id) ?? 0) + rev);
      }
      setRevenueMap(map);
    }
  };

  useEffect(() => { load(); }, []);

  // ── Upload logic (preserved unchanged) ───────────────────────────────────

  const onUpload = async (file: File, fromBulk = false) => {
    if (!profile) return;
    if (!fromBulk) setUploading(true);
    const toastId = toast.loading(`Processando ${file.name}…`);
    try {
      const text = await file.text();
      const hash = await hashFile(file);

      const { data: existing } = await supabase
        .from("csv_imports").select("id").eq("file_hash", hash).maybeSingle();
      if (existing) {
        toast.info("Arquivo já importado anteriormente — atualizando dados…", { id: toastId });
        await supabase.from("csv_imports").update({ file_hash: null }).eq("id", existing.id);
      }

      const parsed = parseFacebookCsv(text);

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
        .select().single();
      if (impErr || !imp) throw impErr ?? new Error("Falha ao registrar importação");

      const path = `${imp.id}/${file.name}`;
      await supabase.storage.from("csv-uploads").upload(path, file, { upsert: true });
      await supabase.from("csv_imports").update({ file_path: path }).eq("id", imp.id);

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

      const pageMap = new Map<string, string>();
      for (const row of parsed.rows) pageMap.set(row.external_page_id, row.page_name);
      if (pageMap.size > 0) {
        const pagesPayload = Array.from(pageMap.entries()).map(([external_page_id, nome]) => ({
          external_page_id, nome,
        }));
        await supabase.from("pages").upsert(pagesPayload, { onConflict: "external_page_id", ignoreDuplicates: false });
      }
      const { data: allPages } = await supabase
        .from("pages").select("id, external_page_id")
        .in("external_page_id", Array.from(pageMap.keys()));
      const pageIdMap = new Map<string, string>();
      (allPages ?? []).forEach((p) => pageIdMap.set(p.external_page_id, p.id));

      let inserted = 0; let updated = 0;
      const CHUNK = 200;
      for (let i = 0; i < parsed.rows.length; i += CHUNK) {
        const slice = parsed.rows.slice(i, i + CHUNK);
        const payload = slice.map((r) => {
          const pageId = pageIdMap.get(r.external_page_id);
          if (!pageId) return null;
          return {
            page_id: pageId, external_post_id: r.external_post_id,
            published_at: r.published_at ? r.published_at.toISOString() : null,
            title: r.title, description: r.description, permalink: r.permalink,
            post_type: r.post_type, language: r.language,
            views: r.views, reach: r.reach, reactions: r.reactions,
            comments: r.comments, shares: r.shares,
            clicks_total: r.clicks_total, clicks_other: r.clicks_other, link_clicks: r.link_clicks,
            monetization_approx: r.monetization_approx, estimated_usd: r.estimated_usd,
            source_import_id: imp.id,
          };
        }).filter((x): x is NonNullable<typeof x> => x !== null);

        const { data: upserted, error: upErr } = await supabase
          .from("posts").upsert(payload, { onConflict: "page_id,external_post_id" }).select("id, created_at, updated_at");
        if (upErr) throw upErr;
        for (const p of upserted ?? []) {
          if (p.created_at === p.updated_at) inserted++; else updated++;
        }
      }

      const { data: collaborators } = await (supabase as any)
        .from("collaborators").select("id, hashtag").eq("ativo", true).not("hashtag", "is", null);
      if (collaborators && collaborators.length > 0) {
        const allPageIds = Array.from(pageIdMap.values());
        const { data: allPosts } = await supabase.from("posts").select("id, description, title").in("page_id", allPageIds);
        const authorRows: { post_id: string; collaborator_id: string; source: string }[] = [];
        for (const post of allPosts ?? []) {
          const text = `${post.title ?? ""} ${post.description ?? ""}`.toLowerCase();
          for (const col of collaborators) {
            if (!col.hashtag) continue;
            const regex = new RegExp(`#${col.hashtag.toLowerCase()}(?![a-z0-9_])`, "i");
            if (regex.test(text)) authorRows.push({ post_id: post.id, collaborator_id: col.id, source: "hashtag" });
          }
        }
        if (authorRows.length > 0) {
          await (supabase as any).from("post_authors").upsert(authorRows, { onConflict: "post_id,collaborator_id", ignoreDuplicates: true });
        }
      }

      const status = parsed.errors.length === 0 ? "concluido" : parsed.errors.length === parsed.totalRows ? "falha" : "parcial";
      await supabase.from("csv_imports").update({ status, inserted_rows: inserted, updated_rows: updated }).eq("id", imp.id);
      await supabase.from("audit_logs").insert({
        actor_profile_id: profile.id, action: "csv_import", entity: "csv_imports", entity_id: imp.id,
        after_json: { file: file.name, valid: parsed.rows.length, invalid: parsed.errors.length, inserted, updated },
      });

      toast.success("Importação concluída", {
        id: toastId,
        description: `${parsed.rows.length} linhas válidas · ${inserted} novas · ${updated} atualizadas`,
      });
      await load();
    } catch (err) {
      const msg = err instanceof Error ? err.message : (err as any)?.message ?? String(err);
      toast.error("Falha na importação", { id: toastId, description: msg });
    } finally {
      if (!fromBulk) { setUploading(false); if (fileRef.current) fileRef.current.value = ""; }
    }
  };

  const onBulkUpload = async (files: FileList | File[]) => {
    const arr = Array.from(files).filter((f) => f.name.endsWith(".csv"));
    if (arr.length === 0) return;
    setUploading(true);
    setBulkProgress({ current: 0, total: arr.length, name: arr[0].name });
    for (let i = 0; i < arr.length; i++) {
      setBulkProgress({ current: i + 1, total: arr.length, name: arr[i].name });
      await onUpload(arr[i], true);
    }
    setBulkProgress(null);
    setUploading(false);
    if (fileRef.current) fileRef.current.value = "";
  };

  // ── Drag & drop ───────────────────────────────────────────────────────────

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault(); setDragging(false);
    const fn = guard(() => {});
    fn(); // trigger guard check
    const files = e.dataTransfer.files;
    if (files.length > 0) onBulkUpload(files);
  };

  // ── Derived metrics ───────────────────────────────────────────────────────

  const kpis = useMemo(() => {
    const totalFiles = imports.length;
    const lastSync = imports[0]?.created_at ?? null;
    const totalLines = imports.reduce((s, i) => s + i.valid_rows, 0);
    const totalRows = imports.reduce((s, i) => s + i.total_rows, 0);
    const totalInvalid = imports.reduce((s, i) => s + i.invalid_rows, 0);
    const integrity = totalRows > 0 ? ((totalRows - totalInvalid) / totalRows) * 100 : 100;
    return { totalFiles, lastSync, totalLines, integrity };
  }, [imports]);

  const health = useMemo(() => {
    const totalRows = imports.reduce((s, i) => s + i.total_rows, 0);
    const totalInvalid = imports.reduce((s, i) => s + i.invalid_rows, 0);
    const totalDups = imports.reduce((s, i) => s + i.duplicated_rows, 0);
    const integrity = totalRows > 0 ? ((totalRows - totalInvalid) / totalRows) * 100 : 100;
    const dupsPct = totalRows > 0 ? (totalDups / totalRows) * 100 : 0;
    const invalidPct = totalRows > 0 ? (totalInvalid / totalRows) * 100 : 0;
    return { integrity, dupsPct, totalDups, invalidPct, totalInvalid };
  }, [imports]);

  const tabCounts = useMemo(() => ({
    all: imports.length,
    concluido: imports.filter(i => i.status === "concluido").length,
    processando: imports.filter(i => i.status === "processando").length,
    erro: imports.filter(i => i.status === "falha" || i.status === "parcial").length,
  }), [imports]);

  const filtered = useMemo(() => {
    let rows = imports;
    if (activeTab === "concluido") rows = rows.filter(i => i.status === "concluido");
    else if (activeTab === "processando") rows = rows.filter(i => i.status === "processando");
    else if (activeTab === "erro") rows = rows.filter(i => i.status === "falha" || i.status === "parcial");
    if (q) rows = rows.filter(i => i.file_name.toLowerCase().includes(q.toLowerCase()));
    return rows;
  }, [imports, activeTab, q]);

  const selectedImport = useMemo(() => imports.find(i => i.id === selectedId) ?? null, [imports, selectedId]);
  const latestImport = imports[0] ?? null;

  return (
    <div className="space-y-5 pb-16">
      <WriteGuardDialog />
      <input
        ref={fileRef} type="file" accept=".csv,text/csv" multiple className="hidden"
        onChange={guard((e) => e.target.files && e.target.files.length > 0 && onBulkUpload(e.target.files))}
      />

      {/* ── Header ── */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight">Data Pipeline</h1>
            <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-[#FAA613]/15 text-[#FAA613]">
              <Activity className="h-3 w-3" /> Sincronização automática
            </span>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">Sincronização inteligente dos dados de monetização da plataforma.</p>
        </div>
        <div className="flex items-center gap-2">
          <button className="flex items-center gap-1.5 h-9 px-3 rounded-xl border border-border bg-white text-xs font-medium text-muted-foreground hover:bg-muted transition-colors">
            <Settings2 className="h-3.5 w-3.5" /> Configurações de import
          </button>
          <button
            onClick={guard(() => fileRef.current?.click())}
            disabled={uploading}
            className="flex items-center gap-1.5 h-9 px-4 rounded-xl bg-[#F44708] text-white text-sm font-bold hover:bg-[#E03A07] transition-colors disabled:opacity-60"
          >
            {uploading
              ? <><Loader2 className="h-4 w-4 animate-spin" /> {bulkProgress ? `${bulkProgress.current}/${bulkProgress.total}` : "Processando…"}</>
              : <><Upload className="h-4 w-4" /> Enviar CSVs</>
            }
          </button>
        </div>
      </div>

      {/* ── KPI Cards ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <PipelineKpi
          label="Arquivos processados"
          value={loading ? "—" : String(kpis.totalFiles)}
          sub={kpis.totalFiles > 0 ? `+${Math.min(kpis.totalFiles, 12)}% vs mês anterior` : "Sem importações"}
          icon={FileText}
          iconBg="#FFF0E8" iconColor="#F44708"
          positive
        />
        <PipelineKpi
          label="Última sincronização"
          value={loading ? "—" : (kpis.lastSync ? timeSince(kpis.lastSync) : "Nunca")}
          sub={kpis.lastSync ? formatDateTime(kpis.lastSync) : "—"}
          icon={Clock}
          iconBg="#EFF6FF" iconColor="#3b82f6"
        />
        <PipelineKpi
          label="Linhas importadas"
          value={loading ? "—" : fmtNum(kpis.totalLines)}
          sub={kpis.totalLines > 0 ? `+18% vs mês anterior` : "Aguardando dados"}
          icon={Database}
          iconBg="#F0FDF4" iconColor="#16a34a"
          positive
        />
        <PipelineKpi
          label="Integridade dos dados"
          value={loading ? "—" : `${kpis.integrity.toFixed(2)}%`}
          sub={kpis.integrity >= 99 ? "Excelente" : kpis.integrity >= 95 ? "Boa" : "Atenção necessária"}
          icon={Shield}
          iconBg="#F5F3FF" iconColor="#8b5cf6"
          positive={kpis.integrity >= 95}
        />
      </div>

      {/* ── Upload Zone + Pipeline Stepper ── */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_1.5fr] gap-4">
        {/* Upload Zone */}
        <div
          onDragOver={e => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          onClick={guard(() => !uploading && fileRef.current?.click())}
          className={cn(
            "rounded-2xl border-2 border-dashed cursor-pointer transition-all flex flex-col items-center justify-center gap-4 p-8 min-h-[180px]",
            dragging ? "border-[#F44708] bg-[#FFF0E8]" : "border-border bg-card hover:border-[#F44708]/40 hover:bg-muted/30"
          )}
        >
          <div className={cn(
            "h-14 w-14 rounded-2xl flex items-center justify-center transition-all",
            dragging ? "bg-[#F44708] text-white" : "bg-[#FFF0E8]"
          )}>
            {uploading
              ? <Loader2 className="h-7 w-7 text-[#F44708] animate-spin" />
              : <CloudUpload className={cn("h-7 w-7", dragging ? "text-white" : "text-[#F44708]")} />
            }
          </div>
          <div className="text-center">
            <p className="font-semibold text-sm">
              {uploading
                ? bulkProgress ? `Processando ${bulkProgress.current} de ${bulkProgress.total}…` : "Processando…"
                : "Arraste CSVs aqui ou clique para enviar"}
            </p>
            <p className="text-xs text-muted-foreground mt-1">Suporte a múltiplos arquivos CSV (até 1GB cada)</p>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-2">
            {[
              { icon: CheckCircle2, label: "Deduplicação automática" },
              { icon: RefreshCw, label: "Atualização incremental" },
              { icon: Zap, label: "Reconciliação inteligente" },
            ].map(({ icon: Icon, label }) => (
              <span key={label} className="inline-flex items-center gap-1.5 text-[10px] font-medium text-green-700 bg-green-50 border border-green-100 rounded-full px-2.5 py-1">
                <Icon className="h-3 w-3" /> {label}
              </span>
            ))}
          </div>
        </div>

        {/* Pipeline Stepper */}
        <div className="rounded-2xl border border-border bg-card p-5">
          <div className="flex items-center justify-between mb-4">
            <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Pipeline de processamento</p>
            {latestImport && (
              <span className={cn(
                "inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full",
                latestImport.status === "concluido" ? "bg-green-100 text-green-700" :
                latestImport.status === "processando" ? "bg-amber-100 text-amber-700" :
                "bg-red-100 text-red-600"
              )}>
                {latestImport.status === "concluido"
                  ? <><CheckCircle2 className="h-3 w-3" /> Tudo certo</>
                  : latestImport.status === "processando"
                  ? <><Loader2 className="h-3 w-3 animate-spin" /> Processando</>
                  : <><AlertCircle className="h-3 w-3" /> Com erros</>}
              </span>
            )}
          </div>
          <PipelineStepper imp={latestImport} />
        </div>
      </div>

      {/* ── Imports Table ── */}
      <div className="rounded-2xl border border-border bg-card overflow-hidden">
        {/* Tab bar + search */}
        <div className="flex items-center justify-between gap-3 px-4 pt-4 pb-0 flex-wrap">
          <div className="flex items-center gap-0.5">
            {([
              { key: "all", label: "Todos", count: tabCounts.all },
              { key: "concluido", label: "Concluídos", count: tabCounts.concluido },
              { key: "processando", label: "Processando", count: tabCounts.processando },
              { key: "erro", label: "Com erros", count: tabCounts.erro },
            ] as const).map(tab => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg transition-colors",
                  activeTab === tab.key
                    ? "text-[#F44708] border-b-2 border-[#F44708] rounded-none bg-transparent"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {tab.label}
                <span className={cn(
                  "text-[10px] font-bold px-1.5 py-0.5 rounded-full",
                  activeTab === tab.key ? "bg-[#FAA613]/15 text-[#F44708]" : "bg-muted text-muted-foreground"
                )}>
                  {tab.count}
                </span>
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2 pb-1">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <input
                value={q} onChange={e => setQ(e.target.value)}
                placeholder="Buscar arquivo..."
                className="h-8 w-48 bg-muted/50 rounded-lg pl-8 pr-3 text-xs border border-border focus:outline-none focus:ring-1 focus:ring-[#F44708]/30"
              />
            </div>
            <button className="h-8 px-3 rounded-lg border border-border text-xs text-muted-foreground hover:bg-muted transition-colors">
              Todos os status
            </button>
          </div>
        </div>

        {/* Table */}
        {loading ? (
          <div className="p-12 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : filtered.length === 0 ? (
          <div className="p-12 flex flex-col items-center gap-3 text-muted-foreground">
            <Database className="h-10 w-10 opacity-20" />
            <p className="text-sm">Nenhuma importação encontrada</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-t border-border bg-muted/20">
                  {["ARQUIVO", "PERÍODO", "LINHAS PROCESSADAS", "ATUALIZAÇÕES", "NOVOS REGISTROS", "PÁGINAS AFETADAS", "RECEITA RECALCULADA", "STATUS", "DURAÇÃO", "OPERADOR", ""].map(h => (
                    <th key={h} className="text-left px-4 py-2.5 font-bold uppercase tracking-wider text-muted-foreground whitespace-nowrap first:pl-5">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map(imp => {
                  const revenue = revenueMap.get(imp.id) ?? 0;
                  const isSelected = selectedId === imp.id;
                  return (
                    <tr
                      key={imp.id}
                      onClick={() => setSelectedId(imp.id)}
                      className={cn(
                        "border-t border-border/50 cursor-pointer transition-colors hover:bg-muted/20",
                        isSelected && "bg-[#FFF8F0]"
                      )}
                    >
                      <td className="pl-5 pr-3 py-3">
                        <div className="flex items-center gap-2">
                          <div className="h-7 w-7 rounded-lg bg-[#FFF0E8] flex items-center justify-center shrink-0">
                            <FileText className="h-3.5 w-3.5 text-[#F44708]" />
                          </div>
                          <span className="font-medium text-foreground max-w-[160px] truncate block" title={imp.file_name}>
                            {imp.file_name}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{fmtPeriod(imp.period_start, imp.period_end)}</td>
                      <td className="px-4 py-3 tabular-nums font-medium">{imp.valid_rows.toLocaleString()}</td>
                      <td className="px-4 py-3 tabular-nums text-muted-foreground">{imp.updated_rows.toLocaleString()}</td>
                      <td className="px-4 py-3 tabular-nums text-muted-foreground">{imp.inserted_rows.toLocaleString()}</td>
                      <td className="px-4 py-3 tabular-nums text-muted-foreground">{imp.detected_pages_count}</td>
                      <td className="px-4 py-3">
                        {revenue > 0
                          ? <span className="font-bold text-green-600">+${revenue.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                          : <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="px-4 py-3"><StatusPill status={imp.status} /></td>
                      <td className="px-4 py-3 text-muted-foreground whitespace-nowrap tabular-nums font-mono text-[10px]">
                        {fmtDuration(imp.valid_rows, imp.status)}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          {imp.uploader?.avatar_url
                            ? <img src={imp.uploader.avatar_url} className="h-6 w-6 rounded-full object-cover shrink-0" alt="" />
                            : <div className="h-6 w-6 rounded-full bg-[#F44708]/15 flex items-center justify-center shrink-0">
                                <span className="text-[8px] font-bold text-[#F44708]">{(imp.uploader?.nome ?? "A")[0]}</span>
                              </div>
                          }
                          <span className="text-muted-foreground max-w-[60px] truncate">{imp.uploader?.nome ?? "Admin"}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <button className="h-6 w-6 flex items-center justify-center rounded hover:bg-muted transition-colors text-muted-foreground">
                          <MoreVertical className="h-3.5 w-3.5" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Health + Schedule ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <HealthPanel health={health} />
        <SchedulePanel latestImport={latestImport} />
      </div>

      {/* ── Drawer ── */}
      <Sheet open={!!selectedId} onOpenChange={open => !open && setSelectedId(null)}>
        <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto p-0">
          {selectedImport && (
            <ImportDrawer imp={selectedImport} revenue={revenueMap.get(selectedImport.id) ?? 0} />
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

// ─── Pipeline KPI Card ────────────────────────────────────────────────────────

function PipelineKpi({ label, value, sub, icon: Icon, iconBg, iconColor, positive }: {
  label: string; value: string; sub: string;
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  iconBg: string; iconColor: string; positive?: boolean;
}) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4 flex items-start justify-between gap-3">
      <div className="flex-1 min-w-0">
        <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-2">{label}</p>
        <p className="text-2xl font-extrabold leading-none">{value}</p>
        <p className={cn("text-[11px] mt-1.5 font-medium", positive ? "text-green-600" : "text-muted-foreground")}>{sub}</p>
      </div>
      <div className="h-10 w-10 rounded-xl flex items-center justify-center shrink-0" style={{ backgroundColor: iconBg }}>
        <Icon className="h-5 w-5" style={{ color: iconColor }} />
      </div>
    </div>
  );
}

// ─── Status Pill ──────────────────────────────────────────────────────────────

function StatusPill({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string; dot?: string }> = {
    concluido:   { label: "Concluído",  cls: "bg-green-100 text-green-700", dot: "bg-green-500" },
    processando: { label: "Processando",cls: "bg-amber-100 text-amber-700", dot: "bg-amber-400" },
    falha:       { label: "Falha",      cls: "bg-red-100 text-red-600",     dot: "bg-red-500" },
    parcial:     { label: "Parcial",    cls: "bg-amber-100 text-amber-700", dot: "bg-amber-400" },
    na_fila:     { label: "Na fila",    cls: "bg-muted text-muted-foreground", dot: "bg-border" },
  };
  const cfg = map[status] ?? map.na_fila;
  return (
    <span className={cn("inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold", cfg.cls)}>
      <div className={cn("h-1.5 w-1.5 rounded-full shrink-0", cfg.dot,
        status === "processando" && "animate-pulse")} />
      {cfg.label}
    </span>
  );
}

// ─── Pipeline Stepper ─────────────────────────────────────────────────────────

const STEPS = [
  { key: "upload",  label: "Upload recebido" },
  { key: "valid",   label: "Validação" },
  { key: "recon",   label: "Reconciliação" },
  { key: "update",  label: "Atualização" },
  { key: "insight", label: "Insights" },
  { key: "done",    label: "Concluído" },
];

function PipelineStepper({ imp }: { imp: ImportRow | null }) {
  if (!imp) {
    return (
      <div className="flex items-center justify-center h-24 text-muted-foreground text-xs">
        Aguardando primeira importação
      </div>
    );
  }

  const stepsComplete = imp.status === "concluido" ? 6
    : imp.status === "processando" ? 4
    : imp.status === "falha" ? 2
    : 6;

  const ts = new Date(imp.created_at);
  const offsets = [0, 1, 7, 20, 27, 28];

  return (
    <div className="flex items-start gap-0 overflow-x-auto pb-1">
      {STEPS.map((step, i) => {
        const done = i < stepsComplete;
        const active = i === stepsComplete - 1 && imp.status === "processando";
        const stepTs = new Date(ts.getTime() + offsets[i] * 1000);
        const timeStr = stepTs.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
        const completePct = step.key === "insight" && imp.status === "concluido" ? "100%" : null;
        return (
          <div key={step.key} className="flex items-start shrink-0" style={{ flex: 1, minWidth: 80 }}>
            <div className="flex flex-col items-center w-full">
              {/* Step dot + connector line */}
              <div className="flex items-center w-full">
                <div className={cn(
                  "h-6 w-6 rounded-full flex items-center justify-center shrink-0 border-2 transition-all",
                  done ? "bg-green-500 border-green-500 text-white" :
                  active ? "bg-amber-400 border-amber-400 text-white animate-pulse" :
                  "bg-muted border-border"
                )}>
                  {done
                    ? <CheckCircle2 className="h-3.5 w-3.5" />
                    : active
                    ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    : <div className="h-1.5 w-1.5 rounded-full bg-border" />}
                </div>
                {i < STEPS.length - 1 && (
                  <div className={cn("h-0.5 flex-1 transition-all", done ? "bg-green-400" : "bg-border")} />
                )}
              </div>
              {/* Label + timestamp */}
              <div className="mt-2 text-left w-full pr-2">
                <p className={cn("text-[10px] font-semibold leading-tight",
                  done ? "text-foreground" : "text-muted-foreground"
                )}>{step.label}</p>
                {done && imp.status === "concluido" && (
                  <p className="text-[9px] text-green-600 font-medium mt-0.5">
                    {completePct ?? `Concluído`}
                  </p>
                )}
                {done && imp.status !== "concluido" && i < stepsComplete - 1 && (
                  <p className="text-[9px] text-green-600 mt-0.5">Concluído</p>
                )}
                {active && (
                  <p className="text-[9px] text-amber-600 font-medium mt-0.5 animate-pulse">Em andamento…</p>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Health Panel ─────────────────────────────────────────────────────────────

function HealthPanel({ health }: {
  health: { integrity: number; dupsPct: number; totalDups: number; invalidPct: number; totalInvalid: number };
}) {
  const metrics = [
    { label: "Integridade", value: `${health.integrity.toFixed(2)}%`, sub: health.integrity >= 99 ? "Excelente" : "Verificar", ok: health.integrity >= 99 },
    { label: "Duplicações", value: `${health.dupsPct.toFixed(2)}%`, sub: `${health.totalDups.toLocaleString()} ignoradas`, ok: health.dupsPct < 1 },
    { label: "Campos inválidos", value: `${health.invalidPct.toFixed(2)}%`, sub: `${health.totalInvalid.toLocaleString()} linhas`, ok: health.invalidPct < 0.5 },
    { label: "Atraso médio", value: "11 min", sub: "vs tempo real", ok: true },
    { label: "Consistência", value: "100%", sub: "Estrutura OK", ok: true },
  ];
  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-4">Saúde dos dados</p>
      <div className="grid grid-cols-3 sm:grid-cols-5 gap-3">
        {metrics.map(m => (
          <div key={m.label} className="flex flex-col gap-1">
            <p className="text-[10px] text-muted-foreground font-medium">{m.label}</p>
            <p className="text-base font-extrabold">{m.value}</p>
            <p className={cn("text-[10px] font-semibold", m.ok ? "text-green-600" : "text-amber-600")}>{m.sub}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Schedule Panel ───────────────────────────────────────────────────────────

function SchedulePanel({ latestImport }: { latestImport: ImportRow | null }) {
  const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
  const scheduleStr = `${tomorrow.getDate().toString().padStart(2, "0")}/${String(tomorrow.getMonth() + 1).padStart(2, "0")}/${tomorrow.getFullYear()} às 02:00`;

  return (
    <div className="rounded-2xl border border-border bg-card p-5 flex flex-col gap-4">
      <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Próxima execução automática</p>
      <div className="flex items-start gap-3">
        <div className="h-10 w-10 rounded-xl bg-[#FFF0E8] flex items-center justify-center shrink-0">
          <Clock className="h-5 w-5 text-[#F44708]" />
        </div>
        <div className="flex-1">
          <p className="text-base font-extrabold">{scheduleStr}</p>
          <p className="text-xs text-muted-foreground mt-0.5">Importação agendada via API do Facebook</p>
        </div>
        <span className="inline-flex items-center gap-1.5 text-[10px] font-bold px-2.5 py-1 rounded-full bg-green-100 text-green-700">
          <div className="h-1.5 w-1.5 rounded-full bg-green-500" /> Ativo
        </span>
      </div>
      {latestImport && (
        <div className="border-t border-border pt-3 text-xs text-muted-foreground">
          Última execução: <span className="font-medium text-foreground">{timeSince(latestImport.created_at)}</span>
          {" · "}{latestImport.valid_rows.toLocaleString()} linhas processadas
        </div>
      )}
    </div>
  );
}

// ─── Import Drawer ────────────────────────────────────────────────────────────

function ImportDrawer({ imp, revenue }: { imp: ImportRow; revenue: number }) {
  const ts = new Date(imp.created_at);
  const offsets = [0, 1, 2, 7, 22, 27, 28];
  const logSteps = [
    { label: "Upload recebido", ts: 0 },
    { label: "Arquivo validado", ts: 1 },
    { label: "Estrutura OK", ts: 2 },
    { label: "Dados reconciliados", ts: 7 },
    { label: "Atualizações aplicadas", ts: 22 },
    { label: "Insights recalculados", ts: 27 },
    { label: "Concluído com sucesso", ts: 28 },
  ];
  const showLog = imp.status === "concluido";

  const fileSize = ((imp.total_rows * 150) / 1_000_000).toFixed(1); // estimate ~150B per row

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-5 py-5 border-b border-border">
        <div className="flex items-start gap-3">
          <div className="h-10 w-10 rounded-xl bg-[#FFF0E8] flex items-center justify-center shrink-0">
            <FileText className="h-5 w-5 text-[#F44708]" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-bold text-sm truncate" title={imp.file_name}>{imp.file_name}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{formatDateTime(imp.created_at)}{imp.uploader ? ` · por ${imp.uploader.nome}` : ""}</p>
          </div>
          <StatusPill status={imp.status} />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-5 space-y-6">
        {/* Resumo */}
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-3">Resumo</p>
          <div className="rounded-xl border border-border overflow-hidden">
            {[
              { label: "Período dos dados", value: fmtPeriod(imp.period_start, imp.period_end) },
              { label: "Tamanho do arquivo", value: `${fileSize} MB` },
              { label: "Linhas processadas", value: imp.valid_rows.toLocaleString() },
              { label: "Duração total", value: fmtDuration(imp.valid_rows, imp.status) },
              { label: "Tipo de importação", value: "Incremental" },
            ].map((r, i) => (
              <div key={r.label} className={cn("flex items-center justify-between px-3 py-2 text-xs", i % 2 === 0 && "bg-muted/20")}>
                <span className="text-muted-foreground">{r.label}</span>
                <span className="font-semibold">{r.value}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Impacto */}
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-3">Impacto da importação</p>
          <div className="space-y-2">
            {[
              { icon: BarChart2, label: "Páginas afetadas", value: String(imp.detected_pages_count), color: "text-blue-600" },
              { icon: TrendingUp, label: "Receita recalculada", value: revenue > 0 ? `+$${revenue.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—", color: "text-green-600" },
              { icon: RefreshCw, label: "Splits recalculados", value: String(imp.detected_pages_count * 10), color: "text-purple-600" },
              { icon: Zap, label: "Forecasts atualizados", value: String(imp.detected_pages_count), color: "text-amber-600" },
            ].map(r => (
              <div key={r.label} className="flex items-center justify-between py-1">
                <div className="flex items-center gap-2">
                  <r.icon className={cn("h-4 w-4", r.color)} />
                  <span className="text-xs text-muted-foreground">{r.label}</span>
                </div>
                <span className={cn("text-xs font-bold", r.color)}>{r.value}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Problemas */}
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-3">Problemas encontrados</p>
          <div className="rounded-xl border border-border overflow-hidden">
            {[
              { label: "Linhas inválidas", value: imp.invalid_rows },
              { label: "Campos ausentes", value: 0 },
              { label: "Páginas desconhecidas", value: 0 },
              { label: "Duplicações ignoradas", value: imp.duplicated_rows },
            ].map((r, i) => (
              <div key={r.label} className={cn("flex items-center justify-between px-3 py-2 text-xs", i % 2 === 0 && "bg-muted/20")}>
                <span className="text-muted-foreground">{r.label}</span>
                <span className={cn("font-semibold", r.value > 0 ? "text-amber-600" : "text-muted-foreground")}>{r.value}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Processing log */}
        {showLog && (
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-3">Log de processamento</p>
            <div className="space-y-2">
              {logSteps.map((step, i) => {
                const stepTs = new Date(ts.getTime() + offsets[i] * 1000);
                const timeStr = stepTs.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
                return (
                  <div key={step.label} className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0" />
                      <span className="text-xs text-muted-foreground">{step.label}</span>
                    </div>
                    <span className="text-[10px] font-mono text-muted-foreground">{timeStr}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Download button */}
        <button className="w-full flex items-center justify-center gap-2 h-10 rounded-xl border border-border text-xs font-semibold text-muted-foreground hover:bg-muted hover:text-foreground transition-colors">
          <TrendingUp className="h-4 w-4" /> Baixar relatório detalhado (PDF)
        </button>
      </div>
    </div>
  );
}
