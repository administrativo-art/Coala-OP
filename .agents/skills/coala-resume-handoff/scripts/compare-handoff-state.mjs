#!/usr/bin/env node

import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { collectGitState } from "../../coala-handoff/scripts/collect-git-state.mjs";
import {
  extractSection,
  validateHandoffMarkdown,
} from "../../coala-handoff/scripts/validate-handoff.mjs";

export const CLASSIFICATIONS = {
  compatible: "COMPATÍVEL",
  nonBlocking: "DIVERGÊNCIA NÃO BLOQUEANTE",
  blocking: "DIVERGÊNCIA BLOQUEANTE",
  invalid: "HANDOFF INVÁLIDO",
};

function isInside(root, candidate) {
  const value = relative(root, candidate);
  return value === "" || (!value.startsWith("..") && !isAbsolute(value) && !value.split(sep).includes(".."));
}

function resolveGitRoot(cwd) {
  return execFileSync("git", ["rev-parse", "--show-toplevel"], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function gitIsAncestor(root, base, head) {
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", base, head], {
      cwd: root,
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

export function validateHandoffPath({ repositoryRoot, handoffPath }) {
  const root = realpathSync(repositoryRoot);
  const requested = resolve(root, handoffPath);
  if (!isInside(root, requested)) throw new Error("Path traversal ou arquivo fora do repositório.");
  if (!existsSync(requested)) throw new Error("Arquivo de handoff inexistente.");
  const stat = lstatSync(requested);
  const real = realpathSync(requested);
  if (!isInside(root, real)) throw new Error("Symlink do handoff resolve para fora do workspace.");
  if (!stat.isFile() && !stat.isSymbolicLink()) throw new Error("O handoff não é um arquivo regular.");
  return real;
}

export function extractReferencedFiles(markdown) {
  const section = extractSection(markdown, "Arquivos modificados") ?? "";
  const files = [];
  for (const match of section.matchAll(/`([^`]+)`/g)) {
    const value = match[1].trim();
    if (value && !value.includes(" ") && !value.startsWith("/") && !value.includes("..")) files.push(value);
  }
  return [...new Set(files)];
}

/**
 * @param {{ repositoryRoot: string, handoffPath: string, gitState?: any }} options
 */
export function compareHandoffState({ repositoryRoot, handoffPath, gitState }) {
  let realPath;
  try {
    realPath = validateHandoffPath({ repositoryRoot, handoffPath });
  } catch (error) {
    return { classification: CLASSIFICATIONS.invalid, reasons: [error.message] };
  }

  const markdown = readFileSync(realPath, "utf8");
  const validation = validateHandoffMarkdown(markdown);
  if (!validation.valid) {
    return { classification: CLASSIFICATIONS.invalid, reasons: validation.errors };
  }

  const state = gitState ?? collectGitState(repositoryRoot);
  const blocking = [];
  const nonBlocking = [];
  const metadata = validation.metadata;

  if (metadata.branch !== state.branch) {
    blocking.push(`Branch divergente: handoff=${metadata.branch}; atual=${state.branch}.`);
  }
  if (metadata.base_commit !== state.head) {
    if (gitIsAncestor(repositoryRoot, metadata.base_commit, state.head)) {
      nonBlocking.push("O HEAD atual contém commits posteriores ao handoff.");
    } else {
      blocking.push("O commit base do handoff não é ancestral do HEAD atual.");
    }
  }

  const expectedDirty = metadata.working_tree_dirty === true || metadata.working_tree_dirty === "true";
  if (expectedDirty !== state.workingTreeDirty) {
    nonBlocking.push("O estado limpo/sujo da working tree mudou desde o handoff.");
  }
  if (metadata.status_fingerprint && metadata.status_fingerprint !== state.statusFingerprint) {
    nonBlocking.push("A lista de alterações da working tree mudou desde o handoff.");
  }

  for (const file of extractReferencedFiles(validation.body)) {
    const candidate = resolve(repositoryRoot, file);
    if (!isInside(resolve(repositoryRoot), candidate) || !existsSync(candidate)) {
      blocking.push(`Arquivo citado não está disponível: ${file}.`);
    }
  }

  if (blocking.length) {
    return { classification: CLASSIFICATIONS.blocking, reasons: [...blocking, ...nonBlocking], gitState: state };
  }
  if (nonBlocking.length) {
    return { classification: CLASSIFICATIONS.nonBlocking, reasons: nonBlocking, gitState: state };
  }
  return { classification: CLASSIFICATIONS.compatible, reasons: ["Branch, commit e working tree correspondem ao handoff."], gitState: state };
}

function isMain() {
  return process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

if (isMain()) {
  const input = process.argv[2];
  if (!input) {
    console.error("Informe o caminho do handoff que deve ser comparado.");
    process.exitCode = 1;
  } else {
    try {
      const root = resolveGitRoot(process.cwd());
      const result = compareHandoffState({ repositoryRoot: root, handoffPath: input });
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      if (result.classification === CLASSIFICATIONS.invalid || result.classification === CLASSIFICATIONS.blocking) {
        process.exitCode = 2;
      }
    } catch (error) {
      console.error(`Não foi possível comparar o handoff: ${error.message}`);
      process.exitCode = 1;
    }
  }
}
