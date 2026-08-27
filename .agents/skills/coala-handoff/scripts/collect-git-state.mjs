#!/usr/bin/env node

import { createHash } from "node:crypto";
import { basename, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

function git(args, cwd, { optional = false } = {}) {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).replace(/\s+$/, "");
  } catch (error) {
    if (optional) return null;
    const detail = error.stderr?.toString().trim();
    throw new Error(detail || `git ${args.join(" ")} falhou.`);
  }
}

function parsePorcelainZ(value) {
  if (!value) return [];
  const chunks = value.split("\0").filter(Boolean);
  const files = [];
  for (let index = 0; index < chunks.length; index += 1) {
    const entry = chunks[index];
    const status = entry.slice(0, 2);
    const path = entry.slice(3);
    const item = { status, path };
    if (status.includes("R") || status.includes("C")) item.originalPath = chunks[++index];
    files.push(item);
  }
  return files;
}

export function collectGitState(cwd = process.cwd(), now = new Date()) {
  const repositoryRoot = git(["rev-parse", "--show-toplevel"], cwd);
  const branch = git(["symbolic-ref", "--quiet", "--short", "HEAD"], repositoryRoot, { optional: true }) ?? "DETACHED";
  const head = git(["rev-parse", "HEAD"], repositoryRoot);
  const statusShort = git(["status", "--short"], repositoryRoot, { optional: true }) ?? "";
  const porcelainZ = git(["status", "--porcelain=v1", "-z"], repositoryRoot, { optional: true }) ?? "";
  const files = parsePorcelainZ(porcelainZ);
  const upstream = git(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"], repositoryRoot, {
    optional: true,
  });

  return {
    repositoryRoot,
    repository: basename(repositoryRoot),
    branch,
    head,
    upstream,
    collectedAt: now.toISOString(),
    workingTreeDirty: files.length > 0,
    statusShort,
    statusFingerprint: createHash("sha256").update(statusShort).digest("hex"),
    diffStat: git(["diff", "--stat"], repositoryRoot, { optional: true }) ?? "",
    stagedDiffStat: git(["diff", "--cached", "--stat"], repositoryRoot, { optional: true }) ?? "",
    changedFiles: files,
    untrackedFiles: files.filter((item) => item.status === "??").map((item) => item.path),
  };
}

function isMain() {
  return process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

if (isMain()) {
  try {
    process.stdout.write(`${JSON.stringify(collectGitState(), null, 2)}\n`);
  } catch (error) {
    console.error(`Não foi possível coletar o estado do Git: ${error.message}`);
    process.exitCode = 1;
  }
}
