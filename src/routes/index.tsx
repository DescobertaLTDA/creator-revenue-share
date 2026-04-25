import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useAuth } from "@/hooks/use-auth";
import { Wallet } from "lucide-react";

export const Route = createFileRoute("/")({
  component: IndexRedirect,
});

function IndexRedirect() {
  const { loading, session, profile } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (loading) return;
    if (!session) {
      navigate({ to: "/login" });
    } else if (profile?.role === "admin") {
      navigate({ to: "/admin/dashboard" });
    } else {
      navigate({ to: "/colaborador/dashboard" });
    }
  }, [loading, session, profile, navigate]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="flex items-center gap-3 text-muted-foreground">
        <div className="h-10 w-10 rounded-lg bg-primary flex items-center justify-center animate-pulse">
          <Wallet className="h-5 w-5 text-primary-foreground" />
        </div>
        <span className="text-sm">Carregando Splash Creators…</span>
      </div>
    </div>
  );
}
