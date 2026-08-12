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
  companyCnpj: string;
  companyAddress: string;
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
    ["CNPJ", params.companyCnpj],
    ["Endereço da empregadora", params.companyAddress || "Não informado"],
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
    "Confirmo que escrevi integralmente à mão, datei, assinei e enviei a carta anexada, que solicito espontaneamente meu desligamento e que as informações apresentadas correspondem à minha livre manifestação de vontade nesta data.",
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

export async function buildEmployerDismissalNotice(params: {
  protocol: string;
  employeeName: string;
  cpfMasked: string;
  companyName: string;
  companyCnpj: string;
  companyAddress: string;
  communicationAt: string;
  communicationLocation: string;
  responsibleName: string;
  participants: string[];
  noticeType: "worked" | "indemnified";
  contractEndDate: string;
}) {
  const document = await PDFDocument.create();
  const regular = await document.embedFont(StandardFonts.Helvetica);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);
  const page = document.addPage([595.28, 841.89]);
  page.drawRectangle({ x: 0, y: 0, width: 595.28, height: 841.89, color: rgb(0.99, 0.99, 0.995) });
  page.drawText("COMUNICADO DE DISPENSA SEM JUSTA CAUSA", {
    x: 48, y: 780, size: 15, font: bold, color: rgb(0.82, 0.08, 0.35),
  });
  let y = 738;
  const rows = [
    ["Protocolo", params.protocol],
    ["Colaborador(a)", params.employeeName],
    ["CPF", params.cpfMasked],
    ["Empresa", params.companyName],
    ["CNPJ", params.companyCnpj],
    ["Endereço da empregadora", params.companyAddress || "Não informado"],
    ["Comunicação presencial", new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Belem" }).format(new Date(params.communicationAt))],
    ["Local", params.communicationLocation],
    ["Responsável pela comunicação", params.responsibleName],
    ["Outros participantes", params.participants.length ? params.participants.join(", ") : "Não informados"],
    ["Aviso-prévio", params.noticeType === "worked" ? "Trabalhado" : "Indenizado"],
    ["Término informado", new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC" }).format(new Date(`${params.contractEndDate}T12:00:00Z`))],
  ];
  rows.forEach(([label, value]) => {
    page.drawText(`${label}:`, { x: 48, y, size: 9.5, font: bold, color: rgb(0.3, 0.3, 0.34) });
    page.drawText(value, { x: 205, y, size: 9.5, font: regular, color: rgb(0.15, 0.15, 0.18), maxWidth: 335 });
    y -= 23;
  });
  y -= 18;
  page.drawText("COMUNICAÇÃO FORMAL", { x: 48, y, size: 11, font: bold, color: rgb(0.15, 0.15, 0.18) });
  y -= 26;
  y = drawWrappedText(
    page,
    regular,
    `Por meio deste documento, a empresa comunica a ${params.employeeName} a decisão de encerrar o contrato de trabalho, por iniciativa do empregador e sem justa causa, observadas as datas e a modalidade de aviso-prévio registradas acima.`,
    y,
  );
  y -= 14;
  y = drawWrappedText(
    page,
    regular,
    "A assinatura eletrônica registra o recebimento e a ciência desta comunicação. Ela não representa concordância com os cálculos rescisórios, que serão apresentados em documentos próprios.",
    y,
  );
  y -= 36;
  page.drawText("Assinaturas eletrônicas", { x: 48, y, size: 10, font: bold, color: rgb(0.35, 0.35, 0.4) });
  drawWrappedText(page, regular, "Este documento será assinado eletronicamente pela empresa e pelo(a) colaborador(a), com registro de data, hora e trilha de auditoria pela plataforma de assinatura.", y - 20, { size: 9, color: rgb(0.35, 0.35, 0.4) });
  return Buffer.from(await document.save());
}
