import type { StoneReceivable } from "@/features/financial/stone-receivables/types";

export type CashFlowProjectionStatus =
  | "scheduled"
  | "unprogrammed"
  | "overdue"
  | "realized"
  | "cancelled"
  | "replaced";

export type CashFlowProjectionItem = {
  id: string;
  sourceType: "stone_receivable" | "financial_obligation" | "bank_transaction";
  sourceId: string;
  obligationId?: string | null;
  expenseId?: string | null;
  paymentRequestId?: string | null;
  bankTransactionId?: string | null;
  accountId?: string | null;
  kioskIds: string[];
  description: string;
  direction: "in" | "out";
  amountCents: number;
  originalExpectedDate?: string | null;
  currentExpectedDate?: string | null;
  projectionDate?: string | null;
  realizedDate?: string | null;
  status: CashFlowProjectionStatus;
  transferGroupId?: string | null;
  sourceRevision?: string | null;
  sourceHash?: string | null;
  sourceUpdatedAt?: string | null;
};

export type CashFlowOpeningBalance = {
  accountId: string;
  accountName: string;
  balanceCents: number | null;
  confirmedAt: string | null;
  source: string | null;
};

export type CashFlowObligationInput = {
  id: string;
  expenseId?: string | null;
  accountId?: string | null;
  kioskIds: string[];
  description: string;
  dueDate?: string | null;
  forecastAmountCents: number;
  balanceAmountCents: number | null;
  status: "OPEN" | "PARTIALLY_PAID" | "PAID" | "CANCELLED";
  sourceRevision?: string | null;
  sourceHash?: string | null;
  sourceUpdatedAt?: string | null;
};

export type CashFlowPaymentRequestInput = {
  id: string;
  obligationId?: string | null;
  expenseId?: string | null;
  accountId?: string | null;
  amountCents: number;
  scheduledFor?: string | null;
  status: string;
};

export type CashFlowTransactionInput = {
  id: string;
  obligationId?: string | null;
  expenseId?: string | null;
  accountId?: string | null;
  kioskIds: string[];
  description: string;
  date: string;
  direction: "in" | "out";
  amountCents: number;
  type: string;
  transferGroupId?: string | null;
  reversed?: boolean;
  sourceRevision?: string | null;
  sourceHash?: string | null;
  sourceUpdatedAt?: string | null;
};

export type CashFlowProjectionScope =
  | { type: "consolidated" }
  | { type: "account"; id: string }
  | { type: "unit"; id: string };

const CONFIRMED_SCHEDULE_STATUSES = new Set([
  "scheduled",
  "processing",
  "awaiting_statement",
]);

function parseCivilDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new Error("Data civil inválida na projeção de caixa.");
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (
    date.getUTCFullYear() !== Number(match[1])
    || date.getUTCMonth() !== Number(match[2]) - 1
    || date.getUTCDate() !== Number(match[3])
  ) throw new Error("Data civil inválida na projeção de caixa.");
  return date;
}

export function addCashFlowCivilDays(value: string, days: number) {
  const date = parseCivilDate(value);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function inScope(item: Pick<CashFlowProjectionItem, "accountId" | "kioskIds">, scope: CashFlowProjectionScope) {
  if (scope.type === "consolidated") return true;
  if (scope.type === "account") return item.accountId === scope.id;
  return item.kioskIds.includes(scope.id);
}

function projectedDate(date: string | null | undefined, asOf: string) {
  if (!date) return null;
  return date < asOf ? asOf : date;
}

function scheduledRequestFor(
  obligation: CashFlowObligationInput,
  requests: CashFlowPaymentRequestInput[],
) {
  const candidates = requests.filter((request) => (
    CONFIRMED_SCHEDULE_STATUSES.has(request.status)
    && (
      request.obligationId === obligation.id
      || (!request.obligationId && request.expenseId && request.expenseId === obligation.expenseId)
    )
  ));
  return candidates.length === 1 ? candidates[0] : null;
}

export function buildCashFlowProjection(input: {
  asOf: string;
  days?: number;
  scope: CashFlowProjectionScope;
  openingBalances: CashFlowOpeningBalance[];
  receivables: StoneReceivable[];
  obligations: CashFlowObligationInput[];
  paymentRequests: CashFlowPaymentRequestInput[];
  transactions: CashFlowTransactionInput[];
  generatedAt: string;
}) {
  parseCivilDate(input.asOf);
  const days = input.days ?? 91;
  if (!Number.isInteger(days) || days < 1 || days > 91) throw new Error("A projeção deve ter entre 1 e 91 dias.");
  const endDate = addCashFlowCivilDays(input.asOf, days - 1);

  const receivableItems: CashFlowProjectionItem[] = input.receivables.flatMap((receivable) => {
    if (["settled", "cancelled", "chargeback"].includes(receivable.status)) return [];
    const amountCents = Math.max(0, receivable.netAmountCents - receivable.settledAmountCents);
    if (amountCents === 0 || receivable.currentExpectedDate > endDate) return [];
    const overdue = receivable.currentExpectedDate < input.asOf || receivable.status === "overdue";
    return [{
      id: `receivable:${receivable.id}`,
      sourceType: "stone_receivable",
      sourceId: receivable.id,
      accountId: receivable.accountId,
      kioskIds: receivable.kioskId ? [receivable.kioskId] : [],
      description: `Recebível Stone ${receivable.receivableKey}`,
      direction: "in",
      amountCents,
      originalExpectedDate: receivable.originalExpectedDate,
      currentExpectedDate: receivable.currentExpectedDate,
      projectionDate: projectedDate(receivable.currentExpectedDate, input.asOf),
      status: overdue ? "overdue" : "scheduled",
      sourceRevision: receivable.sourceRevision,
      sourceHash: receivable.sourceHash,
    }];
  });

  const obligationItems: CashFlowProjectionItem[] = input.obligations.flatMap((obligation) => {
    if (["PAID", "CANCELLED"].includes(obligation.status)) return [];
    const amountCents = obligation.balanceAmountCents ?? obligation.forecastAmountCents;
    if (amountCents <= 0) return [];
    const request = scheduledRequestFor(obligation, input.paymentRequests);
    const currentExpectedDate = request?.scheduledFor ?? obligation.dueDate ?? null;
    if (currentExpectedDate && currentExpectedDate > endDate) return [];
    const status: CashFlowProjectionStatus = !currentExpectedDate
      ? "unprogrammed"
      : currentExpectedDate < input.asOf ? "overdue" : "scheduled";
    return [{
      id: `obligation:${obligation.id}`,
      sourceType: "financial_obligation",
      sourceId: obligation.id,
      obligationId: obligation.id,
      expenseId: obligation.expenseId ?? null,
      paymentRequestId: request?.id ?? null,
      accountId: request?.accountId ?? obligation.accountId ?? null,
      kioskIds: obligation.kioskIds,
      description: obligation.description,
      direction: "out",
      amountCents: request ? Math.min(amountCents, request.amountCents) : amountCents,
      originalExpectedDate: obligation.dueDate ?? null,
      currentExpectedDate,
      projectionDate: projectedDate(currentExpectedDate, input.asOf),
      status,
      sourceRevision: obligation.sourceRevision ?? null,
      sourceHash: obligation.sourceHash ?? null,
      sourceUpdatedAt: obligation.sourceUpdatedAt ?? null,
    }];
  });

  const transactionItems: CashFlowProjectionItem[] = input.transactions.flatMap((transaction) => {
    if (transaction.reversed || transaction.date < input.asOf || transaction.date > endDate) return [];
    const internalTransfer = ["transfer_in", "transfer_out"].includes(transaction.type);
    if (input.scope.type === "consolidated" && internalTransfer) return [];
    return [{
      id: `transaction:${transaction.id}`,
      sourceType: "bank_transaction",
      sourceId: transaction.id,
      obligationId: transaction.obligationId ?? null,
      expenseId: transaction.expenseId ?? null,
      bankTransactionId: transaction.id,
      accountId: transaction.accountId ?? null,
      kioskIds: transaction.kioskIds,
      description: transaction.description,
      direction: transaction.direction,
      amountCents: transaction.amountCents,
      projectionDate: transaction.date,
      realizedDate: transaction.date,
      status: "realized",
      transferGroupId: transaction.transferGroupId ?? null,
      sourceRevision: transaction.sourceRevision ?? null,
      sourceHash: transaction.sourceHash ?? null,
      sourceUpdatedAt: transaction.sourceUpdatedAt ?? null,
    }];
  });

  const items = [...receivableItems, ...obligationItems, ...transactionItems]
    .filter((item) => inScope(item, input.scope))
    .sort((left, right) => (
      String(left.projectionDate ?? "9999-99-99").localeCompare(String(right.projectionDate ?? "9999-99-99"))
      || left.id.localeCompare(right.id)
    ));

  const accountScopeId = input.scope.type === "account" ? input.scope.id : null;
  const scopedBalances = accountScopeId
    ? input.openingBalances.filter((balance) => balance.accountId === accountScopeId)
    : input.scope.type === "unit" ? [] : input.openingBalances;
  const balanceComplete = input.scope.type !== "unit"
    && scopedBalances.length > 0
    && scopedBalances.every((balance) => balance.balanceCents !== null && balance.confirmedAt !== null);
  const openingBalanceCents = balanceComplete
    ? scopedBalances.reduce((sum, balance) => sum + (balance.balanceCents ?? 0), 0)
    : null;

  let runningBalance = openingBalanceCents;
  const daily = Array.from({ length: days }, (_, index) => {
    const date = addCashFlowCivilDays(input.asOf, index);
    const dayItems = items.filter((item) => item.projectionDate === date);
    const incomingCents = dayItems.filter((item) => item.direction === "in").reduce((sum, item) => sum + item.amountCents, 0);
    const outgoingCents = dayItems.filter((item) => item.direction === "out").reduce((sum, item) => sum + item.amountCents, 0);
    runningBalance = runningBalance === null ? null : runningBalance + incomingCents - outgoingCents;
    return { date, incomingCents, outgoingCents, closingBalanceCents: runningBalance };
  });
  const comparableDays = daily.filter((day) => day.closingBalanceCents !== null);
  const minimumBalanceDay = comparableDays.reduce<(typeof daily)[number] | null>((minimum, day) => (
    !minimum || (day.closingBalanceCents ?? 0) < (minimum.closingBalanceCents ?? 0) ? day : minimum
  ), null);
  const firstNegativeDay = comparableDays.find((day) => (day.closingBalanceCents ?? 0) < 0) ?? null;

  return {
    generatedAt: input.generatedAt,
    asOf: input.asOf,
    endDate,
    days,
    scope: input.scope,
    openingBalances: scopedBalances,
    openingBalanceCents,
    balanceComplete,
    balanceIncompleteReason: balanceComplete
      ? null
      : input.scope.type === "unit"
        ? "A visão por unidade é gerencial e não divide o saldo de contas compartilhadas."
        : "Uma ou mais contas não possuem saldo confirmado e data de referência.",
    futureSalesIncluded: false,
    items,
    unprogrammedItems: items.filter((item) => item.status === "unprogrammed"),
    daily,
    minimumBalanceDay,
    firstNegativeDay,
  };
}
