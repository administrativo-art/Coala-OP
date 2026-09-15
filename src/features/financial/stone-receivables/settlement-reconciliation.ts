export type StoneSettlementReconciliationCode =
  | "SETTLEMENT_NOT_FOUND"
  | "TRANSACTION_NOT_FOUND"
  | "SETTLEMENT_ALREADY_LINKED"
  | "TRANSACTION_ALREADY_LINKED"
  | "WORKSPACE_MISMATCH"
  | "ACCOUNT_MISMATCH"
  | "AMOUNT_MISMATCH"
  | "DATE_MISMATCH"
  | "TRANSACTION_NOT_INCOMING"
  | "TRANSACTION_REVERSED";

export class StoneSettlementReconciliationError extends Error {
  constructor(readonly code: StoneSettlementReconciliationCode, message: string) {
    super(message);
    this.name = "StoneSettlementReconciliationError";
  }
}

function civilDayDistance(left: string, right: string) {
  return Math.abs((Date.parse(`${left}T00:00:00.000Z`) - Date.parse(`${right}T00:00:00.000Z`)) / 86_400_000);
}

export function assertStoneSettlementLink(input: {
  workspaceId: string;
  settlementWorkspaceId: string;
  transactionWorkspaceId?: string | null;
  settlementAccountId: string;
  transactionAccountId: string;
  settlementAmountCents: number;
  transactionAmountCents: number;
  settlementDate: string | null;
  transactionDate: string | null;
  transactionDirection: unknown;
  transactionReversed: boolean;
}) {
  if (
    input.settlementWorkspaceId !== input.workspaceId
    || (input.transactionWorkspaceId && input.transactionWorkspaceId !== input.workspaceId)
  ) throw new StoneSettlementReconciliationError("WORKSPACE_MISMATCH", "Os registros não pertencem ao mesmo workspace.");
  if (input.transactionReversed) {
    throw new StoneSettlementReconciliationError("TRANSACTION_REVERSED", "A transação bancária está estornada.");
  }
  if (input.transactionDirection !== "in") {
    throw new StoneSettlementReconciliationError("TRANSACTION_NOT_INCOMING", "A transação bancária não é uma entrada.");
  }
  if (input.transactionAccountId !== input.settlementAccountId) {
    throw new StoneSettlementReconciliationError("ACCOUNT_MISMATCH", "A conta da transação difere da conta da liquidação.");
  }
  if (input.transactionAmountCents !== input.settlementAmountCents) {
    throw new StoneSettlementReconciliationError("AMOUNT_MISMATCH", "O valor da transação difere do líquido da liquidação.");
  }
  if (
    !input.transactionDate
    || !input.settlementDate
    || civilDayDistance(input.transactionDate, input.settlementDate) > 3
  ) throw new StoneSettlementReconciliationError("DATE_MISMATCH", "A data bancária está fora da janela segura de três dias.");
}
