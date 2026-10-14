#!/usr/bin/env node

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const SKIP_DIRECTORIES = new Set([".git", ".next", ".ai-work", "node_modules", "dist", "build", "coverage", "backups"]);
const LIFECYCLE_NAMES = new Set(["preinstall", "install", "postinstall", "prepare"]);

function isInside(root, candidate) {
  const value = relative(root, candidate);
  return value === "" || (!value.startsWith("..") && !isAbsolute(value) && !value.split(sep).includes(".."));
}

function walkForPackageJson(root, directory = root, output = []) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && SKIP_DIRECTORIES.has(entry.name)) continue;
    const absolute = join(directory, entry.name);
    if (entry.isDirectory()) walkForPackageJson(root, absolute, output);
    else if (entry.isFile() && entry.name === "package.json") output.push(absolute);
  }
  return output;
}

function walkForNamedFiles(root, predicate, directory = root, output = []) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && SKIP_DIRECTORIES.has(entry.name)) continue;
    const absolute = join(directory, entry.name);
    if (entry.isDirectory()) walkForNamedFiles(root, predicate, absolute, output);
    else if (entry.isFile() && predicate(entry.name, absolute)) output.push(absolute);
  }
  return output;
}

function readJson(filePath) {
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new Error(`JSON inválido em ${filePath}: ${error.message}`);
  }
}

export function classifyVersionSpec(spec) {
  const value = String(spec ?? "").trim();
  if (/^(?:git(?:\+|:)|github:|gitlab:|bitbucket:)/i.test(value)) return "git";
  if (/^https?:\/\//i.test(value)) return "url";
  if (/^(?:\d+\.){2}\d+(?:-[0-9A-Za-z.-]+)?$/.test(value)) return "fixed";
  if (/^npm:(?:@[^/]+\/)?[^@]+@(?:\d+\.){2}\d+(?:-[0-9A-Za-z.-]+)?$/.test(value)) return "fixed-alias";
  if (/^(?:latest|next|beta|canary|\*|x)$/i.test(value)) return "floating";
  return "range-or-other";
}

function sanitizedVersionSpec(spec) {
  const classification = classifyVersionSpec(spec);
  if (classification === "url") return "[URL REDACTED]";
  if (classification === "git") return "[GIT REFERENCE REDACTED]";
  return String(spec ?? "").slice(0, 120);
}

function sanitizeDependencyConfig(value) {
  if (Array.isArray(value)) return value.map(sanitizeDependencyConfig);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, sanitizeDependencyConfig(item)]));
  }
  return typeof value === "string" ? sanitizedVersionSpec(value) : value;
}

function redactCommand(command) {
  return String(command)
    .replace(/(https?:\/\/)[^\s/@:]+:[^\s/@]+@/gi, "$1[CREDENTIALS REDACTED]@")
    .replace(/(Bearer\s+)[^\s"']+/gi, "$1[REDACTED]")
    .replace(/((?:authorization|cookie|set-cookie)\s*[:=]\s*)[^\s"']+/gi, "$1[REDACTED]")
    .replace(/((?:^|\s)(?:-u|--user)\s+)(?:"[^"]*"|'[^']*'|[^\s]+)/gi, "$1[REDACTED]")
    .replace(/((?:token|secret|password|api[_-]?key)=)[^\s&"']+/gi, "$1[REDACTED]")
    .slice(0, 300);
}

function npxTokenIsPinned(token) {
  if (token.startsWith("@")) return token.indexOf("@", token.indexOf("/") + 1) > 0;
  return token.includes("@");
}

function commandSignals(source, command) {
  const output = [];
  const text = String(command);
  const excerpt = (index) => {
    const start = text.lastIndexOf("\n", Math.max(0, index - 1)) + 1;
    const nextBreak = text.indexOf("\n", index);
    const end = nextBreak < 0 ? text.length : nextBreak;
    return redactCommand(text.slice(start, end));
  };
  for (const match of text.matchAll(/\bnpx\s+(?:--yes\s+)?([^\s;&|]+)/g)) {
    output.push({
      type: npxTokenIsPinned(match[1]) ? "npx-pinned" : "npx-unpinned",
      source,
      command: excerpt(match.index ?? 0),
      package: match[1],
    });
  }
  const patterns = [
    ["curl-pipe-shell", /\bcurl\b[^\n|]*\|\s*(?:ba)?sh\b/i],
    ["wget-pipe-shell", /\bwget\b[^\n|]*\|\s*(?:ba)?sh\b/i],
    ["pip-install", /\b(?:pip|pip3)\s+install\b/i],
    ["uv-install", /\buv\s+(?:tool\s+install|pip\s+install)\b/i],
  ];
  for (const [type, pattern] of patterns) {
    const index = text.search(pattern);
    if (index >= 0) output.push({ type: String(type), source, command: excerpt(index) });
  }
  return output;
}

function collectFileSignals(repositoryRoot, files) {
  const output = [];
  for (const path of files) {
    const source = relative(repositoryRoot, path);
    output.push(...commandSignals(source, readFileSync(path, "utf8")));
  }
  return output;
}

export function inventoryDependencies(repositoryRoot) {
  const root = resolve(repositoryRoot);
  const manifestPaths = walkForPackageJson(root).sort();
  const dockerfiles = walkForNamedFiles(root, (name) => /^Dockerfile(?:\..+)?$/i.test(name)).sort();
  const workflowRoot = join(root, ".github", "workflows");
  const workflows = existsSync(workflowRoot)
    ? walkForNamedFiles(workflowRoot, (name) => /\.ya?ml$/i.test(name)).sort()
    : [];
  const scriptRoot = join(root, "scripts");
  const installationCandidates = existsSync(scriptRoot)
    ? walkForNamedFiles(scriptRoot, (name) => /\.(?:mjs|cjs|js|mts|cts|ts|sh|zsh)$/i.test(name)).sort()
    : [];
  const manifests = [];
  const packageLocations = new Map();
  const commandInventory = [];

  for (const manifestPath of manifestPaths) {
    const manifest = readJson(manifestPath);
    const directory = relative(root, resolve(manifestPath, "..")) || ".";
    const lockfiles = ["package-lock.json", "npm-shrinkwrap.json", "yarn.lock", "pnpm-lock.yaml"]
      .filter((name) => existsSync(join(resolve(manifestPath, ".."), name)))
      .map((name) => join(directory, name));
    const dependencyGroups = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"];
    const dependencies = [];
    for (const group of dependencyGroups) {
      for (const [name, spec] of Object.entries(manifest[group] ?? {})) {
        const entry = { name, spec: sanitizedVersionSpec(spec), group, classification: classifyVersionSpec(spec) };
        dependencies.push(entry);
        const locations = packageLocations.get(name) ?? [];
        locations.push({ manifest: relative(root, manifestPath), spec: sanitizedVersionSpec(spec), group });
        packageLocations.set(name, locations);
      }
    }
    const lifecycleScripts = Object.entries(manifest.scripts ?? {})
      .filter(([name]) => LIFECYCLE_NAMES.has(name))
      .map(([name, command]) => ({ name, command: redactCommand(command) }));
    for (const [name, command] of Object.entries(manifest.scripts ?? {})) {
      commandInventory.push(...commandSignals(`${relative(root, manifestPath)}#scripts.${name}`, command));
    }
    manifests.push({
      path: relative(root, manifestPath),
      packageRoot: directory,
      name: manifest.name ?? basename(resolve(manifestPath, "..")),
      version: manifest.version ?? null,
      lockfiles,
      dependencies,
      lifecycleScripts,
      overrides: sanitizeDependencyConfig(manifest.overrides ?? null),
      resolutions: sanitizeDependencyConfig(manifest.resolutions ?? null),
    });
  }

  const duplicates = [...packageLocations.entries()]
    .filter(([, locations]) => new Set(locations.map((item) => item.manifest)).size > 1)
    .map(([name, locations]) => ({ name, locations }));
  const commands = [
    ...commandInventory,
    ...collectFileSignals(root, [...dockerfiles, ...workflows, ...installationCandidates]),
  ];
  return {
    generatedAt: new Date().toISOString(),
    repository: basename(root),
    manifests,
    lockfiles: [...new Set(manifests.flatMap((manifest) => manifest.lockfiles))].sort(),
    dockerfiles: dockerfiles.map((path) => relative(root, path)),
    workflows: workflows.map((path) => relative(root, path)),
    duplicates,
    commands,
  };
}

export function buildSupplyChainFindings(inventory) {
  const findings = [];
  let sequence = 0;
  const add = (category, severity, location, evidence) => {
    findings.push({
      id: `SC-${String(++sequence).padStart(3, "0")}`,
      category,
      severity,
      classification: "CONFIRMADO",
      location,
      evidence,
    });
  };
  for (const manifest of inventory.manifests) {
    if (!manifest.lockfiles.length) add("manifest/lockfile divergente", "medium", manifest.path, "Manifest sem lockfile no mesmo package root.");
    for (const dependency of manifest.dependencies) {
      if (dependency.classification === "git") add("dependência Git", "medium", manifest.path, `${dependency.name} usa especificação Git.`);
      else if (dependency.classification === "url") add("dependência por URL", "medium", manifest.path, `${dependency.name} usa URL direta.`);
      else if (!["fixed", "fixed-alias"].includes(dependency.classification)) {
        add("versão não fixada", "low", manifest.path, `${dependency.name} usa ${dependency.spec}.`);
      }
    }
    for (const script of manifest.lifecycleScripts) {
      add("script de instalação", "medium", manifest.path, `Script lifecycle ${script.name} está definido.`);
    }
  }
  for (const duplicate of inventory.duplicates) {
    add("pacote duplicado", "info", duplicate.locations.map((item) => item.manifest).join(", "), `${duplicate.name} aparece em múltiplos package roots.`);
  }
  for (const command of inventory.commands) {
    if (command.type === "npx-unpinned") add("ferramenta executada por npx sem versão", "medium", command.source, `${command.package} não possui versão explícita.`);
    if (["curl-pipe-shell", "wget-pipe-shell", "pip-install", "uv-install"].includes(command.type)) {
      add("script de instalação", "high", command.source, `Comando classificado como ${command.type}.`);
    }
  }
  return findings;
}

function timestamp(date = new Date()) {
  return date.toISOString().slice(0, 16).replace(/[-:T]/g, "").replace(/^(\d{8})(\d{4})$/, "$1-$2");
}

export function createSupplyChainOutputDirectory(repositoryRoot, date = new Date()) {
  const base = join(repositoryRoot, ".ai-work", "supply-chain");
  const prefix = timestamp(date);
  let candidate = join(base, prefix);
  let sequence = 1;
  while (existsSync(candidate)) candidate = join(base, `${prefix}-${++sequence}`);
  return candidate;
}

function reportMarkdown(inventory, findings) {
  const lines = [
    "# Auditoria local de supply chain",
    "",
    `- Manifests: ${inventory.manifests.length}`,
    `- Lockfiles: ${inventory.lockfiles.length}`,
    `- Achados locais: ${findings.length}`,
    "- Rede utilizada: NÃO",
    "- Atualizações aplicadas: NÃO",
    "",
    "## Limitações",
    "",
    "Esta execução não consultou CVEs, registros externos, manutenção de pacotes ou risco de mantenedor.",
    "",
    "## Achados",
    "",
  ];
  if (!findings.length) lines.push("Nenhum risco local das categorias verificadas foi encontrado.");
  for (const finding of findings) {
    lines.push(
      `### ${finding.id} — ${finding.category}`,
      "",
      `- Severidade: ${finding.severity}`,
      `- Classificação: ${finding.classification}`,
      `- Local: ${finding.location}`,
      `- Evidência: ${finding.evidence}`,
      "",
    );
  }
  return `${lines.join("\n")}\n`;
}

export function writeSupplyChainArtifacts({ repositoryRoot, outputDirectory, inventory, findings }) {
  const allowedRoot = resolve(repositoryRoot, ".ai-work", "supply-chain");
  const output = resolve(outputDirectory);
  if (!isInside(allowedRoot, output) || output === allowedRoot) {
    throw new Error("A saída deve ser um subdiretório de .ai-work/supply-chain/.");
  }
  mkdirSync(output, { recursive: true });
  writeFileSync(join(output, "inventory.json"), `${JSON.stringify(inventory, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  writeFileSync(join(output, "findings.json"), `${JSON.stringify(findings, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  writeFileSync(join(output, "report.md"), reportMarkdown(inventory, findings), { encoding: "utf8", flag: "wx" });
  return output;
}

function gitRoot(cwd) {
  return execFileSync("git", ["rev-parse", "--show-toplevel"], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function isMain() {
  return process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

if (isMain()) {
  try {
    const repositoryRoot = gitRoot(process.cwd());
    const inventory = inventoryDependencies(repositoryRoot);
    const findings = buildSupplyChainFindings(inventory);
    const outputDirectory = createSupplyChainOutputDirectory(repositoryRoot);
    writeSupplyChainArtifacts({ repositoryRoot, outputDirectory, inventory, findings });
    process.stdout.write(`${JSON.stringify({ outputDirectory: relative(repositoryRoot, outputDirectory), findings: findings.length }, null, 2)}\n`);
  } catch (error) {
    console.error(`Não foi possível auditar a supply chain: ${error.message}`);
    process.exitCode = 1;
  }
}
