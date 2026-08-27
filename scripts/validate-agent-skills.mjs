#!/usr/bin/env node

import { existsSync, lstatSync, readFileSync, readlinkSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const skillRoot = join(repositoryRoot, ".agents", "skills", "coala-error-triage");
const requiredFiles = [
  "SKILL.md",
  "agents/openai.yaml",
  "evals/cases.json",
  "scripts/triage-errors.mjs",
];

for (const relativePath of requiredFiles) {
  const path = join(skillRoot, relativePath);
  if (!existsSync(path)) throw new Error(`Arquivo obrigatório ausente: ${relativePath}`);
}

const skill = readFileSync(join(skillRoot, "SKILL.md"), "utf8");
for (const expected of [
  "name: coala-error-triage",
  "disable-model-invocation: true",
  "user-invocable: true",
  "Use somente por invocação explícita",
]) {
  if (!skill.includes(expected)) throw new Error(`Contrato ausente no SKILL.md: ${expected}`);
}
if (/TODO|PLACEHOLDER|TBD/.test(skill)) throw new Error("SKILL.md contém placeholder não resolvido.");

const openai = readFileSync(join(skillRoot, "agents", "openai.yaml"), "utf8");
if (!openai.includes("allow_implicit_invocation: false")) {
  throw new Error("A skill operacional deve permanecer com invocação explícita.");
}
if (!openai.includes("$coala-error-triage")) {
  throw new Error("default_prompt deve mencionar $coala-error-triage.");
}

const cases = JSON.parse(readFileSync(join(skillRoot, "evals", "cases.json"), "utf8"));
if (!Array.isArray(cases) || cases.length < 2) throw new Error("Evals da skill estão ausentes ou incompletos.");

const claudeEntry = join(repositoryRoot, ".claude", "skills", "coala-error-triage");
if (!existsSync(claudeEntry) || !lstatSync(claudeEntry).isSymbolicLink()) {
  throw new Error("Entrada Claude deve ser symlink para a implementação canônica.");
}
const linkTarget = resolve(dirname(claudeEntry), readlinkSync(claudeEntry));
if (realpathSync(linkTarget) !== realpathSync(skillRoot)) {
  throw new Error("Entrada Claude não aponta para .agents/skills/coala-error-triage.");
}

process.stdout.write("Skill coala-error-triage validada.\n");
