import { createHash } from "node:crypto";

import { isPdvAutoCountedChannel, type CashClosureChannel } from "./channel-normalization";
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

export function withPdvAutomaticClosureTotals(closure: CashClosure): CashClosure {
  const empty = emptyChannelTotals();
  const expectedByChannelCents = { ...empty, ...(closure.expectedByChannelCents ?? {}) };
  const legacy = closure.reportedTotalCents === undefined;
  const legacyReportedByChannel = { ...empty, ...(closure.countedByChannelCents ?? {}) };
  const legacyFinanceByChannel = closure.status === "approved"
    ? legacyReportedByChannel
    : { ...empty };
  const reportedByChannelCents = legacy
    ? legacyReportedByChannel
    : { ...empty, ...(closure.reportedByChannelCents ?? {}) };
  const countedByChannelCents = legacy
    ? legacyFinanceByChannel
    : { ...empty, ...(closure.countedByChannelCents ?? {}) };
  const reportedDifferenceByChannelCents = legacy
    ? Object.fromEntries(CASH_CLOSURE_CHANNELS.map((channel) => [
        channel,
        reportedByChannelCents[channel] - expectedByChannelCents[channel],
      ])) as CashClosureChannelTotals
    : { ...empty, ...(closure.reportedDifferenceByChannelCents ?? {}) };
  const differenceByChannelCents = legacy && closure.status !== "approved"
    ? { ...empty }
    : { ...empty, ...(closure.differenceByChannelCents ?? {}) };
  const automaticChannels = CASH_CLOSURE_CHANNELS.filter(isPdvAutoCountedChannel);
  for (const channel of automaticChannels) {
    reportedByChannelCents[channel] = expectedByChannelCents[channel];
    countedByChannelCents[channel] = expectedByChannelCents[channel];
    reportedDifferenceByChannelCents[channel] = 0;
    differenceByChannelCents[channel] = 0;
  }

  const sum = (totals: CashClosureChannelTotals) =>
    CASH_CLOSURE_CHANNELS.reduce((total, channel) => total + totals[channel], 0);
  const manualExpected = CASH_CLOSURE_CHANNELS
    .filter((channel) => !isPdvAutoCountedChannel(channel))
    .reduce((total, channel) => total + expectedByChannelCents[channel], 0);

  return {
    ...closure,
    expectedByChannelCents,
    reportedByChannelCents,
    countedByChannelCents,
    reportedDifferenceByChannelCents,
    differenceByChannelCents,
    reportedTotalCents: sum(reportedByChannelCents),
    countedTotalCents: sum(countedByChannelCents),
    reportedDifferenceTotalCents: sum(reportedDifferenceByChannelCents),
    differenceTotalCents: sum(differenceByChannelCents),
    reportedCashCents: reportedByChannelCents.cash,
    countedCashCents: countedByChannelCents.cash,
    unreportedLineCount: closure.unreportedLineCount ?? closure.pendingLineCount ?? (manualExpected > 0 ? 1 : 0),
    reportedDivergentLineCount: closure.reportedDivergentLineCount ?? closure.divergentLineCount ?? 0,
    reportedMatchedLineCount: closure.reportedMatchedLineCount ?? closure.matchedLineCount ?? 0,
    pendingLineCount: legacy && closure.status !== "approved"
      ? (manualExpected > 0 ? Math.max(closure.pendingLineCount ?? 0, 1) : 0)
      : closure.pendingLineCount ?? 0,
  };
}

function lineStatus(countedCents: number | null, differenceCents: number | null): CashClosureLineStatus {
  if (countedCents === null || differenceCents === null) return "pending";
  return differenceCents === 0 ? "matched" : "divergent";
}

function normalizeExistingLine(line: CashClosureLine, closureStatus: CashClosure["status"]): CashClosureLine {
  const automatic = isPdvAutoCountedChannel(line.channel);
  const legacy = line.reportedCents === undefined;
  const reportedCents = automatic ? line.expectedCents : legacy ? line.countedCents : line.reportedCents;
  const countedCents = automatic
    ? line.expectedCents
    : legacy && closureStatus !== "approved"
      ? null
      : line.countedCents;
  const reportedDifferenceCents = reportedCents === null ? null : reportedCents - line.expectedCents;
  const differenceCents = countedCents === null ? null : countedCents - line.expectedCents;
  return {
    ...line,
    reportedCents,
    reportedDifferenceCents,
    countedCents,
    conferenceDifferenceCents:
      countedCents === null || reportedCents === null ? null : countedCents - reportedCents,
    differenceCents,
    status: lineStatus(countedCents, differenceCents),
    reportedNote: automatic ? null : legacy ? line.note ?? null : line.reportedNote ?? null,
    note: automatic ? null : legacy && closureStatus !== "approved" ? null : line.note ?? null,
    reportedBy: automatic ? "system:pdv" : legacy ? line.countedBy ?? null : line.reportedBy ?? null,
    reportedAt: automatic ? line.reportedAt ?? line.countedAt ?? line.updatedAt : legacy ? line.countedAt ?? null : line.reportedAt ?? null,
    countedBy: automatic ? "system:pdv" : countedCents === null ? null : line.countedBy ?? null,
    countedAt: automatic ? line.countedAt ?? line.updatedAt : countedCents === null ? null : line.countedAt ?? null,
  };
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
        metadata: {
          grossCashCents: line.metadata.grossCashCents,
          changeCents: line.metadata.changeCents,
          paymentRowCount: line.metadata.paymentRowCount,
        },
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
  const automaticallyCounted = isPdvAutoCountedChannel(line.channel);
  const reportedCents = automaticallyCounted
    ? line.expectedAmountCents
    : existing?.reportedCents ?? line.reportedAmountCents;
  const countedCents = automaticallyCounted
    ? line.expectedAmountCents
    : existing?.countedCents ?? line.countedAmountCents;
  const reportedDifferenceCents = reportedCents === null ? null : reportedCents - line.expectedAmountCents;
  const differenceCents = countedCents === null ? null : countedCents - line.expectedAmountCents;
  const automaticCountIsCurrent =
    automaticallyCounted &&
    existing?.countedCents === countedCents &&
    existing.countedBy === "system:pdv";
  const comparable = {
    operatorName: line.operatorName,
    channelLabel: line.channelLabel,
    expectedCents: line.expectedAmountCents,
    reportedCents,
    reportedDifferenceCents,
    countedCents,
    conferenceDifferenceCents:
      countedCents === null || reportedCents === null ? null : countedCents - reportedCents,
    differenceCents,
    status: lineStatus(countedCents, differenceCents),
    rawPaymentNames: [...line.rawPaymentNames].sort(),
    metadata: line.metadata,
    reportedNote: existing?.reportedNote ?? null,
    note: existing?.note ?? null,
    reportedBy: automaticallyCounted ? "system:pdv" : existing?.reportedBy ?? null,
    reportedAt: automaticallyCounted
      ? existing?.reportedAt ?? existing?.countedAt ?? now
      : existing?.reportedAt ?? null,
    countedBy: automaticallyCounted ? "system:pdv" : existing?.countedBy ?? null,
    countedAt: automaticallyCounted
      ? automaticCountIsCurrent
        ? existing?.countedAt ?? now
        : now
      : existing?.countedAt ?? null,
  };
  const existingComparable = existing
    ? {
        operatorName: existing.operatorName,
        channelLabel: existing.channelLabel,
        expectedCents: existing.expectedCents,
        reportedCents: existing.reportedCents,
        reportedDifferenceCents: existing.reportedDifferenceCents,
        countedCents: existing.countedCents,
        conferenceDifferenceCents: existing.conferenceDifferenceCents,
        differenceCents: existing.differenceCents,
        status: existing.status,
        rawPaymentNames: [...existing.rawPaymentNames].sort(),
        metadata: existing.metadata,
        reportedNote: existing.reportedNote,
        note: existing.note,
        reportedBy: existing.reportedBy,
        reportedAt: existing.reportedAt,
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
  const reportedDifferenceCents = existing.reportedCents === null ? null : existing.reportedCents;
  const differenceCents = existing.countedCents === null ? null : existing.countedCents;
  return {
    ...existing,
    expectedCents: 0,
    reportedDifferenceCents,
    conferenceDifferenceCents:
      existing.countedCents === null || existing.reportedCents === null
        ? null
        : existing.countedCents - existing.reportedCents,
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
  const reportedByChannelCents = emptyChannelTotals();
  const countedByChannelCents = emptyChannelTotals();
  const reportedDifferenceByChannelCents = emptyChannelTotals();
  const differenceByChannelCents = emptyChannelTotals();

  let expectedTotalCents = 0;
  let reportedTotalCents = 0;
  let countedTotalCents = 0;
  let reportedDifferenceTotalCents = 0;
  let differenceTotalCents = 0;
  let unreportedLineCount = 0;
  let pendingLineCount = 0;
  let reportedDivergentLineCount = 0;
  let divergentLineCount = 0;
  let reportedMatchedLineCount = 0;
  let matchedLineCount = 0;

  for (const line of lines) {
    expectedByChannelCents[line.channel] += line.expectedCents;
    expectedTotalCents += line.expectedCents;
    if (line.reportedCents === null) {
      unreportedLineCount++;
    } else {
      reportedByChannelCents[line.channel] += line.reportedCents;
      reportedTotalCents += line.reportedCents;
    }
    if (line.reportedDifferenceCents !== null) {
      reportedDifferenceByChannelCents[line.channel] += line.reportedDifferenceCents;
      reportedDifferenceTotalCents += line.reportedDifferenceCents;
      if (line.reportedDifferenceCents === 0) reportedMatchedLineCount++;
      else reportedDivergentLineCount++;
    }
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
    reportedTotalCents,
    countedTotalCents,
    reportedDifferenceTotalCents,
    differenceTotalCents,
    expectedByChannelCents,
    reportedByChannelCents,
    countedByChannelCents,
    reportedDifferenceByChannelCents,
    differenceByChannelCents,
    expectedCashCents: expectedByChannelCents.cash,
    reportedCashCents: reportedByChannelCents.cash,
    countedCashCents: countedByChannelCents.cash,
    unreportedLineCount,
    pendingLineCount,
    reportedDivergentLineCount,
    divergentLineCount,
    reportedMatchedLineCount,
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
  const normalizedExistingLines = existingLines.map((line) =>
    normalizeExistingLine(line, existingClosure?.status ?? "draft"),
  );
  const existingById = new Map(normalizedExistingLines.map((line) => [line.id, line]));
  const nextLines = built.lines.map((line) => {
    const id = cashClosureLineId(line.operatorId, line.channel);
    const existing = existingById.get(id);
    existingById.delete(id);
    return builtLineToPersistent(built, line, existing, now);
  });

  const deletedLineIds: string[] = [];
  for (const stale of existingById.values()) {
    if (stale.reportedCents === null && stale.countedCents === null) deletedLineIds.push(stale.id);
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

export function normalizeCashClosureWithLines(
  closure: CashClosure,
  lines: CashClosureLine[],
): { closure: CashClosure; lines: CashClosureLine[] } {
  const normalizedLines = lines.map((line) => normalizeExistingLine(line, closure.status));
  return {
    closure: recomputeCashClosureFromLines(withPdvAutomaticClosureTotals(closure), normalizedLines, closure.updatedAt),
    lines: normalizedLines,
  };
}

export function recalculateReportedLine(
  line: CashClosureLine,
  reportedCents: number | null,
  reportedNote: string | null,
  actorId: string,
  now: string,
): CashClosureLine {
  const reportedDifferenceCents = reportedCents === null ? null : reportedCents - line.expectedCents;
  return {
    ...line,
    reportedCents,
    reportedDifferenceCents,
    conferenceDifferenceCents:
      line.countedCents === null || reportedCents === null ? null : line.countedCents - reportedCents,
    reportedNote: reportedNote?.trim() || null,
    reportedBy: reportedCents === null ? null : actorId,
    reportedAt: reportedCents === null ? null : now,
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
    conferenceDifferenceCents:
      countedCents === null || line.reportedCents === null ? null : countedCents - line.reportedCents,
    differenceCents,
    status: lineStatus(countedCents, differenceCents),
    note: note?.trim() || null,
    countedBy: countedCents === null ? null : actorId,
    countedAt: countedCents === null ? null : now,
    updatedAt: now,
  };
}
