/**
 * Fases 3, 5 e 6 — Distribuição determinística.
 *
 * A partir do tipo (código) e dos campos extraídos, o backend resolve:
 *  - processo/subpasta virtual (metadados, não diretório físico) — Fase 5;
 *  - trilha de navegação, nome exibido e nome para download — Fase 3;
 *  - duplicidade lógica e número da versão — Fase 6.
 *
 * Módulo puro (sem Firestore/Next), testável isoladamente.
 */

import { documentCategoryLabel } from "@/lib/hr/employee-document-planning";
import type { EnrichedDocumentTypeConfig, ProcessCategory, DuplicateStrategy } from "@/lib/hr/employee-document-catalog";

type Fields = Record<string, unknown>;

const MONTHS_PT = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

function str(fields: Fields, key: string): string | null {
  const v = fields[key];
  return typeof v === "string" && v.trim() ? v.trim() : null;
}
function numLike(fields: Fields, key: string): number | null {
  const v = fields[key];
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() && Number.isFinite(Number(v))) return Number(v);
  return null;
}
function yearOf(iso: string | null): string | null {
  return iso && /^\d{4}-\d{2}/.test(iso) ? iso.slice(0, 4) : null;
}
function pad2(n: number): string {
  return String(n).padStart(2, "0");
}
function formatBR(iso: string | null): string | null {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}
function fileSafe(value: string | null): string {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toUpperCase();
}

export interface ResolvedProcess {
  processCategory: ProcessCategory;
  caseId: string | null;
  subcaseId: string | null;
  /** Segmentos de subpasta virtual dentro da pasta principal. */
  pathSegments: string[];
  /** Tokens de referência para nomenclatura. */
  tokens: Record<string, string>;
  /** Rótulo curto de referência (ex.: "2026-07", "PA 2025-2026 · Parcela 01"). */
  referenceLabel: string;
}

/** Fase 5 — resolve o processo/subpasta a partir dos metadados extraídos. */
export function resolveDocumentProcess(processCategory: ProcessCategory, fields: Fields): ResolvedProcess {
  const empty: ResolvedProcess = { processCategory, caseId: null, subcaseId: null, pathSegments: [], tokens: {}, referenceLabel: "" };

  switch (processCategory) {
    case "VACATION_INSTALLMENT": {
      const startYear = yearOf(str(fields, "acquisitionPeriodStart"));
      const endYear = yearOf(str(fields, "acquisitionPeriodEnd"));
      const acquisitionPeriod = startYear && endYear ? `${startYear}-${endYear}` : startYear ?? "sem-periodo";
      const installment = numLike(fields, "installmentNumber") ?? 1;
      const installmentLabel = pad2(installment);
      return {
        processCategory,
        caseId: `vacation-period-${acquisitionPeriod}`,
        subcaseId: `installment-${installmentLabel}`,
        pathSegments: [`Período aquisitivo ${acquisitionPeriod}`, `Parcela ${installmentLabel}`],
        tokens: { acquisitionPeriod, installmentNumber: installmentLabel, issueDate: str(fields, "issueDate") ?? "" },
        referenceLabel: `PA ${acquisitionPeriod} · Parcela ${installmentLabel}`,
      };
    }
    case "MONTHLY_REFERENCE": {
      const referenceMonth = str(fields, "referenceMonth");
      if (!referenceMonth || !/^\d{4}-\d{2}$/.test(referenceMonth)) return { ...empty, referenceLabel: "Sem competência", pathSegments: ["Sem competência"] };
      const [y, m] = referenceMonth.split("-");
      const monthLabel = MONTHS_PT[Number(m) - 1] ?? m;
      return {
        processCategory,
        caseId: `month-${referenceMonth}`,
        subcaseId: null,
        pathSegments: [y, monthLabel],
        tokens: { referenceMonth, referenceMonthLabel: `${monthLabel} de ${y}` },
        referenceLabel: `${monthLabel}/${y}`,
      };
    }
    case "OCCUPATIONAL_EXAM": {
      const examDate = str(fields, "examDate");
      const label = formatBR(examDate);
      return {
        processCategory,
        caseId: examDate ? `exam-${examDate}` : null,
        subcaseId: null,
        pathSegments: label ? [`Exame ${label}`] : [],
        tokens: { examDate: examDate ?? "" },
        referenceLabel: label ?? "Exame",
      };
    }
    case "LEAVE": {
      const startDate = str(fields, "startDate");
      const endDate = str(fields, "endDate");
      const startLabel = formatBR(startDate);
      const endLabel = formatBR(endDate);
      const seg = startLabel ? `Afastamento ${startLabel}${endLabel ? ` a ${endLabel}` : ""}` : "Afastamento";
      return {
        processCategory,
        caseId: startDate ? `leave-${startDate}` : null,
        subcaseId: null,
        pathSegments: [seg],
        tokens: { startDate: startDate ?? "" },
        referenceLabel: startLabel ?? "Afastamento",
      };
    }
    case "ADMISSION": {
      const admissionDate = str(fields, "admissionDate");
      const label = formatBR(admissionDate);
      return {
        processCategory,
        caseId: admissionDate ? `admission-${admissionDate}` : null,
        subcaseId: null,
        pathSegments: label ? [`Admissão ${label}`] : [],
        tokens: { admissionDate: admissionDate ?? "" },
        referenceLabel: label ?? "Admissão",
      };
    }
    case "TERMINATION": {
      const terminationDate = str(fields, "terminationDate");
      const label = formatBR(terminationDate);
      return {
        processCategory,
        caseId: terminationDate ? `termination-${terminationDate}` : null,
        subcaseId: null,
        pathSegments: label ? [`Processo ${label}`] : [],
        tokens: { terminationDate: terminationDate ?? "" },
        referenceLabel: label ?? "Desligamento",
      };
    }
    case "DISCIPLINARY": {
      const issueDate = str(fields, "issueDate");
      const label = formatBR(issueDate);
      return {
        processCategory,
        caseId: issueDate ? `disciplinary-${issueDate}` : null,
        subcaseId: null,
        pathSegments: label ? [`Ocorrência ${label}`] : [],
        tokens: { issueDate: issueDate ?? "" },
        referenceLabel: label ?? "Ocorrência",
      };
    }
    default:
      return empty;
  }
}

/** Renderiza um template `{token}` com os valores fornecidos (fallback seguro). */
export function renderTemplate(template: string, tokens: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, key) => {
    const value = tokens[key];
    return value && value.length > 0 ? value : "SEM-DADO";
  });
}

/** Fase 3 — nomes exibido e para download (nunca gerados pela IA). */
export function buildDocumentNames(input: {
  config: EnrichedDocumentTypeConfig;
  employeeCode: string;
  process: ResolvedProcess;
  fields: Fields;
  version: number;
}): { displayName: string; downloadName: string } {
  const { config, employeeCode, process, fields, version } = input;
  const tokens: Record<string, string> = {
    employeeCode: employeeCode || "SEM-COD",
    typeCode: config.code,
    typeName: config.label,
    reference: process.referenceLabel,
    version: pad2(version),
    acquisitionPeriod: process.tokens.acquisitionPeriod ?? "",
    installmentNumber: process.tokens.installmentNumber ?? "",
    referenceMonth: process.tokens.referenceMonth ?? str(fields, "referenceMonth") ?? "",
    referenceMonthLabel: process.tokens.referenceMonthLabel ?? "",
    issueDate: str(fields, "issueDate") ?? "",
    startDate: str(fields, "startDate") ?? "",
    examDate: str(fields, "examDate") ?? "",
    terminationDate: str(fields, "terminationDate") ?? "",
    dependentName: fileSafe(str(fields, "dependentName")),
    dependentBirthDate: str(fields, "dependentBirthDate") ?? "",
  };
  return {
    displayName: renderTemplate(config.displayNameTemplate, tokens),
    downloadName: renderTemplate(config.downloadNameTemplate, tokens),
  };
}

export interface DestinationResult {
  folderCode: string;
  caseId: string | null;
  subcaseId: string | null;
  pathSegments: string[];
  displayName: string;
  downloadName: string;
  accessPolicyId: string;
}

/** Fase 3 — destino determinístico completo (pasta + processo + nomes + acesso). */
export function resolveDocumentDestination(input: {
  config: EnrichedDocumentTypeConfig;
  employeeCode: string;
  fields: Fields;
  version: number;
}): DestinationResult {
  const { config, employeeCode, fields, version } = input;
  const process = resolveDocumentProcess(config.processCategory, fields);
  const folderLabel = documentCategoryLabel(config.category);
  const names = buildDocumentNames({ config, employeeCode, process, fields, version });
  return {
    folderCode: config.folderCode,
    caseId: process.caseId,
    subcaseId: process.subcaseId,
    pathSegments: [folderLabel, ...process.pathSegments, config.label],
    displayName: names.displayName,
    downloadName: names.downloadName,
    accessPolicyId: config.accessPolicyId,
  };
}

// ─── Fase 6 — duplicidade lógica e versão ────────────────────────────────────

export type VersionResolution = "NEW_DOCUMENT" | "NEW_VERSION" | "EXACT_DUPLICATE" | "POSSIBLE_DUPLICATE";

export interface ExistingDocumentRef {
  id: string;
  documentTypeCode?: string | null;
  contentHash?: string | null;
  logicalKey?: string | null;
  version?: number | null;
}

/** Chave de duplicidade lógica: employeeId + code + valores das duplicateKeys. */
export function buildLogicalKey(employeeId: string, code: string, keys: string[], fields: Fields): string {
  const parts = keys.map((k) => {
    if (k === "acquisitionPeriod") {
      const s = yearOf(str(fields, "acquisitionPeriodStart"));
      const e = yearOf(str(fields, "acquisitionPeriodEnd"));
      return s && e ? `${s}-${e}` : (s ?? "");
    }
    const raw = fields[k];
    return raw == null ? "" : String(raw);
  });
  return [employeeId, code, ...parts].join("|");
}

/** Fase 6 — decide se é novo documento, nova versão ou duplicata. */
export function resolveDuplicateAndVersion(input: {
  employeeId: string;
  code: string;
  strategy: DuplicateStrategy;
  keys: string[];
  fields: Fields;
  contentHash: string;
  existing: ExistingDocumentRef[];
}): { resolution: VersionResolution; version: number; existingDocumentId: string | null; logicalKey: string } {
  const { employeeId, code, strategy, keys, fields, contentHash, existing } = input;

  // 1) Duplicata exata por hash — independe da estratégia.
  const exact = existing.find((d) => d.contentHash && d.contentHash === contentHash);
  if (exact) {
    return { resolution: "EXACT_DUPLICATE", version: exact.version ?? 1, existingDocumentId: exact.id, logicalKey: exact.logicalKey ?? "" };
  }

  const logicalKey = buildLogicalKey(employeeId, code, keys, fields);
  const sameLogical = existing.filter((d) => d.logicalKey && d.logicalKey === logicalKey);

  if (sameLogical.length === 0) {
    return { resolution: "NEW_DOCUMENT", version: 1, existingDocumentId: null, logicalKey };
  }

  const maxVersion = sameLogical.reduce((m, d) => Math.max(m, d.version ?? 1), 0);
  if (strategy === "VERSION") {
    const newest = sameLogical.reduce((a, b) => ((a.version ?? 1) >= (b.version ?? 1) ? a : b));
    return { resolution: "NEW_VERSION", version: maxVersion + 1, existingDocumentId: newest.id, logicalKey };
  }
  // WARN/BLOCK/ALLOW com mesma chave lógica → possível duplicata (exige confirmação).
  return { resolution: "POSSIBLE_DUPLICATE", version: maxVersion + 1, existingDocumentId: sameLogical[0].id, logicalKey };
}
