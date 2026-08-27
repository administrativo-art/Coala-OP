import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  extractDocxVariables,
  generateDocx,
} from "../src/features/hr/documents/docx-generator";
import { HOURS_BANK_V2_SOURCE } from "../src/features/hr/documents/hours-bank-template";

const source = await readFile(path.resolve(HOURS_BANK_V2_SOURCE));
const data: Record<string, unknown> = {
  employee: {
    name: "MARIA DE FÁTIMA SOUSA",
    ctps_number: "1234567",
    ctps_series: "00010/MA",
  },
  integration: {
    employer_name: "COALA SHAKES COMÉRCIO DE ALIMENTOS LTDA",
    employer_cnpj: "12.345.678/0001-90",
    employer_address:
      "Avenida dos Holandeses, nº 1000, Calhau, São Luís/MA, CEP 65071-380",
  },
};

const generated = generateDocx(source, data);
const unresolved = extractDocxVariables(generated);
if (unresolved.length) {
  throw new Error(
    `A amostra deixou variáveis sem preencher: ${unresolved.join(", ")}.`,
  );
}

const outputDirectory = path.resolve("output/docx");
const outputPath = path.join(outputDirectory, "acordo-banco-horas-piloto.docx");
await mkdir(outputDirectory, { recursive: true });
await writeFile(outputPath, generated);
process.stdout.write(`${outputPath}\n`);
