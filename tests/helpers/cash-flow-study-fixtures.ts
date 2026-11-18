import type { StudyBatch } from "../../src/features/financial/cash-flow-study/model";
import type { StudyCashEvidence } from "../../src/features/financial/cash-flow-study/cash-stages";
/** Explicit source fixture for scenarios whose boleto was actually issued and remains A_RECEBER. */
export function issuedCashEvidence(batches: StudyBatch[]): StudyCashEvidence {
  return { workspaceId: "coala", sessions: [], gaps: [], bills: batches.filter(batch => batch.status === "issued").map(batch => ({
    id: batch.interCobrancaId!, workspaceId: "coala", batchId: batch.id, status: "issued", situacao: "A_RECEBER", origemRecebimento: null,
    recebidoManual: false, valorNominalCents: batch.totalCents, valorTotalRecebidoCents: 0,
  })) };
}
