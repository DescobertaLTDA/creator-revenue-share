import Papa from "papaparse";
import { parseMixedDate, parseNumberLoose } from "@/lib/format";

// Mapeamento de cabeçalhos do CSV do Facebook (PT e variantes comuns).
// Valor = chave semântica interna.
const HEADER_MAP: Record<string, string> = {
  "identificação do post": "external_post_id",
  "identificacao do post": "external_post_id",
  "post id": "external_post_id",
  "id do post": "external_post_id",

  "identificação da página": "external_page_id",
  "identificacao da pagina": "external_page_id",
  "page id": "external_page_id",
  "id da página": "external_page_id",
  "id da pagina": "external_page_id",

  "nome da página": "page_name",
  "nome da pagina": "page_name",
  "page name": "page_name",

  "horário de publicação": "published_at",
  "horario de publicacao": "published_at",
  "data de publicação": "published_at",
  "publish time": "published_at",

  "título": "title",
  "titulo": "title",
  "title": "title",

  "descrição": "description",
  "descricao": "description",
  "description": "description",

  "permalink": "permalink",
  "link": "permalink",

  "tipo de postagem": "post_type",
  "post type": "post_type",

  "idioma": "language",
  "language": "language",

  "visualizações": "views",
  "visualizacoes": "views",
  "views": "views",

  "alcance": "reach",
  "reach": "reach",

  "reações": "reactions",
  "reacoes": "reactions",
  "reactions": "reactions",

  "comentários": "comments",
  "comentarios": "comments",
  "comments": "comments",

  "compartilhamentos": "shares",
  "shares": "shares",

  "cliques (total)": "clicks_total",
  "clicks (total)": "clicks_total",
  "total clicks": "clicks_total",

  "outros cliques": "clicks_other",
  "other clicks": "clicks_other",

  "cliques em links": "link_clicks",
  "link clicks": "link_clicks",

  "ganhos aproximados com a monetização de conteúdo": "monetization_approx",
  "ganhos aproximados com a monetizacao de conteudo": "monetization_approx",
  "approximate earnings from content monetization": "monetization_approx",

  "ganhos estimados (usd)": "estimated_usd",
  "estimated earnings (usd)": "estimated_usd",
};

const normalizeHeader = (h: string) =>
  h
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();

export interface ParsedPostRow {
  external_post_id: string;
  external_page_id: string;
  page_name: string;
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
  clicks_total: number;
  clicks_other: number;
  link_clicks: number;
  monetization_approx: number;
  estimated_usd: number;
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
}

/**
 * Faz o parsing do CSV exportado pelo Facebook.
 * Aceita cabeçalhos em PT (com/sem acentos) e valores numéricos mistos.
 */
export function parseFacebookCsv(text: string): ParseResult {
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
    const rowNumber = idx + 2; // +1 header +1 human
    const pick = (semanticKey: string): string => {
      for (const [h, k] of Object.entries(HEADER_MAP)) {
        if (k === semanticKey && raw[h] != null && raw[h] !== "") return String(raw[h]);
      }
      return "";
    };

    const external_post_id = pick("external_post_id").trim();
    const external_page_id = pick("external_page_id").trim();
    const page_name = pick("page_name").trim();

    if (!external_post_id || !external_page_id) {
      errors.push({
        row_number: rowNumber,
        field_name: !external_post_id ? "external_post_id" : "external_page_id",
        error_message: "Identificação do post ou da página ausente.",
        raw_payload: raw,
      });
      return;
    }

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
      page_name: page_name || external_page_id,
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
      clicks_total: parseNumberLoose(pick("clicks_total")),
      clicks_other: parseNumberLoose(pick("clicks_other")),
      link_clicks: parseNumberLoose(pick("link_clicks")),
      monetization_approx: parseNumberLoose(pick("monetization_approx")),
      estimated_usd: parseNumberLoose(pick("estimated_usd")),
    });
  });

  // Deduplicação por (page_id + post_id) dentro do próprio arquivo
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
  };
}

export async function hashFile(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
