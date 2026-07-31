import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { generateDocx } from "../src/features/hr/documents/docx-generator";
import {
  RECEIPT_FORM_SCHEMA,
  resolveDocumentFormSchema,
} from "../src/features/hr/documents/document-form-schema";

const source = await readFile(path.resolve("docs/modelos-documentos/recibos/recibo-v3.docx"));
const resolved = resolveDocumentFormSchema(RECEIPT_FORM_SCHEMA, {
  receipt: {
    number: "COAL-REC-2026-000112",
    direction: "Recebemos",
    issuer: {
      partyType: "company",
      ref: "coala",
      snapshot: {
        name: "Coala Shakes",
        document: "14.276.603/0001-25",
        email: "administrativo@coalashakes.com.br",
      },
    },
    recipient: {
      partyType: "external_company",
      ref: null,
      snapshot: {
        name: "Cliente de Exemplo Ltda.",
        document: "12.345.678/0001-90",
        email: "financeiro@cliente-exemplo.com.br",
      },
    },
    items: [
      {
        name: "Uber",
        description: "Pagamento referente à viagem do dia 12/07 — trajeto escritório → aeroporto.",
        value: 48.9,
      },
      {
        name: "Almoço",
        description: "Refeição de equipe durante reunião de alinhamento comercial.",
        value: 132.5,
      },
      {
        name: "Material de escritório",
        description: "Compra de resma de papel A4 e cartuchos de tinta para impressão.",
        value: 89,
      },
    ],
    payment: {
      method: "pix",
      pixKey: "financeiro@exemplo.com",
    },
    city: "São Luís",
    state: "MA",
    issueDate: "30 de julho de 2026",
  },
});
if (resolved.missing.length) throw new Error(resolved.missing.join(", "));
const output = generateDocx(source, resolved.values);
await writeFile(path.resolve("output/docx/recibo-v3-schema-piloto.docx"), output);
