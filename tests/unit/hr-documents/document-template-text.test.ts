import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { extractDocumentTemplateTextBlocks } from "../../../src/features/hr/documents/document-template-text";

test("extrai o contrato completo com seções, numeração e tokens", async () => {
  const source = await readFile(path.join(
    process.cwd(),
    "docs/modelos-documentos/admissionais/01-contrato-experiencia-v4.docx",
  ));
  const blocks = extractDocumentTemplateTextBlocks(source);
  assert.ok(blocks.length > 20);
  assert.equal(blocks[0]?.kind, "title");
  assert.equal(blocks.find((block) => block.kind === "clause")?.number, "1.");
  assert.equal(
    blocks.find((block) => block.text.includes("A jornada de trabalho será"))?.number,
    "2.1.",
  );
  assert.equal(
    blocks.find((block) => block.text.includes("obriga-se a manter sigilo"))?.number,
    "14.1.",
  );
  assert.ok(blocks.some((block) => block.text.includes("{{contract_monthly_salary}}")));
  assert.ok(blocks.some((block) => block.text.includes("{{employee.name}}")));
});
