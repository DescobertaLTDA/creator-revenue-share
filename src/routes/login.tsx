import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";
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
    <div className="min-h-screen grid lg:grid-cols-2 bg-white">
      {/* Left branding column — dark */}
      <div className="hidden lg:flex flex-col justify-between p-12 bg-[#0a0a0a]">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-lg bg-white/10 flex items-center justify-center">
            <span className="text-white font-bold text-base leading-none">S</span>
          </div>
          <span className="text-white font-semibold text-base tracking-tight">Splash Creators</span>
        </div>

        <div className="max-w-md">
          <h2 className="text-3xl font-bold tracking-tight text-white mb-4 leading-tight">
            Gestão de receita por post, sem planilha.
          </h2>
          <p className="text-white/50 leading-relaxed text-sm">
            Importe o CSV do Facebook, defina regras de split por página, feche o mês e
            gere comprovantes em PDF. Tudo auditado e organizado.
          </p>
          <ul className="mt-8 space-y-3 text-sm text-white/40">
            <li className="flex items-center gap-2.5">
              <span className="h-1 w-1 rounded-full bg-white/30 shrink-0" />
              Importação idempotente com histórico
            </li>
            <li className="flex items-center gap-2.5">
              <span className="h-1 w-1 rounded-full bg-white/30 shrink-0" />
              Fechamento mensal congelado (snapshot)
            </li>
            <li className="flex items-center gap-2.5">
              <span className="h-1 w-1 rounded-full bg-white/30 shrink-0" />
              Comprovante em PDF por colaborador
            </li>
          </ul>
        </div>

        <p className="text-xs text-white/20">© {new Date().getFullYear()} Splash Creators</p>
      </div>

      {/* Right login column */}
      <div className="flex items-center justify-center p-6 sm:p-12 bg-white">
        <div className="w-full max-w-sm">
          {/* Mobile logo */}
          <div className="lg:hidden flex items-center gap-3 mb-10">
            <div className="h-9 w-9 rounded-lg bg-[#0a0a0a] flex items-center justify-center">
              <span className="text-white font-bold text-base leading-none">S</span>
            </div>
            <span className="font-semibold text-base tracking-tight text-[#0a0a0a]">Splash Creators</span>
          </div>

          <h1 className="text-2xl font-bold tracking-tight text-[#0a0a0a]">Entrar</h1>
          <p className="text-sm text-neutral-500 mt-1.5 mb-8">
            Acesse com o e-mail e senha cadastrados pelo administrador.
          </p>

          <form onSubmit={onSubmit} className="space-y-5">
            <div className="space-y-1.5">
              <Label htmlFor="email" className="text-xs font-semibold uppercase tracking-wider text-neutral-500">
                E-mail
              </Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="voce@empresa.com"
                className="h-11 border-neutral-200 focus-visible:ring-neutral-900 rounded-lg"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password" className="text-xs font-semibold uppercase tracking-wider text-neutral-500">
                Senha
              </Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="h-11 border-neutral-200 focus-visible:ring-neutral-900 rounded-lg"
              />
            </div>
            <Button
              type="submit"
              className="w-full h-11 bg-[#0a0a0a] hover:bg-neutral-800 text-white rounded-lg font-medium"
              disabled={submitting}
            >
              {submitting && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Entrar
            </Button>
          </form>

          <p className="text-xs text-neutral-400 mt-8 text-center">
            Problemas para acessar? Fale com seu administrador.
          </p>
          <p className="text-xs text-neutral-400 mt-2 text-center">
            <Link to="/" className="hover:text-neutral-700 underline underline-offset-2">Voltar ao início</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
