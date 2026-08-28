import type { CashClosure } from "../cash-closures/types";
import type { InterCobrancaDocument } from "./inter-cobranca";
import type { CashDepositBatch, CashDepositBatchItem } from "./types";

export type CashDepositReconciliationIssue = {
  code:
    | "batch_items_total_mismatch"
    | "batch_over_limit"
    | "batch_negative"
    | "cobranca_amount_mismatch"
    | "paid_without_ledger_entry"
    | "orphan_closure"
    | "closure_allocation_mismatch";
  batchId: string;
  closureId?: string;
  expectedCents?: number;
  actualCents?: number;
  message: string;
};

export function reconcileCashDepositBatch(input: {
  batch: CashDepositBatch;
  items: CashDepositBatchItem[];
  cobranca?: InterCobrancaDocument | null;
  closures?: CashClosure[];
}) {
  const issues: CashDepositReconciliationIssue[] = [];
  const itemTotalCents = input.items.reduce((total, item) => total + item.amountCents, 0);
  if (itemTotalCents !== input.batch.totalCents) {
    issues.push({
      code: "batch_items_total_mismatch",
      batchId: input.batch.id,
      expectedCents: input.batch.totalCents,
      actualCents: itemTotalCents,
      message: "A soma dos itens não confere com o total do bloco.",
    });
  }
  if (input.batch.totalCents > input.batch.maxCents) {
    issues.push({
      code: "batch_over_limit",
      batchId: input.batch.id,
      expectedCents: input.batch.maxCents,
      actualCents: input.batch.totalCents,
      message: "O bloco ultrapassa o limite configurado.",
    });
  }
  if (input.batch.totalCents < 0 || input.batch.remainingCapacityCents < 0) {
    issues.push({
      code: "batch_negative",
      batchId: input.batch.id,
      actualCents: Math.min(input.batch.totalCents, input.batch.remainingCapacityCents),
      message: "O bloco contém saldo ou capacidade negativa.",
    });
  }
  if (input.cobranca && input.cobranca.valorNominalCents !== input.batch.totalCents) {
    issues.push({
      code: "cobranca_amount_mismatch",
      batchId: input.batch.id,
      expectedCents: input.batch.totalCents,
      actualCents: input.cobranca.valorNominalCents,
      message: "O valor nominal da cobrança não confere com o bloco.",
    });
  }
  if (input.batch.status === "paid" && input.batch.bankProvider === "inter" && !input.batch.ledgerTransactionId) {
    issues.push({
      code: "paid_without_ledger_entry",
      batchId: input.batch.id,
      message: "O bloco foi liquidado no Inter, mas a entrada financeira ainda não foi registrada.",
    });
  }

  const closures = new Map((input.closures ?? []).map((closure) => [closure.id, closure]));
  for (const closureId of input.batch.closureIds) {
    if (!closures.has(closureId)) {
      issues.push({
        code: "orphan_closure",
        batchId: input.batch.id,
        closureId,
        message: "O fechamento referenciado pelo bloco não foi encontrado.",
      });
    }
  }
  const itemsByClosure = new Map<string, number>();
  for (const item of input.items.filter((candidate) =>
    candidate.source === "cash_counted" || candidate.source === "manual_split"
  )) {
    itemsByClosure.set(item.closureId, (itemsByClosure.get(item.closureId) ?? 0) + item.amountCents);
  }
  for (const [closureId, amountCents] of itemsByClosure) {
    const closure = closures.get(closureId);
    if (!closure) continue;
    const isSplit = (closure.cashDeposit.manualSplitBatchIds?.length ?? 0) > 1;
    if (!isSplit && amountCents !== closure.cashDeposit.eligibleCents) {
      issues.push({
        code: "closure_allocation_mismatch",
        batchId: input.batch.id,
        closureId,
        expectedCents: closure.cashDeposit.eligibleCents,
        actualCents: amountCents,
        message: "A alocação do fechamento não confere com o dinheiro elegível.",
      });
    }
  }
  return { itemTotalCents, issues };
}
