/**
 * Ordem de cada batida no próprio dia (1ª, 2ª…), só para leitura na tela.
 * Não é tipo de marcação: o REP-P guarda apenas o instante; entrada/saída é interpretação do tratamento.
 */
export function dayMarkingOrder(markings: ReadonlyArray<{ receiptId: string; workDate: string; markedAt: string; nsr: number }>) {
  const order = new Map<string, number>();
  const perDay = new Map<string, number>();
  const sorted = [...markings].sort((left, right) => left.markedAt.localeCompare(right.markedAt) || left.nsr - right.nsr);
  for (const marking of sorted) {
    const next = (perDay.get(marking.workDate) ?? 0) + 1;
    perDay.set(marking.workDate, next);
    order.set(marking.receiptId, next);
  }
  return order;
}
