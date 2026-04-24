import { useState, type ReactNode } from "react";
import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";
import {
  LayoutDashboard,
  FileSpreadsheet,
  FileText,
  Percent,
  CalendarCheck,
  Users,
  LogOut,
  Wallet,
  Menu,
  X,
} from "lucide-react";

interface NavItem {
  to: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

const adminNav: NavItem[] = [
  { to: "/admin/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/admin/importacoes", label: "Importações", icon: FileSpreadsheet },
  { to: "/admin/posts", label: "Posts", icon: FileText },
  { to: "/admin/regras-split", label: "Regras de Split", icon: Percent },
  { to: "/admin/fechamentos", label: "Fechamentos", icon: CalendarCheck },
  { to: "/admin/colaboradores", label: "Colaboradores", icon: Users },
];

const colabNav: NavItem[] = [
  { to: "/colaborador/dashboard", label: "Meu Painel", icon: LayoutDashboard },
];

export function AppShell({ children }: { children: ReactNode }) {
  const { profile, signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);

  const nav = profile?.role === "admin" ? adminNav : colabNav;

  const handleLogout = async () => {
    await signOut();
    navigate({ to: "/login" });
  };

  return (
    <div className="min-h-screen bg-background flex">
      {/* Sidebar desktop */}
      <aside className="hidden lg:flex w-64 flex-col border-r border-border bg-sidebar">
        <SidebarContent nav={nav} pathname={location.pathname} onLogout={handleLogout} profile={profile} />
      </aside>

      {/* Sidebar mobile */}
      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 z-40 flex">
          <div className="fixed inset-0 bg-foreground/40" onClick={() => setMobileOpen(false)} />
          <aside className="relative z-50 w-64 flex flex-col bg-sidebar border-r border-border">
            <button
              onClick={() => setMobileOpen(false)}
              className="absolute top-3 right-3 p-2 rounded-md hover:bg-accent"
              aria-label="Fechar menu"
            >
              <X className="h-4 w-4" />
            </button>
            <SidebarContent nav={nav} pathname={location.pathname} onLogout={handleLogout} profile={profile} />
          </aside>
        </div>
      )}

      <div className="flex-1 flex flex-col min-w-0">
        {/* Topbar mobile */}
        <header className="lg:hidden flex items-center gap-3 border-b border-border bg-card px-4 h-14">
          <button
            onClick={() => setMobileOpen(true)}
            className="p-2 -ml-2 rounded-md hover:bg-accent"
            aria-label="Abrir menu"
          >
            <Menu className="h-5 w-5" />
          </button>
          <div className="flex items-center gap-2">
            <div className="h-7 w-7 rounded-md bg-primary flex items-center justify-center">
              <Wallet className="h-4 w-4 text-primary-foreground" />
            </div>
            <span className="font-semibold">Rateio Creator</span>
          </div>
        </header>

        <main className="flex-1 overflow-x-hidden">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-6 lg:py-10">{children}</div>
        </main>
      </div>
    </div>
  );
}

function SidebarContent({
  nav,
  pathname,
  onLogout,
  profile,
}: {
  nav: NavItem[];
  pathname: string;
  onLogout: () => void;
  profile: ReturnType<typeof useAuth>["profile"];
}) {
  return (
    <>
      <div className="h-16 flex items-center gap-2 px-5 border-b border-border">
        <div className="h-8 w-8 rounded-md bg-primary flex items-center justify-center">
          <Wallet className="h-4 w-4 text-primary-foreground" />
        </div>
        <div className="flex flex-col">
          <span className="font-semibold leading-tight">Rateio Creator</span>
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
            {profile?.role === "admin" ? "Administração" : "Colaborador"}
          </span>
        </div>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-1">
        {nav.map((item) => {
          const active = pathname === item.to || pathname.startsWith(item.to + "/");
          const Icon = item.icon;
          return (
            <Link
              key={item.to}
              to={item.to}
              className={cn(
                "flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors",
                active
                  ? "bg-primary-soft text-accent-foreground font-medium"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground"
              )}
            >
              <Icon className="h-4 w-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-border p-3">
        <div className="px-3 py-2 text-xs text-muted-foreground truncate">
          {profile?.nome}
          <div className="text-[11px] truncate">{profile?.email}</div>
        </div>
        <button
          onClick={onLogout}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
        >
          <LogOut className="h-4 w-4" />
          Sair
        </button>
      </div>
    </>
  );
}
