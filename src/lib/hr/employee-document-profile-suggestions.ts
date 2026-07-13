import "server-only";

import { Timestamp } from "firebase-admin/firestore";

import { DEFAULT_COMPLEMENTARY_FIELDS } from "@/features/rh/lib/default-field-map";
import { hrDbAdmin } from "@/lib/firebase-rh-admin";
import { normalizeCpf, normalizePersonName } from "@/lib/hr/employee-document-match";
import { calcProfileCompletion, type EmployeeFieldValue, type FieldType } from "@/types/rh";

type SuggestionStatus = "MISSING_IN_PROFILE" | "FILLED_FROM_DOCUMENT" | "MATCHING_PROFILE" | "DIVERGENT";

export type EmployeeProfileSuggestion = {
  fieldKey: string;
  fieldLabel: string;
  section: string;
  extractedField: string;
  extractedValue: string;
  currentValue: string | null;
  confidence: number;
  status: SuggestionStatus;
};

type Mapping = {
  extractedField: string;
  fieldKey: string;
  label: string;
  section: string;
  normalize: (value: unknown) => string | null;
  storageValue?: (rawValue: unknown, comparableValue: string) => unknown;
};

type AsoRecordType = "admission" | "periodic" | "return" | "risk_change" | "dismissal";

type AsoSummary = {
  version: 1;
  records: Array<{
    type: AsoRecordType;
    examDate: string;
    fitnessStatus?: string | null;
    documentId?: string | null;
    documentTypeCode?: string | null;
    source: "document_upload";
    updatedAt: string;
  }>;
  admissionMissing: boolean;
  lastValidExamDate: string | null;
  nextPeriodicDue: string | null;
  status: "missing_admission" | "ok" | "due_soon" | "overdue" | "dismissal_recorded";
  periodicityMonths: 24;
  updatedAt: string;
};

type FamilyDocumentKind = "birth_certificate" | "vaccination" | "school_attendance" | "responsibility_term";

type FamilySalarySummary = {
  version: 1;
  dependents: Array<{
    key: string;
    name: string | null;
    birthDate: string | null;
    cpf?: string | null;
    rg?: string | null;
    relationship?: string | null;
    documents: Partial<Record<FamilyDocumentKind, {
      documentId?: string | null;
      documentTypeCode?: string | null;
      updatedAt: string;
    }>>;
    entitlementEndsAt: string | null;
  }>;
  eligibleDependentsCount: number;
  pendingDependentsCount: number;
  status: "eligible_ready" | "pending_documents" | "no_eligible_dependents" | "needs_review";
  salaryLimit: {
    year: 2026;
    monthlyRemunerationLimit: 1980.38;
    quotaPerDependent: 67.54;
  };
  notes: string[];
  updatedAt: string;
};

const ASO_SUMMARY_FIELD = "system.aso.summary";
const FAMILY_SALARY_SUMMARY_FIELD = "system.family_salary.summary";
const FAMILY_SALARY_LIMIT_2026 = {
  year: 2026,
  monthlyRemunerationLimit: 1980.38,
  quotaPerDependent: 67.54,
} as const;

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function digits(value: unknown): string | null {
  const raw = typeof value === "string" || typeof value === "number" ? String(value).replace(/\D/g, "") : "";
  return raw || null;
}

function date(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value);
    return Number.isFinite(parsed.getTime()) ? parsed.toISOString().slice(0, 10) : null;
  }
  if (typeof value === "object" && typeof (value as { toDate?: unknown }).toDate === "function") {
    const parsed = (value as { toDate: () => Date }).toDate();
    return Number.isFinite(parsed.getTime()) ? parsed.toISOString().slice(0, 10) : null;
  }
  return null;
}

function dateOnly(value: unknown): string | null {
  const parsed = date(value);
  return parsed && /^\d{4}-\d{2}-\d{2}$/.test(parsed) ? parsed : null;
}

function normalizedName(value: unknown): string | null {
  const raw = text(value);
  return raw ? normalizePersonName(raw) : null;
}

function fieldLabel(fieldKey: string, fallback: string) {
  return DEFAULT_COMPLEMENTARY_FIELDS[fieldKey]?.label ?? fallback;
}

function fieldSection(fieldKey: string, fallback: string) {
  return DEFAULT_COMPLEMENTARY_FIELDS[fieldKey]?.section ?? fallback;
}

const FIELD_MAPPINGS: Mapping[] = [
  {
    extractedField: "employeeName",
    fieldKey: "employee.name",
    label: fieldLabel("employee.name", "Nome completo"),
    section: fieldSection("employee.name", "Dados pessoais"),
    normalize: normalizedName,
  },
  {
    extractedField: "cpf",
    fieldKey: "employee.cpf",
    label: fieldLabel("employee.cpf", "CPF"),
    section: fieldSection("employee.cpf", "Documentos"),
    normalize: (value) => {
      const cpf = normalizeCpf(text(value));
      return cpf || null;
    },
  },
  {
    extractedField: "birthDate",
    fieldKey: "employee.birth_date",
    label: fieldLabel("employee.birth_date", "Data de nascimento"),
    section: fieldSection("employee.birth_date", "Dados pessoais"),
    normalize: date,
  },
  {
    extractedField: "motherName",
    fieldKey: "employee.mother_name",
    label: fieldLabel("employee.mother_name", "Nome da mãe"),
    section: fieldSection("employee.mother_name", "Dados pessoais"),
    normalize: normalizedName,
  },
  {
    extractedField: "fatherName",
    fieldKey: "employee.father_name",
    label: fieldLabel("employee.father_name", "Nome do pai"),
    section: fieldSection("employee.father_name", "Dados pessoais"),
    normalize: normalizedName,
  },
  {
    extractedField: "employer",
    fieldKey: "employee.employer_name",
    label: fieldLabel("employee.employer_name", "Razão social"),
    section: fieldSection("employee.employer_name", "Dados contratuais"),
    normalize: (value) => text(value)?.toLowerCase() ?? null,
  },
  {
    extractedField: "cnpj",
    fieldKey: "employee.employer_cnpj",
    label: fieldLabel("employee.employer_cnpj", "CNPJ do empregador"),
    section: fieldSection("employee.employer_cnpj", "Dados contratuais"),
    normalize: digits,
  },
];

function readFieldValue(data: Record<string, unknown>): unknown {
  return data.value_text ?? data.value_date ?? data.value_number ?? data.value_boolean ?? data.value_json ?? null;
}

function displayValue(value: unknown): string {
  if (value == null) return "";
  if (typeof (value as { toDate?: unknown }).toDate === "function") {
    const dateValue = (value as { toDate: () => Date }).toDate();
    return Number.isFinite(dateValue.getTime()) ? dateValue.toISOString().slice(0, 10) : "";
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function readJsonValue(data: Record<string, unknown>): unknown {
  return data.value_json ?? null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function addMonths(iso: string, months: number): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const [year, month, day] = iso.split("-").map(Number);
  const result = new Date(Date.UTC(year, month - 1 + months, day));
  return Number.isFinite(result.getTime()) ? result.toISOString().slice(0, 10) : null;
}

function daysUntil(iso: string): number | null {
  const target = new Date(`${iso}T12:00:00.000Z`);
  if (!Number.isFinite(target.getTime())) return null;
  const today = new Date();
  const current = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate(), 12));
  return Math.ceil((target.getTime() - current.getTime()) / 86400000);
}

function normalizedToken(value: unknown): string {
  return text(value)
    ?.normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim() ?? "";
}

async function loadEmployeeDoc(appUserId: string) {
  const snap = await hrDbAdmin.collection("employees").where("auth_uid", "==", appUserId).limit(1).get();
  return snap.empty ? null : snap.docs[0];
}

function buildStoredValue(mapping: Mapping, rawValue: unknown, comparableValue: string) {
  if (mapping.storageValue) return mapping.storageValue(rawValue, comparableValue);
  if (typeof rawValue === "string") return rawValue.trim();
  return comparableValue;
}

function buildFieldValue(fieldKey: string, value: unknown, type: FieldType, actorId: string, now: Timestamp): Record<string, unknown> | null {
  const base = { field_key: fieldKey, updated_at: now, updated_by: actorId };
  if (value == null || value === "") return null;

  if (typeof value === "object" && value !== null && typeof (value as { toDate?: unknown }).toDate !== "function") {
    return { ...base, value_json: value };
  }

  if (type === "date") {
    const rawDate = String(value);
    const parsed = /^\d{4}-\d{2}-\d{2}$/.test(rawDate)
      ? new Date(`${rawDate}T00:00:00.000Z`)
      : new Date(rawDate);
    if (!Number.isFinite(parsed.getTime())) return null;
    return { ...base, value_date: Timestamp.fromDate(parsed) };
  }

  if (type === "boolean") return { ...base, value_boolean: Boolean(value) };

  if (type === "currency" || type === "number") {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) return null;
    return { ...base, value_number: numericValue };
  }

  if (type === "multi_select") {
    return { ...base, value_json: Array.isArray(value) ? value : [String(value)] };
  }

  return { ...base, value_text: String(value) };
}

async function recalculateProfileCompletion(employeeRef: FirebaseFirestore.DocumentReference) {
  const allFields = await employeeRef.collection("field_values").get();
  const fieldValues = Object.fromEntries(
    allFields.docs.map((doc) => [doc.id, doc.data() as unknown as EmployeeFieldValue]),
  ) as Record<string, EmployeeFieldValue>;
  const completion = calcProfileCompletion(fieldValues);
  await employeeRef.update({ profile_completion: completion });
  return completion;
}

function asoTypeFrom(documentTypeCode: string | null | undefined, extractedFields: Record<string, unknown>): AsoRecordType | null {
  if (documentTypeCode === "ASO_ADMISSION") return "admission";
  if (documentTypeCode === "ASO_PERIODIC") return "periodic";
  if (documentTypeCode === "ASO_RETURN") return "return";
  if (documentTypeCode === "ASO_RISK_CHANGE") return "risk_change";
  if (documentTypeCode === "ASO_DISMISSAL") return "dismissal";

  const raw = normalizedToken(extractedFields.asoType);
  if (!raw) return null;
  if (raw.includes("admiss")) return "admission";
  if (raw.includes("period")) return "periodic";
  if (raw.includes("retorno")) return "return";
  if (raw.includes("demiss")) return "dismissal";
  if (raw.includes("mudanca") || raw.includes("funcao") || raw.includes("risco")) return "risk_change";
  return null;
}

function buildAsoSummaryFromRecord(input: {
  current: unknown;
  documentTypeCode?: string | null;
  extractedFields: Record<string, unknown>;
  documentId?: string | null;
}): AsoSummary | null {
  const type = asoTypeFrom(input.documentTypeCode, input.extractedFields);
  const examDate = dateOnly(input.extractedFields.examDate);
  if (!type || !examDate) return null;

  const nowIso = new Date().toISOString();
  const current = isRecord(input.current) ? input.current : {};
  const currentRecords = Array.isArray(current.records) ? current.records : [];
  const records = currentRecords
    .filter((item): item is AsoSummary["records"][number] => isRecord(item) && typeof item.examDate === "string" && typeof item.type === "string")
    .map((item) => ({ ...item }));

  const nextRecord: AsoSummary["records"][number] = {
    type,
    examDate,
    fitnessStatus: text(input.extractedFields.fitnessStatus),
    documentId: input.documentId ?? null,
    documentTypeCode: input.documentTypeCode ?? null,
    source: "document_upload",
    updatedAt: nowIso,
  };
  const existingIndex = records.findIndex((record) => record.type === type && record.examDate === examDate);
  if (existingIndex >= 0) {
    records[existingIndex] = { ...records[existingIndex], ...nextRecord };
  } else {
    records.push(nextRecord);
  }
  records.sort((left, right) => right.examDate.localeCompare(left.examDate));

  const admissionMissing = !records.some((record) => record.type === "admission");
  const lastValidRecord = records
    .filter((record) => record.type !== "dismissal")
    .sort((left, right) => right.examDate.localeCompare(left.examDate))[0] ?? null;
  const lastValidExamDate = lastValidRecord?.examDate ?? null;
  const nextPeriodicDue = lastValidExamDate ? addMonths(lastValidExamDate, 24) : null;
  const dueDays = nextPeriodicDue ? daysUntil(nextPeriodicDue) : null;
  const latestRecord = records[0] ?? null;

  let status: AsoSummary["status"] = "ok";
  if (admissionMissing) status = "missing_admission";
  else if (latestRecord?.type === "dismissal") status = "dismissal_recorded";
  else if (dueDays != null && dueDays < 0) status = "overdue";
  else if (dueDays != null && dueDays <= 30) status = "due_soon";

  return {
    version: 1,
    records,
    admissionMissing,
    lastValidExamDate,
    nextPeriodicDue,
    status,
    periodicityMonths: 24,
    updatedAt: nowIso,
  };
}

function familyDocumentKinds(documentTypeCode: string | null | undefined, extractedFields: Record<string, unknown>): FamilyDocumentKind[] {
  const kinds = new Set<FamilyDocumentKind>();
  if (documentTypeCode === "DEPENDENT_DOCUMENT") kinds.add("birth_certificate");
  if (documentTypeCode === "VACCINATION_RECORD") kinds.add("vaccination");
  if (documentTypeCode === "SCHOOL_ATTENDANCE") kinds.add("school_attendance");
  if (documentTypeCode === "FAMILY_SALARY_TERM") kinds.add("responsibility_term");
  if (extractedFields.vaccinationRecordDetected === true) kinds.add("vaccination");
  if (extractedFields.schoolAttendanceDetected === true) kinds.add("school_attendance");
  if (extractedFields.responsibilityTermDetected === true) kinds.add("responsibility_term");
  return Array.from(kinds);
}

function extractedDependents(fields: Record<string, unknown>): Array<{ name: string | null; birthDate: string | null; cpf?: string | null; rg?: string | null; relationship?: string | null }> {
  const fromArray = Array.isArray(fields.dependents)
    ? fields.dependents
        .filter(isRecord)
        .map((item) => ({
          name: text(item.name),
          birthDate: dateOnly(item.birthDate),
          cpf: digits(item.cpf),
          rg: text(item.rg),
          relationship: text(item.relationship),
        }))
    : [];

  const single = {
    name: text(fields.dependentName),
    birthDate: dateOnly(fields.dependentBirthDate),
    cpf: digits(fields.dependentCpf),
    rg: text(fields.dependentRg),
    relationship: "Filho(a)",
  };

  const merged = [...fromArray];
  if (single.name || single.birthDate || single.cpf || single.rg) merged.push(single);

  const seen = new Set<string>();
  return merged.filter((dependent) => {
    const key = dependent.cpf || `${normalizedToken(dependent.name)}|${dependent.birthDate ?? ""}`;
    if (!key.trim() || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function dependentKey(dependent: { name: string | null; birthDate: string | null; cpf?: string | null }) {
  return dependent.cpf || `${normalizedToken(dependent.name)}|${dependent.birthDate ?? "sem-data"}`;
}

function dependentAgeYears(birthDate: string | null) {
  if (!birthDate) return null;
  const birth = new Date(`${birthDate}T12:00:00.000Z`);
  if (!Number.isFinite(birth.getTime())) return null;
  const today = new Date();
  let years = today.getUTCFullYear() - birth.getUTCFullYear();
  const monthDiff = today.getUTCMonth() - birth.getUTCMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getUTCDate() < birth.getUTCDate())) years -= 1;
  return years;
}

function requiredFamilyDocuments(birthDate: string | null): FamilyDocumentKind[] {
  const age = dependentAgeYears(birthDate);
  if (age == null) return ["birth_certificate"];
  if (age < 0 || age >= 14) return [];
  if (age < 4) return ["birth_certificate", "vaccination"];
  if (age < 7) return ["birth_certificate", "vaccination", "school_attendance"];
  return ["birth_certificate", "school_attendance"];
}

function buildFamilySalarySummary(input: {
  current: unknown;
  documentTypeCode?: string | null;
  extractedFields: Record<string, unknown>;
  documentId?: string | null;
}): FamilySalarySummary | null {
  const kinds = familyDocumentKinds(input.documentTypeCode, input.extractedFields);
  const dependents = extractedDependents(input.extractedFields);
  const isFamilyDocument = kinds.length > 0 || dependents.length > 0;
  if (!isFamilyDocument) return null;

  const nowIso = new Date().toISOString();
  const current = isRecord(input.current) ? input.current : {};
  const currentDependents = Array.isArray(current.dependents) ? current.dependents : [];
  const byKey = new Map<string, FamilySalarySummary["dependents"][number]>();

  currentDependents.filter(isRecord).forEach((item) => {
    const key = typeof item.key === "string" ? item.key : dependentKey({ name: text(item.name), birthDate: dateOnly(item.birthDate), cpf: digits(item.cpf) });
    byKey.set(key, {
      key,
      name: text(item.name),
      birthDate: dateOnly(item.birthDate),
      cpf: digits(item.cpf),
      rg: text(item.rg),
      relationship: text(item.relationship),
      documents: isRecord(item.documents) ? item.documents as FamilySalarySummary["dependents"][number]["documents"] : {},
      entitlementEndsAt: dateOnly(item.entitlementEndsAt),
    });
  });

  const documentKinds = kinds.length > 0 ? kinds : (["birth_certificate"] as FamilyDocumentKind[]);
  dependents.forEach((dependent) => {
    const key = dependentKey(dependent);
    const previous = byKey.get(key);
    const birthDate = dependent.birthDate ?? previous?.birthDate ?? null;
    const documents = { ...(previous?.documents ?? {}) };
    documentKinds.forEach((kind) => {
      documents[kind] = {
        documentId: input.documentId ?? documents[kind]?.documentId ?? null,
        documentTypeCode: input.documentTypeCode ?? documents[kind]?.documentTypeCode ?? null,
        updatedAt: nowIso,
      };
    });
    if (input.documentTypeCode === "DEPENDENT_DOCUMENT" || birthDate) {
      documents.birth_certificate = {
        documentId: input.documentId ?? documents.birth_certificate?.documentId ?? null,
        documentTypeCode: input.documentTypeCode ?? documents.birth_certificate?.documentTypeCode ?? null,
        updatedAt: nowIso,
      };
    }
    byKey.set(key, {
      key,
      name: dependent.name ?? previous?.name ?? null,
      birthDate,
      cpf: dependent.cpf ?? previous?.cpf ?? null,
      rg: dependent.rg ?? previous?.rg ?? null,
      relationship: dependent.relationship ?? previous?.relationship ?? null,
      documents,
      entitlementEndsAt: birthDate ? addMonths(birthDate, 14 * 12) : null,
    });
  });

  const nextDependents = Array.from(byKey.values()).sort((left, right) => {
    const leftName = left.name ?? "";
    const rightName = right.name ?? "";
    return leftName.localeCompare(rightName, "pt-BR") || (left.birthDate ?? "").localeCompare(right.birthDate ?? "");
  });

  let eligibleDependentsCount = 0;
  let pendingDependentsCount = 0;
  const notes: string[] = [];

  nextDependents.forEach((dependent) => {
    const age = dependentAgeYears(dependent.birthDate);
    if (age == null) {
      pendingDependentsCount += 1;
      notes.push(`${dependent.name ?? "Filho"} precisa de data de nascimento para cálculo.`);
      return;
    }
    if (age < 0 || age >= 14) return;
    const missing = requiredFamilyDocuments(dependent.birthDate).filter((kind) => !dependent.documents[kind]);
    if (missing.length === 0) eligibleDependentsCount += 1;
    else pendingDependentsCount += 1;
  });

  const status: FamilySalarySummary["status"] =
    eligibleDependentsCount > 0
      ? "eligible_ready"
      : pendingDependentsCount > 0
        ? "pending_documents"
        : nextDependents.length > 0
          ? "no_eligible_dependents"
          : "needs_review";

  return {
    version: 1,
    dependents: nextDependents,
    eligibleDependentsCount,
    pendingDependentsCount,
    status,
    salaryLimit: FAMILY_SALARY_LIMIT_2026,
    notes,
    updatedAt: nowIso,
  };
}

function summaryDisplay(value: unknown, fallback: string) {
  if (!value) return "";
  if (isRecord(value) && Array.isArray(value.records)) {
    return `${value.records.length} ASO(s) registrados`;
  }
  if (isRecord(value) && Array.isArray(value.dependents)) {
    return `${value.dependents.length} filho(s) registrados`;
  }
  return fallback;
}

async function readFieldDoc(employeeDoc: FirebaseFirestore.QueryDocumentSnapshot, fieldKey: string) {
  const snap = await employeeDoc.ref.collection("field_values").doc(fieldKey).get();
  return snap.exists ? snap.data() ?? {} : {};
}

async function writeFieldValue(input: {
  employeeDoc: FirebaseFirestore.QueryDocumentSnapshot;
  fieldKey: string;
  value: unknown;
  actorId: string;
  actorName?: string | null;
  documentId?: string | null;
  traceId?: string | null;
  now: Timestamp;
}) {
  const fieldType = DEFAULT_COMPLEMENTARY_FIELDS[input.fieldKey]?.type ?? "text";
  const fieldValue = buildFieldValue(input.fieldKey, input.value, fieldType, input.actorId, input.now);
  if (!fieldValue) return false;

  const fieldRef = input.employeeDoc.ref.collection("field_values").doc(input.fieldKey);
  const previous = await fieldRef.get();
  const oldValue = previous.exists ? readFieldValue(previous.data() ?? {}) : null;
  await fieldRef.set(fieldValue, { merge: true });
  await hrDbAdmin.collection("audit_log").add({
    employee_id: input.employeeDoc.id,
    field_key: input.fieldKey,
    old_value: oldValue,
    new_value: input.value,
    changed_by: input.actorId,
    changed_by_name: input.actorName ?? null,
    changed_at: input.now,
    source: "document_upload",
    document_id: input.documentId ?? null,
    trace_id: input.traceId ?? null,
  });
  return true;
}

export async function buildEmployeeProfileSuggestions(input: {
  employeeId: string;
  documentTypeCode?: string | null;
  extractedFields: Record<string, unknown>;
  fieldConfidences?: Record<string, number>;
  minimumConfidence?: number;
}): Promise<EmployeeProfileSuggestion[]> {
  const employeeDoc = await loadEmployeeDoc(input.employeeId);
  if (!employeeDoc) return [];

  const suggestions: EmployeeProfileSuggestion[] = [];
  const minimumConfidence = input.minimumConfidence ?? 0.85;

  for (const mapping of FIELD_MAPPINGS) {
    const extractedRaw = input.extractedFields[mapping.extractedField];
    const extractedComparable = mapping.normalize(extractedRaw);
    if (!extractedComparable) continue;

    const confidence = input.fieldConfidences?.[mapping.extractedField];
    if (typeof confidence === "number" && confidence < minimumConfidence) continue;

    const fieldSnap = await employeeDoc.ref.collection("field_values").doc(mapping.fieldKey).get();
    const currentRaw = fieldSnap.exists ? readFieldValue(fieldSnap.data() ?? {}) : null;
    const currentComparable = mapping.normalize(currentRaw);

    if (!currentComparable) {
      suggestions.push({
        fieldKey: mapping.fieldKey,
        fieldLabel: mapping.label,
        section: mapping.section,
        extractedField: mapping.extractedField,
        extractedValue: displayValue(extractedRaw),
        currentValue: null,
        confidence: typeof confidence === "number" ? confidence : 1,
        status: "MISSING_IN_PROFILE",
      });
      continue;
    }

    if (currentComparable !== extractedComparable) {
      suggestions.push({
        fieldKey: mapping.fieldKey,
        fieldLabel: mapping.label,
        section: mapping.section,
        extractedField: mapping.extractedField,
        extractedValue: displayValue(extractedRaw),
        currentValue: displayValue(currentRaw),
        confidence: typeof confidence === "number" ? confidence : 1,
        status: "DIVERGENT",
      });
      continue;
    }

    suggestions.push({
      fieldKey: mapping.fieldKey,
      fieldLabel: mapping.label,
      section: mapping.section,
      extractedField: mapping.extractedField,
      extractedValue: displayValue(extractedRaw),
      currentValue: displayValue(currentRaw),
      confidence: typeof confidence === "number" ? confidence : 1,
      status: "MATCHING_PROFILE",
    });
  }

  const currentAso = await readFieldDoc(employeeDoc, ASO_SUMMARY_FIELD);
  const nextAso = buildAsoSummaryFromRecord({
    current: readJsonValue(currentAso),
    documentTypeCode: input.documentTypeCode,
    extractedFields: input.extractedFields,
  });
  if (nextAso) {
    const currentRaw = readJsonValue(currentAso);
    const hasSameRecord = isRecord(currentRaw) && Array.isArray(currentRaw.records)
      ? currentRaw.records.some((record) => isRecord(record) && record.type === asoTypeFrom(input.documentTypeCode, input.extractedFields) && record.examDate === nextAso.records[0]?.examDate)
      : false;
    suggestions.push({
      fieldKey: ASO_SUMMARY_FIELD,
      fieldLabel: fieldLabel(ASO_SUMMARY_FIELD, "Resumo de ASOs"),
      section: fieldSection(ASO_SUMMARY_FIELD, "Controle de ASOs"),
      extractedField: "examDate",
      extractedValue: `${input.documentTypeCode ?? "ASO"} · ${nextAso.records[0]?.examDate ?? ""}`,
      currentValue: currentRaw ? summaryDisplay(currentRaw, "") : null,
      confidence: input.fieldConfidences?.examDate ?? 1,
      status: hasSameRecord ? "MATCHING_PROFILE" : currentRaw ? "DIVERGENT" : "MISSING_IN_PROFILE",
    });
  }

  const currentFamily = await readFieldDoc(employeeDoc, FAMILY_SALARY_SUMMARY_FIELD);
  const nextFamily = buildFamilySalarySummary({
    current: readJsonValue(currentFamily),
    documentTypeCode: input.documentTypeCode,
    extractedFields: input.extractedFields,
  });
  if (nextFamily) {
    const currentRaw = readJsonValue(currentFamily);
    suggestions.push({
      fieldKey: FAMILY_SALARY_SUMMARY_FIELD,
      fieldLabel: fieldLabel(FAMILY_SALARY_SUMMARY_FIELD, "Resumo do salário-família"),
      section: fieldSection(FAMILY_SALARY_SUMMARY_FIELD, "Salário-família"),
      extractedField: "dependents",
      extractedValue: `${nextFamily.dependents.length} filho(s) no controle`,
      currentValue: currentRaw ? summaryDisplay(currentRaw, "") : null,
      confidence: input.fieldConfidences?.dependents ?? 1,
      status: currentRaw ? "DIVERGENT" : "MISSING_IN_PROFILE",
    });
  }

  return suggestions;
}

export async function applyEmployeeProfileSuggestions(input: {
  employeeId: string;
  documentTypeCode?: string | null;
  extractedFields: Record<string, unknown>;
  fieldConfidences?: Record<string, number>;
  actorId: string;
  actorName?: string | null;
  documentId?: string | null;
  traceId?: string | null;
  minimumConfidence?: number;
}): Promise<{
  suggestions: EmployeeProfileSuggestion[];
  filledFields: number;
  divergentFields: number;
  matchingFields: number;
  profileCompletion: number | null;
}> {
  const employeeDoc = await loadEmployeeDoc(input.employeeId);
  if (!employeeDoc) {
    return { suggestions: [], filledFields: 0, divergentFields: 0, matchingFields: 0, profileCompletion: null };
  }

  const now = Timestamp.now();
  const suggestions: EmployeeProfileSuggestion[] = [];
  const minimumConfidence = input.minimumConfidence ?? 0.85;
  let filledFields = 0;
  let divergentFields = 0;
  let matchingFields = 0;

  for (const mapping of FIELD_MAPPINGS) {
    const extractedRaw = input.extractedFields[mapping.extractedField];
    const extractedComparable = mapping.normalize(extractedRaw);
    if (!extractedComparable) continue;

    const confidence = input.fieldConfidences?.[mapping.extractedField];
    if (typeof confidence === "number" && confidence < minimumConfidence) continue;

    const fieldRef = employeeDoc.ref.collection("field_values").doc(mapping.fieldKey);
    const fieldSnap = await fieldRef.get();
    const currentRaw = fieldSnap.exists ? readFieldValue(fieldSnap.data() ?? {}) : null;
    const currentComparable = mapping.normalize(currentRaw);
    const baseSuggestion = {
      fieldKey: mapping.fieldKey,
      fieldLabel: mapping.label,
      section: mapping.section,
      extractedField: mapping.extractedField,
      extractedValue: displayValue(extractedRaw),
      currentValue: currentComparable ? displayValue(currentRaw) : null,
      confidence: typeof confidence === "number" ? confidence : 1,
    };

    if (!currentComparable) {
      const fieldType = DEFAULT_COMPLEMENTARY_FIELDS[mapping.fieldKey]?.type ?? "text";
      const storedValue = buildStoredValue(mapping, extractedRaw, extractedComparable);
      const fieldValue = buildFieldValue(mapping.fieldKey, storedValue, fieldType, input.actorId, now);
      if (!fieldValue) continue;

      await fieldRef.set(fieldValue, { merge: true });
      await hrDbAdmin.collection("audit_log").add({
        employee_id: employeeDoc.id,
        field_key: mapping.fieldKey,
        old_value: null,
        new_value: storedValue,
        changed_by: input.actorId,
        changed_by_name: input.actorName ?? null,
        changed_at: now,
        source: "document_upload",
        document_id: input.documentId ?? null,
        trace_id: input.traceId ?? null,
      });
      filledFields += 1;
      suggestions.push({ ...baseSuggestion, status: "FILLED_FROM_DOCUMENT" });
      continue;
    }

    if (currentComparable !== extractedComparable) {
      divergentFields += 1;
      suggestions.push({ ...baseSuggestion, status: "DIVERGENT" });
      continue;
    }

    matchingFields += 1;
    suggestions.push({ ...baseSuggestion, status: "MATCHING_PROFILE" });
  }

  const currentAso = await readFieldDoc(employeeDoc, ASO_SUMMARY_FIELD);
  const nextAso = buildAsoSummaryFromRecord({
    current: readJsonValue(currentAso),
    documentTypeCode: input.documentTypeCode,
    extractedFields: input.extractedFields,
    documentId: input.documentId ?? null,
  });
  if (nextAso) {
    const wrote = await writeFieldValue({
      employeeDoc,
      fieldKey: ASO_SUMMARY_FIELD,
      value: nextAso,
      actorId: input.actorId,
      actorName: input.actorName,
      documentId: input.documentId,
      traceId: input.traceId,
      now,
    });
    if (wrote) filledFields += 1;

    const asoType = asoTypeFrom(input.documentTypeCode, input.extractedFields);
    const examDate = dateOnly(input.extractedFields.examDate);
    const directField = asoType === "admission"
      ? "employee.aso_admission_date"
      : asoType === "dismissal"
        ? "employee.aso_dismissal_date"
        : null;
    if (directField && examDate) {
      const directSnap = await readFieldDoc(employeeDoc, directField);
      if (!readFieldValue(directSnap)) {
        const wroteDirect = await writeFieldValue({
          employeeDoc,
          fieldKey: directField,
          value: examDate,
          actorId: input.actorId,
          actorName: input.actorName,
          documentId: input.documentId,
          traceId: input.traceId,
          now,
        });
        if (wroteDirect) filledFields += 1;
      }
    }
    if (asoType === "periodic" && examDate) {
      const first = await readFieldDoc(employeeDoc, "employee.aso_periodic_1");
      const second = await readFieldDoc(employeeDoc, "employee.aso_periodic_2");
      const firstValue = dateOnly(readFieldValue(first));
      const secondValue = dateOnly(readFieldValue(second));
      const targetField = !firstValue || firstValue === examDate
        ? "employee.aso_periodic_1"
        : !secondValue || secondValue === examDate
          ? "employee.aso_periodic_2"
          : null;
      if (targetField) {
        const wrotePeriodic = await writeFieldValue({
          employeeDoc,
          fieldKey: targetField,
          value: examDate,
          actorId: input.actorId,
          actorName: input.actorName,
          documentId: input.documentId,
          traceId: input.traceId,
          now,
        });
        if (wrotePeriodic && (!firstValue || !secondValue)) filledFields += 1;
      }
    }
    suggestions.push({
      fieldKey: ASO_SUMMARY_FIELD,
      fieldLabel: fieldLabel(ASO_SUMMARY_FIELD, "Resumo de ASOs"),
      section: fieldSection(ASO_SUMMARY_FIELD, "Controle de ASOs"),
      extractedField: "examDate",
      extractedValue: `${input.documentTypeCode ?? "ASO"} · ${dateOnly(input.extractedFields.examDate) ?? ""}`,
      currentValue: summaryDisplay(readJsonValue(currentAso), ""),
      confidence: input.fieldConfidences?.examDate ?? 1,
      status: "FILLED_FROM_DOCUMENT",
    });
  }

  const currentFamily = await readFieldDoc(employeeDoc, FAMILY_SALARY_SUMMARY_FIELD);
  const nextFamily = buildFamilySalarySummary({
    current: readJsonValue(currentFamily),
    documentTypeCode: input.documentTypeCode,
    extractedFields: input.extractedFields,
    documentId: input.documentId ?? null,
  });
  if (nextFamily) {
    const wrote = await writeFieldValue({
      employeeDoc,
      fieldKey: FAMILY_SALARY_SUMMARY_FIELD,
      value: nextFamily,
      actorId: input.actorId,
      actorName: input.actorName,
      documentId: input.documentId,
      traceId: input.traceId,
      now,
    });
    if (wrote) filledFields += 1;

    const under14Count = nextFamily.dependents.filter((dependent) => {
      const age = dependentAgeYears(dependent.birthDate);
      return age != null && age >= 0 && age < 14;
    }).length;
    const childrenLabel = under14Count === 0 ? "Nenhum" : under14Count >= 4 ? "4 ou mais" : String(under14Count);
    const familyFields: Array<{ key: string; value: unknown }> = [
      { key: "employee.children_under_14", value: childrenLabel },
      { key: "employee.children", value: nextFamily.dependents },
      { key: "employee.has_family_salary", value: nextFamily.eligibleDependentsCount > 0 },
    ];

    for (const familyField of familyFields) {
      const wroteFamilyField = await writeFieldValue({
        employeeDoc,
        fieldKey: familyField.key,
        value: familyField.value,
        actorId: input.actorId,
        actorName: input.actorName,
        documentId: input.documentId,
        traceId: input.traceId,
        now,
      });
      if (wroteFamilyField) filledFields += 1;
    }
    suggestions.push({
      fieldKey: FAMILY_SALARY_SUMMARY_FIELD,
      fieldLabel: fieldLabel(FAMILY_SALARY_SUMMARY_FIELD, "Resumo do salário-família"),
      section: fieldSection(FAMILY_SALARY_SUMMARY_FIELD, "Salário-família"),
      extractedField: "dependents",
      extractedValue: `${nextFamily.dependents.length} filho(s) no controle`,
      currentValue: summaryDisplay(readJsonValue(currentFamily), ""),
      confidence: input.fieldConfidences?.dependents ?? 1,
      status: "FILLED_FROM_DOCUMENT",
    });
  }

  const profileCompletion = filledFields > 0 ? await recalculateProfileCompletion(employeeDoc.ref) : null;
  return { suggestions, filledFields, divergentFields, matchingFields, profileCompletion };
}
