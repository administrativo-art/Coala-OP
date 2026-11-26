import "server-only";

import { Timestamp } from "firebase-admin/firestore";

import { financialDbAdmin } from "@/lib/firebase-financial-admin";
import { normalizeBrazilianServiceNumber } from "@/features/financial/inbox/parser";
import { selectProvisionSeriesAmountTarget } from "@/features/financial/provision-series-amount";

const MAX_SERIES_DOCUMENTS = 50;

type Input = {
  workspaceId: string;
  seriesKey: string;
  customerAccount: string;
  serviceNumber: string;
  fromCompetence: string;
  expectedAmountCents: number;
  newAmountCents: number;
  actorId: string;
  dryRun?: boolean;
};

export async function updateProvisionSeriesAmount(input: Input) {
  const serviceNumber = normalizeBrazilianServiceNumber(input.serviceNumber);
  if (!serviceNumber || input.newAmountCents === input.expectedAmountCents) {
    throw new Error("Valor ou linha da série inválidos.");
  }
  const snapshot = await financialDbAdmin.collection("expenses")
    .where("provisionSeriesKey", "==", input.seriesKey).limit(MAX_SERIES_DOCUMENTS + 1).get();
  if (snapshot.size > MAX_SERIES_DOCUMENTS) throw new Error("Série acima do limite; revisão manual necessária.");
  if (snapshot.empty) throw new Error("Série de provisões não encontrada.");

  const result = await financialDbAdmin.runTransaction(async (transaction) => {
    const current = await Promise.all(snapshot.docs.map((document) => transaction.get(document.ref)));
    const targets: Array<{ ref: typeof snapshot.docs[number]["ref"]; competence: string; installments: Array<Record<string, unknown>> }> = [];
    for (const document of current) {
      if (!document.exists) throw new Error("Série alterada durante a conferência.");
      const target = selectProvisionSeriesAmountTarget(document.data() ?? {}, { ...input, serviceNumber });
      if (target) targets.push({ ref: document.ref, ...target });
    }
    if (!targets.length || !targets.some((target) => target.competence === input.fromCompetence)) {
      throw new Error("A provisão inicial não está disponível para ajuste.");
    }
    if (input.dryRun) return targets.map((target) => ({ id: target.ref.id, competence: target.competence }));
    const amount = input.newAmountCents / 100;
    const at = Timestamp.now();
    for (const target of targets) {
      transaction.update(target.ref, {
        totalValue: amount,
        installments: [{ ...target.installments[0], value: amount }],
        updatedAt: at,
        updatedBy: input.actorId,
        provisionAmountAdjustment: {
          previousAmountCents: input.expectedAmountCents,
          newAmountCents: input.newAmountCents,
          at,
          actorId: input.actorId,
        },
      });
    }
    return targets.map((target) => ({ id: target.ref.id, competence: target.competence }));
  });
  return input.dryRun
    ? { targets: result, count: result.length, newAmountCents: input.newAmountCents, dryRun: true }
    : { updated: result, count: result.length, newAmountCents: input.newAmountCents, dryRun: false };
}
