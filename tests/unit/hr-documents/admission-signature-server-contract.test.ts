import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(
  new URL("../../../src/features/hr/documents/signature-workflow.server.ts", import.meta.url),
  "utf8",
);

test("servidor valida a modalidade de vale-transporte ao selecionar, gerar e enviar", () => {
  const validations = source.match(/assertApplicableSignatureTemplates\(/g) ?? [];
  assert.equal(validations.length, 4);
  assert.match(source, /uniqueIds\.map\(\(templateId\) => \(\{ templateId \}\)\)/);
  assert.equal(
    source.match(/selectedDocuments\.map\(\(document\) => \(\{ templateId: document\.get\("templateId"\) \}\)\)/g)?.length,
    2,
  );
});
