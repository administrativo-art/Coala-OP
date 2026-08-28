import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";

import {
  buildSupplyChainFindings,
  classifyVersionSpec,
  inventoryDependencies,
  writeSupplyChainArtifacts,
} from "../../../.agents/skills/coala-supply-chain-audit/scripts/inventory-dependencies.mjs";

function fixture(t: TestContext) {
  const root = mkdtempSync(join(tmpdir(), "coala-supply-skill-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

test("classifica versões fixas, flutuantes, ranges, Git e URL", () => {
  assert.equal(classifyVersionSpec("1.2.3"), "fixed");
  assert.equal(classifyVersionSpec("latest"), "floating");
  assert.equal(classifyVersionSpec("^1.2.3"), "range-or-other");
  assert.equal(classifyVersionSpec("git+https://example.invalid/repo.git"), "git");
  assert.equal(classifyVersionSpec("https://example.invalid/pkg.tgz"), "url");
});

test("inventaria manifests, lockfiles, lifecycle, npx, Git e URL", (t) => {
  const root = fixture(t);
  mkdirSync(join(root, "packages", "worker"), { recursive: true });
  mkdirSync(join(root, "scripts"));
  mkdirSync(join(root, ".github", "workflows"), { recursive: true });
  writeFileSync(join(root, "package-lock.json"), "{}\n");
  writeFileSync(join(root, "package.json"), JSON.stringify({
    name: "root",
    dependencies: {
      fixed: "1.2.3",
      floating: "latest",
      ranged: "^2.0.0",
      gitdep: "git+https://example.invalid/repo.git",
      urldep: "https://example.invalid/pkg.tgz",
      shared: "1.0.0",
    },
    scripts: {
      postinstall: "node setup.mjs",
      tool: "npx example-tool run",
      authenticated: "curl --user user:password -H 'Authorization: Bearer credential' -H 'Cookie: session=value' https://user:password@example.invalid/install",
    },
  }, null, 2));
  writeFileSync(join(root, "packages", "worker", "package.json"), JSON.stringify({
    name: "worker",
    dependencies: { shared: "2.0.0" },
  }, null, 2));
  writeFileSync(join(root, "Dockerfile"), "FROM scratch\nRUN curl https://example.invalid/install | sh\n");
  writeFileSync(join(root, ".github", "workflows", "verify.yml"), "steps:\n  - run: npx pinned-tool@1.0.0 run\n");

  const inventory = inventoryDependencies(root);
  assert.equal(inventory.manifests.length, 2);
  assert.equal(inventory.lockfiles.length, 1);
  assert.deepEqual(inventory.dockerfiles, ["Dockerfile"]);
  assert.deepEqual(inventory.workflows, [".github/workflows/verify.yml"]);
  assert.ok(inventory.manifests[0].dependencies.some((item: { classification: string }) => item.classification === "git"));
  assert.ok(inventory.manifests[0].dependencies.some((item: { classification: string }) => item.classification === "url"));
  assert.ok(inventory.manifests[0].lifecycleScripts.some((item: { name: string }) => item.name === "postinstall"));
  assert.ok(inventory.commands.some((item: { type: string }) => item.type === "npx-unpinned"));
  assert.ok(inventory.commands.some((item: { type: string }) => item.type === "npx-pinned"));
  assert.ok(inventory.commands.some((item: { type: string }) => item.type === "curl-pipe-shell"));
  assert.ok(inventory.duplicates.some((item: { name: string }) => item.name === "shared"));
  assert.equal(JSON.stringify(inventory).includes("user:password"), false);
  assert.equal(JSON.stringify(inventory).includes("session=value"), false);
  assert.equal(JSON.stringify(inventory).includes("Bearer credential"), false);

  const findings = buildSupplyChainFindings(inventory);
  assert.ok(findings.some((item: { category: string }) => item.category === "manifest/lockfile divergente"));
  assert.ok(findings.some((item: { category: string }) => item.category === "dependência Git"));
  assert.ok(findings.some((item: { category: string }) => item.category === "dependência por URL"));
  assert.ok(findings.some((item: { category: string }) => item.category === "script de instalação"));
  assert.ok(findings.some((item: { category: string }) => item.category === "ferramenta executada por npx sem versão"));
});

test("grava inventário, achados e relatório apenas em .ai-work/supply-chain", (t) => {
  const root = fixture(t);
  mkdirSync(join(root, ".ai-work", "supply-chain"), { recursive: true });
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "fixture", dependencies: { fixed: "1.0.0" } }));
  writeFileSync(join(root, "package-lock.json"), "{}\n");
  const inventory = inventoryDependencies(root);
  const findings = buildSupplyChainFindings(inventory);
  const outputDirectory = join(root, ".ai-work", "supply-chain", "20260826-1500");
  writeSupplyChainArtifacts({ repositoryRoot: root, outputDirectory, inventory, findings });
  assert.equal(JSON.parse(readFileSync(join(outputDirectory, "inventory.json"), "utf8")).manifests.length, 1);
  assert.ok(Array.isArray(JSON.parse(readFileSync(join(outputDirectory, "findings.json"), "utf8"))));
  assert.match(readFileSync(join(outputDirectory, "report.md"), "utf8"), /Atualizações aplicadas: NÃO/);
});

test("rejeita saída externa", (t) => {
  const root = fixture(t);
  assert.throws(
    () => writeSupplyChainArtifacts({
      repositoryRoot: root,
      outputDirectory: join(root, "fora"),
      inventory: { manifests: [], lockfiles: [], dockerfiles: [], workflows: [], duplicates: [], commands: [] },
      findings: [],
    }),
    /\.ai-work\/supply-chain/,
  );
});

test("não materializa credenciais embutidas em referências de dependência", (t) => {
  const root = fixture(t);
  writeFileSync(join(root, "package-lock.json"), "{}\n");
  writeFileSync(join(root, "package.json"), JSON.stringify({
    name: "fixture",
    dependencies: {
      privateTarball: "https://user:token@example.invalid/private.tgz?token=secret",
      privateGit: "git+https://user:token@example.invalid/private.git",
    },
    overrides: {
      package: "https://example.invalid/archive.tgz?secret=value",
    },
  }));
  const serialized = JSON.stringify(inventoryDependencies(root));
  assert.equal(serialized.includes("user:token"), false);
  assert.equal(serialized.includes("token=secret"), false);
  assert.equal(serialized.includes("secret=value"), false);
  assert.match(serialized, /\[URL REDACTED\]/);
  assert.match(serialized, /\[GIT REFERENCE REDACTED\]/);
});
