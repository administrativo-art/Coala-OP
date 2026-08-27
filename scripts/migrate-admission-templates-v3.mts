import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  applyCtDocumentStandard,
  migrateCtDocumentParagraphStyles,
} from "../src/features/hr/documents/ct-document-standard.server";
import { validateCtDocumentStandard } from "../src/features/hr/documents/docx-template-validation";

type Plan = {
  source: string;
  output: string;
  replacements?: Array<{ search: string; replacement: string }>;
};

const BASE = "docs/modelos-documentos/admissionais";
const plans: Plan[] = [
  {
    source: `${BASE}/02-banco-horas-v2.docx`,
    output: `${BASE}/02-banco-horas-v3.docx`,
    replacements: [
      {
        search: "na forma da cláusula 7ª",
        replacement: "na forma prevista neste Acordo para o saldo não compensado",
      },
      {
        search: "no prazo estabelecido na cláusula 4ª",
        replacement: "no prazo máximo de compensação previsto neste Acordo",
      },
      {
        search: "na forma do Parágrafo Único da cláusula 5ª",
        replacement:
          "nas hipóteses de saldo negativo atribuíveis ao empregado previstas neste Acordo",
      },
    ],
  },
  {
    source: `${BASE}/03-termo-lgpd-v2.docx`,
    output: `${BASE}/03-termo-lgpd-v3.docx`,
  },
  {
    source: `${BASE}/04-imagem-voz-v2.docx`,
    output: `${BASE}/04-imagem-voz-v3.docx`,
    replacements: [
      {
        search: "o disposto na cláusula 6ª",
        replacement: "as regras de revogação deste Termo",
      },
      {
        search:
          "da cláusula 13 do Termo de Ciência sobre o Tratamento de Dados Pessoais",
        replacement:
          "da seção sobre consentimento do Termo de Ciência sobre o Tratamento de Dados Pessoais",
      },
    ],
  },
  {
    source: `${BASE}/05-metas-premios-v2.docx`,
    output: `${BASE}/05-metas-premios-v3.docx`,
    replacements: [
      {
        search: "na comunicação de que trata a cláusula 2ª",
        replacement: "na comunicação prévia prevista neste Regulamento",
      },
      {
        search: "na forma da cláusula 3ª",
        replacement: "pelas regras de alteração deste Regulamento",
      },
    ],
  },
  {
    source: `${BASE}/06-vale-transporte-solicitacao-v2.docx`,
    output: `${BASE}/06-vale-transporte-solicitacao-v3.docx`,
  },
  {
    source: `${BASE}/06-vale-transporte-renuncia-v2.docx`,
    output: `${BASE}/06-vale-transporte-renuncia-v3.docx`,
  },
  {
    source: `${BASE}/07-confidencialidade-v2.docx`,
    output: `${BASE}/07-confidencialidade-v3.docx`,
  },
  {
    source: `${BASE}/09-termo-encerramento-v2.docx`,
    output: `${BASE}/09-termo-encerramento-v3.docx`,
    replacements: [
      {
        search: "com os elementos de auditoria previstos na seção 10 do documento 3",
        replacement:
          "com os elementos de auditoria e integridade mantidos pelo sistema",
      },
    ],
  },
];

const results = [];
for (const plan of plans) {
  const source = await readFile(path.resolve(plan.source));
  const output = migrateCtDocumentParagraphStyles(source, {
    textReplacements: plan.replacements,
  });
  const validation = validateCtDocumentStandard(output);
  if (!validation.valid) {
    throw new Error(
      `${plan.output}: ${validation.issues.map((issue) => issue.message).join(" ")}`,
    );
  }
  await writeFile(path.resolve(plan.output), output);
  results.push({
    source: plan.source,
    sourceHash: createHash("sha256").update(source).digest("hex"),
    output: plan.output,
    outputHash: createHash("sha256").update(output).digest("hex"),
    validation,
  });
}

void applyCtDocumentStandard;
process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
