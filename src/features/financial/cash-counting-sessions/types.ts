export const CASH_COUNTING_NOTE_VALUES_CENTS = [20_000, 10_000, 5_000, 2_000, 1_000, 500, 200] as const;
export const CASH_COUNTING_COIN_VALUES_CENTS = [100, 50, 25, 10, 5, 1] as const;
export const CASH_COUNTING_DENOMINATION_VALUES_CENTS = [
  ...CASH_COUNTING_NOTE_VALUES_CENTS,
  ...CASH_COUNTING_COIN_VALUES_CENTS,
] as const;

export type CashCountingDenominationValueCents = (typeof CASH_COUNTING_DENOMINATION_VALUES_CENTS)[number];
export type CashCountingDenominationKind = "note" | "coin";

export type CashCountingDenomination = {
  valueCents: CashCountingDenominationValueCents;
  kind: CashCountingDenominationKind;
  quantity: number;
  totalCents: number;
};

export type CashCountingSessionScope = {
  key: string;
  kioskId: string;
  kioskName: string;
  year: number;
  month: number;
};

export type CashCountingSessionStatus =
  | "open"
  | "counted"
  | "deposit_ready"
  | "completed"
  | "cancelled";

export type CashCountingSessionBag = {
  id: string;
  sequence: number;
  totalCents: number;
  denominations: CashCountingDenomination[];
  batchId: string | null;
  source: "initial_notes" | "coin_exchange";
};

export type CashCountingSession = {
  id: string;
  workspaceId: string;
  status: CashCountingSessionStatus;
  scopes: CashCountingSessionScope[];
  scopeKeys: string[];
  kioskIds: string[];
  kioskNames: string[];
  periodKeys: string[];
  finalizedOperatorCount: number;
  countedCashCents: number;
  depositEligibleCents: number;
  dreOnlyCashCents: number;
  denominationTotalCents: number;
  noteTotalCents: number;
  coinTotalCents: number;
  coinPendingExchangeCents: number;
  coinExchangedCents: number;
  denominations: CashCountingDenomination[];
  bags: CashCountingSessionBag[];
  batchIds: string[];
  paidBatchCount: number;
  openedAt: string;
  openedBy: string;
  openedByName: string;
  countingFinishedAt: string | null;
  countingFinishedBy: string | null;
  denominationsConfirmedAt: string | null;
  denominationsConfirmedBy: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  cancelledBy: string | null;
  cancellationReason: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CashCountingSessionOperator = {
  id: string;
  workspaceId: string;
  sessionId: string;
  closureId: string;
  closureDate: string;
  year: number;
  month: number;
  kioskId: string;
  kioskName: string;
  operatorId: string;
  operatorName: string;
  countedCashCents: number;
  depositEligibleCents: number;
  depositPolicy: "standard" | "dre_only";
  finalizedAt: string;
  finalizedBy: string;
};

export type CashCountingSessionLock = {
  id: string;
  workspaceId: string;
  scopeKey: string;
  sessionId: string;
  kioskId: string;
  year: number;
  month: number;
  lockedAt: string;
  lockedBy: string;
};

export type CashCountingSessionAuditAction =
  | "created"
  | "operator_attached"
  | "operator_detached"
  | "counting_finished"
  | "denominations_confirmed"
  | "coins_exchanged"
  | "completed"
  | "cancelled";

export type CashCountingSessionAuditLog = {
  id: string;
  workspaceId: string;
  sessionId: string;
  action: CashCountingSessionAuditAction;
  actorId: string;
  actorName: string;
  metadata: Record<string, unknown>;
  createdAt: string;
};
