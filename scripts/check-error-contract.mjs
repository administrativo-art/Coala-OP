#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SOURCE_DIRECTORIES = ["src", "functions/src", "scripts"];
const SOURCE_EXTENSIONS = new Set([".cjs", ".js", ".mjs", ".mts", ".ts", ".tsx"]);

export const ERROR_CONTRACT_RULES = [
  {
    id: "raw-error-message-in-api",
    applies: (path) => path.startsWith("src/app/api/"),
    pattern: /\berror\s*\.\s*message\b/g,
  },
  {
    id: "stack-near-api-response",
    applies: (path) => path.startsWith("src/app/api/"),
    pattern: /NextResponse\s*\.\s*json\s*\([\s\S]{0,500}?\bstack\b/g,
  },
  {
    id: "legacy-api-error-envelope",
    applies: (path) => path.startsWith("src/app/api/"),
    pattern: /NextResponse\s*\.\s*json\s*\(\s*\{\s*error\s*:/g,
  },
  {
    id: "ad-hoc-console-error-warning",
    applies: () => true,
    pattern: /\bconsole\s*\.\s*(?:error|warn)\s*\(/g,
  },
  {
    id: "sensitive-value-near-log",
    applies: () => true,
    pattern: /\bconsole\s*\.\s*(?:error|warn|log)\s*\([^\n]{0,300}\b(?:authorization|cookie|set-cookie)\b/gi,
  },
];

function walk(directory) {
  if (!existsSync(directory)) return [];
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...walk(path));
    else if (entry.isFile() && SOURCE_EXTENSIONS.has(extname(entry.name))) files.push(path);
  }
  return files;
}

export function scanErrorContract(repositoryRoot) {
  const root = resolve(repositoryRoot);
  const counts = {};
  for (const sourceDirectory of SOURCE_DIRECTORIES) {
    for (const file of walk(join(root, sourceDirectory))) {
      const path = relative(root, file).replaceAll("\\", "/");
      const source = readFileSync(file, "utf8");
      for (const rule of ERROR_CONTRACT_RULES) {
        if (!rule.applies(path)) continue;
        const count = Array.from(source.matchAll(rule.pattern)).length;
        if (count > 0) counts[`${rule.id}:${path}`] = count;
      }
    }
  }
  return Object.fromEntries(Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)));
}

export function compareErrorContract(current, baseline) {
  const violations = [];
  for (const [key, count] of Object.entries(current)) {
    const allowed = Number(baseline[key] ?? 0);
    if (count > allowed) violations.push({ key, current: count, allowed });
  }
  return violations;
}

function parseBaseline(path) {
  const parsed = JSON.parse(readFileSync(path, "utf8"));
  if (parsed.version !== 1 || !parsed.counts || typeof parsed.counts !== "object") {
    throw new Error("Baseline do contrato de erro possui formato inválido.");
  }
  return parsed;
}

function isMain() {
  return process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

if (isMain()) {
  const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const baselinePath = join(repositoryRoot, "config", "error-contract-baseline.json");
  try {
    const counts = scanErrorContract(repositoryRoot);
    if (process.argv.includes("--write-baseline")) {
      if (!existsSync(dirname(baselinePath)) || !statSync(dirname(baselinePath)).isDirectory()) {
        throw new Error("Diretório config ausente; crie-o explicitamente antes de gerar o baseline.");
      }
      writeFileSync(baselinePath, `${JSON.stringify({ version: 1, counts }, null, 2)}\n`, { flag: "w" });
      process.stdout.write(`Baseline gravado com ${Object.keys(counts).length} entradas.\n`);
    } else {
      const baseline = parseBaseline(baselinePath);
      const violations = compareErrorContract(counts, baseline.counts);
      if (violations.length > 0) {
        console.error(`Contrato de erro violado em ${violations.length} entrada(s):`);
        for (const violation of violations) {
          console.error(`- ${violation.key}: atual=${violation.current}, baseline=${violation.allowed}`);
        }
        process.exitCode = 1;
      } else {
        const total = Object.values(counts).reduce((sum, count) => sum + Number(count), 0);
        process.stdout.write(`Ratchet do contrato de erro válido: ${total} ocorrência(s) legada(s), nenhuma adição.\n`);
      }
    }
  } catch (error) {
    console.error(`Falha ao verificar o contrato de erro: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
