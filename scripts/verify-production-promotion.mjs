#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import process from "node:process";
import { pathToFileURL } from "node:url";

function defaultRunGit(args, cwd) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function requiredRef(value, label) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} não informado.`);
  }
  return value.trim();
}

function verifyCommit(runGit, cwd, ref, label) {
  try {
    runGit(["rev-parse", "--verify", `${ref}^{commit}`], cwd);
  } catch {
    throw new Error(`${label} não aponta para um commit Git válido: ${ref}.`);
  }
}

function objectId(runGit, cwd, ref, filePath) {
  try {
    return runGit(["rev-parse", "--verify", `${ref}:${filePath}`], cwd).trim();
  } catch {
    return null;
  }
}

export function verifyProductionPromotion({
  baseRef,
  headRef,
  mainRef = "origin/main",
  cwd = process.cwd(),
  runGit = defaultRunGit,
}) {
  const base = requiredRef(baseRef, "Commit base de production");
  const head = requiredRef(headRef, "Commit candidato a production");
  const main = requiredRef(mainRef, "Referência verificada de main");
  verifyCommit(runGit, cwd, base, "Base de production");
  verifyCommit(runGit, cwd, head, "Candidato a production");
  verifyCommit(runGit, cwd, main, "Main");

  const paths = runGit(["diff", "--name-only", "-z", base, head], cwd)
    .split("\0")
    .filter(Boolean);
  if (!paths.length) {
    throw new Error("A promoção não altera nenhum arquivo em relação a production.");
  }

  const mismatches = paths.filter((filePath) =>
    objectId(runGit, cwd, head, filePath) !== objectId(runGit, cwd, main, filePath)
  );
  if (mismatches.length) {
    throw new Error(
      "A promoção contém arquivos cujo conteúdo não corresponde ao main verificado:\n"
      + mismatches.map((filePath) => `- ${filePath}`).join("\n"),
    );
  }

  return { changedFiles: paths.length, paths };
}

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!["--base", "--head", "--main"].includes(argument)) {
      throw new Error(`Argumento desconhecido: ${argument}.`);
    }
    const value = argv[index + 1];
    if (!value) throw new Error(`Valor ausente para ${argument}.`);
    values[argument.slice(2)] = value;
    index += 1;
  }
  return values;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const args = parseArgs(process.argv.slice(2));
    const result = verifyProductionPromotion({
      baseRef: args.base,
      headRef: args.head,
      mainRef: args.main,
    });
    process.stdout.write(
      `Promoção validada: ${result.changedFiles} arquivo(s) idêntico(s) ao main.\n`,
    );
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
