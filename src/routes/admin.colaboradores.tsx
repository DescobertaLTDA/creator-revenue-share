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
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { Users, Plus, Loader2, Hash, Trash2, Camera, UserCircle, Eye, Heart, MessageCircle, FileText } from "lucide-react";

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
  post_count: number;
  total_views: number;
  total_reactions: number;
  total_comments: number;
}

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, "")}K`;
  return String(n);
}

interface PostLite {
  id: string;
  title: string | null;
  description: string | null;
}

function normalizeHashtag(raw: string): string {
  return raw.replace(/^#+/, "").trim().toLowerCase();
}

function ColabAvatar({ nome, avatarUrl, size = 36 }: { nome: string; avatarUrl?: string | null; size?: number; idx?: number }) {
  if (avatarUrl) {
    return (
      <img
        src={avatarUrl}
        alt={nome}
        width={size}
        height={size}
        style={{ width: size, height: size, borderRadius: "50%", objectFit: "cover", display: "block", flexShrink: 0 }}
      />
    );
  }
  return (
    <div
      style={{ width: size, height: size, flexShrink: 0 }}
      className="rounded-full bg-muted flex items-center justify-center shrink-0"
    >
      <UserCircle className="text-muted-foreground" style={{ width: size * 0.7, height: size * 0.7 }} />
    </div>
  );
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

  await supabase
    .from("post_authors")
    .delete()
    .eq("collaborator_id", collaboratorId)
    .eq("source", "hashtag");

  if (!normalized) return 0;

  const posts = await fetchAllRows<PostLite>(() =>
    supabase.from("posts").select("id, title, description")
  );

  const regex = new RegExp(`#${escapeRegex(normalized)}(?![a-z0-9_])`, "i");
  const matches = posts
    .filter((post) => regex.test(`${post.title ?? ""} ${post.description ?? ""}`.toLowerCase()))
    .map((post) => ({
      post_id: post.id,
      collaborator_id: collaboratorId,
      source: "hashtag",
    }));

  const CHUNK = 500;
  for (let i = 0; i < matches.length; i += CHUNK) {
    const slice = matches.slice(i, i + CHUNK);
    await supabase
      .from("post_authors")
      .upsert(slice, { onConflict: "post_id,collaborator_id", ignoreDuplicates: true });
  }

  return matches.length;
}

function Page() {
  const { profile } = useAuth();
  const isAdmin = profile?.role === "admin";
  const [rows, setRows] = useState<Col[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [nome, setNome] = useState("");
  const [hashtag, setHashtag] = useState("");
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [currentAvatarUrl, setCurrentAvatarUrl] = useState<string | null>(null);
  const [originalHashtag, setOriginalHashtag] = useState<string>("");
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Col | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = async () => {
    setLoading(true);
    const colsRes = await supabase
      .from("collaborators")
      .select("id, nome, email, hashtag, avatar_url, ativo")
      .order("nome");
    // Fallback if avatar_url column doesn't exist yet
    const cols = colsRes.error
      ? (await supabase.from("collaborators").select("id, nome, email, hashtag, ativo").order("nome")).data
      : colsRes.data;

    if (!cols) {
      setLoading(false);
      return;
    }

    const ids = cols.map((c) => c.id);
    const paRows = await fetchAllRows<{
      collaborator_id: string;
      posts: { views: number | null; reactions: number | null; comments: number | null } | null;
    }>(() =>
      supabase
        .from("post_authors")
        .select("collaborator_id, posts(views, reactions, comments)")
        .in("collaborator_id", ids)
    );

    const metricsMap: Record<string, { post_count: number; total_views: number; total_reactions: number; total_comments: number }> = {};
    for (const row of paRows) {
      const cid = row.collaborator_id;
      if (!metricsMap[cid]) metricsMap[cid] = { post_count: 0, total_views: 0, total_reactions: 0, total_comments: 0 };
      metricsMap[cid].post_count++;
      metricsMap[cid].total_views += row.posts?.views ?? 0;
      metricsMap[cid].total_reactions += row.posts?.reactions ?? 0;
      metricsMap[cid].total_comments += row.posts?.comments ?? 0;
    }

    setRows(cols.map((c) => ({ ...c, ...(metricsMap[c.id] ?? { post_count: 0, total_views: 0, total_reactions: 0, total_comments: 0 }) })));
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const openNew = () => {
    setEditId(null);
    setNome("");
    setHashtag("");
    setOriginalHashtag("");
    setAvatarFile(null);
    setAvatarPreview(null);
    setCurrentAvatarUrl(null);
    setShowForm(true);
  };

  const openEdit = (r: Col) => {
    setEditId(r.id);
    setNome(r.nome);
    setHashtag(r.hashtag ?? "");
    setOriginalHashtag(r.hashtag ?? "");
    setAvatarFile(null);
    setAvatarPreview(null);
    setCurrentAvatarUrl(r.avatar_url ?? null);
    setShowForm(true);
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!hashtag.trim()) {
      toast.error("Informe a hashtag do colaborador");
      return;
    }

    setSaving(true);
    const tag = normalizeHashtag(hashtag);

    try {
      let collaboratorId = editId;

      if (editId) {
        const { error } = await supabase
          .from("collaborators")
          .update({ nome, hashtag: tag })
          .eq("id", editId);
        if (error) throw error;
      } else {
        const { data, error } = await supabase
          .from("collaborators")
          .insert({ nome, hashtag: tag, ativo: true })
          .select("id")
          .single();
        if (error || !data) throw error ?? new Error("Falha ao criar colaborador");
        collaboratorId = data.id;
      }

      if (!collaboratorId) throw new Error("Colaborador invalido");

      // Upload avatar if a new file was selected (non-blocking — collaborator is saved regardless)
      if (avatarFile) {
        try {
          const ext = avatarFile.name.split(".").pop()?.toLowerCase() || "jpg";
          const path = `collaborators/${collaboratorId}.${ext}`;
          // Delete old files for all possible extensions before uploading new one
          await Promise.allSettled(
            ["jpg", "jpeg", "png", "webp", "gif"].map((e) =>
              supabase.storage.from("avatars").remove([`collaborators/${collaboratorId}.${e}`])
            )
          );
          const { error: uploadError } = await supabase.storage
            .from("avatars")
            .upload(path, avatarFile, { upsert: true, contentType: avatarFile.type });
          if (!uploadError) {
            const { data: { publicUrl } } = supabase.storage.from("avatars").getPublicUrl(path);
            // Append timestamp to bust browser cache when photo is replaced
            const urlWithCache = `${publicUrl}?v=${Date.now()}`;
            await supabase.from("collaborators").update({ avatar_url: urlWithCache }).eq("id", collaboratorId);
          } else {
            toast.warning("Foto não salva", { description: uploadError.message });
          }
        } catch {
          toast.warning("Foto não salva", { description: "Erro ao fazer upload." });
        }
      }

      const hashtagChanged = !editId || normalizeHashtag(originalHashtag) !== tag;
      if (hashtagChanged) {
        const toastId = toast.loading("Reprocessando posts por hashtag...");
        const linkedCount = await rematchCollaboratorPosts(collaboratorId, tag);
        toast.success("Colaborador salvo", {
          id: toastId,
          description: `${linkedCount.toLocaleString("pt-BR")} posts vinculados por #${tag}`,
        });
      } else {
        toast.success(avatarFile ? "Foto atualizada com sucesso" : "Colaborador atualizado");
      }

      setNome("");
      setHashtag("");
      setAvatarFile(null);
      setAvatarPreview(null);
      setCurrentAvatarUrl(null);
      setShowForm(false);
      setEditId(null);
      await load();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erro desconhecido";
      toast.error("Erro", { description: message });
    } finally {
      setSaving(false);
    }
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
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div>
      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => { if (!o) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Deletar {deleteTarget?.nome}?</AlertDialogTitle>
            <AlertDialogDescription>
              Todos os vínculos de posts serão removidos. Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Deletar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <PageHeader
        title="Colaboradores"
        description="Cadastre hashtags e o sistema vincula posts antigos e novos automaticamente."
        actions={isAdmin ? <Button onClick={openNew}><Plus className="h-4 w-4 mr-2" />Novo</Button> : undefined}
      />

      {isAdmin && showForm && (
        <form onSubmit={onSubmit} className="bg-card border border-border rounded-lg p-5 mb-6 space-y-4">
          <h3 className="font-medium">{editId ? "Editar colaborador" : "Novo colaborador"}</h3>

          {/* Avatar upload */}
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={() => avatarInputRef.current?.click()}
              className="relative group h-16 w-16 rounded-full overflow-hidden border-2 border-dashed border-border hover:border-primary transition-colors bg-muted flex items-center justify-center shrink-0"
            >
              {avatarPreview || currentAvatarUrl ? (
                <img
                  src={avatarPreview ?? currentAvatarUrl!}
                  alt="Avatar"
                  className="w-full h-full object-cover"
                  style={{ width: 64, height: 64 }}
                />
              ) : (
                <Camera className="h-6 w-6 text-muted-foreground group-hover:text-primary transition-colors" />
              )}
              <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                <Camera className="h-5 w-5 text-white" />
              </div>
            </button>
            <input
              ref={avatarInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                setAvatarFile(file);
                const url = URL.createObjectURL(file);
                setAvatarPreview(url);
              }}
            />
            <div>
              <p className="text-sm font-medium">Foto de perfil</p>
              <p className="text-xs text-muted-foreground">
                {avatarPreview ? "Nova foto selecionada" : currentAvatarUrl ? "Clique para trocar a foto" : "Clique para adicionar (JPG, PNG ou WebP · máx 5 MB)"}
              </p>
              {avatarPreview && (
                <button
                  type="button"
                  className="text-xs text-destructive mt-1 hover:underline"
                  onClick={() => { setAvatarFile(null); setAvatarPreview(null); if (avatarInputRef.current) avatarInputRef.current.value = ""; }}
                >
                  Remover
                </button>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <Label>Nome</Label>
              <Input required value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex: Matheus" />
            </div>
            <div>
              <Label>Hashtag</Label>
              <div className="relative">
                <Hash className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  required
                  value={hashtag}
                  onChange={(e) => setHashtag(e.target.value)}
                  placeholder="matheus"
                  className="pl-9"
                />
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Digite sem o # e o sistema vai reprocessar os posts com <strong>#{normalizeHashtag(hashtag) || "matheus"}</strong>.
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button type="submit" disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Salvar
            </Button>
            <Button type="button" variant="outline" onClick={() => { setShowForm(false); setEditId(null); setAvatarFile(null); setAvatarPreview(null); }}>
              Cancelar
            </Button>
          </div>
        </form>
      )}

      <div className="bg-card border border-border rounded-lg overflow-hidden">
        {loading ? (
          <div className="p-10 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : rows.length === 0 ? (
          <div className="p-6"><EmptyState icon={Users} title="Nenhum colaborador cadastrado" description="Cadastre colaboradores com suas hashtags para vincular posts automaticamente." /></div>
        ) : (
          <>
            {/* Mobile card list */}
            <div className="sm:hidden divide-y divide-border">
              {rows.map((r, i) => (
                <div key={r.id} className="px-4 py-4 space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-3 min-w-0">
                      <ColabAvatar nome={r.nome} avatarUrl={r.avatar_url} size={40} idx={i} />
                      <div className="min-w-0">
                        <p className="font-semibold truncate">{r.nome}</p>
                        {r.hashtag
                          ? <span className="text-primary font-mono text-xs bg-primary/10 px-2 py-0.5 rounded-md mt-0.5 inline-block">#{r.hashtag}</span>
                          : <span className="text-xs text-muted-foreground">Sem hashtag</span>}
                      </div>
                    </div>
                    <span className={`text-xs font-medium px-2.5 py-1 rounded-full shrink-0 ${r.ativo ? "bg-green-500/10 text-green-600" : "bg-muted text-muted-foreground"}`}>
                      {r.ativo ? "Ativo" : "Inativo"}
                    </span>
                  </div>
                  <div className="grid grid-cols-4 gap-2 tabular-nums">
                    {([
                      { label: "Posts", value: fmt(r.post_count) },
                      { label: "Views", value: fmt(r.total_views) },
                      { label: "Curt.", value: fmt(r.total_reactions) },
                      { label: "Com.", value: fmt(r.total_comments) },
                    ] as const).map(({ label, value }) => (
                      <div key={label} className="bg-muted/50 rounded-lg px-2 py-2 flex flex-col items-center gap-0.5">
                        <span className="font-semibold text-sm">{value}</span>
                        <span className="text-[10px] text-muted-foreground uppercase tracking-wide">{label}</span>
                      </div>
                    ))}
                  </div>
                  {isAdmin && (
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" onClick={() => openEdit(r)} className="flex-1 h-9">Editar</Button>
                      <Button size="sm" variant="ghost" onClick={() => toggleAtivo(r)} className="flex-1 h-9">
                        {r.ativo ? "Desativar" : "Ativar"}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setDeleteTarget(r)} className="h-9 text-destructive hover:text-destructive hover:bg-destructive/10">
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  )}
                </div>
              ))}
            </div>
            {/* Desktop list */}
            <div className="hidden sm:divide-y sm:divide-border sm:block">
              {rows.map((r, i) => (
                <div key={r.id} className="flex items-center justify-between gap-6 px-6 py-4 hover:bg-muted/20 transition-colors">
                  {/* Avatar + name + hashtag */}
                  <div className="flex items-center gap-4 min-w-[180px]">
                    <ColabAvatar nome={r.nome} avatarUrl={r.avatar_url} size={42} idx={i} />
                    <div>
                      <p className="font-semibold text-sm">{r.nome}</p>
                      {r.hashtag
                        ? <span className="text-primary font-mono text-xs bg-primary/10 px-2 py-0.5 rounded-md mt-0.5 inline-block">#{r.hashtag}</span>
                        : <span className="text-xs text-muted-foreground">Sem hashtag</span>}
                    </div>
                  </div>

                  {/* Metrics */}
                  <div className="flex items-center gap-6 flex-1 justify-center tabular-nums">
                    {[
                      { icon: FileText, label: "Posts", value: fmt(r.post_count) },
                      { icon: Eye, label: "Views", value: fmt(r.total_views) },
                      { icon: Heart, label: "Curtidas", value: fmt(r.total_reactions) },
                      { icon: MessageCircle, label: "Comentários", value: fmt(r.total_comments) },
                    ].map(({ icon: Icon, label, value }) => (
                      <div key={label} className="flex flex-col items-center gap-0.5 min-w-[64px]">
                        <div className="flex items-center gap-1.5 text-muted-foreground">
                          <Icon className="h-3.5 w-3.5" />
                          <span className="text-[11px] uppercase tracking-wide">{label}</span>
                        </div>
                        <span className="font-semibold text-base">{value}</span>
                      </div>
                    ))}
                  </div>

                  {/* Status + actions */}
                  <div className="flex items-center gap-2 shrink-0">
                    <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${r.ativo ? "bg-green-500/10 text-green-600" : "bg-muted text-muted-foreground"}`}>
                      {r.ativo ? "Ativo" : "Inativo"}
                    </span>
                    {isAdmin && (
                      <>
                        <Button size="sm" variant="outline" onClick={() => openEdit(r)}>Editar</Button>
                        <Button size="sm" variant="ghost" onClick={() => toggleAtivo(r)}>
                          {r.ativo ? "Desativar" : "Ativar"}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setDeleteTarget(r)} className="text-destructive hover:text-destructive hover:bg-destructive/10">
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
