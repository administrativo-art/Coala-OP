import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const dayPageSource = readFileSync(
  path.join(process.cwd(), "src/features/financial/cash-closures/components/cash-closure-day-page.tsx"),
  "utf8",
);

test("contagem do Caixa não oferece atalho para copiar o esperado do PDV", () => {
  assert.doesNotMatch(dayPageSource, /Usar esperado/);
  assert.doesNotMatch(dayPageSource, /reportedCents:\s*line\.expectedCents/);
});
