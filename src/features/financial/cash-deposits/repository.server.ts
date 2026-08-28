import "server-only";

import { randomUUID } from "node:crypto";

import { financialDbAdmin } from "@/lib/firebase-financial-admin";
import { refreshCashClosureSummaries } from "@/features/financial/cash-closures/summaries.server";
import { assertCashClosureTransition } from "@/features/financial/cash-closures/state-machine";
import { todayInClosureTimezone } from "@/features/financial/cash-closures/date";
import type {
  CashClosure,
  CashClosureActor,
  CashClosureAuditLog,
  CashClosureLine,
} from "@/features/financial/cash-closures/types";
import {
  allocateNegativeAdjustmentWithoutGoingBelowZero,
  appendClosureAllocationIdempotently,
  decideCashDepositAllocation,
} from "./allocation";
import {
  CASH_DEPOSIT_MAX_CENTS,
  normalizeCashDepositBatch,
  type CashDepositBatch,
  type CashDepositBatchItem,
  type CashDepositAdjustment,
  type CashCoinBalance,
  type CashCoinEvent,
} from "./types";

const BATCHES = "cashDepositBatches";
const QUEUES = "cashDepositQueues";
const COIN_BALANCES = "cashCoinBalances";
const COIN_EVENTS = "cashCoinEvents";

function queueId(workspaceId: string, kioskId: string) {
  return `${workspaceId}_${kioskId}`;
}

function batchId(workspaceId: string, kioskId: string, sequence: number) {
  return `${workspaceId}_${kioskId}_${String(sequence).padStart(6, "0")}`;
}

function snapshotValue<T extends { id: string }>(snapshot: FirebaseFirestore.DocumentSnapshot) {
  return { id: snapshot.id, ...snapshot.data() } as T;
}

function newBatch(input: {
  id: string;
  workspaceId: string;
  kioskId: string;
  kioskName: string;
  sequence: number;
  date: string;
  now: string;
}): CashDepositBatch {
  return {
    id: input.id,
    workspaceId: input.workspaceId,
    kioskId: input.kioskId,
    kioskName: input.kioskName,
    sequence: input.sequence,
    status: "open",
    maxCents: CASH_DEPOSIT_MAX_CENTS,
    grossTotalCents: 0,
    totalCents: 0,
    coinHoldCents: 0,
    coinPreparedAt: null,
    coinPreparedBy: null,
    remainingCapacityCents: CASH_DEPOSIT_MAX_CENTS,
    periodStartDate: input.date,
    periodEndDate: input.date,
    closureIds: [],
    dates: [],
    itemCount: 0,
    lockReason: null,
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
}

function auditLog(input: {
  workspaceId: string;
  closureId: string;
  actor: CashClosureActor;
  batchId: string;
  amountCents: number;
  now: string;
}): CashClosureAuditLog {
  const id = randomUUID();
  return {
    id,
    workspaceId: input.workspaceId,
    closureId: input.closureId,
    action: "deposit_allocated",
    newValue: { batchId: input.batchId, amountCents: input.amountCents },
    userId: input.actor.userId,
    userName: input.actor.userName,
    createdAt: input.now,
  };
}

async function allocateNextPendingClosure(workspaceId: string, kioskId: string, actor: CashClosureActor) {
  return financialDbAdmin.runTransaction(async (transaction) => {
    const pendingQuery = financialDbAdmin.collection("cashClosures")
      .where("workspaceId", "==", workspaceId)
      .where("kioskId", "==", kioskId)
      .where("status", "==", "approved")
      .where("cashDeposit.status", "==", "not_allocated")
      .where("cashDeposit.allocationReason", "==", "pending_allocator")
      .orderBy("approvedAt", "asc")
      .limit(1);
    const pendingSnapshot = await transaction.get(pendingQuery);
    if (pendingSnapshot.empty) return null;
    const closureDocument = pendingSnapshot.docs[0];
    const closure = snapshotValue<CashClosure>(closureDocument);
    const amountCents = closure.cashDeposit.eligibleCents;
    const existingItemSnapshot = await transaction.get(
      financialDbAdmin.collectionGroup("items")
        .where("workspaceId", "==", workspaceId)
        .where("closureId", "==", closure.id)
        .limit(1),
    );
    if (!existingItemSnapshot.empty) {
      const existingItemDocument = existingItemSnapshot.docs[0];
      const existingItem = snapshotValue<CashDepositBatchItem>(existingItemDocument);
      const now = new Date().toISOString();
      const cashDeposit = {
        ...closure.cashDeposit,
        batchId: existingItem.batchId,
        batchItemId: existingItem.id,
        status: "allocated" as const,
        manualSplitRequired: false,
        allocationReason: null,
        pendingSince: null,
      };
      const nextClosure: CashClosure = { ...closure, cashDeposit, updatedAt: now };
      transaction.set(closureDocument.ref, nextClosure);
      return { closure: nextClosure, allocated: true, repairedIdempotency: true };
    }
    const queueRef = financialDbAdmin.collection(QUEUES).doc(queueId(workspaceId, kioskId));
    const queueSnapshot = await transaction.get(queueRef);
    const queue = queueSnapshot.data() ?? {};
    const openBatchId = typeof queue.openBatchId === "string" ? queue.openBatchId : null;
    const openBatchRef = openBatchId ? financialDbAdmin.collection(BATCHES).doc(openBatchId) : null;
    const openBatchSnapshot = openBatchRef ? await transaction.get(openBatchRef) : null;
    const currentBatch = openBatchSnapshot?.exists
      ? normalizeCashDepositBatch(snapshotValue<CashDepositBatch>(openBatchSnapshot))
      : null;
    const cashLinesSnapshot = await transaction.get(
      closureDocument.ref.collection("lines").where("channel", "==", "cash"),
    );
    const cashLines = cashLinesSnapshot.docs.map((document) => snapshotValue<CashClosureLine>(document));
    const now = new Date().toISOString();
    const decision = decideCashDepositAllocation({
      currentBatchCents: currentBatch?.status === "open" ? currentBatch.totalCents : null,
      amountCents,
    });

    if (decision === "not_eligible") {
      transaction.set(closureDocument.ref, {
        cashDeposit: {
          ...closure.cashDeposit,
          status: "not_eligible",
          allocationReason: null,
          pendingSince: null,
        },
        updatedAt: now,
      }, { merge: true });
      return { closure: { ...closure, cashDeposit: { ...closure.cashDeposit, status: "not_eligible" as const } }, allocated: false };
    }

    if (decision === "manual_split_required") {
      const cashDeposit = {
        ...closure.cashDeposit,
        manualSplitRequired: true,
        allocationReason: "amount_exceeds_limit" as const,
      };
      transaction.set(closureDocument.ref, { cashDeposit, updatedAt: now }, { merge: true });
      return { closure: { ...closure, cashDeposit }, allocated: false };
    }

    let targetBatch = currentBatch?.status === "open" ? currentBatch : null;
    let nextSequence = Number.isSafeInteger(queue.nextSequence) && queue.nextSequence > 0
      ? Number(queue.nextSequence)
      : (currentBatch?.sequence ?? 0) + 1;

    if (decision === "lock_and_create_batch" && targetBatch) {
      transaction.set(financialDbAdmin.collection(BATCHES).doc(targetBatch.id), {
        status: "locked",
        lockReason: "next_item_would_exceed_limit",
        nextRejectedClosureId: closure.id,
        nextRejectedCents: amountCents,
        updatedAt: now,
      }, { merge: true });
      targetBatch = null;
    }

    if (!targetBatch) {
      const id = batchId(workspaceId, kioskId, nextSequence);
      targetBatch = newBatch({
        id,
        workspaceId,
        kioskId,
        kioskName: closure.kioskName,
        sequence: nextSequence,
        date: closure.date,
        now,
      });
      nextSequence++;
    }

    const targetRef = financialDbAdmin.collection(BATCHES).doc(targetBatch.id);
    const itemId = `${closure.id}_cash`;
    const item: CashDepositBatchItem = {
      id: itemId,
      workspaceId,
      batchId: targetBatch.id,
      closureId: closure.id,
      closureDate: closure.date,
      kioskId,
      amountCents,
      source: "cash_counted",
      operatorBreakdown: cashLines.map((line) => ({
        operatorId: line.operatorId,
        operatorName: line.operatorName,
        amountCents: line.countedCents ?? 0,
      })),
      createdAt: now,
    };
    const appended = appendClosureAllocationIdempotently({
      closureIds: targetBatch.closureIds,
      itemCount: targetBatch.itemCount,
      totalCents: targetBatch.totalCents,
      closureId: closure.id,
      amountCents,
    });
    const totalCents = appended.totalCents;
    const updatedBatch: CashDepositBatch = {
      ...targetBatch,
      grossTotalCents: targetBatch.grossTotalCents + amountCents,
      totalCents,
      remainingCapacityCents: targetBatch.maxCents - totalCents,
      periodStartDate: targetBatch.itemCount === 0 ? closure.date : [targetBatch.periodStartDate, closure.date].sort()[0],
      periodEndDate: targetBatch.itemCount === 0 ? closure.date : [targetBatch.periodEndDate, closure.date].sort().at(-1)!,
      closureIds: appended.closureIds,
      dates: targetBatch.dates.includes(closure.date) ? targetBatch.dates : [...targetBatch.dates, closure.date],
      itemCount: appended.itemCount,
      updatedAt: now,
    };
    const cashDeposit = {
      ...closure.cashDeposit,
      batchId: targetBatch.id,
      batchItemId: itemId,
      status: "allocated" as const,
      manualSplitRequired: false,
      allocationReason: null,
      pendingSince: null,
    };
    const nextClosure: CashClosure = { ...closure, cashDeposit, updatedAt: now };
    const log = auditLog({ workspaceId, closureId: closure.id, actor, batchId: targetBatch.id, amountCents, now });

    transaction.set(targetRef, updatedBatch);
    transaction.set(targetRef.collection("items").doc(itemId), item);
    transaction.set(closureDocument.ref, nextClosure);
    transaction.set(financialDbAdmin.collection("cashClosureAuditLogs").doc(log.id), log);
    transaction.set(queueRef, {
      workspaceId,
      kioskId,
      openBatchId: targetBatch.id,
      nextSequence,
      updatedAt: now,
    }, { merge: true });
    return { closure: nextClosure, batch: updatedBatch, item, allocated: true };
  });
}

export async function allocatePendingCashClosures(
  workspaceId: string,
  kioskId: string,
  actor: CashClosureActor,
  limit = 100,
) {
  const results = [];
  for (let index = 0; index < limit; index++) {
    const result = await allocateNextPendingClosure(workspaceId, kioskId, actor);
    if (!result) break;
    results.push(result);
    await refreshCashClosureSummaries(result.closure);
    if (!result.allocated) break;
  }
  return results;
}

export async function splitOversizedCashClosure(input: {
  workspaceId: string;
  closureId: string;
  partsCents: number[];
  actor: CashClosureActor;
}) {
  if (input.partsCents.length < 2 || input.partsCents.some((part) => !Number.isSafeInteger(part) || part <= 0 || part > CASH_DEPOSIT_MAX_CENTS)) {
    throw new Error("Divisão manual inválida.");
  }
  const closureRef = financialDbAdmin.collection("cashClosures").doc(input.closureId);
  const result = await financialDbAdmin.runTransaction(async (transaction) => {
    const closureSnapshot = await transaction.get(closureRef);
    if (!closureSnapshot.exists) throw new Error("Fechamento não encontrado.");
    const closure = snapshotValue<CashClosure>(closureSnapshot);
    if (closure.workspaceId !== input.workspaceId) throw new Error("Fechamento não encontrado.");
    if (closure.status !== "approved" || !closure.cashDeposit.manualSplitRequired) {
      throw new Error("Este fechamento não está aguardando divisão manual.");
    }
    const sum = input.partsCents.reduce((total, part) => total + part, 0);
    if (sum !== closure.cashDeposit.eligibleCents) {
      throw new Error("A soma das partes precisa ser igual ao dinheiro elegível do fechamento.");
    }

    const queueRef = financialDbAdmin.collection(QUEUES).doc(queueId(input.workspaceId, closure.kioskId));
    const queueSnapshot = await transaction.get(queueRef);
    const queue = queueSnapshot.data() ?? {};
    const currentId = typeof queue.openBatchId === "string" ? queue.openBatchId : null;
    const currentRef = currentId ? financialDbAdmin.collection(BATCHES).doc(currentId) : null;
    const currentSnapshot = currentRef ? await transaction.get(currentRef) : null;
    let current = currentSnapshot?.exists
      ? normalizeCashDepositBatch(snapshotValue<CashDepositBatch>(currentSnapshot))
      : null;
    if (current?.status !== "open") current = null;
    const cashLinesSnapshot = await transaction.get(closureRef.collection("lines").where("channel", "==", "cash"));
    const cashLines = cashLinesSnapshot.docs.map((document) => snapshotValue<CashClosureLine>(document));
    const now = new Date().toISOString();
    let nextSequence = Number.isSafeInteger(queue.nextSequence) && queue.nextSequence > 0
      ? Number(queue.nextSequence)
      : (current?.sequence ?? 0) + 1;
    const batchIds: string[] = [];
    const itemIds: string[] = [];

    for (const [index, partCents] of input.partsCents.entries()) {
      if (current && current.totalCents + partCents > current.maxCents) {
        transaction.set(financialDbAdmin.collection(BATCHES).doc(current.id), {
          ...current,
          status: "locked",
          lockReason: "next_item_would_exceed_limit",
          nextRejectedClosureId: closure.id,
          nextRejectedCents: partCents,
          updatedAt: now,
        });
        current = null;
      }
      if (!current) {
        const id = batchId(input.workspaceId, closure.kioskId, nextSequence);
        current = newBatch({
          id,
          workspaceId: input.workspaceId,
          kioskId: closure.kioskId,
          kioskName: closure.kioskName,
          sequence: nextSequence,
          date: closure.date,
          now,
        });
        nextSequence++;
      }
      const itemId = `${closure.id}_cash_split_${index + 1}`;
      const item: CashDepositBatchItem = {
        id: itemId,
        workspaceId: input.workspaceId,
        batchId: current.id,
        closureId: closure.id,
        closureDate: closure.date,
        kioskId: closure.kioskId,
        amountCents: partCents,
        source: "manual_split",
        operatorBreakdown: cashLines.map((line) => ({
          operatorId: line.operatorId,
          operatorName: line.operatorName,
          amountCents: line.countedCents ?? 0,
        })),
        createdAt: now,
      };
      const totalCents = current.totalCents + partCents;
      current = {
        ...current,
        grossTotalCents: current.grossTotalCents + partCents,
        totalCents,
        remainingCapacityCents: current.maxCents - totalCents,
        periodStartDate: current.itemCount === 0 ? closure.date : [current.periodStartDate, closure.date].sort()[0],
        periodEndDate: current.itemCount === 0 ? closure.date : [current.periodEndDate, closure.date].sort().at(-1)!,
        closureIds: current.closureIds.includes(closure.id) ? current.closureIds : [...current.closureIds, closure.id],
        dates: current.dates.includes(closure.date) ? current.dates : [...current.dates, closure.date],
        itemCount: current.itemCount + 1,
        updatedAt: now,
      };
      transaction.set(financialDbAdmin.collection(BATCHES).doc(current.id), current);
      transaction.set(financialDbAdmin.collection(BATCHES).doc(current.id).collection("items").doc(itemId), item);
      batchIds.push(current.id);
      itemIds.push(itemId);
    }

    const uniqueBatchIds = Array.from(new Set(batchIds));
    const cashDeposit = {
      ...closure.cashDeposit,
      batchId: uniqueBatchIds[0] ?? null,
      batchItemId: itemIds[0] ?? null,
      manualSplitBatchIds: uniqueBatchIds,
      status: "allocated" as const,
      manualSplitRequired: false,
      allocationReason: null,
      pendingSince: null,
    };
    const nextClosure: CashClosure = { ...closure, cashDeposit, updatedAt: now };
    const log = auditLog({
      workspaceId: input.workspaceId,
      closureId: closure.id,
      actor: input.actor,
      batchId: uniqueBatchIds.join(","),
      amountCents: closure.cashDeposit.eligibleCents,
      now,
    });
    transaction.set(closureRef, nextClosure);
    transaction.set(financialDbAdmin.collection("cashClosureAuditLogs").doc(log.id), {
      ...log,
      newValue: { batchIds: uniqueBatchIds, partsCents: input.partsCents },
    });
    transaction.set(queueRef, {
      workspaceId: input.workspaceId,
      kioskId: closure.kioskId,
      openBatchId: current?.id ?? null,
      nextSequence,
      updatedAt: now,
    }, { merge: true });
    return { closure: nextClosure, batchIds: uniqueBatchIds, itemIds };
  });
  await refreshCashClosureSummaries(result.closure);
  await processCashDepositQueue(input.workspaceId, result.closure.kioskId, input.actor);
  return result;
}

export async function listCashDepositBatches(input: {
  workspaceId: string;
  kioskId?: string;
  limit?: number;
}) {
  let query: FirebaseFirestore.Query = financialDbAdmin.collection(BATCHES)
    .where("workspaceId", "==", input.workspaceId);
  if (input.kioskId) query = query.where("kioskId", "==", input.kioskId);
  query = query.orderBy("createdAt", "desc").limit(Math.min(Math.max(input.limit ?? 200, 1), 500));
  const snapshot = await query.get();
  return snapshot.docs.map((document) => normalizeCashDepositBatch(snapshotValue<CashDepositBatch>(document)));
}

export async function getCashDepositBatch(id: string) {
  const ref = financialDbAdmin.collection(BATCHES).doc(id);
  const [batchSnapshot, itemSnapshot] = await Promise.all([ref.get(), ref.collection("items").get()]);
  if (!batchSnapshot.exists) return null;
  return {
    batch: normalizeCashDepositBatch(snapshotValue<CashDepositBatch>(batchSnapshot)),
    items: itemSnapshot.docs.map((document) => snapshotValue<CashDepositBatchItem>(document)),
  };
}

export async function listCashCoinBalances(workspaceId: string, limit = 100) {
  const snapshot = await financialDbAdmin.collection(COIN_BALANCES)
    .where("workspaceId", "==", workspaceId)
    .limit(Math.min(Math.max(limit, 1), 200))
    .get();
  return snapshot.docs
    .map((document) => snapshotValue<CashCoinBalance>(document))
    .sort((left, right) => left.kioskName.localeCompare(right.kioskName, "pt-BR"));
}

export async function prepareCashDepositCoinHold(input: {
  workspaceId: string;
  batchId: string;
  coinCents: number;
  actor: CashClosureActor;
}) {
  if (!Number.isSafeInteger(input.coinCents) || input.coinCents < 0) {
    throw new Error("Valor em moedas inválido.");
  }
  const batchRef = financialDbAdmin.collection(BATCHES).doc(input.batchId);
  const itemRef = batchRef.collection("items").doc(`${input.batchId}_coin_hold`);
  return financialDbAdmin.runTransaction(async (transaction) => {
    const batchSnapshot = await transaction.get(batchRef);
    if (!batchSnapshot.exists) throw new Error("Bloco de depósito não encontrado.");
    const batch = normalizeCashDepositBatch(snapshotValue<CashDepositBatch>(batchSnapshot));
    if (batch.workspaceId !== input.workspaceId) throw new Error("Bloco de depósito não encontrado.");
    if (!["open", "locked", "failed", "cancelled"].includes(batch.status)) {
      throw new Error("As moedas só podem ser separadas antes da emissão do boleto.");
    }
    if (input.coinCents > batch.grossTotalCents) {
      throw new Error("O valor em moedas não pode ultrapassar o total físico do bloco.");
    }
    const balanceRef = financialDbAdmin.collection(COIN_BALANCES).doc(queueId(input.workspaceId, batch.kioskId));
    const balanceSnapshot = await transaction.get(balanceRef);
    const currentBalance = balanceSnapshot.exists
      ? snapshotValue<CashCoinBalance>(balanceSnapshot)
      : {
          id: balanceRef.id,
          workspaceId: input.workspaceId,
          kioskId: batch.kioskId,
          kioskName: batch.kioskName,
          pendingExchangeCents: 0,
          exchangedCents: 0,
          updatedAt: batch.updatedAt,
        };
    const holdDeltaCents = input.coinCents - batch.coinHoldCents;
    const pendingExchangeCents = currentBalance.pendingExchangeCents + holdDeltaCents;
    if (pendingExchangeCents < 0) {
      throw new Error("Parte das moedas deste bloco já foi trocada e não pode ser removida da separação.");
    }
    const now = new Date().toISOString();
    const totalCents = batch.grossTotalCents - input.coinCents;
    const nextBatch: CashDepositBatch = {
      ...batch,
      status: batch.status === "open" ? "locked" : batch.status,
      lockReason: batch.lockReason ?? "manual_issue_requested",
      totalCents,
      remainingCapacityCents: batch.maxCents - totalCents,
      coinHoldCents: input.coinCents,
      coinPreparedAt: now,
      coinPreparedBy: input.actor.userId,
      itemCount: batch.itemCount + (batch.coinHoldCents === 0 && input.coinCents > 0 ? 1 : batch.coinHoldCents > 0 && input.coinCents === 0 ? -1 : 0),
      updatedAt: now,
    };
    const nextBalance: CashCoinBalance = {
      ...currentBalance,
      kioskName: batch.kioskName,
      pendingExchangeCents,
      updatedAt: now,
    };
    const eventRef = financialDbAdmin.collection(COIN_EVENTS).doc(randomUUID());
    const event: CashCoinEvent = {
      id: eventRef.id,
      workspaceId: input.workspaceId,
      kioskId: batch.kioskId,
      batchId: batch.id,
      type: batch.coinPreparedAt ? "hold_adjusted" : "held_for_exchange",
      amountCents: holdDeltaCents,
      previousBalanceCents: currentBalance.pendingExchangeCents,
      newBalanceCents: pendingExchangeCents,
      actorId: input.actor.userId,
      actorName: input.actor.userName,
      createdAt: now,
    };
    transaction.set(batchRef, nextBatch);
    if (input.coinCents > 0) {
      const item: CashDepositBatchItem = {
        id: itemRef.id,
        workspaceId: input.workspaceId,
        batchId: batch.id,
        closureId: `coin-hold:${batch.id}`,
        closureDate: batch.periodEndDate,
        kioskId: batch.kioskId,
        amountCents: -input.coinCents,
        source: "coin_hold",
        operatorBreakdown: [],
        createdAt: batch.coinPreparedAt ?? now,
      };
      transaction.set(itemRef, item);
    } else {
      transaction.delete(itemRef);
    }
    transaction.set(balanceRef, nextBalance);
    transaction.set(eventRef, event);
    return { batch: nextBatch, balance: nextBalance, event };
  });
}

export async function registerCashCoinExchange(input: {
  workspaceId: string;
  kioskId: string;
  amountCents: number;
  operationId: string;
  actor: CashClosureActor;
}) {
  if (!Number.isSafeInteger(input.amountCents) || input.amountCents <= 0 || input.amountCents > CASH_DEPOSIT_MAX_CENTS) {
    throw new Error("Valor da troca inválido.");
  }
  const balanceRef = financialDbAdmin.collection(COIN_BALANCES).doc(queueId(input.workspaceId, input.kioskId));
  const eventRef = financialDbAdmin.collection(COIN_EVENTS).doc(input.operationId);
  return financialDbAdmin.runTransaction(async (transaction) => {
    const existingEvent = await transaction.get(eventRef);
    if (existingEvent.exists) {
      const event = snapshotValue<CashCoinEvent>(existingEvent);
      if (
        event.workspaceId !== input.workspaceId
        || event.kioskId !== input.kioskId
        || event.type !== "exchanged_to_notes"
        || event.amountCents !== input.amountCents
      ) {
        throw new Error("A chave idempotente já foi usada em outra troca de moedas.");
      }
      return { event, idempotent: true };
    }
    const balanceSnapshot = await transaction.get(balanceRef);
    if (!balanceSnapshot.exists) throw new Error("Saldo de moedas não encontrado.");
    const balance = snapshotValue<CashCoinBalance>(balanceSnapshot);
    if (balance.workspaceId !== input.workspaceId || balance.kioskId !== input.kioskId) {
      throw new Error("Saldo de moedas não encontrado.");
    }
    if (input.amountCents > balance.pendingExchangeCents) {
      throw new Error("O valor da troca ultrapassa o saldo de moedas pendente.");
    }
    const queueRef = financialDbAdmin.collection(QUEUES).doc(queueId(input.workspaceId, input.kioskId));
    const queueSnapshot = await transaction.get(queueRef);
    const queue = queueSnapshot.data() ?? {};
    const openBatchId = typeof queue.openBatchId === "string" ? queue.openBatchId : null;
    const openBatchRef = openBatchId ? financialDbAdmin.collection(BATCHES).doc(openBatchId) : null;
    const openBatchSnapshot = openBatchRef ? await transaction.get(openBatchRef) : null;
    let targetBatch = openBatchSnapshot?.exists
      ? normalizeCashDepositBatch(snapshotValue<CashDepositBatch>(openBatchSnapshot))
      : null;
    if (targetBatch?.status !== "open") targetBatch = null;
    const now = new Date().toISOString();
    const date = todayInClosureTimezone();
    let nextSequence = Number.isSafeInteger(queue.nextSequence) && queue.nextSequence > 0
      ? Number(queue.nextSequence)
      : (targetBatch?.sequence ?? 0) + 1;
    if (targetBatch && targetBatch.totalCents + input.amountCents > targetBatch.maxCents) {
      transaction.set(financialDbAdmin.collection(BATCHES).doc(targetBatch.id), {
        status: "locked",
        lockReason: "next_item_would_exceed_limit",
        nextRejectedClosureId: `coin-exchange:${input.operationId}`,
        nextRejectedCents: input.amountCents,
        updatedAt: now,
      }, { merge: true });
      targetBatch = null;
    }
    if (!targetBatch) {
      const id = batchId(input.workspaceId, input.kioskId, nextSequence);
      targetBatch = newBatch({
        id,
        workspaceId: input.workspaceId,
        kioskId: input.kioskId,
        kioskName: balance.kioskName,
        sequence: nextSequence,
        date,
        now,
      });
      nextSequence++;
    }
    const targetRef = financialDbAdmin.collection(BATCHES).doc(targetBatch.id);
    const item: CashDepositBatchItem = {
      id: `${input.operationId}_coin_exchange`,
      workspaceId: input.workspaceId,
      batchId: targetBatch.id,
      closureId: `coin-exchange:${input.operationId}`,
      closureDate: date,
      kioskId: input.kioskId,
      amountCents: input.amountCents,
      source: "coin_exchange",
      operatorBreakdown: [],
      createdAt: now,
    };
    const totalCents = targetBatch.totalCents + input.amountCents;
    const nextBatch: CashDepositBatch = {
      ...targetBatch,
      grossTotalCents: targetBatch.grossTotalCents + input.amountCents,
      totalCents,
      remainingCapacityCents: targetBatch.maxCents - totalCents,
      periodStartDate: targetBatch.itemCount === 0 ? date : [targetBatch.periodStartDate, date].sort()[0],
      periodEndDate: targetBatch.itemCount === 0 ? date : [targetBatch.periodEndDate, date].sort().at(-1)!,
      dates: targetBatch.dates.includes(date) ? targetBatch.dates : [...targetBatch.dates, date],
      itemCount: targetBatch.itemCount + 1,
      updatedAt: now,
    };
    const nextBalance: CashCoinBalance = {
      ...balance,
      pendingExchangeCents: balance.pendingExchangeCents - input.amountCents,
      exchangedCents: balance.exchangedCents + input.amountCents,
      updatedAt: now,
    };
    const event: CashCoinEvent = {
      id: eventRef.id,
      workspaceId: input.workspaceId,
      kioskId: input.kioskId,
      batchId: targetBatch.id,
      type: "exchanged_to_notes",
      amountCents: input.amountCents,
      previousBalanceCents: balance.pendingExchangeCents,
      newBalanceCents: nextBalance.pendingExchangeCents,
      actorId: input.actor.userId,
      actorName: input.actor.userName,
      createdAt: now,
    };
    transaction.set(targetRef, nextBatch);
    transaction.set(targetRef.collection("items").doc(item.id), item);
    transaction.set(balanceRef, nextBalance);
    transaction.create(eventRef, event);
    transaction.set(queueRef, {
      workspaceId: input.workspaceId,
      kioskId: input.kioskId,
      openBatchId: targetBatch.id,
      nextSequence,
      updatedAt: now,
    }, { merge: true });
    return { batch: nextBatch, balance: nextBalance, event, idempotent: false };
  });
}

export async function reopenCashClosureWithDepositHandling(input: {
  workspaceId: string;
  closureId: string;
  reason: string;
  actor: CashClosureActor;
}) {
  const reason = input.reason.trim();
  if (!reason) throw new Error("Informe o motivo da reabertura.");
  const closureRef = financialDbAdmin.collection("cashClosures").doc(input.closureId);
  const result = await financialDbAdmin.runTransaction(async (transaction) => {
    const closureSnapshot = await transaction.get(closureRef);
    if (!closureSnapshot.exists) throw new Error("Fechamento não encontrado.");
    const closure = snapshotValue<CashClosure>(closureSnapshot);
    if (closure.workspaceId !== input.workspaceId) throw new Error("Fechamento não encontrado.");
    assertCashClosureTransition(closure.status, "reopened");

    const batchIds = Array.from(new Set(
      closure.cashDeposit.manualSplitBatchIds?.length
        ? closure.cashDeposit.manualSplitBatchIds
        : closure.cashDeposit.batchId
          ? [closure.cashDeposit.batchId]
          : [],
    ));
    const batchData: Array<{
      ref: FirebaseFirestore.DocumentReference;
      batch: CashDepositBatch;
      items: CashDepositBatchItem[];
      itemRefs: FirebaseFirestore.DocumentReference[];
    }> = [];
    for (const id of batchIds) {
      const ref = financialDbAdmin.collection(BATCHES).doc(id);
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists) continue;
      const itemSnapshot = await transaction.get(ref.collection("items").where("closureId", "==", closure.id));
      batchData.push({
        ref,
        batch: normalizeCashDepositBatch(snapshotValue<CashDepositBatch>(snapshot)),
        items: itemSnapshot.docs.map((document) => snapshotValue<CashDepositBatchItem>(document)),
        itemRefs: itemSnapshot.docs.map((document) => document.ref),
      });
    }

    const now = new Date().toISOString();
    const hasIssuedHistory = batchData.some(({ batch }) =>
      ["issuing", "issued", "paid"].includes(batch.status) || batch.coinPreparedAt !== null
    );
    let cashDeposit = closure.cashDeposit;
    let adjustment: CashDepositAdjustment | null = null;

    if (hasIssuedHistory) {
      const adjustmentId = randomUUID();
      adjustment = {
        id: adjustmentId,
        workspaceId: input.workspaceId,
        kioskId: closure.kioskId,
        closureId: closure.id,
        batchId: batchIds.join(","),
        originalCents: closure.cashDeposit.eligibleCents,
        revisedCents: closure.cashDeposit.eligibleCents,
        deltaCents: 0,
        allocatedCents: 0,
        pendingAllocationCents: 0,
        targetBatchIds: [],
        reason,
        status: "pending_allocation",
        createdAt: now,
        createdBy: input.actor.userId,
        updatedAt: now,
      };
      transaction.set(financialDbAdmin.collection("cashDepositAdjustments").doc(adjustmentId), adjustment);
      cashDeposit = {
        ...closure.cashDeposit,
        status: "adjusted",
        adjustmentId,
        pendingSince: now,
        allocationReason: null,
      };
    } else if (batchData.length > 0) {
      for (const data of batchData) {
        const removedCents = data.items.reduce((total, item) => total + item.amountCents, 0);
        const totalCents = Math.max(0, data.batch.totalCents - removedCents);
        transaction.set(data.ref, {
          ...data.batch,
          grossTotalCents: Math.max(0, data.batch.grossTotalCents - removedCents),
          totalCents,
          remainingCapacityCents: data.batch.maxCents - totalCents,
          closureIds: data.batch.closureIds.filter((id) => id !== closure.id),
          dates: data.batch.dates.filter((date) => date !== closure.date),
          itemCount: Math.max(0, data.batch.itemCount - data.items.length),
          updatedAt: now,
        });
        for (const itemRef of data.itemRefs) transaction.delete(itemRef);
      }
      cashDeposit = {
        eligibleCents: closure.cashDeposit.eligibleCents,
        batchId: null,
        batchItemId: null,
        status: "not_allocated",
        manualSplitRequired: false,
        allocationReason: null,
        pendingSince: null,
      };
    }

    const nextClosure: CashClosure = {
      ...closure,
      status: "reopened",
      cashDeposit,
      reopenedAt: now,
      reopenedBy: input.actor.userId,
      reopenedReason: reason,
      updatedAt: now,
    };
    transaction.set(closureRef, nextClosure);
    const reopenLogId = randomUUID();
    transaction.set(financialDbAdmin.collection("cashClosureAuditLogs").doc(reopenLogId), {
      id: reopenLogId,
      workspaceId: input.workspaceId,
      closureId: closure.id,
      action: "reopened",
      previousValue: closure.status,
      newValue: "reopened",
      reason,
      userId: input.actor.userId,
      userName: input.actor.userName,
      createdAt: now,
    });
    if (adjustment) {
      const adjustmentLogId = randomUUID();
      transaction.set(financialDbAdmin.collection("cashClosureAuditLogs").doc(adjustmentLogId), {
        id: adjustmentLogId,
        workspaceId: input.workspaceId,
        closureId: closure.id,
        action: "deposit_adjustment_created",
        newValue: { adjustmentId: adjustment.id, batchIds },
        reason,
        userId: input.actor.userId,
        userName: input.actor.userName,
        createdAt: now,
      });
    }
    return { closure: nextClosure, adjustment };
  });
  await refreshCashClosureSummaries(result.closure);
  return result;
}

export async function finalizeCashDepositAdjustmentForClosure(closureId: string) {
  const closureRef = financialDbAdmin.collection("cashClosures").doc(closureId);
  return financialDbAdmin.runTransaction(async (transaction) => {
    const closureSnapshot = await transaction.get(closureRef);
    if (!closureSnapshot.exists) return null;
    const closure = snapshotValue<CashClosure>(closureSnapshot);
    const adjustmentId = closure.cashDeposit.adjustmentId;
    if (!adjustmentId) return null;
    const adjustmentRef = financialDbAdmin.collection("cashDepositAdjustments").doc(adjustmentId);
    const adjustmentSnapshot = await transaction.get(adjustmentRef);
    if (!adjustmentSnapshot.exists) throw new Error("Ajuste de depósito não encontrado.");
    const adjustment = snapshotValue<CashDepositAdjustment>(adjustmentSnapshot);
    const deltaCents = closure.cashDeposit.eligibleCents - adjustment.originalCents;
    const now = new Date().toISOString();
    const next: CashDepositAdjustment = {
      ...adjustment,
      revisedCents: closure.cashDeposit.eligibleCents,
      deltaCents,
      allocatedCents: 0,
      pendingAllocationCents: deltaCents,
      status: deltaCents === 0 ? "resolved" : "pending_allocation",
      updatedAt: now,
    };
    transaction.set(adjustmentRef, next);
    transaction.set(closureRef, {
      cashDeposit: {
        ...closure.cashDeposit,
        status: "adjusted",
        pendingSince: deltaCents === 0 ? null : now,
      },
      updatedAt: now,
    }, { merge: true });
    return next;
  });
}

async function allocateNextPendingCashDepositAdjustment(
  workspaceId: string,
  kioskId: string,
  actor: CashClosureActor,
) {
  return financialDbAdmin.runTransaction(async (transaction) => {
    const pendingSnapshot = await transaction.get(
      financialDbAdmin.collection("cashDepositAdjustments")
        .where("workspaceId", "==", workspaceId)
        .where("kioskId", "==", kioskId)
        .where("status", "==", "pending_allocation")
        .orderBy("createdAt", "asc")
        .limit(1),
    );
    if (pendingSnapshot.empty) return null;
    const adjustmentDocument = pendingSnapshot.docs[0];
    const adjustment = snapshotValue<CashDepositAdjustment>(adjustmentDocument);
    if (adjustment.pendingAllocationCents === 0) {
      transaction.set(adjustmentDocument.ref, {
        status: "resolved",
        updatedAt: new Date().toISOString(),
      }, { merge: true });
      return { adjustment, progressed: true, allocatedDeltaCents: 0 };
    }

    const closureRef = financialDbAdmin.collection("cashClosures").doc(adjustment.closureId);
    const queueRef = financialDbAdmin.collection(QUEUES).doc(queueId(workspaceId, kioskId));
    const [closureSnapshot, queueSnapshot] = await Promise.all([
      transaction.get(closureRef),
      transaction.get(queueRef),
    ]);
    if (!closureSnapshot.exists) throw new Error("O fechamento do ajuste de depósito não foi encontrado.");
    const closure = snapshotValue<CashClosure>(closureSnapshot);
    const queue = queueSnapshot.data() ?? {};
    const openBatchId = typeof queue.openBatchId === "string" ? queue.openBatchId : null;
    const openBatchRef = openBatchId ? financialDbAdmin.collection(BATCHES).doc(openBatchId) : null;
    const openBatchSnapshot = openBatchRef ? await transaction.get(openBatchRef) : null;
    let targetBatch = openBatchSnapshot?.exists
      ? normalizeCashDepositBatch(snapshotValue<CashDepositBatch>(openBatchSnapshot))
      : null;
    if (targetBatch?.status !== "open") targetBatch = null;

    const pendingDeltaCents = adjustment.pendingAllocationCents;
    let allocatedDeltaCents = 0;
    let nextSequence = Number.isSafeInteger(queue.nextSequence) && queue.nextSequence > 0
      ? Number(queue.nextSequence)
      : (targetBatch?.sequence ?? 0) + 1;
    const now = new Date().toISOString();
    let batchToLock: CashDepositBatch | null = null;

    if (pendingDeltaCents < 0) {
      if (!targetBatch || targetBatch.totalCents <= 0) {
        return { adjustment, progressed: false, allocatedDeltaCents: 0 };
      }
      allocatedDeltaCents = allocateNegativeAdjustmentWithoutGoingBelowZero({
        batchTotalCents: targetBatch.totalCents,
        requestedDeltaCents: pendingDeltaCents,
      }).allocatedDeltaCents;
    } else {
      if (targetBatch && targetBatch.maxCents - targetBatch.totalCents <= 0) {
        batchToLock = targetBatch;
        targetBatch = null;
      }
      if (!targetBatch) {
        const id = batchId(workspaceId, kioskId, nextSequence);
        targetBatch = newBatch({
          id,
          workspaceId,
          kioskId,
          kioskName: closure.kioskName,
          sequence: nextSequence,
          date: closure.date,
          now,
        });
        nextSequence++;
      }
      allocatedDeltaCents = Math.min(
        pendingDeltaCents,
        Math.max(0, targetBatch.maxCents - targetBatch.totalCents),
      );
    }

    if (!targetBatch || allocatedDeltaCents === 0) {
      return { adjustment, progressed: false, allocatedDeltaCents: 0 };
    }
    const targetRef = financialDbAdmin.collection(BATCHES).doc(targetBatch.id);
    const itemId = `${adjustment.id}_part_${Math.abs(adjustment.allocatedCents)}_${allocatedDeltaCents > 0 ? "p" : "n"}`;
    const item: CashDepositBatchItem = {
      id: itemId,
      workspaceId,
      batchId: targetBatch.id,
      closureId: adjustment.closureId,
      closureDate: closure.date,
      kioskId,
      amountCents: allocatedDeltaCents,
      source: "cash_adjustment",
      operatorBreakdown: [],
      createdAt: now,
    };
    const totalCents = targetBatch.totalCents + allocatedDeltaCents;
    if (totalCents < 0 || totalCents > targetBatch.maxCents) {
      throw new Error("O ajuste deixaria o bloco fora dos limites permitidos.");
    }
    const updatedBatch: CashDepositBatch = {
      ...targetBatch,
      grossTotalCents: targetBatch.grossTotalCents + allocatedDeltaCents,
      totalCents,
      remainingCapacityCents: targetBatch.maxCents - totalCents,
      periodStartDate: targetBatch.itemCount === 0
        ? closure.date
        : [targetBatch.periodStartDate, closure.date].sort()[0],
      periodEndDate: targetBatch.itemCount === 0
        ? closure.date
        : [targetBatch.periodEndDate, closure.date].sort().at(-1)!,
      closureIds: targetBatch.closureIds.includes(adjustment.closureId)
        ? targetBatch.closureIds
        : [...targetBatch.closureIds, adjustment.closureId],
      dates: targetBatch.dates.includes(closure.date)
        ? targetBatch.dates
        : [...targetBatch.dates, closure.date],
      itemCount: targetBatch.itemCount + 1,
      updatedAt: now,
    };
    const allocatedCents = adjustment.allocatedCents + allocatedDeltaCents;
    const pendingAllocationCents = adjustment.pendingAllocationCents - allocatedDeltaCents;
    const updatedAdjustment: CashDepositAdjustment = {
      ...adjustment,
      allocatedCents,
      pendingAllocationCents,
      targetBatchIds: adjustment.targetBatchIds?.includes(targetBatch.id)
        ? adjustment.targetBatchIds
        : [...(adjustment.targetBatchIds ?? []), targetBatch.id],
      status: pendingAllocationCents === 0 ? "allocated" : "pending_allocation",
      updatedAt: now,
    };
    const auditId = randomUUID();

    if (batchToLock) {
      transaction.set(financialDbAdmin.collection(BATCHES).doc(batchToLock.id), {
        status: "locked",
        lockReason: "next_item_would_exceed_limit",
        nextRejectedClosureId: adjustment.closureId,
        nextRejectedCents: pendingDeltaCents,
        updatedAt: now,
      }, { merge: true });
    }
    transaction.set(targetRef, updatedBatch);
    transaction.create(targetRef.collection("items").doc(itemId), item);
    transaction.set(adjustmentDocument.ref, updatedAdjustment);
    transaction.set(financialDbAdmin.collection("cashClosureAuditLogs").doc(auditId), {
      id: auditId,
      workspaceId,
      closureId: adjustment.closureId,
      action: "deposit_adjustment_allocated",
      previousValue: adjustment.pendingAllocationCents,
      newValue: {
        adjustmentId: adjustment.id,
        batchId: targetBatch.id,
        itemId,
        allocatedDeltaCents,
        pendingAllocationCents,
      },
      userId: actor.userId,
      userName: actor.userName,
      createdAt: now,
    });
    transaction.set(queueRef, {
      workspaceId,
      kioskId,
      openBatchId: targetBatch.id,
      nextSequence,
      updatedAt: now,
    }, { merge: true });
    return { adjustment: updatedAdjustment, batch: updatedBatch, item, progressed: true, allocatedDeltaCents };
  });
}

export async function allocatePendingCashDepositAdjustments(
  workspaceId: string,
  kioskId: string,
  actor: CashClosureActor,
  limit = 100,
) {
  const results = [];
  for (let index = 0; index < limit; index++) {
    const result = await allocateNextPendingCashDepositAdjustment(workspaceId, kioskId, actor);
    if (!result) break;
    results.push(result);
    if (!result.progressed) break;
  }
  return results;
}

export async function processCashDepositQueue(
  workspaceId: string,
  kioskId: string,
  actor: CashClosureActor,
) {
  const adjustmentsBefore = await allocatePendingCashDepositAdjustments(workspaceId, kioskId, actor);
  const closures = await allocatePendingCashClosures(workspaceId, kioskId, actor);
  const adjustmentsAfter = await allocatePendingCashDepositAdjustments(workspaceId, kioskId, actor);
  return { adjustmentsBefore, closures, adjustmentsAfter };
}

export async function listPendingCashDepositAdjustments(workspaceId: string) {
  const snapshot = await financialDbAdmin.collection("cashDepositAdjustments")
    .where("workspaceId", "==", workspaceId)
    .where("status", "==", "pending_allocation")
    .orderBy("createdAt", "asc")
    .get();
  return snapshot.docs.map((document) => snapshotValue<CashDepositAdjustment>(document));
}
