import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  extractDocxVariables,
  removeDocxParagraphsByExactText,
  replaceDocxText,
  replaceDocxTextWithVariable,
} from "../src/features/hr/documents/docx-generator";

const SOURCE = path.resolve("docs/modelos-documentos/admissionais/09-termo-encerramento-v1.docx");
const OUTPUT = path.resolve("docs/modelos-documentos/admissionais/09-termo-encerramento-v2.docx");
const EXPECTED_SOURCE_HASH = "e63f92bc5a8769952f0bb3cc713466bb55463a065bc5f6d397488d276d03365b";

const staticList = [
  "2. Acordo Individual de Banco de Horas;",
  "3. Termo de Ciência sobre o Tratamento de Dados Pessoais na Relação de Trabalho – LGPD;",
  "4. Termo de Consentimento para Uso de Imagem e Voz, cuja eficácia fica condicionada à opção destacada abaixo;",
  "5. Regulamento de Metas e Prêmios por Desempenho;",
  "6. Solicitação de Vale-Transporte, conforme opção registrada no próprio documento;",
  "7. Termo de Confidencialidade e Sigilo;",
  "8. Termo de Ciência – Registro Eletrônico de Ponto.",
  "CONSENTIMENTO FACULTATIVO E DESTACADO – USO DE IMAGEM E VOZ",
  "[ {{CAMPO_OPCAO_IMAGEM_VOZ}} ] AUTORIZO, de forma livre, informada e inequívoca, o uso da minha imagem e da minha voz nas condições estabelecidas no documento 4 deste instrumento, nos termos do artigo 7º, inciso I, e do §4º do artigo 8º da Lei n˚ 13.709/2018.",
  "A presente opção é facultativa. A não marcação equivale à não autorização, hipótese em que o documento 4 não produzirá quaisquer efeitos, sem prejuízo à admissão, à manutenção do vínculo de emprego ou aos direitos do(a) EMPREGADO(A). A autorização, se concedida, poderá ser revogada a qualquer tempo, na forma da cláusula 6ª do documento 4.",
] as const;

function hash(buffer: Buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

let buffer = await readFile(SOURCE);
if (hash(buffer) !== EXPECTED_SOURCE_HASH) throw new Error("O termo de encerramento original mudou.");

let result = replaceDocxText(
  buffer,
  "Eu, {{custom_field_15914645}}, declaro ter recebido, lido e compreendido, nesta data e em um único instrumento, os seguintes documentos, com cujo conteúdo manifesto integral concordância, ressalvado o item destacado abaixo, de caráter facultativo:",
  "Eu, {{custom_field_15914645}}, declaro ter recebido, lido e compreendido, nesta data e em um único instrumento, os documentos relacionados abaixo, com cujo conteúdo manifesto integral concordância:",
);
if (result.replacements !== 1) throw new Error("Introdução inesperada no termo de encerramento.");
buffer = result.buffer;

result = replaceDocxText(
  buffer,
  "1. Contrato de Trabalho a Título de Experiência;",
  "{{bundle_components_summary}}",
);
if (result.replacements !== 1) throw new Error("Lista inicial inesperada no termo de encerramento.");
buffer = result.buffer;

const removed = removeDocxParagraphsByExactText(buffer, staticList);
for (const text of staticList) {
  if (removed.removed[text] !== 1) {
    throw new Error(`Parágrafo estático não removido uma única vez: ${text}`);
  }
}
buffer = removed.buffer;

for (const replacement of [
  { search: "{{custom_field_15914645}}", key: "employee.name", expected: 3 },
  { search: "{{contract_start}}", key: "contract_start_long", expected: 1 },
  { search: "CT SORVETES LTDA", key: "integration.employer_name", expected: 2 },
] as const) {
  const applied = replaceDocxTextWithVariable(buffer, replacement.search, replacement.key);
  if (applied.replacements !== replacement.expected) {
    throw new Error(`Substituição inesperada de ${replacement.search}.`);
  }
  buffer = applied.buffer;
}

const duplicateIdentification = removeDocxParagraphsByExactText(
  buffer,
  [
    "{{employee.name}}",
    "EMPREGADO(A) / TITULAR",
    "{{integration.employer_name}}",
    "EMPREGADORA / CONTROLADORA",
  ],
  { maximumPerText: 1 },
);
for (const text of [
  "{{employee.name}}",
  "EMPREGADO(A) / TITULAR",
  "{{integration.employer_name}}",
  "EMPREGADORA / CONTROLADORA",
]) {
  if (duplicateIdentification.removed[text] !== 1) {
    throw new Error(`Identificação duplicada não removida: ${text}`);
  }
}
buffer = duplicateIdentification.buffer;

await writeFile(OUTPUT, buffer);
process.stdout.write(`${JSON.stringify({
  source: SOURCE,
  sourceHash: EXPECTED_SOURCE_HASH,
  output: OUTPUT,
  outputHash: hash(buffer),
  variables: extractDocxVariables(buffer),
}, null, 2)}\n`);
