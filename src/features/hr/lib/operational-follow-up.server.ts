import "server-only";

import { FieldValue, Timestamp } from "firebase-admin/firestore";

import { dbAdmin } from "@/lib/firebase-admin";
import { PdvApiError } from "@/lib/integrations/pdv-legal-admin";
import {
  PdvOperationalUnitSyncError,
  pdvAccessEnabled,
  planPdvOperationalUnitSyncs,
} from "@/features/hr/lib/pdv-operational-unit-sync";
import { deriveAssignedKioskIds, executePdvSyncPlans, loadPdvUnitIds } from "@/features/hr/lib/pdv-unit-sync.server";

const BATCH_LIMIT = 20;
/** Depois de cinco falhas seguidas a pendência fica parada com o erro visível no cadastro. */
const MAX_ATTEMPTS = 5;

function stringArray(value: unknown) {
  return Array.isArray(value) ? [...new Set(value.filter((item): item is string => typeof item === "string" && item.trim().length > 0))] : [];
}

function failureCode(error: unknown) {
  if (error instanceof PdvApiError) return error.code;
  if (error instanceof PdvOperationalUnitSyncError) return "PDV_MANUAL_REVIEW";
  return "UNEXPECTED_FAILURE";
}

/**
 * Conclui o que a ativação de uma vigência agendada deixa pendente: recalcula os
 * quiosques atribuídos e, com o acesso ao PDV ligado, move, cria ou remove os
 * acessos das unidades que mudaram. Consulta só os cadastros marcados, em lote limitado.
 */
export async function runOperationalFollowUp() {
  const snap = await dbAdmin.collection("users").where("operationalFollowUpPending", "==", true).limit(BATCH_LIMIT).get();
  let processed = 0;
  let failed = 0;
  let blocked = 0;
  for (const doc of snap.docs) {
    const user = doc.data();
    const attempts = typeof user.operationalFollowUpAttempts === "number" ? user.operationalFollowUpAttempts : 0;
    if (attempts >= MAX_ATTEMPTS) { blocked++; continue; }
    const unitIds = stringArray(user.unitIds);
    try {
      const assignedKioskIds = await deriveAssignedKioskIds(unitIds);
      const fromUnitIds = stringArray(user.operationalFollowUpFromUnitIds);
      const before = { ...user, unitIds: fromUnitIds, assignedKioskIds: [] };
      const after = { ...user, unitIds, assignedKioskIds: [] };
      const plans = pdvAccessEnabled(user)
        ? planPdvOperationalUnitSyncs(before, after, { pdvUnitIds: await loadPdvUnitIds([...fromUnitIds, ...unitIds]) })
        : [];
      const execution = plans.length
        ? await executePdvSyncPlans({ userRef: doc.ref, user, plans, actorId: "system", actorName: "Sistema (vigência agendada)" })
        : null;
      await dbAdmin.runTransaction(async (transaction) => {
        const latest = await transaction.get(doc.ref);
        if (JSON.stringify(stringArray(latest.get("unitIds"))) !== JSON.stringify(unitIds)) {
          throw new PdvOperationalUnitSyncError("As unidades mudaram durante o acompanhamento.");
        }
        transaction.update(doc.ref, {
          assignedKioskIds,
          ...(execution?.patch ?? {}),
          operationalFollowUpPending: false,
          operationalFollowUpFromUnitIds: FieldValue.delete(),
          operationalFollowUpAttempts: FieldValue.delete(),
          operationalFollowUpError: null,
        });
        if (execution) {
          transaction.set(execution.auditRef, { status: "completed", completedOperations: execution.results,
            completedAt: Timestamp.now(), confirmedAt: execution.completedAt }, { merge: true });
        }
      });
      processed++;
    } catch (error) {
      failed++;
      await doc.ref.update({
        operationalFollowUpAttempts: attempts + 1,
        operationalFollowUpError: failureCode(error),
      }).catch(() => undefined);
    }
  }
  return { checked: snap.size, processed, failed, blocked };
}
