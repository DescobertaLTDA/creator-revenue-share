import { useState, type ReactNode } from "react";
import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";
import {
  LayoutDashboard, FileSpreadsheet, FileText, Percent,
  CalendarCheck, Users, HandCoins, LogOut, Menu, X, UserCog, Target, TrendingUp, BarChart3, Coins,
} from "lucide-react";
import LOGO from "@/assets/logo.webp";

interface NavItem {
  to: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  adminOnly?: boolean;
}

const allNav: NavItem[] = [
  { to: "/admin/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/admin/metas", label: "Metas", icon: Target },
  { to: "/admin/monetizacao", label: "Monetização", icon: TrendingUp },
  { to: "/admin/projecoes", label: "Projeções", icon: BarChart3 },
  { to: "/admin/posts", label: "Analytics", icon: FileText },
  { to: "/admin/fechamentos", label: "Fechamentos", icon: CalendarCheck },
  { to: "/admin/colaboradores", label: "Equipe", icon: Users },
  { to: "/admin/importacoes", label: "Importações", icon: FileSpreadsheet },
  { to: "/admin/central-receita", label: "Central de Receita", icon: Coins },
  { to: "/admin/regras-split", label: "Regras de Split", icon: Percent },
  { to: "/admin/bonus-manual", label: "Histórico", icon: HandCoins },
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
      <aside className="hidden lg:flex w-64 flex-col border-r border-[#222222] bg-sidebar h-screen sticky top-0 overflow-hidden">
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
            className="absolute inset-0 bg-black/50"
            onClick={() => setDrawerOpen(false)}
          />
          <div className="relative w-[min(288px,85vw)] bg-sidebar h-full flex flex-col">
            <div className="flex items-center justify-between h-14 px-4 border-b border-[#222222] shrink-0">
              <div className="flex items-center gap-2.5">
                <img src={LOGO} alt="Splash Creators" className="h-7 w-7 object-contain rounded-md shrink-0" />
                <span className="font-semibold text-sm text-white">Splash Creators</span>
              </div>
              <button
                onClick={() => setDrawerOpen(false)}
                className="p-1.5 rounded-md text-white/60 hover:text-white hover:bg-white/10 transition-colors"
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
                      "flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors",
                      active
                        ? "bg-[#FAA613]/20 text-[#FAA613] font-semibold"
                        : "text-white/75 hover:bg-white/10 hover:text-white"
                    )}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    {item.label}
                  </Link>
                );
              })}
            </nav>

            <div className="border-t border-[#222222] p-3 shrink-0">
              <div className="px-3 py-2">
                <p className="text-sm font-medium text-white truncate">{profile?.nome}</p>
                <p className="text-xs text-white/50 truncate">{profile?.email}</p>
              </div>
              <button
                onClick={handleLogout}
                className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-white/60 hover:bg-white/10 hover:text-white transition-colors"
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
            <img src={LOGO} alt="Splash Creators" className="h-6 w-6 object-contain rounded shrink-0" />
            <span className="text-sm font-semibold text-foreground truncate">
              {currentPage?.label ?? "Splash Creators"}
            </span>
          </div>
        </header>

        <main className="flex-1 overflow-x-hidden">
          <div className="mx-auto max-w-7xl px-3 sm:px-6 lg:px-8 py-4 lg:py-10">
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
      <div className="h-16 flex items-center gap-3 px-5 border-b border-[#222222] shrink-0">
        <img src={LOGO} alt="Splash Creators" className="h-11 w-11 object-contain rounded-lg shrink-0" />
        <div className="flex flex-col">
          <span className="font-bold leading-tight text-white">Splash Creators</span>
          <span className="text-[10px] uppercase tracking-wider text-white/50">
            {profile?.role === "admin" ? "Administração" : profile?.role === "leitor" ? "Leitor" : "Colaborador"}
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
                  ? "bg-[#FAA613]/20 text-[#FAA613] font-semibold"
                  : "text-white/70 hover:bg-white/10 hover:text-white"
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-[#222222] p-3 shrink-0">
        <div className="px-3 py-2">
          <p className="font-semibold text-sm text-white truncate">{profile?.nome}</p>
          <p className="text-[11px] text-white/50 truncate mt-0.5">{profile?.email}</p>
        </div>
        <button
          onClick={onLogout}
          className="w-full flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm text-white/60 hover:bg-white/10 hover:text-white transition-colors"
        >
          <LogOut className="h-4 w-4" />
          Sair
        </button>
      </div>
    </>
  );
}
