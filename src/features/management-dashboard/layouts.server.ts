import { FieldValue, Timestamp } from "firebase-admin/firestore";

import { dbAdmin } from "@/lib/firebase-admin";
import type { ServerUserContext } from "@/lib/auth-server";

import { createDefaultManagementLayout } from "./default-layout";
import { MAX_USER_DASHBOARDS, dashboardLayoutInputSchema } from "./layout-policy";
import type { DashboardLayoutsPayload, DashboardScope, ManagementDashboardLayout } from "./types";

const COLLECTION = "managementDashboardLayouts";
const PREFERENCES = "managementDashboardPreferences";
const ACTIVE_FIELD: Record<DashboardScope, string> = { management: "activeLayoutId", financial: "activeFinancialLayoutId" };

const scopeOf = (layout: { scope?: DashboardScope }): DashboardScope => layout.scope ?? "management";

export class ManagementDashboardError extends Error {
  constructor(readonly reason: "forbidden" | "conflict" | "limit" | "not-found") {
    super(`Management dashboard operation failed: ${reason}`);
    this.name = "ManagementDashboardError";
  }
}

function iso(value: unknown) {
  if (value instanceof Timestamp) return value.toDate().toISOString();
  if (typeof value === "string") return value;
  return new Date(0).toISOString();
}

function serializeLayout(id: string, value: Record<string, unknown>): ManagementDashboardLayout {
  return {
    ...(value as unknown as ManagementDashboardLayout),
    id,
    createdAt: iso(value.createdAt),
    updatedAt: iso(value.updatedAt),
  };
}

function canReadLayout(actor: ServerUserContext, layout: ManagementDashboardLayout) {
  if (layout.workspaceId !== actor.workspace_id) return false;
  if (layout.ownerId === actor.decoded.uid || actor.isDefaultAdmin) return true;
  if (layout.visibility === "shared") return true;
  return layout.visibility === "template" && (layout.targetProfileIds.length === 0 || (!!actor.profileId && layout.targetProfileIds.includes(actor.profileId)));
}

export async function listManagementLayouts(actor: ServerUserContext, scope: DashboardScope = "management"): Promise<DashboardLayoutsPayload> {
  const [owned, published, preferences] = await Promise.all([
    dbAdmin.collection(COLLECTION).where("workspaceId", "==", actor.workspace_id).where("ownerId", "==", actor.decoded.uid).limit(MAX_USER_DASHBOARDS).get(),
    dbAdmin.collection(COLLECTION).where("workspaceId", "==", actor.workspace_id).where("published", "==", true).limit(MAX_USER_DASHBOARDS).get(),
    dbAdmin.collection(PREFERENCES).doc(actor.decoded.uid).get(),
  ]);
  const unique = new Map<string, ManagementDashboardLayout>();
  for (const snapshot of [...owned.docs, ...published.docs]) {
    const layout = serializeLayout(snapshot.id, snapshot.data());
    if (scopeOf(layout) === scope && canReadLayout(actor, layout)) unique.set(layout.id, layout);
  }
  if (unique.size === 0) {
    const fallback = createDefaultManagementLayout(actor.decoded.uid, actor.userDoc.username ?? actor.decoded.email ?? "Usuário", actor.workspace_id, scope);
    unique.set(fallback.id, fallback);
  }
  const preferred = typeof preferences.get(ACTIVE_FIELD[scope]) === "string" ? preferences.get(ACTIVE_FIELD[scope]) : null;
  return {
    layouts: [...unique.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    activeLayoutId: preferred && unique.has(preferred) ? preferred : unique.keys().next().value ?? null,
    canManageTemplates: actor.isDefaultAdmin || actor.permissions.settings.manageProfiles === true,
  };
}

export async function saveManagementLayout(actor: ServerUserContext, rawInput: unknown) {
  const input = dashboardLayoutInputSchema.parse(rawInput);
  const canManageTemplates = actor.isDefaultAdmin || actor.permissions.settings.manageProfiles === true;
  if (input.visibility !== "personal" && !canManageTemplates) throw new ManagementDashboardError("forbidden");
  const { id: requestedId, expectedRevision, ...safeInput } = input;
  const id = requestedId ?? `layout_${crypto.randomUUID().replaceAll("-", "")}`;
  const ref = dbAdmin.collection(COLLECTION).doc(id);
  await dbAdmin.runTransaction(async (transaction) => {
    const current = await transaction.get(ref);
    if (current.exists) {
      const ownerId = current.get("ownerId");
      const currentVisibility = current.get("visibility");
      if (ownerId !== actor.decoded.uid && (currentVisibility === "personal" || !canManageTemplates)) throw new ManagementDashboardError("forbidden");
      const revision = Number(current.get("revision") ?? 1);
      if (expectedRevision !== undefined && expectedRevision !== revision) throw new ManagementDashboardError("conflict");
      const versionRef = ref.collection("versions").doc(String(revision).padStart(8, "0"));
      transaction.set(versionRef, { ...current.data(), archivedAt: FieldValue.serverTimestamp() });
      transaction.set(ref, {
        ...safeInput,
        ownerId,
        ownerName: current.get("ownerName") ?? actor.userDoc.username ?? "Usuário",
        workspaceId: actor.workspace_id,
        published: safeInput.visibility !== "personal",
        schemaVersion: 1,
        revision: revision + 1,
        createdAt: current.get("createdAt") ?? FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: actor.decoded.uid,
      });
      return;
    }
    const ownedQuery = dbAdmin.collection(COLLECTION).where("workspaceId", "==", actor.workspace_id).where("ownerId", "==", actor.decoded.uid).limit(MAX_USER_DASHBOARDS);
    const owned = await transaction.get(ownedQuery);
    if (owned.size >= MAX_USER_DASHBOARDS) throw new ManagementDashboardError("limit");
    transaction.create(ref, {
      ...safeInput,
      ownerId: actor.decoded.uid,
      ownerName: actor.userDoc.username ?? actor.decoded.email ?? "Usuário",
      workspaceId: actor.workspace_id,
      published: safeInput.visibility !== "personal",
      schemaVersion: 1,
      revision: 1,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: actor.decoded.uid,
    });
  });
  await dbAdmin.collection(PREFERENCES).doc(actor.decoded.uid).set({ [ACTIVE_FIELD[input.scope]]: id, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  const saved = await ref.get();
  return serializeLayout(saved.id, saved.data() ?? {});
}

export async function setActiveManagementLayout(actor: ServerUserContext, layoutId: string) {
  const snapshot = await dbAdmin.collection(COLLECTION).doc(layoutId).get();
  if (!snapshot.exists) throw new ManagementDashboardError("not-found");
  const layout = serializeLayout(snapshot.id, snapshot.data() ?? {});
  if (!canReadLayout(actor, layout)) throw new ManagementDashboardError("forbidden");
  await dbAdmin.collection(PREFERENCES).doc(actor.decoded.uid).set({ [ACTIVE_FIELD[scopeOf(layout)]]: layoutId, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
}

export async function deleteManagementLayout(actor: ServerUserContext, layoutId: string) {
  const ref = dbAdmin.collection(COLLECTION).doc(layoutId);
  const snapshot = await ref.get();
  if (!snapshot.exists) return;
  const canManageTemplates = actor.isDefaultAdmin || actor.permissions.settings.manageProfiles === true;
  if (snapshot.get("ownerId") !== actor.decoded.uid && (snapshot.get("visibility") === "personal" || !canManageTemplates)) throw new ManagementDashboardError("forbidden");
  await dbAdmin.recursiveDelete(ref);
}
