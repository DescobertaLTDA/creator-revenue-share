import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  X,
  Pencil,
  Search,
  Copy,
  RefreshCw,
  Plus,
  Eye,
  Heart,
  MessageCircle,
  Share2,
  Sparkles,
  ImageIcon,
  CheckCircle2,
  Loader2,
  Info,
  ChevronDown,
} from "lucide-react";

export const Route = createFileRoute("/admin/criador")({
  head: () => ({ meta: [{ title: "Criador — Nicho" }] }),
  component: CriadorPage,
});

// ─── Types ────────────────────────────────────────────────────────────────────

type Platform = "all" | "facebook" | "instagram";

interface PostRow {
  id: string;
  page_id: string;
  published_at: string | null;
  title: string | null;
  description: string | null;
  views: number | null;
  reach: number | null;
  reactions: number | null;
  comments: number | null;
  shares: number | null;
  thumbnail_url: string | null;
  source: "facebook" | "instagram" | null;
  permalink: string | null;
  pages: { nome: string; id: string } | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(n: number | null | undefined): string {
  const v = Number(n ?? 0);
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}k`;
  return v.toFixed(0);
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  const day = String(d.getUTCDate()).padStart(2, "0");
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${day}/${month}`;
}

function extractHashtags(text: string | null): string[] {
  if (!text) return [];
  const matches = text.match(/#\w+/g);
  return matches ? Array.from(new Set(matches)) : [];
}

function cn(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(" ");
}

async function fetchAllRows<T>(query: () => any): Promise<T[]> {
  const PAGE = 1000;
  let from = 0;
  const all: T[] = [];
  while (true) {
    const { data, error } = await query().range(from, from + PAGE - 1);
    if (error || !data || data.length === 0) break;
    all.push(...data);
    if (data.length < PAGE) break;
    from += data.length;
  }
  return all;
}

// Placeholder OCR — resolves after 1.5s with post.title
async function extractTextFromImage(post: PostRow): Promise<string | null> {
  return new Promise((resolve) =>
    setTimeout(() => resolve(post.title ?? null), 1500)
  );
}

// ─── Platform badge ───────────────────────────────────────────────────────────

function PlatformBadge({ source }: { source: "facebook" | "instagram" | null }) {
  if (source === "instagram") {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-teal-50 text-teal-600 uppercase tracking-wide shrink-0">
        Instagram
      </span>
    );
  }
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-50 text-blue-600 uppercase tracking-wide shrink-0">
      Facebook
    </span>
  );
}

// ─── Filter bar sub-components ────────────────────────────────────────────────

function PageDropdown({
  pages,
  value,
  onChange,
}: {
  pages: { id: string; nome: string }[];
  value: string;
  onChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const sel = pages.find((p) => p.id === value);

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 h-9 px-3 rounded-xl border border-border bg-white text-sm font-medium hover:bg-accent transition-colors min-w-[180px]"
      >
        <span className="truncate flex-1 text-left text-xs">
          {sel?.nome ?? "Todas as páginas"}
        </span>
        <ChevronDown
          className={cn(
            "h-3.5 w-3.5 text-muted-foreground shrink-0 transition-transform",
            open && "rotate-180"
          )}
        />
      </button>
      {open && (
        <div className="absolute left-0 top-full mt-1 z-50 bg-white rounded-xl border border-border py-1 min-w-[220px] shadow-lg max-h-72 overflow-y-auto">
          <button
            onClick={() => { onChange("all"); setOpen(false); }}
            className={cn(
              "w-full px-3 py-2 text-left text-sm transition-colors hover:bg-muted",
              value === "all" && "bg-[#FFF0E8] text-[#F44708] font-semibold"
            )}
          >
            Todas as páginas
          </button>
          {pages.map((p) => (
            <button
              key={p.id}
              onClick={() => { onChange(p.id); setOpen(false); }}
              className={cn(
                "w-full px-3 py-2 text-left text-sm transition-colors hover:bg-muted truncate",
                p.id === value && "bg-[#FFF0E8] text-[#F44708] font-semibold"
              )}
            >
              {p.nome}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function PlatformToggle({
  value,
  onChange,
}: {
  value: Platform;
  onChange: (p: Platform) => void;
}) {
  return (
    <div className="flex items-center bg-muted rounded-xl p-0.5 shrink-0">
      {(["all", "facebook", "instagram"] as Platform[]).map((p) => (
        <button
          key={p}
          onClick={() => onChange(p)}
          className={cn(
            "px-3 py-1.5 rounded-lg text-xs font-semibold transition-all whitespace-nowrap",
            value === p
              ? "bg-white shadow-sm text-foreground"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          {p === "all" ? "Todos" : p === "facebook" ? "Facebook" : "Instagram"}
        </button>
      ))}
    </div>
  );
}

// ─── Post card ────────────────────────────────────────────────────────────────

function PostCard({
  post,
  index,
  onClick,
}: {
  post: PostRow;
  index: number;
  onClick: () => void;
}) {
  const [imgError, setImgError] = useState(false);

  return (
    <button
      onClick={onClick}
      className="w-full text-left bg-white rounded-2xl border border-border hover:border-[#F44708]/40 hover:shadow-md transition-all group overflow-hidden flex flex-col"
    >
      {/* Thumbnail */}
      <div className="relative aspect-[4/3] bg-gray-100 overflow-hidden">
        {post.thumbnail_url && !imgError ? (
          <img
            src={post.thumbnail_url}
            alt={post.title ?? "Post"}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
            onError={() => setImgError(true)}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-gray-300">
            <ImageIcon className="h-10 w-10" />
          </div>
        )}
        {/* Post number overlay */}
        <div className="absolute top-2 left-2 h-7 w-7 rounded-full bg-[#F44708] flex items-center justify-center text-white text-[10px] font-bold shadow">
          {index + 1}
        </div>
        {/* Platform badge overlay */}
        <div className="absolute top-2 right-2">
          <PlatformBadge source={post.source} />
        </div>
      </div>

      {/* Body */}
      <div className="p-3.5 flex flex-col gap-2 flex-1">
        {/* Page + date */}
        <div className="flex items-center justify-between gap-2">
          <p className="text-[11px] font-semibold text-muted-foreground truncate">
            {post.pages?.nome ?? "—"}
          </p>
          <p className="text-[11px] text-muted-foreground shrink-0">{fmtDate(post.published_at)}</p>
        </div>

        {/* Description preview */}
        {post.description && (
          <p className="text-xs text-foreground line-clamp-2 leading-relaxed">
            {post.description}
          </p>
        )}

        {/* Metrics */}
        <div className="flex items-center gap-3 mt-auto pt-1">
          <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
            <Eye className="h-3 w-3" />
            {fmt(post.views)}
          </span>
          <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
            <Heart className="h-3 w-3" />
            {fmt(post.reactions)}
          </span>
        </div>
      </div>
    </button>
  );
}

// ─── Edit modal ───────────────────────────────────────────────────────────────

function EditModal({
  post: initialPost,
  postIndex,
  onClose,
  onSaved,
}: {
  post: PostRow;
  postIndex: number;
  onClose: () => void;
  onSaved: (updated: PostRow) => void;
}) {
  const [post, setPost] = useState<PostRow>(initialPost);
  const [description, setDescription] = useState(initialPost.description ?? "");
  const [extractedText, setExtractedText] = useState<string | null>(
    initialPost.title ?? null
  );
  const [extracting, setExtracting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showImageUrlDialog, setShowImageUrlDialog] = useState(false);
  const [imageUrlInput, setImageUrlInput] = useState("");
  const [imgError, setImgError] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const hashtags = extractHashtags(description);

  const removeHashtag = useCallback(
    (tag: string) => {
      setDescription((d) => d.replace(new RegExp(tag.replace("#", "\\#") + "\\b", "g"), "").trim());
    },
    []
  );

  const handleExtract = useCallback(async () => {
    setExtracting(true);
    try {
      const text = await extractTextFromImage(post);
      setExtractedText(text);
    } finally {
      setExtracting(false);
    }
  }, [post]);

  const handleCopy = useCallback(async () => {
    if (!extractedText) return;
    await navigator.clipboard.writeText(extractedText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [extractedText]);

  const handleUseInPost = useCallback(() => {
    if (!extractedText) return;
    setDescription((d) => (extractedText + "\n\n" + d).trim());
  }, [extractedText]);

  const handleSubmitImageUrl = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (!imageUrlInput.trim()) return;
      setPost((p) => ({ ...p, thumbnail_url: imageUrlInput.trim() }));
      setImgError(false);
      setShowImageUrlDialog(false);
      setImageUrlInput("");
    },
    [imageUrlInput]
  );

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      const { error } = await supabase
        .from("posts")
        .update({
          description: description || null,
          thumbnail_url: post.thumbnail_url,
        } as any)
        .eq("id", post.id);

      if (error) throw error;
      onSaved({ ...post, description: description || null });
    } catch (err) {
      console.error("Erro ao salvar post:", err);
    } finally {
      setSaving(false);
    }
  }, [description, post, onSaved]);

  // Close on Escape
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.5)", backdropFilter: "blur(4px)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-white rounded-2xl max-w-4xl w-full max-h-[90vh] overflow-y-auto shadow-2xl flex flex-col">

        {/* ── Modal header ── */}
        <div className="flex items-center gap-3 px-6 py-4 border-b border-border shrink-0">
          {/* Orange circle with post number */}
          <div
            className="h-9 w-9 rounded-full flex items-center justify-center text-white text-sm font-bold shrink-0"
            style={{ background: "#F44708" }}
          >
            {postIndex + 1}
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="font-bold text-sm truncate">
                {post.pages?.nome ?? "Página"}
              </p>
              <span className="text-muted-foreground text-xs shrink-0">
                {fmtDate(post.published_at)}
              </span>
              <PlatformBadge source={post.source} />
            </div>
            {post.title && (
              <p className="text-xs text-muted-foreground truncate mt-0.5">{post.title}</p>
            )}
          </div>

          <button
            onClick={onClose}
            className="h-8 w-8 rounded-full flex items-center justify-center text-muted-foreground hover:bg-muted transition-colors shrink-0"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* ── Modal body ── */}
        <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-6 flex-1">

          {/* ── Left column ── */}
          <div className="flex flex-col gap-4">
            {/* Label */}
            <div className="flex items-center gap-1.5">
              <p className="text-sm font-semibold text-foreground">Imagem do post</p>
              <Info className="h-3.5 w-3.5 text-muted-foreground" />
            </div>

            {/* Image container */}
            <div className="relative rounded-xl overflow-hidden bg-gray-100 aspect-[4/3]">
              {post.thumbnail_url && !imgError ? (
                <img
                  src={post.thumbnail_url}
                  alt="Post thumbnail"
                  className="w-full h-full object-cover"
                  onError={() => setImgError(true)}
                />
              ) : (
                <div className="w-full h-full flex flex-col items-center justify-center text-gray-300 gap-2">
                  <ImageIcon className="h-12 w-12" />
                  <p className="text-xs text-gray-400">Sem imagem</p>
                </div>
              )}

              {/* Pencil overlay */}
              <button
                onClick={() => setShowImageUrlDialog(true)}
                className="absolute top-2 right-2 h-7 w-7 rounded-full bg-white/90 shadow flex items-center justify-center text-gray-600 hover:bg-white transition-colors"
                title="Alterar imagem"
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
            </div>

            {/* "Buscar imagem" button */}
            <button
              onClick={() => setShowImageUrlDialog(true)}
              className="flex items-center justify-center gap-2 h-9 rounded-xl border border-border bg-white text-sm font-medium hover:bg-muted transition-colors"
            >
              <Search className="h-4 w-4 text-muted-foreground" />
              Buscar imagem
            </button>

            {/* Image URL dialog */}
            {showImageUrlDialog && (
              <form
                onSubmit={handleSubmitImageUrl}
                className="bg-gray-50 rounded-xl border border-border p-3 flex flex-col gap-2"
              >
                <p className="text-xs font-semibold text-foreground">Cole a URL da imagem</p>
                <input
                  type="url"
                  value={imageUrlInput}
                  onChange={(e) => setImageUrlInput(e.target.value)}
                  placeholder="https://exemplo.com/imagem.jpg"
                  className="w-full h-9 px-3 rounded-lg border border-border text-xs bg-white focus:outline-none focus:ring-2 focus:ring-[#F44708]/30"
                  autoFocus
                />
                <div className="flex gap-2">
                  <button
                    type="submit"
                    className="flex-1 h-8 rounded-lg text-xs font-semibold text-white transition-colors"
                    style={{ background: "#F44708" }}
                  >
                    Aplicar
                  </button>
                  <button
                    type="button"
                    onClick={() => { setShowImageUrlDialog(false); setImageUrlInput(""); }}
                    className="flex-1 h-8 rounded-lg text-xs font-semibold border border-border bg-white hover:bg-muted transition-colors"
                  >
                    Cancelar
                  </button>
                </div>
              </form>
            )}

            {/* Tip box */}
            <div className="bg-green-50 border border-green-200 rounded-lg px-3 py-2.5">
              <p className="text-xs text-green-700 leading-relaxed">
                <span className="font-semibold">Dica:</span> Imagens com rostos e textos grandes tendem a gerar mais engajamento.
              </p>
            </div>
          </div>

          {/* ── Right column ── */}
          <div className="flex flex-col gap-5">

            {/* Extracted text section */}
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-1.5">
                <Sparkles className="h-4 w-4 text-[#F44708]" />
                <p className="text-sm font-semibold text-foreground">Texto da imagem</p>
              </div>

              {extracting ? (
                <div className="flex items-center gap-2 py-4 text-muted-foreground text-sm">
                  <Loader2 className="h-4 w-4 animate-spin text-[#F44708]" />
                  Extraindo texto...
                </div>
              ) : extractedText ? (
                <div className="bg-green-50 border border-green-200 rounded-lg p-3 flex flex-col gap-2">
                  {/* Success header */}
                  <div className="flex items-center gap-1.5">
                    <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0" />
                    <span className="text-xs font-semibold text-green-700">Texto extraído com sucesso!</span>
                  </div>
                  {/* Action buttons */}
                  <div className="flex gap-2">
                    <button
                      onClick={handleCopy}
                      className="flex items-center gap-1.5 h-7 px-3 rounded-lg bg-white border border-green-200 text-xs font-medium text-green-700 hover:bg-green-100 transition-colors"
                    >
                      <Copy className="h-3 w-3" />
                      {copied ? "Copiado!" : "Copiar"}
                    </button>
                    <button
                      onClick={handleUseInPost}
                      className="flex items-center gap-1.5 h-7 px-3 rounded-lg text-xs font-medium text-white transition-colors"
                      style={{ background: "#F44708" }}
                    >
                      Usar no post
                    </button>
                  </div>
                  {/* Extracted text display */}
                  <p className="text-xs text-gray-700 leading-relaxed bg-white rounded-lg border border-green-100 px-2.5 py-2">
                    {extractedText}
                  </p>
                  {/* Re-extract button */}
                  <button
                    onClick={handleExtract}
                    className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors self-start"
                  >
                    <RefreshCw className="h-3 w-3" />
                    Extrair texto novamente
                  </button>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-2 py-5 text-center">
                  <ImageIcon className="h-8 w-8 text-gray-200" />
                  <p className="text-xs text-muted-foreground">Nenhum texto extraído ainda.</p>
                  <button
                    onClick={handleExtract}
                    className="flex items-center gap-1.5 h-8 px-4 rounded-xl text-xs font-semibold text-white transition-colors mt-1"
                    style={{ background: "#F44708" }}
                  >
                    <Sparkles className="h-3.5 w-3.5" />
                    Extrair texto
                  </button>
                </div>
              )}
            </div>

            {/* Description section */}
            <div className="flex flex-col gap-2">
              <p className="text-sm font-semibold text-foreground">Descrição do post</p>
              <textarea
                ref={textareaRef}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={5}
                maxLength={2200}
                placeholder="Escreva a descrição do post..."
                className="w-full px-3 py-2.5 rounded-xl border border-border text-xs leading-relaxed bg-white focus:outline-none focus:ring-2 focus:ring-[#F44708]/30 resize-none"
              />
              <p className="text-[11px] text-muted-foreground text-right">
                {description.length}/2200
              </p>
            </div>

            {/* Hashtags section */}
            {hashtags.length > 0 && (
              <div className="flex flex-col gap-2">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  Hashtags
                </p>
                <div className="flex flex-wrap gap-1.5 items-center">
                  {hashtags.map((tag) => (
                    <button
                      key={tag}
                      onClick={() => removeHashtag(tag)}
                      title="Clique para remover"
                      className="bg-[#FFF0E8] text-[#F44708] rounded-full px-3 py-1 text-xs font-medium hover:bg-[#FFD9C8] transition-colors"
                    >
                      {tag}
                    </button>
                  ))}
                  <button
                    onClick={() => textareaRef.current?.focus()}
                    className="h-6 w-6 rounded-full border border-dashed border-[#F44708] flex items-center justify-center text-[#F44708] hover:bg-[#FFF0E8] transition-colors"
                    title="Adicionar hashtag"
                  >
                    <Plus className="h-3 w-3" />
                  </button>
                </div>
              </div>
            )}

            {/* Engagement metrics row */}
            <div className="flex flex-col gap-2">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                Métricas estimadas
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {[
                  { icon: Eye, label: "Views", value: post.views },
                  { icon: Heart, label: "Reações", value: post.reactions },
                  { icon: MessageCircle, label: "Comentários", value: post.comments },
                  { icon: Share2, label: "Compartilhamentos", value: post.shares },
                ].map(({ icon: Icon, label, value }) => (
                  <div
                    key={label}
                    className="rounded-xl border border-border bg-muted/30 p-2.5 flex flex-col gap-1"
                  >
                    <div className="flex items-center gap-1 text-muted-foreground">
                      <Icon className="h-3 w-3" />
                      <span className="text-[10px]">{label}</span>
                    </div>
                    <p className="text-sm font-bold text-foreground">{fmt(value)}</p>
                    <p className="text-[9px] text-muted-foreground">estimadas</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* ── Modal footer ── */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-border shrink-0">
          <button
            onClick={onClose}
            className="h-10 px-5 rounded-xl border border-border bg-white text-sm font-medium hover:bg-muted transition-colors"
          >
            Cancelar
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="h-10 px-5 rounded-xl text-sm font-semibold text-white flex items-center gap-2 transition-opacity disabled:opacity-60"
            style={{ background: "#F44708" }}
          >
            {saving ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Salvando...
              </>
            ) : (
              <>
                Salvar alterações
                <span>→</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

function CriadorPage() {
  const [posts, setPosts] = useState<PostRow[]>([]);
  const [allPages, setAllPages] = useState<{ id: string; nome: string }[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [filterPage, setFilterPage] = useState("all");
  const [filterPlatform, setFilterPlatform] = useState<Platform>("all");
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  // Modal
  const [editPost, setEditPost] = useState<PostRow | null>(null);
  const [editPostIndex, setEditPostIndex] = useState<number>(0);

  // Load data
  useEffect(() => {
    (async () => {
      setLoading(true);
      const [postsData, { data: pagesData }] = await Promise.all([
        fetchAllRows<PostRow>(() =>
          supabase
            .from("posts")
            .select(
              "id, title, description, views, reach, reactions, comments, shares, published_at, thumbnail_url, source, page_id, permalink, pages(nome, id)"
            )
            .order("published_at", { ascending: false })
        ),
        supabase.from("pages").select("id, nome").order("nome"),
      ]);
      setPosts(postsData);
      setAllPages((pagesData as any[]) ?? []);
      setLoading(false);
    })();
  }, []);

  // Filtered posts
  const filtered = (() => {
    let r = [...posts];

    if (filterPlatform === "facebook") {
      r = r.filter((p) => (p.source ?? "facebook") === "facebook");
    } else if (filterPlatform === "instagram") {
      r = r.filter((p) => p.source === "instagram");
    }

    if (filterPage !== "all") {
      r = r.filter((p) => p.page_id === filterPage);
    }

    if (search.trim()) {
      const q = search.trim().toLowerCase();
      r = r.filter(
        (p) =>
          (p.title ?? "").toLowerCase().includes(q) ||
          (p.description ?? "").toLowerCase().includes(q) ||
          (p.pages?.nome ?? "").toLowerCase().includes(q)
      );
    }

    if (dateFrom) {
      r = r.filter((p) => p.published_at && p.published_at >= dateFrom);
    }

    if (dateTo) {
      // dateTo is inclusive: compare date portion only
      r = r.filter((p) => p.published_at && p.published_at.slice(0, 10) <= dateTo);
    }

    return r;
  })();

  const handleCardClick = (post: PostRow, index: number) => {
    setEditPost(post);
    setEditPostIndex(index);
  };

  const handleModalSaved = (updated: PostRow) => {
    setPosts((prev) =>
      prev.map((p) => (p.id === updated.id ? updated : p))
    );
    setEditPost(null);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground text-sm">
        <Loader2 className="h-5 w-5 mr-2 animate-spin text-[#F44708]" />
        Carregando posts...
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* ── Header ── */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Criador</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Gerencie e edite seus posts publicados.
          </p>
        </div>
        <span className="text-xs text-muted-foreground bg-muted px-3 py-1.5 rounded-full font-medium">
          {filtered.length} post{filtered.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* ── Filter bar ── */}
      <div className="flex flex-wrap gap-3 items-center">
        <PageDropdown pages={allPages} value={filterPage} onChange={setFilterPage} />
        <PlatformToggle value={filterPlatform} onChange={setFilterPlatform} />

        {/* Search */}
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar posts..."
            className="w-full h-9 pl-9 pr-3 rounded-xl border border-border bg-white text-xs focus:outline-none focus:ring-2 focus:ring-[#F44708]/30"
          />
        </div>

        {/* Date range */}
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="h-9 px-3 rounded-xl border border-border bg-white text-xs focus:outline-none focus:ring-2 focus:ring-[#F44708]/30"
          />
          <span className="text-xs text-muted-foreground">até</span>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="h-9 px-3 rounded-xl border border-border bg-white text-xs focus:outline-none focus:ring-2 focus:ring-[#F44708]/30"
          />
        </div>

        {/* Clear filters */}
        {(filterPage !== "all" || filterPlatform !== "all" || search || dateFrom || dateTo) && (
          <button
            onClick={() => {
              setFilterPage("all");
              setFilterPlatform("all");
              setSearch("");
              setDateFrom("");
              setDateTo("");
            }}
            className="flex items-center gap-1 h-9 px-3 rounded-xl text-xs font-medium text-muted-foreground border border-border bg-white hover:bg-muted transition-colors"
          >
            <X className="h-3.5 w-3.5" />
            Limpar
          </button>
        )}
      </div>

      {/* ── Posts grid ── */}
      {filtered.length === 0 ? (
        <div className="rounded-2xl border border-border bg-white p-20 flex flex-col items-center gap-4">
          <ImageIcon className="h-10 w-10 text-muted-foreground/30" />
          <p className="font-semibold text-foreground">Nenhum post encontrado</p>
          <p className="text-sm text-muted-foreground text-center">
            Tente ajustar os filtros ou importe CSVs de posts.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
          {filtered.map((post, index) => (
            <PostCard
              key={post.id}
              post={post}
              index={index}
              onClick={() => handleCardClick(post, index)}
            />
          ))}
        </div>
      )}

      {/* ── Edit modal ── */}
      {editPost && (
        <EditModal
          post={editPost}
          postIndex={editPostIndex}
          onClose={() => setEditPost(null)}
          onSaved={handleModalSaved}
        />
      )}
    </div>
  );
}
