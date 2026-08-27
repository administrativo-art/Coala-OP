#!/usr/bin/env node

import { existsSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

function safeSlug(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "handoff";
}

function gitRoot(cwd) {
  return execFileSync("git", ["rev-parse", "--show-toplevel"], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function timePrefix(date) {
  return date.toISOString().slice(0, 16).replace(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/, "$1-$2-$3-$4$5");
}

export function createHandoffOutputPath({ repositoryRoot, slug, date = new Date(), exists = existsSync }) {
  const root = resolve(repositoryRoot);
  const directory = join(root, ".ai-work", "handoffs");
  const prefix = `${timePrefix(date)}-${safeSlug(slug)}`;
  let sequence = 1;
  let candidate = join(directory, `${prefix}.md`);
  while (exists(candidate)) candidate = join(directory, `${prefix}-${++sequence}.md`);
  return { absolutePath: candidate, relativePath: relative(root, candidate) };
}

function isMain() {
  return process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

if (isMain()) {
  const slug = process.argv[2];
  if (!slug) {
    console.error("Informe um slug para o handoff.");
    process.exitCode = 1;
  } else {
    try {
      const output = createHandoffOutputPath({ repositoryRoot: gitRoot(process.cwd()), slug });
      process.stdout.write(`${output.relativePath}\n`);
    } catch (error) {
      console.error(`Não foi possível calcular o caminho do handoff: ${error.message}`);
      process.exitCode = 1;
    }
  }
}
