import { readFile } from "node:fs/promises";
import path from "node:path";

import { validateCtDocumentStandard } from "../src/features/hr/documents/docx-template-validation";

const inputs = process.argv.slice(2);
if (!inputs.length) {
  inputs.push(
    "docs/modelos-documentos/base-ct-sorvetes.dotx",
    "docs/modelos-documentos/admissionais/01-contrato-experiencia-v4.docx",
  );
}

const results = [];
for (const input of inputs) {
  const absolute = path.resolve(input);
  const result = validateCtDocumentStandard(await readFile(absolute));
  results.push({
    file: path.relative(process.cwd(), absolute),
    ...result,
  });
}
process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);

const failures = results.filter((result) => !result.valid);
if (failures.length) process.exitCode = 1;
