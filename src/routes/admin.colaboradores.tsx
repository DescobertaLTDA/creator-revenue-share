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
  head: () => ({ meta: [{ title: "Colaboradores — Rateio Creator" }] }),
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

function normalizeHashtag(raw: string): string {
  return raw.replace(/^#+/, "").trim().toLowerCase();
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

    if (!cols) { setLoading(false); return; }

    // conta posts por colaborador via post_authors
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

  useEffect(() => { load(); }, []);

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
    if (!hashtag.trim()) { toast.error("Informe a hashtag do colaborador"); return; }
    setSaving(true);

    const tag = normalizeHashtag(hashtag);

    if (editId) {
      const { error } = await supabase
        .from("collaborators")
        .update({ nome, hashtag: tag })
        .eq("id", editId);
      if (error) { toast.error("Erro", { description: error.message }); setSaving(false); return; }
      toast.success("Colaborador atualizado.");
    } else {
      const { error } = await supabase
        .from("collaborators")
        .insert({ nome, hashtag: tag, ativo: true });
      if (error) { toast.error("Erro", { description: error.message }); setSaving(false); return; }
      toast.success("Colaborador cadastrado.");
    }

    setSaving(false);
    setNome(""); setHashtag(""); setShowForm(false); setEditId(null);
    await load();
  };

  const toggleAtivo = async (r: Col) => {
    await supabase.from("collaborators").update({ ativo: !r.ativo }).eq("id", r.id);
    await load();
  };

  return (
    <div>
      <PageHeader
        title="Colaboradores"
        description="Cadastre colaboradores com suas hashtags. O sistema vincula automaticamente os posts na importação."
        actions={<Button onClick={openNew}><Plus className="h-4 w-4 mr-2" />Novo</Button>}
      />

      {showForm && (
        <form onSubmit={onSubmit} className="bg-card border border-border rounded-xl p-5 mb-6 space-y-4">
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
                Digite sem o # — o sistema busca <strong>#{normalizeHashtag(hashtag) || "matheus"}</strong> nas descrições dos posts.
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

      <div className="bg-card border border-border rounded-xl overflow-hidden">
        {loading ? (
          <div className="p-10 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : rows.length === 0 ? (
          <div className="p-6"><EmptyState icon={Users} title="Nenhum colaborador cadastrado" description="Cadastre colaboradores com suas hashtags para vincular posts automaticamente." /></div>
        ) : (
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
                      : <span className="text-muted-foreground">—</span>}
                  </td>
                  <td className="px-5 py-3 text-right tabular-nums">{r.post_count ?? 0}</td>
                  <td className="px-5 py-3">
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${r.ativo ? "bg-green-100 text-green-700" : "bg-muted text-muted-foreground"}`}>
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
        )}
      </div>
    </div>
  );
}
