import "server-only";

import { randomUUID } from "node:crypto";
import type { Transaction } from "firebase-admin/firestore";

import { financialDbAdmin } from "@/lib/firebase-financial-admin";
import { isPdvAutoCountedChannel } from "./channel-normalization";
import {
  CASH_DEPOSIT_PERIOD_POLICIES,
  cashDepositPeriodPolicyId,
  cashDepositPolicyFromDocument,
} from "./deposit-policy";
import {
  cashClosureId,
  emptyChannelTotals,
  mergeBuiltClosureForPersistence,
  normalizeCashClosureWithLines,
  recalculateCountedLine,
  recalculateExpectedLine,
  recalculateReportedLine,
  recomputeCashClosureFromLines,
  restoreCalculatedExpectedLine,
  withPdvAutomaticClosureTotals,
} from "./persistence";
import { assertCashClosureTransition, canEditCashClosure } from "./state-machine";
import {
  buildCashClosureOperators,
  withCashClosureOperatorAggregate,
} from "./operators";
import { refreshCashClosureSummaries } from "./summaries.server";
import { prepareCashCountingSessionOperatorAttachment } from "@/features/financial/cash-counting-sessions/repository.server";
import type {
  BuiltCashClosure,
  CashClosure,
  CashClosureActor,
  CashClosureAuditAction,
  CashClosureAuditLog,
  CashClosureDraftLineInput,
  CashClosureExpectedAdjustmentInput,
  CashClosureLine,
  CashClosureOperator,
  CashClosureSource,
  CashClosureStatus,
  CashClosureWithLines,
} from "./types";

const CLOSURES = "cashClosures";
const AUDIT_LOGS = "cashClosureAuditLogs";
const OPERATORS = "cashClosureOperators";

function closureRef(id: string) {
  return financialDbAdmin.collection(CLOSURES).doc(id);
}

function auditRef() {
  return financialDbAdmin.collection(AUDIT_LOGS).doc(randomUUID());
}

function snapshotValue<T extends { id: string }>(snapshot: FirebaseFirestore.DocumentSnapshot) {
  return { id: snapshot.id, ...snapshot.data() } as T;
}

function auditPayload(input: {
  id: string;
  workspaceId: string;
  closureId: string;
  action: CashClosureAuditAction;
  actor: CashClosureActor;
  createdAt: string;
  lineId?: string;
  operatorId?: string;
  previousValue?: unknown;
  newValue?: unknown;
  reason?: string | null;
}): CashClosureAuditLog {
  return {
    id: input.id,
    workspaceId: input.workspaceId,
    closureId: input.closureId,
    action: input.action,
    userId: input.actor.userId,
    userName: input.actor.userName,
    createdAt: input.createdAt,
    ...(input.lineId ? { lineId: input.lineId } : {}),
    ...(input.operatorId ? { operatorId: input.operatorId } : {}),
    ...(input.previousValue !== undefined ? { previousValue: input.previousValue } : {}),
    ...(input.newValue !== undefined ? { newValue: input.newValue } : {}),
    ...(input.reason !== undefined ? { reason: input.reason } : {}),
  };
}

function writeAudit(
  transaction: Transaction,
  input: Omit<Parameters<typeof auditPayload>[0], "id">,
) {
  const ref = auditRef();
  transaction.set(ref, auditPayload({ ...input, id: ref.id }));
}

export async function getCashClosure(id: string): Promise<CashClosureWithLines | null> {
  const ref = closureRef(id);
  const [closureSnapshot, lineSnapshot, operatorSnapshot] = await Promise.all([
    ref.get(),
    ref.collection("lines").get(),
    ref.collection(OPERATORS).limit(100).get(),
  ]);
  if (!closureSnapshot.exists) return null;
  const normalized = normalizeCashClosureWithLines(
    snapshotValue<CashClosure>(closureSnapshot),
    lineSnapshot.docs
      .map((document) => snapshotValue<CashClosureLine>(document))
      .sort(
        (left, right) =>
          left.operatorName.localeCompare(right.operatorName, "pt-BR") || left.channel.localeCompare(right.channel),
      ),
  );
  const operators = buildCashClosureOperators({
    closure: normalized.closure,
    lines: normalized.lines,
    existingOperators: operatorSnapshot.docs.map((document) => snapshotValue<CashClosureOperator>(document)),
    now: normalized.closure.updatedAt,
  }).operators;
  return {
    closure: withCashClosureOperatorAggregate(normalized.closure, operators),
    lines: normalized.lines,
    operators,
  };
}

export async function getCashClosureByDate(kioskId: string, date: string) {
  return getCashClosure(cashClosureId(kioskId, date));
}

export async function listCashClosures(input: {
  workspaceId: string;
  kioskId?: string;
  year?: number;
  month?: number;
  status?: CashClosureStatus;
  limit?: number;
}) {
  let query: FirebaseFirestore.Query = financialDbAdmin
    .collection(CLOSURES)
    .where("workspaceId", "==", input.workspaceId);
  if (input.kioskId) query = query.where("kioskId", "==", input.kioskId);
  if (input.year !== undefined) query = query.where("year", "==", input.year);
  if (input.month !== undefined) query = query.where("month", "==", input.month);
  if (input.status) query = query.where("status", "==", input.status);
  query = query.orderBy("date", "desc").limit(Math.min(Math.max(input.limit ?? 400, 1), 1000));
  const snapshot = await query.get();
  return snapshot.docs.map((document) => withPdvAutomaticClosureTotals(snapshotValue<CashClosure>(document)));
}

export async function listCashClosureAuditLogs(workspaceId: string, closureId: string, limit = 200) {
  const snapshot = await financialDbAdmin
    .collection(AUDIT_LOGS)
    .where("workspaceId", "==", workspaceId)
    .where("closureId", "==", closureId)
    .orderBy("createdAt", "desc")
    .limit(Math.min(Math.max(limit, 1), 500))
    .get();
  return snapshot.docs.map((document) => snapshotValue<CashClosureAuditLog>(document));
}

export async function upsertClosureFromPdv(built: BuiltCashClosure, actor: CashClosureActor) {
  const id = cashClosureId(built.kioskId, built.date);
  const ref = closureRef(id);
  const periodPolicyRef = financialDbAdmin.collection(CASH_DEPOSIT_PERIOD_POLICIES).doc(
    cashDepositPeriodPolicyId(built.workspaceId, built.year, built.month),
  );

  const result = await financialDbAdmin.runTransaction(async (transaction) => {
    const [closureSnapshot, lineSnapshot, operatorSnapshot, periodPolicySnapshot] = await Promise.all([
      transaction.get(ref),
      transaction.get(ref.collection("lines")),
      transaction.get(ref.collection(OPERATORS).limit(100)),
      transaction.get(periodPolicyRef),
    ]);
    const existingClosure = closureSnapshot.exists
      ? snapshotValue<CashClosure>(closureSnapshot)
      : null;
    const existingLines = lineSnapshot.docs.map((document) => snapshotValue<CashClosureLine>(document));
    const now = new Date().toISOString();
    const merged = mergeBuiltClosureForPersistence({
      built,
      existingClosure,
      existingLines,
      now,
    });
    merged.closure = {
      ...merged.closure,
      cashDepositPolicy: cashDepositPolicyFromDocument(
        periodPolicySnapshot.data(),
        merged.closure.cashDepositPolicy,
      ),
      cashDepositPolicyReason: periodPolicySnapshot.exists
        ? String(periodPolicySnapshot.data()?.reason ?? "Competência usada somente na DRE")
        : merged.closure.cashDepositPolicyReason,
    };

    const operatorResult = buildCashClosureOperators({
      closure: merged.closure,
      lines: merged.lines,
      existingOperators: operatorSnapshot.docs.map((document) => snapshotValue<CashClosureOperator>(document)),
      now,
    });
    merged.closure = withCashClosureOperatorAggregate(merged.closure, operatorResult.operators, now);
    transaction.set(ref, merged.closure);
    for (const line of merged.lines) {
      transaction.set(ref.collection("lines").doc(line.id), line);
    }
    for (const deletedLineId of merged.deletedLineIds) {
      transaction.delete(ref.collection("lines").doc(deletedLineId));
    }
    for (const operator of operatorResult.operators) {
      transaction.set(ref.collection(OPERATORS).doc(operator.id), operator);
    }
    for (const deletedOperatorId of operatorResult.deletedOperatorIds) {
      transaction.delete(ref.collection(OPERATORS).doc(deletedOperatorId));
    }

    writeAudit(transaction, {
      workspaceId: built.workspaceId,
      closureId: id,
      action: existingClosure ? "pdv_resynced" : "created_from_pdv",
      actor,
      createdAt: now,
      previousValue: existingClosure
        ? {
            sourceHash: existingClosure.sourceHash,
            expectedTotalCents: existingClosure.expectedTotalCents,
          }
        : null,
      newValue: {
        sourceHash: merged.closure.sourceHash,
        expectedTotalCents: merged.closure.expectedTotalCents,
        sourceChanged: merged.sourceChanged,
      },
    });

    return { ...merged, operators: operatorResult.operators, created: !existingClosure };
  });
  await refreshCashClosureSummaries(result.closure);
  return result;
}

function emptySource(error: string): CashClosureSource {
  return {
    provider: "pdvlegal",
    endpoint: "cupom/get",
    couponCount: 0,
    validCouponCount: 0,
    ignoredCancelledCouponCount: 0,
    estornadoCouponCount: 0,
    itemCount: 0,
    paymentRowCount: 0,
    rawPaymentNames: [],
    unknownPaymentNames: [],
    integrityWarnings: [error],
  };
}

export async function recordCashClosureSyncError(input: {
  workspaceId: string;
  kioskId: string;
  kioskName: string;
  pdvFilialId: string;
  date: string;
  error: string;
}) {
  const id = cashClosureId(input.kioskId, input.date);
  const ref = closureRef(id);
  const now = new Date().toISOString();
  const result = await financialDbAdmin.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (snapshot.exists) {
      const current = snapshotValue<CashClosure>(snapshot);
      const next: CashClosure = {
        ...current,
        status: canEditCashClosure(current.status) ? "sync_error" : current.status,
        syncError: input.error,
        updatedAt: now,
      };
      transaction.set(
        ref,
        next,
        { merge: true },
      );
      return next;
    }
    const [year, month, day] = input.date.split("-").map(Number);
    const channelTotals = emptyChannelTotals();
    const closure: CashClosure = {
      id,
      workspaceId: input.workspaceId,
      kioskId: input.kioskId,
      kioskName: input.kioskName,
      pdvFilialId: input.pdvFilialId,
      date: input.date,
      year,
      month,
      day,
      status: "sync_error",
      expectedTotalCents: 0,
      reportedTotalCents: 0,
      countedTotalCents: 0,
      reportedDifferenceTotalCents: 0,
      differenceTotalCents: 0,
      expectedCashCents: 0,
      reportedCashCents: 0,
      countedCashCents: 0,
      finalizedCountedTotalCents: 0,
      finalizedDifferenceTotalCents: 0,
      finalizedCountedCashCents: 0,
      cashDepositEligibleCents: 0,
      expectedByChannelCents: { ...channelTotals },
      reportedByChannelCents: { ...channelTotals },
      countedByChannelCents: { ...channelTotals },
      reportedDifferenceByChannelCents: { ...channelTotals },
      differenceByChannelCents: { ...channelTotals },
      operatorCount: 0,
      finalizedOperatorCount: 0,
      unreportedLineCount: 0,
      pendingLineCount: 0,
      reportedDivergentLineCount: 0,
      divergentLineCount: 0,
      reportedMatchedLineCount: 0,
      matchedLineCount: 0,
      source: emptySource(input.error),
      sourceHash: "",
      cashDepositPolicy: "standard",
      cashDepositPolicyReason: null,
      cashDeposit: {
        eligibleCents: 0,
        batchId: null,
        batchItemId: null,
        status: "not_eligible",
        manualSplitRequired: false,
        allocationReason: null,
        pendingSince: null,
      },
      approvedWithDivergence: false,
      pdvChangedAfterApproval: false,
      syncedAt: null,
      syncError: input.error,
      submittedAt: null,
      submittedBy: null,
      approvedAt: null,
      approvedBy: null,
      approvalReason: null,
      reopenedAt: null,
      reopenedBy: null,
      reopenedReason: null,
      createdAt: now,
      updatedAt: now,
    };
    transaction.set(ref, closure);
    return closure;
  });
  await refreshCashClosureSummaries(result);
}

export async function saveCashClosureDraft(
  id: string,
  updates: CashClosureDraftLineInput[],
  actor: CashClosureActor,
  permissions: { editReported: boolean; editCounted: boolean } = { editReported: true, editCounted: false },
) {
  const ref = closureRef(id);
  const result = await financialDbAdmin.runTransaction(async (transaction) => {
    const [closureSnapshot, lineSnapshot, operatorSnapshot] = await Promise.all([
      transaction.get(ref),
      transaction.get(ref.collection("lines")),
      transaction.get(ref.collection(OPERATORS).limit(100)),
    ]);
    if (!closureSnapshot.exists) throw new Error("Fechamento não encontrado.");
    const rawClosure = snapshotValue<CashClosure>(closureSnapshot);
    const normalized = normalizeCashClosureWithLines(
      rawClosure,
      lineSnapshot.docs.map((document) => snapshotValue<CashClosureLine>(document)),
    );
    const closure = normalized.closure;
    if (!canEditCashClosure(closure.status)) {
      throw new Error("Somente fechamentos ainda não finalizados podem ser editados.");
    }

    const updateById = new Map(updates.map((update) => [update.id, update]));
    if (updateById.size !== updates.length) throw new Error("Há linhas duplicadas no payload.");
    const now = new Date().toISOString();
    const normalizedById = new Map(normalized.lines.map((line) => [line.id, line]));
    const currentOperators = buildCashClosureOperators({
      closure,
      lines: normalized.lines,
      existingOperators: operatorSnapshot.docs.map((document) => snapshotValue<CashClosureOperator>(document)),
      now: closure.updatedAt,
    }).operators;
    const finalizedOperatorIds = new Set(
      currentOperators.filter((operator) => operator.status === "approved").map((operator) => operator.operatorId),
    );
    const nextLines = lineSnapshot.docs.map((document) => {
      const current = normalizedById.get(document.id)!;
      const update = updateById.get(current.id);
      if (!update) return current;
      updateById.delete(current.id);
      const automatic = isPdvAutoCountedChannel(current.channel);
      if (finalizedOperatorIds.has(current.operatorId)) {
        const reportedChanged = permissions.editReported && (
          (update.reportedCents !== undefined && update.reportedCents !== current.reportedCents)
          || (update.reportedNote !== undefined && (update.reportedNote?.trim() || null) !== current.reportedNote)
        );
        const countedChanged = permissions.editCounted && (
          (update.countedCents !== undefined && update.countedCents !== current.countedCents)
          || (update.note !== undefined && (update.note?.trim() || null) !== current.note)
        );
        if (reportedChanged || countedChanged) {
          throw new Error(`O operador ${current.operatorName} já foi finalizado e precisa ser reaberto antes de editar.`);
        }
        return current;
      }
      let next = current;
      if (automatic || permissions.editReported) {
        const reportedCents = automatic
          ? current.expectedCents
          : update.reportedCents !== undefined ? update.reportedCents : next.reportedCents;
        if (reportedCents !== null && (!Number.isSafeInteger(reportedCents) || reportedCents < 0)) {
          throw new Error(`Valor informado inválido na linha ${current.id}.`);
        }
        const reportedNote = automatic
          ? null
          : update.reportedNote !== undefined ? update.reportedNote : next.reportedNote;
        const normalizedReportedNote = reportedNote?.trim() || null;
        if (next.reportedCents !== reportedCents || next.reportedNote !== normalizedReportedNote) {
          next = recalculateReportedLine(
            next,
            reportedCents,
            reportedNote,
            automatic ? "system:pdv" : actor.userId,
            now,
          );
        }
      }
      if (automatic || permissions.editCounted) {
        const countedCents = automatic
          ? current.expectedCents
          : update.countedCents !== undefined ? update.countedCents : next.countedCents;
        if (countedCents !== null && (!Number.isSafeInteger(countedCents) || countedCents < 0)) {
          throw new Error(`Valor conferido inválido na linha ${current.id}.`);
        }
        const countedNote = automatic
          ? null
          : update.note !== undefined ? update.note : next.note;
        const normalizedCountedNote = countedNote?.trim() || null;
        if (next.countedCents !== countedCents || next.note !== normalizedCountedNote) {
          next = recalculateCountedLine(
            next,
            countedCents,
            countedNote,
            automatic ? "system:pdv" : actor.userId,
            now,
          );
        }
      }
      if (JSON.stringify(current) === JSON.stringify(next)) return current;
      transaction.set(document.ref, next);
      if (current.reportedCents !== next.reportedCents) {
        writeAudit(transaction, {
          workspaceId: closure.workspaceId,
          closureId: id,
          lineId: current.id,
          action: "reported_amount_updated",
          actor,
          createdAt: now,
          previousValue: current.reportedCents,
          newValue: next.reportedCents,
        });
      }
      if (current.reportedNote !== next.reportedNote) {
        writeAudit(transaction, {
          workspaceId: closure.workspaceId,
          closureId: id,
          lineId: current.id,
          action: "reported_note_updated",
          actor,
          createdAt: now,
          previousValue: current.reportedNote,
          newValue: next.reportedNote,
        });
      }
      if (current.countedCents !== next.countedCents) {
        writeAudit(transaction, {
          workspaceId: closure.workspaceId,
          closureId: id,
          lineId: current.id,
          action: "counted_amount_updated",
          actor,
          createdAt: now,
          previousValue: current.countedCents,
          newValue: next.countedCents,
        });
      }
      if (current.note !== next.note) {
        writeAudit(transaction, {
          workspaceId: closure.workspaceId,
          closureId: id,
          lineId: current.id,
          action: "note_updated",
          actor,
          createdAt: now,
          previousValue: current.note,
          newValue: next.note,
        });
      }
      return next;
    });
    if (updateById.size > 0) throw new Error("Uma ou mais linhas não pertencem a este fechamento.");
    const operatorResult = buildCashClosureOperators({
      closure,
      lines: nextLines,
      existingOperators: currentOperators,
      now,
    });
    const nextClosure = withCashClosureOperatorAggregate(
      recomputeCashClosureFromLines(closure, nextLines, now),
      operatorResult.operators,
      now,
    );
    transaction.set(ref, nextClosure);
    for (const operator of operatorResult.operators) {
      transaction.set(ref.collection(OPERATORS).doc(operator.id), operator);
    }
    return { closure: nextClosure, lines: nextLines, operators: operatorResult.operators };
  });
  await refreshCashClosureSummaries(result.closure);
  return result;
}

export async function adjustCashClosureExpected(
  id: string,
  input: CashClosureExpectedAdjustmentInput,
  actor: CashClosureActor,
) {
  const ref = closureRef(id);
  const result = await financialDbAdmin.runTransaction(async (transaction) => {
    const [closureSnapshot, linesSnapshot, operatorSnapshot] = await Promise.all([
      transaction.get(ref),
      transaction.get(ref.collection("lines")),
      transaction.get(ref.collection(OPERATORS).limit(100)),
    ]);
    if (!closureSnapshot.exists) throw new Error("Fechamento não encontrado.");
    const closure = snapshotValue<CashClosure>(closureSnapshot);
    if (!canEditCashClosure(closure.status)) {
      throw new Error("O esperado só pode ser corrigido em fechamento ainda não finalizado.");
    }
    if (!Number.isSafeInteger(input.correctedExpectedCents) || input.correctedExpectedCents < 0) {
      throw new Error("Valor esperado corrigido inválido.");
    }
    const reason = input.reason.trim();
    if (reason.length < 3) throw new Error("Informe o motivo da correção.");
    const normalized = normalizeCashClosureWithLines(
      closure,
      linesSnapshot.docs.map((document) => snapshotValue<CashClosureLine>(document)),
    );
    const current = normalized.lines.find((line) => line.id === input.lineId);
    if (!current) throw new Error("Linha do fechamento não encontrada.");
    const currentOperators = buildCashClosureOperators({
      closure: normalized.closure,
      lines: normalized.lines,
      existingOperators: operatorSnapshot.docs.map((document) => snapshotValue<CashClosureOperator>(document)),
      now: closure.updatedAt,
    }).operators;
    if (currentOperators.find((operator) => operator.operatorId === current.operatorId)?.status === "approved") {
      throw new Error("O operador já foi finalizado e precisa ser reaberto antes de corrigir o esperado.");
    }
    if (current.expectedCents === input.correctedExpectedCents) {
      throw new Error("O novo valor deve ser diferente do esperado atual.");
    }
    const now = new Date().toISOString();
    const nextLine = recalculateExpectedLine(
      current,
      input.correctedExpectedCents,
      reason,
      actor.userId,
      now,
    );
    const lines = normalized.lines.map((line) => line.id === input.lineId ? nextLine : line);
    const operatorResult = buildCashClosureOperators({ closure, lines, existingOperators: currentOperators, now });
    const nextClosure = withCashClosureOperatorAggregate(
      recomputeCashClosureFromLines(closure, lines, now),
      operatorResult.operators,
      now,
    );
    transaction.set(ref.collection("lines").doc(input.lineId), nextLine);
    transaction.set(ref, nextClosure);
    for (const operator of operatorResult.operators) transaction.set(ref.collection(OPERATORS).doc(operator.id), operator);
    writeAudit(transaction, {
      workspaceId: closure.workspaceId,
      closureId: id,
      lineId: input.lineId,
      action: "expected_amount_adjusted",
      actor,
      createdAt: now,
      previousValue: {
        calculatedExpectedCents: current.calculatedExpectedCents,
        expectedCents: current.expectedCents,
        adjustmentCents: current.expectedAdjustmentCents,
      },
      newValue: {
        calculatedExpectedCents: nextLine.calculatedExpectedCents,
        expectedCents: nextLine.expectedCents,
        adjustmentCents: nextLine.expectedAdjustmentCents,
      },
      reason,
    });
    return { closure: nextClosure, lines, operators: operatorResult.operators };
  });
  await refreshCashClosureSummaries(result.closure);
  return result;
}

export async function restoreCashClosureExpected(
  id: string,
  input: { lineId: string; reason: string },
  actor: CashClosureActor,
) {
  const ref = closureRef(id);
  const result = await financialDbAdmin.runTransaction(async (transaction) => {
    const [closureSnapshot, linesSnapshot, operatorSnapshot] = await Promise.all([
      transaction.get(ref),
      transaction.get(ref.collection("lines")),
      transaction.get(ref.collection(OPERATORS).limit(100)),
    ]);
    if (!closureSnapshot.exists) throw new Error("Fechamento não encontrado.");
    const closure = snapshotValue<CashClosure>(closureSnapshot);
    if (!canEditCashClosure(closure.status)) {
      throw new Error("O cálculo só pode ser restaurado em fechamento ainda não finalizado.");
    }
    const normalized = normalizeCashClosureWithLines(
      closure,
      linesSnapshot.docs.map((document) => snapshotValue<CashClosureLine>(document)),
    );
    const current = normalized.lines.find((line) => line.id === input.lineId);
    if (!current) throw new Error("Linha do fechamento não encontrada.");
    const currentOperators = buildCashClosureOperators({
      closure: normalized.closure,
      lines: normalized.lines,
      existingOperators: operatorSnapshot.docs.map((document) => snapshotValue<CashClosureOperator>(document)),
      now: closure.updatedAt,
    }).operators;
    if (currentOperators.find((operator) => operator.operatorId === current.operatorId)?.status === "approved") {
      throw new Error("O operador já foi finalizado e precisa ser reaberto antes de restaurar o esperado.");
    }
    if (current.expectedAdjustedAt === null) throw new Error("Esta linha não possui ajuste manual.");
    const reason = input.reason.trim();
    if (reason.length < 3) throw new Error("Informe o motivo da restauração.");
    const now = new Date().toISOString();
    const nextLine = restoreCalculatedExpectedLine(current, now);
    const lines = normalized.lines.map((line) => line.id === input.lineId ? nextLine : line);
    const operatorResult = buildCashClosureOperators({ closure, lines, existingOperators: currentOperators, now });
    const nextClosure = withCashClosureOperatorAggregate(
      recomputeCashClosureFromLines(closure, lines, now),
      operatorResult.operators,
      now,
    );
    transaction.set(ref.collection("lines").doc(input.lineId), nextLine);
    transaction.set(ref, nextClosure);
    for (const operator of operatorResult.operators) transaction.set(ref.collection(OPERATORS).doc(operator.id), operator);
    writeAudit(transaction, {
      workspaceId: closure.workspaceId,
      closureId: id,
      lineId: input.lineId,
      action: "expected_amount_restored",
      actor,
      createdAt: now,
      previousValue: {
        calculatedExpectedCents: current.calculatedExpectedCents,
        expectedCents: current.expectedCents,
        adjustmentCents: current.expectedAdjustmentCents,
      },
      newValue: {
        calculatedExpectedCents: nextLine.calculatedExpectedCents,
        expectedCents: nextLine.expectedCents,
        adjustmentCents: 0,
      },
      reason,
    });
    return { closure: nextClosure, lines, operators: operatorResult.operators };
  });
  await refreshCashClosureSummaries(result.closure);
  return result;
}

function cashDepositAfterFinalization(
  cashDeposit: CashClosure["cashDeposit"],
  eligibleCents: number,
  now: string,
  policy: CashClosure["cashDepositPolicy"],
  allocationMode: "counting_session" | "legacy_immediate",
) {
  if (policy === "dre_only") {
    return {
      eligibleCents: 0,
      allocatedCents: 0,
      issuedCents: 0,
      paidCents: 0,
      batchId: null,
      batchItemId: null,
      status: "not_eligible" as const,
      manualSplitRequired: false,
      allocationReason: null,
      pendingSince: null,
    };
  }
  if (cashDeposit.adjustmentId) {
    return {
      ...cashDeposit,
      eligibleCents,
      status: "adjusted" as const,
      manualSplitRequired: false,
      allocationReason: null,
      pendingSince: now,
    };
  }
  if (eligibleCents > 0) {
    return {
      eligibleCents,
      batchId: null,
      batchItemId: null,
      status: "not_allocated" as const,
      manualSplitRequired: false,
      allocationReason: allocationMode === "counting_session"
        ? "awaiting_counting_session" as const
        : "pending_allocator" as const,
      pendingSince: now,
    };
  }
  return {
    eligibleCents: 0,
    batchId: null,
    batchItemId: null,
    status: "not_eligible" as const,
    manualSplitRequired: false,
    allocationReason: null,
    pendingSince: null,
  };
}

export async function finalizeCashClosure(id: string, actor: CashClosureActor) {
  const current = await getCashClosure(id);
  if (!current) throw new Error("Fechamento não encontrado.");
  if (current.operators.length === 0) {
    const now = new Date().toISOString();
    const ref = closureRef(id);
    const result = await financialDbAdmin.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists) throw new Error("Fechamento não encontrado.");
      const closure = snapshotValue<CashClosure>(snapshot);
      assertCashClosureTransition(closure.status, "approved");
      const next = {
        ...closure,
        status: "approved" as const,
        finalizedOperatorCount: 0,
        submittedAt: now,
        submittedBy: actor.userId,
        approvedAt: now,
        approvedBy: actor.userId,
        approvalReason: "Dia sem movimento finalizado",
        updatedAt: now,
      };
      transaction.set(ref, next);
      return next;
    });
    await refreshCashClosureSummaries(result);
    return result;
  }
  if (current.operators.every((operator) => operator.status === "approved")) {
    assertCashClosureTransition(current.closure.status, "approved");
  }
  let closure = current.closure;
  for (const operator of current.operators.filter((item) => item.status !== "approved")) {
    closure = (await finalizeCashClosureOperator(id, operator.operatorId, actor, { legacyImmediateAllocation: true })).closure;
  }
  return closure;
}

export async function finalizeCashClosureOperator(
  id: string,
  operatorId: string,
  actor: CashClosureActor,
  allocation:
    | { countingSessionId: string; canManageSessionOfOthers?: boolean }
    | { legacyImmediateAllocation: true },
) {
  const ref = closureRef(id);
  const result = await financialDbAdmin.runTransaction(async (transaction) => {
    const [closureSnapshot, lineSnapshot, operatorSnapshot] = await Promise.all([
      transaction.get(ref),
      transaction.get(ref.collection("lines")),
      transaction.get(ref.collection(OPERATORS).limit(100)),
    ]);
    if (!closureSnapshot.exists) throw new Error("Fechamento não encontrado.");
    const rawClosure = snapshotValue<CashClosure>(closureSnapshot);
    const normalized = normalizeCashClosureWithLines(
      rawClosure,
      lineSnapshot.docs.map((document) => snapshotValue<CashClosureLine>(document)),
    );
    const closure = normalized.closure;
    const periodPolicySnapshot = await transaction.get(
      financialDbAdmin.collection(CASH_DEPOSIT_PERIOD_POLICIES).doc(
        cashDepositPeriodPolicyId(closure.workspaceId, closure.year, closure.month),
      ),
    );
    const cashDepositPolicy = cashDepositPolicyFromDocument(
      periodPolicySnapshot.data(),
      closure.cashDepositPolicy,
    );
    const now = new Date().toISOString();
    assertCashClosureTransition(closure.status, "approved");
    const currentOperators = buildCashClosureOperators({
      closure,
      lines: normalized.lines,
      existingOperators: operatorSnapshot.docs.map((document) => snapshotValue<CashClosureOperator>(document)),
      now: closure.updatedAt,
    }).operators;
    const currentOperator = currentOperators.find((operator) => operator.operatorId === operatorId);
    if (!currentOperator) throw new Error("Operador do fechamento não encontrado.");
    if (currentOperator.status === "approved") {
      throw new Error(`A contagem de ${currentOperator.operatorName} já foi finalizada.`);
    }
    const operatorLines = normalized.lines.filter((line) => line.operatorId === operatorId);
    if (operatorLines.some((line) => line.reportedCents === null || line.countedCents === null)) {
      throw new Error(`Preencha as contagens do Caixa e do Financeiro de ${currentOperator.operatorName} antes de finalizar.`);
    }
    if (operatorLines.some((line) => {
      const cashierDifference = (line.reportedDifferenceCents ?? 0) < 0 && !line.reportedNote?.trim();
      const financeDifference = (line.differenceCents ?? 0) < 0 && !line.note?.trim();
      return cashierDifference || financeDifference;
    })) {
      throw new Error("Toda falta apurada pelo Caixa ou pelo Financeiro precisa de justificativa antes da finalização.");
    }
    const eligibleCents = currentOperator.countedCashCents;
    const sessionAttachment = "countingSessionId" in allocation
      ? await prepareCashCountingSessionOperatorAttachment(transaction, {
        sessionId: allocation.countingSessionId,
        closure: { ...closure, cashDepositPolicy },
        operator: currentOperator,
        actor,
        canManageOthers: allocation.canManageSessionOfOthers,
        now,
      })
      : null;
    const finalizedOperator: CashClosureOperator = {
      ...currentOperator,
      status: "approved",
      cashDeposit: cashDepositAfterFinalization(
        currentOperator.cashDeposit,
        eligibleCents,
        now,
        cashDepositPolicy,
        sessionAttachment ? "counting_session" : "legacy_immediate",
      ),
      countingSessionId: sessionAttachment?.session.id ?? currentOperator.countingSessionId ?? null,
      countingSessionFinalizedAt: sessionAttachment ? now : currentOperator.countingSessionFinalizedAt ?? null,
      approvedWithDivergence:
        currentOperator.divergentLineCount > 0 || currentOperator.reportedDivergentLineCount > 0,
      approvedAt: now,
      approvedBy: actor.userId,
      reopenedAt: null,
      reopenedBy: null,
      reopenedReason: null,
      updatedAt: now,
    };
    const operators = currentOperators.map((operator) => operator.operatorId === operatorId ? finalizedOperator : operator);
    const next = withCashClosureOperatorAggregate(
      {
        ...recomputeCashClosureFromLines(closure, normalized.lines, now),
        cashDepositPolicy,
        cashDepositPolicyReason: periodPolicySnapshot.exists
          ? String(periodPolicySnapshot.data()?.reason ?? "Competência usada somente na DRE")
          : closure.cashDepositPolicyReason,
        submittedAt: closure.submittedAt ?? now,
        submittedBy: closure.submittedBy ?? actor.userId,
      },
      operators,
      now,
    );
    transaction.set(ref, next);
    transaction.set(ref.collection(OPERATORS).doc(finalizedOperator.id), finalizedOperator);
    if (sessionAttachment) {
      transaction.set(sessionAttachment.operatorRef, sessionAttachment.sessionOperator);
      transaction.set(financialDbAdmin.collection("cashCountingSessionAuditLogs").doc(sessionAttachment.audit.id), sessionAttachment.audit);
    }
    writeAudit(transaction, {
      workspaceId: closure.workspaceId,
      closureId: id,
      operatorId,
      action: "approved",
      actor,
      createdAt: now,
      previousValue: currentOperator.status,
      newValue: {
        status: finalizedOperator.status,
        operatorName: finalizedOperator.operatorName,
        approvedWithDivergence: finalizedOperator.approvedWithDivergence,
        cashDepositEligibleCents: finalizedOperator.cashDeposit.eligibleCents,
      },
      reason: "Contagem do operador finalizada",
    });
    return { closure: next, operator: finalizedOperator, operators };
  });
  await refreshCashClosureSummaries(result.closure);
  return result;
}

export async function reopenCashClosure(id: string, reason: string, actor: CashClosureActor) {
  const cleanReason = reason.trim();
  if (!cleanReason) throw new Error("Informe o motivo da reabertura.");
  const ref = closureRef(id);
  const result = await financialDbAdmin.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists) throw new Error("Fechamento não encontrado.");
    const closure = snapshotValue<CashClosure>(snapshot);
    assertCashClosureTransition(closure.status, "reopened");
    const now = new Date().toISOString();
    const next: CashClosure = {
      ...closure,
      status: "reopened",
      reopenedAt: now,
      reopenedBy: actor.userId,
      reopenedReason: cleanReason,
      updatedAt: now,
    };
    transaction.set(ref, next);
    writeAudit(transaction, {
      workspaceId: closure.workspaceId,
      closureId: id,
      action: "reopened",
      actor,
      createdAt: now,
      previousValue: closure.status,
      newValue: next.status,
      reason: cleanReason,
    });
    return next;
  });
  await refreshCashClosureSummaries(result);
  return result;
}
