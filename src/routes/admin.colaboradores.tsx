import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/app/PageHeader";
import { EmptyState } from "@/components/app/EmptyState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import {
  Users, Plus, Loader2, Hash, Trash2, Camera, UserCircle,
  Search, MoreVertical, Flame, CheckCircle2, MessageSquare,
} from "lucide-react";

export const Route = createFileRoute("/admin/colaboradores")({
  head: () => ({ meta: [{ title: "Colaboradores - Splash Creators" }] }),
  component: Page,
});

interface Col {
  id: string;
  nome: string;
  email: string | null;
  hashtag: string | null;
  avatar_url: string | null;
  ativo: boolean;
  categoria: string | null;
  post_count: number;
  total_views: number;
  total_reactions: number;
  total_comments: number;
  sparkline: number[]; // views per month, last 6 months (index 0 = oldest)
}

interface PostLite {
  id: string;
  title: string | null;
  description: string | null;
}

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, "")}K`;
  return String(n);
}

function normalizeHashtag(raw: string): string {
  return raw.replace(/^#+/, "").trim().toLowerCase();
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function fetchAllRows<T>(query: () => ReturnType<typeof supabase.from>): Promise<T[]> {
  const PAGE = 1000;
  let from = 0;
  const all: T[] = [];
  while (true) {
    const { data, error } = await (query() as any).range(from, from + PAGE - 1);
    if (error || !data || data.length === 0) break;
    all.push(...data);
    if (data.length < PAGE) break;
    from += data.length;
  }
  return all;
}

async function rematchCollaboratorPosts(collaboratorId: string, hashtag: string): Promise<number> {
  const normalized = normalizeHashtag(hashtag);
  await supabase.from("post_authors").delete().eq("collaborator_id", collaboratorId).eq("source", "hashtag");
  if (!normalized) return 0;
  const posts = await fetchAllRows<PostLite>(() =>
    supabase.from("posts").select("id, title, description")
  );
  const regex = new RegExp(`#${escapeRegex(normalized)}(?![a-z0-9_])`, "i");
  const matches = posts
    .filter((post) => regex.test(`${post.title ?? ""} ${post.description ?? ""}`.toLowerCase()))
    .map((post) => ({ post_id: post.id, collaborator_id: collaboratorId, source: "hashtag" }));
  const CHUNK = 500;
  for (let i = 0; i < matches.length; i += CHUNK) {
    await supabase.from("post_authors").upsert(matches.slice(i, i + CHUNK), { onConflict: "post_id,collaborator_id", ignoreDuplicates: true });
  }
  return matches.length;
}

// Sparkline SVG component
function Sparkline({ data }: { data: number[] }) {
  if (data.length < 2 || data.every((v) => v === 0)) return <div style={{ width: 100, height: 32 }} />;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const W = 100, H = 32;
  const pts = data
    .map((v, i) => `${(i / (data.length - 1)) * W},${H - 4 - ((v - min) / range) * (H - 10)}`)
    .join(" ");
  return (
    <svg width={W} height={H} className="overflow-visible">
      <polyline points={pts} fill="none" stroke="#f97316" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

// Rank badge
function RankBadge({ rank }: { rank: number }) {
  if (rank === 1) return (
    <div className="w-7 h-7 rounded-full bg-orange-500 flex items-center justify-center shrink-0">
      <span className="text-white font-bold text-xs">{rank}</span>
    </div>
  );
  if (rank === 2) return (
    <div className="w-7 h-7 rounded-full bg-slate-400 flex items-center justify-center shrink-0">
      <span className="text-white font-bold text-xs">{rank}</span>
    </div>
  );
  if (rank === 3) return (
    <div className="w-7 h-7 rounded-full bg-amber-600 flex items-center justify-center shrink-0">
      <span className="text-white font-bold text-xs">{rank}</span>
    </div>
  );
  return (
    <div className="w-7 h-7 rounded-full bg-muted flex items-center justify-center shrink-0">
      <span className="text-muted-foreground font-medium text-xs">{rank}</span>
    </div>
  );
}

// Deterministic color per hashtag
const PILL_COLORS = [
  "bg-orange-100 text-orange-700",
  "bg-violet-100 text-violet-700",
  "bg-green-100 text-green-700",
  "bg-blue-100 text-blue-700",
  "bg-pink-100 text-pink-700",
  "bg-teal-100 text-teal-700",
  "bg-yellow-100 text-yellow-700",
  "bg-red-100 text-red-700",
];
function hashtagColor(tag: string): string {
  let h = 0;
  for (const c of tag) h = (h * 31 + c.charCodeAt(0)) & 0xffffffff;
  return PILL_COLORS[Math.abs(h) % PILL_COLORS.length];
}

function ColabAvatar({ nome, avatarUrl, size = 44 }: { nome: string; avatarUrl?: string | null; size?: number }) {
  if (avatarUrl) {
    return (
      <img src={avatarUrl} alt={nome} width={size} height={size}
        style={{ width: size, height: size, borderRadius: "50%", objectFit: "cover", display: "block", flexShrink: 0 }} />
    );
  }
  const initials = nome.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase();
  return (
    <div style={{ width: size, height: size, flexShrink: 0 }}
      className="rounded-full bg-muted flex items-center justify-center shrink-0 text-muted-foreground font-semibold text-sm">
      {initials || <UserCircle style={{ width: size * 0.6, height: size * 0.6 }} />}
    </div>
  );
}

function Page() {
  const { profile } = useAuth();
  const isAdmin = profile?.role === "admin";

  const [rows, setRows] = useState<Col[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"todos" | "ativos" | "em-alta">("todos");
  const [q, setQ] = useState("");

  // Form state
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [nome, setNome] = useState("");
  const [hashtag, setHashtag] = useState("");
  const [categoria, setCategoria] = useState("");
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [currentAvatarUrl, setCurrentAvatarUrl] = useState<string | null>(null);
  const [originalHashtag, setOriginalHashtag] = useState("");
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Col | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data: cols, error } = await supabase
      .from("collaborators")
      .select("id, nome, email, hashtag, avatar_url, ativo, categoria")
      .order("nome");
    if (error || !cols) { setLoading(false); return; }

    const ids = cols.map((c) => c.id);
    const paRows = await fetchAllRows<{
      collaborator_id: string;
      posts: { views: number | null; reactions: number | null; comments: number | null; published_at: string | null } | null;
    }>(() =>
      supabase.from("post_authors")
        .select("collaborator_id, posts(views, reactions, comments, published_at)")
        .in("collaborator_id", ids)
    );

    const now = new Date();
    const metricsMap: Record<string, {
      post_count: number; total_views: number; total_reactions: number; total_comments: number;
      months: number[]; // views per month slot (0=5mo ago … 5=current)
    }> = {};

    for (const row of paRows) {
      const cid = row.collaborator_id;
      if (!metricsMap[cid]) metricsMap[cid] = { post_count: 0, total_views: 0, total_reactions: 0, total_comments: 0, months: Array(6).fill(0) };
      const m = metricsMap[cid];
      m.post_count++;
      const v = row.posts?.views ?? 0;
      m.total_views += v;
      m.total_reactions += row.posts?.reactions ?? 0;
      m.total_comments += row.posts?.comments ?? 0;
      const pub = row.posts?.published_at;
      if (pub && v > 0) {
        const d = new Date(pub);
        const mAgo = (now.getFullYear() - d.getFullYear()) * 12 + (now.getMonth() - d.getMonth());
        if (mAgo >= 0 && mAgo < 6) m.months[5 - mAgo] += v;
      }
    }

    const built: Col[] = cols.map((c) => {
      const m = metricsMap[c.id] ?? { post_count: 0, total_views: 0, total_reactions: 0, total_comments: 0, months: Array(6).fill(0) };
      return { ...c, categoria: c.categoria ?? null, post_count: m.post_count, total_views: m.total_views, total_reactions: m.total_reactions, total_comments: m.total_comments, sparkline: m.months };
    });

    setRows(built);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  // Sort by views desc for ranking
  const sorted = [...rows].sort((a, b) => b.total_views - a.total_views);

  // "Em alta": last 2 months views > prior 2 months
  const emAltaIds = new Set(
    sorted
      .filter((r) => {
        const recent = r.sparkline[4] + r.sparkline[5];
        const prior = r.sparkline[2] + r.sparkline[3];
        return recent > prior && recent > 0;
      })
      .map((r) => r.id)
  );

  const filtered = sorted.filter((r) => {
    if (tab === "ativos" && !r.ativo) return false;
    if (tab === "em-alta" && !emAltaIds.has(r.id)) return false;
    if (q && !r.nome.toLowerCase().includes(q.toLowerCase()) && !(r.hashtag ?? "").includes(q.toLowerCase())) return false;
    return true;
  });

  // Max values for orange highlight
  const maxViews = Math.max(...filtered.map((r) => r.total_views), 0);
  const maxReactions = Math.max(...filtered.map((r) => r.total_reactions), 0);
  const maxComments = Math.max(...filtered.map((r) => r.total_comments), 0);

  const openNew = () => {
    setEditId(null); setNome(""); setHashtag(""); setCategoria(""); setOriginalHashtag("");
    setAvatarFile(null); setAvatarPreview(null); setCurrentAvatarUrl(null); setShowForm(true);
  };
  const openEdit = (r: Col) => {
    setEditId(r.id); setNome(r.nome); setHashtag(r.hashtag ?? ""); setCategoria(r.categoria ?? "");
    setOriginalHashtag(r.hashtag ?? ""); setAvatarFile(null); setAvatarPreview(null);
    setCurrentAvatarUrl(r.avatar_url ?? null); setShowForm(true);
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!hashtag.trim()) { toast.error("Informe a hashtag do colaborador"); return; }
    setSaving(true);
    const tag = normalizeHashtag(hashtag);
    try {
      let collaboratorId = editId;
      if (editId) {
        const { error } = await supabase.from("collaborators").update({ nome, hashtag: tag, categoria: categoria || null }).eq("id", editId);
        if (error) throw error;
      } else {
        const { data, error } = await supabase.from("collaborators").insert({ nome, hashtag: tag, categoria: categoria || null, ativo: true }).select("id").single();
        if (error || !data) throw error ?? new Error("Falha ao criar colaborador");
        collaboratorId = data.id;
      }
      if (!collaboratorId) throw new Error("Colaborador inválido");

      if (avatarFile) {
        try {
          const ext = avatarFile.name.split(".").pop()?.toLowerCase() || "jpg";
          const path = `collaborators/${collaboratorId}.${ext}`;
          await Promise.allSettled(["jpg", "jpeg", "png", "webp", "gif"].map((e) =>
            supabase.storage.from("avatars").remove([`collaborators/${collaboratorId}.${e}`])
          ));
          const { error: uploadError } = await supabase.storage.from("avatars").upload(path, avatarFile, { upsert: true, contentType: avatarFile.type });
          if (!uploadError) {
            const { data: { publicUrl } } = supabase.storage.from("avatars").getPublicUrl(path);
            await supabase.from("collaborators").update({ avatar_url: `${publicUrl}?v=${Date.now()}` }).eq("id", collaboratorId);
          } else {
            toast.warning("Foto não salva", { description: uploadError.message });
          }
        } catch { toast.warning("Foto não salva", { description: "Erro ao fazer upload." }); }
      }

      const hashtagChanged = !editId || normalizeHashtag(originalHashtag) !== tag;
      if (hashtagChanged) {
        const tid = toast.loading("Reprocessando posts por hashtag...");
        const n = await rematchCollaboratorPosts(collaboratorId, tag);
        toast.success("Colaborador salvo", { id: tid, description: `${n.toLocaleString("pt-BR")} posts vinculados por #${tag}` });
      } else {
        toast.success(avatarFile ? "Foto atualizada" : "Colaborador atualizado");
      }
      setShowForm(false); setEditId(null);
      await load();
    } catch (err) {
      toast.error("Erro", { description: err instanceof Error ? err.message : "Erro desconhecido" });
    } finally { setSaving(false); }
  };

  const toggleAtivo = async (r: Col) => {
    await supabase.from("collaborators").update({ ativo: !r.ativo }).eq("id", r.id);
    await load();
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await supabase.from("post_authors").delete().eq("collaborator_id", deleteTarget.id);
      const { error } = await supabase.from("collaborators").delete().eq("id", deleteTarget.id);
      if (error) throw error;
      toast.success(`${deleteTarget.nome} removido`);
      setDeleteTarget(null);
      await load();
    } catch (err) {
      toast.error("Erro ao deletar", { description: err instanceof Error ? err.message : "Erro desconhecido" });
    } finally { setDeleting(false); }
  };

  return (
    <div>
      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => { if (!o) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Deletar {deleteTarget?.nome}?</AlertDialogTitle>
            <AlertDialogDescription>Todos os vínculos de posts serão removidos. Esta ação não pode ser desfeita.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} disabled={deleting} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {deleting && <Loader2 className="h-4 w-4 animate-spin mr-2" />}Deletar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <PageHeader
        title="Colaboradores"
        description="Cadastre hashtags e o sistema vincula posts antigos e novos automaticamente."
        actions={isAdmin ? (
          <Button onClick={openNew} className="gap-2">
            <Plus className="h-4 w-4" />Novo colaborador
          </Button>
        ) : undefined}
      />

      {/* Form */}
      {isAdmin && showForm && (
        <form onSubmit={onSubmit} className="bg-card border border-border rounded-lg p-5 mb-6 space-y-4">
          <h3 className="font-medium">{editId ? "Editar colaborador" : "Novo colaborador"}</h3>
          <div className="flex items-center gap-4">
            <button type="button" onClick={() => avatarInputRef.current?.click()}
              className="relative group h-16 w-16 rounded-full overflow-hidden border-2 border-dashed border-border hover:border-primary transition-colors bg-muted flex items-center justify-center shrink-0">
              {avatarPreview || currentAvatarUrl ? (
                <img src={avatarPreview ?? currentAvatarUrl!} alt="Avatar" className="w-full h-full object-cover" />
              ) : <Camera className="h-6 w-6 text-muted-foreground group-hover:text-primary transition-colors" />}
              <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                <Camera className="h-5 w-5 text-white" />
              </div>
            </button>
            <input ref={avatarInputRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0]; if (!file) return;
                setAvatarFile(file); setAvatarPreview(URL.createObjectURL(file));
              }} />
            <div>
              <p className="text-sm font-medium">Foto de perfil</p>
              <p className="text-xs text-muted-foreground">
                {avatarPreview ? "Nova foto selecionada" : currentAvatarUrl ? "Clique para trocar" : "JPG, PNG ou WebP · máx 5 MB"}
              </p>
              {avatarPreview && (
                <button type="button" className="text-xs text-destructive mt-1 hover:underline"
                  onClick={() => { setAvatarFile(null); setAvatarPreview(null); if (avatarInputRef.current) avatarInputRef.current.value = ""; }}>
                  Remover
                </button>
              )}
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <Label>Nome</Label>
              <Input required value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex: Matheus" />
            </div>
            <div>
              <Label>Hashtag</Label>
              <div className="relative">
                <Hash className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input required value={hashtag} onChange={(e) => setHashtag(e.target.value)} placeholder="matheus" className="pl-9" />
              </div>
            </div>
            <div>
              <Label>Categoria</Label>
              <Input value={categoria} onChange={(e) => setCategoria(e.target.value)} placeholder="Ex: Marketing & Creator" />
            </div>
          </div>
          <div className="flex gap-2">
            <Button type="submit" disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 animate-spin mr-2" />}Salvar
            </Button>
            <Button type="button" variant="outline" onClick={() => { setShowForm(false); setEditId(null); setAvatarFile(null); setAvatarPreview(null); }}>
              Cancelar
            </Button>
          </div>
        </form>
      )}

      {/* Tabs + search */}
      <div className="flex items-center justify-between gap-4 mb-4 flex-wrap">
        <div className="flex items-center gap-1.5">
          {[
            { key: "todos", label: "Todos", icon: Users, count: rows.length },
            { key: "ativos", label: "Ativos", icon: CheckCircle2, count: rows.filter((r) => r.ativo).length },
            { key: "em-alta", label: "Em alta", icon: Flame, count: emAltaIds.size },
          ].map(({ key, label, icon: Icon, count }) => (
            <button
              key={key}
              onClick={() => setTab(key as typeof tab)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                tab === key
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
              <span className={`text-xs font-semibold px-1.5 py-0.5 rounded-full ${tab === key ? "bg-primary/20" : "bg-muted"}`}>
                {count}
              </span>
            </button>
          ))}
        </div>
        <div className="relative w-64">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Buscar colaborador..." value={q} onChange={(e) => setQ(e.target.value)} className="pl-9" />
        </div>
      </div>

      {/* Table */}
      <div className="bg-card border border-border rounded-lg overflow-hidden">
        {loading ? (
          <div className="p-10 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : filtered.length === 0 ? (
          <div className="p-6"><EmptyState icon={Users} title="Nenhum colaborador encontrado" description="Tente mudar o filtro ou a busca." /></div>
        ) : (
          <>
            {/* Desktop table */}
            <div className="hidden sm:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 border-b border-border">
                  <tr>
                    <th className="text-left px-5 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Colaborador</th>
                    <th className="text-right px-4 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Posts</th>
                    <th className="text-right px-4 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Views</th>
                    <th className="text-right px-4 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Curtidas</th>
                    <th className="text-right px-4 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Comentários</th>
                    <th className="text-center px-4 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Performance</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Status</th>
                    {isAdmin && <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Ações</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {filtered.map((r) => {
                    const rank = sorted.indexOf(r) + 1;
                    const color = hashtagColor(r.hashtag ?? r.nome);
                    return (
                      <tr key={r.id} className="hover:bg-muted/20 transition-colors">
                        {/* Colaborador */}
                        <td className="px-5 py-3">
                          <div className="flex items-center gap-3">
                            <RankBadge rank={rank} />
                            <ColabAvatar nome={r.nome} avatarUrl={r.avatar_url} size={44} />
                            <div>
                              <p className="font-semibold">{r.nome}</p>
                              {r.hashtag && (
                                <span className={`text-xs font-mono font-medium px-2 py-0.5 rounded-md ${color}`}>
                                  #{r.hashtag}
                                </span>
                              )}
                              {r.categoria && (
                                <div className="flex items-center gap-1 mt-0.5">
                                  <MessageSquare className="h-3 w-3 text-muted-foreground" />
                                  <span className="text-xs text-muted-foreground">{r.categoria}</span>
                                </div>
                              )}
                            </div>
                          </div>
                        </td>
                        {/* Posts */}
                        <td className="px-4 py-3 text-right tabular-nums">
                          <span className="font-semibold">{fmt(r.post_count)}</span>
                          <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Posts</div>
                        </td>
                        {/* Views */}
                        <td className="px-4 py-3 text-right tabular-nums">
                          <span className={`font-semibold ${r.total_views === maxViews && maxViews > 0 ? "text-orange-500" : ""}`}>
                            {fmt(r.total_views)}
                          </span>
                          <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Views</div>
                        </td>
                        {/* Curtidas */}
                        <td className="px-4 py-3 text-right tabular-nums">
                          <span className={`font-semibold ${r.total_reactions === maxReactions && maxReactions > 0 ? "text-orange-500" : ""}`}>
                            {fmt(r.total_reactions)}
                          </span>
                          <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Curtidas</div>
                        </td>
                        {/* Comentários */}
                        <td className="px-4 py-3 text-right tabular-nums">
                          <span className={`font-semibold ${r.total_comments === maxComments && maxComments > 0 ? "text-orange-500" : ""}`}>
                            {fmt(r.total_comments)}
                          </span>
                          <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Comentários</div>
                        </td>
                        {/* Sparkline */}
                        <td className="px-4 py-3">
                          <div className="flex justify-center">
                            <Sparkline data={r.sparkline} />
                          </div>
                        </td>
                        {/* Status */}
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-full ${r.ativo ? "bg-green-500/10 text-green-600" : "bg-muted text-muted-foreground"}`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${r.ativo ? "bg-green-500" : "bg-muted-foreground"}`} />
                            {r.ativo ? "Ativo" : "Inativo"}
                          </span>
                        </td>
                        {/* Actions */}
                        {isAdmin && (
                          <td className="px-4 py-3">
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                                  <MoreVertical className="h-4 w-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem onClick={() => openEdit(r)}>Editar</DropdownMenuItem>
                                <DropdownMenuItem onClick={() => toggleAtivo(r)}>
                                  {r.ativo ? "Desativar" : "Ativar"}
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem onClick={() => setDeleteTarget(r)} className="text-destructive focus:text-destructive">
                                  <Trash2 className="h-4 w-4 mr-2" />Deletar
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Mobile cards */}
            <div className="sm:hidden divide-y divide-border">
              {filtered.map((r) => {
                const rank = sorted.indexOf(r) + 1;
                const color = hashtagColor(r.hashtag ?? r.nome);
                return (
                  <div key={r.id} className="px-4 py-4 space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <RankBadge rank={rank} />
                        <ColabAvatar nome={r.nome} avatarUrl={r.avatar_url} size={40} />
                        <div className="min-w-0">
                          <p className="font-semibold truncate">{r.nome}</p>
                          <div className="flex items-center gap-1.5 flex-wrap mt-0.5">
                            {r.hashtag && <span className={`text-xs font-mono font-medium px-2 py-0.5 rounded-md ${color}`}>#{r.hashtag}</span>}
                            {r.categoria && <span className="text-xs text-muted-foreground">{r.categoria}</span>}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${r.ativo ? "bg-green-500/10 text-green-600" : "bg-muted text-muted-foreground"}`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${r.ativo ? "bg-green-500" : "bg-muted-foreground"}`} />
                          {r.ativo ? "Ativo" : "Inativo"}
                        </span>
                        {isAdmin && (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="sm" className="h-7 w-7 p-0"><MoreVertical className="h-4 w-4" /></Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => openEdit(r)}>Editar</DropdownMenuItem>
                              <DropdownMenuItem onClick={() => toggleAtivo(r)}>{r.ativo ? "Desativar" : "Ativar"}</DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem onClick={() => setDeleteTarget(r)} className="text-destructive focus:text-destructive">
                                <Trash2 className="h-4 w-4 mr-2" />Deletar
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        )}
                      </div>
                    </div>
                    <div className="grid grid-cols-4 gap-2 tabular-nums">
                      {[
                        { label: "Posts", value: fmt(r.post_count), hi: false },
                        { label: "Views", value: fmt(r.total_views), hi: r.total_views === maxViews && maxViews > 0 },
                        { label: "Curt.", value: fmt(r.total_reactions), hi: r.total_reactions === maxReactions && maxReactions > 0 },
                        { label: "Com.", value: fmt(r.total_comments), hi: r.total_comments === maxComments && maxComments > 0 },
                      ].map(({ label, value, hi }) => (
                        <div key={label} className="bg-muted/50 rounded-lg px-2 py-2 flex flex-col items-center gap-0.5">
                          <span className={`font-semibold text-sm ${hi ? "text-orange-500" : ""}`}>{value}</span>
                          <span className="text-[10px] text-muted-foreground uppercase tracking-wide">{label}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
