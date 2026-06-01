import Papa from "papaparse";
import { parseMixedDate, parseNumberLoose } from "@/lib/format";

// ─── Header map ───────────────────────────────────────────────────────────────
// Mapeamento de cabeçalhos do CSV do Facebook e Instagram (PT e variantes).
// Valor = chave semântica interna.
const HEADER_MAP: Record<string, string> = {
  // ── Post / Account ID ──────────────────────────────────────────────────────
  "identificação do post": "external_post_id",
  "identificacao do post": "external_post_id",
  "post id": "external_post_id",
  "id do post": "external_post_id",

  "identificação da página": "external_page_id",
  "identificacao da pagina": "external_page_id",
  "page id": "external_page_id",
  "id da página": "external_page_id",
  "id da pagina": "external_page_id",
  // Instagram: English column "Account ID"
  "account id": "external_page_id",
  "identificação da conta": "external_page_id",
  "identificacao da conta": "external_page_id",

  // ── Page / Account name ────────────────────────────────────────────────────
  "nome da página": "page_name",
  "nome da pagina": "page_name",
  "page name": "page_name",
  "nome da conta": "page_name",
  "account name": "page_name",

  // Instagram username (stored alongside page_name)
  "nome de usuário da conta": "page_username",
  "nome de usuario da conta": "page_username",
  "account username": "page_username",
  "username": "page_username",

  // ── Publish time ───────────────────────────────────────────────────────────
  "horário de publicação": "published_at",
  "horario de publicacao": "published_at",
  "data de publicação": "published_at",
  "publish time": "published_at",

  // ── Content ────────────────────────────────────────────────────────────────
  "título": "title",
  "titulo": "title",
  "title": "title",

  "descrição": "description",
  "descricao": "description",
  "description": "description",

  "permalink": "permalink",
  "link": "permalink",
  "link permanente": "permalink",
  "permanent link": "permalink",
  "post url": "permalink",

  "tipo de postagem": "post_type",
  "tipo de post": "post_type",
  "post type": "post_type",

  "idioma": "language",
  "language": "language",

  // ── Row-type marker (Instagram "Total" vs per-day rows) ────────────────────
  "data": "row_date",
  "date": "row_date",

  // ── Engagement ────────────────────────────────────────────────────────────
  "visualizações": "views",
  "visualizacoes": "views",
  "views": "views",

  "alcance": "reach",
  "reach": "reach",

  "reações": "reactions",
  "reacoes": "reactions",
  "reactions": "reactions",
  // Instagram calls them "Curtidas" (likes)
  "curtidas": "reactions",
  "likes": "reactions",

  "comentários": "comments",
  "comentarios": "comments",
  "comments": "comments",

  "compartilhamentos": "shares",
  "shares": "shares",

  // Instagram-specific
  "salvamentos": "saves",
  "saves": "saves",

  "seguimentos": "follows_gained",
  "follows gained": "follows_gained",
  "new followers": "follows_gained",

  // ── Clicks (Facebook) ──────────────────────────────────────────────────────
  "cliques (total)": "clicks_total",
  "clicks (total)": "clicks_total",
  "total clicks": "clicks_total",
  "total de cliques": "clicks_total",

  "outros cliques": "clicks_other",
  "other clicks": "clicks_other",

  "cliques em links": "link_clicks",
  "cliques no link": "link_clicks",
  "link clicks": "link_clicks",

  // ── Revenue (Facebook) ────────────────────────────────────────────────────
  "ganhos aproximados com a monetização de conteúdo": "monetization_approx",
  "ganhos aproximados com a monetizacao de conteudo": "monetization_approx",
  "approximate earnings from content monetization": "monetization_approx",

  "ganhos estimados (usd)": "estimated_usd",
  "estimated earnings (usd)": "estimated_usd",

  "ganhos estimados com estrelas (usd)": "stars_earnings_usd",
  "estimated earnings from stars (usd)": "stars_earnings_usd",

  "cpm do anuncio (usd)": "ad_cpm_usd",
  "ad cpm (usd)": "ad_cpm_usd",

  "impressoes do anuncio": "ad_impressions",
  "ad impressions": "ad_impressions",

  // ── Video metrics ─────────────────────────────────────────────────────────
  "duracao (s)": "video_duration_s",
  "duração (s)": "video_duration_s",
  "duration (s)": "video_duration_s",
  "duration (sec)": "video_duration_s",

  "segundos de visualizacao": "watch_seconds_total",
  "total video view time (seconds)": "watch_seconds_total",

  "media de segundos de visualizacao": "watch_seconds_avg",
  "average seconds watched": "watch_seconds_avg",
};

const normalizeHeader = (h: string) =>
  h
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim();

// ─── Types ────────────────────────────────────────────────────────────────────

export type CsvSource = "facebook" | "instagram";

export interface ParsedPostRow {
  external_post_id: string;
  external_page_id: string;
  page_name: string;
  page_username: string | null;
  published_at: Date | null;
  title: string | null;
  description: string | null;
  permalink: string | null;
  post_type: string | null;
  language: string | null;
  views: number;
  reach: number;
  reactions: number;
  comments: number;
  shares: number;
  saves: number;
  follows_gained: number;
  clicks_total: number;
  clicks_other: number;
  link_clicks: number;
  monetization_approx: number;
  estimated_usd: number;
  stars_earnings_usd: number;
  ad_cpm_usd: number;
  ad_impressions: number;
  video_duration_s: number;
  watch_seconds_total: number;
  watch_seconds_avg: number;
  source: CsvSource;
}

export interface RowError {
  row_number: number;
  field_name: string | null;
  error_message: string;
  raw_payload: Record<string, unknown>;
}

export interface ParseResult {
  rows: ParsedPostRow[];
  errors: RowError[];
  totalRows: number;
  detectedPages: Set<string>;
  periodStart: Date | null;
  periodEnd: Date | null;
  source: CsvSource;
}

// ─── Source detection ─────────────────────────────────────────────────────────

/**
 * Detecta se o CSV é do Facebook ou do Instagram examinando o cabeçalho.
 * Instagram CSVs têm colunas "Salvamentos", "Seguimentos" e "Account ID".
 */
export function detectCsvSource(text: string): CsvSource {
  const firstLine = text.split("\n")[0].normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  if (
    firstLine.includes("salvamentos") ||
    firstLine.includes("seguimentos") ||
    firstLine.includes("account id") ||
    firstLine.includes("nome de usuario da conta")
  ) {
    return "instagram";
  }
  return "facebook";
}

// ─── Core parser ──────────────────────────────────────────────────────────────

function parseRows(text: string, source: CsvSource): ParseResult {
  const parsed = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (h) => normalizeHeader(h),
  });

  const rows: ParsedPostRow[] = [];
  const errors: RowError[] = [];
  const detectedPages = new Set<string>();
  let periodStart: Date | null = null;
  let periodEnd: Date | null = null;

  parsed.data.forEach((raw, idx) => {
    const rowNumber = idx + 2;
    const pick = (semanticKey: string): string => {
      for (const [h, k] of Object.entries(HEADER_MAP)) {
        if (k === semanticKey && raw[h] != null && raw[h] !== "") return String(raw[h]);
      }
      return "";
    };

    // ── Instagram: skip daily breakdown rows (keep only "Total") ─────────────
    if (source === "instagram") {
      const rowDate = pick("row_date").toLowerCase().trim();
      if (rowDate !== "" && rowDate !== "total") return;
    }

    // ── IDs ──────────────────────────────────────────────────────────────────
    const external_post_id = pick("external_post_id").trim();
    const external_page_id = pick("external_page_id").trim();
    const page_name = pick("page_name").trim();
    const page_username = pick("page_username").trim() || null;

    if (!external_post_id || !external_page_id) {
      errors.push({
        row_number: rowNumber,
        field_name: !external_post_id ? "external_post_id" : "external_page_id",
        error_message: "Identificação do post ou da conta ausente.",
        raw_payload: raw,
      });
      return;
    }

    // ── Date ─────────────────────────────────────────────────────────────────
    const publishedRaw = pick("published_at");
    const published_at = publishedRaw ? parseMixedDate(publishedRaw) : null;
    if (publishedRaw && !published_at) {
      errors.push({
        row_number: rowNumber,
        field_name: "published_at",
        error_message: `Data inválida: "${publishedRaw}"`,
        raw_payload: raw,
      });
      return;
    }

    if (published_at) {
      if (!periodStart || published_at < periodStart) periodStart = published_at;
      if (!periodEnd || published_at > periodEnd) periodEnd = published_at;
    }

    detectedPages.add(external_page_id);

    rows.push({
      external_post_id,
      external_page_id,
      page_name: page_name || (page_username ?? external_page_id),
      page_username,
      published_at,
      title: pick("title") || null,
      description: pick("description") || null,
      permalink: pick("permalink") || null,
      post_type: pick("post_type") || null,
      language: pick("language") || null,
      views: parseNumberLoose(pick("views")),
      reach: parseNumberLoose(pick("reach")),
      reactions: parseNumberLoose(pick("reactions")),
      comments: parseNumberLoose(pick("comments")),
      shares: parseNumberLoose(pick("shares")),
      saves: parseNumberLoose(pick("saves")),
      follows_gained: parseNumberLoose(pick("follows_gained")),
      clicks_total: parseNumberLoose(pick("clicks_total")),
      clicks_other: parseNumberLoose(pick("clicks_other")),
      link_clicks: parseNumberLoose(pick("link_clicks")),
      monetization_approx: parseNumberLoose(pick("monetization_approx")),
      estimated_usd: parseNumberLoose(pick("estimated_usd")),
      stars_earnings_usd: parseNumberLoose(pick("stars_earnings_usd")),
      ad_cpm_usd: parseNumberLoose(pick("ad_cpm_usd")),
      ad_impressions: parseNumberLoose(pick("ad_impressions")),
      video_duration_s: parseNumberLoose(pick("video_duration_s")),
      watch_seconds_total: parseNumberLoose(pick("watch_seconds_total")),
      watch_seconds_avg: parseNumberLoose(pick("watch_seconds_avg")),
      source,
    });
  });

  // ── Deduplication ─────────────────────────────────────────────────────────
  const seen = new Set<string>();
  const deduped: ParsedPostRow[] = [];
  for (const r of rows) {
    const key = `${r.external_page_id}::${r.external_post_id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(r);
  }

  return {
    rows: deduped,
    errors,
    totalRows: parsed.data.length,
    detectedPages,
    periodStart,
    periodEnd,
    source,
  };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/** Detecta a fonte e faz o parsing automaticamente (Facebook ou Instagram). */
export function parseAnyCsv(text: string): ParseResult {
  const source = detectCsvSource(text);
  return parseRows(text, source);
}

/** @deprecated Use parseAnyCsv instead. Kept for backward compatibility. */
export function parseFacebookCsv(text: string): ParseResult {
  return parseRows(text, "facebook");
}

export function parseInstagramCsv(text: string): ParseResult {
  return parseRows(text, "instagram");
}

// ─── Ganhos (daily revenue) parser ───────────────────────────────────────────

/** Which daily metric the Facebook CSV contains. */
export type GanhosType = "revenue" | "views";

export interface GanhosRow {
  date: string;  // YYYY-MM-DD
  value: number; // revenue_usd or view count, depending on `type`
}

export interface GanhosParseResult {
  rows: GanhosRow[];
  periodStart: string | null;
  periodEnd: string | null;
  /** "revenue" → actual_revenue_usd, "views" → actual_views */
  type: GanhosType;
  /** Human-readable title from first line of CSV, e.g. "Ganhos aproximados" */
  title: string;
  isGanhos: true;
}

/**
 * Parses Facebook daily metric CSVs (Ganhos aproximados OR Visualizações).
 * Both formats share the same structure: title line → "Data","Primary" header → rows.
 * Detects the metric type from the title line.
 */
export function parseGanhosCsv(text: string): GanhosParseResult | null {
  // Remove BOM
  const clean = text.replace(/^﻿/, "").trim();
  const lines = clean.split(/\r?\n/).map(l => l.trim()).filter(Boolean);

  // First non-empty line is the report title (e.g. "Ganhos aproximados" or "Visualizações")
  let titleRaw = "";
  if (lines.length > 0) {
    const r = Papa.parse(lines[0], { header: false });
    titleRaw = ((r.data[0] as string[] | undefined)?.[0] ?? "").trim();
  }

  // Detect type from title — must be explicitly recognized as revenue or views.
  // Any other daily-metric CSV (seguidores, curtidas, alcance, impressões, etc.)
  // should NOT be treated as ganhos → return null so it falls through.
  const titleNorm = titleRaw.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  let type: GanhosType;
  if (titleNorm.includes("visualiza") || titleNorm.includes("view")) {
    type = "views";
  } else if (
    titleNorm.includes("ganho") ||
    titleNorm.includes("receita") ||
    titleNorm.includes("monetiz") ||
    titleNorm.includes("earning") ||
    titleNorm.includes("revenue")
  ) {
    type = "revenue";
  } else {
    // Unknown metric (seguidores, curtidas, alcance, impressões, etc.) — not handled here
    return null;
  }

  // Find header line that contains "Data" and "Primary"
  let headerIdx = -1;
  let dateCol = -1;
  let primaryCol = -1;

  for (let i = 0; i < lines.length; i++) {
    const result = Papa.parse(lines[i], { header: false });
    const cols = ((result.data[0] as string[] | undefined) ?? []).map(c =>
      c.toLowerCase().trim()
    );
    const di = cols.findIndex(c => c === "data" || c === "date");
    const pi = cols.findIndex(c => c === "primary");
    if (di >= 0 && pi >= 0) {
      headerIdx = i;
      dateCol = di;
      primaryCol = pi;
      break;
    }
  }

  if (headerIdx < 0) return null;

  const rows: GanhosRow[] = [];

  for (let i = headerIdx + 1; i < lines.length; i++) {
    const result = Papa.parse(lines[i], { header: false });
    const cols = (result.data[0] as string[] | undefined) ?? [];

    const dateRaw = (cols[dateCol] ?? "").replace(/^"|"$/g, "").trim();
    const primaryRaw = (cols[primaryCol] ?? "").replace(/^"|"$/g, "").trim();

    if (!dateRaw || !primaryRaw) continue;

    // Accept "2026-05-01T00:00:00" or "2026-05-01"
    const date = dateRaw.slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;

    const value = parseFloat(primaryRaw);
    if (isNaN(value)) continue;

    rows.push({ date, value });
  }

  if (rows.length === 0) return null;

  return {
    rows,
    periodStart: rows[0].date,
    periodEnd: rows[rows.length - 1].date,
    type,
    title: titleRaw,
    isGanhos: true,
  };
}

/**
 * Reads a File as text, handling UTF-8, UTF-16 LE/BE and BOM detection.
 * Facebook's "Ganhos" CSVs are often UTF-16 LE with BOM.
 */
export async function readFileText(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);

  // UTF-16 LE BOM: FF FE
  if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    return new TextDecoder("utf-16le").decode(bytes.slice(2));
  }
  // UTF-16 BE BOM: FE FF
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    return new TextDecoder("utf-16be").decode(bytes.slice(2));
  }
  // UTF-8 BOM: EF BB BF
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return new TextDecoder("utf-8").decode(bytes.slice(3));
  }
  return new TextDecoder("utf-8").decode(bytes);
}

// ─── File utilities ───────────────────────────────────────────────────────────

export async function hashFile(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
