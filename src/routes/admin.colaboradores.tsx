import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/app/PageHeader";
import { EmptyState } from "@/components/app/EmptyState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Users, Plus, Loader2 } from "lucide-react";

export const Route = createFileRoute("/admin/colaboradores")({
  head: () => ({ meta: [{ title: "Colaboradores — Rateio Creator" }] }),
  component: Page,
});

interface Col { id: string; nome: string; email: string | null; ativo: boolean; }

function Page() {
  const [rows, setRows] = useState<Col[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");

  const load = async () => {
    setLoading(true);
    const { data } = await supabase.from("collaborators").select("id, nome, email, ativo").order("nome");
    setRows((data as Col[]) ?? []);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const { error } = await supabase.from("collaborators").insert({ nome, email: email || null, ativo: true });
    if (error) { toast.error("Erro", { description: error.message }); return; }
    toast.success("Colaborador cadastrado. O convite por e-mail será enviado em breve (em implementação).");
    setNome(""); setEmail(""); setShowForm(false);
    await load();
  };

  return (
    <div>
      <PageHeader title="Colaboradores" description="Cadastro de colaboradores. O envio automático de convite por e-mail será adicionado em breve."
        actions={<Button onClick={() => setShowForm(v => !v)}><Plus className="h-4 w-4 mr-2"/>Novo</Button>} />

      {showForm && (
        <form onSubmit={onSubmit} className="bg-card border border-border rounded-xl p-5 mb-6 grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
          <div><Label>Nome</Label><Input required value={nome} onChange={e => setNome(e.target.value)} /></div>
          <div><Label>E-mail</Label><Input type="email" value={email} onChange={e => setEmail(e.target.value)} /></div>
          <div className="flex gap-2"><Button type="submit">Salvar</Button><Button type="button" variant="outline" onClick={() => setShowForm(false)}>Cancelar</Button></div>
        </form>
      )}

      <div className="bg-card border border-border rounded-xl overflow-hidden">
        {loading ? <div className="p-10 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground"/></div> :
        rows.length === 0 ? <div className="p-6"><EmptyState icon={Users} title="Nenhum colaborador cadastrado"/></div> :
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
            <tr><th className="text-left px-5 py-3 font-medium">Nome</th><th className="text-left px-5 py-3 font-medium">E-mail</th><th className="text-left px-5 py-3 font-medium">Status</th></tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map(r => (
              <tr key={r.id}><td className="px-5 py-3 font-medium">{r.nome}</td><td className="px-5 py-3 text-muted-foreground">{r.email ?? "—"}</td><td className="px-5 py-3">{r.ativo ? "Ativo" : "Inativo"}</td></tr>
            ))}
          </tbody>
        </table>}
      </div>
    </div>
  );
}
