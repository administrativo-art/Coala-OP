import { createHash } from "node:crypto";

import type { CashClosureChannel } from "./channel-normalization";
import {
  CASH_CLOSURE_CHANNELS,
  type BuiltCashClosure,
  type BuiltCashClosureLine,
  type CashClosure,
  type CashClosureChannelTotals,
  type CashClosureLine,
  type CashClosureLineStatus,
} from "./types";

export function cashClosureId(kioskId: string, date: string) {
  return `${kioskId}_${date}`;
}

function documentIdPart(value: string) {
  return value.trim().replaceAll("/", "%2F");
}

export function cashClosureLineId(operatorId: string, channel: CashClosureChannel) {
  return `${documentIdPart(operatorId)}_${channel}`;
}

export function emptyChannelTotals(): CashClosureChannelTotals {
  return Object.fromEntries(CASH_CLOSURE_CHANNELS.map((channel) => [channel, 0])) as CashClosureChannelTotals;
}

function lineStatus(countedCents: number | null, differenceCents: number | null): CashClosureLineStatus {
  if (countedCents === null || differenceCents === null) return "pending";
  return differenceCents === 0 ? "matched" : "divergent";
}

function normalizedSourceHash(built: BuiltCashClosure) {
  const input = {
    date: built.date,
    expectedTotalCents: built.expectedTotalCents,
    lines: built.lines
      .map((line) => ({
        id: cashClosureLineId(line.operatorId, line.channel),
        operatorName: line.operatorName,
        expectedCents: line.expectedAmountCents,
        rawPaymentNames: [...line.rawPaymentNames].sort(),
        metadata: line.metadata,
      }))
      .sort((left, right) => left.id.localeCompare(right.id)),
    source: {
      ...built.source,
      rawPaymentNames: [...built.source.rawPaymentNames].sort(),
      unknownPaymentNames: [...built.source.unknownPaymentNames].sort(),
    },
  };
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

function builtLineToPersistent(
  built: BuiltCashClosure,
  line: BuiltCashClosureLine,
  existing: CashClosureLine | undefined,
  now: string,
): CashClosureLine {
  const id = cashClosureLineId(line.operatorId, line.channel);
  const countedCents = existing?.countedCents ?? null;
  const differenceCents = countedCents === null ? null : countedCents - line.expectedAmountCents;
  const comparable = {
    operatorName: line.operatorName,
    channelLabel: line.channelLabel,
    expectedCents: line.expectedAmountCents,
    countedCents,
    differenceCents,
    status: lineStatus(countedCents, differenceCents),
    rawPaymentNames: [...line.rawPaymentNames].sort(),
    metadata: line.metadata,
    note: existing?.note ?? null,
    countedBy: existing?.countedBy ?? null,
    countedAt: existing?.countedAt ?? null,
  };
  const existingComparable = existing
    ? {
        operatorName: existing.operatorName,
        channelLabel: existing.channelLabel,
        expectedCents: existing.expectedCents,
        countedCents: existing.countedCents,
        differenceCents: existing.differenceCents,
        status: existing.status,
        rawPaymentNames: [...existing.rawPaymentNames].sort(),
        metadata: existing.metadata,
        note: existing.note,
        countedBy: existing.countedBy,
        countedAt: existing.countedAt,
      }
    : null;

  return {
    id,
    closureId: cashClosureId(built.kioskId, built.date),
    workspaceId: built.workspaceId,
    kioskId: built.kioskId,
    date: built.date,
    operatorId: line.operatorId,
    channel: line.channel,
    ...comparable,
    updatedAt: existing && JSON.stringify(existingComparable) === JSON.stringify(comparable) ? existing.updatedAt : now,
  };
}

function staleCountedLine(existing: CashClosureLine, now: string): CashClosureLine {
  const differenceCents = existing.countedCents === null ? null : existing.countedCents;
  return {
    ...existing,
    expectedCents: 0,
    differenceCents,
    status: lineStatus(existing.countedCents, differenceCents),
    updatedAt:
      existing.expectedCents === 0 && existing.differenceCents === differenceCents
        ? existing.updatedAt
        : now,
  };
}

function aggregateLines(lines: CashClosureLine[]) {
  const expectedByChannelCents = emptyChannelTotals();
  const countedByChannelCents = emptyChannelTotals();
  const differenceByChannelCents = emptyChannelTotals();

  let expectedTotalCents = 0;
  let countedTotalCents = 0;
  let differenceTotalCents = 0;
  let pendingLineCount = 0;
  let divergentLineCount = 0;
  let matchedLineCount = 0;

  for (const line of lines) {
    expectedByChannelCents[line.channel] += line.expectedCents;
    expectedTotalCents += line.expectedCents;
    if (line.countedCents === null) {
      pendingLineCount++;
    } else {
      countedByChannelCents[line.channel] += line.countedCents;
      countedTotalCents += line.countedCents;
    }
    if (line.differenceCents !== null) {
      differenceByChannelCents[line.channel] += line.differenceCents;
      differenceTotalCents += line.differenceCents;
    }
    if (line.status === "matched") matchedLineCount++;
    if (line.status === "divergent") divergentLineCount++;
  }

  return {
    expectedTotalCents,
    countedTotalCents,
    differenceTotalCents,
    expectedByChannelCents,
    countedByChannelCents,
    differenceByChannelCents,
    expectedCashCents: expectedByChannelCents.cash,
    countedCashCents: countedByChannelCents.cash,
    pendingLineCount,
    divergentLineCount,
    matchedLineCount,
  };
}

export type MergeCashClosureResult = {
  closure: CashClosure;
  lines: CashClosureLine[];
  deletedLineIds: string[];
  sourceChanged: boolean;
};

export function mergeBuiltClosureForPersistence(input: {
  built: BuiltCashClosure;
  existingClosure?: CashClosure | null;
  existingLines?: CashClosureLine[];
  now: string;
}): MergeCashClosureResult {
  const { built, existingClosure, existingLines = [], now } = input;
  const existingById = new Map(existingLines.map((line) => [line.id, line]));
  const nextLines = built.lines.map((line) => {
    const id = cashClosureLineId(line.operatorId, line.channel);
    existingById.delete(id);
    return builtLineToPersistent(built, line, existingLines.find((item) => item.id === id), now);
  });

  const deletedLineIds: string[] = [];
  for (const stale of existingById.values()) {
    if (stale.countedCents === null) deletedLineIds.push(stale.id);
    else nextLines.push(staleCountedLine(stale, now));
  }
  nextLines.sort(
    (left, right) =>
      left.operatorName.localeCompare(right.operatorName, "pt-BR") || left.channel.localeCompare(right.channel),
  );

  const sourceHash = normalizedSourceHash(built);
  const sourceChanged = existingClosure ? existingClosure.sourceHash !== sourceHash : true;
  const aggregates = aggregateLines(nextLines);
  const status = existingClosure?.status === "sync_error" || !existingClosure ? "draft" : existingClosure.status;
  const closureId = cashClosureId(built.kioskId, built.date);

  const closure: CashClosure = {
    id: closureId,
    workspaceId: built.workspaceId,
    kioskId: built.kioskId,
    kioskName: built.kioskName,
    pdvFilialId: built.pdvFilialId,
    date: built.date,
    year: built.year,
    month: built.month,
    day: built.day,
    status,
    ...aggregates,
    cashDepositEligibleCents: existingClosure?.cashDepositEligibleCents ?? 0,
    operatorCount: new Set(nextLines.map((line) => line.operatorId)).size,
    source: built.source,
    sourceHash,
    cashDeposit: existingClosure?.cashDeposit ?? {
      eligibleCents: 0,
      batchId: null,
      batchItemId: null,
      status: "not_eligible",
      manualSplitRequired: false,
      allocationReason: null,
      pendingSince: null,
    },
    approvedWithDivergence: existingClosure?.approvedWithDivergence ?? false,
    pdvChangedAfterApproval:
      existingClosure?.pdvChangedAfterApproval === true ||
      (existingClosure?.status === "approved" && sourceChanged),
    syncedAt: now,
    syncError: null,
    submittedAt: existingClosure?.submittedAt ?? null,
    submittedBy: existingClosure?.submittedBy ?? null,
    approvedAt: existingClosure?.approvedAt ?? null,
    approvedBy: existingClosure?.approvedBy ?? null,
    approvalReason: existingClosure?.approvalReason ?? null,
    reopenedAt: existingClosure?.reopenedAt ?? null,
    reopenedBy: existingClosure?.reopenedBy ?? null,
    reopenedReason: existingClosure?.reopenedReason ?? null,
    createdAt: existingClosure?.createdAt ?? now,
    updatedAt: now,
  };

  return { closure, lines: nextLines, deletedLineIds, sourceChanged };
}

export function recomputeCashClosureFromLines(closure: CashClosure, lines: CashClosureLine[], now: string): CashClosure {
  return {
    ...closure,
    ...aggregateLines(lines),
    operatorCount: new Set(lines.map((line) => line.operatorId)).size,
    updatedAt: now,
  };
}

export function recalculateCountedLine(
  line: CashClosureLine,
  countedCents: number | null,
  note: string | null,
  actorId: string,
  now: string,
): CashClosureLine {
  const differenceCents = countedCents === null ? null : countedCents - line.expectedCents;
  return {
    ...line,
    countedCents,
    differenceCents,
    status: lineStatus(countedCents, differenceCents),
    note: note?.trim() || null,
    countedBy: countedCents === null ? null : actorId,
    countedAt: countedCents === null ? null : now,
    updatedAt: now,
  };
}
