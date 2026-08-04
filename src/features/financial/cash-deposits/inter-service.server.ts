import "server-only";

import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { FieldValue, Timestamp } from "firebase-admin/firestore";

import { financialDbAdmin } from "@/lib/firebase-financial-admin";
import {
  cancelCobranca,
  createCobranca,
  InterCobrancaApiError,
  listCobrancas,
  retrieveCobranca,
  retrieveCobrancaPdf,
  type InterCobrancaDetail,
  type InterCobrancaWebhookItem,
} from "@/lib/integrations/inter/cobrancas";
import {
  getInterCobrancaSettings,
  getInterCobrancaEnvironment,
  getInterCobrancaLedgerSettings,
  interCobrancaReadiness,
} from "@/lib/integrations/inter/config.server";
import { refreshCashClosureSummaries } from "../cash-closures/summaries.server";
import type { CashClosure, CashClosureActor } from "../cash-closures/types";
import {
  buildInterCobrancaIssueInput,
  detailFields,
  mapInterSituation,
  type InterCobrancaDocument,
  type InterCobrancaEvent,
} from "./inter-cobranca";
import type { CashDepositBatch } from "./types";

const BATCHES = "cashDepositBatches";
const COBRANCAS = "interCobrancas";
const EVENTS = "interCobrancaEvents";

function snapshotValue<T extends { id: string }>(snapshot: FirebaseFirestore.DocumentSnapshot) {
  return { id: snapshot.id, ...snapshot.data() } as T;
}

function activeCobranca(status: InterCobrancaDocument["status"]) {
  return ["issuing", "requested", "issued", "marked_received", "paid"].includes(status);
}

function historyIds(batch: CashDepositBatch) {
  const ids = batch.interCobrancaIds ?? [];
  if (batch.interCobrancaId && !ids.includes(batch.interCobrancaId)) return [...ids, batch.interCobrancaId];
  return ids;
}

async function writeEvent(input: Omit<InterCobrancaEvent, "id" | "createdAt"> & {
  id?: string;
  createdAt?: string;
}) {
  const createdAt = input.createdAt ?? new Date().toISOString();
  const id = input.id ?? randomUUID();
  const event: InterCobrancaEvent = { ...input, id, createdAt };
  await financialDbAdmin.collection(EVENTS).doc(id).set(event, { merge: true });
  return event;
}

function newCobrancaDocument(input: {
  id: string;
  batch: CashDepositBatch;
  attempt: number;
  previousInterCobrancaId: string | null;
  issueInput: ReturnType<typeof buildInterCobrancaIssueInput>;
  actor: CashClosureActor;
  now: string;
}): InterCobrancaDocument {
  return {
    id: input.id,
    workspaceId: input.batch.workspaceId,
    batchId: input.batch.id,
    kioskId: input.batch.kioskId,
    kioskName: input.batch.kioskName,
    attempt: input.attempt,
    status: "issuing",
    situacao: null,
    seuNumero: input.issueInput.seuNumero,
    codigoSolicitacao: null,
    previousInterCobrancaId: input.previousInterCobrancaId,
    valorNominalCents: input.batch.totalCents,
    dataVencimento: input.issueInput.dataVencimento,
    numDiasAgenda: input.issueInput.numDiasAgenda,
    formasRecebimento: input.issueInput.formasRecebimento,
    origemRecebimento: null,
    valorTotalRecebidoCents: 0,
    recebidoManual: false,
    nossoNumero: null,
    codigoBarras: null,
    linhaDigitavel: null,
    txid: null,
    pixCopiaECola: null,
    errorCode: null,
    errorMessage: null,
    requestedAt: null,
    issuedAt: null,
    paidAt: null,
    cancelledAt: null,
    lastCheckedAt: null,
    ledgerTransactionId: null,
    ledgerPostedAt: null,
    createdAt: input.now,
    createdBy: input.actor.userId,
    createdByName: input.actor.userName,
    updatedAt: input.now,
  };
}

async function prepareIssue(input: {
  workspaceId: string;
  batchId: string;
  actor: CashClosureActor;
}) {
  const settings = getInterCobrancaSettings();
  const batchRef = financialDbAdmin.collection(BATCHES).doc(input.batchId);
  return financialDbAdmin.runTransaction(async (transaction) => {
    const batchSnapshot = await transaction.get(batchRef);
    if (!batchSnapshot.exists) throw new Error("Bloco de depósito não encontrado.");
    const batch = snapshotValue<CashDepositBatch>(batchSnapshot);
    if (batch.workspaceId !== input.workspaceId) throw new Error("Bloco de depósito não encontrado.");
    if (batch.status === "paid") throw new Error("Este bloco já foi liquidado.");

    const ids = historyIds(batch);
    const currentId = batch.interCobrancaId ?? ids.at(-1) ?? null;
    const currentRef = currentId ? financialDbAdmin.collection(COBRANCAS).doc(currentId) : null;
    const currentSnapshot = currentRef ? await transaction.get(currentRef) : null;
    const current = currentSnapshot?.exists
      ? snapshotValue<InterCobrancaDocument>(currentSnapshot)
      : null;
    if (current && activeCobranca(current.status)) {
      return { batch, cobranca: current, issueInput: null, idempotent: true };
    }
    if (!["open", "locked", "failed", "cancelled"].includes(batch.status)) {
      throw new Error("Este bloco não está disponível para emissão.");
    }

    const attempt = ids.length + 1;
    if (attempt > 9) throw new Error("O limite de reemissões deste bloco foi atingido.");
    const issueInput = buildInterCobrancaIssueInput({
      batch,
      attempt,
      payer: settings.payer,
      dueBusinessDays: settings.dueBusinessDays,
      numDiasAgenda: settings.numDiasAgenda,
      holidays: settings.holidays,
    });
    if (batch.totalCents < settings.minimumCents) {
      throw new Error(`O bloco não atinge o mínimo configurado de ${settings.minimumCents} centavos.`);
    }
    const id = `${batch.id}_inter_${attempt}`;
    const now = new Date().toISOString();
    const cobranca = newCobrancaDocument({
      id,
      batch,
      attempt,
      previousInterCobrancaId: currentId,
      issueInput,
      actor: input.actor,
      now,
    });
    transaction.create(financialDbAdmin.collection(COBRANCAS).doc(id), cobranca);
    transaction.set(batchRef, {
      status: "issuing",
      lockReason: batch.lockReason ?? "manual_issue_requested",
      bankProvider: "inter",
      interCobrancaId: id,
      interCobrancaIds: FieldValue.arrayUnion(id),
      bankWarning: null,
      updatedAt: now,
    }, { merge: true });
    return { batch: { ...batch, status: "issuing" as const, interCobrancaId: id }, cobranca, issueInput, idempotent: false };
  });
}

async function markIssueFailure(cobranca: InterCobrancaDocument, error: unknown) {
  const now = new Date().toISOString();
  const errorCode = error instanceof InterCobrancaApiError && error.status ? String(error.status) : "INTERNAL";
  const errorMessage = error instanceof Error ? error.message : "Falha desconhecida na emissão.";
  const firestoreBatch = financialDbAdmin.batch();
  firestoreBatch.set(financialDbAdmin.collection(COBRANCAS).doc(cobranca.id), {
    status: "failed",
    errorCode,
    errorMessage,
    updatedAt: now,
  }, { merge: true });
  firestoreBatch.set(financialDbAdmin.collection(BATCHES).doc(cobranca.batchId), {
    status: "failed",
    bankWarning: errorMessage,
    lastBankSyncAt: now,
    updatedAt: now,
  }, { merge: true });
  await firestoreBatch.commit();
  await writeEvent({
    workspaceId: cobranca.workspaceId,
    interCobrancaId: cobranca.id,
    codigoSolicitacao: cobranca.codigoSolicitacao,
    kind: "error",
    idempotencyKey: null,
    rawPayload: { errorCode, errorMessage },
    createdAt: now,
  });
}

function issueResultIsAmbiguous(error: unknown) {
  if (!(error instanceof InterCobrancaApiError)) return true;
  if (error.status === null) return true;
  return error.status >= 500 || [408, 409, 425, 429].includes(error.status);
}

async function markIssueResultUnknown(cobranca: InterCobrancaDocument, error: unknown) {
  const now = new Date().toISOString();
  const errorCode = error instanceof InterCobrancaApiError && error.status
    ? String(error.status)
    : "UNKNOWN_RESULT";
  const errorMessage = error instanceof Error
    ? error.message
    : "O resultado da emissão não pôde ser confirmado.";
  const firestoreBatch = financialDbAdmin.batch();
  firestoreBatch.set(financialDbAdmin.collection(COBRANCAS).doc(cobranca.id), {
    status: "requested",
    requestedAt: cobranca.requestedAt ?? now,
    errorCode,
    errorMessage,
    lastCheckedAt: now,
    updatedAt: now,
  }, { merge: true });
  firestoreBatch.set(financialDbAdmin.collection(BATCHES).doc(cobranca.batchId), {
    status: "issuing",
    bankWarning: "Resposta da emissão não confirmada; reconciliação pelo seuNumero em andamento.",
    lastBankSyncAt: now,
    updatedAt: now,
  }, { merge: true });
  await firestoreBatch.commit();
  await writeEvent({
    workspaceId: cobranca.workspaceId,
    interCobrancaId: cobranca.id,
    codigoSolicitacao: null,
    kind: "issue_result_unknown",
    idempotencyKey: cobranca.seuNumero,
    rawPayload: { errorCode, errorMessage },
    createdAt: now,
  });
  return { ...cobranca, status: "requested" as const, requestedAt: cobranca.requestedAt ?? now, updatedAt: now };
}

async function recoverInterCobrancaBySeuNumero(cobranca: InterCobrancaDocument) {
  const page = await listCobrancas({
    dataInicial: cobranca.dataVencimento,
    dataFinal: cobranca.dataVencimento,
    seuNumero: cobranca.seuNumero,
    itensPorPagina: 100,
  });
  const matches = page.cobrancas.filter((item) => item.cobranca.seuNumero === cobranca.seuNumero);
  if (matches.length === 0) return null;
  if (matches.length > 1) {
    throw new Error(`O Inter retornou mais de uma cobrança para o seuNumero ${cobranca.seuNumero}.`);
  }
  const detail = matches[0];
  const codigoSolicitacao = detail.cobranca.codigoSolicitacao;
  const now = new Date().toISOString();
  await financialDbAdmin.collection(COBRANCAS).doc(cobranca.id).set({
    codigoSolicitacao,
    status: "requested",
    requestedAt: cobranca.requestedAt ?? now,
    errorCode: null,
    errorMessage: null,
    updatedAt: now,
  }, { merge: true });
  await writeEvent({
    workspaceId: cobranca.workspaceId,
    interCobrancaId: cobranca.id,
    codigoSolicitacao,
    kind: "recovered_by_seu_numero",
    idempotencyKey: cobranca.seuNumero,
    rawPayload: { seuNumero: cobranca.seuNumero, codigoSolicitacao },
    createdAt: now,
  });
  return applyInterDetail(cobranca.id, detail);
}

function detailForAudit(detail: InterCobrancaDetail) {
  const { pagador: _pagador, ...cobranca } = detail.cobranca;
  return { ...detail, cobranca };
}

async function ensureCashDepositLedgerEntry(input: {
  cobranca: InterCobrancaDocument;
  batch: CashDepositBatch;
  detail: InterCobrancaDetail;
}) {
  const ledger = getInterCobrancaLedgerSettings();
  if (!ledger.enabled || getInterCobrancaEnvironment() !== "production") return null;
  if (!ledger.bankAccountId) throw new Error("Conta bancária de destino da Cobrança Inter não configurada.");
  const transactionId = `cash_deposit_inter_${input.cobranca.id}`;
  const transactionRef = financialDbAdmin.collection("transactions").doc(transactionId);
  const accountRef = financialDbAdmin.collection("bankAccounts").doc(ledger.bankAccountId);
  const result = await financialDbAdmin.runTransaction(async (transaction) => {
    const [existing, accountSnapshot] = await Promise.all([
      transaction.get(transactionRef),
      transaction.get(accountRef),
    ]);
    if (existing.exists) {
      const sourceId = existing.data()?.sourceId;
      if (sourceId !== input.batch.id) {
        throw new Error("O identificador do lançamento de depósito já está em uso por outra origem.");
      }
      const repairedAt = new Date().toISOString();
      transaction.set(financialDbAdmin.collection(COBRANCAS).doc(input.cobranca.id), {
        ledgerTransactionId: transactionId,
        ledgerPostedAt: input.cobranca.ledgerPostedAt ?? repairedAt,
        updatedAt: repairedAt,
      }, { merge: true });
      transaction.set(financialDbAdmin.collection(BATCHES).doc(input.batch.id), {
        ledgerTransactionId: transactionId,
        updatedAt: repairedAt,
      }, { merge: true });
      return { id: transactionId, created: false };
    }
    if (!accountSnapshot.exists || accountSnapshot.data()?.active === false) {
      throw new Error("A conta bancária de destino da Cobrança Inter não existe ou está inativa.");
    }
    const account = accountSnapshot.data() ?? {};
    const paidAtRaw = input.detail.cobranca.dataSituacao;
    const paidAt = paidAtRaw && !Number.isNaN(new Date(paidAtRaw).getTime())
      ? new Date(paidAtRaw)
      : new Date();
    const now = Timestamp.now();
    transaction.create(transactionRef, {
      type: "transfer_in",
      direction: "in",
      accountId: accountSnapshot.id,
      accountName: typeof account.name === "string" && account.name.trim() ? account.name.trim() : "Banco Inter",
      ...(ledger.bankPaymentMethodId ? { paymentMethodId: ledger.bankPaymentMethodId } : {}),
      paymentMethodLabel: `Cobrança Inter · ${input.detail.cobranca.origemRecebimento ?? "depósito em dinheiro"}`,
      toAccountId: `cash_on_hand_${input.batch.kioskId}`,
      toAccountName: `Caixa físico — ${input.batch.kioskName}`,
      amount: input.batch.totalCents / 100,
      amountCents: input.batch.totalCents,
      date: Timestamp.fromDate(paidAt),
      description: `Depósito de numerário — ${input.batch.kioskName} — bloco #${input.batch.sequence}`,
      notes: `Baixa confirmada por consulta ativa da Cobrança Inter ${input.cobranca.codigoSolicitacao}.`,
      sourceType: "cash_deposit_batch",
      sourceId: input.batch.id,
      cashDepositBatchId: input.batch.id,
      interCobrancaId: input.cobranca.id,
      codigoSolicitacao: input.cobranca.codigoSolicitacao,
      createdBy: "inter-reconciliation",
      createdAt: now,
    });
    transaction.set(financialDbAdmin.collection(COBRANCAS).doc(input.cobranca.id), {
      ledgerTransactionId: transactionId,
      ledgerPostedAt: now.toDate().toISOString(),
      updatedAt: now.toDate().toISOString(),
    }, { merge: true });
    transaction.set(financialDbAdmin.collection(BATCHES).doc(input.batch.id), {
      ledgerTransactionId: transactionId,
      updatedAt: now.toDate().toISOString(),
    }, { merge: true });
    return { id: transactionId, created: true };
  });
  return result;
}

export async function issueInterCobrancaForBatch(input: {
  workspaceId: string;
  batchId: string;
  actor: CashClosureActor;
}) {
  const readiness = interCobrancaReadiness();
  if (!readiness.ready) throw new Error(readiness.reason ?? "Cobrança Inter não configurada.");
  const prepared = await prepareIssue(input);
  if (prepared.idempotent) {
    if (prepared.cobranca.codigoSolicitacao) {
      return refreshInterCobranca(prepared.cobranca.id);
    }
    const recovered = await recoverInterCobrancaBySeuNumero(prepared.cobranca);
    if (recovered) return recovered;
    throw new Error("A emissão deste bloco está em reconciliação; não solicite uma nova cobrança.");
  }
  if (!prepared.issueInput) throw new Error("Dados de emissão ausentes.");

  await writeEvent({
    workspaceId: input.workspaceId,
    interCobrancaId: prepared.cobranca.id,
    codigoSolicitacao: null,
    kind: "issue_requested",
    idempotencyKey: prepared.cobranca.seuNumero,
    rawPayload: {
      seuNumero: prepared.issueInput.seuNumero,
      valorNominalCents: prepared.cobranca.valorNominalCents,
      dataVencimento: prepared.issueInput.dataVencimento,
      numDiasAgenda: prepared.issueInput.numDiasAgenda,
      formasRecebimento: prepared.issueInput.formasRecebimento,
    },
  });

  let response: Awaited<ReturnType<typeof createCobranca>>;
  try {
    response = await createCobranca(prepared.issueInput);
  } catch (error) {
    if (!issueResultIsAmbiguous(error)) {
      await markIssueFailure(prepared.cobranca, error);
      throw error;
    }
    const pending = await markIssueResultUnknown(prepared.cobranca, error);
    const recovered = await recoverInterCobrancaBySeuNumero(pending).catch(() => null);
    if (recovered) return recovered;
    throw new Error("O Inter não confirmou a resposta da emissão. O bloco ficou protegido em reconciliação e não será reemitido automaticamente.");
  }
  const now = new Date().toISOString();
  await financialDbAdmin.collection(COBRANCAS).doc(prepared.cobranca.id).set({
    codigoSolicitacao: response.codigoSolicitacao,
    status: "requested",
    requestedAt: now,
    errorCode: null,
    errorMessage: null,
    updatedAt: now,
  }, { merge: true });
  await writeEvent({
    workspaceId: input.workspaceId,
    interCobrancaId: prepared.cobranca.id,
    codigoSolicitacao: response.codigoSolicitacao,
    kind: "issue_response",
    idempotencyKey: prepared.cobranca.seuNumero,
    rawPayload: response,
    createdAt: now,
  });
  return refreshInterCobranca(prepared.cobranca.id).catch(async () => {
    const snapshot = await financialDbAdmin.collection(COBRANCAS).doc(prepared.cobranca.id).get();
    return {
      cobranca: snapshotValue<InterCobrancaDocument>(snapshot),
      batch: prepared.batch,
      updatedClosures: [],
      mapping: mapInterSituation("EM_PROCESSAMENTO"),
    };
  });
}

async function relatedBatchStates(
  transaction: FirebaseFirestore.Transaction,
  closure: CashClosure,
  currentBatch: CashDepositBatch,
  nextCurrentStatus: CashDepositBatch["status"],
) {
  const ids = closure.cashDeposit.manualSplitBatchIds?.length
    ? closure.cashDeposit.manualSplitBatchIds
    : closure.cashDeposit.batchId
      ? [closure.cashDeposit.batchId]
      : [];
  const states = new Map<string, CashDepositBatch["status"]>();
  for (const id of ids) {
    if (id === currentBatch.id) {
      states.set(id, nextCurrentStatus);
      continue;
    }
    const snapshot = await transaction.get(financialDbAdmin.collection(BATCHES).doc(id));
    if (snapshot.exists) states.set(id, snapshotValue<CashDepositBatch>(snapshot).status);
  }
  return states;
}

async function applyInterDetail(cobrancaId: string, detail: InterCobrancaDetail) {
  const cobrancaRef = financialDbAdmin.collection(COBRANCAS).doc(cobrancaId);
  const result = await financialDbAdmin.runTransaction(async (transaction) => {
    const cobrancaSnapshot = await transaction.get(cobrancaRef);
    if (!cobrancaSnapshot.exists) throw new Error("Cobrança Inter não encontrada.");
    const cobranca = snapshotValue<InterCobrancaDocument>(cobrancaSnapshot);
    const batchRef = financialDbAdmin.collection(BATCHES).doc(cobranca.batchId);
    const batchSnapshot = await transaction.get(batchRef);
    if (!batchSnapshot.exists) throw new Error("Bloco vinculado à cobrança não encontrado.");
    const batch = snapshotValue<CashDepositBatch>(batchSnapshot);
    const closureSnapshots = [];
    for (const closureId of batch.closureIds) {
      closureSnapshots.push(await transaction.get(financialDbAdmin.collection("cashClosures").doc(closureId)));
    }

    const mapping = mapInterSituation(detail.cobranca.situacao);
    const nextBatchStatus = mapping.batchStatus ?? batch.status;
    const closureStates = new Map<string, Map<string, CashDepositBatch["status"]>>();
    for (const snapshot of closureSnapshots) {
      if (!snapshot.exists) continue;
      const closure = snapshotValue<CashClosure>(snapshot);
      closureStates.set(closure.id, await relatedBatchStates(transaction, closure, batch, nextBatchStatus));
    }

    const now = new Date().toISOString();
    const fields = detailFields(detail);
    if (mapping.status === "paid" && fields.valorTotalRecebidoCents !== cobranca.valorNominalCents) {
      throw new Error("O valor recebido pelo Inter diverge do valor nominal; a baixa foi bloqueada.");
    }
    const cobrancaUpdate: Partial<InterCobrancaDocument> = {
      ...fields,
      status: mapping.status,
      lastCheckedAt: now,
      errorCode: null,
      errorMessage: null,
      updatedAt: now,
      ...(mapping.status === "issued" && !cobranca.issuedAt ? { issuedAt: now } : {}),
      ...(mapping.status === "paid" && !cobranca.paidAt ? { paidAt: now } : {}),
      ...(mapping.status === "cancelled" && !cobranca.cancelledAt ? { cancelledAt: now } : {}),
    };
    transaction.set(cobrancaRef, cobrancaUpdate, { merge: true });
    transaction.set(batchRef, {
      status: nextBatchStatus,
      bankProvider: "inter",
      bankWarning: mapping.warning,
      lastBankSyncAt: now,
      updatedAt: now,
      ...(nextBatchStatus === "issued" && !batch.issuedAt ? { issuedAt: now } : {}),
      ...(nextBatchStatus === "paid" && !batch.paidAt ? { paidAt: now } : {}),
      ...(nextBatchStatus === "cancelled" && !batch.cancelledAt ? { cancelledAt: now } : {}),
    }, { merge: true });

    const updatedClosures: CashClosure[] = [];
    for (const snapshot of closureSnapshots) {
      if (!snapshot.exists) continue;
      const closure = snapshotValue<CashClosure>(snapshot);
      const states = [...(closureStates.get(closure.id)?.values() ?? [])];
      let status = closure.cashDeposit.status;
      if (mapping.closureDepositStatus === "paid") {
        status = states.length > 0 && states.every((value) => value === "paid") ? "paid" : "issued";
      } else if (mapping.closureDepositStatus === "issued") {
        status = "issued";
      } else if (mapping.closureDepositStatus === "allocated") {
        const terminal = states.length === 0 || states.every((value) => ["cancelled", "failed", "open", "locked"].includes(value));
        if (terminal) status = "allocated";
      }
      const nextClosure: CashClosure = {
        ...closure,
        cashDeposit: { ...closure.cashDeposit, status },
        updatedAt: now,
      };
      transaction.set(snapshot.ref, nextClosure);
      if (status !== closure.cashDeposit.status) {
        const auditId = randomUUID();
        const action = status === "paid"
          ? "deposit_paid"
          : status === "issued"
            ? "deposit_issued"
            : "deposit_cancelled";
        transaction.set(financialDbAdmin.collection("cashClosureAuditLogs").doc(auditId), {
          id: auditId,
          workspaceId: closure.workspaceId,
          closureId: closure.id,
          action,
          previousValue: closure.cashDeposit.status,
          newValue: {
            status,
            batchId: batch.id,
            interCobrancaId: cobranca.id,
            codigoSolicitacao: cobranca.codigoSolicitacao,
            situacao: detail.cobranca.situacao,
          },
          userId: "inter-reconciliation",
          userName: "Reconciliação Banco Inter",
          createdAt: now,
        });
      }
      updatedClosures.push(nextClosure);
    }
    return { cobranca: { ...cobranca, ...cobrancaUpdate }, batch: { ...batch, status: nextBatchStatus }, updatedClosures, mapping };
  });
  if (result.mapping.status === "paid") {
    const ledger = await ensureCashDepositLedgerEntry({
      cobranca: result.cobranca,
      batch: result.batch,
      detail,
    });
    if (ledger) {
      result.cobranca.ledgerTransactionId = ledger.id;
      result.batch.ledgerTransactionId = ledger.id;
    }
  }
  await Promise.all(result.updatedClosures.map((closure) => refreshCashClosureSummaries(closure)));
  return result;
}

export async function refreshInterCobranca(cobrancaId: string) {
  const snapshot = await financialDbAdmin.collection(COBRANCAS).doc(cobrancaId).get();
  if (!snapshot.exists) throw new Error("Cobrança Inter não encontrada.");
  const cobranca = snapshotValue<InterCobrancaDocument>(snapshot);
  if (!cobranca.codigoSolicitacao) throw new Error("A cobrança ainda não possui codigoSolicitacao.");
  const detail = await retrieveCobranca(cobranca.codigoSolicitacao);
  const result = await applyInterDetail(cobranca.id, detail);
  await writeEvent({
    workspaceId: cobranca.workspaceId,
    interCobrancaId: cobranca.id,
    codigoSolicitacao: cobranca.codigoSolicitacao,
    kind: "active_query",
    idempotencyKey: `${cobranca.codigoSolicitacao}:${detail.cobranca.situacao}:${detail.cobranca.dataSituacao ?? ""}`,
    rawPayload: detailForAudit(detail),
  });
  return result;
}

export async function refreshInterCobrancaByCodigo(codigoSolicitacao: string) {
  const snapshot = await financialDbAdmin.collection(COBRANCAS)
    .where("codigoSolicitacao", "==", codigoSolicitacao)
    .limit(1)
    .get();
  if (snapshot.empty) return null;
  return refreshInterCobranca(snapshot.docs[0].id);
}

export async function handleInterWebhookItem(input: {
  item: InterCobrancaWebhookItem;
  workspaceId: string;
  idempotencyKey: string | null;
}) {
  const eventId = createHash("sha256")
    .update(input.idempotencyKey ?? "")
    .update(input.item.codigoSolicitacao)
    .update(input.item.situacao)
    .update(input.item.dataHoraSituacao)
    .digest("hex");
  const existing = await financialDbAdmin.collection(EVENTS).doc(eventId).get();
  if (existing.exists) return { idempotent: true, refreshed: false };
  const cobrancaSnapshot = await financialDbAdmin.collection(COBRANCAS)
    .where("codigoSolicitacao", "==", input.item.codigoSolicitacao)
    .limit(1)
    .get();
  const cobrancaId = cobrancaSnapshot.empty ? null : cobrancaSnapshot.docs[0].id;
  await writeEvent({
    id: eventId,
    workspaceId: input.workspaceId,
    interCobrancaId: cobrancaId,
    codigoSolicitacao: input.item.codigoSolicitacao,
    kind: "webhook",
    idempotencyKey: input.idempotencyKey,
    rawPayload: input.item,
  });
  if (!cobrancaId) return { idempotent: false, refreshed: false };
  await refreshInterCobranca(cobrancaId);
  return { idempotent: false, refreshed: true };
}

export async function cancelInterCobrancaForBatch(input: {
  workspaceId: string;
  batchId: string;
  reason: string;
}) {
  const reason = input.reason.trim();
  if (!reason) throw new Error("Informe o motivo do cancelamento.");
  if (reason.length > 50) throw new Error("O motivo do cancelamento deve ter no máximo 50 caracteres.");
  const batchSnapshot = await financialDbAdmin.collection(BATCHES).doc(input.batchId).get();
  if (!batchSnapshot.exists) throw new Error("Bloco não encontrado.");
  const batch = snapshotValue<CashDepositBatch>(batchSnapshot);
  if (batch.workspaceId !== input.workspaceId) throw new Error("Bloco não encontrado.");
  if (!batch.interCobrancaId) throw new Error("O bloco não possui cobrança Inter.");
  const cobrancaSnapshot = await financialDbAdmin.collection(COBRANCAS).doc(batch.interCobrancaId).get();
  if (!cobrancaSnapshot.exists) throw new Error("Cobrança Inter não encontrada.");
  const cobranca = snapshotValue<InterCobrancaDocument>(cobrancaSnapshot);
  if (!cobranca.codigoSolicitacao) throw new Error("A cobrança ainda não foi aceita pelo Inter.");
  if (cobranca.status === "paid") throw new Error("Cobrança já recebida não pode ser cancelada.");

  await writeEvent({
    workspaceId: input.workspaceId,
    interCobrancaId: cobranca.id,
    codigoSolicitacao: cobranca.codigoSolicitacao,
    kind: "cancel_requested",
    idempotencyKey: null,
    rawPayload: { reason },
  });
  try {
    await cancelCobranca(cobranca.codigoSolicitacao, reason);
  } catch (error) {
    const refreshed = await refreshInterCobranca(cobranca.id).catch(() => null);
    if (refreshed?.cobranca.status === "paid") return refreshed;
    throw error;
  }
  return refreshInterCobranca(cobranca.id);
}

export async function getInterCobrancaPdfForBatch(input: {
  workspaceId: string;
  batchId: string;
}) {
  const batchSnapshot = await financialDbAdmin.collection(BATCHES).doc(input.batchId).get();
  if (!batchSnapshot.exists) throw new Error("Bloco não encontrado.");
  const batch = snapshotValue<CashDepositBatch>(batchSnapshot);
  if (batch.workspaceId !== input.workspaceId) throw new Error("Bloco não encontrado.");
  if (!batch.interCobrancaId) throw new Error("O bloco não possui cobrança Inter.");
  const cobrancaSnapshot = await financialDbAdmin.collection(COBRANCAS).doc(batch.interCobrancaId).get();
  if (!cobrancaSnapshot.exists) throw new Error("Cobrança Inter não encontrada.");
  const cobranca = snapshotValue<InterCobrancaDocument>(cobrancaSnapshot);
  if (!cobranca.codigoSolicitacao) throw new Error("A cobrança ainda não possui PDF.");
  return retrieveCobrancaPdf(cobranca.codigoSolicitacao);
}

export async function getInterCobrancaForBatch(batchId: string) {
  const batchSnapshot = await financialDbAdmin.collection(BATCHES).doc(batchId).get();
  if (!batchSnapshot.exists) return null;
  const batch = snapshotValue<CashDepositBatch>(batchSnapshot);
  if (!batch.interCobrancaId) return { batch, cobranca: null };
  const cobrancaSnapshot = await financialDbAdmin.collection(COBRANCAS).doc(batch.interCobrancaId).get();
  return {
    batch,
    cobranca: cobrancaSnapshot.exists ? snapshotValue<InterCobrancaDocument>(cobrancaSnapshot) : null,
  };
}

export async function listInterCobrancas(workspaceId: string, limit = 500) {
  const snapshot = await financialDbAdmin.collection(COBRANCAS)
    .where("workspaceId", "==", workspaceId)
    .orderBy("updatedAt", "desc")
    .limit(Math.min(Math.max(limit, 1), 500))
    .get();
  return snapshot.docs.map((document) => snapshotValue<InterCobrancaDocument>(document));
}

export async function reconcileInterCobrancas(input: { workspaceId: string; limit?: number }) {
  const snapshot = await financialDbAdmin.collection(COBRANCAS)
    .where("workspaceId", "==", input.workspaceId)
    .where("status", "in", ["issuing", "requested", "issued", "marked_received"])
    .limit(Math.min(Math.max(input.limit ?? 100, 1), 500))
    .get();
  const results: Array<{ id: string; ok: boolean; status?: string; error?: string }> = [];
  for (const document of snapshot.docs) {
    try {
      const cobranca = snapshotValue<InterCobrancaDocument>(document);
      const refreshed = cobranca.codigoSolicitacao
        ? await refreshInterCobranca(document.id)
        : await recoverInterCobrancaBySeuNumero(cobranca);
      if (!refreshed) {
        results.push({ id: document.id, ok: false, status: cobranca.status, error: "Ainda não localizada pelo seuNumero." });
        continue;
      }
      results.push({ id: document.id, ok: true, status: refreshed.cobranca.status });
    } catch (error) {
      results.push({ id: document.id, ok: false, error: error instanceof Error ? error.message : "Falha desconhecida." });
    }
  }
  return results;
}

export function verifyInterWebhookSecret(provided: string | null, expected: string | undefined) {
  if (!provided || !expected) return false;
  const left = Buffer.from(provided);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}
