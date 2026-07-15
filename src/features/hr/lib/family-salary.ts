export const FAMILY_DOCUMENT_LABELS = ["certidão", "vacinação", "frequência escolar"] as const;

export type FamilyDocumentLabel = (typeof FAMILY_DOCUMENT_LABELS)[number];
export type FamilyDocumentStatus = "Enviada" | "Pendente" | "Não exigida";

export type FamilyChildRecord = {
  key?: string;
  name?: string | null;
  birthDate?: string | null;
  cpf?: string | null;
  rg?: string | null;
  relationship?: string | null;
  documents?: Record<string, unknown>;
  entitlementEndsAt?: string | null;
};

export type ChildDraft = {
  key: string;
  name: string;
  birthDate: string;
  cpf: string;
  rg: string;
  documents?: Record<string, unknown>;
};

export type FamilySalaryControlSummary = {
  version?: number;
  dependents?: FamilyChildRecord[];
  eligibleDependentsCount?: number;
  pendingDependentsCount?: number;
  status?: string;
  salaryLimit?: {
    year?: number;
    monthlyRemunerationLimit?: number;
    quotaPerDependent?: number;
  };
  notes?: string[];
  updatedAt?: string;
};

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function parseBirthDate(value?: string | null) {
  if (!value) return null;
  const normalized = value.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return null;
  const date = new Date(`${normalized}T12:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function dependentAge(birthDate?: string | null, today = new Date()) {
  const birth = parseBirthDate(birthDate);
  if (!birth) return null;
  let age = today.getFullYear() - birth.getFullYear();
  const monthDelta = today.getMonth() - birth.getMonth();
  if (monthDelta < 0 || (monthDelta === 0 && today.getDate() < birth.getDate())) age -= 1;
  return age;
}

export function childEntitlementEndsAt(birthDate?: string | null) {
  const date = parseBirthDate(birthDate);
  if (!date) return null;
  date.setFullYear(date.getFullYear() + 14);
  return date.toISOString().slice(0, 10);
}

export function familyRequiredDocs(birthDate?: string | null): FamilyDocumentLabel[] {
  const age = dependentAge(birthDate);
  if (age == null) return ["certidão"];
  if (age < 0 || age >= 14) return [];
  if (age < 4) return ["certidão", "vacinação"];
  if (age < 7) return ["certidão", "vacinação", "frequência escolar"];
  return ["certidão", "frequência escolar"];
}

export function familyDocPresent(documents: Record<string, unknown> | undefined, label: FamilyDocumentLabel) {
  if (!documents) return false;
  if (label === "certidão") return Boolean(documents.birth_certificate);
  if (label === "vacinação") return Boolean(documents.vaccination);
  return Boolean(documents.school_attendance);
}

export function familyDocStatusItems(birthDate: string | null | undefined, documents: Record<string, unknown> | undefined) {
  const required = new Set(familyRequiredDocs(birthDate));
  return FAMILY_DOCUMENT_LABELS.map((label) => {
    const requiredByAge = required.has(label);
    const sent = familyDocPresent(documents, label);
    const status: FamilyDocumentStatus = requiredByAge ? (sent ? "Enviada" : "Pendente") : "Não exigida";
    return { label, status, requiredByAge, sent };
  });
}

export function childRecordKey(name: string | null | undefined, birthDate: string | null | undefined, cpf: string | null | undefined, index: number) {
  const base = [cpf, name, birthDate].map((value) => value?.trim()).filter(Boolean).join("-") || `filho-${index + 1}`;
  return base
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function normalizeChildRecord(value: unknown, index: number): FamilyChildRecord | null {
  if (!isObjectRecord(value)) return null;
  const name = typeof value.name === "string" && value.name.trim() ? value.name.trim() : null;
  const birthDate = typeof value.birthDate === "string" && value.birthDate.trim() ? value.birthDate.slice(0, 10) : null;
  const cpf = typeof value.cpf === "string" && value.cpf.trim() ? value.cpf.trim() : null;
  const rg = typeof value.rg === "string" && value.rg.trim() ? value.rg.trim() : null;
  const relationship = typeof value.relationship === "string" && value.relationship.trim() ? value.relationship.trim() : "Filho(a)";
  const documents = isObjectRecord(value.documents) ? value.documents : {};
  const entitlementEndsAt = typeof value.entitlementEndsAt === "string" && value.entitlementEndsAt.trim()
    ? value.entitlementEndsAt.slice(0, 10)
    : childEntitlementEndsAt(birthDate);
  const key = typeof value.key === "string" && value.key.trim()
    ? value.key.trim()
    : childRecordKey(name, birthDate, cpf, index);

  return { key, name, birthDate, cpf, rg, relationship, documents, entitlementEndsAt };
}

export function childRecordsFromSource(source: unknown[] = []) {
  return source
    .map((item, index) => normalizeChildRecord(item, index))
    .filter((item): item is FamilyChildRecord => Boolean(item));
}

export function childDraftsFromRecords(records: FamilyChildRecord[]) {
  return records.map((record, index) => ({
    key: record.key || childRecordKey(record.name, record.birthDate, record.cpf, index),
    name: record.name ?? "",
    birthDate: record.birthDate ?? "",
    cpf: record.cpf ?? "",
    rg: record.rg ?? "",
    documents: record.documents,
  }));
}

export function emptyChildDraft(index: number): ChildDraft {
  return { key: `filho_${Date.now()}_${index}`, name: "", birthDate: "", cpf: "", rg: "", documents: {} };
}

export function resizeChildDrafts(current: ChildDraft[], count: number) {
  const safeCount = Math.max(0, Math.min(12, Math.trunc(count)));
  if (safeCount <= current.length) return current.slice(0, safeCount);
  return [
    ...current,
    ...Array.from({ length: safeCount - current.length }, (_, index) => emptyChildDraft(current.length + index)),
  ];
}

export function childCountLabel(count: number) {
  if (count <= 0) return "Nenhum";
  if (count >= 4) return "4 ou mais";
  return String(count);
}

export function childRecordsFromDrafts(drafts: ChildDraft[]) {
  return drafts.map((draft, index) => {
    const name = draft.name.trim();
    const birthDate = draft.birthDate.trim();
    const cpf = draft.cpf.trim();
    const rg = draft.rg.trim();
    return {
      key: draft.key || childRecordKey(name, birthDate, cpf, index),
      name: name || null,
      birthDate: birthDate || null,
      cpf: cpf || null,
      rg: rg || null,
      relationship: "Filho(a)",
      documents: draft.documents ?? {},
      entitlementEndsAt: childEntitlementEndsAt(birthDate),
    } satisfies FamilyChildRecord;
  });
}

export function countChildrenUnder14(records: FamilyChildRecord[]) {
  return records.filter((record) => {
    const age = dependentAge(record.birthDate);
    return age == null || (age >= 0 && age < 14);
  }).length;
}

export function buildFamilySalarySummary(previous: FamilySalaryControlSummary | null, records: FamilyChildRecord[]): FamilySalaryControlSummary {
  let eligibleDependentsCount = 0;
  let pendingDependentsCount = 0;
  const notes: string[] = [];

  records.forEach((record) => {
    const age = dependentAge(record.birthDate);
    if (age == null) {
      pendingDependentsCount += 1;
      notes.push(`${record.name ?? "Filho"} precisa de data de nascimento para cálculo.`);
      return;
    }
    if (age < 0 || age >= 14) return;
    const missing = familyRequiredDocs(record.birthDate).filter((label) => !familyDocPresent(record.documents, label));
    if (missing.length === 0) eligibleDependentsCount += 1;
    else {
      pendingDependentsCount += 1;
      notes.push(`${record.name ?? "Filho"} pendente: ${missing.join(", ")}.`);
    }
  });

  const status = eligibleDependentsCount > 0
    ? "eligible_ready"
    : pendingDependentsCount > 0
      ? "pending_documents"
      : records.length > 0
        ? "no_eligible_dependents"
        : "needs_review";

  return {
    version: 1,
    dependents: records,
    eligibleDependentsCount,
    pendingDependentsCount,
    status,
    salaryLimit: previous?.salaryLimit ?? {
      year: 2026,
      monthlyRemunerationLimit: 1980.38,
      quotaPerDependent: 67.54,
    },
    notes,
    updatedAt: new Date().toISOString(),
  };
}
