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

/** v2: cláusula de aparelhos gerenciados, alinhada ao termo LGPD v6 (seção 3-B, inciso VIII). */
export const ASSET_CUSTODY_TERM_VERSION = 2;

export const ASSET_CUSTODY_TERM_MANAGED_DEVICE_CLAUSE =
  "Quando o patrimônio for celular, tablet ou outro aparelho com o Coala Go, ele poderá ser administrado por ferramenta de gestão de dispositivos, que permite identificar o aparelho e o usuário vinculado, instalar e atualizar aplicativos da empresa, aplicar configurações de segurança e bloqueá-lo ou apagá-lo remotamente em caso de perda, roubo, substituição ou encerramento do vínculo. O aparelho destina-se ao trabalho, e o colaborador não deverá armazenar nele conteúdo pessoal. O tratamento de dados, inclusive o acompanhamento de localização nos turnos configurados, segue o Termo de Ciência sobre o Tratamento de Dados Pessoais.";

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
  const words = text.split(/\s+/).filter(Boolean).flatMap((word) => {
    const chunks: string[] = [];
    let chunk = "";
    for (const character of word) {
      if (chunk && font.widthOfTextAtSize(chunk + character, size) > width) {
        chunks.push(chunk);
        chunk = character;
      } else chunk += character;
    }
    if (chunk) chunks.push(chunk);
    return chunks;
  });
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= width) line = candidate;
    else { if (line) lines.push(line); line = word; }
  }
  if (line) lines.push(line);
  return lines;
}

export async function renderAssetCustodyTermPdf(raw: AssetCustodyTermPdfInput) {
  const input = assetCustodyTermPdfInputSchema.parse(raw);
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  let page!: PDFPage;
  let y = 0;
  const startPage = () => {
    page = pdf.addPage([595.28, 841.89]);
    page.drawText("TERMO DE ENTREGA E RESPONSABILIDADE DE PATRIMÔNIO", { x: 52, y: 750, size: 13, font: bold, color: rgb(0.1, 0.1, 0.12), maxWidth: 490 });
    page.drawText(`Protocolo ${input.protocol}`, { x: 52, y: 728, size: 8, font: regular, color: rgb(0.35, 0.35, 0.4) });
    y = 694;
  };
  const ensureRoom = (height: number) => { if (y - height < 150) startPage(); };
  const paragraph = (text: string, before = 0) => {
    y -= before;
    for (const line of wrap(safeAssetCustodyTermText(text), regular, 9.5, 490)) {
      ensureRoom(14);
      page.drawText(line, { x: 52, y, size: 9.5, font: regular, color: rgb(0.12, 0.12, 0.14) });
      y -= 14;
    }
    y -= 8;
  };
  startPage();
  paragraph(`${input.company.legalName}, CNPJ ${input.company.cnpj}, entrega a ${input.employee.name} o patrimônio abaixo identificado, com efeitos a partir de ${dateBr(input.effectiveAt)}.`);
  const rows = [
    ["Código patrimonial", input.asset.code], ["Equipamento", input.asset.name], ["Categoria", input.asset.category],
    ["Marca / modelo", [input.asset.brand, input.asset.model].filter(Boolean).join(" / ")], ["Etiqueta do ativo", input.asset.assetTag],
  ].filter((row) => row[1]);
  for (const [label, value] of rows) {
    const lines = wrap(safeAssetCustodyTermText(value), regular, 9, 350);
    ensureRoom(Math.max(24, lines.length * 14));
    page.drawText(String(label).toUpperCase(), { x: 58, y, size: 7, font: bold, color: rgb(0.45, 0.18, 0.3) });
    for (const [index, line] of lines.entries()) page.drawText(line, { x: 190, y: y - index * 14, size: 9, font: regular, color: rgb(0.12, 0.12, 0.14) });
    y -= Math.max(24, lines.length * 14);
  }
  y -= 8;
  if (input.condition) paragraph(`Estado na entrega: ${safeAssetCustodyTermText(input.condition)}`);
  if (input.accessories.length) paragraph(`Acessórios entregues: ${input.accessories.map(safeAssetCustodyTermText).join(", ")}.`);
  paragraph("O colaborador declara receber o patrimônio nas condições registradas, compromete-se a utilizá-lo exclusivamente para as atividades autorizadas, zelar por sua conservação e comunicar imediatamente perda, dano ou necessidade de manutenção.", 8);
  paragraph(ASSET_CUSTODY_TERM_MANAGED_DEVICE_CLAUSE);
  paragraph("A assinatura eletrônica confirma a entrega e a ciência das responsabilidades, sem autorizar desconto automático ou renúncia a direitos.");
  ensureRoom(24);
  page.drawText(`Emitido em ${dateBr(input.issuedAt)}.`, { x: 52, y: y - 10, size: 8, font: regular, color: rgb(0.35, 0.35, 0.4) });
  page.drawText("Assinaturas eletrônicas: colaborador e representante institucional.", { x: 52, y: 112, size: 8.5, font: bold, color: rgb(0.12, 0.12, 0.14) });
  return Buffer.from(await pdf.save({ useObjectStreams: false }));
}
