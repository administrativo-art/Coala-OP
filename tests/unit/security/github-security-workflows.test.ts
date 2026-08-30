import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import test from "node:test";

const repositoryRoot = resolve(import.meta.dirname, "../../..");
const workflowRoot = join(repositoryRoot, ".github", "workflows");

test("todas as GitHub Actions estão pinadas por SHA integral com versão humana", () => {
  for (const name of ["verify.yml", "codeql.yml"]) {
    const workflow = readFileSync(join(workflowRoot, name), "utf8");
    const uses = [...workflow.matchAll(/^\s*uses:\s*([^\s#]+)(?:\s+#\s*(\S+))?/gm)];
    assert.ok(uses.length > 0, `${name} deve usar actions`);
    for (const match of uses) {
      assert.match(match[1] ?? "", /^[^@\s]+@[0-9a-f]{40}$/);
      assert.match(match[2] ?? "", /^v\d+\.\d+\.\d+$/);
    }
  }
});

test("CodeQL cobre somente JavaScript/TypeScript em PR, main e agenda semanal", () => {
  const workflow = readFileSync(join(workflowRoot, "codeql.yml"), "utf8");
  assert.match(workflow, /^\s*pull_request:\s*$/m);
  assert.match(workflow, /^\s*push:\s*$/m);
  assert.match(workflow, /^\s*schedule:\s*$/m);
  assert.match(workflow, /branches:\n\s+- main/);
  assert.match(workflow, /cron: "17 9 \* \* 1"/);
  assert.match(workflow, /languages: javascript-typescript/);
  assert.match(workflow, /security-events: write/);
  assert.doesNotMatch(workflow, /pull_request_target|continue-on-error/);
});

test("quality executa o ratchet sem mutar o baseline", () => {
  const workflow = readFileSync(join(workflowRoot, "verify.yml"), "utf8");
  const script = readFileSync(join(repositoryRoot, "scripts", "check-vulnerability-ratchet.mjs"), "utf8");
  assert.match(workflow, /name: Enforce vulnerability ratchet\n\s+run: npm run check:vulnerabilities/);
  assert.doesNotMatch(script, /writeFile|appendFile|renameSync|rmSync/);
});
