export type CashCountingSessionPreflightSession = {
  id: string;
  status: string;
  kioskIds: string[];
  scopeAggregationVersion?: number | null;
};

export type CashCountingSessionPreflightLock = {
  id: string;
  sessionId: string;
  kioskId: string;
  lockKind?: string | null;
};

export function analyzeCashCountingSessionPreflight(input: {
  workspaceId: string;
  openSessions: CashCountingSessionPreflightSession[];
  referencedSessions: CashCountingSessionPreflightSession[];
  locks: CashCountingSessionPreflightLock[];
  truncated: boolean;
}) {
  const referencedById = new Map(input.referencedSessions.map((session) => [session.id, session]));
  const openSessionIdsByKiosk = new Map<string, string[]>();
  for (const session of input.openSessions) {
    for (const kioskId of session.kioskIds) {
      openSessionIdsByKiosk.set(kioskId, [...(openSessionIdsByKiosk.get(kioskId) ?? []), session.id]);
    }
  }

  const duplicateOpenUnits = [...openSessionIdsByKiosk.entries()]
    .filter(([, sessionIds]) => sessionIds.length > 1)
    .map(([kioskId, sessionIds]) => ({ kioskId, sessionIds: [...sessionIds].sort() }))
    .sort((left, right) => left.kioskId.localeCompare(right.kioskId));
  const globalLockByKiosk = new Map(input.locks
    .filter((lock) => lock.lockKind === "unit" || lock.id.includes(":unit:"))
    .map((lock) => [lock.kioskId, lock]));
  const missingGlobalLocks = input.openSessions.flatMap((session) => session.kioskIds
    .filter((kioskId) => globalLockByKiosk.get(kioskId)?.sessionId !== session.id)
    .map((kioskId) => ({ sessionId: session.id, kioskId })));
  const conflictingGlobalLocks = [...globalLockByKiosk.values()].flatMap((lock) => {
    const openOwners = openSessionIdsByKiosk.get(lock.kioskId) ?? [];
    return openOwners.length > 0 && !openOwners.includes(lock.sessionId)
      ? [{ lockId: lock.id, kioskId: lock.kioskId, lockSessionId: lock.sessionId, openSessionIds: openOwners }]
      : [];
  });
  const staleLocks: Array<{
    lockId: string;
    sessionId: string;
    reason: "missing_session" | "closed_session" | "unit_not_in_session";
  }> = [];
  for (const lock of input.locks) {
    const owner = referencedById.get(lock.sessionId);
    if (!owner) staleLocks.push({ lockId: lock.id, sessionId: lock.sessionId, reason: "missing_session" });
    else if (owner.status !== "open") staleLocks.push({ lockId: lock.id, sessionId: lock.sessionId, reason: "closed_session" });
    else if (!owner.kioskIds.includes(lock.kioskId)) {
      staleLocks.push({ lockId: lock.id, sessionId: lock.sessionId, reason: "unit_not_in_session" });
    }
  }
  const legacyOpenSessions = input.openSessions
    .filter((session) => session.scopeAggregationVersion !== 1)
    .map((session) => session.id)
    .sort();
  const blocking = input.truncated
    || duplicateOpenUnits.length > 0
    || missingGlobalLocks.length > 0
    || conflictingGlobalLocks.length > 0;

  return {
    workspaceId: input.workspaceId,
    blocking,
    truncated: input.truncated,
    counts: {
      openSessions: input.openSessions.length,
      locks: input.locks.length,
      duplicateOpenUnits: duplicateOpenUnits.length,
      missingGlobalLocks: missingGlobalLocks.length,
      conflictingGlobalLocks: conflictingGlobalLocks.length,
      staleLocks: staleLocks.length,
      legacyOpenSessions: legacyOpenSessions.length,
    },
    duplicateOpenUnits,
    missingGlobalLocks,
    conflictingGlobalLocks,
    staleLocks,
    legacyOpenSessions,
  };
}
