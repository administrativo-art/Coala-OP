#!/usr/bin/env node

import { existsSync } from "node:fs";
import { basename, join, resolve, sep } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export function sanitizeSlug(value) {
  const slug = String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return slug || "issue";
}

export function resolveRepositoryRoot(cwd = process.cwd()) {
  return execFileSync("git", ["rev-parse", "--show-toplevel"], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

export function createIssueOutputPath({ repositoryRoot, slug, date = new Date(), exists = existsSync }) {
  const root = resolve(repositoryRoot);
  const datePrefix = typeof date === "string" ? date : date.toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(datePrefix)) {
    throw new Error("Data inválida; use YYYY-MM-DD.");
  }

  const directory = join(root, ".ai-work", "issues");
  const safeSlug = sanitizeSlug(slug);
  let sequence = 1;
  let candidate = join(directory, `${datePrefix}-${safeSlug}.md`);
  while (exists(candidate)) {
    sequence += 1;
    candidate = join(directory, `${datePrefix}-${safeSlug}-${sequence}.md`);
  }

  const relative = candidate.slice(root.length + 1);
  if (candidate !== root && !candidate.startsWith(`${root}${sep}`)) {
    throw new Error("O caminho calculado saiu do repositório.");
  }
  return { absolutePath: candidate, relativePath: relative, fileName: basename(candidate) };
}

function parseArguments(argv) {
  const args = [...argv];
  const slug = args.shift();
  let repositoryRoot;
  let date;
  while (args.length) {
    const flag = args.shift();
    if (flag === "--root") repositoryRoot = args.shift();
    else if (flag === "--date") date = args.shift();
    else throw new Error(`Argumento desconhecido: ${flag}`);
  }
  if (!slug) throw new Error("Informe um slug para o rascunho.");
  return { slug, repositoryRoot, date };
}

function isMain() {
  return process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

if (isMain()) {
  try {
    const options = parseArguments(process.argv.slice(2));
    const repositoryRoot = options.repositoryRoot ? resolve(options.repositoryRoot) : resolveRepositoryRoot();
    const output = createIssueOutputPath({ repositoryRoot, slug: options.slug, date: options.date });
    process.stdout.write(`${output.relativePath}\n`);
  } catch (error) {
    console.error(`Não foi possível calcular o caminho do rascunho: ${error.message}`);
    process.exitCode = 1;
  }
}
