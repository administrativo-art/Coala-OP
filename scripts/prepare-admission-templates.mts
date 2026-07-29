import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  extractDocxVariables,
  replaceDocxTextWithVariable,
} from "../src/features/hr/documents/docx-generator";

type Replacement = {
  search: string;
  key: string;
  expected: number;
};

type TemplatePlan = {
  source: string;
  output: string;
  sourceHash: string;
  replacements: Replacement[];
};

const BASE = "docs/modelos-documentos/admissionais";
const COMPANY: Replacement[] = [
  { search: "CT SORVETES LTDA", key: "integration.employer_name", expected: 2 },
  { search: "14.276.603/0001-25", key: "integration.employer_cnpj", expected: 1 },
  {
    search: "Edifício Adriana, Av. Cel. Colares Moreira, n˚ 01, quadra 121, 1º andar, bairro Renascença, São Luís/MA, CEP 65075-440",
    key: "integration.employer_address",
    expected: 1,
  },
];
const EMPLOYEE_NAME: Replacement = {
  search: "{{custom_field_15914645}}",
  key: "employee.name",
  expected: 2,
};
const EMPLOYEE_WORK_CARD: Replacement[] = [
  { search: "{{custom_field_15874630}}", key: "employee.ctps_number", expected: 1 },
  { search: "{{custom_field_15874638}}", key: "employee.ctps_series", expected: 1 },
];

const plans: TemplatePlan[] = [
  {
    source: `${BASE}/03-termo-lgpd-v1.docx`,
    output: `${BASE}/03-termo-lgpd-v2.docx`,
    sourceHash: "9a2d03b2c6303af1801dbb32511ee865496216ad5994e3e81ba8ee1416a89587",
    replacements: [
      ...COMPANY,
      EMPLOYEE_NAME,
      { search: "{{CAMPO_CPF_DO_TITULAR}}", key: "employee.cpf", expected: 1 },
      { search: "{{CAMPO_DATA_PUBLICACAO_TERMO}}", key: "term_effective_date", expected: 1 },
    ],
  },
  {
    source: `${BASE}/04-imagem-voz-v1.docx`,
    output: `${BASE}/04-imagem-voz-v2.docx`,
    sourceHash: "8c3a5883b1d413b310be6095a05a48d88b0e824c0124390d2d033afa5ee6fcce",
    replacements: [
      ...COMPANY,
      EMPLOYEE_NAME,
      { search: "{{CAMPO_CPF_DO_TITULAR}}", key: "employee.cpf", expected: 1 },
    ],
  },
  {
    source: `${BASE}/05-metas-premios-v1.docx`,
    output: `${BASE}/05-metas-premios-v2.docx`,
    sourceHash: "ef6ebf77cdf7cf079fa01395dd7c826190e23a73be277ffeccf5d5fb79c078b0",
    replacements: [...COMPANY, EMPLOYEE_NAME, ...EMPLOYEE_WORK_CARD],
  },
  {
    source: `${BASE}/06-vale-transporte-v1.docx`,
    output: `${BASE}/06-vale-transporte-solicitacao-v2.docx`,
    sourceHash: "da7c9f8b849a6a42e989ffc3e2ec71bb945670aaa114cc43fcb3188568373395",
    replacements: [
      { ...EMPLOYEE_NAME },
      ...EMPLOYEE_WORK_CARD,
      { search: "{{custom_field_15874601}}", key: "transport_voucher_decision_text", expected: 1 },
      { search: "{{CAMPO_ENDERECO_RESIDENCIAL}}", key: "employee.address", expected: 1 },
      { search: "CT SORVETES LTDA", key: "integration.employer_name", expected: 1 },
    ],
  },
  {
    source: `${BASE}/06-vale-transporte-v1.docx`,
    output: `${BASE}/06-vale-transporte-renuncia-v2.docx`,
    sourceHash: "da7c9f8b849a6a42e989ffc3e2ec71bb945670aaa114cc43fcb3188568373395",
    replacements: [
      { ...EMPLOYEE_NAME },
      ...EMPLOYEE_WORK_CARD,
      { search: "{{custom_field_15874601}}", key: "transport_voucher_decision_text", expected: 1 },
      { search: "{{CAMPO_ENDERECO_RESIDENCIAL}}", key: "employee.address", expected: 1 },
      { search: "CT SORVETES LTDA", key: "integration.employer_name", expected: 1 },
      { search: "SOLICITAÇÃO DE VALE-TRANSPORTE", key: "transport_voucher_document_title", expected: 1 },
    ],
  },
  {
    source: `${BASE}/07-confidencialidade-v1.docx`,
    output: `${BASE}/07-confidencialidade-v2.docx`,
    sourceHash: "01f6f0536f72869fd4decd6ebad73a8a214341db32bd38a4184c927a5e6189fa",
    replacements: [...COMPANY, EMPLOYEE_NAME, ...EMPLOYEE_WORK_CARD],
  },
  {
    source: `${BASE}/08-ponto-eletronico-v1.docx`,
    output: `${BASE}/08-ponto-eletronico-v2.docx`,
    sourceHash: "cf3b4baecba1e12932cb1513e09b78a0448cbc6beaf5021e9d8f430b2e30f1e2",
    replacements: [...COMPANY, EMPLOYEE_NAME, ...EMPLOYEE_WORK_CARD],
  },
];

function sha256(buffer: Buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

const result = [];
for (const plan of plans) {
  let buffer = await readFile(path.resolve(plan.source));
  const sourceHash = sha256(buffer);
  if (sourceHash !== plan.sourceHash) {
    throw new Error(`Fonte alterada: ${plan.source}. Esperado ${plan.sourceHash}, recebido ${sourceHash}.`);
  }
  for (const replacement of plan.replacements) {
    const applied = replaceDocxTextWithVariable(buffer, replacement.search, replacement.key);
    if (applied.replacements !== replacement.expected) {
      throw new Error(
        `${plan.source}: “${replacement.search}” substituído ${applied.replacements} vez(es); esperado ${replacement.expected}.`,
      );
    }
    buffer = applied.buffer;
  }
  await writeFile(path.resolve(plan.output), buffer);
  result.push({
    source: plan.source,
    sourceHash,
    output: plan.output,
    outputHash: sha256(buffer),
    variables: extractDocxVariables(buffer),
  });
}

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
