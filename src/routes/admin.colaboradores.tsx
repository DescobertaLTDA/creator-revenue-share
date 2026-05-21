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
import { useWriteGuard } from "@/hooks/use-write-guard";
import { Users, Plus, Loader2, Hash, Trash2, Camera } from "lucide-react";

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
  post_count?: number;
}

interface PostLite {
  id: string;
  title: string | null;
  description: string | null;
}

function normalizeHashtag(raw: string): string {
  return raw.replace(/^#+/, "").trim().toLowerCase();
}

const AVATAR_COLORS = [
  ["#F44708", "#FAA613"],
  ["#8B5CF6", "#C084FC"],
  ["#0EA5E9", "#38BDF8"],
  ["#10B981", "#34D399"],
  ["#F59E0B", "#FCD34D"],
  ["#EF4444", "#FC8181"],
  ["#6366F1", "#A5B4FC"],
];

function ColabAvatar({ nome, avatarUrl, size = 36, idx }: { nome: string; avatarUrl?: string | null; size?: number; idx: number }) {
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
  const [a, b] = AVATAR_COLORS[idx % AVATAR_COLORS.length];
  const initials = nome.split(" ").filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join("");
  const gid = `ca-${idx}`;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ borderRadius: "50%", display: "block", flexShrink: 0 }}>
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={a} />
          <stop offset="100%" stopColor={b} />
        </linearGradient>
      </defs>
      <circle cx={size / 2} cy={size / 2} r={size / 2} fill={`url(#${gid})`} />
      <text x={size / 2} y={size / 2 + size * 0.14} textAnchor="middle" fontSize={size * 0.35} fontWeight="700" fill="white" fontFamily="system-ui, sans-serif">
        {initials}
      </text>
    </svg>
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
  const { guard, guardSubmit, WriteGuardDialog } = useWriteGuard();
  const [rows, setRows] = useState<Col[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [nome, setNome] = useState("");
  const [hashtag, setHashtag] = useState("");
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [currentAvatarUrl, setCurrentAvatarUrl] = useState<string | null>(null);
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
    const counts = await fetchAllRows<{ collaborator_id: string }>(() =>
      supabase.from("post_authors").select("collaborator_id").in("collaborator_id", ids)
    );

    const countMap: Record<string, number> = {};
    for (const c of counts) {
      countMap[c.collaborator_id] = (countMap[c.collaborator_id] ?? 0) + 1;
    }

    setRows(cols.map((c) => ({ ...c, post_count: countMap[c.id] ?? 0 })));
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const openNew = () => {
    setEditId(null);
    setNome("");
    setHashtag("");
    setAvatarFile(null);
    setAvatarPreview(null);
    setCurrentAvatarUrl(null);
    setShowForm(true);
  };

  const openEdit = (r: Col) => {
    setEditId(r.id);
    setNome(r.nome);
    setHashtag(r.hashtag ?? "");
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
          const { error: uploadError } = await supabase.storage
            .from("avatars")
            .upload(path, avatarFile, { upsert: true, contentType: avatarFile.type });
          if (!uploadError) {
            const { data: { publicUrl } } = supabase.storage.from("avatars").getPublicUrl(path);
            await supabase.from("collaborators").update({ avatar_url: publicUrl }).eq("id", collaboratorId);
          } else {
            toast.warning("Foto não salva", { description: "Bucket de avatars não configurado ainda. Colaborador salvo sem foto." });
          }
        } catch {
          toast.warning("Foto não salva", { description: "Erro ao fazer upload. Colaborador salvo sem foto." });
        }
      }

      const toastId = toast.loading("Reprocessando posts por hashtag...");
      const linkedCount = await rematchCollaboratorPosts(collaboratorId, tag);
      toast.success("Colaborador salvo", {
        id: toastId,
        description: `${linkedCount.toLocaleString("pt-BR")} posts vinculados por #${tag}`,
      });

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
      <WriteGuardDialog />
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
        actions={<Button onClick={guard(openNew)}><Plus className="h-4 w-4 mr-2" />Novo</Button>}
      />

      {showForm && (
        <form onSubmit={guardSubmit(onSubmit)} className="bg-card border border-border rounded-lg p-5 mb-6 space-y-4">
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
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <ColabAvatar nome={r.nome} avatarUrl={r.avatar_url} size={40} idx={i} />
                      <div className="min-w-0">
                        <p className="font-semibold truncate">{r.nome}</p>
                        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                          {r.hashtag
                            ? <span className="inline-flex items-center gap-1 text-primary font-mono text-xs bg-primary/10 px-2 py-0.5 rounded-md">#{r.hashtag}</span>
                            : <span className="text-xs text-muted-foreground">Sem hashtag</span>}
                          <span className="text-xs text-muted-foreground">{r.post_count ?? 0} posts</span>
                        </div>
                      </div>
                    </div>
                    <span className={`text-xs font-medium px-2.5 py-1 rounded-full shrink-0 ${r.ativo ? "bg-green-500/10 text-green-600" : "bg-muted text-muted-foreground"}`}>
                      {r.ativo ? "Ativo" : "Inativo"}
                    </span>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={guard(() => openEdit(r))} className="flex-1 h-10">Editar</Button>
                    <Button size="sm" variant="ghost" onClick={guard(() => toggleAtivo(r))} className="flex-1 h-10">
                      {r.ativo ? "Desativar" : "Ativar"}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={guard(() => setDeleteTarget(r))} className="h-10 text-destructive hover:text-destructive hover:bg-destructive/10">
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
            {/* Desktop table */}
            <div className="hidden sm:block">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="text-left px-5 py-3 font-medium">Nome</th>
                    <th className="text-left px-5 py-3 font-medium">Hashtag</th>
                    <th className="text-right px-5 py-3 font-medium">Posts vinculados</th>
                    <th className="text-left px-5 py-3 font-medium">Status</th>
                    <th className="text-left px-5 py-3 font-medium">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {rows.map((r, i) => (
                    <tr key={r.id} className="hover:bg-muted/20">
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-3">
                          <ColabAvatar nome={r.nome} avatarUrl={r.avatar_url} size={34} idx={i} />
                          <span className="font-medium">{r.nome}</span>
                        </div>
                      </td>
                      <td className="px-5 py-3">
                        {r.hashtag
                          ? <span className="inline-flex items-center gap-1 text-primary font-mono text-xs bg-primary/10 px-2 py-0.5 rounded">#{r.hashtag}</span>
                          : <span className="text-muted-foreground">-</span>}
                      </td>
                      <td className="px-5 py-3 text-right tabular-nums">{r.post_count ?? 0}</td>
                      <td className="px-5 py-3">
                        <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${r.ativo ? "bg-green-500/10 text-green-600" : "bg-muted text-muted-foreground"}`}>
                          {r.ativo ? "Ativo" : "Inativo"}
                        </span>
                      </td>
                      <td className="px-5 py-3 flex gap-2">
                        <Button size="sm" variant="outline" onClick={guard(() => openEdit(r))}>Editar</Button>
                        <Button size="sm" variant="ghost" onClick={guard(() => toggleAtivo(r))}>
                          {r.ativo ? "Desativar" : "Ativar"}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={guard(() => setDeleteTarget(r))} className="text-destructive hover:text-destructive hover:bg-destructive/10">
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
