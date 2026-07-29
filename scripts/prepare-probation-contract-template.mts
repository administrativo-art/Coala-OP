import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  extractDocxVariables,
  replaceDocxTextWithVariable,
} from "../src/features/hr/documents/docx-generator";

const SOURCE = path.resolve(
  "docs/modelos-documentos/admissionais/01-contrato-experiencia-v1.docx",
);
const OUTPUT = path.resolve(
  "docs/modelos-documentos/admissionais/01-contrato-experiencia-v2.docx",
);
const EXPECTED_SOURCE_HASH =
  "935fbe335a50349a389a61a537c9f20570da5ac26d8a3e437506b5d91734bc12";

const replacements = [
  {
    search: "CT SORVETES LTDA",
    key: "integration.employer_name",
    expected: 2,
  },
  {
    search: "CT Sorvetes Ltda",
    key: "integration.employer_name",
    expected: 1,
  },
  {
    search: "14.276.603/0001-25",
    key: "integration.employer_cnpj",
    expected: 1,
  },
  {
    search:
      "Edifício Adriana, Av. Cel. Colares Moreira, n˚ 01, quadra 121, 1º andar, bairro Renascença, São Luís/MA, CEP 65075-440",
    key: "integration.employer_address",
    expected: 1,
  },
  {
    search: "{{custom_field_15914645}}",
    key: "employee.name",
    expected: 2,
  },
  {
    search: "{{custom_field_15874630}}",
    key: "employee.ctps_number",
    expected: 1,
  },
  {
    search: "{{custom_field_15874638}}",
    key: "employee.ctps_series",
    expected: 1,
  },
  {
    search: "ATENDENTE",
    key: "integration.job_function",
    expected: 1,
  },
  {
    search: "{{custom_field_15874657}}",
    key: "contract_monthly_salary",
    expected: 1,
  },
  {
    search: "{{contract_start}}",
    key: "contract_start_long",
    expected: 1,
  },
  {
    search: "{{custom_field_15914630}}",
    key: "contract_first_end_long",
    expected: 1,
  },
  {
    search: "{{custom_field_15914631}}",
    key: "contract_final_end_long",
    expected: 1,
  },
] as const;

function sha256(buffer: Buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

let buffer = await readFile(SOURCE);
const sourceHash = sha256(buffer);
if (sourceHash !== EXPECTED_SOURCE_HASH) {
  throw new Error(
    `O contrato original mudou. Esperado ${EXPECTED_SOURCE_HASH}, recebido ${sourceHash}.`,
  );
}

for (const replacement of replacements) {
  const result = replaceDocxTextWithVariable(
    buffer,
    replacement.search,
    replacement.key,
  );
  if (result.replacements !== replacement.expected) {
    throw new Error(
      `Substituição inesperada de ${replacement.search}: ` +
        `${result.replacements}, esperado ${replacement.expected}.`,
    );
  }
  buffer = result.buffer;
}

const variables = extractDocxVariables(buffer);
const expectedVariables = Array.from(
  new Set(replacements.map((replacement) => replacement.key)),
).sort();
if (JSON.stringify(variables) !== JSON.stringify(expectedVariables)) {
  throw new Error(
    `Variáveis inesperadas no modelo: ${JSON.stringify(variables)}.`,
  );
}

await writeFile(OUTPUT, buffer);
process.stdout.write(
  `${JSON.stringify({
    source: SOURCE,
    sourceHash,
    output: OUTPUT,
    outputHash: sha256(buffer),
    variables,
  }, null, 2)}\n`,
);
