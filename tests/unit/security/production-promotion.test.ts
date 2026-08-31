import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { verifyProductionPromotion } from "../../../scripts/verify-production-promotion.mjs";

function git(cwd: string, ...args: string[]) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

async function fixture() {
  const cwd = await mkdtemp(path.join(tmpdir(), "coala-production-promotion-"));
  git(cwd, "init", "--initial-branch=production");
  git(cwd, "config", "user.email", "ci@coala.local");
  git(cwd, "config", "user.name", "Coala CI");
  await writeFile(path.join(cwd, "app.txt"), "production\n");
  git(cwd, "add", "app.txt");
  git(cwd, "commit", "-m", "base");
  const baseRef = git(cwd, "rev-parse", "HEAD");

  git(cwd, "switch", "-c", "main");
  await writeFile(path.join(cwd, "app.txt"), "verified main\n");
  await writeFile(path.join(cwd, "new.txt"), "new verified file\n");
  git(cwd, "add", "app.txt", "new.txt");
  git(cwd, "commit", "-m", "verified");
  const mainRef = git(cwd, "rev-parse", "HEAD");

  git(cwd, "switch", "-c", "rollout", baseRef);
  return { cwd, baseRef, mainRef };
}

test("aceita promoção cujos arquivos são idênticos ao main verificado", async (t) => {
  const { cwd, baseRef, mainRef } = await fixture();
  t.after(() => rm(cwd, { recursive: true, force: true }));
  await writeFile(path.join(cwd, "app.txt"), "verified main\n");
  await writeFile(path.join(cwd, "new.txt"), "new verified file\n");
  git(cwd, "add", "app.txt", "new.txt");
  git(cwd, "commit", "-m", "rollout");

  const result = verifyProductionPromotion({
    baseRef,
    headRef: "HEAD",
    mainRef,
    cwd,
  });
  assert.deepEqual(result.paths.sort(), ["app.txt", "new.txt"]);
});

test("bloqueia conteúdo de production que não passou por main", async (t) => {
  const { cwd, baseRef, mainRef } = await fixture();
  t.after(() => rm(cwd, { recursive: true, force: true }));
  await writeFile(path.join(cwd, "app.txt"), "mudança exclusiva do rollout\n");
  git(cwd, "add", "app.txt");
  git(cwd, "commit", "-m", "rollout divergente");

  assert.throws(
    () => verifyProductionPromotion({
      baseRef,
      headRef: "HEAD",
      mainRef,
      cwd,
    }),
    /app\.txt/,
  );
});

test("bloqueia promoção vazia", async (t) => {
  const { cwd, baseRef, mainRef } = await fixture();
  t.after(() => rm(cwd, { recursive: true, force: true }));

  assert.throws(
    () => verifyProductionPromotion({
      baseRef,
      headRef: baseRef,
      mainRef,
      cwd,
    }),
    /não altera nenhum arquivo/,
  );
});
