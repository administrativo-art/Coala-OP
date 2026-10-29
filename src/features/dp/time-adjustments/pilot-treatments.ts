import type { AdjustmentKind } from './core';

type PilotOperation = {
  kind: AdjustmentKind;
  target: { receiptId: string } | null;
  inclusion: { markedAt: string; executionUnitId: string } | null;
};
/** Só o que a leitura do ensaio precisa de um pedido de simulação. */
export type PilotTreatmentSource = PilotOperation & {
  id: string;
  workDate: string;
  status: string;
  operations?: PilotOperation[];
};
export type PilotTreatment = {
  /** Marca de origem: o tratamento do ensaio nunca se confunde com o oficial. */
  pilot: true;
  id: string;
  adjustmentId: string;
  workDate: string;
  type: 'discard' | 'inclusion';
  originalReceiptId: string | null;
  markedAt: string | null;
  executionUnitId: string | null;
};

/**
 * O pedido aprovado da simulação vira tratamento **derivado**, calculado na leitura: não grava em `ptrp_treatments`, não
 * entra no AEJ, no espelho, no banco nem na folha. A batida original do ensaio nunca é apagada nem alterada. Mesma forma
 * do tratamento oficial para que as telas apliquem o "antes × depois" sem um caminho paralelo.
 */
export function pilotTreatmentsOf(requests: readonly PilotTreatmentSource[]): PilotTreatment[] {
  return requests.filter((request) => request.status === 'approved').flatMap((request) => {
    const operations: PilotOperation[] = request.operations?.length ? request.operations
      : [{ kind: request.kind, target: request.target, inclusion: request.inclusion }];
    const many = operations.length > 1;
    return operations.flatMap((operation, index): PilotTreatment[] => {
      const suffix = many ? `_${index + 1}` : '';
      const treatments: PilotTreatment[] = [];
      if (operation.target && operation.kind !== 'include') {
        treatments.push({ pilot: true, id: `${request.id}${suffix}_discard`, adjustmentId: request.id, workDate: request.workDate, type: 'discard',
          originalReceiptId: operation.target.receiptId, markedAt: null, executionUnitId: null });
      }
      if (operation.inclusion && operation.kind !== 'discard') {
        treatments.push({ pilot: true, id: `${request.id}${suffix}_inclusion`, adjustmentId: request.id, workDate: request.workDate, type: 'inclusion',
          originalReceiptId: null, markedAt: operation.inclusion.markedAt, executionUnitId: operation.inclusion.executionUnitId });
      }
      return treatments;
    });
  });
}

/** Recibos que um pedido aprovado já desconsiderou: impedem aprovar outro que desconsidere a mesma batida. */
export function discardedReceiptIds(treatments: readonly PilotTreatment[]): Set<string> {
  return new Set(treatments.flatMap((treatment) => (treatment.type === 'discard' && treatment.originalReceiptId ? [treatment.originalReceiptId] : [])));
}
