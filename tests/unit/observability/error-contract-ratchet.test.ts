import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";

import { compareErrorContract, scanErrorContract } from "../../../scripts/check-error-contract.mjs";

function fixture(t: TestContext) {
  const root = mkdtempSync(join(tmpdir(), "coala-error-contract-"));
  mkdirSync(join(root, "src", "app", "api", "new-route"), { recursive: true });
  mkdirSync(join(root, "functions", "src"), { recursive: true });
  mkdirSync(join(root, "scripts"), { recursive: true });
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

test("ratchet permite somente a dívida explicitamente existente", (t) => {
  const root = fixture(t);
  const route = join(root, "src", "app", "api", "new-route", "route.ts");
  writeFileSync(route, "return NextResponse.json({ error: error.message });\n");
  const current = scanErrorContract(root);
  assert.deepEqual(compareErrorContract(current, current), []);
  assert.equal(compareErrorContract(current, {}).length >= 2, true);
});

test("ratchet bloqueia novo console.error e log próximo de Authorization", (t) => {
  const root = fixture(t);
  writeFileSync(join(root, "scripts", "new-script.mjs"), [
    "console.error('unexpected');",
    "console.log('Authorization', token);",
  ].join("\n"));
  const current = scanErrorContract(root);
  const violations = compareErrorContract(current, {});
  assert.equal(violations.some((item) => item.key.startsWith("ad-hoc-console-error-warning:")), true);
  assert.equal(violations.some((item) => item.key.startsWith("sensitive-value-near-log:")), true);
});

test("ratchet aceita redução de dívida e rejeita aumento no mesmo arquivo", () => {
  assert.deepEqual(compareErrorContract({ "rule:file.ts": 2 }, { "rule:file.ts": 3 }), []);
  assert.deepEqual(compareErrorContract({ "rule:file.ts": 4 }, { "rule:file.ts": 3 }), [
    { key: "rule:file.ts", current: 4, allowed: 3 },
  ]);
});
