import { dbAdmin } from "@/lib/firebase-admin";
import { hrDbAdmin } from "@/lib/firebase-rh-admin";
import { DOCUMENT_VARIABLES, formatDocumentVariableValue, type DocumentVariableCatalogEntry } from "@/features/hr/integration/document-variables";
import type { DPVacationRecord, UniformAssignment, UniformEvent } from "@/types";
import type { ConditionalRule } from "@/types/rh";

type RecordValue = Record<string, unknown>;
function record(value: unknown): RecordValue { return value && typeof value === "object" && !Array.isArray(value) ? value as RecordValue : {}; }
function atPath(root: unknown, path: string): unknown { return path.split(".").reduce<unknown>((value, key) => record(value)[key], root); }
function fieldRaw(value: unknown, entry: DocumentVariableCatalogEntry) {
  const data = record(value);
  if (data.value_boolean !== undefined) return data.value_boolean;
  if (data.value_number !== undefined) return entry.fieldType === "currency" ? Number(data.value_number) / 100 : data.value_number;
  if (data.value_date !== undefined) return data.value_date;
  if (data.value_json !== undefined) return data.value_json;
  return data.value_text;
}
function fieldStoredRaw(value: unknown) {
  const data = record(value);
  if (data.value_boolean !== undefined) return data.value_boolean;
  if (data.value_number !== undefined) return data.value_number;
  if (data.value_date !== undefined) return data.value_date;
  if (data.value_json !== undefined) return data.value_json;
  return data.value_text;
}
function setPath(root: RecordValue, path: string, value: unknown) {
  const parts = path.split("."); let cursor = root;
  parts.forEach((part, index) => { if (index === parts.length - 1) cursor[part] = value; else cursor = cursor[part] = record(cursor[part]); });
}

function asIsoDate(value: unknown) {
  if (!value) return null;
  if (typeof value === "string") return value.slice(0, 10);
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "object" && value !== null && typeof (value as { toDate?: unknown }).toDate === "function") {
    const date = ((value as { toDate: () => Date }).toDate());
    return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : null;
  }
  return null;
}

function dateBr(value: unknown) {
  return formatDocumentVariableValue(value, "date_br");
}

function firstText(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return null;
}

function childAge(birthDate: unknown) {
  const iso = asIsoDate(birthDate);
  if (!iso) return null;
  const date = new Date(`${iso}T12:00:00.000Z`);
  if (!Number.isFinite(date.getTime())) return null;
  const today = new Date();
  let age = today.getFullYear() - date.getFullYear();
  const monthDelta = today.getMonth() - date.getMonth();
  if (monthDelta < 0 || (monthDelta === 0 && today.getDate() < date.getDate())) age -= 1;
  return age;
}

function childBirthDate(child: RecordValue) {
  return child.birthDate ?? child.birth_date ?? child.nascimento ?? child.date;
}

function formatUniformItem(item: RecordValue) {
  const quantity = Number(item.quantityInPossession ?? item.quantityDelivered ?? item.quantity ?? 0);
  const pieces = [
    `${quantity > 0 ? quantity : 1}x ${String(item.productName ?? "Uniforme")}`,
    firstText(item.apparelType),
    firstText(item.apparelSize),
    firstText(item.apparelColor),
  ].filter(Boolean);
  return pieces.join(" · ");
}

function fallbackUniformSummary(fieldValues: RecordValue) {
  const lines = [
    ["Camisa", fieldStoredRaw(fieldValues["employee.uniform_shirt_size"]), fieldStoredRaw(fieldValues["employee.uniform_shirt_qty"])],
    ["Calça", fieldStoredRaw(fieldValues["employee.uniform_pants_size"]), null],
    ["Calçado", fieldStoredRaw(fieldValues["employee.uniform_shoe_size"]), null],
    ["Avental", null, fieldStoredRaw(fieldValues["employee.uniform_apron_qty"])],
    ["Faixa", null, fieldStoredRaw(fieldValues["employee.uniform_sash_qty"])],
    ["Boné", null, fieldStoredRaw(fieldValues["employee.uniform_cap_qty"])],
  ].map(([label, size, quantity]) => {
    const details = [size ? `tamanho ${size}` : null, quantity ? `${quantity} entregue(s)` : null].filter(Boolean).join(", ");
    return details ? `${label}: ${details}` : null;
  }).filter(Boolean);
  const lastDelivery = fieldStoredRaw(fieldValues["employee.uniform_last_delivery"]);
  if (lastDelivery) lines.push(`Última entrega: ${dateBr(lastDelivery)}`);
  return lines.join("\n");
}

async function uniformSummary(employeeId: string | null, fieldValues: RecordValue) {
  const fallback = fallbackUniformSummary(fieldValues);
  if (!employeeId) return fallback || "Sem colaborador vinculado para consultar uniformes.";
  try {
    const [assignmentsSnap, eventsSnap] = await Promise.all([
      dbAdmin.collection("uniformAssignments").where("collaboratorUserId", "==", employeeId).get(),
      dbAdmin.collection("uniformEvents").where("collaboratorUserId", "==", employeeId).get(),
    ]);
    const assignments = assignmentsSnap.docs.map((document) => ({ id: document.id, ...document.data() } as UniformAssignment));
    const events = eventsSnap.docs.map((document) => ({ id: document.id, ...document.data() } as UniformEvent));
    const active = assignments.filter((item) => Number(item.quantityInPossession ?? 0) > 0);
    const latestEvent = [...events].sort((left, right) => String(right.occurredAt ?? "").localeCompare(String(left.occurredAt ?? "")))[0];
    const lines: string[] = [];
    if (active.length) lines.push(`Em posse: ${active.map((item) => formatUniformItem(record(item))).join("; ")}.`);
    if (latestEvent) lines.push(`Último movimento: ${latestEvent.eventType} em ${dateBr(latestEvent.occurredAt)}.`);
    if (fallback) lines.push(fallback);
    return lines.join("\n") || "Sem uniformes registrados.";
  } catch {
    return fallback || "Sem uniformes registrados.";
  }
}

async function vacationSummary(employeeId: string | null, user: RecordValue, fieldValues: RecordValue) {
  if (!employeeId) return "Sem colaborador vinculado para consultar férias.";
  try {
    const snap = await dbAdmin.collection("dp_vacations").where("userId", "==", employeeId).get();
    const records = snap.docs.map((document) => ({ id: document.id, ...document.data() } as DPVacationRecord));
    const valid = records.filter((record) => record.status !== "REJECTED");
    const latest = [...valid].sort((left, right) => String(right.startDate ?? right.paymentDate ?? "").localeCompare(String(left.startDate ?? left.paymentDate ?? "")))[0];
    const latestCycle = [...valid].sort((left, right) => String(right.cycleId ?? "").localeCompare(String(left.cycleId ?? "")))[0]?.cycleId;
    const cycleRecords = latestCycle ? valid.filter((record) => record.cycleId === latestCycle) : [];
    const takenDays = cycleRecords.reduce((total, record) => total + Number(record.days ?? 0), 0);
    const admissionDate = user.admissionDate ?? fieldStoredRaw(fieldValues["employee.admission_date"]);
    const lines: string[] = [];
    if (admissionDate) lines.push(`Admissão: ${dateBr(admissionDate)}.`);
    if (latest) {
      const period = latest.startDate && latest.endDate ? ` de ${dateBr(latest.startDate)} a ${dateBr(latest.endDate)}` : "";
      lines.push(`Último registro: ${latest.recordType}${period}, ${latest.days} dia(s), status ${latest.status}.`);
    }
    if (latestCycle) lines.push(`Ciclo ${latestCycle}: ${takenDays} dia(s) lançados, saldo estimado ${Math.max(0, 30 - takenDays)} dia(s).`);
    return lines.join("\n") || "Sem férias registradas.";
  } catch {
    return "Sem férias registradas.";
  }
}

function asoSummary(fieldValues: RecordValue) {
  const items = [
    ["Admissional", fieldStoredRaw(fieldValues["employee.aso_admission_date"])],
    ["Demissional", fieldStoredRaw(fieldValues["employee.aso_dismissal_date"])],
    ["Periódico 1", fieldStoredRaw(fieldValues["employee.aso_periodic_1"])],
    ["Periódico 2", fieldStoredRaw(fieldValues["employee.aso_periodic_2"])],
  ].map(([label, value]) => value ? `${label}: ${dateBr(value)}` : null).filter(Boolean);
  return items.join("\n") || "Sem ASO registrado.";
}

function familySalarySummary(fieldValues: RecordValue) {
  const children = fieldStoredRaw(fieldValues["employee.children"]);
  const rows = Array.isArray(children) ? children.map(record) : [];
  const eligible = rows.filter((child) => {
    const age = childAge(childBirthDate(child));
    return age !== null && age >= 0 && age < 14;
  });
  if (!rows.length) return "Sem dependentes cadastrados para salário-família.";
  const names = eligible.map((child) => firstText(child.name, child.nome, "Dependente")).filter(Boolean);
  return [
    `Dependentes cadastrados: ${rows.length}.`,
    `Elegíveis menores de 14 anos: ${eligible.length}${names.length ? ` (${names.join(", ")})` : ""}.`,
  ].join("\n");
}

async function buildComputed(params: { employeeId: string | null; user: RecordValue; fieldValues: RecordValue }) {
  const [uniforms, vacations] = await Promise.all([
    uniformSummary(params.employeeId, params.fieldValues),
    vacationSummary(params.employeeId, params.user, params.fieldValues),
  ]);
  const children = fieldStoredRaw(params.fieldValues["employee.children"]);
  const under14Count = Array.isArray(children)
    ? children.map(record).filter((child) => {
        const age = childAge(childBirthDate(child));
        return age !== null && age >= 0 && age < 14;
      }).length
    : 0;
  return {
    uniforms: { summary: uniforms },
    vacations: { summary: vacations },
    aso: { summary: asoSummary(params.fieldValues) },
    familySalary: { summary: familySalarySummary(params.fieldValues) },
    children: { under14Count },
  };
}

function conditionMatches(rule: ConditionalRule, actual: unknown) {
  if (rule.operator === "truthy") return Boolean(actual);
  if (rule.operator === "neq") return actual !== rule.value;
  return actual === rule.value;
}

async function referenceLabels(collection: string, value: unknown) {
  const ids = (Array.isArray(value) ? value : [value]).filter((item): item is string => typeof item === "string" && !!item);
  if (!ids.length) return undefined;
  const database = collection.startsWith("dp_") || collection === "profiles" ? dbAdmin : hrDbAdmin;
  const documents = await Promise.all(ids.map((id) => database.collection(collection).doc(id).get()));
  const labels = documents.filter((document) => document.exists).map((document) => String(document.get("name") ?? document.get("label") ?? document.get("publicTitle") ?? document.id));
  return Array.isArray(value) ? labels : labels[0];
}

export async function resolveDocumentData(params: { employeeId?: string | null; onboardingId?: string | null; includeSensitive?: boolean }) {
  const onboardingDocument = params.onboardingId ? await hrDbAdmin.collection("onboardingProcesses").doc(params.onboardingId).get() : null;
  const onboarding = onboardingDocument?.exists ? record(onboardingDocument.data()) : {};
  const employeeId = params.employeeId || String(onboarding.employeeId ?? onboarding.collaboratorUserId ?? "") || null;
  const [employeeDocument, userDocument] = employeeId ? await Promise.all([
    hrDbAdmin.collection("employees").doc(employeeId).get(), dbAdmin.collection("users").doc(employeeId).get(),
  ]) : [null, null];
  const employee = employeeDocument?.exists ? record(employeeDocument.data()) : onboarding;
  const user = userDocument?.exists ? record(userDocument.data()) : { ...record(onboarding.finalizationSettings), email: onboarding.candidateEmail, username: onboarding.candidateName, jobRoleId: onboarding.jobRoleId, shiftDefinitionId: onboarding.shiftDefinitionId };
  const valuesSnapshot = employeeDocument?.exists ? await employeeDocument.ref.collection("field_values").get() : null;
  const fieldValues: RecordValue = Object.fromEntries(valuesSnapshot?.docs.map((document) => [document.id, document.data()]) ?? []);
  const snapshot = record(record(onboarding.integrationV2).snapshot);
  const answers = record(record(onboarding.integrationV2).answers);
  const blocks = Array.isArray(snapshot.blocks) ? snapshot.blocks.map(record) : [];
  blocks.forEach((block) => { if (typeof block.variableKey === "string" && answers[String(block.id)] !== undefined) fieldValues[block.variableKey] = { value_json: answers[String(block.id)] }; });
  const computed: RecordValue = await buildComputed({ employeeId, user, fieldValues });
  const resolved: RecordValue = {};
  const flat: Record<string, unknown> = {};
  const rawFlat: Record<string, unknown> = {};
  const missingRequired: string[] = [];
  const rawCache = new Map<string, unknown>();

  async function rawForEntry(entry: DocumentVariableCatalogEntry) {
    if (rawCache.has(entry.key)) return rawCache.get(entry.key);
    let raw: unknown;
    for (const step of entry.resolution) {
      if (step.source === "field_value") raw = fieldRaw(fieldValues[step.path], entry);
      else if (step.source === "employee_record") raw = atPath(employee, step.path);
      else if (step.source === "user_record") raw = atPath(user, step.path);
      else if (step.source === "onboarding") raw = atPath(onboarding, step.path);
      else if (step.source === "computed") raw = atPath(computed, step.path);
      else if (step.source === "reference" && step.referenceCollection) raw = await referenceLabels(step.referenceCollection, atPath(user, step.path) ?? atPath(employee, step.path));
      if (raw !== undefined && raw !== null && raw !== "") break;
    }
    rawCache.set(entry.key, raw);
    return raw;
  }

  async function conditionalsPass(entry: DocumentVariableCatalogEntry) {
    for (const conditional of entry.conditionals) {
      if (conditional.kind !== "show_if") continue;
      const dependency = DOCUMENT_VARIABLES.find((variable) => variable.key === conditional.field);
      const actual = dependency ? await rawForEntry(dependency) : fieldStoredRaw(fieldValues[conditional.field]);
      if (!conditionMatches(conditional, actual)) return false;
    }
    return true;
  }

  for (const entry of DOCUMENT_VARIABLES) {
    let raw: unknown;
    if (entry.sensitive && !params.includeSensitive) raw = undefined;
    else if (!(await conditionalsPass(entry))) raw = undefined;
    else raw = await rawForEntry(entry);
    if (entry.format === "repeatable") {
      const rows = Array.isArray(raw) ? raw.map(record).map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, key.endsWith("date") ? formatDocumentVariableValue(value, "date_br") : value]))) : [];
      rawFlat[entry.key] = raw;
      flat[entry.key] = rows; setPath(resolved, entry.key, rows);
    } else {
      const formatted = formatDocumentVariableValue(raw, entry.format);
      rawFlat[entry.key] = raw;
      flat[entry.key] = formatted; setPath(resolved, entry.key, formatted);
      if (entry.required && !formatted) missingRequired.push(entry.key);
    }
  }
  return { data: resolved, flat, rawFlat, missingRequired, variableCount: DOCUMENT_VARIABLES.length };
}
