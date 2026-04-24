// Formatação BRL e datas pt-BR
import { format as dfFormat, parse as dfParse, isValid } from "date-fns";
import { ptBR } from "date-fns/locale";

export const formatBRL = (v: number | string | null | undefined): string => {
  const n = typeof v === "string" ? Number(v) : (v ?? 0);
  if (!Number.isFinite(n)) return "R$ 0,00";
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(n);
};

export const formatNumber = (v: number | null | undefined): string => {
  const n = v ?? 0;
  return new Intl.NumberFormat("pt-BR").format(n);
};

export const formatPct = (v: number | null | undefined, digits = 2): string => {
  const n = v ?? 0;
  return `${n.toFixed(digits).replace(".", ",")}%`;
};

export const formatDate = (d: string | Date | null | undefined, pattern = "dd/MM/yyyy"): string => {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  if (!isValid(date)) return "—";
  return dfFormat(date, pattern, { locale: ptBR });
};

export const formatDateTime = (d: string | Date | null | undefined): string =>
  formatDate(d, "dd/MM/yyyy HH:mm");

export const formatMonth = (monthRef: string): string => {
  // "2025-03" -> "Março/2025"
  const [y, m] = monthRef.split("-");
  const date = new Date(Number(y), Number(m) - 1, 1);
  return dfFormat(date, "MMMM/yyyy", { locale: ptBR });
};

// Parse datas mistas: dd/MM/yyyy HH:mm | MM/dd/yyyy HH:mm | ISO
export function parseMixedDate(input: string): Date | null {
  if (!input) return null;
  const s = input.trim();
  const patterns = [
    "dd/MM/yyyy HH:mm:ss",
    "dd/MM/yyyy HH:mm",
    "dd/MM/yyyy",
    "MM/dd/yyyy HH:mm:ss",
    "MM/dd/yyyy HH:mm",
    "MM/dd/yyyy",
    "yyyy-MM-dd HH:mm:ss",
    "yyyy-MM-dd'T'HH:mm:ssXXX",
    "yyyy-MM-dd",
  ];
  for (const p of patterns) {
    try {
      const d = dfParse(s, p, new Date());
      if (isValid(d)) return d;
    } catch {}
  }
  const d = new Date(s);
  return isValid(d) ? d : null;
}

// Parse número pt-BR ou en-US: "1.234,56" | "1,234.56" | "1234.56"
export function parseNumberLoose(input: string | number | null | undefined): number {
  if (input == null || input === "") return 0;
  if (typeof input === "number") return input;
  let s = String(input).trim().replace(/[R$\s]/g, "");
  if (s === "" || s === "-") return 0;
  const hasComma = s.includes(",");
  const hasDot = s.includes(".");
  if (hasComma && hasDot) {
    // última vírgula OU ponto é decimal
    const lastComma = s.lastIndexOf(",");
    const lastDot = s.lastIndexOf(".");
    if (lastComma > lastDot) {
      s = s.replace(/\./g, "").replace(",", ".");
    } else {
      s = s.replace(/,/g, "");
    }
  } else if (hasComma) {
    s = s.replace(/\./g, "").replace(",", ".");
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}
