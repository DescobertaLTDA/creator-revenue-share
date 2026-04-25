import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Wallet, Loader2 } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/login")({
  component: LoginPage,
});

function LoginPage() {
  const navigate = useNavigate();
  const { session, profile, loading } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!loading && session && profile) {
      navigate({ to: "/admin/dashboard" });
    }
  }, [loading, session, profile, navigate]);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setSubmitting(false);
    if (error) {
      toast.error("Falha no login", { description: error.message });
      return;
    }
    toast.success("Bem-vindo!");
  };

  return (
    <div className="min-h-screen grid lg:grid-cols-2 bg-background">
      {/* Coluna branding */}
      <div className="hidden lg:flex flex-col justify-between p-12 bg-gradient-to-br from-primary-soft via-background to-background border-r border-border">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-lg bg-primary flex items-center justify-center">
            <Wallet className="h-5 w-5 text-primary-foreground" />
          </div>
          <span className="text-lg font-semibold">Rateio Creator</span>
        </div>
        <div className="max-w-md">
          <h2 className="text-3xl font-semibold tracking-tight mb-3">
            Gestão de receita por post, sem planilha.
          </h2>
          <p className="text-muted-foreground leading-relaxed">
            Importe o CSV do Facebook, defina regras de split por página, feche o mês e
            gere comprovantes em PDF. Tudo auditado e organizado.
          </p>
          <ul className="mt-6 space-y-2 text-sm text-muted-foreground">
            <li className="flex gap-2"><span className="text-primary">✓</span> Importação idempotente com histórico</li>
            <li className="flex gap-2"><span className="text-primary">✓</span> Fechamento mensal congelado (snapshot)</li>
            <li className="flex gap-2"><span className="text-primary">✓</span> Comprovante em PDF por colaborador</li>
          </ul>
        </div>
        <p className="text-xs text-muted-foreground">© Rateio Creator</p>
      </div>

      {/* Coluna login */}
      <div className="flex items-center justify-center p-6 sm:p-12">
        <div className="w-full max-w-sm">
          <div className="lg:hidden flex items-center gap-3 mb-8">
            <div className="h-10 w-10 rounded-lg bg-primary flex items-center justify-center">
              <Wallet className="h-5 w-5 text-primary-foreground" />
            </div>
            <span className="text-lg font-semibold">Rateio Creator</span>
          </div>

          <h1 className="text-2xl font-semibold tracking-tight">Entrar</h1>
          <p className="text-sm text-muted-foreground mt-1 mb-6">
            Acesse com o e-mail e senha cadastrados pelo administrador.
          </p>

          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="email">E-mail</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="voce@empresa.com"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">Senha</Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
              />
            </div>
            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Entrar
            </Button>
          </form>

          <p className="text-xs text-muted-foreground mt-6 text-center">
            Problemas para acessar? Fale com seu administrador.
          </p>
          <p className="text-xs text-muted-foreground mt-2 text-center">
            <Link to="/" className="hover:text-foreground">Voltar ao início</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
