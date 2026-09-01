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
  assert.equal(
    [...workflow.matchAll(/name: Reuse main verification for production/g)].length,
    2,
  );
});
