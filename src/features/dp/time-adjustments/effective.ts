/** Parte pura do ajuste de ponto, usada também na tela (sem dependências de servidor). */

export type EffectiveMarking<T> = T & { treatment: 'original' | 'discarded' | 'included'; adjustmentId?: string };

/**
 * Batidas do dia depois dos tratamentos aprovados: originais desconsideradas saem da conta (mas continuam
 * listadas, marcadas) e as incluídas entram, todas identificadas. A sequência efetiva é só leitura.
 */
export function applyTreatments<T extends { receiptId: string; markedAt: string }>(
  originals: T[],
  treatments: { type: 'discard' | 'inclusion'; originalReceiptId?: string | null; markedAt?: string | null; adjustmentId: string; executionUnitId?: string | null }[],
  makeIncluded: (treatment: { markedAt: string; adjustmentId: string; executionUnitId?: string | null }) => T,
) {
  const discarded = new Map(treatments.filter((item) => item.type === 'discard' && item.originalReceiptId)
    .map((item) => [item.originalReceiptId as string, item.adjustmentId]));
  const all: EffectiveMarking<T>[] = [
    ...originals.map((marking) => discarded.has(marking.receiptId)
      ? { ...marking, treatment: 'discarded' as const, adjustmentId: discarded.get(marking.receiptId) }
      : { ...marking, treatment: 'original' as const }),
    ...treatments.filter((item) => item.type === 'inclusion' && item.markedAt).map((item) => ({
      ...makeIncluded({ markedAt: item.markedAt as string, adjustmentId: item.adjustmentId, executionUnitId: item.executionUnitId }),
      treatment: 'included' as const, adjustmentId: item.adjustmentId,
    })),
  ];
  return all;
}
