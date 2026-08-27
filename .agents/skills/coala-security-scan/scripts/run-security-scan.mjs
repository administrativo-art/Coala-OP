#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { delimiter, isAbsolute, join, relative, resolve, sep } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const SOURCE_EXTENSIONS = new Set([".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx", ".py", ".java", ".go"]);
const LOCAL_CONFIG_CANDIDATES = [".semgrep.yml", ".semgrep.yaml", "semgrep.yml", "semgrep.yaml"];

function isInside(root, candidate) {
  const value = relative(root, candidate);
  return value === "" || (!value.startsWith("..") && !isAbsolute(value) && !value.split(sep).includes(".."));
}

export function findExecutable(name, envPath = process.env.PATH ?? "") {
  for (const directory of envPath.split(delimiter).filter(Boolean)) {
    const candidate = join(directory, name);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

export function findLocalSemgrepConfig(repositoryRoot) {
  return LOCAL_CONFIG_CANDIDATES.map((candidate) => join(repositoryRoot, candidate)).find(existsSync) ?? null;
}

export function preflightSecurityScan({ repositoryRoot, envPath = process.env.PATH ?? "" }) {
  const executable = findExecutable("semgrep", envPath);
  const config = findLocalSemgrepConfig(repositoryRoot);
  let version = null;
  if (executable) {
    const result = spawnSync(executable, ["--version"], { encoding: "utf8", env: { ...process.env, PATH: envPath } });
    if (result.status === 0) version = result.stdout.trim().split(/\r?\n/)[0] || null;
  }
  return {
    tool: "semgrep",
    available: Boolean(executable),
    executable,
    version,
    localConfig: config,
    networkRequired: false,
    externalUpload: false,
  };
}

function gitRoot(cwd) {
  return execFileSync("git", ["rev-parse", "--show-toplevel"], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function changedFiles(repositoryRoot) {
  const output = execFileSync("git", ["status", "--porcelain=v1", "-z"], {
    cwd: repositoryRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const entries = output.split("\0").filter(Boolean);
  const files = [];
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    const status = entry.slice(0, 2);
    const path = entry.slice(3);
    if (status.includes("R") || status.includes("C")) index += 1;
    const extension = path.slice(path.lastIndexOf("."));
    const absolute = join(repositoryRoot, path);
    if (SOURCE_EXTENSIONS.has(extension) && existsSync(absolute)) files.push(path);
  }
  return [...new Set(files)].sort();
}

function timestamp(date = new Date()) {
  return date.toISOString().slice(0, 16).replace(/[-:T]/g, "").replace(/^(\d{8})(\d{4})$/, "$1-$2");
}

export function createSecurityOutputDirectory(repositoryRoot, date = new Date()) {
  const base = join(repositoryRoot, ".ai-work", "security");
  const prefix = timestamp(date);
  let candidate = join(base, prefix);
  let sequence = 1;
  while (existsSync(candidate)) candidate = join(base, `${prefix}-${++sequence}`);
  return candidate;
}

export function normalizeSemgrepFindings(raw) {
  return (raw.results ?? []).map((result, index) => ({
    id: `SEC-${String(index + 1).padStart(3, "0")}`,
    toolSeverity: result.extra?.severity ?? "UNKNOWN",
    classification: "INCONCLUSIVO",
    file: result.path ?? "NÃO INFORMADO",
    line: result.start?.line ?? null,
    rule: result.check_id ?? "NÃO INFORMADO",
    evidence: result.extra?.message ?? "Achado estático sem mensagem.",
    impact: "INCONCLUSIVO — requer análise do fluxo e das fronteiras de confiança.",
    exploitationScenario: "INCONCLUSIVO",
    possibleFalsePositive: "Avaliar validações, sanitização e autorização adjacentes.",
    requiredTest: "Reproduzir a classe da falha em teste isolado antes de remediar.",
    recommendedFix: "Selecionar uma correção somente após confirmar o achado.",
    behaviorChangeRisk: "INCONCLUSIVO",
  }));
}

function reportMarkdown({ mode, scope, preflight, findings }) {
  const lines = [
    "# Relatório de análise estática de segurança",
    "",
    `- Modo: ${mode}`,
    `- Escopo: ${scope.length ? scope.join(", ") : "nenhum arquivo relevante"}`,
    `- Ferramenta: ${preflight.tool} ${preflight.version ?? "versão não identificada"}`,
    `- Configuração local: ${preflight.localConfig ? relative(process.cwd(), preflight.localConfig) : "NÃO ENCONTRADA"}`,
    "- Rede utilizada: NÃO",
    "- Autofix: NÃO",
    "",
    "## Limitação",
    "",
    "Ausência de achados não comprova segurança. Cada resultado precisa de validação humana e teste do contrato afetado.",
    "",
    "## Achados",
    "",
  ];
  if (!findings.length) lines.push("Nenhum achado foi retornado pela configuração e pelo escopo executados.");
  for (const finding of findings) {
    lines.push(
      `### ${finding.id} — ${finding.rule}`,
      "",
      `- Severidade da ferramenta: ${finding.toolSeverity}`,
      `- Classificação: ${finding.classification}`,
      `- Local: ${finding.file}${finding.line ? `:${finding.line}` : ""}`,
      `- Evidência: ${finding.evidence}`,
      `- Impacto: ${finding.impact}`,
      `- Cenário possível: ${finding.exploitationScenario}`,
      `- Falso positivo possível: ${finding.possibleFalsePositive}`,
      `- Teste necessário: ${finding.requiredTest}`,
      `- Correção recomendada: ${finding.recommendedFix}`,
      `- Risco de alterar comportamento: ${finding.behaviorChangeRisk}`,
      "",
    );
  }
  return `${lines.join("\n")}\n`;
}

export function writeSecurityArtifacts({ repositoryRoot, outputDirectory, mode, scope, preflight, findings }) {
  const allowedRoot = resolve(repositoryRoot, ".ai-work", "security");
  const output = resolve(outputDirectory);
  if (!isInside(allowedRoot, output) || output === allowedRoot) {
    throw new Error("A saída deve ser um subdiretório de .ai-work/security/.");
  }
  mkdirSync(output, { recursive: true });
  writeFileSync(join(output, "findings.json"), `${JSON.stringify(findings, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  writeFileSync(join(output, "report.md"), reportMarkdown({ mode, scope, preflight, findings }), {
    encoding: "utf8",
    flag: "wx",
  });
  return output;
}

function resolveScope(repositoryRoot, mode, requestedPath) {
  if (mode === "changed") return changedFiles(repositoryRoot);
  if (mode === "full") return ["."];
  if (mode !== "path" || !requestedPath) throw new Error("Use changed, path <caminho> ou full.");
  const absolute = resolve(repositoryRoot, requestedPath);
  if (!isInside(repositoryRoot, absolute) || !existsSync(absolute)) throw new Error("Caminho de scan inválido ou externo.");
  return [relative(repositoryRoot, absolute) || "."];
}

export function runSecurityScan({ repositoryRoot, mode, requestedPath, envPath = process.env.PATH ?? "" }) {
  const scope = resolveScope(repositoryRoot, mode, requestedPath);
  const preflight = preflightSecurityScan({ repositoryRoot, envPath });
  if (!preflight.available) return { performed: false, reason: "Semgrep não está instalado.", preflight, scope };
  if (!preflight.localConfig) return { performed: false, reason: "Configuração local do Semgrep não encontrada.", preflight, scope };
  if (!scope.length) return { performed: false, reason: "Nenhum arquivo alterado relevante foi encontrado.", preflight, scope };

  const args = ["--json", "--metrics=off", "--disable-version-check", "--config", preflight.localConfig, ...scope];
  const result = spawnSync(preflight.executable, args, {
    cwd: repositoryRoot,
    encoding: "utf8",
    env: { ...process.env, PATH: envPath, SEMGREP_SEND_METRICS: "off" },
  });
  if (![0, 1].includes(result.status)) {
    throw new Error(`Semgrep encerrou com exit code ${result.status}: ${(result.stderr || "sem detalhe").trim()}`);
  }
  const raw = JSON.parse(result.stdout || "{}");
  const findings = normalizeSemgrepFindings(raw);
  const outputDirectory = createSecurityOutputDirectory(repositoryRoot);
  writeSecurityArtifacts({ repositoryRoot, outputDirectory, mode, scope, preflight, findings });
  return { performed: true, preflight, scope, findings, outputDirectory };
}

function isMain() {
  return process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

if (isMain()) {
  const [mode = "changed", requestedPath] = process.argv.slice(2);
  try {
    const repositoryRoot = gitRoot(process.cwd());
    const result = runSecurityScan({ repositoryRoot, mode, requestedPath });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (!result.performed) process.exitCode = 3;
  } catch (error) {
    console.error(`Não foi possível executar o scan de segurança: ${error.message}`);
    process.exitCode = 1;
  }
}
