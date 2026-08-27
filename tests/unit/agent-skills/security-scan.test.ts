import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";

import {
  normalizeSemgrepFindings,
  preflightSecurityScan,
  runSecurityScan,
  writeSecurityArtifacts,
} from "../../../.agents/skills/coala-security-scan/scripts/run-security-scan.mjs";

function fixture(t: TestContext) {
  const root = mkdtempSync(join(tmpdir(), "coala-security-skill-"));
  mkdirSync(join(root, ".ai-work", "security"), { recursive: true });
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

test("preflight informa ferramenta ausente sem instalar", (t) => {
  const root = fixture(t);
  const emptyPath = join(root, "bin");
  mkdirSync(emptyPath);
  const result = preflightSecurityScan({ repositoryRoot: root, envPath: emptyPath });
  assert.equal(result.available, false);
  assert.equal(result.networkRequired, false);
  assert.equal(result.externalUpload, false);
});

test("smoke: ferramenta ausente encerra sem criar relatório nem alterar fonte", (t) => {
  const root = fixture(t);
  const emptyPath = join(root, "bin");
  mkdirSync(emptyPath);
  const source = join(root, "fixture.ts");
  writeFileSync(source, "export const value = true;\n");
  const before = readFileSync(source, "utf8");
  const result = runSecurityScan({ repositoryRoot: root, mode: "path", requestedPath: "fixture.ts", envPath: emptyPath });
  assert.equal(result.performed, false);
  assert.match(result.reason ?? "", /não está instalado/);
  assert.equal(readFileSync(source, "utf8"), before);
});

test("normaliza JSON do Semgrep com classificação obrigatória", () => {
  const findings = normalizeSemgrepFindings({
    results: [
      {
        check_id: "javascript.lang.security.example",
        path: "src/example.ts",
        start: { line: 12 },
        extra: { severity: "ERROR", message: "exemplo sanitizado" },
      },
    ],
  });
  assert.equal(findings.length, 1);
  assert.equal(findings[0].classification, "INCONCLUSIVO");
  assert.equal(findings[0].file, "src/example.ts");
  assert.equal(findings[0].line, 12);
});

test("gera artifacts válidos somente em .ai-work/security", (t) => {
  const root = fixture(t);
  const source = join(root, "source.ts");
  writeFileSync(source, "export const untouched = true;\n");
  const before = readFileSync(source, "utf8");
  const outputDirectory = join(root, ".ai-work", "security", "20260826-1500");
  const findings = normalizeSemgrepFindings({ results: [] });
  writeSecurityArtifacts({
    repositoryRoot: root,
    outputDirectory,
    mode: "path",
    scope: ["source.ts"],
    preflight: { tool: "semgrep", version: "fixture", localConfig: ".semgrep.yml" },
    findings,
  });
  assert.deepEqual(JSON.parse(readFileSync(join(outputDirectory, "findings.json"), "utf8")), []);
  assert.match(readFileSync(join(outputDirectory, "report.md"), "utf8"), /Autofix: NÃO/);
  assert.equal(readFileSync(source, "utf8"), before);
});

test("rejeita output fora de .ai-work/security", (t) => {
  const root = fixture(t);
  assert.throws(
    () => writeSecurityArtifacts({
      repositoryRoot: root,
      outputDirectory: join(root, "fora"),
      mode: "changed",
      scope: [],
      preflight: { tool: "semgrep", version: null, localConfig: null },
      findings: [],
    }),
    /\.ai-work\/security/,
  );
});

test("wrapper não contém opção de autofix", () => {
  const source = readFileSync(
    join(process.cwd(), ".agents/skills/coala-security-scan/scripts/run-security-scan.mjs"),
    "utf8",
  );
  assert.doesNotMatch(source, /--(?:auto)?fix\b/i);
});
