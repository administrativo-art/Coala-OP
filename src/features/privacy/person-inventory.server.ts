import { onboardingOrigin, readOnboardingPerson } from "./onboarding-person";
import { savePersonCursor, readPersonCursor } from "./person-cursor.server";
import { FieldPath } from "firebase-admin/firestore";
import type { ServerUserContext } from "@/lib/auth-server";
import { dbAdmin } from "@/lib/firebase-admin";
import { hrDbAdmin } from "@/lib/firebase-rh-admin";
import { financialDbAdmin } from "@/lib/firebase-financial-admin";
import { repPDbAdmin } from "@/lib/firebase-rep-p-admin";
import { AppError } from "@/lib/observability/app-error";
import { canAccessUnit, canAccessUserByUnit, resolveUnitAccess } from "@/lib/unit-access";
import { hasFormalizationPermission } from "@/lib/hr-formalization-permissions";
import { firestorePersonLookup } from "./person-lookup.server";
import { matchesPersonWorkspace } from "./person-workspace";
import { decodeGroupPosition, encodeGroupPosition, isPersonSourceGroup, ownedGroupParent } from "./person-source-group";
import { PERSON_SOURCES, SOURCE_VALUES, sourceById, type Source } from "./person-inventory";
import { resolveStrictPersonRefs, subjectKey, type SubjectRef } from "./person-subject";

const LIMIT_MAX = 50;
export function canViewPersonSource(actor: ServerUserContext, source: Source): boolean {
  // Validate typed dispatch before the administrator shortcut.
  if (!SOURCE_VALUES.permissionPolicy.includes(source.permissionPolicy) || !SOURCE_VALUES.scopePolicy.includes(source.scopePolicy)) return false;
  if (source.permissionPolicy === "rep-p-location" && (actor.permissions.dp?.view !== true || actor.permissions.dp?.timeRecording?.readLocation !== true)) return false;
  if (source.permissionPolicy === "cursor-private") return false;
  if (actor.isDefaultAdmin) return true;
  switch (source.permissionPolicy) {
    case "admissions": return hasFormalizationPermission(actor.permissions, "view");
    case "people": return actor.permissions.dp?.collaborators?.view === true || actor.permissions.settings?.manageUsers === true;
    // Document visibility has per-type ADMIN_ONLY/HEALTH rules. No aggregate grant can enumerate every type.
    // Actor/signer references may point to another unit's employee document.
    case "documents-admin": return false;
    case "consents": return hasFormalizationPermission(actor.permissions, "consents.view");
    case "assets": return actor.permissions.assets?.view === true;
    case "assets-history": return actor.permissions.assets?.view === true && actor.permissions.assets?.viewHistory === true;
    case "uniforms": return actor.permissions.stock?.uniforms?.view === true;
    case "rep-p": return actor.permissions.dp?.timeRecording?.view === true;
    case "rep-p-location": return actor.permissions.dp?.timeRecording?.view === true && actor.permissions.dp?.timeRecording?.readLocation === true;
    case "schedule-global": return actor.permissions.dp?.schedules?.view === true && resolveUnitAccess(actor.userDoc).allUnits;
    case "requests": return actor.permissions.dp?.requests?.view === true;
    case "vacations": return actor.permissions.dp?.vacation?.viewAll === true;
    case "terminations": return actor.permissions.dp?.collaborators?.terminate === true;
    case "financial": return actor.permissions.financial?.view === true && actor.permissions.financial?.personnelCosts?.view === true && (source.collection !== "bankPaymentRequests" || actor.permissions.financial?.paymentRequests?.view === true);
    case "audit-global": return actor.permissions.dashboard?.audit === true && resolveUnitAccess(actor.userDoc).allUnits;
    case "integrations": return hasFormalizationPermission(actor.permissions, "onboarding.manage");
    case "privacy": return true;
    default: { const unknown: never = source.permissionPolicy; void unknown; return false; }
  }
}
/** Source-native scope fields; financial result centers never become operational units. */
export function canViewPersonRecord(actor: ServerUserContext, source: Source, data: Record<string, unknown> | undefined): boolean {
  // candidateId also holds manual/PJ routing aliases. Check origin before admin bypass.
  if (source.id === "onboarding-candidates" && (!data || onboardingOrigin(data) !== "recruitment")) return false;
  if (!canViewPersonSource(actor, source) || !matchesPersonWorkspace(data, actor.workspace_id, source.scopePolicy !== "finance-workspace")) return false;
  const unit = (value: unknown) => typeof value === "string" && value.length > 0 && canAccessUnit(actor.userDoc, value, { isDefaultAdmin: actor.isDefaultAdmin });
  switch (source.scopePolicy) {
    case "finance-workspace": case "admin-global": case "parent-employee": case "person-workspace-unit": case "record-workspace": return true;
    case "receipt-execution-unit": return unit((data?.snapshot as Record<string, unknown> | undefined)?.executionUnitId);
    case "execution-unit": return unit(data?.executionUnitId);
    case "adjustment-units": {
      const units = data?.unitIds;
      return Array.isArray(units) && units.length > 0 ? units.every(unit) : unit(data?.unitId);
    }
    case "record-workspace-unit": return unit(data?.unitId);
    case "onboarding-person": return Boolean(data && readOnboardingPerson(data, String(data.id))) && (actor.isDefaultAdmin || typeof data?.unitId === "string" && unit(data.unitId));
    case "cursor-protocol": case "classification-receipt": return false;
    default: { const unknown: never = source.scopePolicy; void unknown; return false; }
  }
}
/** Classification rows carry a receipt ID, not a copy of its execution unit. */
export async function canViewPersonSourceRow(actor: ServerUserContext, source: Source, doc: FirebaseFirestore.QueryDocumentSnapshot) {
  if (isPersonSourceGroup(source)) {
    // Collection group: reject any same-named subcollection outside the declared parent, then
    // require the parent's own workspace (subcollection rows carry none). Missing workspace denies.
    const parent = ownedGroupParent(source, doc.ref);
    if (!parent) return false;
    const parentData = (await parent.get()).data();
    if (!parentData || parentData.workspaceId === undefined || !matchesPersonWorkspace(parentData, actor.workspace_id)) return false;
    return canViewPersonRecord(actor, source, { ...doc.data(), id: doc.id, workspaceId: parentData.workspaceId });
  }
  if (source.scopePolicy !== "classification-receipt") return canViewPersonRecord(actor, source, { ...doc.data(), id: doc.id });
  if (!canViewPersonSource(actor, source) || !matchesPersonWorkspace(doc.data(), actor.workspace_id, true)
    || typeof doc.get("receiptId") !== "string" || doc.get("receiptId") !== doc.id) return false;
  const receipt = (await repPDbAdmin.collection("repP_receipts").where(FieldPath.documentId(), "==", doc.id).limit(1).select("workspaceId", "workspace_id", "employeeId", "snapshot.executionUnitId").get()).docs[0];
  if (!receipt) return false;
  const unitId = receipt.get("snapshot.executionUnitId");
  return receipt.exists && matchesPersonWorkspace(receipt.data(), actor.workspace_id) && receipt.get("employeeId") === doc.get("employeeId")
    && typeof unitId === "string" && Boolean(unitId) && canAccessUnit(actor.userDoc, unitId, { isDefaultAdmin: actor.isDefaultAdmin });
}
export const PERSON_SOURCE_READ_BUDGET = 100;
export const PERSON_SOURCE_QUERY_BUDGET = 5;
function invalid(code: string) { return new AppError({ code, kind: "VALIDATION", safeMessage: "Consulta pessoal inválida." }); }

export async function preparePersonInventory(actor: ServerUserContext, ref: SubjectRef) {
  subjectKey(ref);
  const anchorSource = sourceById(ref.namespace === "main.users" ? "accounts" : ref.namespace === "hr.employees" ? "employees" : ref.namespace === "hr.onboardingPersons" ? "onboarding-persons" : "candidates");
  // Privacy visibility does not authorize discovering identities or their equivalents.
  // Deny before any lookup so existing and missing IDs have the same response.
  if (!anchorSource || !canViewPersonSource(actor, anchorSource)) throw new AppError({ code: "PERSON_ANCHOR_FORBIDDEN", kind: "AUTHORIZATION", safeMessage: "Sem permissão para consultar este cadastro." });
  if (ref.namespace === "hr.onboardingPersons") {
    const owned = await firestorePersonLookup.onboardingPerson?.(ref.id);
    if (!owned || !canViewPersonRecord(actor, anchorSource, owned.process)) throw new AppError({ code: "PERSON_SCOPE_UNCONFIRMED", kind: "AUTHORIZATION" });
  }
  const resolution = await resolveStrictPersonRefs(ref, firestorePersonLookup);
  const visibleRefs: SubjectRef[] = [];
  for (const candidate of resolution.refs) {
    if (candidate.namespace === "hr.onboardingPersons") {
      const owned = await firestorePersonLookup.onboardingPerson?.(candidate.id);
      if (!owned || !canViewPersonRecord(actor, sourceById("onboarding-persons")!, owned.process)) {
        if (ref.namespace === "hr.onboardingPersons") throw new AppError({ code: "PERSON_SCOPE_UNCONFIRMED", kind: "AUTHORIZATION" });
        continue; // An inaccessible admission alias does not revoke the account/HR domain.
      }
      visibleRefs.push(candidate);
      continue;
    }
    visibleRefs.push(candidate);
    const anchor = candidate.namespace === "main.users" ? await dbAdmin.collection("users").doc(candidate.id).get()
      : candidate.namespace === "hr.employees" ? await hrDbAdmin.collection("employees").doc(candidate.id).get()
        : await hrDbAdmin.collection("candidates").doc(candidate.id).get();
    if (!matchesPersonWorkspace(anchor.data(), actor.workspace_id, true)) throw new AppError({ code: "PERSON_WORKSPACE_FORBIDDEN", kind: "AUTHORIZATION" });
    if (candidate.namespace === "hr.candidates") {
      const processes = await hrDbAdmin.collection("onboardingProcesses").where("candidateId", "==", candidate.id).limit(21).get();
      if (processes.size === 21 || processes.docs.some((process) => {
        return !matchesPersonWorkspace(process.data(), actor.workspace_id, true);
      })) throw new AppError({ code: "PERSON_WORKSPACE_FORBIDDEN", kind: "AUTHORIZATION" });
    }
  }
  resolution.refs = visibleRefs;
  const userRef = resolution.refs.find((candidate) => candidate.namespace === "main.users");
  const user = userRef ? await dbAdmin.collection("users").doc(userRef.id).get() : null;
  if (!actor.isDefaultAdmin && !user?.exists && ref.namespace !== "hr.onboardingPersons") throw new AppError({ code: "PERSON_SCOPE_UNCONFIRMED", kind: "AUTHORIZATION" });
  if (user?.exists) {
    if (!matchesPersonWorkspace(user.data(), actor.workspace_id, true)) throw new AppError({ code: "PERSON_WORKSPACE_FORBIDDEN", kind: "AUTHORIZATION" });
    if (!canAccessUserByUnit(actor.userDoc, user.data() ?? {}, { isDefaultAdmin: actor.isDefaultAdmin })) {
      throw new AppError({ code: "PERSON_UNIT_FORBIDDEN", kind: "AUTHORIZATION" });
    }
  }
  return { resolution, sources: PERSON_SOURCES.map((source) => canViewPersonSource(actor, source) ? source : { id: source.id, coverage: "restricted" as const }) };
}

function sourceRef(source: Source, refs: SubjectRef[], selected: SubjectRef) {
  if (source.namespace === "subjectKeys") return subjectKey(selected);
  return refs.find((ref) => ref.namespace === source.namespace)?.id ?? null;
}

function referenceItem(doc: FirebaseFirestore.DocumentSnapshot, source: Source) {
  const processFields = ["onboardingId", "signatureRequestId", "sourceGeneratedDocumentId", "sourceOnboardingId", "sourceCustodyTransferId", "sourceAssetId"];
  const links = Object.fromEntries(processFields.flatMap((field) => {
    const value = doc.get(field);
    return typeof value === "string" && value && !value.includes("/") ? [[field, value]] : [];
  }));
  const version = doc.get("version");
  const storageReferences = ["storagePath", "pdfStoragePath", "signedStoragePath"].flatMap((field) => {
    const path = doc.get(field);
    if (typeof path !== "string" || !path) return [];
    const safe = /^(generated-documents|hr\/employee-documents|signed-documents|signature-documents)\/[a-zA-Z0-9/_-]+\.[a-zA-Z0-9]+$/.test(path);
    return [{ field, path: safe ? path : null, available: true }];
  });
  return { id: doc.id, recordPath: doc.ref.path, database: source.database, collection: source.collection, role: source.role,
    links, version: typeof version === "number" || typeof version === "string" ? version : null, storageReferences };
}

export async function collectPersonSource(params: {
  actor: ServerUserContext; sourceId: string; ref: SubjectRef; limit: number; cursor?: string; sourceDb?: FirebaseFirestore.Firestore;
}) {
  const { actor, ref, sourceId } = params;
  const source = sourceById(sourceId);
  if (!source) throw invalid("PERSON_SOURCE_INVALID");
  if (!canViewPersonSource(actor, source)) return { source: { id: source.id }, status: "restricted" as const, items: [], nextCursor: null };
  const prepared = await preparePersonInventory(actor, ref);
  if (source.coverage !== "live") return { source, status: "unavailable" as const, items: [], nextCursor: null, reason: source.reason };
  const value = sourceRef(source, prepared.resolution.refs, ref);
  if (!value) return { source, status: "unlinked" as const, items: [], nextCursor: null, conflicts: prepared.resolution.conflicts };
  const limit = Math.min(LIMIT_MAX, Math.max(1, Math.trunc(params.limit)));
  const db = params.sourceDb ?? (source.database === "main" ? dbAdmin : source.database === "hr" ? hrDbAdmin : source.database === "financial" ? financialDbAdmin : repPDbAdmin);
  try {
    if (source.field === "__name__") {
      const snapshot = await db.collection(source.collection).doc(value).get();
      if (snapshot.exists && !matchesPersonWorkspace(snapshot.data(), actor.workspace_id, true)) throw new AppError({ code: "PERSON_WORKSPACE_FORBIDDEN", kind: "AUTHORIZATION" });
      return { source, status: "complete" as const, items: snapshot.exists ? [referenceItem(snapshot, source)] : [], nextCursor: null, conflicts: prepared.resolution.conflicts };
    }
    const group = isPersonSourceGroup(source);
    const storedCursor = params.cursor ? await readPersonCursor(params.cursor, actor, sourceId, ref, limit) : null;
    const cursorId = storedCursor && group ? decodeGroupPosition(source, storedCursor) : storedCursor;
    if (params.cursor && !cursorId) throw invalid("PERSON_CURSOR_INVALID");
    const collection = source.field === "__parent__"
      ? db.collection("employees").doc(value).collection(source.collection)
      : group ? db.collectionGroup(source.collection) : db.collection(source.collection);
    let query: FirebaseFirestore.Query = collection;
    if (source.field !== "__parent__") query = source.namespace === "subjectKeys" ? query.where(source.field, "array-contains-any", prepared.resolution.refs.map(subjectKey)) : query.where(source.field, "==", value);
    if (source.scopePolicy === "finance-workspace") query = query.where("workspaceId", "==", actor.workspace_id);
    if (source.id.startsWith("financial-") && source.id.endsWith("-payments")) query = query.where("beneficiaryReference.sourceType", "==", "employee").where("sourceType", "==", source.id.split("-")[1]);
    if (source.id === "financial-vacation-expenses") query = query.where("sourceType", "==", "vacation");
    if (source.id === "asset-custody") query = query.where("toHolder.holderType", "==", "employee");
    if (source.id === "asset-former-custody") query = query.where("fromHolder.holderType", "==", "employee");
    if (source.id === "asset-current-custody") query = query.where("custody.holderType", "==", "employee");
    // Use native single-unit predicates when the operator's complete scope fits one query.
    // All-units adjustment authorization still needs row checks for every unitIds member.
    const units = resolveUnitAccess(actor.userDoc, { isDefaultAdmin: actor.isDefaultAdmin });
    const unitField = source.scopePolicy === "receipt-execution-unit" ? "snapshot.executionUnitId" : source.scopePolicy === "execution-unit" ? "executionUnitId" : source.scopePolicy === "record-workspace-unit" ? "unitId" : null;
    if (unitField && !units.allUnits && units.unitIds.length > 0 && units.unitIds.length <= 30) query = query.where(unitField, "in", units.unitIds);
    query = query.orderBy(FieldPath.documentId());
    let position = cursorId;
    let reads = 0, queries = 0, denied = 0, eof = false;
    const items: ReturnType<typeof referenceItem>[] = [];
    while (reads < PERSON_SOURCE_READ_BUDGET && queries < PERSON_SOURCE_QUERY_BUDGET && items.length < limit) {
      const costPerRow = source.scopePolicy === "classification-receipt" || group ? 2 : 1;
      const batchSize = Math.min(Math.floor((PERSON_SOURCE_READ_BUDGET - reads) / costPerRow), Math.max(20, limit));
      if (!batchSize) break;
      const pageQuery = position ? query.startAfter(group ? db.doc(position) : position) : query;
      const snapshot = await pageQuery.limit(batchSize).get();
      queries++; reads += Math.max(1, snapshot.size);
      let processed = 0;
      for (const doc of snapshot.docs) {
        position = group ? doc.ref.path : doc.id; processed++;
        if (source.scopePolicy === "classification-receipt" || group) reads++; // reserve the parent proof conservatively
        // Same-named subcollection of another module: never exposed and not a scope denial (cursor still advances).
        if (group && !ownedGroupParent(source, doc.ref)) continue;
        if (await canViewPersonSourceRow(actor, source, doc)) items.push(referenceItem(doc, source)); else denied++;
        if (items.length === limit) break;
      }
      if (processed === snapshot.size && snapshot.size < batchSize) { eof = true; break; }
    }
    const nextCursor = !eof && position ? await savePersonCursor(actor, sourceId, ref, limit, group ? encodeGroupPosition(position) : position) : null;
    return { source, status: source.reason || denied > 0 || nextCursor ? "partial" as const : "complete" as const,
      items, nextCursor, conflicts: prepared.resolution.conflicts,
      reason: source.reason ?? (nextCursor ? "A consulta tem continuação; carregue mais referências." : denied > 0 ? "Algumas referências não possuem escopo confirmado ou não estão autorizadas nesta consulta." : undefined) };
  } catch (error) {
    if (error instanceof AppError) throw error;
    return { source, status: "failed" as const, items: [], nextCursor: null, reason: "Falha ao consultar a origem; tente novamente.", conflicts: prepared.resolution.conflicts };
  }
}
