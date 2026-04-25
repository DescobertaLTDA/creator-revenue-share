import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/app/PageHeader";
import { EmptyState } from "@/components/app/EmptyState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Users, Plus, Loader2, Hash } from "lucide-react";

export const Route = createFileRoute("/admin/colaboradores")({
  head: () => ({ meta: [{ title: "Colaboradores - Rateio Creator" }] }),
  component: Page,
});

interface Col {
  id: string;
  nome: string;
  email: string | null;
  hashtag: string | null;
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
  const [rows, setRows] = useState<Col[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [nome, setNome] = useState("");
  const [hashtag, setHashtag] = useState("");
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data: cols } = await supabase
      .from("collaborators")
      .select("id, nome, email, hashtag, ativo")
      .order("nome");

    if (!cols) {
      setLoading(false);
      return;
    }

    const ids = cols.map((c) => c.id);
    const { data: counts } = await supabase
      .from("post_authors")
      .select("collaborator_id")
      .in("collaborator_id", ids);

    const countMap: Record<string, number> = {};
    for (const c of counts ?? []) {
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
    setShowForm(true);
  };

  const openEdit = (r: Col) => {
    setEditId(r.id);
    setNome(r.nome);
    setHashtag(r.hashtag ?? "");
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

      const toastId = toast.loading("Reprocessando posts por hashtag...");
      const linkedCount = await rematchCollaboratorPosts(collaboratorId, tag);
      toast.success("Colaborador salvo", {
        id: toastId,
        description: `${linkedCount.toLocaleString("pt-BR")} posts vinculados por #${tag}`,
      });

      setNome("");
      setHashtag("");
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

  return (
    <div>
      <PageHeader
        title="Colaboradores"
        description="Cadastre hashtags e o sistema vincula posts antigos e novos automaticamente."
        actions={<Button onClick={openNew}><Plus className="h-4 w-4 mr-2" />Novo</Button>}
      />

      {showForm && (
        <form onSubmit={onSubmit} className="bg-card border border-border rounded-lg p-5 mb-6 space-y-4">
          <h3 className="font-medium">{editId ? "Editar colaborador" : "Novo colaborador"}</h3>
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
            <Button type="button" variant="outline" onClick={() => { setShowForm(false); setEditId(null); }}>
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
              {rows.map((r) => (
                <div key={r.id} className="px-4 py-4 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold">{r.nome}</p>
                      <div className="flex items-center gap-2 mt-1 flex-wrap">
                        {r.hashtag
                          ? <span className="inline-flex items-center gap-1 text-primary font-mono text-xs bg-primary/10 px-2 py-0.5 rounded-md">#{r.hashtag}</span>
                          : <span className="text-xs text-muted-foreground">Sem hashtag</span>}
                        <span className="text-xs text-muted-foreground">{r.post_count ?? 0} posts</span>
                      </div>
                    </div>
                    <span className={`text-xs font-medium px-2.5 py-1 rounded-full shrink-0 ${r.ativo ? "bg-green-500/10 text-green-600" : "bg-muted text-muted-foreground"}`}>
                      {r.ativo ? "Ativo" : "Inativo"}
                    </span>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => openEdit(r)} className="flex-1 h-10">Editar</Button>
                    <Button size="sm" variant="ghost" onClick={() => toggleAtivo(r)} className="flex-1 h-10">
                      {r.ativo ? "Desativar" : "Ativar"}
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
                  {rows.map((r) => (
                    <tr key={r.id} className="hover:bg-muted/20">
                      <td className="px-5 py-3 font-medium">{r.nome}</td>
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
                        <Button size="sm" variant="outline" onClick={() => openEdit(r)}>Editar</Button>
                        <Button size="sm" variant="ghost" onClick={() => toggleAtivo(r)}>
                          {r.ativo ? "Desativar" : "Ativar"}
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
