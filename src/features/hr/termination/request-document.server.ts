import "server-only";

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

function wrapText(text: string, maxChars = 88) {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  words.forEach((word) => {
    const next = line ? `${line} ${word}` : word;
    if (next.length > maxChars && line) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  });
  if (line) lines.push(line);
  return lines;
}

function drawWrappedText(
  page: ReturnType<PDFDocument["addPage"]>,
  font: Awaited<ReturnType<PDFDocument["embedFont"]>>,
  text: string,
  y: number,
  options: { size?: number; boldFont?: typeof font; color?: ReturnType<typeof rgb> } = {},
) {
  const size = options.size ?? 10;
  wrapText(text).forEach((line) => {
    page.drawText(line, { x: 48, y, size, font: options.boldFont ?? font, color: options.color ?? rgb(0.15, 0.15, 0.18) });
    y -= size + 5;
  });
  return y;
}

export async function buildTerminationRequestConfirmation(params: {
  protocol: string;
  employeeName: string;
  cpfMasked: string;
  companyName: string;
  submittedAt: string;
  noticePreference: "work" | "request_waiver";
  desiredLastDay?: string | null;
  originalHash: string;
  originalMimeType: string;
  originalBuffer: Buffer;
}) {
  const document = await PDFDocument.create();
  const regular = await document.embedFont(StandardFonts.Helvetica);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);
  const cover = document.addPage([595.28, 841.89]);
  cover.drawRectangle({ x: 0, y: 0, width: 595.28, height: 841.89, color: rgb(0.99, 0.99, 0.995) });
  cover.drawText("COMPROVANTE ELETRÔNICO DO PEDIDO DE DEMISSÃO", {
    x: 48, y: 780, size: 15, font: bold, color: rgb(0.82, 0.08, 0.35),
  });
  let y = 742;
  const rows = [
    ["Protocolo", params.protocol],
    ["Colaborador", params.employeeName],
    ["CPF", params.cpfMasked],
    ["Empresa", params.companyName],
    ["Enviado em", new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "medium", timeZone: "America/Belem" }).format(new Date(params.submittedAt))],
    ["Preferência de aviso-prévio", params.noticePreference === "work" ? "Cumprir 30 dias" : "Solicitar dispensa do cumprimento"],
    ["Último dia desejado", params.desiredLastDay || "Não informado"],
  ];
  rows.forEach(([label, value]) => {
    cover.drawText(`${label}:`, { x: 48, y, size: 10, font: bold, color: rgb(0.3, 0.3, 0.34) });
    cover.drawText(value, { x: 205, y, size: 10, font: regular, color: rgb(0.15, 0.15, 0.18) });
    y -= 24;
  });
  y -= 12;
  cover.drawText("DECLARAÇÃO", { x: 48, y, size: 11, font: bold, color: rgb(0.15, 0.15, 0.18) });
  y -= 24;
  y = drawWrappedText(
    cover,
    regular,
    "Confirmo que fui eu quem produziu e enviou a carta anexada, que solicito espontaneamente meu desligamento e que as informações apresentadas correspondem à minha livre manifestação de vontade nesta data.",
    y,
  );
  y -= 14;
  cover.drawText("INTEGRIDADE DO ANEXO", { x: 48, y, size: 11, font: bold, color: rgb(0.15, 0.15, 0.18) });
  y -= 24;
  y = drawWrappedText(cover, regular, `SHA-256 do arquivo original: ${params.originalHash}`, y, { size: 8 });
  drawWrappedText(cover, regular, "As páginas seguintes reproduzem a carta manuscrita apresentada pelo colaborador. O arquivo original permanece preservado separadamente.", y - 10, { size: 9, color: rgb(0.35, 0.35, 0.4) });

  if (params.originalMimeType === "application/pdf") {
    const source = await PDFDocument.load(params.originalBuffer);
    const pages = await document.copyPages(source, source.getPageIndices());
    pages.forEach((page) => document.addPage(page));
  } else if (params.originalMimeType === "image/png") {
    const image = await document.embedPng(params.originalBuffer);
    const page = document.addPage([595.28, 841.89]);
    const scale = Math.min(499 / image.width, 745 / image.height);
    page.drawImage(image, { x: (595.28 - image.width * scale) / 2, y: (841.89 - image.height * scale) / 2, width: image.width * scale, height: image.height * scale });
  } else {
    const image = await document.embedJpg(params.originalBuffer);
    const page = document.addPage([595.28, 841.89]);
    const scale = Math.min(499 / image.width, 745 / image.height);
    page.drawImage(image, { x: (595.28 - image.width * scale) / 2, y: (841.89 - image.height * scale) / 2, width: image.width * scale, height: image.height * scale });
  }

  return Buffer.from(await document.save());
}
