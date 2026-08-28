import { isPdvAutoCountedChannel } from "./channel-normalization";
import type { CashClosureLine, CashClosureStatus } from "./types";

export type CashClosureSingleCount = {
  cents: number | null;
  note: string | null;
  source: "pdv" | "manual" | "legacy_finance";
};

function reportedWasEditedAfterLegacyConference(line: CashClosureLine) {
  if (!line.reportedAt || !line.countedAt) return false;
  return line.reportedAt > line.countedAt;
}

export function resolveCashClosureSingleCount(
  line: CashClosureLine,
  closureStatus: CashClosureStatus,
): CashClosureSingleCount {
  if (isPdvAutoCountedChannel(line.channel)) {
    return { cents: line.expectedCents, note: null, source: "pdv" };
  }

  if (
    closureStatus === "pending_review"
    && line.countedCents !== null
    && !reportedWasEditedAfterLegacyConference(line)
  ) {
    const legacyNote = line.note?.trim()
      || line.reportedNote?.trim()
      || (line.countedCents !== line.expectedCents
        ? "Valor herdado da conferência financeira anterior."
        : null);
    return {
      cents: line.countedCents,
      note: legacyNote,
      source: "legacy_finance",
    };
  }

  return {
    cents: line.reportedCents,
    note: line.reportedNote?.trim() || null,
    source: "manual",
  };
}
