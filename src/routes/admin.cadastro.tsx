import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { PageHeader } from "@/components/app/PageHeader";
import { EmptyState } from "@/components/app/EmptyState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { Users, Plus, Loader2, Trash2, Shield, Eye } from "lucide-react";

export const Route = createFileRoute("/admin/cadastro")({
  head: () => ({ meta: [{ title: "Cadastro de Usuários — Rateio Creator" }] }),
  component: Page,
});

interface UserProfile {
  id: string;
  nome: string;
  email: string | null;
  role: "admin" | "colaborador";
  created_at: string;
}

const ROLE_LABEL: Record<string, string> = {
  admin: "Admin",
  colaborador: "Leitor",
};

function Page() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<UserProfile | null>(null);
  const [deleting, setDeleting] = useState(false);

  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"admin" | "colaborador">("colaborador");

  useEffect(() => {
    if (profile?.role !== "admin") {
      navigate({ to: "/admin/dashboard" });
      return;
    }
    load();
  }, [profile]);

  const load = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("profiles")
      .select("id, nome, email, role, created_at")
      .order("created_at", { ascending: false });
    setUsers((data as UserProfile[]) ?? []);
    setLoading(false);
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (password.length < 8) {
      toast.error("Senha deve ter ao menos 8 caracteres");
      return;
    }
    setSaving(true);
    try {
      const { data, error } = await supabase.functions.invoke("manage-user", {
        body: { action: "create", email, password, nome, role },
      });
      if (error || data?.error) throw new Error(data?.error ?? error?.message);
      toast.success("Usuário criado com sucesso");
      setShowForm(false);
      setNome(""); setEmail(""); setPassword(""); setRole("colaborador");
      await load();
    } catch (err) {
      toast.error("Erro ao criar usuário", {
        description: err instanceof Error ? err.message : "Erro desconhecido",
      });
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const { data, error } = await supabase.functions.invoke("manage-user", {
        body: { action: "delete", userId: deleteTarget.id },
      });
      if (error || data?.error) throw new Error(data?.error ?? error?.message);
      toast.success(`${deleteTarget.nome} removido`);
      setDeleteTarget(null);
      await load();
    } catch (err) {
      toast.error("Erro ao remover", {
        description: err instanceof Error ? err.message : "Erro desconhecido",
      });
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div>
      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => { if (!o) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover {deleteTarget?.nome}?</AlertDialogTitle>
            <AlertDialogDescription>
              O login será deletado do sistema e o usuário perderá acesso imediatamente. Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Remover acesso
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <PageHeader
        title="Cadastro de Usuários"
        description="Crie logins e defina o nível de acesso de cada pessoa."
        actions={
          <Button onClick={() => setShowForm(!showForm)}>
            <Plus className="h-4 w-4 mr-2" />
            Novo usuário
          </Button>
        }
      />

      {showForm && (
        <form onSubmit={onSubmit} className="bg-card border border-border rounded-lg p-5 mb-6 space-y-4">
          <h3 className="font-medium text-sm">Novo usuário</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Nome</Label>
              <Input required value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex: Ana Vitória" />
            </div>
            <div className="space-y-1.5">
              <Label>E-mail</Label>
              <Input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="ana@exemplo.com" />
            </div>
            <div className="space-y-1.5">
              <Label>Senha</Label>
              <Input required type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Mínimo 8 caracteres" />
            </div>
            <div className="space-y-1.5">
              <Label>Função</Label>
              <Select value={role} onValueChange={(v) => setRole(v as "admin" | "colaborador")}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="colaborador">
                    <div className="flex items-center gap-2">
                      <Eye className="h-4 w-4 text-muted-foreground" />
                      <div>
                        <p className="font-medium">Leitor</p>
                        <p className="text-xs text-muted-foreground">Vê todos os dados, sem editar</p>
                      </div>
                    </div>
                  </SelectItem>
                  <SelectItem value="admin">
                    <div className="flex items-center gap-2">
                      <Shield className="h-4 w-4 text-muted-foreground" />
                      <div>
                        <p className="font-medium">Admin</p>
                        <p className="text-xs text-muted-foreground">Acesso total ao sistema</p>
                      </div>
                    </div>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex gap-2">
            <Button type="submit" disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Criar usuário
            </Button>
            <Button type="button" variant="outline" onClick={() => setShowForm(false)}>
              Cancelar
            </Button>
          </div>
        </form>
      )}

      <div className="bg-card border border-border rounded-lg overflow-hidden">
        {loading ? (
          <div className="p-10 flex justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : users.length === 0 ? (
          <div className="p-6">
            <EmptyState icon={Users} title="Nenhum usuário cadastrado" description="Crie o primeiro login para dar acesso ao sistema." />
          </div>
        ) : (
          <>
            {/* Mobile list */}
            <div className="sm:hidden divide-y divide-border">
              {users.map((u) => (
                <div key={u.id} className="px-4 py-4 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-medium truncate">{u.nome}</p>
                      {u.id === profile?.id && (
                        <span className="text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded font-medium">Você</span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground truncate">{u.email}</p>
                    <span className={`inline-flex items-center gap-1 mt-1 text-xs font-medium px-2 py-0.5 rounded-full ${
                      u.role === "admin" ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
                    }`}>
                      {u.role === "admin" ? <Shield className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                      {ROLE_LABEL[u.role]}
                    </span>
                  </div>
                  {u.id !== profile?.id && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setDeleteTarget(u)}
                      className="shrink-0 text-destructive hover:text-destructive hover:bg-destructive/10"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              ))}
            </div>

            {/* Desktop table */}
            <div className="hidden sm:block">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="text-left px-5 py-3 font-medium">Nome</th>
                    <th className="text-left px-5 py-3 font-medium">E-mail</th>
                    <th className="text-left px-5 py-3 font-medium">Função</th>
                    <th className="text-left px-5 py-3 font-medium">Criado em</th>
                    <th className="px-5 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {users.map((u) => (
                    <tr key={u.id} className="hover:bg-muted/20">
                      <td className="px-5 py-3 font-medium">
                        <span className="flex items-center gap-2">
                          {u.nome}
                          {u.id === profile?.id && (
                            <span className="text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded font-medium">Você</span>
                          )}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-muted-foreground">{u.email}</td>
                      <td className="px-5 py-3">
                        <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${
                          u.role === "admin" ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
                        }`}>
                          {u.role === "admin" ? <Shield className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                          {ROLE_LABEL[u.role]}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-muted-foreground">
                        {new Date(u.created_at).toLocaleDateString("pt-BR")}
                      </td>
                      <td className="px-5 py-3 text-right">
                        {u.id !== profile?.id && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setDeleteTarget(u)}
                            className="text-destructive hover:text-destructive hover:bg-destructive/10"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {/* Role legend */}
      <div className="mt-4 p-4 bg-muted/30 rounded-lg border border-border space-y-2">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Níveis de acesso</p>
        <div className="flex flex-col sm:flex-row gap-3 text-sm">
          <div className="flex items-start gap-2">
            <Shield className="h-4 w-4 text-primary mt-0.5 shrink-0" />
            <div>
              <p className="font-medium">Admin</p>
              <p className="text-xs text-muted-foreground">Acesso total: cria fechamentos, importa CSVs, edita regras e gerencia usuários.</p>
            </div>
          </div>
          <div className="flex items-start gap-2 sm:ml-6">
            <Eye className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
            <div>
              <p className="font-medium">Leitor</p>
              <p className="text-xs text-muted-foreground">Vê todos os dashboards, posts, fechamentos e colaboradores. Não pode criar nem editar nada.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
