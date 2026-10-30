import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { z } from "zod";
import { safeAssetCustodyTermText } from "./custody-term-pdf";

export const maintenanceOrderPdfSchema = z.object({ protocol: z.string().trim().min(1).max(80), issuedAt: z.string().datetime({ offset: true }), type: z.enum(["preventive", "corrective", "manual"]), asset: z.object({ code: z.string().trim().min(1).max(100), name: z.string().trim().min(1).max(240), brand: z.string().trim().max(160).optional(), model: z.string().trim().max(160).optional() }).strict(), description: z.string().trim().min(1).max(3000), checklist: z.array(z.string().trim().min(1).max(300)).max(100), components: z.array(z.string().trim().min(1).max(200)).max(30), supplierName: z.string().trim().max(240).optional() }).strict();
export async function renderMaintenanceOrderPdf(raw: z.infer<typeof maintenanceOrderPdfSchema>) {
  const input = maintenanceOrderPdfSchema.parse(raw); const pdf = await PDFDocument.create(); const page = pdf.addPage([595.28, 841.89]); const regular = await pdf.embedFont(StandardFonts.Helvetica); const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  page.drawText("ORDEM DE MANUTENÇÃO PATRIMONIAL", { x: 50, y: 750, size: 15, font: bold }); page.drawText(`Protocolo ${input.protocol}`, { x: 50, y: 728, size: 8, font: regular });
  let y = 690; const rows = [["Tipo", input.type], ["Patrimônio", `${input.asset.code} · ${input.asset.name}`], ["Marca / modelo", [input.asset.brand, input.asset.model].filter(Boolean).join(" / ")], ["Fornecedor", input.supplierName]];
  for (const [label, value] of rows) if (value) { page.drawText(String(label).toUpperCase(), { x: 52, y, size: 7, font: bold, color: rgb(.45,.18,.3) }); page.drawText(safeAssetCustodyTermText(value), { x: 170, y, size: 9, font: regular, maxWidth: 360 }); y -= 24; }
  page.drawText("DESCRIÇÃO", { x: 52, y: y - 10, size: 8, font: bold }); page.drawText(safeAssetCustodyTermText(input.description), { x: 52, y: y - 28, size: 9, font: regular, maxWidth: 490 }); y -= 70;
  page.drawText("CHECKLIST", { x: 52, y, size: 8, font: bold }); input.checklist.slice(0, 14).forEach((item, index) => page.drawText(`[  ] ${safeAssetCustodyTermText(item)}`, { x: 58, y: y - 18 - index * 17, size: 8, font: regular, maxWidth: 480 })); y -= 35 + Math.min(input.checklist.length, 14) * 17;
  if (input.components.length) { page.drawText("COMPONENTES ENVIADOS", { x: 52, y, size: 8, font: bold }); input.components.slice(0, 8).forEach((item, index) => page.drawText(`• ${safeAssetCustodyTermText(item)}`, { x: 58, y: y - 18 - index * 16, size: 8, font: regular })); y -= 35 + Math.min(input.components.length, 8) * 16; }
  page.drawText("OUTROS COMPONENTES ENTREGUES (PREENCHIMENTO MANUAL)", { x: 52, y: Math.max(y, 170), size: 7.5, font: bold }); for (let i=0;i<3;i++) page.drawLine({ start: { x: 52, y: Math.max(y,170)-20-i*22 }, end: { x: 540, y: Math.max(y,170)-20-i*22 }, thickness: .5 });
  return Buffer.from(await pdf.save({ useObjectStreams: false }));
}
