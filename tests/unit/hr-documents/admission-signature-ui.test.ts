import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [componentSource, routeSource] = await Promise.all([
  readFile(
    new URL("../../../src/components/hr/recruitment/recruitment-shell.tsx", import.meta.url),
    "utf8",
  ),
  readFile(
    new URL("../../../src/app/api/hr/onboarding/[id]/signature-documents/route.ts", import.meta.url),
    "utf8",
  ),
]);

test("concentra geração e revisão no próprio card durante a preparação", () => {
  const selectionStart = componentSource.indexOf("1. Selecione os modelos");
  const trackingStart = componentSource.indexOf(
    "activePhaseId !== 'signature_preparation' ? selectedSignatureDocuments.length > 0",
  );
  assert.ok(selectionStart >= 0 && trackingStart > selectionStart);

  const selectionSource = componentSource.slice(selectionStart, trackingStart);
  assert.match(selectionSource, /selectedSignatureDocuments\.find\(document => document\.templateId === template\.id\)/);
  assert.match(selectionSource, /Visualizar/);
  assert.match(selectionSource, /Baixar Word/);
  assert.match(selectionSource, /Revisado/);
  assert.match(selectionSource, /Gerar selecionados/);
  assert.doesNotMatch(selectionSource, /h-10 w-full/);
  assert.doesNotMatch(componentSource, /2\. Revisão do RH/);
});

test("prévia autenticada entrega o PDF gerado inline", () => {
  assert.match(componentSource, /download=preview/);
  assert.match(routeSource, /document\.get\("generatedPdfStoragePath"\)/);
  assert.match(routeSource, /preview \? "inline" : "attachment"/);
  assert.match(routeSource, /signed \|\| preview/);
});
