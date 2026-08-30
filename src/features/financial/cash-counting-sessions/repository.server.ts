import "server-only";

import { randomUUID } from "node:crypto";
import { FieldPath } from "firebase-admin/firestore";

import { financialDbAdmin } from "@/lib/firebase-financial-admin";
import type { CashClosure, CashClosureActor, CashClosureOperator } from "@/features/financial/cash-closures/types";
import { CASH_DEPOSIT_MAX_CENTS, type CashDepositBatch, type CashDepositBatchItem } from "@/features/financial/cash-deposits/types";
import { buildCashCountingBags, normalizeCashCountingDenominations } from "./denominations";
import type {
  CashCountingDenomination,
  CashCountingSession,
  CashCountingSessionAuditAction,
  CashCountingSessionAuditLog,
  CashCountingSessionBag,
  CashCountingSessionLock,
  CashCountingSessionOperator,
  CashCountingSessionScope,
} from "./types";

const SESSIONS = "cashCountingSessions";
const LOCKS = "cashCountingSessionLocks";
const SESSION_OPERATORS = "operators";
const SESSION_AUDIT = "cashCountingSessionAuditLogs";
const DEPOSIT_BATCHES = "cashDepositBatches";

function snapshotValue<T extends { id: string }>(snapshot: FirebaseFirestore.DocumentSnapshot) {
  return { id: snapshot.id, ...snapshot.data() } as T;
}

function periodKey(year: number, month: number) {
  return `${year}-${String(month).padStart(2, "0")}`;
}

export function cashCountingSessionScopeKey(kioskId: string, year: number, month: number) {
  return `${kioskId}:${periodKey(year, month)}`;
}

export function cashCountingSessionLockId(workspaceId: string, scopeKey: string) {
  return `${workspaceId}:${scopeKey}`;
}

function normalizeSession(session: CashCountingSession): CashCountingSession {
  return {
    ...session,
    finalizedOperatorCount: session.finalizedOperatorCount ?? 0,
    countedCashCents: session.countedCashCents ?? 0,
    depositEligibleCents: session.depositEligibleCents ?? 0,
    dreOnlyCashCents: session.dreOnlyCashCents ?? 0,
    denominationTotalCents: session.denominationTotalCents ?? 0,
    noteTotalCents: session.noteTotalCents ?? 0,
    coinTotalCents: session.coinTotalCents ?? 0,
    coinPendingExchangeCents: session.coinPendingExchangeCents ?? 0,
    coinExchangedCents: session.coinExchangedCents ?? 0,
    denominations: session.denominations ?? [],
    bags: session.bags ?? [],
    batchIds: session.batchIds ?? [],
    paidBatchCount: session.paidBatchCount ?? 0,
  };
}

function sessionAudit(input: {
  workspaceId: string;
  sessionId: string;
  action: CashCountingSessionAuditAction;
  actor: CashClosureActor;
  metadata?: Record<string, unknown>;
  now: string;
}): CashCountingSessionAuditLog {
  return {
    id: randomUUID(),
    workspaceId: input.workspaceId,
    sessionId: input.sessionId,
    action: input.action,
    actorId: input.actor.userId,
    actorName: input.actor.userName,
    metadata: input.metadata ?? {},
    createdAt: input.now,
  };
}

function assertSessionOwner(session: CashCountingSession, actor: CashClosureActor, canManageOthers = false) {
  if (session.openedBy !== actor.userId && !canManageOthers) {
    throw new Error(`A sessão está em uso por ${session.openedByName}.`);
  }
}

export async function createCashCountingSession(input: {
  workspaceId: string;
  units: Array<{ id: string; name: string }>;
  periods: Array<{ year: number; month: number }>;
  actor: CashClosureActor;
}) {
  const id = randomUUID();
  const now = new Date().toISOString();
  const scopes: CashCountingSessionScope[] = input.units.flatMap((unit) => input.periods.map((period) => ({
    key: cashCountingSessionScopeKey(unit.id, period.year, period.month),
    kioskId: unit.id,
    kioskName: unit.name,
    year: period.year,
    month: period.month,
  }))).sort((left, right) => left.key.localeCompare(right.key));
  const session: CashCountingSession = {
    id,
    workspaceId: input.workspaceId,
    status: "open",
    scopes,
    scopeKeys: scopes.map((scope) => scope.key),
    kioskIds: input.units.map((unit) => unit.id),
    kioskNames: input.units.map((unit) => unit.name),
    periodKeys: input.periods.map((period) => periodKey(period.year, period.month)).sort(),
    finalizedOperatorCount: 0,
    countedCashCents: 0,
    depositEligibleCents: 0,
    dreOnlyCashCents: 0,
    denominationTotalCents: 0,
    noteTotalCents: 0,
    coinTotalCents: 0,
    coinPendingExchangeCents: 0,
    coinExchangedCents: 0,
    denominations: [],
    bags: [],
    batchIds: [],
    paidBatchCount: 0,
    openedAt: now,
    openedBy: input.actor.userId,
    openedByName: input.actor.userName,
    countingFinishedAt: null,
    countingFinishedBy: null,
    denominationsConfirmedAt: null,
    denominationsConfirmedBy: null,
    completedAt: null,
    cancelledAt: null,
    cancelledBy: null,
    cancellationReason: null,
    createdAt: now,
    updatedAt: now,
  };

  await financialDbAdmin.runTransaction(async (transaction) => {
    const lockRefs = scopes.map((scope) => financialDbAdmin.collection(LOCKS).doc(
      cashCountingSessionLockId(input.workspaceId, scope.key),
    ));
    const lockSnapshots = await Promise.all(lockRefs.map((ref) => transaction.get(ref)));
    const existingSessionRefs = Array.from(new Set(lockSnapshots
      .filter((snapshot) => snapshot.exists)
      .map((snapshot) => String(snapshot.data()?.sessionId ?? ""))
      .filter(Boolean)))
      .map((sessionId) => financialDbAdmin.collection(SESSIONS).doc(sessionId));
    const existingSessionSnapshots = await Promise.all(existingSessionRefs.map((ref) => transaction.get(ref)));
    const activeById = new Map(existingSessionSnapshots
      .filter((snapshot) => snapshot.exists)
      .map((snapshot) => [snapshot.id, normalizeSession(snapshotValue<CashCountingSession>(snapshot))]));

    for (const lockSnapshot of lockSnapshots) {
      if (!lockSnapshot.exists) continue;
      const active = activeById.get(String(lockSnapshot.data()?.sessionId ?? ""));
      if (active?.status === "open") {
        const scope = scopes.find((item) => item.key === lockSnapshot.data()?.scopeKey);
        throw new Error(`Já existe uma sessão aberta para ${scope?.kioskName ?? "esta unidade"} em ${scope ? periodKey(scope.year, scope.month) : "esta competência"}.`);
      }
    }

    transaction.create(financialDbAdmin.collection(SESSIONS).doc(id), session);
    scopes.forEach((scope, index) => {
      const lock: CashCountingSessionLock = {
        id: lockRefs[index].id,
        workspaceId: input.workspaceId,
        scopeKey: scope.key,
        sessionId: id,
        kioskId: scope.kioskId,
        year: scope.year,
        month: scope.month,
        lockedAt: now,
        lockedBy: input.actor.userId,
      };
      transaction.set(lockRefs[index], lock);
    });
    const audit = sessionAudit({
      workspaceId: input.workspaceId,
      sessionId: id,
      action: "created",
      actor: input.actor,
      metadata: { scopeKeys: session.scopeKeys },
      now,
    });
    transaction.set(financialDbAdmin.collection(SESSION_AUDIT).doc(audit.id), audit);
  });
  return session;
}

export async function listCashCountingSessions(workspaceId: string, limit = 100) {
  const safeLimit = Math.min(Math.max(limit, 1), 25);
  const [openSnapshot, recentSnapshot] = await Promise.all([
    financialDbAdmin.collection(SESSIONS)
      .where("workspaceId", "==", workspaceId)
      .where("status", "==", "open")
      .limit(safeLimit)
      .get(),
    financialDbAdmin.collection(SESSIONS)
      .where("workspaceId", "==", workspaceId)
      .orderBy("createdAt", "desc")
      .limit(safeLimit)
      .get(),
  ]);
  const byId = new Map([...openSnapshot.docs, ...recentSnapshot.docs]
    .map((document) => [document.id, normalizeSession(snapshotValue<CashCountingSession>(document))]));
  return [...byId.values()]
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export type CashCountingSessionOperatorCursor = {
  finalizedAt: string;
  id: string;
};

export async function getCashCountingSession(
  sessionId: string,
  options: { operatorLimit?: number; operatorCursor?: CashCountingSessionOperatorCursor | null } = {},
) {
  const sessionRef = financialDbAdmin.collection(SESSIONS).doc(sessionId);
  const sessionSnapshot = await sessionRef.get();
  if (!sessionSnapshot.exists) return null;
  const session = normalizeSession(snapshotValue<CashCountingSession>(sessionSnapshot));
  if (session.finalizedOperatorCount === 0) {
    return { session, operators: [], nextOperatorCursor: null };
  }

  const operatorLimit = Math.min(Math.max(options.operatorLimit ?? 100, 1), 100);
  let operatorQuery: FirebaseFirestore.Query = sessionRef.collection(SESSION_OPERATORS)
    .orderBy("finalizedAt", "desc")
    .orderBy(FieldPath.documentId())
    .limit(operatorLimit + 1);
  if (options.operatorCursor) {
    operatorQuery = operatorQuery.startAfter(options.operatorCursor.finalizedAt, options.operatorCursor.id);
  }
  const operatorSnapshot = await operatorQuery.get();
  const documents = operatorSnapshot.docs.slice(0, operatorLimit);
  const lastDocument = documents.at(-1);
  return {
    session,
    operators: documents.map((document) => snapshotValue<CashCountingSessionOperator>(document)),
    nextOperatorCursor: operatorSnapshot.size > operatorLimit && lastDocument
      ? {
        finalizedAt: String(lastDocument.data().finalizedAt ?? ""),
        id: lastDocument.id,
      }
      : null,
  };
}

export async function prepareCashCountingSessionOperatorAttachment(
  transaction: FirebaseFirestore.Transaction,
  input: {
    sessionId: string;
    closure: CashClosure;
    operator: CashClosureOperator;
    actor: CashClosureActor;
    canManageOthers?: boolean;
    now: string;
  },
) {
  const sessionRef = financialDbAdmin.collection(SESSIONS).doc(input.sessionId);
  const scopeKey = cashCountingSessionScopeKey(input.closure.kioskId, input.closure.year, input.closure.month);
  const lockRef = financialDbAdmin.collection(LOCKS).doc(
    cashCountingSessionLockId(input.closure.workspaceId, scopeKey),
  );
  const [sessionSnapshot, lockSnapshot] = await Promise.all([
    transaction.get(sessionRef),
    transaction.get(lockRef),
  ]);
  if (!sessionSnapshot.exists) throw new Error("Sessão de contagem não encontrada.");
  const session = normalizeSession(snapshotValue<CashCountingSession>(sessionSnapshot));
  if (session.workspaceId !== input.closure.workspaceId) throw new Error("Sessão de contagem não encontrada.");
  if (session.status !== "open") throw new Error("A sessão de contagem já foi encerrada.");
  assertSessionOwner(session, input.actor, input.canManageOthers);
  if (!session.scopeKeys.includes(scopeKey)) {
    throw new Error("Este operador não pertence às unidades e competências da sessão.");
  }
  if (!lockSnapshot.exists || lockSnapshot.data()?.sessionId !== session.id) {
    throw new Error("O bloqueio da unidade e competência não pertence mais a esta sessão.");
  }

  const id = `${input.closure.id}_${input.operator.operatorId}`;
  const operatorRef = sessionRef.collection(SESSION_OPERATORS).doc(id);
  const existingOperatorSnapshot = await transaction.get(operatorRef);
  if (existingOperatorSnapshot.exists) {
    throw new Error(`A contagem de ${input.operator.operatorName} já foi vinculada a esta sessão.`);
  }
  const depositPolicy = input.closure.cashDepositPolicy === "dre_only" ? "dre_only" : "standard";
  const sessionOperator: CashCountingSessionOperator = {
    id,
    workspaceId: input.closure.workspaceId,
    sessionId: session.id,
    closureId: input.closure.id,
    closureDate: input.closure.date,
    year: input.closure.year,
    month: input.closure.month,
    kioskId: input.closure.kioskId,
    kioskName: input.closure.kioskName,
    operatorId: input.operator.operatorId,
    operatorName: input.operator.operatorName,
    countedCashCents: input.operator.countedCashCents,
    depositEligibleCents: depositPolicy === "dre_only" ? 0 : input.operator.countedCashCents,
    depositPolicy,
    finalizedAt: input.now,
    finalizedBy: input.actor.userId,
  };
  const audit = sessionAudit({
    workspaceId: input.closure.workspaceId,
    sessionId: session.id,
    action: "operator_attached",
    actor: input.actor,
    metadata: {
      closureId: input.closure.id,
      operatorId: input.operator.operatorId,
      countedCashCents: sessionOperator.countedCashCents,
      depositEligibleCents: sessionOperator.depositEligibleCents,
    },
    now: input.now,
  });
  const sessionUpdate: Pick<
    CashCountingSession,
    "finalizedOperatorCount" | "countedCashCents" | "depositEligibleCents" | "dreOnlyCashCents" | "updatedAt"
  > = {
    finalizedOperatorCount: session.finalizedOperatorCount + 1,
    countedCashCents: session.countedCashCents + sessionOperator.countedCashCents,
    depositEligibleCents: session.depositEligibleCents + sessionOperator.depositEligibleCents,
    dreOnlyCashCents: session.dreOnlyCashCents
      + (sessionOperator.depositPolicy === "dre_only" ? sessionOperator.countedCashCents : 0),
    updatedAt: input.now,
  };
  return { session, sessionRef, sessionUpdate, operatorRef, sessionOperator, audit };
}

export async function prepareCashCountingSessionOperatorDetachment(
  transaction: FirebaseFirestore.Transaction,
  input: {
    sessionId: string;
    closureId: string;
    operatorId: string;
    workspaceId: string;
    actor: CashClosureActor;
    now: string;
  },
) {
  const sessionRef = financialDbAdmin.collection(SESSIONS).doc(input.sessionId);
  const sessionSnapshot = await transaction.get(sessionRef);
  if (!sessionSnapshot.exists) throw new Error("Sessão de contagem não encontrada.");
  const session = normalizeSession(snapshotValue<CashCountingSession>(sessionSnapshot));
  if (session.workspaceId !== input.workspaceId) throw new Error("Sessão de contagem não encontrada.");
  const canReturnToCounting = session.status === "counted"
    || (session.status === "completed" && !session.denominationsConfirmedAt && session.batchIds.length === 0);
  if (session.status !== "open" && !canReturnToCounting) {
    throw new Error("A composição física da sessão já foi confirmada; a correção exige um ajuste auditado de depósito.");
  }
  const lockRefs = canReturnToCounting
    ? session.scopes.map((scope) => financialDbAdmin.collection(LOCKS).doc(
      cashCountingSessionLockId(input.workspaceId, scope.key),
    ))
    : [];
  const lockSnapshots = await Promise.all(lockRefs.map((ref) => transaction.get(ref)));
  if (lockSnapshots.some((snapshot) => snapshot.exists && snapshot.data()?.sessionId !== session.id)) {
    throw new Error("Outra sessão já usa uma das unidades e competências; não é possível reabrir esta contagem.");
  }
  const operatorRef = sessionRef.collection(SESSION_OPERATORS).doc(`${input.closureId}_${input.operatorId}`);
  const operatorSnapshot = await transaction.get(operatorRef);
  if (!operatorSnapshot.exists) throw new Error("A contagem do operador não está vinculada à sessão informada.");
  const sessionOperator = snapshotValue<CashCountingSessionOperator>(operatorSnapshot);
  const nextFinalizedOperatorCount = session.finalizedOperatorCount - 1;
  const nextCountedCashCents = session.countedCashCents - sessionOperator.countedCashCents;
  const nextDepositEligibleCents = session.depositEligibleCents - sessionOperator.depositEligibleCents;
  const nextDreOnlyCashCents = session.dreOnlyCashCents
    - (sessionOperator.depositPolicy === "dre_only" ? sessionOperator.countedCashCents : 0);
  if (
    nextFinalizedOperatorCount < 0
    || nextCountedCashCents < 0
    || nextDepositEligibleCents < 0
    || nextDreOnlyCashCents < 0
  ) {
    throw new Error("Os totais da sessão estão inconsistentes com os operadores vinculados.");
  }
  const audit = sessionAudit({
    workspaceId: input.workspaceId,
    sessionId: session.id,
    action: "operator_detached",
    actor: input.actor,
    metadata: { closureId: input.closureId, operatorId: input.operatorId },
    now: input.now,
  });
  const sessionUpdate = {
    status: canReturnToCounting ? "open" as const : session.status,
    finalizedOperatorCount: nextFinalizedOperatorCount,
    countedCashCents: nextCountedCashCents,
    depositEligibleCents: nextDepositEligibleCents,
    dreOnlyCashCents: nextDreOnlyCashCents,
    ...(canReturnToCounting ? {
      countingFinishedAt: null,
      countingFinishedBy: null,
      completedAt: null,
    } : {}),
    updatedAt: input.now,
  };
  const locks = canReturnToCounting ? session.scopes.map((scope, index) => ({
    ref: lockRefs[index],
    value: {
      id: lockRefs[index].id,
      workspaceId: input.workspaceId,
      scopeKey: scope.key,
      sessionId: session.id,
      kioskId: scope.kioskId,
      year: scope.year,
      month: scope.month,
      lockedAt: input.now,
      lockedBy: input.actor.userId,
    } satisfies CashCountingSessionLock,
  })) : [];
  return { operatorRef, audit, sessionRef, sessionUpdate, locks };
}

export async function finishCashCountingSession(input: {
  workspaceId: string;
  sessionId: string;
  actor: CashClosureActor;
  canManageOthers?: boolean;
}) {
  const sessionRef = financialDbAdmin.collection(SESSIONS).doc(input.sessionId);
  return financialDbAdmin.runTransaction(async (transaction) => {
    const sessionSnapshot = await transaction.get(sessionRef);
    if (!sessionSnapshot.exists) throw new Error("Sessão de contagem não encontrada.");
    const session = normalizeSession(snapshotValue<CashCountingSession>(sessionSnapshot));
    if (session.workspaceId !== input.workspaceId) throw new Error("Sessão de contagem não encontrada.");
    if (session.status !== "open") throw new Error("Somente uma sessão aberta pode encerrar a contagem.");
    assertSessionOwner(session, input.actor, input.canManageOthers);
    const lockRefs = session.scopeKeys.map((scopeKey) => financialDbAdmin.collection(LOCKS).doc(
      cashCountingSessionLockId(input.workspaceId, scopeKey),
    ));
    const lockSnapshots = await Promise.all(lockRefs.map((ref) => transaction.get(ref)));
    if (session.finalizedOperatorCount === 0) throw new Error("Finalize ao menos um operador antes de encerrar a sessão.");
    const now = new Date().toISOString();
    const next: CashCountingSession = {
      ...session,
      status: session.depositEligibleCents > 0 ? "counted" : "completed",
      countingFinishedAt: now,
      countingFinishedBy: input.actor.userId,
      completedAt: session.depositEligibleCents > 0 ? null : now,
      updatedAt: now,
    };
    transaction.set(sessionRef, next);
    lockSnapshots.forEach((lockSnapshot, index) => {
      if (lockSnapshot.exists && lockSnapshot.data()?.sessionId === session.id) {
        transaction.delete(lockRefs[index]);
      }
    });
    const audit = sessionAudit({
      workspaceId: input.workspaceId,
      sessionId: session.id,
      action: session.depositEligibleCents > 0 ? "counting_finished" : "completed",
      actor: input.actor,
      metadata: {
        finalizedOperatorCount: session.finalizedOperatorCount,
        countedCashCents: session.countedCashCents,
        depositEligibleCents: session.depositEligibleCents,
        dreOnlyCashCents: session.dreOnlyCashCents,
      },
      now,
    });
    transaction.set(financialDbAdmin.collection(SESSION_AUDIT).doc(audit.id), audit);
    return next;
  });
}

function sessionDepositBatch(input: {
  session: CashCountingSession;
  bag: CashCountingSessionBag;
  now: string;
}): { batch: CashDepositBatch; item: CashDepositBatchItem } {
  const batchId = `${input.session.id}_deposit_${String(input.bag.sequence).padStart(3, "0")}`;
  const dates = input.session.scopes.flatMap((scope) => {
    const lastDay = new Date(Date.UTC(scope.year, scope.month, 0)).getUTCDate();
    return [`${scope.year}-${String(scope.month).padStart(2, "0")}-01`, `${scope.year}-${String(scope.month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`];
  }).sort();
  const primaryKioskId = input.session.kioskIds[0] ?? "counting-session";
  const primaryKioskName = input.session.kioskNames.length === 1
    ? input.session.kioskNames[0]
    : `Sessão com ${input.session.kioskNames.length} unidades`;
  const batch: CashDepositBatch = {
    id: batchId,
    workspaceId: input.session.workspaceId,
    kioskId: primaryKioskId,
    kioskName: primaryKioskName,
    kioskIds: input.session.kioskIds,
    kioskNames: input.session.kioskNames,
    sourceScope: "counting_session",
    countingSessionId: input.session.id,
    countingSessionBagId: input.bag.id,
    denominations: input.bag.denominations,
    sequence: input.bag.sequence,
    status: "locked",
    maxCents: CASH_DEPOSIT_MAX_CENTS,
    grossTotalCents: input.bag.totalCents,
    totalCents: input.bag.totalCents,
    coinHoldCents: 0,
    coinPreparedAt: input.now,
    coinPreparedBy: input.session.denominationsConfirmedBy,
    remainingCapacityCents: CASH_DEPOSIT_MAX_CENTS - input.bag.totalCents,
    periodStartDate: dates[0] ?? input.session.createdAt.slice(0, 10),
    periodEndDate: dates.at(-1) ?? input.session.createdAt.slice(0, 10),
    closureIds: [],
    dates: [],
    itemCount: 1,
    lockReason: "manual_issue_requested",
    nextRejectedClosureId: null,
    nextRejectedCents: null,
    bankProvider: null,
    interCobrancaId: null,
    interCobrancaIds: [],
    bankWarning: null,
    lastBankSyncAt: null,
    ledgerTransactionId: null,
    createdAt: input.now,
    updatedAt: input.now,
    issuedAt: null,
    issuedBy: null,
    paidAt: null,
    cancelledAt: null,
    cancelledBy: null,
    cancellationReason: null,
  };
  const item: CashDepositBatchItem = {
    id: `${batchId}_session_cash`,
    workspaceId: input.session.workspaceId,
    batchId,
    closureId: `counting-session:${input.session.id}`,
    closureDate: batch.periodEndDate,
    kioskId: primaryKioskId,
    amountCents: input.bag.totalCents,
    source: "counting_session",
    operatorBreakdown: [],
    createdAt: input.now,
  };
  return { batch, item };
}

export async function confirmCashCountingSessionDenominations(input: {
  workspaceId: string;
  sessionId: string;
  entries: Array<{ valueCents: number; quantity: number }>;
  actor: CashClosureActor;
  canManageOthers?: boolean;
}) {
  const physical = normalizeCashCountingDenominations(input.entries);
  const sessionRef = financialDbAdmin.collection(SESSIONS).doc(input.sessionId);
  return financialDbAdmin.runTransaction(async (transaction) => {
    const sessionSnapshot = await transaction.get(sessionRef);
    if (!sessionSnapshot.exists) throw new Error("Sessão de contagem não encontrada.");
    const session = normalizeSession(snapshotValue<CashCountingSession>(sessionSnapshot));
    if (session.workspaceId !== input.workspaceId) throw new Error("Sessão de contagem não encontrada.");
    if (session.status !== "counted") throw new Error("Encerre a contagem da sessão antes de informar as denominações.");
    assertSessionOwner(session, input.actor, input.canManageOthers);
    if (physical.totalCents !== session.depositEligibleCents) {
      throw new Error(`O total físico informado não confere com o valor da sessão: esperado ${session.depositEligibleCents}, informado ${physical.totalCents}.`);
    }
    const now = new Date().toISOString();
    const preparedSession: CashCountingSession = {
      ...session,
      denominationsConfirmedAt: now,
      denominationsConfirmedBy: input.actor.userId,
    };
    const bags = buildCashCountingBags({
      sessionId: session.id,
      denominations: physical.denominations,
      maxCents: CASH_DEPOSIT_MAX_CENTS,
      source: "initial_notes",
    });
    const batches = bags.map((bag) => sessionDepositBatch({ session: preparedSession, bag, now }));
    const nextBags = bags.map((bag, index) => ({ ...bag, batchId: batches[index].batch.id }));
    const next: CashCountingSession = {
      ...preparedSession,
      status: "deposit_ready",
      denominationTotalCents: physical.totalCents,
      noteTotalCents: physical.noteTotalCents,
      coinTotalCents: physical.coinTotalCents,
      coinPendingExchangeCents: physical.coinTotalCents,
      denominations: physical.denominations,
      bags: nextBags,
      batchIds: batches.map(({ batch }) => batch.id),
      updatedAt: now,
    };
    transaction.set(sessionRef, next);
    for (const { batch, item } of batches) {
      const batchRef = financialDbAdmin.collection(DEPOSIT_BATCHES).doc(batch.id);
      transaction.create(batchRef, batch);
      transaction.create(batchRef.collection("items").doc(item.id), item);
    }
    const audit = sessionAudit({
      workspaceId: input.workspaceId,
      sessionId: session.id,
      action: "denominations_confirmed",
      actor: input.actor,
      metadata: {
        denominationTotalCents: physical.totalCents,
        noteTotalCents: physical.noteTotalCents,
        coinTotalCents: physical.coinTotalCents,
        batchIds: next.batchIds,
      },
      now,
    });
    transaction.set(financialDbAdmin.collection(SESSION_AUDIT).doc(audit.id), audit);
    return { session: next, batches: batches.map(({ batch }) => batch) };
  });
}

export async function exchangeCashCountingSessionCoins(input: {
  workspaceId: string;
  sessionId: string;
  entries: Array<{ valueCents: number; quantity: number }>;
  actor: CashClosureActor;
  canManageOthers?: boolean;
}) {
  const physical = normalizeCashCountingDenominations(input.entries);
  if (physical.coinTotalCents > 0) throw new Error("A troca deve ser informada somente com as novas cédulas.");
  if (physical.noteTotalCents <= 0) throw new Error("Informe as cédulas recebidas na troca.");
  const sessionRef = financialDbAdmin.collection(SESSIONS).doc(input.sessionId);
  return financialDbAdmin.runTransaction(async (transaction) => {
    const sessionSnapshot = await transaction.get(sessionRef);
    if (!sessionSnapshot.exists) throw new Error("Sessão de contagem não encontrada.");
    const session = normalizeSession(snapshotValue<CashCountingSession>(sessionSnapshot));
    if (session.workspaceId !== input.workspaceId) throw new Error("Sessão de contagem não encontrada.");
    if (session.status !== "deposit_ready") throw new Error("A sessão ainda não está pronta para depósito.");
    assertSessionOwner(session, input.actor, input.canManageOthers);
    if (physical.noteTotalCents > session.coinPendingExchangeCents) {
      throw new Error("O valor trocado ultrapassa o saldo de moedas desta sessão.");
    }
    const now = new Date().toISOString();
    const preparedSession: CashCountingSession = {
      ...session,
      denominationsConfirmedBy: input.actor.userId,
    };
    const bags = buildCashCountingBags({
      sessionId: session.id,
      denominations: physical.denominations,
      maxCents: CASH_DEPOSIT_MAX_CENTS,
      source: "coin_exchange",
      startingSequence: session.bags.length + 1,
    });
    const batches = bags.map((bag) => sessionDepositBatch({ session: preparedSession, bag, now }));
    const nextBags = bags.map((bag, index) => ({ ...bag, batchId: batches[index].batch.id }));
    const next: CashCountingSession = {
      ...session,
      coinPendingExchangeCents: session.coinPendingExchangeCents - physical.noteTotalCents,
      coinExchangedCents: session.coinExchangedCents + physical.noteTotalCents,
      bags: [...session.bags, ...nextBags],
      batchIds: [...session.batchIds, ...batches.map(({ batch }) => batch.id)],
      updatedAt: now,
    };
    transaction.set(sessionRef, next);
    for (const { batch, item } of batches) {
      const batchRef = financialDbAdmin.collection(DEPOSIT_BATCHES).doc(batch.id);
      transaction.create(batchRef, batch);
      transaction.create(batchRef.collection("items").doc(item.id), item);
    }
    const audit = sessionAudit({
      workspaceId: input.workspaceId,
      sessionId: session.id,
      action: "coins_exchanged",
      actor: input.actor,
      metadata: {
        exchangedCents: physical.noteTotalCents,
        pendingExchangeCents: next.coinPendingExchangeCents,
        batchIds: batches.map(({ batch }) => batch.id),
      },
      now,
    });
    transaction.set(financialDbAdmin.collection(SESSION_AUDIT).doc(audit.id), audit);
    return { session: next, batches: batches.map(({ batch }) => batch) };
  });
}

export async function cancelCashCountingSession(input: {
  workspaceId: string;
  sessionId: string;
  reason: string;
  actor: CashClosureActor;
  canManageOthers?: boolean;
}) {
  const sessionRef = financialDbAdmin.collection(SESSIONS).doc(input.sessionId);
  return financialDbAdmin.runTransaction(async (transaction) => {
    const sessionSnapshot = await transaction.get(sessionRef);
    if (!sessionSnapshot.exists) throw new Error("Sessão de contagem não encontrada.");
    const session = normalizeSession(snapshotValue<CashCountingSession>(sessionSnapshot));
    if (session.workspaceId !== input.workspaceId) throw new Error("Sessão de contagem não encontrada.");
    if (session.status !== "open") throw new Error("Somente uma sessão aberta e vazia pode ser cancelada.");
    assertSessionOwner(session, input.actor, input.canManageOthers);
    const operatorSnapshot = await transaction.get(sessionRef.collection(SESSION_OPERATORS).limit(1));
    if (!operatorSnapshot.empty) throw new Error("Encerre a sessão com as contagens já finalizadas em vez de cancelá-la.");
    const lockRefs = session.scopeKeys.map((scopeKey) => financialDbAdmin.collection(LOCKS).doc(
      cashCountingSessionLockId(input.workspaceId, scopeKey),
    ));
    const lockSnapshots = await Promise.all(lockRefs.map((ref) => transaction.get(ref)));
    const now = new Date().toISOString();
    const next: CashCountingSession = {
      ...session,
      status: "cancelled",
      cancelledAt: now,
      cancelledBy: input.actor.userId,
      cancellationReason: input.reason.trim(),
      updatedAt: now,
    };
    transaction.set(sessionRef, next);
    lockSnapshots.forEach((lockSnapshot, index) => {
      if (lockSnapshot.exists && lockSnapshot.data()?.sessionId === session.id) transaction.delete(lockRefs[index]);
    });
    const audit = sessionAudit({
      workspaceId: input.workspaceId,
      sessionId: session.id,
      action: "cancelled",
      actor: input.actor,
      metadata: { reason: next.cancellationReason },
      now,
    });
    transaction.set(financialDbAdmin.collection(SESSION_AUDIT).doc(audit.id), audit);
    return next;
  });
}
