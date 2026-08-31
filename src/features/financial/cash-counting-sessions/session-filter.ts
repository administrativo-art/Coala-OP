import type { CashCountingSession } from "./types";

export type CashCountingSessionFilter = "active" | "completed" | "cancelled";

const ACTIVE_STATUSES = new Set<CashCountingSession["status"]>([
  "open",
  "counted",
  "deposit_ready",
]);

export function filterCashCountingSessions<T extends Pick<CashCountingSession, "status">>(
  sessions: T[],
  filter: CashCountingSessionFilter,
) {
  if (filter === "active") {
    return sessions.filter((session) => ACTIVE_STATUSES.has(session.status));
  }
  return sessions.filter((session) => session.status === filter);
}
