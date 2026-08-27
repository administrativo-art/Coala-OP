import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import test, { type TestContext } from "node:test";

import { collectGitState } from "../../../.agents/skills/coala-handoff/scripts/collect-git-state.mjs";
import { createHandoffOutputPath } from "../../../.agents/skills/coala-handoff/scripts/create-output-path.mjs";
import {
  HANDOFF_HEADINGS,
  validateHandoffMarkdown,
} from "../../../.agents/skills/coala-handoff/scripts/validate-handoff.mjs";

function validHandoff(overrides: Record<string, string> = {}) {
  const metadata = {
    handoff_version: "1",
    created_at: "2026-08-26T15:00:00.000Z",
    repository: "Coala-OP",
    branch: "main",
    base_commit: "a".repeat(40),
    working_tree_dirty: "false",
    continuation_mode: "validate-first",
    ...overrides,
  };
  return [
    "---",
    ...Object.entries(metadata).map(([key, value]) => `${key}: "${value}"`),
    "---",
    "# Handoff — Implantação",
    "",
    ...HANDOFF_HEADINGS.flatMap((heading) => [
      `## ${heading}`,
      heading === "Próximo passo exato"
        ? "Executar o validador estrutural."
        : heading === "Critério de conclusão"
          ? "Validador e testes verdes."
          : heading === "Instrução para retomada"
            ? "Validar o checkout antes de continuar."
            : "Nenhuma informação adicional.",
      "",
    ]),
  ].join("\n");
}

function gitFixture(t: TestContext) {
  const root = mkdtempSync(join(tmpdir(), "coala-handoff-git-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: root });
  execFileSync("git", ["config", "user.email", "fixture@invalid.local"], { cwd: root });
  execFileSync("git", ["config", "user.name", "Fixture"], { cwd: root });
  writeFileSync(join(root, "tracked.txt"), "base\n");
  execFileSync("git", ["add", "tracked.txt"], { cwd: root });
  execFileSync("git", ["commit", "-q", "-m", "base"], { cwd: root });
  return root;
}

test("valida handoff completo", () => {
  const result = validateHandoffMarkdown(validHandoff());
  assert.equal(result.valid, true, result.errors.join("\n"));
});

test("rejeita ausência de commit", () => {
  const result = validateHandoffMarkdown(validHandoff({ base_commit: "" }));
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes("base_commit")));
});

test("rejeita ausência de próximo passo", () => {
  const markdown = validHandoff().replace("## Próximo passo exato\nExecutar o validador estrutural.", "## Próximo passo exato\n");
  const result = validateHandoffMarkdown(markdown);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes("Próximo passo exato")));
});

test("rejeita ausência de critério de conclusão", () => {
  const markdown = validHandoff().replace("## Critério de conclusão\nValidador e testes verdes.", "## Critério de conclusão\n");
  const result = validateHandoffMarkdown(markdown);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes("Critério de conclusão")));
});

test("coleta estado limpo de repositório temporário", (t) => {
  const root = gitFixture(t);
  const state = collectGitState(root, new Date("2026-08-26T15:00:00.000Z"));
  assert.equal(state.branch, "main");
  assert.equal(state.workingTreeDirty, false);
  assert.equal(state.changedFiles.length, 0);
  assert.ok(state.head);
  assert.match(state.head, /^[0-9a-f]{40}$/);
});

test("coleta estado sujo e arquivos não rastreados", (t) => {
  const root = gitFixture(t);
  writeFileSync(join(root, "tracked.txt"), "alterado\n");
  writeFileSync(join(root, "novo.txt"), "novo\n");
  const state = collectGitState(root);
  assert.equal(state.workingTreeDirty, true);
  assert.ok(state.changedFiles.some((item: { path: string }) => item.path === "tracked.txt"));
  assert.deepEqual(state.untrackedFiles, ["novo.txt"]);
});

test("caminho de handoff é determinístico e evita colisão", (t) => {
  const root = gitFixture(t);
  const directory = join(root, ".ai-work", "handoffs");
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, "2026-08-26-1500-implantacao.md"), "existente\n");
  const result = createHandoffOutputPath({
    repositoryRoot: root,
    slug: "Implantação",
    date: new Date("2026-08-26T15:00:00.000Z"),
  });
  assert.equal(result.relativePath, ".ai-work/handoffs/2026-08-26-1500-implantacao-2.md");
});
