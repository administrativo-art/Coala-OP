import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test, { type TestContext } from "node:test";

import {
  createIssueOutputPath,
} from "../../../.agents/skills/coala-issue-draft/scripts/create-output-path.mjs";
import {
  scanSensitiveText,
} from "../../../.agents/skills/coala-issue-draft/scripts/scan-sensitive-content.mjs";
import {
  ISSUE_HEADINGS,
  validateIssueDocument,
} from "../../../.agents/skills/coala-issue-draft/scripts/validate-issue.mjs";

function fixture(t: TestContext) {
  const root = mkdtempSync(join(tmpdir(), "coala-issue-skill-"));
  const directory = join(root, ".ai-work", "issues");
  mkdirSync(directory, { recursive: true });
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return { root, directory };
}

function validIssue() {
  return [
    "# Link público retorna página não encontrada",
    "",
    ...ISSUE_HEADINGS.flatMap((heading) => [
      `## ${heading}`,
      heading === "Status do rascunho" ? "INCOMPLETO" : "NÃO INFORMADO",
      "",
    ]),
  ].join("\n");
}

test("aceita issue válida dentro de .ai-work/issues", (t) => {
  const { root, directory } = fixture(t);
  const filePath = join(directory, "2026-08-26-link-publico.md");
  const result = validateIssueDocument({ filePath, repositoryRoot: root, markdown: validIssue() });
  assert.equal(result.valid, true, result.errors.join("\n"));
});

test("rejeita heading ausente", (t) => {
  const { root, directory } = fixture(t);
  const markdown = validIssue().replace("## Impacto\nNÃO INFORMADO\n", "");
  const result = validateIssueDocument({ filePath: join(directory, "issue.md"), repositoryRoot: root, markdown });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes("Impacto")));
});

test("rejeita arquivo fora de .ai-work/issues", (t) => {
  const { root } = fixture(t);
  const result = validateIssueDocument({ filePath: join(root, "issue.md"), repositoryRoot: root, markdown: validIssue() });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes(".ai-work/issues")));
});

test("scanner detecta bearer token sem imprimir o valor inteiro", () => {
  const secret = "Bearer abcdefghijklmnopqrstuvwxyz123456";
  const findings = scanSensitiveText(`authorization: ${secret}`);
  assert.equal(findings[0]?.type, "BEARER_TOKEN");
  assert.notEqual(findings[0]?.preview, secret);
});

test("scanner detecta chave privada", () => {
  const findings = scanSensitiveText("-----BEGIN PRIVATE KEY-----\nconteudo\n-----END PRIVATE KEY-----");
  assert.equal(findings[0]?.type, "PRIVATE_KEY");
});

test("scanner aceita conteúdo sanitizado", () => {
  assert.deepEqual(scanSensitiveText("Falha 404 reproduzida no ambiente local, sem dados pessoais."), []);
});

test("caminho de saída evita colisão", (t) => {
  const { root, directory } = fixture(t);
  writeFileSync(join(directory, "2026-08-26-link-publico.md"), "existente");
  const output = createIssueOutputPath({
    repositoryRoot: root,
    slug: "Link público",
    date: new Date("2026-08-26T12:00:00.000Z"),
  });
  assert.equal(output.relativePath, ".ai-work/issues/2026-08-26-link-publico-2.md");
});

test("smoke: CLIs validam fixture sanitizada e o diretório temporário é removível", (t) => {
  const { root, directory } = fixture(t);
  const init = spawnSync("git", ["init", "-q"], { cwd: root, encoding: "utf8" });
  assert.equal(init.status, 0, init.stderr);
  const filePath = join(directory, "2026-08-26-smoke.md");
  writeFileSync(filePath, validIssue());
  const validate = spawnSync(
    process.execPath,
    [join(process.cwd(), ".agents/skills/coala-issue-draft/scripts/validate-issue.mjs"), filePath],
    { cwd: root, encoding: "utf8" },
  );
  const scan = spawnSync(
    process.execPath,
    [join(process.cwd(), ".agents/skills/coala-issue-draft/scripts/scan-sensitive-content.mjs"), filePath],
    { cwd: root, encoding: "utf8" },
  );
  assert.equal(validate.status, 0, validate.stderr);
  assert.equal(scan.status, 0, scan.stderr);
});
