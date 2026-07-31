import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import PizZip from "pizzip";

import { applyCtDocumentStandard } from "../src/features/hr/documents/ct-document-standard.server";

const SOURCE = path.resolve(
  "docs/modelos-documentos/recibos/recibo-v1.docx",
);
const OUTPUT = path.resolve(
  "docs/modelos-documentos/recibos/recibo-v3.docx",
);
const PAGE_WIDTH = 8504;

function escapeXml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function run(text: string, characterStyle?: string) {
  const style = characterStyle
    ? `<w:rPr><w:rStyle w:val="${characterStyle}"/></w:rPr>`
    : "";
  return `<w:r>${style}<w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r>`;
}

function paragraph(
  styleId: string,
  content: string | Array<{ text: string; characterStyle?: string }>,
) {
  const runs = typeof content === "string"
    ? run(content)
    : content.map((item) => run(item.text, item.characterStyle)).join("");
  return `<w:p><w:pPr><w:pStyle w:val="${styleId}"/></w:pPr>${runs}</w:p>`;
}

function cell(params: {
  width: number;
  content: string;
  fill?: string;
  border?: string;
  verticalAlign?: "top" | "center";
  margin?: number;
}) {
  const border = params.border ?? "DCE2EA";
  const margin = params.margin ?? 120;
  return [
    "<w:tc>",
    "<w:tcPr>",
    `<w:tcW w:w="${params.width}" w:type="dxa"/>`,
    params.fill ? `<w:shd w:val="clear" w:color="auto" w:fill="${params.fill}"/>` : "",
    `<w:tcBorders><w:top w:val="single" w:sz="5" w:color="${border}"/><w:left w:val="single" w:sz="5" w:color="${border}"/><w:bottom w:val="single" w:sz="5" w:color="${border}"/><w:right w:val="single" w:sz="5" w:color="${border}"/></w:tcBorders>`,
    `<w:tcMar><w:top w:w="${margin}" w:type="dxa"/><w:left w:w="${margin}" w:type="dxa"/><w:bottom w:w="${margin}" w:type="dxa"/><w:right w:w="${margin}" w:type="dxa"/></w:tcMar>`,
    `<w:vAlign w:val="${params.verticalAlign ?? "center"}"/>`,
    "</w:tcPr>",
    params.content,
    "</w:tc>",
  ].join("");
}

function table(params: {
  columns: number[];
  rows: string[];
  after?: number;
}) {
  return [
    "<w:tbl>",
    "<w:tblPr>",
    `<w:tblW w:w="${params.columns.reduce((sum, width) => sum + width, 0)}" w:type="dxa"/>`,
    '<w:tblLayout w:type="fixed"/>',
    `<w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="0" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="0" w:type="dxa"/></w:tblCellMar>`,
    "</w:tblPr>",
    `<w:tblGrid>${params.columns.map((width) => `<w:gridCol w:w="${width}"/>`).join("")}</w:tblGrid>`,
    params.rows.join(""),
    "</w:tbl>",
    params.after
      ? `<w:p><w:pPr><w:spacing w:before="0" w:after="${params.after}"/></w:pPr></w:p>`
      : "",
  ].join("");
}

function row(cells: string[], options?: { header?: boolean; repeatHeader?: boolean }) {
  return [
    "<w:tr>",
    options?.repeatHeader ? '<w:trPr><w:tblHeader/></w:trPr>' : "",
    ...cells,
    "</w:tr>",
  ].join("");
}

function labelValue(label: string, value: string) {
  return [
    paragraph("CTReciboRotulo", label),
    paragraph("CTReciboValor", value),
  ].join("");
}

const source = applyCtDocumentStandard(await readFile(SOURCE));
const zip = new PizZip(source);
const documentPath = "word/document.xml";
const original = zip.file(documentPath)?.asText();
if (!original) throw new Error("DOCX base sem document.xml.");
const rootOpen = original.match(/^([\s\S]*?<w:body>)/)?.[1];
const section = original.match(/(<w:sectPr[\s\S]*?<\/w:sectPr>)[\s\S]*?<\/w:body>/)?.[1];
if (!rootOpen || !section) throw new Error("Estrutura do DOCX base não reconhecida.");

const identification = table({
  columns: [PAGE_WIDTH / 2, PAGE_WIDTH / 2],
  rows: [
    row([
      cell({
        width: PAGE_WIDTH / 2,
        content: labelValue("PAGADOR / EMITENTE", "{{receipt.issuer.snapshot.name}}"),
      }),
      cell({
        width: PAGE_WIDTH / 2,
        content: labelValue("CPF/CNPJ DO PAGADOR", "{{receipt.issuer.snapshot.document}}"),
      }),
    ]),
    row([
      cell({
        width: PAGE_WIDTH / 2,
        content: labelValue("RECEBEDOR", "{{receipt.recipient.snapshot.name}}"),
      }),
      cell({
        width: PAGE_WIDTH / 2,
        content: labelValue("CPF/CNPJ DO RECEBEDOR", "{{receipt.recipient.snapshot.document}}"),
      }),
    ]),
  ],
  after: 100,
});

const items = table({
  columns: [1800, 5000, 1704],
  rows: [
    row([
      cell({
        width: 1800,
        fill: "F3F6FA",
        content: paragraph("CTReciboRotulo", "ITEM"),
      }),
      cell({
        width: 5000,
        fill: "F3F6FA",
        content: paragraph("CTReciboRotulo", "DESCRIÇÃO"),
      }),
      cell({
        width: 1704,
        fill: "F3F6FA",
        content: paragraph("CTReciboRotulo", "VALOR"),
      }),
    ], { repeatHeader: true }),
    row([
      cell({
        width: 1800,
        content: paragraph("CTReciboValor", "{{#receipt.items}}{{name}}"),
        verticalAlign: "top",
      }),
      cell({
        width: 5000,
        content: paragraph("CTReciboTabela", "{{description}}"),
        verticalAlign: "top",
      }),
      cell({
        width: 1704,
        content: paragraph("CTReciboValorDireita", "{{value}}{{/receipt.items}}"),
        verticalAlign: "top",
      }),
    ]),
  ],
  after: 100,
});

const total = table({
  columns: [5100, 3404],
  rows: [
    row([
      cell({
        width: 5100,
        border: "FFFFFF",
        content: paragraph("CTReciboTabela", ""),
      }),
      cell({
        width: 3404,
        border: "F5A8C9",
        fill: "FDE8F1",
        margin: 190,
        content: [
          paragraph("CTReciboTotalRotulo", "TOTAL DO RECIBO"),
          paragraph("CTReciboTotalValor", "{{receipt.total}}"),
        ].join(""),
      }),
    ]),
  ],
  after: 80,
});

const declaration = table({
  columns: [PAGE_WIDTH],
  rows: [
    row([
      cell({
        width: PAGE_WIDTH,
        fill: "F6F7F9",
        border: "F6F7F9",
        margin: 150,
        content: paragraph("CTReciboDeclaracao", [
          { text: "Declaro que o valor total de " },
          {
            text: "{{receipt.total}}",
            characterStyle: "CTReciboDestaque",
          },
          {
            text: " corresponde integralmente aos itens discriminados neste recibo, dando plena e geral quitação exclusivamente quanto a esses valores.",
          },
        ]),
      }),
    ]),
  ],
  after: 0,
});

const signatures = table({
  columns: [4052, 400, 4052],
  rows: [
    row([
      cell({
        width: 4052,
        border: "FFFFFF",
        content: [
          paragraph("CTAssinaturaLinha", "{{receipt.issuer.snapshot.name}}"),
          paragraph("CTAssinatura", "{{receipt.issuer.snapshot.document}}"),
          paragraph("CTAssinatura", "EMITENTE"),
        ].join(""),
      }),
      cell({
        width: 400,
        border: "FFFFFF",
        content: paragraph("CTAssinatura", ""),
      }),
      cell({
        width: 4052,
        border: "FFFFFF",
        content: [
          paragraph("CTAssinaturaLinha", "{{receipt.recipient.snapshot.name}}"),
          paragraph("CTAssinatura", "{{receipt.recipient.snapshot.document}}"),
          paragraph("CTAssinatura", "RECEBEDOR"),
        ].join(""),
      }),
    ]),
  ],
});

const body = [
  paragraph("CTReciboNumero", "Nº {{receipt.number}}"),
  paragraph("CTReciboEtiqueta", "RECIBO DE PAGAMENTO"),
  paragraph("CTReciboTitulo", "RECIBO"),
  paragraph(
    "CTReciboSubtitulo",
    "Comprovante referente aos itens discriminados abaixo.",
  ),
  paragraph("CTReciboIntroducao", [
    { text: "{{receipt.direction}} a importância de " },
    {
      text: "{{receipt.totalWithWords}}",
      characterStyle: "CTReciboDestaque",
    },
    { text: "." },
  ]),
  paragraph("CTReciboSecao", "IDENTIFICAÇÃO"),
  identification,
  paragraph("CTReciboSecao", "ITENS"),
  items,
  total,
  paragraph("CTReciboSubtitulo", [
    { text: "Pagamento: " },
    { text: "{{receipt.payment.methodLabel}}", characterStyle: "CTReciboDestaque" },
    { text: "{{#if receipt.payment.method == 'pix'}} · Chave Pix: {{receipt.payment.pixKey}}{{/if}}" },
    { text: "{{#if receipt.payment.method == 'transfer'}} · Banco: {{receipt.payment.bank}} · Agência: {{receipt.payment.agency}} · Conta: {{receipt.payment.account}}{{/if}}" },
  ]),
  paragraph("CTReciboSecao", "DECLARAÇÃO"),
  declaration,
  paragraph("CTReciboData", "{{receipt.city}}/{{receipt.state}}, {{receipt.issueDate}}."),
  signatures,
].join("");

zip.file(
  documentPath,
  `${rootOpen}${body}${section}</w:body></w:document>`,
);
const corePath = "docProps/core.xml";
const core = zip.file(corePath)?.asText();
if (core) {
  const replaceCoreValue = (xml: string, tag: string, value: string) => {
    const pattern = new RegExp(`(<${tag}(?:\\s[^>]*)?>)[\\s\\S]*?(<\\/${tag}>)`);
    return pattern.test(xml)
      ? xml.replace(pattern, `$1${escapeXml(value)}$2`)
      : xml;
  };
  zip.file(
    corePath,
    replaceCoreValue(
      replaceCoreValue(
        replaceCoreValue(core, "dc:title", "Recibo de pagamento"),
        "dc:creator",
        "Coala One",
      ),
      "cp:lastModifiedBy",
      "Coala One",
    ),
  );
}
const deterministicDate = new Date("2026-07-30T00:00:00.000Z");
Object.values(zip.files).forEach((file) => {
  file.date = deterministicDate;
});
const output = Buffer.from(
  zip.generate({ type: "nodebuffer", compression: "DEFLATE" }),
);
await mkdir(path.dirname(OUTPUT), { recursive: true });
await writeFile(OUTPUT, output);
process.stdout.write(`${JSON.stringify({
  output: OUTPUT,
  contentHash: createHash("sha256").update(output).digest("hex"),
}, null, 2)}\n`);
