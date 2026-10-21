import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const routes = [
  "src/app/api/hr/employee-documents/publication/route.ts",
  "src/app/api/hr/employee-documents/publication-policy/route.ts",
  "src/app/api/hr/employee-documents/classification/route.ts",
  "src/app/api/hr/employee-documents/status/route.ts",
  "src/app/api/hr/employee-documents/confirm/route.ts",
];

test("operações de publicação e classificação passam por secureRoute e pelo DP documental", () => {
  for (const route of routes) {
    const source = readFileSync(route, "utf8");
    assert.match(source, /secureRoute\(/, route);
    assert.match(source, /strategy: ["']documents-dp["']/, route);
    assert.match(source, /authorization:documents-dp/, route);
    assert.match(source, /assertDocumentsDp\(/, route);
  }
});
