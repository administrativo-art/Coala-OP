import "server-only";

import { Timestamp, type DocumentReference } from "firebase-admin/firestore";

import { dbAdmin } from "@/lib/firebase-admin";
import { kioskIdsForOperationalUnits } from "@/lib/collaborator-operational-selection";
import {
  PdvApiError,
  clonePdvLegalUserAccessToFilial,
  deletePdvLegalUser,
  movePdvLegalUserAccessToFilial,
} from "@/lib/integrations/pdv-legal-admin";
import {
  PdvOperationalUnitSyncError,
  pdvOperationalUnitPatch,
  pdvRemovalPatch,
  type PdvOperationalUnitSyncPlan,
} from "@/features/hr/lib/pdv-operational-unit-sync";

type RecordLike = Record<string, unknown>;

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

/** Unidades ativas com filial do PDV entre as informadas; só elas têm acesso a sincronizar. */
export async function loadPdvUnitIds(unitIds: readonly string[]) {
  const ids = [...new Set(unitIds.filter(Boolean))];
  if (ids.length === 0) return new Set<string>();
  const snaps = await dbAdmin.getAll(...ids.map((id) => dbAdmin.collection("dp_units").doc(id)));
  return new Set(snaps.filter((snap) => snap.exists && snap.get("isArchived") !== true && text(snap.get("pdvFilialId"))).map((snap) => snap.id));
}

/**
 * Os quiosques atribuídos deixam de ser editados à mão: saem das unidades da
 * vigência. Os catálogos de quiosques e unidades são pequenos (um documento por
 * ponto de venda), por isso a leitura integral é limitada e aceitável aqui.
 */
export async function deriveAssignedKioskIds(unitIds: readonly string[]) {
  if (unitIds.length === 0) return [];
  const [kiosks, units] = await Promise.all([
    dbAdmin.collection("kiosks").limit(200).get(),
    dbAdmin.collection("dp_units").limit(300).get(),
  ]);
  return kioskIdsForOperationalUnits(
    unitIds,
    kiosks.docs.map((doc) => ({ id: doc.id, name: text(doc.get("name")), pdvFilialId: text(doc.get("pdvFilialId")) || null })),
    units.docs.map((doc) => ({ id: doc.id, name: text(doc.get("name")), pdvFilialId: text(doc.get("pdvFilialId")) || null })),
  );
}

/**
 * Executa as operações no PDV Legal e devolve o patch dos campos de acesso.
 * Grava a auditoria como pendente antes do efeito externo e como falha quando
 * algo dá errado; quem chama confirma a auditoria junto com a gravação local.
 */
export async function executePdvSyncPlans(params: {
  userRef: DocumentReference;
  user: RecordLike;
  plans: PdvOperationalUnitSyncPlan[];
  actorId: string;
  actorName: string;
  action?: string;
}) {
  const { userRef, plans } = params;
  const targetIds = [...new Set(plans.flatMap((plan) => plan.targetUnitId ? [plan.targetUnitId] : []))];
  const targetSnaps = targetIds.length ? await dbAdmin.getAll(...targetIds.map((id) => dbAdmin.collection("dp_units").doc(id))) : [];
  const targetUnits = new Map(targetSnaps.map((snapshot) => {
    const name = text(snapshot.get("name"));
    const filialId = text(snapshot.get("pdvFilialId"));
    if (!snapshot.exists || snapshot.get("isArchived") === true) {
      throw new PdvOperationalUnitSyncError(`A unidade operacional ${snapshot.id} não foi encontrada ou está arquivada.`);
    }
    if (!filialId) {
      throw new PdvOperationalUnitSyncError(
        `A unidade operacional ${name || snapshot.id} ainda não está vinculada a uma filial do PDV Legal.`,
      );
    }
    return [snapshot.id, { name: name || snapshot.id, filialId }] as const;
  }));

  const auditRef = userRef.collection("systemAccessAudit").doc();
  await auditRef.set({
    action: params.action ?? "pdv_access_unit_sync",
    status: "pending",
    operations: plans.map((plan) => ({
      operation: plan.kind,
      sourceExternalUserId: plan.sourceExternalUserId,
      fromUnitId: plan.sourceUnitId,
      toUnitId: plan.targetUnitId,
      toFilialId: plan.targetUnitId ? targetUnits.get(plan.targetUnitId)?.filialId ?? null : null,
    })),
    actorId: params.actorId,
    actorName: params.actorName,
    requestedAt: Timestamp.now(),
  });

  const results: Array<Record<string, unknown>> = [];
  const patch: RecordLike = {};
  // Uma troca pode devolver outro ID; inclusões seguintes clonam a partir do ID novo.
  const renamed = new Map<string, string>();
  let workingUser = params.user;
  let completedAt: string | null = null;
  try {
    for (const plan of plans) {
      const source = renamed.get(plan.sourceExternalUserId) ?? plan.sourceExternalUserId;
      completedAt = new Date().toISOString();
      if (plan.kind === "remove") {
        await deletePdvLegalUser(source);
        const removal = pdvRemovalPatch({ currentUser: workingUser, externalUserId: source, updatedAt: completedAt });
        workingUser = { ...workingUser, ...removal };
        Object.assign(patch, removal);
        results.push({ operation: "remove", externalUserId: source, unitId: plan.sourceUnitId, status: "completed" });
        continue;
      }
      const targetUnit = targetUnits.get(plan.targetUnitId)!;
      const updated = plan.kind === "move"
        ? await movePdvLegalUserAccessToFilial({ userId: source, filialId: targetUnit.filialId, profileId: plan.profileId })
        : await clonePdvLegalUserAccessToFilial({ sourceUserId: source, filialId: targetUnit.filialId, profileId: plan.profileId });
      if (!updated.profileId) {
        throw new PdvApiError("O PDV Legal não confirmou o perfil preservado após a sincronização de filial.", "USER_PROFILE_NOT_CONFIRMED");
      }
      if (plan.kind === "move" && updated.id !== source) renamed.set(plan.sourceExternalUserId, updated.id);
      const unitPatch = pdvOperationalUnitPatch({
        currentUser: workingUser,
        plan: { ...plan, sourceExternalUserId: source },
        externalUserId: updated.id,
        targetUnitName: targetUnit.name,
        targetFilialId: targetUnit.filialId,
        targetFilialName: targetUnit.name,
        confirmedProfileId: updated.profileId,
        updatedAt: completedAt,
      });
      workingUser = { ...workingUser, ...unitPatch };
      Object.assign(patch, unitPatch);
      results.push({ operation: plan.kind, externalUserId: updated.id, unitId: plan.targetUnitId, filialId: targetUnit.filialId, status: "completed" });
    }
  } catch (error) {
    await auditRef.set({
      status: "failed",
      completedOperations: results,
      failureCode: error instanceof PdvApiError ? error.code : "UNEXPECTED_FAILURE",
      failedAt: Timestamp.now(),
    }, { merge: true }).catch(() => undefined);
    // Operações já concluídas no PDV ficam na auditoria (completedOperations) para a conferência manual.
    throw error;
  }
  return { patch, results, auditRef, completedAt };
}
