import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { generateDocx } from "../src/features/hr/documents/docx-generator";
import {
  RECEIPT_FORM_SCHEMA,
  resolveDocumentFormSchema,
} from "../src/features/hr/documents/document-form-schema";

const source = await readFile(path.resolve("docs/modelos-documentos/recibos/recibo-v1.docx"));
const resolved = resolveDocumentFormSchema(RECEIPT_FORM_SCHEMA, {
  receipt: {
    number: "COAL-REC-2026-000112",
    direction: "Recebemos de",
    issuer: {
      partyType: "company",
      ref: "coala",
      snapshot: { name: "Coala Shakes", document: "14.276.603/0001-25" },
    },
    recipient: {
      partyType: "external_company",
      ref: null,
      snapshot: { name: "Cliente de Exemplo Ltda.", document: "12.345.678/0001-90" },
    },
    items: [
      { description: "Fornecimento de produtos", value: 125.5 },
      { description: "Serviço complementar", value: 80 },
      { description: "Ajuste contratual", value: 15.25 },
    ],
    payment: {
      method: "pix",
      pixKey: "financeiro@exemplo.com",
    },
    city: "São Luís/MA",
    issueDate: "28 de julho de 2026",
  },
});
if (resolved.missing.length) throw new Error(resolved.missing.join(", "));
const output = generateDocx(source, resolved.values);
await writeFile(path.resolve("output/docx/recibo-schema-piloto.docx"), output);
