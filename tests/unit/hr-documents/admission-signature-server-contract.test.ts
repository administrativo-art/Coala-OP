import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(
  new URL("../../../src/features/hr/documents/signature-workflow.server.ts", import.meta.url),
  "utf8",
);

test("servidor valida a modalidade de vale-transporte ao selecionar, gerar, visualizar e enviar", () => {
  const validations = source.match(/assertApplicableSignatureTemplates\(/g) ?? [];
  assert.equal(validations.length, 5);
  assert.match(source, /uniqueIds\.map\(\(templateId\) => \(\{ templateId \}\)\)/);
  assert.equal(
    source.match(/selectedDocuments\.map\(\(document\) => \(\{ templateId: document\.get\("templateId"\) \}\)\)/g)?.length,
    3,
  );
});

test("prévia completa reutiliza o compositor do envio e exclui aceite independente", () => {
  assert.match(source, /export async function previewAdmissionBundle/);
  assert.match(source, /document\.get\("signatureScope"\) !== "independent"/);
  assert.match(source, /const prepared = await prepareAdmissionBundle/);
  assert.match(source, /protocol: "ADM-PRÉVIA"/);
  assert.match(
    source,
    /where\("onboardingId", "==", params\.onboardingId\)\s+\.limit\(30\)\s+\.get\(\)/,
  );
});
