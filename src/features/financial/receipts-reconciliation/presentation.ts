import type { ReceiptMatch, ReceiptMatchStatus, ReceiptReconciliationResult, UnmatchedBankCredit } from "./reconciliation";

export type ReceiptListFilter = "all" | "received" | "awaiting" | "pending" | "bank_only";

export type ReceiptListRow =
  | { kind: "match"; id: string; status: Exclude<ReceiptMatchStatus, "bank_only">; date: string; match: ReceiptMatch }
  | { kind: "bank_only"; id: string; status: "bank_only"; date: string; unmatched: UnmatchedBankCredit };

export type ReceiptDayGroup = { date: string; rows: ReceiptListRow[]; amount: number };

export const receiptFilterLabels: Record<ReceiptListFilter, string> = {
  all: "Todas",
  received: "Recebidas",
  awaiting: "Aguardando",
  pending: "Pendências",
  bank_only: "Crédito sem par",
};

export function receiptListRows(result: ReceiptReconciliationResult): ReceiptListRow[] {
  return [
    ...result.matches.map(match => ({ kind: "match" as const, id: match.id, status: match.status, date: match.stone.paymentDate, match })),
    ...result.unmatchedBankCredits.map(unmatched => ({ kind: "bank_only" as const, id: unmatched.id, status: unmatched.status, date: unmatched.bank.date, unmatched })),
  ].sort((left, right) => right.date.localeCompare(left.date) || left.id.localeCompare(right.id));
}

export function receiptRowAmount(row: ReceiptListRow) {
  return row.kind === "match" ? row.match.stone.netAmount : row.unmatched.bank.amount;
}

export function receiptRowMatchesFilter(row: ReceiptListRow, filter: ReceiptListFilter) {
  if (filter === "all") return true;
  if (filter === "received") return row.status === "received" || row.status === "received_with_adjustment";
  if (filter === "awaiting") return row.status === "awaiting_bank_credit";
  if (filter === "bank_only") return row.status === "bank_only";
  return row.status === "missing_bank_credit" || row.status === "bank_amount_mismatch" || row.status === "ambiguous_bank_credit" || row.status === "stone_payment_review";
}

export function receiptDayGroups(rows: ReceiptListRow[]): ReceiptDayGroup[] {
  const groups = new Map<string, ReceiptListRow[]>();
  for (const row of rows) groups.set(row.date, [...(groups.get(row.date) ?? []), row]);
  return [...groups.entries()].map(([date, groupedRows]) => ({
    date,
    rows: groupedRows,
    amount: Number(groupedRows.reduce((sum, row) => sum + receiptRowAmount(row), 0).toFixed(2)),
  })).sort((left, right) => right.date.localeCompare(left.date));
}

export function receiptFilterCount(rows: ReceiptListRow[], filter: ReceiptListFilter) {
  return rows.filter(row => receiptRowMatchesFilter(row, filter)).length;
}
