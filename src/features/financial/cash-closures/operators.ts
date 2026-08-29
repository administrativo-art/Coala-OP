import type {
  CashClosure,
  CashClosureDepositState,
  CashClosureLine,
  CashClosureOperator,
  CashClosureStatus,
} from "./types";

function documentIdPart(value: string) {
  return value.trim().replaceAll("/", "%2F");
}

export function cashClosureOperatorId(operatorId: string) {
  return documentIdPart(operatorId);
}

export function emptyCashClosureDepositState(): CashClosureDepositState {
  return {
    eligibleCents: 0,
    allocatedCents: 0,
    issuedCents: 0,
    paidCents: 0,
    batchId: null,
    batchItemId: null,
    status: "not_eligible",
    manualSplitRequired: false,
    allocationReason: null,
    pendingSince: null,
  };
}

function aggregateOperatorLines(lines: CashClosureLine[]) {
  let expectedTotalCents = 0;
  let reportedTotalCents = 0;
  let countedTotalCents = 0;
  let reportedDifferenceTotalCents = 0;
  let differenceTotalCents = 0;
  let countedCashCents = 0;
  let unreportedLineCount = 0;
  let pendingLineCount = 0;
  let reportedDivergentLineCount = 0;
  let divergentLineCount = 0;

  for (const line of lines) {
    expectedTotalCents += line.expectedCents;
    if (line.reportedCents === null) unreportedLineCount++;
    else reportedTotalCents += line.reportedCents;
    if (line.countedCents === null) pendingLineCount++;
    else {
      countedTotalCents += line.countedCents;
      if (line.channel === "cash") countedCashCents += line.countedCents;
    }
    if (line.reportedDifferenceCents !== null) {
      reportedDifferenceTotalCents += line.reportedDifferenceCents;
      if (line.reportedDifferenceCents !== 0) reportedDivergentLineCount++;
    }
    if (line.differenceCents !== null) {
      differenceTotalCents += line.differenceCents;
      if (line.differenceCents !== 0) divergentLineCount++;
    }
  }

  return {
    expectedTotalCents,
    reportedTotalCents,
    countedTotalCents,
    reportedDifferenceTotalCents,
    differenceTotalCents,
    countedCashCents,
    unreportedLineCount,
    pendingLineCount,
    reportedDivergentLineCount,
    divergentLineCount,
  };
}

export function buildCashClosureOperators(input: {
  closure: CashClosure;
  lines: CashClosureLine[];
  existingOperators?: CashClosureOperator[];
  now: string;
}) {
  const existingOperators = input.existingOperators ?? [];
  const existingByOperator = new Map(existingOperators.map((operator) => [operator.operatorId, operator]));
  const grouped = new Map<string, CashClosureLine[]>();
  for (const line of input.lines) grouped.set(line.operatorId, [...(grouped.get(line.operatorId) ?? []), line]);
  const legacyApproved = existingOperators.length === 0 && input.closure.status === "approved";

  const operators = [...grouped.entries()].map(([operatorId, lines]): CashClosureOperator => {
    const existing = existingByOperator.get(operatorId);
    const aggregates = aggregateOperatorLines(lines);
    const approved = existing?.status === "approved" || (!existing && legacyApproved);
    const status = existing?.status ?? (approved ? "approved" : input.closure.status === "reopened" ? "reopened" : "draft");
    const cashDeposit = existing?.cashDeposit ?? (approved
      ? {
          ...input.closure.cashDeposit,
          eligibleCents: aggregates.countedCashCents,
        }
      : emptyCashClosureDepositState());
    return {
      id: cashClosureOperatorId(operatorId),
      closureId: input.closure.id,
      workspaceId: input.closure.workspaceId,
      kioskId: input.closure.kioskId,
      kioskName: input.closure.kioskName,
      date: input.closure.date,
      operatorId,
      operatorName: lines[0]?.operatorName ?? existing?.operatorName ?? operatorId,
      status,
      ...aggregates,
      cashDeposit,
      approvedWithDivergence: approved
        ? aggregates.divergentLineCount > 0 || aggregates.reportedDivergentLineCount > 0
        : existing?.approvedWithDivergence ?? false,
      approvedAt: approved ? existing?.approvedAt ?? input.closure.approvedAt ?? input.now : null,
      approvedBy: approved ? existing?.approvedBy ?? input.closure.approvedBy : null,
      reopenedAt: existing?.reopenedAt ?? null,
      reopenedBy: existing?.reopenedBy ?? null,
      reopenedReason: existing?.reopenedReason ?? null,
      createdAt: existing?.createdAt ?? input.closure.createdAt ?? input.now,
      updatedAt: input.now,
    };
  }).sort((left, right) => left.operatorName.localeCompare(right.operatorName, "pt-BR"));

  return {
    operators,
    deletedOperatorIds: existingOperators
      .filter((operator) => !grouped.has(operator.operatorId))
      .map((operator) => operator.id),
  };
}

function aggregateDeposit(operators: CashClosureOperator[]): CashClosureDepositState {
  const eligible = operators.filter((operator) => operator.status === "approved");
  const eligibleCents = eligible.reduce((total, operator) => total + operator.cashDeposit.eligibleCents, 0);
  if (eligibleCents <= 0) return emptyCashClosureDepositState();
  const states = eligible.filter((operator) => operator.cashDeposit.eligibleCents > 0).map((operator) => operator.cashDeposit);
  const allocatedCents = states
    .filter((state) => ["allocated", "issued", "paid", "adjusted"].includes(state.status))
    .reduce((total, state) => total + state.eligibleCents, 0);
  const issuedCents = states
    .filter((state) => ["issued", "paid"].includes(state.status))
    .reduce((total, state) => total + state.eligibleCents, 0);
  const paidCents = states
    .filter((state) => state.status === "paid")
    .reduce((total, state) => total + state.eligibleCents, 0);
  const batchIds = Array.from(new Set(states.flatMap((state) => [
    ...(state.manualSplitBatchIds ?? []),
    ...(state.batchId ? [state.batchId] : []),
  ])));
  const status = states.some((state) => state.status === "adjusted")
    ? "adjusted"
    : states.every((state) => state.status === "paid")
      ? "paid"
      : states.every((state) => state.status === "paid" || state.status === "issued")
        ? "issued"
        : states.every((state) => ["allocated", "issued", "paid"].includes(state.status))
          ? "allocated"
          : "not_allocated";
  return {
    eligibleCents,
    allocatedCents,
    issuedCents,
    paidCents,
    batchId: batchIds[0] ?? null,
    batchItemId: states.find((state) => state.batchItemId)?.batchItemId ?? null,
    status,
    manualSplitRequired: states.some((state) => state.manualSplitRequired),
    manualSplitBatchIds: batchIds,
    adjustmentId: states.find((state) => state.adjustmentId)?.adjustmentId ?? null,
    allocationReason: states.some((state) => state.allocationReason === "amount_exceeds_limit")
      ? "amount_exceeds_limit"
      : states.some((state) => state.allocationReason === "pending_allocator")
        ? "pending_allocator"
        : null,
    pendingSince: states.map((state) => state.pendingSince).filter((value): value is string => !!value).sort()[0] ?? null,
  };
}

export function closureStatusFromOperators(current: CashClosureStatus, operators: CashClosureOperator[]): CashClosureStatus {
  if (operators.length === 0) return current;
  const approved = operators.filter((operator) => operator.status === "approved").length;
  if (approved === operators.length) return "approved";
  if (approved > 0) return "pending_review";
  if (operators.some((operator) => operator.status === "reopened") || current === "reopened") return "reopened";
  return current === "sync_error" ? "sync_error" : "draft";
}

export function withCashClosureOperatorAggregate(
  closure: CashClosure,
  operators: CashClosureOperator[],
  now = closure.updatedAt,
): CashClosure {
  if (operators.length === 0) {
    return {
      ...closure,
      finalizedOperatorCount: closure.finalizedOperatorCount ?? (closure.status === "approved" ? closure.operatorCount : 0),
      finalizedCountedTotalCents: closure.finalizedCountedTotalCents ?? (closure.status === "approved" ? closure.countedTotalCents : 0),
      finalizedDifferenceTotalCents: closure.finalizedDifferenceTotalCents ?? (closure.status === "approved" ? closure.differenceTotalCents : 0),
      finalizedCountedCashCents: closure.finalizedCountedCashCents ?? (closure.status === "approved" ? closure.countedCashCents : 0),
      updatedAt: now,
    };
  }
  const approved = operators.filter((operator) => operator.status === "approved");
  const cashDeposit = aggregateDeposit(operators);
  const status = closureStatusFromOperators(closure.status, operators);
  return {
    ...closure,
    status,
    operatorCount: operators.length,
    finalizedOperatorCount: approved.length,
    finalizedCountedTotalCents: approved.reduce((total, operator) => total + operator.countedTotalCents, 0),
    finalizedDifferenceTotalCents: approved.reduce((total, operator) => total + operator.differenceTotalCents, 0),
    finalizedCountedCashCents: approved.reduce((total, operator) => total + operator.countedCashCents, 0),
    cashDepositEligibleCents: cashDeposit.eligibleCents,
    cashDeposit,
    approvedWithDivergence: approved.some((operator) => operator.approvedWithDivergence),
    submittedAt: approved.length > 0 ? closure.submittedAt ?? approved.map((operator) => operator.approvedAt).filter(Boolean).sort()[0] ?? null : null,
    approvedAt: status === "approved" ? approved.map((operator) => operator.approvedAt).filter((value): value is string => !!value).sort().at(-1) ?? null : null,
    approvedBy: status === "approved" ? approved.at(-1)?.approvedBy ?? null : null,
    approvalReason: status === "approved" ? "Todos os operadores finalizados" : approved.length > 0 ? "Finalização parcial por operador" : null,
    updatedAt: now,
  };
}
