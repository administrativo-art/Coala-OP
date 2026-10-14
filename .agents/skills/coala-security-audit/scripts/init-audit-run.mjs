#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

function isInside(root, candidate) {
  const value = relative(root, candidate);
  return value === "" || (!value.startsWith("..") && !isAbsolute(value) && !value.split(sep).includes(".."));
}

function timestamp(date = new Date()) {
  return date.toISOString().replace(/\.\d{3}Z$/, "Z").replace(/[-:]/g, "").replace("T", "-").replace("Z", "");
}

function gitValue(root, args) {
  try {
    return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() || null;
  } catch {
    return null;
  }
}

export function validateAuditId(value) {
  const id = String(value ?? "").trim();
  if (!/^[a-z0-9][a-z0-9._-]{2,63}$/i.test(id)) {
    throw new Error("ID deve ter 3–64 caracteres alfanuméricos, ponto, hífen ou sublinhado.");
  }
  return id;
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
}

function assertSafeDirectory(path, label) {
  if (!existsSync(path)) return;
  const stat = lstatSync(path);
  if (stat.isSymbolicLink()) throw new Error(`${label} não pode ser link simbólico.`);
  if (!stat.isDirectory()) throw new Error(`${label} deve ser diretório.`);
}

/**
 * @param {{ repositoryRoot?: string; auditId?: string; now?: Date }} [options]
 */
export function createAuditRun({ repositoryRoot = process.cwd(), auditId, now = new Date() } = {}) {
  const root = realpathSync(resolve(repositoryRoot));
  const id = validateAuditId(auditId ?? timestamp(now));
  const aiWork = join(root, ".ai-work");
  const base = join(aiWork, "security-audit");
  const outputDirectory = resolve(base, id);
  if (!isInside(base, outputDirectory)) throw new Error("Saída deve permanecer em .ai-work/security-audit.");
  if (existsSync(outputDirectory)) throw new Error(`Auditoria já existe: ${id}`);

  assertSafeDirectory(aiWork, ".ai-work");
  assertSafeDirectory(base, ".ai-work/security-audit");
  mkdirSync(base, { recursive: true, mode: 0o700 });
  assertSafeDirectory(aiWork, ".ai-work");
  assertSafeDirectory(base, ".ai-work/security-audit");
  mkdirSync(outputDirectory, { recursive: false, mode: 0o700 });
  const createdAt = now.toISOString();
  const repository = {
    root,
    branch: gitValue(root, ["branch", "--show-current"]),
    revision: gitValue(root, ["rev-parse", "HEAD"]),
    statusCaptured: false,
  };
  const scope = {
    schemaVersion: 1,
    auditId: id,
    createdAt,
    repository,
    authorization: {
      staticAnalysis: true,
      localDynamicTesting: false,
      externalNetwork: false,
      productionTesting: false,
      codeChanges: false,
      allowedTargets: [],
      allowedAccounts: [],
      maxConcurrency: 1,
      maxRequestsPerSecond: null,
      stopConditions: [
        "real data or active credentials are encountered",
        "a target outside the recorded scope is reached",
        "a test causes an unplanned persistent effect"
      ],
      prohibitedActions: [
        "production testing",
        "denial of service",
        "brute force",
        "real-data exfiltration",
        "persistence",
        "code or infrastructure changes"
      ]
    },
    standards: {
      resolvedAt: null,
      references: []
    },
    notes: []
  };

  writeJson(join(outputDirectory, "scope.json"), scope);
  writeJson(join(outputDirectory, "inventory.json"), { schemaVersion: 1, generatedAt: null, items: [] });
  writeJson(join(outputDirectory, "coverage.json"), { schemaVersion: 1, items: [] });
  writeJson(join(outputDirectory, "hypotheses.json"), { schemaVersion: 1, items: [] });
  writeJson(join(outputDirectory, "findings.json"), { schemaVersion: 1, items: [] });
  writeFileSync(join(outputDirectory, "test-plan.md"), "# Plano de testes\n\nNenhum teste dinâmico autorizado ou planejado ainda.\n", { mode: 0o600 });
  writeFileSync(join(outputDirectory, "report.md"), [
    "# Auditoria de segurança — diagnóstico inicial",
    "",
    `- ID: ${id}`,
    `- Criada em: ${createdAt}`,
    `- Branch: ${repository.branch ?? "indisponível"}`,
    `- Revisão: ${repository.revision ?? "indisponível"}`,
    "- Alterações de produto autorizadas: NÃO",
    "- Testes em produção autorizados: NÃO",
    "",
    "## Estado",
    "",
    "Escopo e cobertura ainda precisam ser preenchidos antes de qualquer conclusão.",
    "",
    "## Limitações",
    "",
    "Nenhuma superfície foi validada apenas pela criação deste registro.",
    ""
  ].join("\n"), { mode: 0o600 });

  return { auditId: id, outputDirectory, scope };
}

function parseArgs(args) {
  const output = {};
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (value === "--root") output.repositoryRoot = args[++index];
    else if (value === "--id") output.auditId = args[++index];
    else throw new Error(`Argumento desconhecido: ${value}`);
  }
  return output;
}

function isMain() {
  return process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

if (isMain()) {
  try {
    const result = createAuditRun(parseArgs(process.argv.slice(2)));
    process.stdout.write(`${result.outputDirectory}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  }
}
