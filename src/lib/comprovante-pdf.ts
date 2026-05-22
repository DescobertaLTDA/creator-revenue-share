import LOGO from "@/assets/logo.webp";
import { jsPDF } from "jspdf";

export interface ClosingInfo {
  month_ref: string;
  pages: { nome: string } | null;
}

export interface ItemInfo {
  collaborators: { nome: string; hashtag: string | null; avatar_url: string | null } | null;
  gross_revenue: number;
  collaborator_pct: number;
  amount_due: number;
  adjustments: number;
  final_amount: number;
  payment_status: string;
  paid_at: string | null;
  payment_note: string | null;
}

interface PaymentNote {
  method: string;
  date: string;
  txId: string;
  amountBrl: number;
  obs: string;
}

function parseNote(raw: string | null): PaymentNote | null {
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

function fmtMonth(monthRef: string): string {
  const [y, m] = monthRef.split("-").map(Number);
  const months = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];
  return `${months[m - 1]}/${y}`;
}

function fmtBRL(v: number): string {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export async function loadLogoBase64(): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth || 64;
      canvas.height = img.naturalHeight || 64;
      canvas.getContext("2d")!.drawImage(img, 0, 0);
      resolve(canvas.toDataURL("image/png"));
    };
    img.onerror = reject;
    img.src = LOGO;
  });
}

function buildPage(doc: jsPDF, item: ItemInfo, closing: ClosingInfo, usdBrl: number, logoB64: string) {
  const W = 210;
  const M = 18;
  const orange: [number, number, number] = [250, 166, 19];
  const dark: [number, number, number] = [18, 18, 18];
  const gray: [number, number, number] = [120, 120, 120];

  // ── Header ──────────────────────────────────────────────────────────────────
  doc.setFillColor(...dark);
  doc.rect(0, 0, W, 44, "F");

  try { doc.addImage(logoB64, "PNG", M, 9, 26, 26); } catch { /* logo unavailable */ }

  doc.setTextColor(255, 255, 255);
  doc.setFontSize(15);
  doc.setFont("helvetica", "bold");
  doc.text("Splash Creators", M + 31, 22);

  doc.setFontSize(8.5);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(160, 160, 160);
  doc.text("Comprovante de Pagamento", M + 31, 30);

  doc.setFontSize(10);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...orange);
  doc.text(fmtMonth(closing.month_ref), W - M, 22, { align: "right" });

  doc.setFontSize(8);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(150, 150, 150);
  doc.text(closing.pages?.nome ?? "—", W - M, 30, { align: "right" });

  // ── Collaborator ─────────────────────────────────────────────────────────────
  let y = 56;
  const nome = item.collaborators?.nome ?? "—";
  const handle = item.collaborators?.hashtag ? `@${item.collaborators.hashtag}` : "";

  doc.setFontSize(7.5);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...gray);
  doc.text("COLABORADOR", M, y);

  y += 5;
  doc.setFontSize(17);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...dark);
  doc.text(nome, M, y);

  if (handle) {
    y += 5.5;
    doc.setFontSize(9);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...gray);
    doc.text(handle, M, y);
  }

  y += 7;
  doc.setFillColor(...orange);
  doc.rect(M, y, W - 2 * M, 0.8, "F");
  y += 8;

  // ── Financial breakdown ──────────────────────────────────────────────────────
  doc.setFontSize(7.5);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...gray);
  doc.text("DETALHAMENTO FINANCEIRO", M, y);
  y += 6;

  const rows: [string, string, boolean][] = [
    [`Receita bruta (posts)`, `$${item.gross_revenue.toFixed(2)}`, false],
    [`Participação (${item.collaborator_pct}%)`, `$${item.amount_due.toFixed(2)}`, false],
  ];
  if (item.adjustments !== 0) {
    rows.push([`Ajuste / Bônus`, `${item.adjustments >= 0 ? "+" : ""}$${item.adjustments.toFixed(2)}`, false]);
  }

  for (const [label, value] of rows) {
    doc.setFillColor(247, 247, 247);
    doc.roundedRect(M, y, W - 2 * M, 8.5, 1.5, 1.5, "F");
    doc.setFontSize(9);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(70, 70, 70);
    doc.text(label, M + 4, y + 5.5);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...dark);
    doc.text(value, W - M - 4, y + 5.5, { align: "right" });
    y += 10.5;
  }

  // Total row
  y += 2;
  doc.setFillColor(...orange);
  doc.roundedRect(M, y, W - 2 * M, 12, 2, 2, "F");
  doc.setFontSize(10.5);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(255, 255, 255);
  doc.text("TOTAL A RECEBER", M + 5, y + 8);
  doc.text(`$${item.final_amount.toFixed(2)} USD`, W - M - 5, y + 8, { align: "right" });
  y += 15;

  // BRL conversion
  doc.setFillColor(240, 253, 244);
  doc.roundedRect(M, y, W - 2 * M, 8.5, 1.5, 1.5, "F");
  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(...gray);
  doc.text(`Conversão à cotação USD/BRL ${usdBrl.toFixed(2)}`, M + 4, y + 5.5);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(22, 163, 74);
  doc.text(fmtBRL(item.final_amount * usdBrl), W - M - 4, y + 5.5, { align: "right" });
  y += 13;

  // ── Payment info ─────────────────────────────────────────────────────────────
  y += 4;
  const note = parseNote(item.payment_note);

  if (note && item.payment_status === "pago_fora") {
    doc.setFontSize(7.5);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...gray);
    doc.text("DADOS DO PAGAMENTO", M, y);
    y += 7;

    const payRows: [string, string][] = [
      ["Status", "✓  Pago"],
      ["Método", note.method || "—"],
      ["Data do pagamento", note.date || "—"],
    ];
    if (note.txId) payRows.push(["ID / Comprovante", note.txId]);
    if (note.amountBrl) payRows.push(["Valor pago (BRL)", fmtBRL(note.amountBrl)]);
    if (note.obs) payRows.push(["Observação", note.obs]);

    for (const [label, value] of payRows) {
      doc.setFontSize(9);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(...gray);
      doc.text(label, M, y);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(label === "Status" ? 22 : dark[0], label === "Status" ? 163 : dark[1], label === "Status" ? 74 : dark[2]);
      doc.text(value, M + 62, y);
      y += 6.5;
    }
  } else {
    doc.setFillColor(255, 248, 230);
    doc.roundedRect(M, y, W - 2 * M, 10, 2, 2, "F");
    doc.setFontSize(9);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(180, 100, 0);
    doc.text("Pagamento pendente — ainda não confirmado", M + 5, y + 6.5);
    y += 14;
  }

  // ── Footer ───────────────────────────────────────────────────────────────────
  const footerY = 280;
  doc.setDrawColor(220, 220, 220);
  doc.setLineWidth(0.4);
  doc.line(M, footerY, W - M, footerY);

  doc.setFontSize(7.5);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(...gray);
  doc.text("Splash Creators — Gestão de Páginas", M, footerY + 5);
  const now = new Date();
  doc.text(
    `Gerado em ${now.toLocaleDateString("pt-BR")} às ${now.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`,
    W - M, footerY + 5, { align: "right" }
  );
}

export function buildSingleComprovante(
  item: ItemInfo, closing: ClosingInfo, usdBrl: number, logoB64: string
): Blob {
  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
  buildPage(doc, item, closing, usdBrl, logoB64);
  return doc.output("blob");
}

export function buildAllComprovantes(
  items: ItemInfo[], closing: ClosingInfo, usdBrl: number, logoB64: string
): Blob {
  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
  items.forEach((item, i) => {
    if (i > 0) doc.addPage();
    buildPage(doc, item, closing, usdBrl, logoB64);
  });
  return doc.output("blob");
}
