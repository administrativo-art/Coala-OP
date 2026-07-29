import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import PizZip from "pizzip";

const SOURCE = path.resolve("docs/modelos-documentos/admissionais/06-vale-transporte-v1.docx");
const OUTPUT = path.resolve("docs/modelos-documentos/recibos/recibo-v1.docx");

function run(text: string, options?: { bold?: boolean; size?: number }) {
  const properties = [
    '<w:rFonts w:ascii="Carlito" w:hAnsi="Carlito" w:cs="Carlito"/>',
    options?.bold ? "<w:b/><w:bCs/>" : "",
    `<w:sz w:val="${options?.size ?? 22}"/><w:szCs w:val="${options?.size ?? 22}"/>`,
  ].join("");
  return `<w:r><w:rPr>${properties}</w:rPr><w:t xml:space="preserve">${text}</w:t></w:r>`;
}

function paragraph(text: string, options?: {
  bold?: boolean;
  size?: number;
  align?: "left" | "center" | "right";
  before?: number;
  after?: number;
}) {
  return `<w:p><w:pPr><w:spacing w:before="${options?.before ?? 0}" w:after="${options?.after ?? 140}"/><w:jc w:val="${options?.align ?? "left"}"/></w:pPr>${run(text, options)}</w:p>`;
}

function cell(content: string, width: number, bold = false) {
  return `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/><w:tcMar><w:top w:w="100" w:type="dxa"/><w:left w:w="100" w:type="dxa"/><w:bottom w:w="100" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tcMar></w:tcPr>${paragraph(content, { bold, after: 0 })}</w:tc>`;
}

const source = await readFile(SOURCE);
const zip = new PizZip(source);
const documentPath = "word/document.xml";
const original = zip.file(documentPath)?.asText();
if (!original) throw new Error("DOCX base sem document.xml.");
const rootOpen = original.match(/^([\s\S]*?<w:body>)/)?.[1];
const section = original.match(/(<w:sectPr[\s\S]*?<\/w:sectPr>)[\s\S]*?<\/w:body>/)?.[1];
if (!rootOpen || !section) throw new Error("Estrutura do DOCX base não reconhecida.");

const table = [
  '<w:tbl><w:tblPr><w:tblW w:w="8706" w:type="dxa"/><w:tblLayout w:type="fixed"/><w:tblBorders><w:top w:val="single" w:sz="6" w:color="B8C0CC"/><w:left w:val="single" w:sz="6" w:color="B8C0CC"/><w:bottom w:val="single" w:sz="6" w:color="B8C0CC"/><w:right w:val="single" w:sz="6" w:color="B8C0CC"/><w:insideH w:val="single" w:sz="4" w:color="D7DCE3"/><w:insideV w:val="single" w:sz="4" w:color="D7DCE3"/></w:tblBorders></w:tblPr><w:tblGrid><w:gridCol w:w="6500"/><w:gridCol w:w="2206"/></w:tblGrid>',
  `<w:tr>${cell("Descrição", 6500, true)}${cell("Valor", 2206, true)}</w:tr>`,
  `<w:tr>${cell("{{#receipt.items}}{{description}}", 6500)}${cell("{{value}}{{/receipt.items}}", 2206)}</w:tr>`,
  "</w:tbl>",
].join("");

const body = [
  paragraph("RECIBO", { bold: true, size: 32, align: "center", after: 80 }),
  paragraph("Documento {{receipt.number}}", { bold: true, size: 20, align: "center", after: 320 }),
  paragraph("{{receipt.direction}} {{receipt.recipient.snapshot.name}}, documento {{receipt.recipient.snapshot.document}}, os valores discriminados abaixo.", { after: 220 }),
  paragraph("Emitente: {{receipt.issuer.snapshot.name}} · Documento: {{receipt.issuer.snapshot.document}}", { bold: true, after: 260 }),
  table,
  paragraph("Total: {{receipt.totalWithWords}}", { bold: true, size: 24, align: "right", before: 180, after: 240 }),
  paragraph("Forma de pagamento: {{receipt.payment.method}}", { bold: true }),
  paragraph("{{#if receipt.payment.method == 'pix'}}Chave Pix: {{receipt.payment.pixKey}}{{/if}}"),
  paragraph("{{#if receipt.payment.method == 'transfer'}}Banco: {{receipt.payment.bank}} · Agência: {{receipt.payment.agency}} · Conta: {{receipt.payment.account}}{{/if}}"),
  paragraph("Para maior clareza, firmamos o presente recibo, dando quitação exclusivamente quanto aos valores e itens acima descritos.", { before: 220, after: 260 }),
  paragraph("{{receipt.city}}, {{receipt.issueDate}}.", { align: "right", after: 520 }),
  paragraph("____________________________________________", { align: "center", after: 40 }),
  paragraph("{{receipt.issuer.snapshot.name}}", { bold: true, align: "center", after: 0 }),
  paragraph("EMITENTE", { size: 18, align: "center", after: 0 }),
].join("");

zip.file(documentPath, `${rootOpen}${body}${section}</w:body></w:document>`);
const footerPath = "word/footer1.xml";
const footer = zip.file(footerPath)?.asText();
if (!footer?.includes("Vale-Transporte — CT Sorvetes Ltda")) {
  throw new Error("Rodapé do DOCX base não reconhecido.");
}
zip.file(footerPath, footer.replace("Vale-Transporte — CT Sorvetes Ltda", "Recibo — Coala One"));
const output = zip.generate({ type: "nodebuffer", compression: "DEFLATE" }) as Buffer;
await mkdir(path.dirname(OUTPUT), { recursive: true });
await writeFile(OUTPUT, output);
process.stdout.write(`${JSON.stringify({
  output: OUTPUT,
  contentHash: createHash("sha256").update(output).digest("hex"),
}, null, 2)}\n`);
