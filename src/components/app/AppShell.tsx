import { useState, type ReactNode } from "react";
import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";
import {
  LayoutDashboard, FileSpreadsheet, FileText, Percent,
  CalendarCheck, Users, HandCoins, LogOut, Wallet, Menu, X, UserCog,
} from "lucide-react";

interface NavItem {
  to: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  adminOnly?: boolean;
}

const allNav: NavItem[] = [
  { to: "/admin/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/admin/posts", label: "Posts", icon: FileText },
  { to: "/admin/fechamentos", label: "Fechamentos", icon: CalendarCheck },
  { to: "/admin/colaboradores", label: "Equipe", icon: Users },
  { to: "/admin/importacoes", label: "Importações", icon: FileSpreadsheet },
  { to: "/admin/regras-split", label: "Regras de Split", icon: Percent },
  { to: "/admin/bonus-manual", label: "Bônus Manual", icon: HandCoins },
  { to: "/admin/cadastro", label: "Cadastro", icon: UserCog, adminOnly: true },
];

export function AppShell({ children }: { children: ReactNode }) {
  const { profile, signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const isAdmin = profile?.role === "admin";
  const adminNav = allNav.filter((item) => !item.adminOnly || isAdmin);

  const handleLogout = async () => {
    await signOut();
    navigate({ to: "/login" });
  };

  const currentPage = adminNav.find(
    (item) => location.pathname === item.to || location.pathname.startsWith(item.to + "/")
  );

  return (
    <div className="min-h-screen bg-background flex">
      {/* ── Desktop sidebar ─────────────────────────────── */}
      <aside className="hidden lg:flex w-64 flex-col border-r border-border bg-sidebar h-screen sticky top-0 overflow-hidden">
        <SidebarContent
          nav={adminNav}
          pathname={location.pathname}
          onLogout={handleLogout}
          profile={profile}
        />
      </aside>

      {/* ── Mobile drawer overlay ────────────────────────── */}
      {drawerOpen && (
        <div className="lg:hidden fixed inset-0 z-50 flex">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setDrawerOpen(false)}
          />
          <div className="relative w-72 bg-sidebar h-full shadow-xl flex flex-col">
            <div className="flex items-center justify-between h-14 px-4 border-b border-border shrink-0">
              <div className="flex items-center gap-2.5">
                <div className="h-7 w-7 rounded-lg bg-white/10 flex items-center justify-center">
                  <Wallet className="h-3.5 w-3.5 text-white" />
                </div>
                <span className="font-semibold text-sm text-sidebar-foreground">Rateio Creator</span>
              </div>
              <button
                onClick={() => setDrawerOpen(false)}
                className="p-1.5 rounded-md text-muted-foreground hover:bg-accent"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <nav className="flex-1 px-3 py-3 space-y-0.5 overflow-y-auto">
              {adminNav.map((item) => {
                const active =
                  location.pathname === item.to ||
                  location.pathname.startsWith(item.to + "/");
                const Icon = item.icon;
                return (
                  <Link
                    key={item.to}
                    to={item.to}
                    onClick={() => setDrawerOpen(false)}
                    className={cn(
                      "flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors",
                      active
                        ? "bg-white/10 text-white font-semibold"
                        : "text-sidebar-foreground hover:bg-accent"
                    )}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    {item.label}
                  </Link>
                );
              })}
            </nav>

            <div className="border-t border-border p-3 shrink-0">
              <div className="px-3 py-2">
                <p className="text-sm font-medium text-sidebar-foreground">{profile?.nome}</p>
                <p className="text-xs text-muted-foreground truncate">{profile?.email}</p>
              </div>
              <button
                onClick={handleLogout}
                className="w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm text-muted-foreground hover:bg-accent transition-colors"
              >
                <LogOut className="h-4 w-4" />
                Sair da conta
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Main content ─────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Mobile top header */}
        <header className="lg:hidden sticky top-0 z-20 flex items-center gap-3 border-b border-border bg-background/95 backdrop-blur-md px-4 h-12 shrink-0">
          <button
            onClick={() => setDrawerOpen(true)}
            className="p-1.5 -ml-1 rounded-md text-muted-foreground hover:bg-accent"
          >
            <Menu className="h-5 w-5" />
          </button>

          <div className="flex items-center gap-1.5 min-w-0">
            <div className="h-6 w-6 rounded-md bg-white/10 flex items-center justify-center shrink-0">
              <Wallet className="h-3 w-3 text-white" />
            </div>
            <span className="text-sm font-semibold text-foreground truncate">
              {currentPage?.label ?? "Rateio Creator"}
            </span>
          </div>
        </header>

        <main className="flex-1 overflow-x-hidden">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-5 lg:py-10">
            {children}
          </div>
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
      <div className="h-16 flex items-center gap-2.5 px-5 border-b border-border shrink-0">
        <div className="h-8 w-8 rounded-xl bg-white/10 flex items-center justify-center shadow-sm">
          <Wallet className="h-4 w-4 text-white" />
        </div>
        <div className="flex flex-col">
          <span className="font-bold leading-tight text-sidebar-foreground">Rateio Creator</span>
          <span className="text-[10px] uppercase tracking-wider text-sidebar-foreground/50">
            {profile?.role === "admin" ? "Administração" : "Colaborador"}
          </span>
        </div>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
        {nav.map((item) => {
          const active = pathname === item.to || pathname.startsWith(item.to + "/");
          const Icon = item.icon;
          return (
            <Link
              key={item.to}
              to={item.to}
              className={cn(
                "flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-colors",
                active
                  ? "bg-white/10 text-white font-semibold"
                  : "text-neutral-400 hover:bg-white/5 hover:text-white"
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-border p-3 shrink-0">
        <div className="px-3 py-2 text-xs text-muted-foreground">
          <p className="font-medium text-sidebar-foreground truncate">{profile?.nome}</p>
          <p className="text-[11px] truncate mt-0.5">{profile?.email}</p>
        </div>
        <button
          onClick={onLogout}
          className="w-full flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm text-muted-foreground hover:bg-white/5 hover:text-white transition-colors"
        >
          <LogOut className="h-4 w-4" />
          Sair
        </button>
      </div>
    </>
  );
}
