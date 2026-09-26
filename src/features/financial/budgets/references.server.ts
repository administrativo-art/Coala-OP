import "server-only";
import { financialDbAdmin } from "@/lib/firebase-financial-admin";
import { hrDbAdmin } from "@/lib/firebase-rh-admin";
import type { ServerUserContext } from "@/lib/auth-server";
import { canAccessUnit, canAccessUserByUnit, resolveUnitAccess } from "@/lib/unit-access";
import { dbAdmin } from "@/lib/firebase-admin";
import { FieldPath } from "firebase-admin/firestore";
import { AppError } from "@/lib/observability/app-error";
import { BudgetDomainError } from "./errors";
import type { BudgetExpense } from "../lib/budget-consumption";
import { assertBudgetEmployeeEligible, assertCanonicalBudgetPersonLink } from "./references";
import { resolvePersonLink } from "@/features/hr/lib/person-link.server";

export function assertBudgetCenterAccess(actor: ServerUserContext | undefined, center?: FirebaseFirestore.DocumentData) {
  if (!actor || resolveUnitAccess(actor.userDoc, { isDefaultAdmin: actor.isDefaultAdmin }).allUnits) return;
  const units: string[] = center?.unitIds ?? [];
  if (!units.length || !units.every((unitId) => canAccessUnit(actor.userDoc, unitId, { isDefaultAdmin: actor.isDefaultAdmin }))) {
    throw new AppError({ code: "BUDGET_UNIT_FORBIDDEN", kind: "AUTHORIZATION" });
  }
}

export async function resolveBudgetCenter(id?: string | null, actor?: ServerUserContext, transaction?: FirebaseFirestore.Transaction, requireActive = true) {
  if (!id) { assertBudgetCenterAccess(actor); return {}; }
  const ref = financialDbAdmin.collection("resultCenters").doc(id);
  const snapshot = transaction ? await transaction.get(ref) : await ref.get();
  if (!snapshot.exists || !snapshot.get("name") || (requireActive && snapshot.get("active") === false)) {
    throw new BudgetDomainError("Centro inexistente ou inativo. Confira o cadastro.");
  }
  assertBudgetCenterAccess(actor, snapshot.data());
  return { resultCenterId: id, resultCenterName: String(snapshot.get("name")) };
}

function storedDate(value: unknown): string | null {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  if (value && typeof (value as { toDate?: unknown }).toDate === "function") {
    return (value as { toDate: () => Date }).toDate().toISOString().slice(0, 10);
  }
  return null;
}

/** Only selected IDs, minimal identity/eligibility, no personnel directory or sensitive fields. */
export async function resolveBudgetEmployees(ids: string[], month: string, actor?: ServerUserContext) {
  const unique = [...new Set(ids)];
  if (!unique.length) return new Map<string, string>();
  if (unique.length > 100) throw new BudgetDomainError("Limite de 100 pessoas por composição.");
  const result = new Map<string, string>();
  for (const id of unique) {
    const link = await resolvePersonLink(id);
    if (link.userId !== id || !link.employeeDocument || !link.userDocument) {
      throw new BudgetDomainError("Selecione o ID da conta OP com vínculo confiável no RH.");
    }
    if (actor && !canAccessUserByUnit(actor.userDoc, link.userDocument.data()!, { isDefaultAdmin: actor.isDefaultAdmin })) {
      throw new AppError({ code: "BUDGET_PERSON_UNIT_FORBIDDEN", kind: "AUTHORIZATION" });
    }
    const employee = link.employeeDocument;
    assertCanonicalBudgetPersonLink({ requestedId: id, userId: link.userId, employeeId: link.employeeId,
      linkedUserIds: [employee.get("auth_uid"), employee.get("source_user_id")] });
    const [admission, termination] = await hrDbAdmin.getAll(
      employee.ref.collection("field_values").doc("employee.admission_date"),
      hrDbAdmin.collection("terminationActiveByEmployee").doc(id));
    const opAdmission = storedDate(link.userDocument.get("admissionDate"));
    const hrAdmission = storedDate(admission.get("value_date")) ?? storedDate(admission.get("value_text"));
    if (opAdmission && hrAdmission && opAdmission !== hrAdmission) throw new BudgetDomainError("Datas de admissão divergentes entre OP e RH.");
    const name = employee.get("name");
    assertBudgetEmployeeEligible({ exists: employee.exists, status: employee.get("status"),
      name, admissionDate: opAdmission ?? hrAdmission, hasTerminationProcess: termination.exists,
      opIsActive: link.userDocument.get("isActive") }, month);
    if (link.userDocument.get("isActive") === false || link.userDocument.get("status") === "inactive" || link.userDocument.get("status") === "terminated") {
      throw new BudgetDomainError("A conta OP da composição está inativa.");
    }
    result.set(id, String(name));
  }
  return result;
}

/** Minimal OP references, not an HR directory. No polling, bounded cursor pagination. */
export async function listBudgetPersonReferences(actor: ServerUserContext, centerId: string, cursor?: string) {
  await resolveBudgetCenter(centerId, actor);
  const scope = resolveUnitAccess(actor.userDoc, { isDefaultAdmin: actor.isDefaultAdmin });
  if (!scope.allUnits && (!scope.unitIds.length || scope.unitIds.length > 30)) {
    throw new BudgetDomainError("Selecione um perfil com até 30 unidades para esta consulta.");
  }
  const load = async (field?: string) => {
    let query = dbAdmin.collection("users").where("isActive", "==", true);
    if (field) query = query.where(field, "array-contains-any", scope.unitIds);
    query = query.orderBy(FieldPath.documentId()).limit(51);
    if (cursor) query = query.startAfter(cursor);
    return (await query.get()).docs;
  };
  const documents = scope.allUnits ? await load() : (await Promise.all([load("unitIds"), load("assignedKioskIds")])).flat();
  const unique = [...new Map(documents.map((doc) => [doc.id, doc])).values()];
  // Match Firestore's document-ID ordering (code units), not locale collation, for a reliable cursor.
  unique.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const page = unique.slice(0, 50);
  return { people: page.map((doc) => ({ employeeId: doc.id, employeeName: String(doc.get("username") || doc.get("name") || "Colaborador sem nome") })),
    nextCursor: unique.length > 50 ? page.at(-1)!.id : null };
}

/** Resolve only referenced tokens. Ambiguous/deleted names stay unresolved and produce issues. */
export async function resolveBudgetExpenseCenters(expenses: BudgetExpense[], transaction?: FirebaseFirestore.Transaction): Promise<BudgetExpense[]> {
  const tokens = [...new Set(expenses.flatMap((expense) => [expense.resultCenter,
    ...(expense.apportionments ?? []).map((p) => p.resultCenter), ...(expense.personAllocations ?? []).map((p) => p.resultCenter)])
    .filter((token): token is string => Boolean(token)))];
  if (!tokens.length) return expenses;
  if (tokens.length > 200) throw new BudgetDomainError("Limite de 200 referências de centro por apuração. Refine o período.");
  const validIds = tokens.filter((token) => !token.includes("/") && token.length <= 180);
  const byToken = new Map<string, string>();
  if (validIds.length) {
    const refs = validIds.map((id) => financialDbAdmin.collection("resultCenters").doc(id));
    const docs = transaction ? await transaction.getAll(...refs) : await financialDbAdmin.getAll(...refs);
    docs.forEach((doc) => { if (doc.exists) byToken.set(doc.id, doc.id); });
  }
  const names = tokens.filter((token) => !byToken.has(token));
  for (let index = 0; index < names.length; index += 30) {
    const query = financialDbAdmin.collection("resultCenters").where("name", "in", names.slice(index, index + 30)).limit(201);
    const docs = transaction ? await transaction.get(query) : await query.get();
    if (docs.size > 200) throw new BudgetDomainError("Referências de centro ambíguas excedem o limite de consulta.");
    const matches = new Map<string, string[]>();
    docs.forEach((doc) => { const name = String(doc.get("name")); matches.set(name, [...matches.get(name) ?? [], doc.id]); });
    matches.forEach((ids, name) => { if (ids.length === 1) byToken.set(name, ids[0]); });
  }
  const resolve = (value?: string | null) => value ? byToken.get(value) ?? null : null;
  return expenses.map((expense) => ({ ...expense, resultCenter: resolve(expense.resultCenter),
    apportionments: expense.apportionments?.map((part) => ({ ...part, resultCenter: resolve(part.resultCenter) ?? undefined })),
    personAllocations: expense.personAllocations?.map((part) => ({ ...part, resultCenter: resolve(part.resultCenter) })),
  }));
}
