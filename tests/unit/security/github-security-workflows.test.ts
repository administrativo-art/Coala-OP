import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import test from "node:test";

const repositoryRoot = resolve(import.meta.dirname, "../../..");
const workflowRoot = join(repositoryRoot, ".github", "workflows");

test("todas as GitHub Actions estão pinadas por SHA integral com versão humana", () => {
  for (const name of ["verify.yml", "codeql.yml", "e2e-observation.yml"]) {
    const workflow = readFileSync(join(workflowRoot, name), "utf8");
    const uses = [...workflow.matchAll(/^\s*uses:\s*([^\s#]+)(?:\s+#\s*(\S+))?/gm)];
    assert.ok(uses.length > 0, `${name} deve usar actions`);
    for (const match of uses) {
      assert.match(match[1] ?? "", /^[^@\s]+@[0-9a-f]{40}$/);
      assert.match(match[2] ?? "", /^v\d+\.\d+\.\d+$/);
    }
  }
});

test("CodeQL cobre JavaScript/TypeScript antes da promoção sem repetir no push de main", () => {
  const workflow = readFileSync(join(workflowRoot, "codeql.yml"), "utf8");
  assert.match(workflow, /^\s*pull_request:\s*$/m);
  assert.doesNotMatch(workflow, /^\s*push:\s*$/m);
  assert.match(workflow, /^\s*schedule:\s*$/m);
  assert.match(workflow, /cron: "17 9 \* \* 1"/);
  assert.match(workflow, /languages: javascript-typescript/);
  assert.match(workflow, /security-events: write/);
  assert.match(
    workflow,
    /if: github\.event_name != 'pull_request' \|\| github\.base_ref != 'production'/,
  );
  assert.doesNotMatch(workflow, /pull_request_target|continue-on-error/);
});

test("verify executa uma vez no PR e não repete depois do merge em main", () => {
  const workflow = readFileSync(join(workflowRoot, "verify.yml"), "utf8");
  assert.match(workflow, /^\s*pull_request:\s*$/m);
  assert.doesNotMatch(workflow, /^\s*push:\s*$/m);
});

test("quality executa o ratchet sem mutar o baseline", () => {
  const workflow = readFileSync(join(workflowRoot, "verify.yml"), "utf8");
  const script = readFileSync(join(repositoryRoot, "scripts", "check-vulnerability-ratchet.mjs"), "utf8");
  assert.match(
    workflow,
    /name: Enforce vulnerability ratchet\n\s+if: github\.event_name != 'pull_request' \|\| github\.base_ref != 'production'\n\s+run: npm run check:vulnerabilities/,
  );
  assert.doesNotMatch(script, /writeFile|appendFile|renameSync|rmSync/);
});

test("rollout para production reaproveita o conteúdo já verificado em main", () => {
  const workflow = readFileSync(join(workflowRoot, "verify.yml"), "utf8");
  assert.match(
    workflow,
    /name: Verify application\n\s+if: github\.event_name != 'pull_request' \|\| github\.base_ref != 'production'\n\s+run: npm run verify/,
  );
  assert.match(
    workflow,
    /name: Verify production promotion\n\s+if: github\.event_name == 'pull_request' && github\.base_ref == 'production'/,
  );
  assert.match(
    workflow,
    /git show origin\/main:scripts\/verify-production-promotion\.mjs/,
  );
  assert.doesNotMatch(workflow, /Reuse main verification for production/);
});

test("quality concentra os gates obrigatórios sem instalações root duplicadas", () => {
  const workflow = readFileSync(join(workflowRoot, "verify.yml"), "utf8");
  assert.equal([...workflow.matchAll(/^\s+run: npm ci\s*$/gm)].length, 2);
  assert.match(workflow, /name: Verify Firebase rules[\s\S]*run: npm run check:rules/);
  assert.match(workflow, /name: Verify application[\s\S]*run: npm run verify/);
  assert.match(workflow, /name: Build Functions[\s\S]*working-directory: functions/);
  assert.doesNotMatch(workflow, /name: firestore-rules|name: functions/);
});

test("E2E de observação cobre PRs para main, semanal e manual com uma preparação", () => {
  const workflow = readFileSync(join(workflowRoot, "e2e-observation.yml"), "utf8");
  assert.match(workflow, /^\s*workflow_dispatch:\s*$/m);
  assert.match(workflow, /^\s*schedule:\s*$/m);
  assert.match(workflow, /^  pull_request:\n    branches: \[main\]$/m);
  assert.doesNotMatch(workflow, /pull_request_target|paths-ignore:|paths:|branches-ignore:|production/);
  assert.doesNotMatch(workflow, /^\s*push:\s*$/m);
  assert.match(workflow, /cancel-in-progress: true/);
  assert.equal([...workflow.matchAll(/continue-on-error: true/g)].length, 4);
  assert.match(workflow, /name: Observation summary\n\s+if: always\(\)/);
  assert.equal([...workflow.matchAll(/^\s+run: npm ci\s*$/gm)].length, 1);
  assert.equal([...workflow.matchAll(/playwright install --with-deps chromium/g)].length, 1);
  for (const command of [
    "npm run test:e2e",
    "node scripts/test-reconciliation-api-e2e.mjs",
    "node scripts/test-expense-boleto-e2e.mjs",
    "node scripts/test-instagram-schedule-e2e.mjs",
  ]) {
    assert.ok(workflow.includes(command), `${command} deve permanecer na observação`);
  }
});
