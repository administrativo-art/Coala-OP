import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { generateDocx, extractDocxVariables } from "../src/features/hr/documents/docx-generator";
import { applyFieldMapping } from "../src/features/hr/documents/field-mapping";
import {
  PROBATION_CONTRACT_V4_FIELD_MAPPING,
  PROBATION_CONTRACT_V4_SOURCE,
} from "../src/features/hr/documents/probation-contract-template";

const source = await readFile(path.resolve(PROBATION_CONTRACT_V4_SOURCE));
const data: Record<string, unknown> = {
  employee: {
    name: "THAISE CORREIA MARINHO",
    cpf: "05813688358",
    address:
      "Rua das Acácias, nº 45, Jardim Renascença, São Luís/MA, CEP 65075-020",
  },
  integration: {
    employer_name: "CT SORVETES LTDA",
    employer_cnpj: "14.276.603/0001-25",
    employer_address:
      "Avenida Guajajaras, Quadra 65, nº 3505, São Bernardo, São Luís/MA, CEP 65056-045",
    job_function: "ATENDENTE DE QUIOSQUE",
  },
};
const flat: Record<string, unknown> = {
  "employee.cpf": "058.136.883-58",
  "integration.employer_cnpj": "14.276.603/0001-25",
  "integration.job_cbo": "5134-35",
  "integration.monthly_salary": "R$ 1.787,30",
  "integration.expected_admission_date": "01/08/2026",
  "integration.probation_first_period_days": "30",
  "integration.probation_second_period_days": "60",
  "integration.probation_first_end_date": "30/08/2026",
  "integration.probation_final_end_date": "29/10/2026",
};
const rawFlat: Record<string, unknown> = {
  ...flat,
  "employee.cpf": "05813688358",
  "integration.employer_cnpj": "14276603000125",
  "integration.job_cbo": "513435",
  "integration.monthly_salary": 1787.3,
  "integration.expected_admission_date": "2026-08-01",
  "integration.probation_first_period_days": 30,
  "integration.probation_second_period_days": 60,
  "integration.probation_first_end_date": "2026-08-30",
  "integration.probation_final_end_date": "2026-10-29",
};
applyFieldMapping({
  data,
  flat,
  rawFlat,
  mapping: PROBATION_CONTRACT_V4_FIELD_MAPPING,
});

const generated = generateDocx(source, data);
const unresolved = extractDocxVariables(generated);
if (unresolved.length) {
  throw new Error(`A amostra deixou variáveis sem preencher: ${unresolved.join(", ")}.`);
}

const outputDirectory = path.resolve("output/docx");
const outputPath = path.join(outputDirectory, "contrato-experiencia-v4-piloto.docx");
await mkdir(outputDirectory, { recursive: true });
await writeFile(outputPath, generated);
process.stdout.write(`${outputPath}\n`);
