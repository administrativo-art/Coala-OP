import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import PizZip from "pizzip";

import { extractDocxVariables } from "../src/features/hr/documents/docx-generator";

/**
 * Revisões só de texto em modelos admissionais: cada troca ocorre dentro de um
 * único trecho do DOCX, sem mexer em estilos, campos ou demais partes do ZIP.
 * Hashes fixos de entrada e saída tornam a geração reproduzível.
 */
type Revision = {
  source: string;
  output: string;
  sourceHash: string;
  outputHash: string;
  replacements: Array<[from: string, to: string]>;
};

const BASE = "docs/modelos-documentos/admissionais";

const REVISIONS: Revision[] = [
  {
    // Alinha os nomes citados no contrato aos títulos dos documentos do pacote.
    source: `${BASE}/01-contrato-experiencia-v4.docx`,
    output: `${BASE}/01-contrato-experiencia-v5.docx`,
    sourceHash: "02fe5039827ecc9fdb233d7ef35107da7f0c7988d7e32e16ff988dbd3aa07607",
    outputHash: "ad01e3984787d49a212622d4480b5abb0a551d822f284e364fab3220229970df",
    replacements: [
      [
        "na forma do Termo de Ciência sobre o Tratamento de Dados Pessoais na Relação de Trabalho, que integra",
        "na forma do Termo de Ciência sobre o Tratamento de Dados Pessoais, que integra",
      ],
      [
        "observarão os requisitos do Regulamento de Bonificação vigente para o período.",
        "observarão os requisitos do Regulamento de Metas e Prêmios por Desempenho vigente para o período.",
      ],
    ],
  },
  {
    // Torna explícitos a apuração pelo sistema e o pedido de revisão (termo LGPD v6, seção 3-C).
    source: `${BASE}/05-metas-premios-v2.docx`,
    output: `${BASE}/05-metas-premios-v4.docx`,
    sourceHash: "a5662e341eb06b40f01a6db049db18411b94d2bd1d0f74595909eb5ff6624745",
    outputHash: "bb6c2c80561cbd2aa76d5dc62ffb29945b0bdf2751b561b5fcfcb7588a09857f",
    replacements: [
      [
        "será pago juntamente com a folha de pagamento subsequente ao encerramento da apuração.",
        "será pago juntamente com a folha de pagamento subsequente ao encerramento da apuração. A apuração será feita pelos sistemas internos da EMPREGADORA a partir dos registros de vendas, das escalas e da distribuição definida para o período, e o(a) EMPREGADO(A) poderá solicitar ao Departamento Pessoal a demonstração e a revisão do resultado apurado.",
      ],
    ],
  },
];

function sha256(buffer: Buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function escapeXml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function revise(input: Buffer, replacements: Revision["replacements"]) {
  const zip = new PizZip(input);
  const file = zip.file("word/document.xml");
  if (!file) throw new Error("O modelo não contém word/document.xml.");
  const documentDate = file.date;
  let documentXml = file.asText();
  for (const [from, to] of replacements) {
    const occurrences = documentXml.split(escapeXml(from)).length - 1;
    if (occurrences !== 1) throw new Error(`Trecho encontrado ${occurrences} vez(es); esperado: 1. ${from}`);
    documentXml = documentXml.replace(escapeXml(from), escapeXml(to));
  }
  // Preserva a data da entrada para que execuções idênticas produzam o mesmo
  // ZIP e, portanto, o mesmo hash imutável catalogado.
  zip.file("word/document.xml", documentXml, { date: documentDate });
  return Buffer.from(zip.generate({ type: "nodebuffer", compression: "DEFLATE" }));
}

const results = [];
for (const revision of REVISIONS) {
  const source = await readFile(path.resolve(revision.source));
  const sourceHash = sha256(source);
  if (sourceHash !== revision.sourceHash) {
    throw new Error(`${revision.source} mudou. Esperado ${revision.sourceHash}, recebido ${sourceHash}.`);
  }
  const output = revise(source, revision.replacements);
  const outputHash = sha256(output);
  if (outputHash !== revision.outputHash) {
    throw new Error(`${revision.output} divergiu. Esperado ${revision.outputHash}, recebido ${outputHash}.`);
  }
  const variables = extractDocxVariables(output);
  if (JSON.stringify(variables) !== JSON.stringify(extractDocxVariables(source))) {
    throw new Error(`${revision.output}: variáveis diferentes da origem: ${JSON.stringify(variables)}.`);
  }
  await writeFile(path.resolve(revision.output), output);
  results.push({ source: revision.source, sourceHash, output: revision.output, outputHash, variables });
}
process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
