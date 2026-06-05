import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, useRef, useCallback, useMemo } from "react";
import { PageHeader } from "@/components/app/PageHeader";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useWriteGuard } from "@/hooks/use-write-guard";
import { formatMonth, formatPct } from "@/lib/format";
import { toast } from "sonner";
import { Check, Loader2, ChevronLeft, ChevronRight, Info, Coins, ChevronDown, History, UserCircle } from "lucide-react";

export const Route = createFileRoute("/admin/bonus-manual")({
  head: () => ({ meta: [{ title: "Conciliação diária — Splash Creators" }] }),
  component: BonusManualPage,
});

// ─── Types ────────────────────────────────────────────────────────────────────

type Platform = "facebook" | "instagram";

interface PageOption {
  id: string;
  nome: string;
  isMonetized: boolean;
}

interface FieldEditor {
  nome: string;
  avatar: string | null;
}

interface DayEntry {
  date: string;
  label: string;
  weekday: string;
  posts_revenue: number;
  views: number;
  actual_views: number | null;
  actual_followers: number | null;
  total_followers: number | null;
  actual_revenue: number | null;
  distribution_mode: string;
  note: string;
  id: string | null;
  dirty: boolean;
  saving: boolean;
  saved: boolean;
  views_editors: FieldEditor[];
  followers_editors: FieldEditor[];
  revenue_editors: FieldEditor[];
  last_edited_field: "views" | "followers" | "revenue" | "total_followers" | null;
  _db_views: number | null;
  _db_followers: number | null;
  _db_revenue: number | null;
  _db_total_followers: number | null;
}

interface AuditEntry {
  id: string;
  created_at: string;
  actor_nome: string;
  actor_avatar: string | null;
  before_json: Record<string, unknown>;
  after_json: Record<string, unknown>;
  entity_id: string;
}

interface ColabDist {
  id: string;
  nome: string;
  hashtag: string | null;
  views: number;
  pct: number;
  bonus_estimated: number;
}

const WEEKDAYS_SHORT = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getLastChangedField(
  before: Record<string, unknown>,
  after: Record<string, unknown>
): "views" | "followers" | "revenue" | null {
  if (before.actual_views !== after.actual_views) return "views";
  if (before.actual_followers !== after.actual_followers) return "followers";
  if (before.actual_revenue_usd !== after.actual_revenue_usd) return "revenue";
  return null;
}

function AvatarStack({ editors }: { editors: FieldEditor[] }) {
  if (editors.length === 0) return null;
  const shown = editors.slice(0, 3);
  return (
    <div className="flex items-center shrink-0">
      {shown.map((editor, i) => (
        <div
          key={i}
          className="relative"
          style={{ marginLeft: i > 0 ? "-5px" : 0, zIndex: shown.length - i }}
          title={`Editado por ${editor.nome}`}
        >
          {editor.avatar ? (
            <img src={editor.avatar} alt={editor.nome} className="h-5 w-5 rounded-full object-cover border-[1.5px] border-background" />
          ) : (
            <div className="h-5 w-5 rounded-full bg-muted border-[1.5px] border-background flex items-center justify-center text-[9px] font-bold text-muted-foreground">
              {editor.nome[0].toUpperCase()}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function prevMonth(ref: string) {
  const [y, m] = ref.split("-").map(Number);
  const d = new Date(y, m - 2, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function nextMonth(ref: string) {
  const [y, m] = ref.split("-").map(Number);
  const d = new Date(y, m, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function daysInMonth(ref: string): string[] {
  const [y, m] = ref.split("-").map(Number);
  const count = new Date(y, m, 0).getDate();
  return Array.from({ length: count }, (_, i) =>
    `${ref}-${String(i + 1).padStart(2, "0")}`
  );
}

async function fetchViewsByColabForMonth(ref: string, pageId: string, platform: Platform): Promise<ColabDist[]> {
  const days = daysInMonth(ref);
  const from = days[0];
  const to = days[days.length - 1];

  const { data: postsData } = await supabase
    .from("posts")
    .select("id, views")
    .eq("page_id", pageId)
    .eq("source", platform)
    .gte("published_at", from)
    .lte("published_at", to + "T23:59:59");

  if (!postsData || postsData.length === 0) return [];

  const postIds = postsData.map((p: any) => p.id);
  const viewsByPost: Record<string, number> = {};
  for (const p of postsData as any[]) viewsByPost[p.id] = Number(p.views ?? 0);

  const { data: paData } = await supabase
    .from("post_authors")
    .select("post_id, collaborator_id")
    .in("post_id", postIds);

  const postColabMap: Record<string, string[]> = {};
  for (const pa of (paData ?? []) as any[]) {
    if (!postColabMap[pa.post_id]) postColabMap[pa.post_id] = [];
    postColabMap[pa.post_id].push(pa.collaborator_id);
  }

  const viewsByColab: Record<string, number> = {};
  for (const [postId, colabs] of Object.entries(postColabMap)) {
    const views = viewsByPost[postId] ?? 0;
    const share = views / colabs.length;
    for (const cid of colabs) viewsByColab[cid] = (viewsByColab[cid] ?? 0) + share;
  }

  const colabIds = Object.keys(viewsByColab);
  if (colabIds.length === 0) return [];

  const { data: colabData } = await supabase
    .from("collaborators")
    .select("id, nome, hashtag")
    .in("id", colabIds);

  const totalViews = Object.values(viewsByColab).reduce((a, b) => a + b, 0);

  return ((colabData ?? []) as any[])
    .map((c) => ({
      id: c.id,
      nome: c.nome,
      hashtag: c.hashtag ?? null,
      views: Math.round(viewsByColab[c.id] ?? 0),
      pct: totalViews > 0 ? (viewsByColab[c.id] ?? 0) / totalViews : 0,
      bonus_estimated: 0,
    }))
    .sort((a, b) => b.views - a.views);
}

// ─── PageSelect ───────────────────────────────────────────────────────────────

function PageSelect({
  pages,
  value,
  onChange,
  igPageIds,
  platform,
}: {
  pages: PageOption[];
  value: string;
  onChange: (v: string) => void;
  igPageIds: Set<string>;
  platform: Platform;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  // Filter pages by platform: IG tab → only pages with IG posts; FB tab → only pages without IG posts
  const filtered = pages.filter((p) =>
    platform === "instagram" ? igPageIds.has(p.id) : !igPageIds.has(p.id)
  );

  const selected = pages.find((p) => p.id === value);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className={`h-10 min-w-[220px] flex items-center gap-2 px-3 rounded-xl border text-sm transition-colors bg-white ${
          open ? "border-[#F44708] ring-2 ring-[#F44708]/20" : "border-border hover:border-[#c4b5d8]"
        }`}
      >
        {selected ? (
          <span className="flex-1 truncate text-left font-medium text-foreground">{selected.nome}</span>
        ) : (
          <span className="flex-1 text-left text-muted-foreground">Selecionar…</span>
        )}
        <ChevronDown className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="absolute z-50 top-full mt-1 left-0 min-w-full w-max max-w-xs bg-white border border-border rounded-xl shadow-lg overflow-hidden">
          <div className="max-h-64 overflow-y-auto p-1">
            {filtered.length === 0 && (
              <p className="px-3 py-4 text-xs text-center text-muted-foreground">Nenhuma página encontrada</p>
            )}
            {filtered.map((p) => (
              <button
                key={p.id}
                onClick={() => { onChange(p.id); setOpen(false); }}
                className={`w-full flex items-center px-3 py-2 rounded-lg text-sm text-left transition-colors ${
                  value === p.id
                    ? "bg-[#F44708] text-white font-semibold"
                    : "text-foreground hover:bg-muted"
                }`}
              >
                <span className="truncate">{p.nome}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Platform Tab ─────────────────────────────────────────────────────────────

function PlatformTabs({
  value,
  onChange,
}: {
  value: Platform;
  onChange: (v: Platform) => void;
}) {
  return (
    <div className="inline-flex items-center bg-muted rounded-xl p-1 gap-1">
      <button
        onClick={() => onChange("facebook")}
        className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all ${
          value === "facebook"
            ? "bg-[#1877F2] text-white shadow-sm"
            : "text-muted-foreground hover:text-foreground"
        }`}
      >
        {/* Facebook "f" icon via SVG */}
        <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="currentColor">
          <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
        </svg>
        Facebook
      </button>
      <button
        onClick={() => onChange("instagram")}
        className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all ${
          value === "instagram"
            ? "bg-gradient-to-r from-[#833AB4] via-[#FD1D1D] to-[#F77737] text-white shadow-sm"
            : "text-muted-foreground hover:text-foreground"
        }`}
      >
        {/* Instagram icon via SVG */}
        <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z"/>
        </svg>
        Instagram
      </button>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

function BonusManualPage() {
  const { profile } = useAuth();
  const { guard, canWrite, WriteGuardDialog } = useWriteGuard();
  const todayMonth = new Date().toISOString().slice(0, 7);
  const [platform, setPlatform] = useState<Platform>("facebook");
  const [monthRef, setMonthRef] = useState(todayMonth);
  const [pages, setPages] = useState<PageOption[]>([]);
  const [selectedPageId, setSelectedPageId] = useState<string>("");
  const [rows, setRows] = useState<DayEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [colabDist, setColabDist] = useState<ColabDist[]>([]);
  const [distLoading, setDistLoading] = useState(false);
  const [viewsFocusDate, setViewsFocusDate] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"receita" | "transparencia">("receita");
  const [auditLogs, setAuditLogs] = useState<AuditEntry[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [followersFocusDate, setFollowersFocusDate] = useState<string | null>(null);
  const [totalFollowersFocusDate, setTotalFollowersFocusDate] = useState<string | null>(null);
  const saveTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  // Ref always pointing to latest rows — used for propagation without stale closure
  const rowsRef = useRef<DayEntry[]>([]);
  useEffect(() => { rowsRef.current = rows; }, [rows]);

  const isIG = platform === "instagram";
  const [igPageIds, setIgPageIds] = useState<Set<string>>(new Set());
  const [igPostCounts, setIgPostCounts] = useState<Map<string, number>>(new Map());

  // Load pages list once
  useEffect(() => {
    async function loadPages() {
      const { data: pagesData } = await supabase
        .from("pages")
        .select("id, nome")
        .order("nome");

      if (!pagesData || pagesData.length === 0) return;

      const [{ data: revPosts }, { data: igPosts }] = await Promise.all([
        supabase
          .from("posts")
          .select("page_id, monetization_approx, estimated_usd")
          .or("monetization_approx.gt.0,estimated_usd.gt.0"),
        supabase
          .from("posts")
          .select("page_id")
          .eq("source", "instagram"),
      ]);

      const revCounts = new Map<string, number>();
      for (const p of (revPosts ?? []) as any[]) {
        revCounts.set(p.page_id, (revCounts.get(p.page_id) ?? 0) + 1);
      }

      const igIds = new Set<string>();
      const igCounts = new Map<string, number>();
      for (const p of (igPosts ?? []) as any[]) {
        igIds.add(p.page_id);
        igCounts.set(p.page_id, (igCounts.get(p.page_id) ?? 0) + 1);
      }
      setIgPageIds(igIds);
      setIgPostCounts(igCounts);

      const list: PageOption[] = (pagesData as any[]).map((p) => ({
        id: p.id,
        nome: p.nome,
        isMonetized: (revCounts.get(p.id) ?? 0) >= 3,
      }));

      setPages(list);
      const first = list.find((p) => p.isMonetized) ?? list[0];
      if (first) setSelectedPageId(first.id);
    }
    loadPages();
  }, []);

  const buildRows = useCallback(
    (
      days: string[],
      postsByDay: Record<string, number>,
      viewsByDay: Record<string, number>,
      dbEntries: Record<string, any>,
      fieldEditorsByDate: Map<string, { views: FieldEditor[]; followers: FieldEditor[]; revenue: FieldEditor[] }>
    ): DayEntry[] => {
      return days.map((date) => {
        const d = new Date(date + "T00:00:00");
        const db = dbEntries[date];
        const fe = fieldEditorsByDate.get(date) ?? { views: [], followers: [], revenue: [] };
        return {
          date,
          label: `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`,
          weekday: WEEKDAYS_SHORT[d.getDay()],
          posts_revenue: postsByDay[date] ?? 0,
          views: viewsByDay[date] ?? 0,
          actual_views: db?.actual_views ?? null,
          actual_followers: db?.actual_followers ?? null,
          total_followers: db?.total_followers ?? null,
          actual_revenue: db?.actual_revenue_usd ?? null,
          distribution_mode: db?.distribution_mode ?? "hybrid",
          note: db?.note ?? "",
          id: db?.id ?? null,
          dirty: false,
          saving: false,
          saved: false,
          views_editors: fe.views,
          followers_editors: fe.followers,
          revenue_editors: fe.revenue,
          last_edited_field: null,
          _db_views: db?.actual_views ?? null,
          _db_followers: db?.actual_followers ?? null,
          _db_revenue: db?.actual_revenue_usd ?? null,
          _db_total_followers: db?.total_followers ?? null,
        };
      });
    },
    []
  );

  const load = useCallback(async (ref: string, pageId: string, plat: Platform) => {
    if (!pageId) return;
    setLoading(true);
    const days = daysInMonth(ref);
    const from = days[0];
    const to = days[days.length - 1];

    // For Facebook: match source = 'facebook' OR source is null (legacy rows)
    const postsQuery = plat === "facebook"
      ? supabase.from("posts").select("published_at, monetization_approx, views")
          .eq("page_id", pageId)
          .or("source.eq.facebook,source.is.null")
          .gte("published_at", from)
          .lte("published_at", to + "T23:59:59")
      : supabase.from("posts").select("published_at, monetization_approx, views")
          .eq("page_id", pageId)
          .eq("source", "instagram")
          .gte("published_at", from)
          .lte("published_at", to + "T23:59:59");

    const [{ data: postsData }, { data: dbData }, { data: auditData }] = await Promise.all([
      postsQuery,
      (supabase as any)
        .from("daily_revenue_entries")
        .select("id, entry_date, actual_revenue_usd, actual_views, actual_followers, total_followers, distribution_mode, note, updated_by")
        .eq("page_id", pageId)
        .eq("platform", plat)
        .gte("entry_date", from)
        .lte("entry_date", to),
      (supabase as any)
        .from("audit_logs")
        .select("entity_id, actor_profile_id, before_json, after_json")
        .eq("action", "update_daily_revenue")
        .like("entity_id", `${plat}:${ref}-%:${pageId}`)
        .order("created_at", { ascending: false }),
    ]);

    const postsByDay: Record<string, number> = {};
    const viewsByDay: Record<string, number> = {};
    for (const p of (postsData ?? []) as any[]) {
      if (!p.published_at) continue;
      const day = p.published_at.slice(0, 10);
      postsByDay[day] = (postsByDay[day] ?? 0) + Number(p.monetization_approx ?? 0);
      viewsByDay[day] = (viewsByDay[day] ?? 0) + Number(p.views ?? 0);
    }

    const dbEntries: Record<string, any> = {};
    for (const e of (dbData ?? []) as any[]) {
      dbEntries[e.entry_date] = e;
    }

    const fieldEditorIds = new Map<string, { views: string[]; followers: string[]; revenue: string[] }>();
    const allActorIds = new Set<string>();
    for (const audit of (auditData ?? []) as any[]) {
      // entity_id format: "platform:date:pageId"
      const parts = audit.entity_id.split(":");
      const date = parts[1] ?? audit.entity_id.split(":")[0];
      if (!fieldEditorIds.has(date)) fieldEditorIds.set(date, { views: [], followers: [], revenue: [] });
      const entry = fieldEditorIds.get(date)!;
      const before = audit.before_json ?? {};
      const after = audit.after_json ?? {};
      const actorId: string | null = audit.actor_profile_id ?? null;
      if (!actorId) continue;
      if (before.actual_views !== after.actual_views && !entry.views.includes(actorId)) {
        entry.views.push(actorId);
        allActorIds.add(actorId);
      }
      if (before.actual_followers !== after.actual_followers && !entry.followers.includes(actorId)) {
        entry.followers.push(actorId);
        allActorIds.add(actorId);
      }
      if (before.actual_revenue_usd !== after.actual_revenue_usd && !entry.revenue.includes(actorId)) {
        entry.revenue.push(actorId);
        allActorIds.add(actorId);
      }
    }

    const profileCache = new Map<string, FieldEditor>();
    if (allActorIds.size > 0) {
      const { data: profileRows } = await supabase
        .from("profiles")
        .select("id, nome, avatar_url")
        .in("id", [...allActorIds]);
      for (const p of (profileRows ?? []) as any[]) {
        profileCache.set(p.id, { nome: p.nome, avatar: p.avatar_url ?? null });
      }
    }

    const fieldEditorsByDate = new Map<string, { views: FieldEditor[]; followers: FieldEditor[]; revenue: FieldEditor[] }>();
    for (const [date, ids] of fieldEditorIds) {
      fieldEditorsByDate.set(date, {
        views: ids.views.map((id) => profileCache.get(id)).filter(Boolean) as FieldEditor[],
        followers: ids.followers.map((id) => profileCache.get(id)).filter(Boolean) as FieldEditor[],
        revenue: ids.revenue.map((id) => profileCache.get(id)).filter(Boolean) as FieldEditor[],
      });
    }

    setRows(buildRows(days, postsByDay, viewsByDay, dbEntries, fieldEditorsByDate));
    setLoading(false);
  }, [buildRows]);

  const loadDist = useCallback(async (ref: string, pageId: string, plat: Platform) => {
    if (!pageId) return;
    setDistLoading(true);
    const prev = prevMonth(ref);
    const dist = await fetchViewsByColabForMonth(prev, pageId, plat);
    setColabDist(dist);
    setDistLoading(false);
  }, []);

  const loadAuditLogs = useCallback(async (ref: string, pageId: string, plat: Platform) => {
    if (!pageId) return;
    setAuditLoading(true);

    const { data: logs } = await (supabase as any)
      .from("audit_logs")
      .select("id, created_at, actor_profile_id, before_json, after_json, entity_id")
      .eq("action", "update_daily_revenue")
      .like("entity_id", `${plat}:${ref}-%:${pageId}`)
      .order("created_at", { ascending: false });

    if (!logs || logs.length === 0) { setAuditLogs([]); setAuditLoading(false); return; }

    const actorIds = [...new Set((logs as any[]).map((l: any) => l.actor_profile_id).filter(Boolean))];
    const { data: profileRows } = await supabase.from("profiles").select("id, nome, avatar_url").in("id", actorIds);
    const nameMap = new Map((profileRows ?? []).map((p: any) => [p.id, p.nome]));
    const avatarMap = new Map((profileRows ?? []).map((p: any) => [p.id, p.avatar_url ?? null]));

    setAuditLogs((logs as any[]).map((l: any) => ({
      id: l.id,
      created_at: l.created_at,
      actor_nome: nameMap.get(l.actor_profile_id) ?? "Usuário",
      actor_avatar: avatarMap.get(l.actor_profile_id) ?? null,
      before_json: l.before_json ?? {},
      after_json: l.after_json ?? {},
      entity_id: l.entity_id,
    })));
    setAuditLoading(false);
  }, []);

  useEffect(() => {
    if (!selectedPageId) return;
    load(monthRef, selectedPageId, platform);
    loadDist(monthRef, selectedPageId, platform);
    loadAuditLogs(monthRef, selectedPageId, platform);
  }, [monthRef, selectedPageId, platform, load, loadDist, loadAuditLogs]);

  const updateRow = (date: string, updates: Partial<DayEntry>) => {
    setRows((prev) =>
      prev.map((r) => r.date === date ? { ...r, ...updates, dirty: true, saved: false } : r)
    );
  };

  // ── Auto-propagate total_followers ──────────────────────────────────────────
  // Fórmula: total[dia] = total[dia+1] - ganho[dia]  (para trás)
  //          total[dia] = total[dia-1] + ganho[dia]  (para frente)
  const propagateTotalFollowers = useCallback(async (
    anchorDate: string,
    anchorTotal: number,
    currentRows: DayEntry[]
  ) => {
    if (!selectedPageId || !profile) return;

    const sorted = [...currentRows].sort((a, b) => a.date.localeCompare(b.date));
    const anchorIdx = sorted.findIndex((r) => r.date === anchorDate);
    if (anchorIdx === -1) return;

    const computed: { date: string; total: number }[] = [];

    // Inclui âncora
    computed.push({ date: anchorDate, total: anchorTotal });

    // ← Para trás: total[i] = total[i+1] - ganho[i]
    let running = anchorTotal;
    for (let i = anchorIdx - 1; i >= 0; i--) {
      const gain = sorted[i].actual_followers ?? 0;
      running = running - gain;
      computed.push({ date: sorted[i].date, total: running });
    }

    // → Para frente: total[i] = total[i-1] + ganho[i]
    running = anchorTotal;
    for (let i = anchorIdx + 1; i < sorted.length; i++) {
      const gain = sorted[i].actual_followers ?? 0;
      running = running + gain;
      computed.push({ date: sorted[i].date, total: running });
    }

    // Atualiza UI
    setRows((prev) => prev.map((r) => {
      const c = computed.find((x) => x.date === r.date);
      return c ? { ...r, total_followers: c.total, _db_total_followers: c.total } : r;
    }));

    // Salva no banco
    for (const { date, total } of computed) {
      await (supabase as any)
        .from("daily_revenue_entries")
        .upsert({
          entry_date: date,
          page_id: selectedPageId,
          platform,
          total_followers: total,
          updated_at: new Date().toISOString(),
          updated_by: profile.id,
          created_by: profile.id,
        }, { onConflict: "entry_date,page_id,platform" });
    }

    toast.success(`Total Seguidores calculado para ${computed.length} dias`);
  }, [selectedPageId, platform, profile]);

  const saveRow = async (row: DayEntry) => {
    if (!selectedPageId || !profile) return;
    setRows((prev) => prev.map((r) => r.date === row.date ? { ...r, saving: true } : r));

    const before = {
      actual_views: row._db_views,
      actual_followers: row._db_followers,
      actual_revenue_usd: row._db_revenue,
      total_followers: row._db_total_followers,
    };

    const payload = {
      entry_date: row.date,
      page_id: selectedPageId,
      platform,
      actual_revenue_usd: row.actual_revenue,
      actual_views: row.actual_views,
      actual_followers: row.actual_followers,
      total_followers: row.total_followers,
      distribution_mode: row.distribution_mode,
      note: row.note.trim() || null,
      updated_at: new Date().toISOString(),
      updated_by: profile.id,
      created_by: profile.id,
    };
    const { data, error } = await (supabase as any)
      .from("daily_revenue_entries")
      .upsert(payload, { onConflict: "entry_date,page_id,platform" })
      .select("id")
      .single();

    if (error) {
      toast.error("Erro ao salvar", { description: error.message });
      setRows((prev) => prev.map((r) => r.date === row.date ? { ...r, saving: false } : r));
    } else {
      if (data) {
        const after = {
          actual_views: row.actual_views,
          actual_followers: row.actual_followers,
          actual_revenue_usd: row.actual_revenue,
        };
        await (supabase as any).from("audit_logs").insert({
          actor_profile_id: profile.id,
          action: "update_daily_revenue",
          entity: "daily_revenue_entry",
          // New format: "platform:date:pageId"
          entity_id: `${platform}:${row.date}:${selectedPageId}`,
          before_json: before,
          after_json: after,
        });
      }
      const editor: FieldEditor = { nome: profile.nome, avatar: profile.avatar_url ?? null };
      setRows((prev) => prev.map((r) => {
        if (r.date !== row.date) return r;
        const f = row.last_edited_field;
        const prependEditor = (arr: FieldEditor[]) => [editor, ...arr.filter((e) => e.nome !== editor.nome)];
        return {
          ...r,
          id: data?.id ?? r.id,
          saving: false,
          dirty: false,
          saved: true,
          views_editors: f === "views" ? prependEditor(r.views_editors) : r.views_editors,
          followers_editors: f === "followers" ? prependEditor(r.followers_editors) : r.followers_editors,
          revenue_editors: f === "revenue" ? prependEditor(r.revenue_editors) : r.revenue_editors,
          _db_views: row.actual_views,
          _db_followers: row.actual_followers,
          _db_revenue: row.actual_revenue,
          _db_total_followers: row.total_followers,
        };
      }));
      setTimeout(() => setRows((prev) => prev.map((r) => r.date === row.date ? { ...r, saved: false } : r)), 2000);

      // Auto-propagate total_followers quando o campo foi editado
      if (row.last_edited_field === "total_followers" && row.total_followers != null) {
        propagateTotalFollowers(row.date, row.total_followers, rowsRef.current);
      }
    }
  };

  const handleActualChange = (row: DayEntry, raw: string) => {
    const val = raw === "" ? null : parseFloat(raw);
    updateRow(row.date, { actual_revenue: Number.isFinite(val) ? val : null, last_edited_field: "revenue" });
    clearTimeout(saveTimers.current[row.date]);
    saveTimers.current[row.date] = setTimeout(() => {
      setRows((prev) => {
        const updated = prev.find((r) => r.date === row.date);
        if (updated) saveRow(updated);
        return prev;
      });
    }, 800);
  };

  const handleViewsChange = (row: DayEntry, raw: string) => {
    const digits = raw.replace(/\D/g, "");
    const val = digits === "" ? null : parseInt(digits, 10);
    updateRow(row.date, { actual_views: val, last_edited_field: "views" });
    clearTimeout(saveTimers.current[row.date + "_views"]);
    saveTimers.current[row.date + "_views"] = setTimeout(() => {
      setRows((prev) => {
        const updated = prev.find((r) => r.date === row.date);
        if (updated) saveRow(updated);
        return prev;
      });
    }, 800);
  };

  const handleFollowersChange = (row: DayEntry, raw: string) => {
    const digits = raw.replace(/\D/g, "");
    const val = digits === "" ? null : parseInt(digits, 10);
    updateRow(row.date, { actual_followers: val, last_edited_field: "followers" });
    clearTimeout(saveTimers.current[row.date + "_followers"]);
    saveTimers.current[row.date + "_followers"] = setTimeout(() => {
      setRows((prev) => {
        const updated = prev.find((r) => r.date === row.date);
        if (updated) saveRow(updated);
        return prev;
      });
    }, 800);
  };

  const handleTotalFollowersChange = (row: DayEntry, raw: string) => {
    const digits = raw.replace(/\D/g, "");
    const val = digits === "" ? null : parseInt(digits, 10);
    updateRow(row.date, { total_followers: val, last_edited_field: "total_followers" });
    clearTimeout(saveTimers.current[row.date + "_total_followers"]);
    saveTimers.current[row.date + "_total_followers"] = setTimeout(() => {
      setRows((prev) => {
        const updated = prev.find((r) => r.date === row.date);
        if (updated) saveRow(updated);
        return prev;
      });
    }, 800);
  };

  const handleFollowersKeyDown = (e: React.KeyboardEvent<HTMLInputElement>, date: string) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const inputs = Array.from(document.querySelectorAll<HTMLInputElement>("[data-followers-input]"))
        .filter((el) => el.offsetParent !== null);
      const idx = inputs.findIndex((el) => el.dataset.followersInput === date);
      if (idx >= 0 && idx < inputs.length - 1) inputs[idx + 1].focus();
    }
  };

  const handleViewsKeyDown = (e: React.KeyboardEvent<HTMLInputElement>, date: string) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const inputs = Array.from(document.querySelectorAll<HTMLInputElement>("[data-views-input]"))
        .filter((el) => el.offsetParent !== null);
      const idx = inputs.findIndex((el) => el.dataset.viewsInput === date);
      if (idx >= 0 && idx < inputs.length - 1) inputs[idx + 1].focus();
    }
  };

  const handleFieldBlur = guard((row: DayEntry) => { if (row.dirty) saveRow(row); });

  const totalPosts = rows.reduce((s, r) => s + r.posts_revenue, 0);
  const totalActual = rows.reduce((s, r) => s + (r.actual_revenue ?? 0), 0);
  const totalBonus = totalActual - totalPosts;
  const totalViews = rows.reduce((s, r) => s + (r.actual_views ?? r.views), 0);
  const filledDays = rows.filter((r) => r.actual_revenue != null).length;

  const fmtViews = (n: number) => n.toLocaleString("pt-BR");

  const distWithBonus: ColabDist[] = useMemo(() => {
    if (totalBonus <= 0) return colabDist.map((c) => ({ ...c, bonus_estimated: 0 }));
    return colabDist.map((c) => ({ ...c, bonus_estimated: totalBonus * c.pct }));
  }, [colabDist, totalBonus]);

  const prevMonthRef = prevMonth(monthRef);
  const selectedPage = pages.find((p) => p.id === selectedPageId);

  // Labels that change per platform
  const followersLabel = isIG ? "Seguimentos" : "Seguidores";
  const tableDescription = isIG
    ? "Digite as views reais e ganhos do Instagram em cada dia. Salvo automaticamente."
    : "Digite o valor real do Facebook em cada dia. Salvo automaticamente.";

  return (
    <div className="space-y-6">
      <WriteGuardDialog />
      <PageHeader
        title="Histórico"
        description="Views reais e receita dia a dia. Compare o que a plataforma pagou vs o que os posts geraram."
      />

      {/* Platform selector */}
      <div className="flex flex-wrap items-center gap-3">
        <PlatformTabs
          value={platform}
          onChange={(p) => {
            setPlatform(p);
            setRows([]);
            if (p === "instagram") {
              // Switch to IG: pick page with most IG posts
              if (!igPageIds.has(selectedPageId)) {
                const firstIg = [...pages]
                  .filter((pg) => igPageIds.has(pg.id))
                  .sort((a, b) => (igPostCounts.get(b.id) ?? 0) - (igPostCounts.get(a.id) ?? 0))[0];
                if (firstIg) setSelectedPageId(firstIg.id);
              }
            } else {
              // Switch to Facebook: pick first FB-only page if current is IG-only
              if (igPageIds.has(selectedPageId)) {
                const firstFb = pages.find((pg) => !igPageIds.has(pg.id));
                if (firstFb) setSelectedPageId(firstFb.id);
              }
            }
          }}
        />
      </div>

      {/* Page + Month selectors */}
      <div className="flex flex-wrap items-center gap-3">
        {pages.length > 0 && (
          <PageSelect pages={pages} value={selectedPageId} onChange={setSelectedPageId} igPageIds={igPageIds} platform={platform} />
        )}

        {/* Month navigation */}
        <div className="flex items-center gap-2 flex-1 min-w-[220px]">
          <button onClick={() => setMonthRef(prevMonth(monthRef))} className="p-2.5 rounded-lg border border-border hover:bg-muted transition-colors">
            <ChevronLeft className="h-5 w-5" />
          </button>
          <div className="flex-1 flex items-center gap-2">
            <input
              type="month"
              value={monthRef}
              onChange={(e) => e.target.value && setMonthRef(e.target.value)}
              className="flex-1 h-10 rounded-xl border border-border bg-background px-3 text-sm font-medium"
            />
            <span className="hidden sm:block text-sm font-semibold text-muted-foreground whitespace-nowrap">{formatMonth(monthRef)}</span>
          </div>
          <button onClick={() => setMonthRef(nextMonth(monthRef))} className="p-2.5 rounded-lg border border-border hover:bg-muted transition-colors" disabled={monthRef >= todayMonth}>
            <ChevronRight className="h-5 w-5" />
          </button>
        </div>
      </div>

      {/* No page selected */}
      {!selectedPageId && (
        <div className="border border-border rounded-xl p-8 text-center text-muted-foreground text-sm">
          Selecione uma página acima para ver e registrar os ganhos.
        </div>
      )}

      {selectedPageId && (
        <>
          {/* Tab switcher */}
          <div className="flex gap-1 border-b border-border">
            <button
              onClick={() => setActiveTab("receita")}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${activeTab === "receita" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}
            >
              Receita dia a dia
            </button>
            <button
              onClick={() => { setActiveTab("transparencia"); loadAuditLogs(monthRef, selectedPageId, platform); }}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors flex items-center gap-1.5 ${activeTab === "transparencia" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}
            >
              <History className="h-3.5 w-3.5" />
              Transparência
            </button>
          </div>

          {activeTab === "receita" && (<>
          {/* KPIs */}
          <div className={`grid gap-3 ${isIG ? "grid-cols-2 sm:grid-cols-4" : "grid-cols-2 sm:grid-cols-5"}`}>
            <div className="bg-card border border-border rounded-lg p-4">
              <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">Views reais</p>
              <p className="text-xl font-bold mt-1 text-[#F44708]">{fmtViews(totalViews)}</p>
              <p className="text-xs text-muted-foreground mt-0.5">no mês</p>
            </div>
            {/* Posts (USD) — Facebook only */}
            {!isIG && (
              <div className="bg-card border border-border rounded-lg p-4">
                <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">Posts (USD)</p>
                <p className="text-xl font-bold mt-1">${totalPosts.toFixed(2)}</p>
                <p className="text-xs text-muted-foreground mt-0.5">calculado do CSV</p>
              </div>
            )}
            <div className="bg-card border border-border rounded-lg p-4">
              <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">Real recebido (USD)</p>
              <p className="text-xl font-bold mt-1">${totalActual.toFixed(2)}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{filledDays} dias preenchidos</p>
            </div>
            {/* Diferença — Facebook only */}
            {!isIG && (
              <div className={`bg-card border rounded-lg p-4 ${totalBonus > 0 ? "border-[#16a34a]/30" : totalBonus < 0 ? "border-destructive/30" : "border-border"}`}>
                <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">Diferença (USD)</p>
                <p className={`text-xl font-bold mt-1 ${totalBonus > 0 ? "text-[#16a34a]" : totalBonus < 0 ? "text-destructive" : ""}`}>
                  {totalBonus >= 0 ? "+" : ""}${totalBonus.toFixed(2)}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">real − posts</p>
              </div>
            )}
            <div className="bg-card border border-border rounded-lg p-4">
              <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">Progresso</p>
              <p className="text-xl font-bold mt-1">{filledDays}/{rows.length}</p>
              <div className="mt-2 h-1.5 bg-muted rounded-full overflow-hidden">
                <div className="h-full bg-[#16a34a] rounded-full transition-all" style={{ width: rows.length ? `${(filledDays / rows.length) * 100}%` : "0%" }} />
              </div>
            </div>
          </div>

          {/* Daily table */}
          <div className="bg-card border border-border rounded-lg overflow-hidden">
            <div className="px-4 sm:px-5 py-4 border-b border-border flex items-center justify-between gap-3">
              <div>
                <h2 className="font-semibold">
                  Receita dia a dia — {formatMonth(monthRef)}
                </h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {selectedPage && (
                    <span className="inline-flex items-center gap-1">
                      <Coins className={`h-3 w-3 ${selectedPage.isMonetized ? "text-emerald-500" : "text-red-400"}`} />
                      {selectedPage.nome}
                      {" · "}
                    </span>
                  )}
                  {canWrite ? tableDescription : "Somente leitura — seu perfil não tem permissão para editar."}
                </p>
              </div>
            </div>
            {loading ? (
              <div className="p-10 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
            ) : (
              <>
                {/* Mobile: compact card list */}
                <div className="sm:hidden divide-y divide-border">
                  {rows.map((row) => {
                    const bonus = row.actual_revenue != null ? row.actual_revenue - row.posts_revenue : null;
                    const isWeekend = row.weekday === "Sáb" || row.weekday === "Dom";
                    const isFuture = row.date > new Date().toISOString().slice(0, 10);
                    return (
                      <div key={row.date} className={`px-4 py-3 space-y-2.5 ${isWeekend ? "bg-muted/10" : ""} ${isFuture ? "opacity-40" : ""}`}>
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold tabular-nums text-sm">{row.label}</span>
                            <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">{row.weekday}</span>
                            {row.posts_revenue > 0 && <span className="text-xs text-muted-foreground">posts: ${row.posts_revenue.toFixed(2)}</span>}
                          </div>
                          <div className="h-5 w-5 flex items-center justify-center">
                            {row.saving ? <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                              : row.saved ? <Check className="h-3.5 w-3.5 text-[#16a34a]" />
                              : row.dirty ? <div className="h-2 w-2 rounded-full bg-amber-400" />
                              : null}
                          </div>
                        </div>
                        {row.views > 0 && (
                          <div className="flex items-center justify-between text-xs text-muted-foreground">
                            <span className="font-semibold uppercase tracking-wider">Views CSV</span>
                            <span className="tabular-nums">{fmtViews(row.views)}</span>
                          </div>
                        )}
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <div className="flex items-center gap-1.5 mb-1">
                              <p className="text-[10px] uppercase tracking-wider text-[#F44708] font-semibold">Views manuais</p>
                              <AvatarStack editors={row.views_editors} />
                            </div>
                            <input
                              type="text" inputMode="numeric" disabled={isFuture || !canWrite}
                              data-views-input={row.date}
                              placeholder="0"
                              value={viewsFocusDate === row.date
                                ? (row.actual_views ?? "")
                                : (row.actual_views != null ? row.actual_views.toLocaleString("pt-BR") : "")}
                              onFocus={() => setViewsFocusDate(row.date)}
                              onBlur={() => { setViewsFocusDate(null); handleFieldBlur(row); }}
                              onChange={(e) => handleViewsChange(row, e.target.value)}
                              onKeyDown={(e) => handleViewsKeyDown(e, row.date)}
                              className="w-full h-10 rounded-lg border border-input bg-background px-3 text-right text-sm tabular-nums text-[#F44708] focus:outline-none focus:ring-2 focus:ring-[#F44708]/40 disabled:opacity-30"
                            />
                          </div>
                          <div>
                            <div className="flex items-center gap-1.5 mb-1">
                              <p className="text-[10px] uppercase tracking-wider text-emerald-600 font-semibold">{followersLabel}</p>
                              <AvatarStack editors={row.followers_editors} />
                            </div>
                            <input
                              type="text" inputMode="numeric" disabled={isFuture || !canWrite}
                              data-followers-input={row.date}
                              placeholder="0"
                              value={followersFocusDate === row.date
                                ? (row.actual_followers ?? "")
                                : (row.actual_followers != null ? row.actual_followers.toLocaleString("pt-BR") : "")}
                              onFocus={() => setFollowersFocusDate(row.date)}
                              onBlur={() => { setFollowersFocusDate(null); handleFieldBlur(row); }}
                              onChange={(e) => handleFollowersChange(row, e.target.value)}
                              onKeyDown={(e) => handleFollowersKeyDown(e, row.date)}
                              className="w-full h-10 rounded-lg border border-input bg-background px-3 text-right text-sm tabular-nums text-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-500/40 disabled:opacity-30"
                            />
                          </div>
                          <div className="col-span-2">
                            <div className="flex items-center gap-1.5 mb-1">
                              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Real recebido (USD)</p>
                              <AvatarStack editors={row.revenue_editors} />
                            </div>
                            <input
                              type="number" min="0" step="0.01" disabled={isFuture || !canWrite}
                              placeholder="0.00"
                              value={row.actual_revenue ?? ""}
                              onChange={(e) => handleActualChange(row, e.target.value)}
                              onBlur={() => handleFieldBlur(row)}
                              className="w-full h-10 rounded-lg border border-input bg-background px-3 text-right text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-30"
                            />
                          </div>
                        </div>
                        {bonus != null && !isIG && (
                          <div className="flex items-center justify-between text-xs">
                            <span className="font-semibold uppercase tracking-wider text-muted-foreground">Bônus</span>
                            <div className="text-right">
                              <p className={`text-sm font-semibold tabular-nums ${bonus > 0 ? "text-[#16a34a]" : bonus < 0 ? "text-destructive" : "text-muted-foreground"}`}>
                                {bonus > 0 ? "+" : ""}{bonus === 0 ? "$0.00" : `$${bonus.toFixed(2)}`}
                              </p>
                            </div>
                          </div>
                        )}
                        {row.actual_revenue != null && (
                          <input
                            type="text" disabled={isFuture || !canWrite}
                            placeholder="Observação (opcional)"
                            value={row.note}
                            onChange={(e) => updateRow(row.date, { note: e.target.value })}
                            onBlur={() => handleFieldBlur(row)}
                            className="w-full h-9 rounded-lg border border-input bg-background px-3 text-xs focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-30"
                          />
                        )}
                      </div>
                    );
                  })}
                  <div className="px-4 py-3 bg-muted/30 flex items-center justify-between font-semibold text-sm">
                    <span>Total</span>
                    <div className="text-right">
                      <p>${totalActual.toFixed(2)}</p>
                      {!isIG && <p className="text-xs text-muted-foreground font-normal">posts: ${totalPosts.toFixed(2)}</p>}
                    </div>
                  </div>
                </div>

                {/* Desktop: full table */}
                <div className="hidden sm:block overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
                      <tr>
                        <th className="text-left px-4 py-3 font-medium w-36">Dia</th>
                        <th className="text-right px-4 py-3 font-medium">Views CSV</th>
                        <th className="text-right px-4 py-3 font-medium text-[#F44708]">Views manuais</th>
                        <th className="text-right px-4 py-3 font-medium text-emerald-600">{followersLabel}</th>
                        <th className="text-right px-4 py-3 font-medium text-blue-600">Total Seguidores</th>
                        {!isIG && <th className="text-right px-4 py-3 font-medium">Posts (USD)</th>}
                        <th className="text-right px-4 py-3 font-medium">Real recebido (USD)</th>
                        <th className="w-8 px-4 py-3" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {rows.map((row) => {
                        const isWeekend = row.weekday === "Sáb" || row.weekday === "Dom";
                        const isFuture = row.date > new Date().toISOString().slice(0, 10);
                        return (
                          <tr key={row.date} className={`hover:bg-muted/20 ${isWeekend ? "bg-muted/10" : ""} ${isFuture ? "opacity-40" : ""}`}>
                            <td className="px-4 py-2.5">
                              <span className="font-semibold tabular-nums">{row.label}</span>
                              <span className="text-[10px] text-muted-foreground ml-1.5">{row.weekday}</span>
                            </td>
                            <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">
                              {row.views > 0 ? fmtViews(row.views) : <span className="text-muted-foreground/40">—</span>}
                            </td>
                            <td className="px-4 py-2.5 text-right">
                              <div className="flex items-center justify-end gap-1.5">
                                <input
                                  type="text" inputMode="numeric" disabled={isFuture || !canWrite}
                                  data-views-input={row.date}
                                  placeholder="0"
                                  value={viewsFocusDate === row.date
                                    ? (row.actual_views ?? "")
                                    : (row.actual_views != null ? row.actual_views.toLocaleString("pt-BR") : "")}
                                  onFocus={() => setViewsFocusDate(row.date)}
                                  onBlur={() => { setViewsFocusDate(null); handleFieldBlur(row); }}
                                  onChange={(e) => handleViewsChange(row, e.target.value)}
                                  onKeyDown={(e) => handleViewsKeyDown(e, row.date)}
                                  className="w-32 h-7 rounded border border-input bg-background px-2 text-right text-sm tabular-nums text-[#F44708] focus:outline-none focus:ring-1 focus:ring-[#F44708]/40 disabled:opacity-30"
                                />
                                <AvatarStack editors={row.views_editors} />
                              </div>
                            </td>
                            <td className="px-4 py-2.5 text-right">
                              <div className="flex items-center justify-end gap-1.5">
                                <input
                                  type="text" inputMode="numeric" disabled={isFuture || !canWrite}
                                  data-followers-input={row.date}
                                  placeholder="0"
                                  value={followersFocusDate === row.date
                                    ? (row.actual_followers ?? "")
                                    : (row.actual_followers != null ? row.actual_followers.toLocaleString("pt-BR") : "")}
                                  onFocus={() => setFollowersFocusDate(row.date)}
                                  onBlur={() => { setFollowersFocusDate(null); handleFieldBlur(row); }}
                                  onChange={(e) => handleFollowersChange(row, e.target.value)}
                                  onKeyDown={(e) => handleFollowersKeyDown(e, row.date)}
                                  className="w-24 h-7 rounded border border-input bg-background px-2 text-right text-sm tabular-nums text-emerald-600 focus:outline-none focus:ring-1 focus:ring-emerald-500/40 disabled:opacity-30"
                                />
                                <AvatarStack editors={row.followers_editors} />
                              </div>
                            </td>
                            {/* Total Seguidores */}
                            <td className="px-4 py-2.5 text-right">
                              <div className="flex items-center justify-end gap-1">
                              {row.total_followers != null && row.total_followers > 0 && (
                                <button
                                  onClick={() => propagateTotalFollowers(row.date, row.total_followers!, rowsRef.current)}
                                  title="Recalcular todos os dias com base nesse valor"
                                  className="text-[9px] text-blue-400 hover:text-blue-600 transition-colors shrink-0"
                                >↺</button>
                              )}
                              <input
                                type="text" inputMode="numeric" disabled={isFuture || !canWrite}
                                placeholder="0"
                                value={totalFollowersFocusDate === row.date
                                  ? (row.total_followers ?? "")
                                  : (row.total_followers != null ? row.total_followers.toLocaleString("pt-BR") : "")}
                                onFocus={() => setTotalFollowersFocusDate(row.date)}
                                onBlur={() => { setTotalFollowersFocusDate(null); handleFieldBlur(row); }}
                                onChange={(e) => handleTotalFollowersChange(row, e.target.value)}
                                className="w-28 h-7 rounded border border-input bg-background px-2 text-right text-sm tabular-nums text-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-500/40 disabled:opacity-30"
                              />
                              </div>
                            </td>
                            {!isIG && (
                              <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">
                                {row.posts_revenue > 0 ? `$${row.posts_revenue.toFixed(2)}` : <span className="text-muted-foreground/40">—</span>}
                              </td>
                            )}
                            <td className="px-4 py-2.5 text-right">
                              <div className="flex items-center justify-end gap-1.5">
                                <input
                                  type="number" min="0" step="0.01" disabled={isFuture || !canWrite}
                                  placeholder="0.00"
                                  value={row.actual_revenue ?? ""}
                                  onChange={(e) => handleActualChange(row, e.target.value)}
                                  onBlur={() => handleFieldBlur(row)}
                                  className="w-28 h-7 rounded border border-input bg-background px-2 text-right text-sm tabular-nums focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-30"
                                />
                                <AvatarStack editors={row.revenue_editors} />
                              </div>
                            </td>
                            <td className="px-2 py-2.5 w-8">
                              {row.saving ? <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                                : row.saved ? <Check className="h-3.5 w-3.5 text-[#16a34a]" />
                                : row.dirty ? <div className="h-2 w-2 rounded-full bg-amber-400" title="Não salvo" />
                                : null}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr className="border-t-2 border-border bg-muted/30 font-semibold text-sm">
                        <td className="px-4 py-3 text-muted-foreground">Total</td>
                        <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                          {(() => { const t = rows.reduce((s, r) => s + r.views, 0); return t > 0 ? fmtViews(t) : "—"; })()}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums text-[#F44708]">
                          {(() => { const t = rows.reduce((s, r) => s + (r.actual_views ?? 0), 0); return t > 0 ? fmtViews(t) : "—"; })()}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums text-emerald-600">
                          {(() => { const t = rows.reduce((s, r) => s + (r.actual_followers ?? 0), 0); return t > 0 ? t.toLocaleString("pt-BR") : "—"; })()}
                        </td>
                        {!isIG && <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">${totalPosts.toFixed(2)}</td>}
                        <td className="px-4 py-3 text-right tabular-nums">${totalActual.toFixed(2)}</td>
                        <td />
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </>
            )}
          </div>

          </>)}

          {activeTab === "transparencia" && (
            <div className="bg-card border border-border rounded-lg overflow-hidden">
              <div className="px-5 py-4 border-b border-border">
                <h2 className="font-semibold">Registro de alterações</h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Histórico completo de edições nos dados de {formatMonth(monthRef)} — visível para todos os usuários.
                </p>
              </div>
              {auditLoading ? (
                <div className="p-10 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
              ) : auditLogs.length === 0 ? (
                <div className="p-10 text-center text-sm text-muted-foreground">
                  Nenhuma alteração registrada em {formatMonth(monthRef)}.
                </div>
              ) : (
                <div className="divide-y divide-border">
                  {auditLogs.map((log) => {
                    // entity_id format: "platform:date:pageId"
                    const parts = log.entity_id.split(":");
                    const datePart = parts.length >= 3 ? parts[1] : parts[0];
                    const [y, mo, d] = datePart.split("-");
                    const dayLabel = `${d}/${mo}`;
                    const ts = new Date(log.created_at);
                    const tsStr = ts.toLocaleDateString("pt-BR") + " às " + ts.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

                    const changes: { field: string; before: string; after: string }[] = [];
                    const fields: { key: keyof typeof log.after_json; label: string; fmt: (v: unknown) => string }[] = [
                      { key: "actual_views", label: "Views Manuais", fmt: (v) => v != null ? Number(v).toLocaleString("pt-BR") : "—" },
                      { key: "actual_followers", label: followersLabel, fmt: (v) => v != null ? Number(v).toLocaleString("pt-BR") : "—" },
                      { key: "actual_revenue_usd", label: "Real Recebido", fmt: (v) => v != null ? `$${Number(v).toFixed(2)}` : "—" },
                    ];
                    for (const f of fields) {
                      const bv = log.before_json[f.key];
                      const av = log.after_json[f.key];
                      if (bv !== av) changes.push({ field: f.label, before: f.fmt(bv), after: f.fmt(av) });
                    }
                    if (changes.length === 0) return null;

                    return (
                      <div key={log.id} className="px-5 py-4 flex gap-4">
                        <div className="shrink-0 mt-0.5">
                          {log.actor_avatar ? (
                            <img src={log.actor_avatar} alt={log.actor_nome} className="h-8 w-8 rounded-full object-cover" />
                          ) : (
                            <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center">
                              <UserCircle className="h-5 w-5 text-muted-foreground" />
                            </div>
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-2 flex-wrap">
                            <p className="text-sm font-semibold">{log.actor_nome}</p>
                            <p className="text-xs text-muted-foreground shrink-0">{tsStr}</p>
                          </div>
                          <p className="text-xs text-muted-foreground mt-0.5 mb-2">
                            Editou os dados do dia <span className="font-semibold text-foreground">{dayLabel}</span>
                          </p>
                          <div className="space-y-1">
                            {changes.map((c) => (
                              <div key={c.field} className="flex items-center gap-2 text-xs">
                                <span className="text-muted-foreground w-28 shrink-0">{c.field}</span>
                                <span className="tabular-nums line-through text-muted-foreground">{c.before}</span>
                                <span className="text-muted-foreground">→</span>
                                <span className="tabular-nums font-semibold text-foreground">{c.after}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </>
      )}

      <p className="text-xs text-muted-foreground text-center">
        Dados salvos automaticamente por página e plataforma. Dias futuros são bloqueados. Finais de semana em destaque.
      </p>
    </div>
  );
}
