import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { generateDocx, extractDocxVariables } from "../src/features/hr/documents/docx-generator";
import { applyFieldMapping } from "../src/features/hr/documents/field-mapping";
import {
  PROBATION_CONTRACT_V3_FIELD_MAPPING,
  PROBATION_CONTRACT_V3_SOURCE,
} from "../src/features/hr/documents/probation-contract-template";

const source = await readFile(path.resolve(PROBATION_CONTRACT_V3_SOURCE));
const data: Record<string, unknown> = {
  employee: {
    name: "MARIA DE FÁTIMA SOUSA",
    cpf: "52998224725",
    address:
      "Rua das Acácias, nº 45, Jardim Renascença, São Luís/MA, CEP 65075-020",
  },
  integration: {
    employer_name: "COALA SHAKES COMÉRCIO DE ALIMENTOS LTDA",
    employer_cnpj: "12.345.678/0001-90",
    employer_address:
      "Avenida dos Holandeses, nº 1000, Calhau, São Luís/MA, CEP 65071-380",
    job_function: "ATENDENTE DE LOJA",
  },
};
const flat: Record<string, unknown> = {
  "employee.cpf": "529.982.247-25",
  "integration.employer_cnpj": "12.345.678/0001-90",
  "integration.job_cbo": "513415",
  "integration.monthly_salary": "R$ 1.787,30",
  "integration.expected_admission_date": "01/08/2026",
  "integration.probation_first_end_date": "14/09/2026",
  "integration.probation_final_end_date": "29/10/2026",
};
const rawFlat: Record<string, unknown> = {
  ...flat,
  "employee.cpf": "52998224725",
  "integration.employer_cnpj": "12345678000190",
  "integration.job_cbo": "513415",
  "integration.monthly_salary": 1787.3,
  "integration.expected_admission_date": "2026-08-01",
  "integration.probation_first_end_date": "2026-09-14",
  "integration.probation_final_end_date": "2026-10-29",
};
applyFieldMapping({
  data,
  flat,
  rawFlat,
  mapping: PROBATION_CONTRACT_V3_FIELD_MAPPING,
});

const generated = generateDocx(source, data);
const unresolved = extractDocxVariables(generated);
if (unresolved.length) {
  throw new Error(`A amostra deixou variáveis sem preencher: ${unresolved.join(", ")}.`);
}

const outputDirectory = path.resolve("output/docx");
const outputPath = path.join(outputDirectory, "contrato-experiencia-v3-piloto.docx");
await mkdir(outputDirectory, { recursive: true });
await writeFile(outputPath, generated);
process.stdout.write(`${outputPath}\n`);
