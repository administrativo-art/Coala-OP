#!/usr/bin/env node

import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const COVERAGE_STATES = new Set([
  "NOT_REVIEWED",
  "STATIC_REVIEWED",
  "TEST_PLANNED",
  "DYNAMIC_TESTED",
  "INCONCLUSIVE",
  "OUT_OF_SCOPE"
]);
const FINDING_STATES = new Set(["CONFIRMED", "POTENTIAL", "INCONCLUSIVE", "NOT_TESTED"]);
const SEVERITIES = new Set(["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFORMATIONAL"]);

function isInside(root, candidate) {
  const value = relative(root, candidate);
  return value === "" || (!value.startsWith("..") && !isAbsolute(value) && !value.split(sep).includes(".."));
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`JSON inválido em ${path}: ${error.message}`);
  }
}

function assertVersionedList(document, name) {
  if (document?.schemaVersion !== 1 || !Array.isArray(document.items)) {
    throw new Error(`${name} deve usar schemaVersion 1 e items como array.`);
  }
}

function assertUniqueIds(items, name) {
  const ids = new Set();
  for (const item of items) {
    const id = String(item?.id ?? "").trim();
    if (!id) throw new Error(`${name} contém item sem id.`);
    if (ids.has(id)) throw new Error(`${name} contém id duplicado: ${id}.`);
    ids.add(id);
  }
}

function assertPlainDirectory(path, label) {
  if (!existsSync(path)) throw new Error(`${label} não existe.`);
  const stat = lstatSync(path);
  if (stat.isSymbolicLink()) throw new Error(`${label} não pode ser link simbólico.`);
  if (!stat.isDirectory()) throw new Error(`${label} deve ser diretório.`);
}

export function validateAuditRun(runDirectory, repositoryRoot = process.cwd()) {
  const root = realpathSync(resolve(repositoryRoot));
  const aiWork = join(root, ".ai-work");
  const base = join(aiWork, "security-audit");
  const requestedDirectory = resolve(runDirectory);
  if (!isInside(base, requestedDirectory) || requestedDirectory === base) {
    throw new Error("Diretório deve ser uma execução dentro de .ai-work/security-audit.");
  }
  assertPlainDirectory(aiWork, ".ai-work");
  assertPlainDirectory(base, ".ai-work/security-audit");
  assertPlainDirectory(requestedDirectory, "Diretório da auditoria");
  const directory = realpathSync(requestedDirectory);
  const physicalBase = realpathSync(base);
  if (!isInside(physicalBase, directory) || directory === physicalBase) {
    throw new Error("Diretório resolvido deve permanecer em .ai-work/security-audit.");
  }

  const required = [
    "scope.json",
    "inventory.json",
    "coverage.json",
    "hypotheses.json",
    "findings.json",
    "test-plan.md",
    "report.md"
  ];
  for (const name of required) {
    const path = join(directory, name);
    if (!existsSync(path)) throw new Error(`Artefato obrigatório ausente: ${name}.`);
    const stat = lstatSync(path);
    if (stat.isSymbolicLink() || !stat.isFile()) {
      throw new Error(`Artefato obrigatório deve ser arquivo regular: ${name}.`);
    }
  }

  const scope = readJson(join(directory, "scope.json"));
  if (scope?.schemaVersion !== 1 || !scope.auditId || !scope.repository || !scope.authorization) {
    throw new Error("scope.json incompleto ou incompatível.");
  }
  if (scope.auditId !== basename(directory)) {
    throw new Error("auditId de scope.json deve corresponder ao diretório da auditoria.");
  }
  for (const key of ["staticAnalysis", "localDynamicTesting", "externalNetwork", "productionTesting", "codeChanges"]) {
    if (typeof scope.authorization[key] !== "boolean") throw new Error(`Autorização inválida: ${key}.`);
  }
  for (const key of ["allowedTargets", "allowedAccounts", "stopConditions", "prohibitedActions"]) {
    if (!Array.isArray(scope.authorization[key])) throw new Error(`Escopo inválido: ${key} deve ser array.`);
  }

  const inventory = readJson(join(directory, "inventory.json"));
  const coverage = readJson(join(directory, "coverage.json"));
  const hypotheses = readJson(join(directory, "hypotheses.json"));
  const findings = readJson(join(directory, "findings.json"));
  for (const [name, document] of Object.entries({ inventory, coverage, hypotheses, findings })) {
    assertVersionedList(document, name);
    assertUniqueIds(document.items, name);
  }

  for (const item of coverage.items) {
    if (!item.surface || !COVERAGE_STATES.has(item.status)) {
      throw new Error(`Cobertura ${item.id} precisa de surface e status válido.`);
    }
    if (item.status === "DYNAMIC_TESTED" && (!Array.isArray(item.evidence) || item.evidence.length === 0)) {
      throw new Error(`Cobertura dinâmica ${item.id} não possui evidência.`);
    }
  }

  for (const finding of findings.items) {
    if (!FINDING_STATES.has(finding.status) || !SEVERITIES.has(finding.severity)) {
      throw new Error(`Achado ${finding.id} possui status ou severidade inválidos.`);
    }
    if (!finding.title || !finding.location || !finding.description) {
      throw new Error(`Achado ${finding.id} está sem título, localização ou descrição.`);
    }
    if (finding.status === "CONFIRMED" && (!Array.isArray(finding.evidence) || finding.evidence.length === 0)) {
      throw new Error(`Achado confirmado ${finding.id} não possui evidência.`);
    }
  }

  if (!scope.authorization.localDynamicTesting && coverage.items.some((item) => item.status === "DYNAMIC_TESTED")) {
    throw new Error("Há cobertura dinâmica, mas scope.json não autoriza teste local.");
  }

  for (const name of ["test-plan.md", "report.md"]) {
    if (!readFileSync(join(directory, name), "utf8").trim()) throw new Error(`${name} está vazio.`);
  }

  return {
    auditId: scope.auditId,
    inventoryItems: inventory.items.length,
    coverageItems: coverage.items.length,
    hypothesisItems: hypotheses.items.length,
    findingItems: findings.items.length
  };
}

function isMain() {
  return process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

if (isMain()) {
  try {
    const runDirectory = process.argv[2];
    if (!runDirectory) throw new Error("Informe o diretório da auditoria.");
    const result = validateAuditRun(runDirectory);
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  }
}
