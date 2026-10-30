import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { z } from "zod";

const shortText = z.string().trim().min(1).max(240);
export const assetCustodyTermPdfInputSchema = z.object({
  protocol: z.string().trim().regex(/^[A-Z0-9]+-PAT-\d{4}-\d{6}$/),
  issuedAt: z.string().datetime({ offset: true }),
  effectiveAt: z.string().datetime({ offset: true }),
  company: z.object({ legalName: shortText, tradeName: z.string().trim().max(240).optional(), cnpj: z.string().trim().min(14).max(24), address: z.string().trim().max(500).optional() }).strict(),
  employee: z.object({ name: shortText }).strict(),
  asset: z.object({ code: shortText, name: shortText, category: z.string().trim().max(160).optional(), brand: z.string().trim().max(160).optional(), model: z.string().trim().max(160).optional(), assetTag: z.string().trim().max(160).optional() }).strict(),
  condition: z.string().trim().max(1000).optional(),
  accessories: z.array(z.string().trim().min(1).max(160)).max(30),
}).strict();

export type AssetCustodyTermPdfInput = z.infer<typeof assetCustodyTermPdfInputSchema>;

const forbidden = /\b(?:imei|telefone|phone|senha|password|token|segredo|secret|chave\s+privada)\b/i;
export function safeAssetCustodyTermText(value: unknown) {
  const text = String(value ?? "").replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  return forbidden.test(text) || /(?:^|\D)\d{10,15}(?:\D|$)/.test(text) ? "[dado omitido]" : text;
}

function dateBr(value: string) {
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "long", timeZone: "America/Sao_Paulo" }).format(new Date(value));
}

function wrap(text: string, font: PDFFont, size: number, width: number) {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const candidate = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= width) line = candidate;
    else { if (line) lines.push(line); line = word; }
  }
  if (line) lines.push(line);
  return lines;
}

function paragraph(page: PDFPage, text: string, y: number, font: PDFFont, size = 9.5) {
  const lines = wrap(safeAssetCustodyTermText(text), font, size, 490);
  lines.forEach((line, index) => page.drawText(line, { x: 52, y: y - index * 14, size, font, color: rgb(0.12, 0.12, 0.14) }));
  return y - lines.length * 14 - 8;
}

export async function renderAssetCustodyTermPdf(raw: AssetCustodyTermPdfInput) {
  const input = assetCustodyTermPdfInputSchema.parse(raw);
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595.28, 841.89]);
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  page.drawText("TERMO DE ENTREGA E RESPONSABILIDADE DE PATRIMÔNIO", { x: 52, y: 750, size: 13, font: bold, color: rgb(0.1, 0.1, 0.12), maxWidth: 490 });
  page.drawText(`Protocolo ${input.protocol}`, { x: 52, y: 728, size: 8, font: regular, color: rgb(0.35, 0.35, 0.4) });
  let y = 694;
  y = paragraph(page, `${input.company.legalName}, CNPJ ${input.company.cnpj}, entrega a ${input.employee.name} o patrimônio abaixo identificado, com efeitos a partir de ${dateBr(input.effectiveAt)}.`, y, regular);
  const rows = [
    ["Código patrimonial", input.asset.code], ["Equipamento", input.asset.name], ["Categoria", input.asset.category],
    ["Marca / modelo", [input.asset.brand, input.asset.model].filter(Boolean).join(" / ")], ["Etiqueta do ativo", input.asset.assetTag],
  ].filter((row) => row[1]);
  for (const [label, value] of rows) {
    page.drawText(String(label).toUpperCase(), { x: 58, y, size: 7, font: bold, color: rgb(0.45, 0.18, 0.3) });
    page.drawText(safeAssetCustodyTermText(value), { x: 190, y, size: 9, font: regular, color: rgb(0.12, 0.12, 0.14), maxWidth: 350 });
    y -= 24;
  }
  y -= 8;
  if (input.condition) y = paragraph(page, `Estado na entrega: ${safeAssetCustodyTermText(input.condition)}`, y, regular);
  if (input.accessories.length) y = paragraph(page, `Acessórios entregues: ${input.accessories.map(safeAssetCustodyTermText).join(", ")}.`, y, regular);
  y = paragraph(page, "O colaborador declara receber o patrimônio nas condições registradas, compromete-se a utilizá-lo exclusivamente para as atividades autorizadas, zelar por sua conservação e comunicar imediatamente perda, dano ou necessidade de manutenção.", y - 8, regular);
  y = paragraph(page, "A assinatura eletrônica confirma a entrega e a ciência das responsabilidades, sem autorizar desconto automático ou renúncia a direitos.", y, regular);
  page.drawText(`Emitido em ${dateBr(input.issuedAt)}.`, { x: 52, y: Math.max(y - 10, 160), size: 8, font: regular, color: rgb(0.35, 0.35, 0.4) });
  page.drawText("Assinaturas eletrônicas: colaborador e representante institucional.", { x: 52, y: 112, size: 8.5, font: bold, color: rgb(0.12, 0.12, 0.14) });
  return Buffer.from(await pdf.save({ useObjectStreams: false }));
}
