#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

export const SECURITY_CONTRACT_BASELINE_SCHEMA_VERSION = 1;
export const SECURITY_CONTRACT_EXCEPTION_SCHEMA_VERSION = 1;
export const HTTP_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]);
export const CANONICAL_SECURE_ROUTE_MODULES = new Set([
  "@/lib/security/secure-route.server",
  "@/lib/security/index.server",
]);

function hasExportModifier(node) {
  return node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) === true;
}

function unwrapExpression(expression) {
  let current = expression;
  while (
    current &&
    (ts.isParenthesizedExpression(current) || ts.isAsExpression(current) || ts.isSatisfiesExpression(current))
  ) {
    current = current.expression;
  }
  return current;
}

function isSecureRouteCall(expression, secureRouteIdentifiers) {
  const current = unwrapExpression(expression);
  return Boolean(
    current &&
    ts.isCallExpression(current) &&
    ts.isIdentifier(current.expression) &&
    secureRouteIdentifiers.has(current.expression.text),
  );
}

export function parseRouteMethods(source, fileName = "route.ts") {
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const methods = new Map();
  const secureRouteIdentifiers = new Set();

  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    if (!CANONICAL_SECURE_ROUTE_MODULES.has(statement.moduleSpecifier.text)) continue;
    const bindings = statement.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    for (const element of bindings.elements) {
      if ((element.propertyName?.text ?? element.name.text) === "secureRoute") {
        secureRouteIdentifiers.add(element.name.text);
      }
    }
  }

  for (const statement of sourceFile.statements) {
    if (!hasExportModifier(statement)) continue;
    if (ts.isFunctionDeclaration(statement) && statement.name && HTTP_METHODS.has(statement.name.text)) {
      methods.set(statement.name.text, { method: statement.name.text, contracted: false });
      continue;
    }
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || !HTTP_METHODS.has(declaration.name.text)) continue;
      methods.set(declaration.name.text, {
        method: declaration.name.text,
        contracted: isSecureRouteCall(declaration.initializer, secureRouteIdentifiers),
      });
    }
  }

  return [...methods.values()].sort((left, right) => left.method.localeCompare(right.method));
}

function walk(directory) {
  if (!existsSync(directory)) return [];
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...walk(path));
    else if (entry.isFile() && /^route\.(?:ts|tsx|js|jsx)$/.test(entry.name)) files.push(path);
  }
  return files;
}

function routePath(source) {
  const parts = source.split("/").slice(3, -1).filter((part) => !(part.startsWith("(") && part.endsWith(")")));
  return `/api/${parts.join("/")}`;
}

function sourceDigest(source) {
  return createHash("sha256").update(source.replaceAll("\r\n", "\n")).digest("hex");
}

export function scanApiRoutes(repositoryRoot) {
  const root = resolve(repositoryRoot);
  return walk(join(root, "src", "app", "api"))
    .map((path) => {
      const source = readFileSync(path, "utf8");
      const relativeSource = relative(root, path).replaceAll("\\", "/");
      return {
        source: relativeSource,
        route: routePath(relativeSource),
        sha256: sourceDigest(source),
        methods: parseRouteMethods(source, relativeSource),
      };
    })
    .sort((left, right) => left.route.localeCompare(right.route) || left.source.localeCompare(right.source));
}

export function createSecurityContractBaseline(repositoryRoot, sourceRevision = "unknown") {
  return {
    schemaVersion: SECURITY_CONTRACT_BASELINE_SCHEMA_VERSION,
    sourceRevision,
    note: "Dívida estrutural congelada; presença no baseline não aprova autenticação ou autorização.",
    routes: scanApiRoutes(repositoryRoot).map((route) => ({
      source: route.source,
      route: route.route,
      sha256: route.sha256,
      methods: route.methods.map((method) => method.method),
    })),
  };
}

function readJson(path, label) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`${label} inválido: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function validateBaseline(document) {
  if (document?.schemaVersion !== SECURITY_CONTRACT_BASELINE_SCHEMA_VERSION || !Array.isArray(document.routes)) {
    throw new Error("Baseline de contratos de segurança incompatível.");
  }
  const seen = new Set();
  for (const route of document.routes) {
    if (!route?.source || !route?.route || !/^[a-f0-9]{64}$/.test(route.sha256) || !Array.isArray(route.methods)) {
      throw new Error("Entrada inválida no baseline de contratos de segurança.");
    }
    if (seen.has(route.source)) throw new Error(`Rota duplicada no baseline: ${route.source}.`);
    if (route.methods.some((method) => !HTTP_METHODS.has(method))) {
      throw new Error(`Método inválido no baseline: ${route.source}.`);
    }
    seen.add(route.source);
  }
  return document;
}

export function validateSecurityContractExceptions(document, now = new Date()) {
  if (document?.schemaVersion !== SECURITY_CONTRACT_EXCEPTION_SCHEMA_VERSION || !Array.isArray(document.exceptions)) {
    throw new Error("Arquivo de exceções de contrato de segurança incompatível.");
  }
  const seen = new Set();
  return document.exceptions.map((exception) => {
    const source = String(exception?.source ?? "").trim();
    const methods = Array.isArray(exception?.methods) ? [...new Set(exception.methods)] : [];
    const owner = String(exception?.owner ?? "").trim();
    const reason = String(exception?.reason ?? "").trim();
    const expiresAt = String(exception?.expiresAt ?? "").trim();
    if (!source.startsWith("src/app/api/") || !/\/route\.(?:ts|tsx|js|jsx)$/.test(source)) {
      throw new Error(`Exceção possui source inválido: ${source || "ausente"}.`);
    }
    if (methods.length === 0 || methods.some((method) => !HTTP_METHODS.has(method))) {
      throw new Error(`Exceção ${source} precisa de métodos HTTP válidos.`);
    }
    if (!owner || reason.length < 12 || !/^\d{4}-\d{2}-\d{2}$/.test(expiresAt)) {
      throw new Error(`Exceção ${source} precisa de owner, justificativa e expiração.`);
    }
    const expiration = Date.parse(`${expiresAt}T23:59:59.999Z`);
    if (Number.isNaN(expiration) || expiration < now.getTime()) {
      throw new Error(`Exceção expirada ou inválida: ${source} (${expiresAt}).`);
    }
    for (const method of methods) {
      const key = `${source}:${method}`;
      if (seen.has(key)) throw new Error(`Exceção duplicada ou sobreposta: ${key}.`);
      seen.add(key);
    }
    return { source, methods, owner, reason, expiresAt };
  });
}

export function evaluateSecurityContracts({ routes, baseline, exceptionDocument, now = new Date() }) {
  validateBaseline(baseline);
  const exceptions = validateSecurityContractExceptions(exceptionDocument, now);
  const baselineBySource = new Map(baseline.routes.map((entry) => [entry.source, entry]));
  const exceptionsBySource = new Map();
  for (const exception of exceptions) {
    const existing = exceptionsBySource.get(exception.source) ?? [];
    existing.push(exception);
    exceptionsBySource.set(exception.source, existing);
  }

  const results = [];
  for (const route of routes) {
    const unsecuredMethods = route.methods.filter((method) => !method.contracted).map((method) => method.method);
    const baselineEntry = baselineBySource.get(route.source);
    const matchingBaseline = baselineEntry?.sha256 === route.sha256;
    const routeExceptions = exceptionsBySource.get(route.source) ?? [];
    const unsecuredMethodSet = new Set(unsecuredMethods);
    const invalidExceptionMethods = routeExceptions
      .flatMap((exception) => exception.methods)
      .filter((method) => !unsecuredMethodSet.has(method));
    if (invalidExceptionMethods.length > 0) {
      throw new Error(`Exceção obsoleta em ${route.source}: ${[...new Set(invalidExceptionMethods)].join(", ")}.`);
    }
    if (matchingBaseline && routeExceptions.length > 0) {
      throw new Error(`Exceção desnecessária para rota legada intacta: ${route.source}.`);
    }
    const exceptedMethods = new Set(routeExceptions.flatMap((exception) => exception.methods));
    const uncoveredMethods = unsecuredMethods.filter((method) => !exceptedMethods.has(method));

    let status;
    if (route.methods.length === 0) status = "VIOLATION";
    else if (unsecuredMethods.length === 0) status = "CONTRACTED";
    else if (matchingBaseline) status = "LEGACY_BASELINE";
    else if (uncoveredMethods.length === 0) status = "EXCEPTION";
    else status = "VIOLATION";

    results.push({
      ...route,
      status,
      unsecuredMethods,
      uncoveredMethods,
      exceptions: routeExceptions,
    });
  }

  const currentSources = new Set(routes.map((route) => route.source));
  const removedLegacy = baseline.routes.filter((entry) => !currentSources.has(entry.source));
  const staleExceptions = exceptions.filter((exception) => !currentSources.has(exception.source));
  if (staleExceptions.length > 0) {
    throw new Error(`Exceções sem rota correspondente: ${staleExceptions.map((item) => item.source).join(", ")}.`);
  }
  return { results, removedLegacy };
}

export function loadSecurityContractState(repositoryRoot, now = new Date()) {
  const root = resolve(repositoryRoot);
  const baseline = readJson(join(root, "config", "security-contract-baseline.json"), "Baseline");
  const exceptionDocument = readJson(join(root, "config", "security-contract-exceptions.json"), "Exceções");
  return evaluateSecurityContracts({
    routes: scanApiRoutes(root),
    baseline,
    exceptionDocument,
    now,
  });
}

function repositoryRevision(root) {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

function isMain() {
  return process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

if (isMain()) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const baselinePath = join(root, "config", "security-contract-baseline.json");
  try {
    if (process.argv.includes("--write-baseline")) {
      const baseline = createSecurityContractBaseline(root, repositoryRevision(root));
      writeFileSync(baselinePath, `${JSON.stringify(baseline, null, 2)}\n`, { flag: "w" });
      process.stdout.write(`Baseline de contratos gravado com ${baseline.routes.length} arquivo(s) de rota.\n`);
    } else {
      const { results, removedLegacy } = loadSecurityContractState(root);
      const violations = results.filter((route) => route.status === "VIOLATION");
      const contracted = results.filter((route) => route.status === "CONTRACTED").length;
      const legacy = results.filter((route) => route.status === "LEGACY_BASELINE").length;
      const excepted = results.filter((route) => route.status === "EXCEPTION").length;
      process.stdout.write(`Contratos de segurança: ${contracted} contratada(s), ${legacy} legada(s) congelada(s), ${excepted} exceção(ões), ${violations.length} violação(ões).\n`);
      if (removedLegacy.length > 0) {
        process.stdout.write(`Melhoria estrutural: ${removedLegacy.length} entrada(s) legada(s) removida(s); regenere o baseline apenas em revisão dedicada.\n`);
      }
      if (violations.length > 0) {
        for (const route of violations) {
          const detail = route.methods.length === 0
            ? "nenhum método HTTP reconhecido"
            : `métodos sem contrato: ${route.uncoveredMethods.join(", ")}`;
          process.stderr.write(`- ${route.source}: ${detail}\n`);
        }
        process.exitCode = 1;
      }
    }
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
