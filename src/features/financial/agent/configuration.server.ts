import "server-only";
import { FieldPath, Timestamp } from "firebase-admin/firestore";
import { dbAdmin } from "@/lib/firebase-admin";
import { financialDbAdmin } from "@/lib/firebase-financial-admin";
import { AppError } from "@/lib/observability/app-error";
import { financialAgentMappingSchema } from "./contracts";
import { validateFinancialAgentReferences } from "./mapping";
import { assertMappingSave, mappingSaveSchema, type MappingView } from "./configuration";

function mappingView(id: string, data: FirebaseFirestore.DocumentData): MappingView {
  const parsed = financialAgentMappingSchema.safeParse({ ...data, id });
  if (!parsed.success) throw new AppError({ code: "STONE_MAPPING_INVALID", kind: "EXPECTED_BUSINESS",
    safeMessage: "Há um vínculo legado inválido. Revise o cadastro antes de continuar." });
  return { ...parsed.data, revision: Number.isSafeInteger(data.revision) && data.revision >= 0 ? data.revision : 0,
    kioskName: typeof data.kioskName === "string" ? data.kioskName : parsed.data.kioskId,
    accountName: typeof data.accountName === "string" ? data.accountName : parsed.data.accountId };
}

export async function listStoneMappingCatalog(workspaceId: string, resource: "mappings" | "units" | "accounts", cursor?: string) {
  const collection = resource === "units" ? dbAdmin.collection("kiosks")
    : financialDbAdmin.collection(resource === "accounts" ? "bankAccounts" : "stoneMerchantMappings");
  // Operational kiosks are a single-workspace legacy catalog; paginated, never a global provider.
  let query: FirebaseFirestore.Query = resource === "units" ? collection : collection.where("workspaceId", "==", workspaceId);
  query = query.orderBy(FieldPath.documentId()).limit(51);
  if (cursor) query = query.startAfter(cursor);
  const snapshot = await query.get();
  const docs = snapshot.docs.slice(0, 50);
  return { items: docs.filter(doc => resource !== "units" || !doc.data().workspaceId || doc.data().workspaceId === workspaceId).map(doc =>
    resource === "mappings" ? mappingView(doc.id, doc.data()) : { id: doc.id, name: String(doc.data().name || doc.id) }),
  nextCursor: snapshot.size > 50 ? docs.at(-1)!.id : null };
}

export async function saveStoneMapping(input: unknown, workspaceId: string, actorId: string) {
  const parsed = mappingSaveSchema.safeParse(input);
  if (!parsed.success) throw new AppError({ code: "STONE_MAPPING_INPUT_INVALID", kind: "VALIDATION" });
  const draft = parsed.data;
  const [kiosk, account] = await Promise.all([
    dbAdmin.collection("kiosks").doc(draft.kioskId).get(),
    financialDbAdmin.collection("bankAccounts").doc(draft.accountId).get(),
  ]);
  validateFinancialAgentReferences(kiosk.data(), account.data(), workspaceId);
  const candidate = financialAgentMappingSchema.parse({ ...draft, workspaceId, terminalIds: [] });
  const ref = financialDbAdmin.collection("stoneMerchantMappings").doc(draft.id);
  const query = financialDbAdmin.collection("stoneMerchantMappings").where("workspaceId", "==", workspaceId).limit(101);
  return financialDbAdmin.runTransaction(async transaction => {
    const snapshot = await transaction.get(query);
    // Direct read detects an ID collision in another workspace before any write.
    const target = await transaction.get(ref);
    if (target.exists && target.data()?.workspaceId !== workspaceId) throw new AppError({ code: "STONE_MAPPING_FORBIDDEN", kind: "AUTHORIZATION" });
    const existing = snapshot.docs.map(doc => mappingView(doc.id, doc.data()));
    const current = target.exists ? mappingView(target.id, target.data()!) : null;
    if (current?.terminalIds.length) throw new AppError({ code: "STONE_MAPPING_TERMINAL_UNSUPPORTED", kind: "EXPECTED_BUSINESS",
      safeMessage: "Vínculos por terminal devem ser revisados na integração especializada." });
    assertMappingSave(candidate, existing, draft.revision, current?.revision ?? null);
    const saved: MappingView = { ...candidate, revision: (current?.revision ?? 0) + 1,
      kioskName: String(kiosk.data()?.name || draft.kioskId), accountName: String(account.data()?.name || draft.accountId) };
    const now = Timestamp.now();
    transaction.set(ref, { ...saved, updatedAt: now, updatedBy: actorId,
      ...(!target.exists ? { createdAt: now, createdBy: actorId } : {}) }, { merge: true });
    transaction.set(ref.collection("events").doc(), { type: current ? "updated" : "created", before: current,
      after: saved, reason: draft.reason, actorId, createdAt: now });
    return saved;
  }, { maxAttempts: 3 });
}
