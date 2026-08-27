import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import test, { type TestContext } from "node:test";

import { collectGitState } from "../../../.agents/skills/coala-handoff/scripts/collect-git-state.mjs";
import { HANDOFF_HEADINGS } from "../../../.agents/skills/coala-handoff/scripts/validate-handoff.mjs";
import {
  CLASSIFICATIONS,
  compareHandoffState,
} from "../../../.agents/skills/coala-resume-handoff/scripts/compare-handoff-state.mjs";

function repoFixture(t: TestContext) {
  const root = mkdtempSync(join(tmpdir(), "coala-resume-git-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: root });
  execFileSync("git", ["config", "user.email", "fixture@invalid.local"], { cwd: root });
  execFileSync("git", ["config", "user.name", "Fixture"], { cwd: root });
  writeFileSync(join(root, ".gitignore"), ".ai-work/\n");
  writeFileSync(join(root, "tracked.txt"), "base\n");
  execFileSync("git", ["add", ".gitignore", "tracked.txt"], { cwd: root });
  execFileSync("git", ["commit", "-q", "-m", "base"], { cwd: root });
  mkdirSync(join(root, ".ai-work", "handoffs"), { recursive: true });
  return root;
}

function handoffMarkdown(state: ReturnType<typeof collectGitState>, files: string[] = []) {
  return [
    "---",
    'handoff_version: "1"',
    'created_at: "2026-08-26T15:00:00.000Z"',
    'repository: "fixture"',
    `branch: "${state.branch}"`,
    `base_commit: "${state.head}"`,
    `working_tree_dirty: ${state.workingTreeDirty}`,
    'continuation_mode: "validate-first"',
    `status_fingerprint: "${state.statusFingerprint}"`,
    "---",
    "# Handoff — Fixture",
    "",
    ...HANDOFF_HEADINGS.flatMap((heading) => [
      `## ${heading}`,
      heading === "Arquivos modificados"
        ? files.map((file) => `- \`${file}\``).join("\n") || "Nenhum."
        : heading === "Próximo passo exato"
          ? "Executar o próximo teste."
          : heading === "Critério de conclusão"
            ? "Teste verde."
            : heading === "Instrução para retomada"
              ? "Validar primeiro."
              : "Sem alteração.",
      "",
    ]),
  ].join("\n");
}

function writeHandoff(root: string, markdown: string, name = "handoff.md") {
  const path = join(root, ".ai-work", "handoffs", name);
  writeFileSync(path, markdown);
  return `.ai-work/handoffs/${name}`;
}

test("classifica mesma branch, commit e working tree como compatível", (t) => {
  const root = repoFixture(t);
  const state = collectGitState(root);
  const path = writeHandoff(root, handoffMarkdown(state));
  const result = compareHandoffState({ repositoryRoot: root, handoffPath: path, gitState: state });
  assert.equal(result.classification, CLASSIFICATIONS.compatible, result.reasons.join("\n"));
});

test("classifica commits posteriores na mesma branch como divergência não bloqueante", (t) => {
  const root = repoFixture(t);
  const initial = collectGitState(root);
  const path = writeHandoff(root, handoffMarkdown(initial));
  writeFileSync(join(root, "tracked.txt"), "posterior\n");
  execFileSync("git", ["add", "tracked.txt"], { cwd: root });
  execFileSync("git", ["commit", "-q", "-m", "posterior"], { cwd: root });
  const current = collectGitState(root);
  const result = compareHandoffState({ repositoryRoot: root, handoffPath: path, gitState: current });
  assert.equal(result.classification, CLASSIFICATIONS.nonBlocking, result.reasons.join("\n"));
});

test("classifica branch diferente como divergência bloqueante", (t) => {
  const root = repoFixture(t);
  const state = collectGitState(root);
  const path = writeHandoff(root, handoffMarkdown(state));
  const result = compareHandoffState({
    repositoryRoot: root,
    handoffPath: path,
    gitState: { ...state, branch: "outra-branch" },
  });
  assert.equal(result.classification, CLASSIFICATIONS.blocking, result.reasons.join("\n"));
});

test("classifica arquivo citado removido como divergência bloqueante", (t) => {
  const root = repoFixture(t);
  const state = collectGitState(root);
  const path = writeHandoff(root, handoffMarkdown(state, ["src/removido.ts"]));
  const result = compareHandoffState({ repositoryRoot: root, handoffPath: path, gitState: state });
  assert.equal(result.classification, CLASSIFICATIONS.blocking, result.reasons.join("\n"));
});

test("classifica handoff inválido", (t) => {
  const root = repoFixture(t);
  const path = writeHandoff(root, "# documento sem contrato\n");
  const result = compareHandoffState({ repositoryRoot: root, handoffPath: path });
  assert.equal(result.classification, CLASSIFICATIONS.invalid);
});

test("rejeita path traversal", (t) => {
  const root = repoFixture(t);
  const result = compareHandoffState({ repositoryRoot: root, handoffPath: "../fora.md" });
  assert.equal(result.classification, CLASSIFICATIONS.invalid);
  assert.ok(result.reasons.some((reason: string) => reason.includes("Path traversal")));
});

test("rejeita symlink externo", (t) => {
  const root = repoFixture(t);
  const outside = mkdtempSync(join(tmpdir(), "coala-resume-outside-"));
  t.after(() => rmSync(outside, { recursive: true, force: true }));
  const external = join(outside, "handoff.md");
  writeFileSync(external, "# externo\n");
  symlinkSync(external, join(root, ".ai-work", "handoffs", "externo.md"));
  const result = compareHandoffState({ repositoryRoot: root, handoffPath: ".ai-work/handoffs/externo.md" });
  assert.equal(result.classification, CLASSIFICATIONS.invalid);
  assert.ok(result.reasons.some((reason: string) => /symlink/i.test(reason)), result.reasons.join("\n"));
});
