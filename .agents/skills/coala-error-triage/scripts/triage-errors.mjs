#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { createErrorFingerprint } from "../../../../src/lib/observability/fingerprint.ts";
import { sanitizeError, sanitizeMetadata, sanitizeStack } from "../../../../src/lib/observability/sanitize.ts";
import { ERROR_KINDS, ERROR_SEVERITIES } from "../../../../src/lib/observability/taxonomy.ts";

const IMPACT_ORDER = ["EXPECTED", "NOISE", "LOW", "MEDIUM", "HIGH", "CRITICAL", "AMBIGUOUS"];
const ACTIONABLE_STATUSES = new Set(["NEW", "RECURRENT", "REGRESSION"]);
const IMPORTANT_KINDS = new Set(["SECURITY_INCIDENT", "DATA_INTEGRITY", "FINANCIAL_INCIDENT"]);

function parseJsonOrJsonl(source) {
  try {
    const parsed = JSON.parse(source);
    if (Array.isArray(parsed)) return parsed;
    if (Array.isArray(parsed?.events)) return parsed.events;
    return [parsed];
  } catch {
    return source.split(/\r?\n/).filter(Boolean).map((line, index) => {
      try {
        return JSON.parse(line);
      } catch {
        throw new Error(`JSONL inválido na linha ${index + 1}.`);
      }
    });
  }
}

function unwrapRecord(record) {
  if (!record || typeof record !== "object") return { message: String(record ?? "") };
  if (record.jsonPayload && typeof record.jsonPayload === "object") return record.jsonPayload;
  if (typeof record.textPayload === "string") {
    try { return JSON.parse(record.textPayload); } catch { return { message: record.textPayload }; }
  }
  if (typeof record.message === "string" && record.message.trim().startsWith("{")) {
    try { return JSON.parse(record.message); } catch { return record; }
  }
  return record;
}

function validIso(value) {
  if (typeof value !== "string") return null;
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? null : date.toISOString();
}

function safeString(value, fallback, limit) {
  if (typeof value !== "string" || !value.trim()) return fallback;
  return sanitizeError(value).message.slice(0, limit);
}

function assertSafeInputPath(path) {
  const name = basename(path).toLowerCase();
  if (/^\.env(?:\.|$)/.test(name) || /(?:credential|service.?account|firebase-adminsdk|private.?key|secret)/i.test(name)) {
    throw new Error("Arquivo de entrada recusado por aparentar conter credenciais.");
  }
  if (!existsSync(path)) throw new Error("Arquivo de entrada não encontrado.");
  return path;
}

function assertNormalizedEventsAreSanitized(events) {
  const serialized = JSON.stringify(events);
  const suspicious = [
    /\bBearer\s+[A-Za-z0-9._~+/=-]+/i,
    /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/,
    /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i,
    /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/,
  ];
  if (suspicious.some((pattern) => pattern.test(serialized))) {
    throw new Error("Eventos normalizados ainda contêm padrão sensível evidente.");
  }
}

export function normalizeTriageEvents(records) {
  return records.map((original, index) => {
    const record = unwrapRecord(original);
    const errorKind = ERROR_KINDS.includes(record.errorKind) ? record.errorKind : "UNEXPECTED_APPLICATION";
    const severity = ERROR_SEVERITIES.includes(record.coalaSeverity)
      ? record.coalaSeverity
      : ERROR_SEVERITIES.includes(record.severity)
        ? record.severity
        : "medium";
    const errorCode = /^[A-Z][A-Z0-9_]{2,79}$/.test(record.errorCode ?? "") ? record.errorCode : "UNCLASSIFIED_ERROR";
    const source = safeString(record.source, "unknown", 120);
    const routeOrJob = safeString(record.routeOrJob ?? record.route, "unknown", 300).split("?")[0];
    const operation = safeString(record.operation, "unknown", 160);
    const errorName = safeString(record.errorName, "Error", 200);
    const message = sanitizeError(record.messageSanitized ?? record.message ?? record.error?.message ?? "Falha sem mensagem.");
    const rawStack = record.stackSanitized ?? record.stack
      ?? (typeof record.message === "string" && /(?:^|\n)\s*at\s+/m.test(record.message) ? record.message : undefined);
    const stack = typeof rawStack === "string" ? sanitizeStack(rawStack) : undefined;
    const fingerprint = /^err-v1-[0-9a-f]{16}$/.test(record.fingerprint ?? "")
      ? record.fingerprint
      : createErrorFingerprint({ errorCode, source, routeOrJob, operation, errorName, stack });
    return {
      schemaVersion: 1,
      eventId: safeString(record.eventId, `missing-${index + 1}`, 128),
      occurredAt: validIso(record.occurredAt ?? record.timestamp),
      errorCode,
      errorKind,
      severity,
      source,
      operation,
      routeOrJob,
      requestId: typeof record.requestId === "string" ? safeString(record.requestId, "", 128) : undefined,
      correlationId: typeof record.correlationId === "string" ? safeString(record.correlationId, "", 128) : undefined,
      environment: safeString(record.environment, "unknown", 80),
      release: safeString(record.release, "unknown", 200),
      fingerprint,
      errorName,
      messageSanitized: message.message,
      stackSanitized: stack,
      metadataSanitized: sanitizeMetadata(record.metadataSanitized ?? record.metadata ?? {}),
      retryAttempt: Number.isInteger(record.retryAttempt) && record.retryAttempt >= 0 ? record.retryAttempt : undefined,
      isTerminal: record.isTerminal !== false,
      incomplete: !record.errorCode || !record.source || !(record.occurredAt ?? record.timestamp),
    };
  });
}

function severityClassification(events) {
  if (events.some((event) => IMPORTANT_KINDS.has(event.errorKind))) return "CRITICAL";
  if (events.some((event) => event.incomplete)) return "AMBIGUOUS";
  if (events.every((event) => event.errorKind === "EXPECTED_BUSINESS")) return "EXPECTED";
  if (events.every((event) => /AbortError|ResizeObserver|extension:\/\//i.test(`${event.errorName} ${event.messageSanitized} ${event.stackSanitized ?? ""}`))) return "NOISE";
  const maxSeverity = events.reduce((current, event) => Math.max(current, ERROR_SEVERITIES.indexOf(event.severity)), 0);
  return ["LOW", "MEDIUM", "HIGH", "CRITICAL"][maxSeverity];
}

function issueInventory(value) {
  if (!value) return [];
  const parsed = Array.isArray(value) ? value : Array.isArray(value.issues) ? value.issues : [];
  return parsed.filter((issue) => issue && typeof issue === "object" && typeof issue.fingerprint === "string");
}

function groupStatus(events, issue) {
  if (!issue) return severityClassification(events) === "EXPECTED" || severityClassification(events) === "NOISE"
    ? "NEEDS_INVESTIGATION"
    : "NEW";
  if (String(issue.state ?? "").toLowerCase() !== "closed") return "KNOWN";
  const fixedAt = validIso(issue.fixedAt ?? issue.closedAt);
  if (!fixedAt) return "NEEDS_INVESTIGATION";
  const afterFix = events.filter((event) => event.occurredAt && event.occurredAt > fixedAt);
  if (afterFix.length === 0) return "RESOLVED";
  if (issue.fixedRelease && afterFix.some((event) => event.release !== "unknown" && event.release !== issue.fixedRelease)) return "REGRESSION";
  return "RECURRENT";
}

function growth(events) {
  const timestamps = events.map((event) => event.occurredAt).filter(Boolean).map((value) => new Date(value).valueOf()).sort((a, b) => a - b);
  if (timestamps.length === 0) return { recent24h: 0, previous24h: 0, growthRate: null, isGrowing: false };
  const end = timestamps[timestamps.length - 1];
  const day = 86_400_000;
  const recent24h = timestamps.filter((value) => value > end - day).length;
  const previous24h = timestamps.filter((value) => value <= end - day && value > end - (2 * day)).length;
  const growthRate = previous24h === 0 ? (recent24h > 0 ? null : 0) : (recent24h - previous24h) / previous24h;
  return { recent24h, previous24h, growthRate, isGrowing: previous24h > 0 && recent24h > previous24h };
}

export function groupTriageEvents(events, issuesInput) {
  const issues = issueInventory(issuesInput);
  const byFingerprint = new Map();
  for (const event of events) {
    const current = byFingerprint.get(event.fingerprint) ?? [];
    current.push(event);
    byFingerprint.set(event.fingerprint, current);
  }
  return Array.from(byFingerprint, ([fingerprint, occurrences]) => {
    const sorted = [...occurrences].sort((left, right) => String(left.occurredAt).localeCompare(String(right.occurredAt)));
    const issue = issues.find((candidate) => candidate.fingerprint === fingerprint);
    return {
      fingerprint,
      classification: severityClassification(sorted),
      status: groupStatus(sorted, issue),
      occurrenceCount: sorted.length,
      firstSeen: sorted.find((event) => event.occurredAt)?.occurredAt ?? null,
      lastSeen: [...sorted].reverse().find((event) => event.occurredAt)?.occurredAt ?? null,
      releases: Array.from(new Set(sorted.map((event) => event.release))).sort(),
      environments: Array.from(new Set(sorted.map((event) => event.environment))).sort(),
      errorCode: sorted[0]?.errorCode ?? "UNCLASSIFIED_ERROR",
      errorKind: sorted[0]?.errorKind ?? "UNEXPECTED_APPLICATION",
      source: sorted[0]?.source ?? "unknown",
      operation: sorted[0]?.operation ?? "unknown",
      routeOrJob: sorted[0]?.routeOrJob ?? "unknown",
      eventIds: Array.from(new Set(sorted.map((event) => event.eventId))).slice(0, 20),
      requestIds: Array.from(new Set(sorted.map((event) => event.requestId).filter(Boolean))).slice(0, 20),
      correlationIds: Array.from(new Set(sorted.map((event) => event.correlationId).filter(Boolean))).slice(0, 20),
      sampleMessage: sorted[0]?.messageSanitized ?? "Falha sem mensagem.",
      growth: growth(sorted),
      relatedIssue: issue ? {
        number: issue.number ?? null,
        url: typeof issue.url === "string" ? issue.url : null,
        state: issue.state ?? null,
        fixedRelease: issue.fixedRelease ?? null,
      } : null,
    };
  }).sort((left, right) => {
    const impact = IMPACT_ORDER.indexOf(right.classification) - IMPACT_ORDER.indexOf(left.classification);
    return impact || right.occurrenceCount - left.occurrenceCount;
  });
}

function slug(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 70) || "error-group";
}

function issueDraft(group) {
  return `# [${group.classification}] ${group.errorCode}\n\n## Status do rascunho\nPRONTO PARA REVISÃO HUMANA\n\n## Erro observado\n${group.sampleMessage}\n\n## Evidência\n- Fingerprint Coala: ${group.fingerprint}\n- Event IDs no export: ${group.eventIds.join(", ") || "NÃO INFORMADO"}\n- Ocorrências no export: ${group.occurrenceCount}\n- Primeira no export: ${group.firstSeen ?? "NÃO INFORMADO"}\n- Última no export: ${group.lastSeen ?? "NÃO INFORMADO"}\n- Releases: ${group.releases.join(", ") || "NÃO INFORMADO"}\n- Superfície observada: ${group.source} / ${group.routeOrJob} / ${group.operation}\n\n## Classe da falha\n${group.errorKind}; estado de triagem ${group.status}.\n\n## Severidade\n${group.classification} — classificação inicial baseada somente neste export.\n\n## Causa confirmada\nNÃO CONFIRMADA. A correlação por fingerprint não demonstra causalidade.\n\n## Hipóteses ainda abertas\nCaracterizar por reprodução, código e evidência adicional antes de promover qualquer hipótese a causa.\n\n## Contrato ou invariante violado\nNÃO CONFIRMADO — identificar a regra durável antes da correção.\n\n## Superfícies afetadas\nConfirmada apenas a superfície observada acima. Expansão de escopo depende de evidência.\n\n## Correção sistêmica proposta\nPENDENTE — definir o menor nível de abstração que elimine a classe da falha.\n\n## Teste de regressão\nPENDENTE — deve proteger o contrato confirmado, não apenas esta ocorrência.\n\n## Risco\nPENDENTE DE CARACTERIZAÇÃO. Não inferir impacto total pela contagem deste export.\n\n## Rollout\nPENDENTE DE AUTORIZAÇÃO. Definir deploy, migração, rollback e smoke test aplicáveis.\n\n## Monitoramento de recorrência\nRelacionar fingerprint, release corrigida e eventos pós-release. Ausência no export não prova resolução.\n`;
}

function report(groups, normalizedCount, sourceName) {
  const priorities = groups.filter((group) => ["HIGH", "CRITICAL", "AMBIGUOUS"].includes(group.classification) || group.status === "REGRESSION");
  return `# Triagem de erros\n\n## Escopo\n\n- Fonte local: \`${sourceName}\`\n- Eventos normalizados: ${normalizedCount}\n- Grupos por fingerprint: ${groups.length}\n\n## Prioridade humana\n\n${priorities.length ? priorities.map((group) => `- **${group.classification} / ${group.status}** \`${group.fingerprint}\` — ${group.errorCode}, ${group.occurrenceCount} ocorrência(s).`).join("\n") : "Nenhum grupo prioritário identificado neste export."}\n\n## Todos os grupos\n\n${groups.map((group) => `- ${group.classification} / ${group.status} — \`${group.fingerprint}\` — ${group.occurrenceCount} ocorrência(s), ${group.firstSeen ?? "sem data"} → ${group.lastSeen ?? "sem data"}.`).join("\n") || "Nenhum evento."}\n\n## Limites\n\nEste relatório representa somente o arquivo analisado. Ausência de evento não prova resolução nem ausência de recorrência no ambiente. Nenhuma issue foi publicada.\n`;
}

function defaultOutput(repositoryRoot, now) {
  const timestamp = now.toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
  return join(repositoryRoot, ".ai-work", "error-triage", timestamp);
}

function assertOutput(repositoryRoot, outputDirectory) {
  const root = resolve(repositoryRoot, ".ai-work", "error-triage");
  const output = resolve(outputDirectory);
  if (output !== root && !output.startsWith(`${root}${sep}`)) throw new Error("A saída deve permanecer em .ai-work/error-triage/.");
  if (existsSync(output)) throw new Error("O diretório de saída já existe; a triagem não sobrescreve artifacts.");
  return output;
}

/**
 * @param {{
 *   repositoryRoot: string;
 *   inputPath: string;
 *   issuesPath?: string;
 *   outputDirectory?: string;
 *   now?: Date;
 *   dryRun?: boolean;
 * }} options
 */
export function runErrorTriage({ repositoryRoot, inputPath, issuesPath, outputDirectory, now = new Date(), dryRun = false }) {
  const input = assertSafeInputPath(resolve(inputPath));
  const records = parseJsonOrJsonl(readFileSync(input, "utf8"));
  const normalized = normalizeTriageEvents(records);
  assertNormalizedEventsAreSanitized(normalized);
  const issues = issuesPath ? JSON.parse(readFileSync(assertSafeInputPath(resolve(issuesPath)), "utf8")) : [];
  const groups = groupTriageEvents(normalized, issues);
  const output = assertOutput(repositoryRoot, outputDirectory ?? defaultOutput(repositoryRoot, now));
  if (dryRun) return { dryRun: true, outputDirectory: output, eventCount: normalized.length, groupCount: groups.length };

  mkdirSync(join(output, "issue-drafts"), { recursive: true });
  writeFileSync(join(output, "normalized-events.json"), `${JSON.stringify(normalized, null, 2)}\n`);
  writeFileSync(join(output, "groups.json"), `${JSON.stringify(groups, null, 2)}\n`);
  writeFileSync(join(output, "report.md"), report(groups, normalized.length, basename(input)));
  for (const group of groups) {
    if (!ACTIONABLE_STATUSES.has(group.status) || ["EXPECTED", "NOISE"].includes(group.classification)) continue;
    writeFileSync(join(output, "issue-drafts", `${slug(`${group.errorCode}-${group.fingerprint}`)}.md`), issueDraft(group), { flag: "wx" });
  }
  return { dryRun: false, outputDirectory: output, eventCount: normalized.length, groupCount: groups.length };
}

function arg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function isMain() {
  return process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

if (isMain()) {
  try {
    const repositoryRoot = process.cwd();
    const inputPath = arg("--input");
    if (!inputPath) throw new Error("Informe --input <arquivo>.");
    const result = runErrorTriage({
      repositoryRoot,
      inputPath,
      issuesPath: arg("--issues"),
      outputDirectory: arg("--output"),
      dryRun: process.argv.includes("--dry-run"),
    });
    process.stdout.write(`${result.dryRun ? "Preflight" : "Triagem"}: ${result.eventCount} evento(s), ${result.groupCount} grupo(s), saída ${relative(repositoryRoot, result.outputDirectory)}.\n`);
  } catch (error) {
    console.error(`Falha na triagem: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
