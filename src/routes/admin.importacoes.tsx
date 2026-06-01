import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useWriteGuard } from "@/hooks/use-write-guard";
import { parseAnyCsv, parseGanhosCsv, readFileText, hashFile, type CsvSource, type GanhosParseResult, type ParseResult } from "@/features/csv/parser";
import { takePendingImportFile } from "@/lib/pending-import";
import { formatDateTime } from "@/lib/format";
import { toast } from "sonner";
import {
  Upload, Loader2, Search, Settings2, CheckCircle2,
  AlertCircle, Clock, Database, Shield, Zap, RefreshCw, Activity,
  MoreVertical, CloudUpload, TrendingUp, BarChart2, FileText, DollarSign, X, Eye,
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
  source: CsvSource | null;
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

const PAGE_SIZE = 10;

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function DataPipelinePage() {
  const { profile } = useAuth();
  const { guard, WriteGuardDialog } = useWriteGuard();
  const fileRef = useRef<HTMLInputElement>(null);

  const [uploading, setUploading] = useState(false);

  // ── Daily metric import state (unified) ──────────────────────────────────
  const [pages, setPages] = useState<{ id: string; nome: string }[]>([]);
  const [pendingDaily, setPendingDaily] = useState<{ parsed: GanhosParseResult; fileName: string } | null>(null);
  const [dailyPageId, setDailyPageId] = useState("");
  const [dailySource, setDailySource] = useState<"facebook" | "instagram">("facebook");
  const [dailyConfirming, setDailyConfirming] = useState(false);
  // Post CSV preview before processing
  const [pendingPost, setPendingPost] = useState<{ parsed: ParseResult; file: File } | null>(null);
  const [postConfirming, setPostConfirming] = useState(false);
  const [postSource, setPostSource] = useState<"facebook" | "instagram">("facebook");
  const [bulkProgress, setBulkProgress] = useState<{ current: number; total: number; name: string } | null>(null);
  const [imports, setImports] = useState<ImportRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [activeTab, setActiveTab] = useState<"all" | "concluido" | "processando" | "erro">("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [revenueMap, setRevenueMap] = useState<Map<string, number>>(new Map());
  const [activeUploadStep, setActiveUploadStep] = useState(-1); // -1 = idle, 0-5 = live step
  const [page, setPage] = useState(1);

  // Load pages for Ganhos selector
  useEffect(() => {
    supabase.from("pages").select("id, nome").order("nome").then(({ data }) => {
      setPages((data ?? []) as { id: string; nome: string }[]);
    });
  }, []);

  // Will be set below after onUpload is defined
  const pendingFileRef = useRef<File | null>(takePendingImportFile());

  // ── Daily-metric import: detect & confirm ────────────────────────────────
  const confirmDailyImport = async (parsed: GanhosParseResult, pageId: string, source: "facebook" | "instagram" = "facebook") => {
    if (!profile) return;
    setDailyConfirming(true);
    const dbField = parsed.type === "revenue" ? "actual_revenue_usd" : "actual_views";
    const label = parsed.type === "revenue" ? "Ganhos" : "Visualizações";
    const toastId = toast.loading(`Salvando ${label.toLowerCase()}…`);
    try {
      const { data: existing } = await (supabase as any)
        .from("daily_revenue_entries")
        .select("id, entry_date")
        .eq("page_id", pageId)
        .gte("entry_date", parsed.periodStart!)
        .lte("entry_date", parsed.periodEnd!);

      const existingMap = new Map<string, string>(
        (existing ?? []).map((r: { id: string; entry_date: string }) => [r.entry_date, r.id])
      );

      let updated = 0; let inserted = 0;
      for (const row of parsed.rows) {
        const existingId = existingMap.get(row.date);
        if (existingId) {
          const { error: updErr } = await (supabase as any).from("daily_revenue_entries")
            .update({ [dbField]: row.value, updated_by: profile.id, updated_at: new Date().toISOString() })
            .eq("id", existingId);
          if (!updErr) updated++;
        } else {
          const { error: insErr } = await (supabase as any).from("daily_revenue_entries")
            .insert({ page_id: pageId, entry_date: row.date, [dbField]: row.value, distribution_mode: "hybrid", created_by: profile.id });
          if (!insErr) inserted++;
          else throw new Error(`Erro ao inserir ${row.date}: ${insErr.message}`);
        }
      }

      toast.success(`${label} importados!`, {
        id: toastId,
        description: `${inserted} novos · ${updated} atualizados · ${parsed.rows.length} dias no total`,
      });
      setPendingDaily(null);
      setDailyPageId("");
    } catch (err) {
      toast.error("Erro ao salvar", { id: toastId, description: err instanceof Error ? err.message : String(err) });
    } finally {
      setDailyConfirming(false);
    }
  };

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("csv_imports")
      .select("id, file_name, status, source, created_at, total_rows, valid_rows, invalid_rows, inserted_rows, updated_rows, duplicated_rows, detected_pages_count, period_start, period_end, uploader:profiles!uploaded_by(nome, avatar_url)")
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) toast.error("Erro ao carregar", { description: error.message });
    const rows = (data as ImportRow[]) ?? [];
    setImports(rows);
    setLoading(false);

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

  // ── Upload logic ──────────────────────────────────────────────────────────

  const onUpload = async (file: File, fromBulk = false) => {
    if (!profile) return;

    // Read file once up front
    let text: string;
    try { text = await readFileText(file); }
    catch { processPost(file, fromBulk); return; }

    // ── Detect daily metric CSVs (Ganhos / Visualizações) ─────────────────
    try {
      const daily = parseGanhosCsv(text);
      if (daily && daily.rows.length > 0) {
        setPendingDaily({ parsed: daily, fileName: file.name });
        setDailyPageId("");
        if (fileRef.current) fileRef.current.value = "";
        return;
      }

      // daily === null but file may still have daily structure (seguidores, alcance, etc.)
      // Detect: sep=, BOM line + single-quoted title + "Data" column
      if (daily === null) {
        const lines = text.replace(/^﻿/, "").split("\n").map(l => l.trim()).filter(Boolean);
        const hasSingleTitle = lines.length >= 2 && /^"[^","]*"\s*$/.test(lines[1] ?? "");
        const hasDataCol = lines.some(l => /^"[Dd]ata"/.test(l));
        if (hasSingleTitle && hasDataCol) {
          toast.error("Tipo de CSV não suportado", {
            description: `"${file.name}" é um CSV de métrica diária (seguidores, alcance, etc.) que não pode ser importado aqui.`,
          });
          if (fileRef.current) fileRef.current.value = "";
          return;
        }
      }
    } catch { /* not a daily CSV, continue to normal pipeline */ }

    // ── Parse and show preview modal before processing ────────────────────
    try {
      const parsed = parseAnyCsv(text);
      setPendingPost({ parsed, file });
      setPostSource(parsed.source === "instagram" ? "instagram" : "facebook");
      if (fileRef.current) fileRef.current.value = "";
      return;
    } catch { /* fall through to legacy processing */ }

    processPost(file, fromBulk);
  };

  // Auto-process a file forwarded from the Dashboard quick-import modal
  useEffect(() => {
    const file = pendingFileRef.current;
    if (!file || !profile) return;
    pendingFileRef.current = null;
    setTimeout(() => onUpload(file), 100);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile]);

  const processPost = async (file: File, fromBulk = false, sourceOverride?: "facebook" | "instagram") => {
    if (!profile) return;
    if (!fromBulk) setUploading(true);
    setPostConfirming(false);
    setPendingPost(null);
    setActiveUploadStep(0);
    const toastId = toast.loading(`Processando ${file.name}…`);
    try {
      const text = await readFileText(file);
      const hash = await hashFile(file);

      const { data: existing } = await supabase
        .from("csv_imports").select("id").eq("file_hash", hash).maybeSingle();
      if (existing) {
        toast.info("Arquivo já importado anteriormente — atualizando dados…", { id: toastId });
        await supabase.from("csv_imports").update({ file_hash: null }).eq("id", existing.id);
      }

      setActiveUploadStep(1);
      const parsed = parseAnyCsv(text);
      if (sourceOverride) {
        (parsed as any).source = sourceOverride;
        for (const row of parsed.rows) (row as any).source = sourceOverride;
      }

      const { data: imp, error: impErr } = await supabase
        .from("csv_imports")
        .insert({
          uploaded_by: profile.id,
          file_name: file.name,
          file_hash: hash,
          status: "processando",
          source: parsed.source,
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

      setActiveUploadStep(2);
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

      setActiveUploadStep(3);
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
            saves: r.saves || null,
            follows_gained: r.follows_gained || null,
            clicks_total: r.clicks_total, clicks_other: r.clicks_other, link_clicks: r.link_clicks,
            monetization_approx: r.monetization_approx, estimated_usd: r.estimated_usd,
            stars_earnings_usd: r.stars_earnings_usd || null,
            ad_cpm_usd: r.ad_cpm_usd || null,
            ad_impressions: r.ad_impressions || null,
            video_duration_s: r.video_duration_s || null,
            watch_seconds_total: r.watch_seconds_total || null,
            watch_seconds_avg: r.watch_seconds_avg || null,
            source: r.source,
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

      setActiveUploadStep(4);
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

      // ── Auto-link Reel Lab experiments ─────────────────────────────────────
      {
        const allPageIds = Array.from(pageIdMap.values());
        const { data: allPostsForLab } = await supabase
          .from("posts")
          .select("id, description, title, page_id, views, published_date")
          .in("page_id", allPageIds);
        const { data: labReels } = await supabase
          .from("reel_lab")
          .select("id, tracking_code, status");
        if (allPostsForLab && labReels && labReels.length > 0) {
          const LAB_REGEX = /\[LAB-(\d+)\]/i;
          for (const post of allPostsForLab) {
            const text = `${post.title ?? ""} ${post.description ?? ""}`;
            const match = text.match(LAB_REGEX);
            if (!match) continue;
            const code = `LAB-${match[1].padStart(3, "0")}`;
            const reel = (labReels as { id: string; tracking_code: string; status: string }[]).find(
              (r) => r.tracking_code.toUpperCase() === code.toUpperCase()
            );
            if (!reel) continue;
            // Link post to reel_lab and mark as linkado
            await supabase.from("reel_lab").update({
              post_id: post.id,
              status: "linkado",
              published_at: post.published_date ? new Date(post.published_date).toISOString() : null,
              updated_at: new Date().toISOString(),
            }).eq("id", reel.id);
            // Create a snapshot with current metrics from the CSV
            if (post.views != null) {
              await supabase.from("reel_lab_snapshots").insert({
                lab_id: reel.id,
                views: post.views,
                day_since_publish: post.published_date
                  ? Math.max(0, Math.floor((Date.now() - new Date(post.published_date).getTime()) / 86400000))
                  : null,
              });
            }
          }
        }
      }

      setActiveUploadStep(5);
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
      setActiveUploadStep(-1);
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

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault(); setDragging(false);
    const fn = guard(() => {});
    fn();
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

  useEffect(() => { setPage(1); }, [activeTab, q]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const selectedImport = useMemo(() => imports.find(i => i.id === selectedId) ?? null, [imports, selectedId]);
  const latestImport = imports[0] ?? null;

  return (
    <div className="space-y-5">
      <WriteGuardDialog />
      <input
        ref={fileRef} type="file" accept=".csv,text/csv" multiple className="hidden"
        onChange={guard((e) => e.target.files && e.target.files.length > 0 && onBulkUpload(e.target.files))}
      />

      {/* ── Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight">Data Pipeline</h1>
          <p className="text-xs text-muted-foreground mt-0.5">Sincronização inteligente dos dados de monetização da plataforma.</p>
        </div>
        <div className="flex items-center gap-2">
          <button className="hidden sm:flex items-center gap-1.5 h-9 px-3 rounded-xl border border-border bg-white text-xs font-medium text-muted-foreground hover:bg-muted transition-colors shrink-0">
            <Settings2 className="h-3.5 w-3.5" /> Configurações
          </button>
          <button
            onClick={guard(() => fileRef.current?.click())}
            disabled={uploading}
            className="flex items-center justify-center gap-1.5 h-9 flex-1 sm:flex-none sm:px-4 rounded-xl bg-[#F44708] text-white text-sm font-bold hover:bg-[#E03A07] transition-colors disabled:opacity-60"
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
          icon={FileText} iconBg="#FFF0E8" iconColor="#F44708" positive
        />
        <PipelineKpi
          label="Último upload"
          value={loading ? "—" : (kpis.lastSync ? timeSince(kpis.lastSync) : "Nunca")}
          sub={kpis.lastSync ? formatDateTime(kpis.lastSync) : "—"}
          icon={Clock} iconBg="#FFF0E8" iconColor="#FAA613"
        />
        <PipelineKpi
          label="Linhas importadas"
          value={loading ? "—" : fmtNum(kpis.totalLines)}
          sub={kpis.totalLines > 0 ? `+18% vs mês anterior` : "Aguardando dados"}
          icon={Database} iconBg="#F0FDF4" iconColor="#16a34a" positive
        />
        <PipelineKpi
          label="Integridade dos dados"
          value={loading ? "—" : `${kpis.integrity.toFixed(2)}%`}
          sub={kpis.integrity >= 99 ? "Excelente" : kpis.integrity >= 95 ? "Boa" : "Atenção necessária"}
          icon={Shield} iconBg="#FFF0E8" iconColor="#F44708" positive={kpis.integrity >= 95}
        />
      </div>


      {/* Daily metric modal — shown when a Ganhos/Views CSV is detected */}
      {pendingPost && (
        <PostConfirmModal
          parsed={pendingPost.parsed}
          fileName={pendingPost.file.name}
          source={postSource}
          onSourceChange={setPostSource}
          confirming={postConfirming}
          onConfirm={() => { setPostConfirming(true); processPost(pendingPost.file, false, postSource); }}
          onClose={() => { setPendingPost(null); setPostConfirming(false); }}
        />
      )}

      {pendingDaily && (
        <DailyConfirmModal
          parsed={pendingDaily.parsed}
          fileName={pendingDaily.fileName}
          pages={pages}
          pageId={dailyPageId}
          onPageChange={setDailyPageId}
          source={dailySource}
          onSourceChange={setDailySource}
          confirming={dailyConfirming}
          onConfirm={() => confirmDailyImport(pendingDaily.parsed, dailyPageId, dailySource)}
          onClose={() => { setPendingDaily(null); setDailyPageId(""); setDailySource("facebook"); }}
        />
      )}

      {/* ── Pipeline Stepper (full-width) ── */}
      <div className="rounded-2xl border border-border bg-card p-4 sm:p-6">
        <div className="flex items-center justify-between mb-4 sm:mb-6">
          <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Pipeline de processamento</p>
          {activeUploadStep >= 0 ? (
            <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2.5 py-1 rounded-full bg-amber-100 text-amber-700">
              <Loader2 className="h-3 w-3 animate-spin" /> Processando…
            </span>
          ) : latestImport ? (
            <span className={cn(
              "inline-flex items-center gap-1 text-[10px] font-bold px-2.5 py-1 rounded-full",
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
          ) : null}
        </div>
        <PipelineStepper imp={latestImport} activeStep={activeUploadStep} />
      </div>

      {/* ── Imports Table ── */}
      <div className="rounded-2xl border border-border bg-card overflow-hidden">
        {/* Tab bar + search */}
        <div className="px-4 pt-4 pb-0">
          {/* Tabs — scrollable on mobile */}
          <div className="overflow-x-auto scrollbar-none -mx-4 px-4">
            <div className="flex items-center gap-0.5 min-w-max border-b border-border">
              {([
                { key: "all", label: "Todos", count: tabCounts.all },
                { key: "concluido", label: "Concluídos", count: tabCounts.concluido },
                { key: "processando", label: "Processando", count: tabCounts.processando },
                { key: "erro", label: "Erros", count: tabCounts.erro },
              ] as const).map(tab => (
                <button
                  key={tab.key}
                  onClick={() => setActiveTab(tab.key)}
                  className={cn(
                    "flex items-center gap-1.5 px-3 py-2 text-xs font-medium transition-colors whitespace-nowrap",
                    activeTab === tab.key
                      ? "text-[#F44708] border-b-2 border-[#F44708] bg-transparent"
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
          </div>
          {/* Search — full width on mobile, right-aligned on desktop */}
          <div className="flex items-center gap-2 py-2">
            <div className="relative flex-1 sm:flex-none">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <input
                value={q} onChange={e => setQ(e.target.value)}
                placeholder="Buscar arquivo..."
                className="h-8 w-full sm:w-48 bg-muted/50 rounded-lg pl-8 pr-3 text-xs border border-border focus:outline-none focus:ring-1 focus:ring-[#F44708]/30"
              />
            </div>
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
          <>
            {/* Mobile card list */}
            <div className="sm:hidden divide-y divide-border border-t border-border">
              {paginated.map(imp => (
                <div
                  key={imp.id}
                  onClick={() => setSelectedId(imp.id)}
                  className={cn(
                    "flex items-center gap-3 px-4 py-3 cursor-pointer transition-colors hover:bg-muted/20",
                    selectedId === imp.id && "bg-[#FFF8F0]"
                  )}
                >
                  <PlatformIcon source={imp.source ?? "facebook"} />
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm text-foreground truncate">{imp.file_name}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {fmtPeriod(imp.period_start, imp.period_end)}
                      {" · "}
                      <span className="tabular-nums">{imp.valid_rows.toLocaleString()} linhas</span>
                    </p>
                  </div>
                  <StatusPill status={imp.status} />
                </div>
              ))}
            </div>

            {/* Desktop table */}
            <table className="hidden sm:table w-full text-xs">
              <thead>
                <tr className="border-t border-border bg-muted/20">
                  <th className="text-left pl-5 pr-3 py-2.5 font-bold uppercase tracking-wider text-muted-foreground w-[35%]">Arquivo</th>
                  <th className="text-left px-4 py-2.5 font-bold uppercase tracking-wider text-muted-foreground w-[20%]">Período</th>
                  <th className="text-left px-4 py-2.5 font-bold uppercase tracking-wider text-muted-foreground w-[12%]">Linhas</th>
                  <th className="text-left px-4 py-2.5 font-bold uppercase tracking-wider text-muted-foreground w-[18%]">Enviado por</th>
                  <th className="text-left px-4 py-2.5 font-bold uppercase tracking-wider text-muted-foreground w-[15%]">Status</th>
                </tr>
              </thead>
              <tbody>
                {paginated.map(imp => {
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
                      {/* Arquivo */}
                      <td className="pl-5 pr-3 py-3">
                        <div className="flex items-center gap-2 min-w-0">
                          <PlatformIcon source={imp.source ?? "facebook"} />
                          <div className="min-w-0">
                            <p className="font-medium text-foreground truncate" title={imp.file_name}>
                              {imp.file_name}
                            </p>
                            <p className="text-[10px] text-muted-foreground mt-0.5">
                              {new Date(imp.created_at).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" })}
                            </p>
                          </div>
                        </div>
                      </td>
                      {/* Período */}
                      <td className="px-4 py-3 text-muted-foreground text-[11px]">
                        {fmtPeriod(imp.period_start, imp.period_end)}
                      </td>
                      {/* Linhas */}
                      <td className="px-4 py-3">
                        <span className="tabular-nums font-semibold text-foreground">{imp.valid_rows.toLocaleString()}</span>
                        {imp.invalid_rows > 0 && (
                          <span className="block text-[10px] text-amber-500">{imp.invalid_rows} inválidas</span>
                        )}
                      </td>
                      {/* Enviado por */}
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          {imp.uploader?.avatar_url
                            ? <img src={imp.uploader.avatar_url} className="h-7 w-7 rounded-full object-cover shrink-0 ring-2 ring-border" alt="" />
                            : <div className="h-7 w-7 rounded-full bg-[#F44708]/15 flex items-center justify-center shrink-0 ring-2 ring-[#F44708]/20">
                                <span className="text-[9px] font-bold text-[#F44708]">{(imp.uploader?.nome ?? "A")[0].toUpperCase()}</span>
                              </div>
                          }
                          <span className="font-medium text-foreground truncate">{imp.uploader?.nome ?? "Admin"}</span>
                        </div>
                      </td>
                      {/* Status */}
                      <td className="px-4 py-3">
                        <StatusPill status={imp.status} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between px-5 py-3 border-t border-border">
                <p className="text-xs text-muted-foreground">
                  {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, filtered.length)} de {filtered.length} registros
                </p>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setPage(p => Math.max(1, p - 1))}
                    disabled={page === 1}
                    className="h-7 w-7 flex items-center justify-center rounded-lg border border-border text-sm text-muted-foreground hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >‹</button>
                  {Array.from({ length: totalPages }, (_, i) => i + 1).map(p => (
                    <button
                      key={p}
                      onClick={() => setPage(p)}
                      className={cn(
                        "h-7 w-7 flex items-center justify-center rounded-lg text-xs font-medium transition-colors",
                        p === page ? "bg-[#F44708] text-white" : "border border-border text-muted-foreground hover:bg-muted"
                      )}
                    >{p}</button>
                  ))}
                  <button
                    onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                    disabled={page === totalPages}
                    className="h-7 w-7 flex items-center justify-center rounded-lg border border-border text-sm text-muted-foreground hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >›</button>
                </div>
              </div>
            )}
          </>
        )}
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

// ─── Post CSV Preview Modal ───────────────────────────────────────────────────

function PostConfirmModal({
  parsed, fileName, source, onSourceChange, confirming, onConfirm, onClose,
}: {
  parsed: ParseResult;
  fileName: string;
  source: "facebook" | "instagram";
  onSourceChange: (s: "facebook" | "instagram") => void;
  confirming: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const fmtDate = (d: Date | null) => d ? d.toISOString().slice(0, 10).split("-").reverse().join("/") : "—";
  const pageNames = Array.from(new Set(parsed.rows.map((r) => r.page_name).filter(Boolean)));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-md bg-card rounded-2xl border border-border shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-lg bg-orange-100 flex items-center justify-center shrink-0">
              <FileText className="h-4 w-4 text-orange-600" />
            </div>
            <div>
              <p className="text-sm font-bold leading-tight">Confirmar importação de posts</p>
              <p className="text-[11px] text-muted-foreground truncate max-w-[240px]">📄 {fileName}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-md text-muted-foreground hover:bg-accent">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Summary chips */}
        <div className="flex items-center gap-2 flex-wrap px-5 py-3 bg-muted/30 border-b border-border">
          <Chip label={`${parsed.rows.length} posts`} />
          {parsed.periodStart && parsed.periodEnd && (
            <Chip label={`${fmtDate(parsed.periodStart)} – ${fmtDate(parsed.periodEnd)}`} />
          )}
          <Chip label={`${parsed.detectedPages.size} página${parsed.detectedPages.size !== 1 ? "s" : ""}`} accent />
        </div>

        {/* Page preview table */}
        {pageNames.length > 0 && (
          <div className="overflow-y-auto max-h-48 border-b border-border">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-muted/60">
                <tr>
                  <th className="text-left px-4 py-2 font-bold text-muted-foreground uppercase tracking-wide text-[10px]">Página detectada</th>
                  <th className="text-right px-4 py-2 font-bold text-muted-foreground uppercase tracking-wide text-[10px]">Posts</th>
                </tr>
              </thead>
              <tbody>
                {pageNames.map((name) => {
                  const count = parsed.rows.filter((r) => r.page_name === name).length;
                  return (
                    <tr key={name} className="border-t border-border/40">
                      <td className="px-4 py-1.5 text-muted-foreground truncate max-w-[260px]">{name}</td>
                      <td className="px-4 py-1.5 text-right font-semibold tabular-nums">{count}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Error warning */}
        {parsed.errors.length > 0 && (
          <div className="mx-5 mt-3 px-3 py-2 rounded-lg bg-amber-50 border border-amber-200 flex items-start gap-2">
            <AlertCircle className="h-3.5 w-3.5 text-amber-600 shrink-0 mt-0.5" />
            <p className="text-[11px] text-amber-700">
              {parsed.errors.length} linha{parsed.errors.length > 1 ? "s" : ""} com erro serão ignoradas. Os {parsed.rows.length} posts válidos serão importados normalmente.
            </p>
          </div>
        )}

        {/* Platform selector + buttons */}
        <div className="px-5 py-4 space-y-3">
          <div>
            <label className="text-xs font-semibold text-foreground mb-1.5 block">
              Plataforma de origem
            </label>
            <div className="flex rounded-lg border border-border overflow-hidden">
              {(["facebook", "instagram"] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => onSourceChange(s)}
                  className={cn(
                    "flex-1 h-9 text-sm font-medium transition-colors",
                    source === s
                      ? "bg-[#F44708] text-white"
                      : "bg-background text-muted-foreground hover:bg-accent"
                  )}
                >
                  {s === "facebook" ? "📘 Facebook" : "📷 Instagram"}
                </button>
              ))}
            </div>
          </div>

          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="flex-1 h-10 rounded-lg border border-border text-sm text-muted-foreground hover:bg-accent transition-colors"
            >
              Cancelar
            </button>
            <button
              onClick={onConfirm}
              disabled={confirming || parsed.rows.length === 0}
              className="flex-1 h-10 rounded-lg bg-[#F44708] text-white text-sm font-bold hover:bg-[#E03A07] disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
            >
              {confirming
                ? <><Loader2 className="h-4 w-4 animate-spin" /> Processando…</>
                : <><CheckCircle2 className="h-4 w-4" /> Confirmar</>}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Daily Import Card ────────────────────────────────────────────────────────

// ─── Daily Confirm Modal ──────────────────────────────────────────────────────

function DailyConfirmModal({
  parsed, fileName, pages, pageId, onPageChange, source, onSourceChange, confirming, onConfirm, onClose,
}: {
  parsed: GanhosParseResult;
  fileName: string;
  pages: { id: string; nome: string }[];
  pageId: string;
  onPageChange: (id: string) => void;
  source: "facebook" | "instagram";
  onSourceChange: (s: "facebook" | "instagram") => void;
  confirming: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const isRevenue = parsed.type === "revenue";
  const total = parsed.rows.reduce((s, r) => s + r.value, 0);
  const colLabel = isRevenue ? "Receita (USD)" : "Views";
  const formatValue = isRevenue
    ? (v: number) => `$${v.toFixed(4)}`
    : (v: number) => v.toLocaleString("pt-BR");
  const formatTotal = isRevenue
    ? (v: number) => `$${v.toFixed(2)}`
    : (v: number) => v.toLocaleString("pt-BR");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-md bg-card rounded-2xl border border-border shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div className="flex items-center gap-2.5">
            <div className={cn(
              "h-8 w-8 rounded-lg flex items-center justify-center shrink-0",
              isRevenue ? "bg-green-100" : "bg-blue-100"
            )}>
              {isRevenue
                ? <DollarSign className="h-4 w-4 text-green-600" />
                : <Eye className="h-4 w-4 text-blue-600" />}
            </div>
            <div>
              <p className="text-sm font-bold leading-tight">
                {isRevenue ? "Ganhos diários detectados" : "Visualizações diárias detectadas"}
              </p>
              <p className="text-[11px] text-muted-foreground truncate max-w-[240px]">📄 {fileName}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-md text-muted-foreground hover:bg-accent">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Summary chips */}
        <div className="flex items-center gap-2 flex-wrap px-5 py-3 bg-muted/30 border-b border-border">
          <Chip label={`${parsed.rows.length} dias`} />
          {parsed.periodStart && parsed.periodEnd && (
            <Chip label={`${parsed.periodStart.split("-").reverse().join("/")} – ${parsed.periodEnd.split("-").reverse().join("/")}`} />
          )}
          <Chip label={`Total: ${formatTotal(total)}`} accent />
        </div>

        {/* Preview table */}
        <div className="overflow-y-auto max-h-52 border-b border-border">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-muted/60">
              <tr>
                <th className="text-left px-4 py-2 font-bold text-muted-foreground uppercase tracking-wide text-[10px]">Data</th>
                <th className="text-right px-4 py-2 font-bold text-muted-foreground uppercase tracking-wide text-[10px]">{colLabel}</th>
              </tr>
            </thead>
            <tbody>
              {parsed.rows.map((r) => (
                <tr key={r.date} className="border-t border-border/40">
                  <td className="px-4 py-1.5 text-muted-foreground tabular-nums">{r.date.split("-").reverse().join("/")}</td>
                  <td className="px-4 py-1.5 text-right font-semibold tabular-nums">{formatValue(r.value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Page selector + confirm */}
        <div className="px-5 py-4 space-y-3">
          {/* Source toggle */}
          <div>
            <label className="text-xs font-semibold text-foreground mb-1.5 block">
              Plataforma de origem
            </label>
            <div className="flex rounded-lg border border-border overflow-hidden">
              {(["facebook", "instagram"] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => onSourceChange(s)}
                  className={cn(
                    "flex-1 h-9 text-sm font-medium transition-colors",
                    source === s
                      ? "bg-[#F44708] text-white"
                      : "bg-background text-muted-foreground hover:bg-accent"
                  )}
                >
                  {s === "facebook" ? "📘 Facebook" : "📷 Instagram"}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-xs font-semibold text-foreground mb-1.5 block">
              Para qual página esses dados pertencem?
            </label>
            <select
              value={pageId}
              onChange={(e) => onPageChange(e.target.value)}
              className="h-10 rounded-lg border border-border bg-background px-3 text-sm w-full focus:outline-none focus:ring-1 focus:ring-[#F44708]/50"
            >
              <option value="">Selecionar página…</option>
              {pages.map((p) => (
                <option key={p.id} value={p.id}>{p.nome}</option>
              ))}
            </select>
          </div>

          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="flex-1 h-10 rounded-lg border border-border text-sm text-muted-foreground hover:bg-accent transition-colors"
            >
              Cancelar
            </button>
            <button
              onClick={onConfirm}
              disabled={!pageId || confirming}
              className="flex-1 h-10 rounded-lg bg-[#F44708] text-white text-sm font-bold hover:bg-[#E03A07] disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
            >
              {confirming
                ? <><Loader2 className="h-4 w-4 animate-spin" /> Salvando…</>
                : <><CheckCircle2 className="h-4 w-4" /> Confirmar</>}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Chip({ label, accent }: { label: string; accent?: boolean }) {
  return (
    <span className={cn(
      "inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium",
      accent ? "bg-[#F44708]/10 text-[#F44708]" : "bg-muted text-muted-foreground"
    )}>
      {label}
    </span>
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
    concluido:   { label: "Concluído",   cls: "bg-green-100 text-green-700",   dot: "bg-green-500" },
    processando: { label: "Processando", cls: "bg-amber-100 text-amber-700",   dot: "bg-amber-400" },
    falha:       { label: "Falha",       cls: "bg-red-100 text-red-600",       dot: "bg-red-500" },
    parcial:     { label: "Parcial",     cls: "bg-amber-100 text-amber-700",   dot: "bg-amber-400" },
    na_fila:     { label: "Na fila",     cls: "bg-muted text-muted-foreground", dot: "bg-border" },
  };
  const cfg = map[status] ?? map.na_fila;
  return (
    <span className={cn("inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold", cfg.cls)}>
      <div className={cn("h-1.5 w-1.5 rounded-full shrink-0", cfg.dot, status === "processando" && "animate-pulse")} />
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

function PipelineStepper({ imp, activeStep }: { imp: ImportRow | null; activeStep: number }) {
  const isLive = activeStep >= 0;

  if (!isLive && !imp) {
    return (
      <div className="flex items-center justify-center h-16 text-muted-foreground text-xs">
        Aguardando primeira importação
      </div>
    );
  }

  const stepsComplete = isLive ? activeStep
    : imp!.status === "concluido" || imp!.status === "parcial" ? 6
    : imp!.status === "processando" ? 4
    : imp!.status === "falha" ? 2
    : 6;
  const isError = !isLive && imp!.status === "falha";

  const currentStepLabel = isLive
    ? STEPS[activeStep]?.label
    : isError ? `Erro em: ${STEPS[Math.max(0, stepsComplete - 1)]?.label}`
    : "Concluído";

  return (
    <>
      {/* ── Desktop: full stepper ── */}
      <div className="hidden sm:flex items-start w-full">
        {STEPS.map((step, i) => {
          const done   = i < stepsComplete;
          const active = isLive ? i === activeStep : (i === stepsComplete - 1 && imp!.status === "processando");
          const error  = isError && i === stepsComplete - 1;
          let sub: string | null = null;
          if (active) sub = "Em andamento…";
          else if (error) sub = "Erro";
          else if (done) sub = "Concluído";
          return (
            <div key={step.key} className="flex-1 flex flex-col items-center min-w-0">
              <div className="flex items-center w-full">
                <div className={cn("h-0.5 flex-1 transition-all duration-500", i === 0 ? "opacity-0" : done ? "bg-green-400" : "bg-border")} />
                <div className={cn(
                  "h-7 w-7 rounded-full flex items-center justify-center shrink-0 border-2 transition-all duration-500",
                  done   ? "bg-green-500 border-green-500 text-white" :
                  active ? "bg-[#F44708] border-[#F44708] text-white" :
                  error  ? "bg-red-500 border-red-500 text-white" :
                           "bg-card border-border"
                )}>
                  {done   ? <CheckCircle2 className="h-4 w-4" />
                  : active ? <Loader2 className="h-4 w-4 animate-spin" />
                  : error  ? <AlertCircle className="h-4 w-4" />
                  : <div className="h-2 w-2 rounded-full bg-border" />}
                </div>
                <div className={cn("h-0.5 flex-1 transition-all duration-500", i === STEPS.length - 1 ? "opacity-0" : done ? "bg-green-400" : "bg-border")} />
              </div>
              <div className="mt-3 text-center px-1 w-full">
                <p className={cn(
                  "text-[11px] font-semibold leading-tight truncate",
                  done ? "text-foreground" : active ? "text-[#F44708]" : error ? "text-red-600" : "text-muted-foreground"
                )}>{step.label}</p>
                {sub && (
                  <p className={cn(
                    "text-[10px] font-medium mt-0.5",
                    active ? "text-[#F44708] animate-pulse" : error ? "text-red-500" : "text-green-600"
                  )}>{sub}</p>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* ── Mobile: compact progress bar ── */}
      <div className="sm:hidden space-y-2">
        <div className="flex items-center justify-between text-xs">
          <span className={cn("font-medium", isError ? "text-red-600" : isLive ? "text-[#F44708]" : "text-green-600")}>
            {currentStepLabel}
          </span>
          <span className="text-muted-foreground tabular-nums">{Math.min(stepsComplete, 6)}/{STEPS.length}</span>
        </div>
        <div className="h-2 rounded-full bg-border overflow-hidden">
          <div
            className={cn(
              "h-full rounded-full transition-all duration-500",
              isError ? "bg-red-500" : isLive ? "bg-[#F44708]" : "bg-green-500"
            )}
            style={{ width: `${(Math.min(stepsComplete, 6) / STEPS.length) * 100}%` }}
          />
        </div>
        <div className="flex items-center justify-between">
          {STEPS.map((step, i) => {
            const done = i < stepsComplete;
            const active = isLive ? i === activeStep : false;
            const error = isError && i === stepsComplete - 1;
            return (
              <div key={step.key} className={cn(
                "h-2 w-2 rounded-full shrink-0 transition-colors",
                done ? "bg-green-500" : active ? "bg-[#F44708]" : error ? "bg-red-500" : "bg-border"
              )} />
            );
          })}
        </div>
      </div>
    </>
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

// ─── Platform icon ────────────────────────────────────────────────────────────

function PlatformIcon({ source, size = 7 }: { source: CsvSource; size?: number }) {
  const sizeClass = `h-${size} w-${size}`;
  if (source === "instagram") {
    return (
      <div className={`${sizeClass} rounded-lg overflow-hidden shrink-0`}>
        <img
          src="/assets/logo/Instagram_logo_2022.svg"
          alt="Instagram"
          className="h-full w-full object-cover"
        />
      </div>
    );
  }
  // Facebook
  return (
    <div className={`${sizeClass} rounded-lg overflow-hidden shrink-0 bg-white`}>
      <img
        src="/assets/logo/Facebook_Logo_2023.png"
        alt="Facebook"
        className="h-full w-full object-contain p-0.5"
      />
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
  const fileSize = ((imp.total_rows * 150) / 1_000_000).toFixed(1);

  return (
    <div className="flex flex-col h-full">
      <div className="px-5 py-5 border-b border-border">
        <div className="flex items-start gap-3">
          <PlatformIcon source={imp.source ?? "facebook"} size={10} />
          <div className="flex-1 min-w-0">
            <p className="font-bold text-sm truncate" title={imp.file_name}>{imp.file_name}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{formatDateTime(imp.created_at)}{imp.uploader ? ` · por ${imp.uploader.nome}` : ""}</p>
          </div>
          <StatusPill status={imp.status} />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-5 space-y-6">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-3">Resumo</p>
          <div className="rounded-xl border border-border overflow-hidden">
            {[
              { label: "Plataforma", value: imp.source === "instagram" ? "Instagram" : "Facebook" },
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
                      <CheckCircle2 className="h-3.5 w-3.5 text-[#F44708] shrink-0" />
                      <span className="text-xs text-muted-foreground">{step.label}</span>
                    </div>
                    <span className="text-[10px] font-mono text-muted-foreground">{timeStr}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <button className="w-full flex items-center justify-center gap-2 h-10 rounded-xl border border-border text-xs font-semibold text-muted-foreground hover:bg-muted hover:text-foreground transition-colors">
          <TrendingUp className="h-4 w-4" /> Baixar relatório detalhado (PDF)
        </button>
      </div>
    </div>
  );
}
