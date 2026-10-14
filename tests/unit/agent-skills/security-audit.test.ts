import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";

import {
  createAuditRun,
  validateAuditId,
} from "../../../.agents/skills/coala-security-audit/scripts/init-audit-run.mjs";
import { validateAuditRun } from "../../../.agents/skills/coala-security-audit/scripts/validate-audit-run.mjs";

function fixture(t: TestContext) {
  const root = mkdtempSync(join(tmpdir(), "coala-security-audit-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

test("inicializa auditoria somente em .ai-work com limites seguros", (t) => {
  const root = fixture(t);
  const result = createAuditRun({ repositoryRoot: root, auditId: "audit-smoke" });
  const scope = JSON.parse(readFileSync(join(result.outputDirectory, "scope.json"), "utf8"));

  assert.equal(scope.auditId, "audit-smoke");
  assert.equal(scope.authorization.staticAnalysis, true);
  assert.equal(scope.authorization.localDynamicTesting, false);
  assert.equal(scope.authorization.externalNetwork, false);
  assert.equal(scope.authorization.productionTesting, false);
  assert.equal(scope.authorization.codeChanges, false);
  assert.match(result.outputDirectory, /\.ai-work\/security-audit\/audit-smoke$/);
});

test("recusa id inseguro e não sobrescreve execução", (t) => {
  const root = fixture(t);
  assert.throws(() => validateAuditId("../fora"), /ID deve ter/);
  createAuditRun({ repositoryRoot: root, auditId: "audit-existing" });
  assert.throws(
    () => createAuditRun({ repositoryRoot: root, auditId: "audit-existing" }),
    /Auditoria já existe/
  );
});

test("recusa raiz de artefatos redirecionada por link simbólico", (t) => {
  const root = fixture(t);
  const outside = mkdtempSync(join(tmpdir(), "coala-security-audit-outside-"));
  t.after(() => rmSync(outside, { recursive: true, force: true }));
  mkdirSync(join(root, ".ai-work"));
  symlinkSync(outside, join(root, ".ai-work", "security-audit"));

  assert.throws(
    () => createAuditRun({ repositoryRoot: root, auditId: "audit-symlink" }),
    /não pode ser link simbólico/
  );
});

test("valida os artefatos iniciais", (t) => {
  const root = fixture(t);
  const result = createAuditRun({ repositoryRoot: root, auditId: "audit-valid" });
  assert.deepEqual(validateAuditRun(result.outputDirectory, root), {
    auditId: "audit-valid",
    inventoryItems: 0,
    coverageItems: 0,
    hypothesisItems: 0,
    findingItems: 0,
  });
});

test("rejeita achado confirmado sem evidência", (t) => {
  const root = fixture(t);
  const result = createAuditRun({ repositoryRoot: root, auditId: "audit-invalid" });
  writeFileSync(join(result.outputDirectory, "findings.json"), JSON.stringify({
    schemaVersion: 1,
    items: [{
      id: "SEC-001",
      title: "Falha demonstrativa",
      status: "CONFIRMED",
      severity: "HIGH",
      location: "src/example.ts",
      description: "Descrição de teste",
      evidence: [],
    }],
  }, null, 2));

  assert.throws(
    () => validateAuditRun(result.outputDirectory, root),
    /não possui evidência/
  );
});
