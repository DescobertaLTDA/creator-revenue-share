import { useState, type ReactNode } from "react";
import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";
import {
  LayoutDashboard, FileSpreadsheet, FileText, Percent,
  CalendarCheck, Users, HandCoins, LogOut, Wallet, MoreHorizontal, X,
} from "lucide-react";

interface NavItem {
  to: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

const adminBottomNav: NavItem[] = [
  { to: "/admin/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/admin/posts", label: "Posts", icon: FileText },
  { to: "/admin/fechamentos", label: "Fechamentos", icon: CalendarCheck },
  { to: "/admin/colaboradores", label: "Equipe", icon: Users },
  { to: "/admin/importacoes", label: "Importar", icon: FileSpreadsheet },
];

const adminMoreNav: NavItem[] = [
  { to: "/admin/regras-split", label: "Regras de Split", icon: Percent },
  { to: "/admin/bonus-manual", label: "Bônus Manual", icon: HandCoins },
];

const adminAllNav: NavItem[] = [...adminBottomNav, ...adminMoreNav];

const colabNav: NavItem[] = [
  { to: "/colaborador/dashboard", label: "Meu Painel", icon: LayoutDashboard },
];

export function AppShell({ children }: { children: ReactNode }) {
  const { profile, signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [moreOpen, setMoreOpen] = useState(false);

  const isAdmin = profile?.role === "admin";
  const bottomNav = isAdmin ? adminBottomNav : colabNav;
  const moreNav = isAdmin ? adminMoreNav : [];
  const sidebarNav = isAdmin ? adminAllNav : colabNav;

  const handleLogout = async () => {
    await signOut();
    navigate({ to: "/login" });
  };

  const isMoreActive = moreNav.some(
    (item) => location.pathname === item.to || location.pathname.startsWith(item.to + "/")
  );

  return (
    <div className="min-h-screen bg-background flex">
      {/* ── Desktop sidebar ─────────────────────────────── */}
      <aside className="hidden lg:flex w-64 flex-col border-r border-border bg-sidebar h-screen sticky top-0 overflow-hidden">
        <SidebarContent
          nav={sidebarNav}
          pathname={location.pathname}
          onLogout={handleLogout}
          profile={profile}
        />
      </aside>

      {/* ── Mobile "Mais" bottom sheet ───────────────────── */}
      {moreOpen && (
        <div className="lg:hidden fixed inset-0 z-50 flex flex-col justify-end">
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setMoreOpen(false)}
          />
          <div className="relative bg-sidebar rounded-t-2xl shadow-2xl">
            {/* drag handle */}
            <div className="flex justify-center pt-3 pb-1">
              <div className="h-1 w-10 rounded-full bg-border" />
            </div>

            <div className="px-4 pb-2 pt-1 flex items-center justify-between">
              <span className="font-semibold text-sm text-sidebar-foreground">Menu</span>
              <button
                onClick={() => setMoreOpen(false)}
                className="p-2 rounded-lg hover:bg-accent text-muted-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="px-3 space-y-1 pb-2">
              {moreNav.map((item) => {
                const active =
                  location.pathname === item.to ||
                  location.pathname.startsWith(item.to + "/");
                const Icon = item.icon;
                return (
                  <Link
                    key={item.to}
                    to={item.to}
                    onClick={() => setMoreOpen(false)}
                    className={cn(
                      "flex items-center gap-3 px-4 py-3.5 rounded-xl text-sm font-medium transition-colors",
                      active
                        ? "bg-primary text-primary-foreground"
                        : "text-sidebar-foreground hover:bg-accent"
                    )}
                  >
                    <Icon className="h-5 w-5" />
                    {item.label}
                  </Link>
                );
              })}
            </div>

            <div className="mx-3 mb-3 border-t border-border pt-3">
              <div className="px-4 py-2">
                <p className="text-sm font-medium text-sidebar-foreground">{profile?.nome}</p>
                <p className="text-xs text-muted-foreground truncate">{profile?.email}</p>
              </div>
              <button
                onClick={handleLogout}
                className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm text-muted-foreground hover:bg-accent transition-colors"
              >
                <LogOut className="h-5 w-5" />
                Sair da conta
              </button>
            </div>
            {/* safe area spacer */}
            <div className="h-safe-area-inset-bottom pb-2" />
          </div>
        </div>
      )}

      {/* ── Main content ─────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Mobile top bar */}
        <header className="lg:hidden sticky top-0 z-20 flex items-center gap-3 border-b border-border bg-sidebar/95 backdrop-blur-md px-4 h-14 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-xl bg-primary flex items-center justify-center shadow-sm">
              <Wallet className="h-4 w-4 text-primary-foreground" />
            </div>
            <div>
              <p className="font-bold text-sm leading-none text-sidebar-foreground">Rateio Creator</p>
              <p className="text-[10px] text-sidebar-foreground/50 leading-none mt-0.5">
                {profile?.role === "admin" ? "Administração" : "Colaborador"}
              </p>
            </div>
          </div>
        </header>

        <main className="flex-1 overflow-x-hidden pb-20 lg:pb-0">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-5 lg:py-10">
            {children}
          </div>
        </main>

        {/* Mobile bottom navigation */}
        <nav className="lg:hidden fixed bottom-0 inset-x-0 z-30 bg-sidebar/95 backdrop-blur-md border-t border-border">
          <div className="flex items-stretch h-16">
            {bottomNav.map((item) => {
              const active =
                location.pathname === item.to ||
                location.pathname.startsWith(item.to + "/");
              const Icon = item.icon;
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  className={cn(
                    "flex-1 flex flex-col items-center justify-center gap-1 py-2 text-[10px] font-medium transition-colors relative",
                    active ? "text-primary" : "text-muted-foreground"
                  )}
                >
                  {active && (
                    <span className="absolute top-0 left-1/2 -translate-x-1/2 h-0.5 w-8 bg-primary rounded-full" />
                  )}
                  <Icon className={cn("h-[22px] w-[22px]", active && "stroke-[2.5]")} />
                  <span className="leading-none truncate max-w-[52px] text-center px-0.5">
                    {item.label}
                  </span>
                </Link>
              );
            })}

            {moreNav.length > 0 && (
              <button
                onClick={() => setMoreOpen(true)}
                className={cn(
                  "flex-1 flex flex-col items-center justify-center gap-1 py-2 text-[10px] font-medium transition-colors relative",
                  isMoreActive ? "text-primary" : "text-muted-foreground"
                )}
              >
                {isMoreActive && (
                  <span className="absolute top-0 left-1/2 -translate-x-1/2 h-0.5 w-8 bg-primary rounded-full" />
                )}
                <MoreHorizontal className="h-[22px] w-[22px]" />
                <span className="leading-none">Mais</span>
              </button>
            )}
          </div>
          {/* safe area bottom */}
          <div className="h-safe-area-inset-bottom" />
        </nav>
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
        <div className="h-8 w-8 rounded-xl bg-primary flex items-center justify-center shadow-sm">
          <Wallet className="h-4 w-4 text-primary-foreground" />
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
                  ? "bg-primary text-primary-foreground font-semibold shadow-sm"
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
