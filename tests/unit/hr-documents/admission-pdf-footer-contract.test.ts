import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "../../..");
const letterheadSource = readFileSync(
  resolve(root, "src/features/hr/documents/letterhead-pdf.server.ts"),
  "utf8",
);
const composerSource = readFileSync(
  resolve(root, "src/features/hr/documents/document-pdf-composer.server.ts"),
  "utf8",
);

test("limpa o rodapé antes do timbre e preserva a marca em todas as páginas", () => {
  assert.ok(letterheadSource.indexOf("page.drawRectangle") < letterheadSource.indexOf("page.drawImage"));
  assert.doesNotMatch(letterheadSource, /pageIndex > 0/);
  assert.doesNotMatch(letterheadSource, /Rubrica:/);
});

test("pacote não imprime protocolo, componente ou hash sobre o timbre", () => {
  assert.doesNotMatch(composerSource, /drawTrackingFooter|trackingLabel/);
  assert.doesNotMatch(composerSource, /Conteúdo \$\{hashPrefix\}/);
});
