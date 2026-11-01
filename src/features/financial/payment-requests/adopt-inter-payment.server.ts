import { Timestamp } from "firebase-admin/firestore";

import { reconcileExpenseProvisionOnServer } from "@/features/financial/expense-provision-reconciliation.server";
import { normalizeFinancialDocumentIdentity, paymentBarcodeHash } from "@/features/financial/inbox/document-identity";
import { financialDbAdmin } from "@/lib/firebase-financial-admin";
import { getInterBarcodePayment } from "@/lib/integrations/inter/barcode-payments.server";
import { AppError } from "@/lib/observability";
import { WORKSPACE_ID } from "@/lib/workspace";
import { planBankStatusObservation } from "./bank-status-observation";
import { validateExternalInterPayment, type ExternalInterAdoptionInput } from "./adopt-inter-payment";
import type { BarcodeBankPaymentRequest, PaymentActor } from "./types";

function conflict(message: string): never {
  throw new AppError({ code: "INTER_EXTERNAL_PAYMENT_CONFLICT", kind: "CONFLICT", safeMessage: message });
}

function dateTimestamp(date: string) {
  return Timestamp.fromDate(new Date(`${date}T12:00:00-03:00`));
}

function supplierTokens(value: string) {
  const normalized = value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase()
    .replace(/\b(?:[A-Z]\s+){2,}[A-Z]\b/g, (match) => match.replace(/\s+/g, ""));
  return normalized.split(/[^A-Z0-9]+/).filter((token) =>
    (token.length >= 4 || token === "TVN")
    && !["LTDA", "SERVICOS", "SOCIEDADE", "INDIVIDUAL", "SUPERMERCADOS"].includes(token));
}

/** Imports an existing bank instruction. This function never invokes the Inter payment POST. */
export async function adoptInterBarcodePayment(input: ExternalInterAdoptionInput, actor: PaymentActor, workspaceId: string) {
  if (workspaceId !== WORKSPACE_ID) conflict("Workspace financeiro inválido.");
  const bank = await getInterBarcodePayment(input.interRequestId);
  let observed: ReturnType<typeof validateExternalInterPayment>;
  try { observed = validateExternalInterPayment(input, bank); }
  catch { conflict("Os dados ou o estado observados no Inter divergem da vinculação solicitada."); }
  if (!bank) conflict("O Inter não confirmou a transação informada.");
  const { code, beneficiaryDocument, dueDate, scheduledFor, amountCents, settlementAmountCents, status } = observed;

  const requestId = `external_inter_${input.interRequestId}`;
  const priorRequest = await financialDbAdmin.collection("bankPaymentRequests").doc(requestId).get();
  if (priorRequest.exists) {
    const prior = priorRequest.data()!;
    if (prior.bankInstructionOrigin !== "inter_dda"
      || ![input.targetExpenseId, `inter_dda_${input.targetExpenseId}`].includes(prior.expenseId)
      || prior.barcodeSnapshot?.code !== code || Math.round(Number(prior.amount) * 100) !== amountCents) {
      conflict("A transação já está vinculada de outra forma.");
    }
    return { requestId, expenseId: prior.expenseId as string, status: prior.status as string, alreadyLinked: true };
  }

  const sourceRef = financialDbAdmin.collection("expenses").doc(input.targetExpenseId);
  const source = await sourceRef.get();
  if (!source.exists) conflict("A despesa ou provisão não foi encontrada.");
  const sourceData = source.data()!;
  if (sourceData.workspaceId && sourceData.workspaceId !== workspaceId) conflict("A despesa pertence a outro workspace.");
  const bankSupplierTokens = supplierTokens(String(bank.nomeBeneficiario || ""));
  const expenseSupplierTokens = new Set(supplierTokens(`${sourceData.supplier || ""} ${sourceData.description || ""}`));
  if (!bankSupplierTokens.length || !bankSupplierTokens.some((token) => expenseSupplierTokens.has(token))) {
    conflict("O favorecido bancário não corresponde ao fornecedor da despesa.");
  }
  if (sourceData.status === "paid" || sourceData.status === "cancelled") conflict("A despesa não está disponível para vínculo.");
  if (sourceData.paymentRequestId || sourceData.linkedBankTransactionId) conflict("A despesa já possui pagamento vinculado.");
  const isForecast = sourceData.provisionType === "forecast";
  const actualId = isForecast ? `inter_dda_${input.targetExpenseId}` : input.targetExpenseId;
  const codeHash = paymentBarcodeHash(code);
  if (!codeHash) conflict("Linha digitável inválida.");
  const [priorByBankId, priorByBarcode] = await Promise.all([
    financialDbAdmin.collection("bankPaymentRequests").where("interRequestId", "==", input.interRequestId).limit(2).get(),
    financialDbAdmin.collection("bankPaymentRequests").where("barcodeSnapshot.codeHash", "==", codeHash).limit(2).get(),
  ]);
  if ([...priorByBankId.docs, ...priorByBarcode.docs].some((item) => item.id !== requestId)) {
    conflict("O boleto ou a transação já possui vínculo no Coala.");
  }
  const resumedForecast = isForecast && sourceData.status === "reconciled" && sourceData.replacedByExpenseId === actualId;
  if (isForecast && (!(sourceData.status === "provisioned" || resumedForecast)
    || !sourceData.provisionSeriesKey || !sourceData.provisionCompetence)) {
    conflict("A provisão não está disponível para conciliação.");
  }
  if (isForecast && sourceData.provisionCompetence !== dueDate.slice(0, 7)) {
    conflict("A competência da provisão não corresponde ao vencimento bancário.");
  }
  if (!isForecast && (sourceData.status !== "pending" || Math.round(Number(sourceData.totalValue) * 100) !== amountCents)) {
    conflict("O valor da despesa real não corresponde ao pagamento bancário.");
  }
  if (!isForecast) {
    const due = sourceData.dueDate?.toDate?.() ?? new Date(sourceData.dueDate);
    if (Number.isNaN(due.getTime()) || Math.abs(due.getTime() - dateTimestamp(dueDate).toDate().getTime()) > 5 * 86_400_000) {
      conflict("O vencimento da despesa diverge do boleto bancário.");
    }
  }
  const now = new Date().toISOString();
  if (isForecast && !resumedForecast) {
    const actual = {
      workspaceId,
      description: sourceData.description,
      supplier: sourceData.supplier,
      totalValue: amountCents / 100,
      dueDate: dateTimestamp(dueDate),
      competenceMonth: sourceData.competenceMonth,
      competenceDate: sourceData.competenceDate,
      accountPlan: sourceData.accountPlan,
      accountId: sourceData.accountId,
      accountPlanName: sourceData.accountPlanName,
      resultCenter: sourceData.resultCenter ?? null,
      resultCenterId: sourceData.resultCenterId ?? null,
      resultCenterName: sourceData.resultCenterName ?? null,
      unitId: sourceData.unitId ?? null,
      sourceType: "inter_dda_payment",
      provisionType: "actual" as const,
      provisionSeriesKey: sourceData.provisionSeriesKey,
      provisionCompetence: sourceData.provisionCompetence,
      status: "pending",
      installments: [{ number: 1, dueDate: dateTimestamp(dueDate), value: amountCents / 100, status: "pending" }],
      paymentMethod: "single",
      createdAt: Timestamp.now(),
      createdBy: actor.uid,
      updatedAt: Timestamp.now(),
    };
    const reconciliation = await reconcileExpenseProvisionOnServer(actualId, actor, {
      identity: { provisionSeriesKey: actual.provisionSeriesKey, provisionCompetence: actual.provisionCompetence, provisionType: "actual" },
      createIfMissing: actual,
    });
    if (reconciliation.status !== "reconciled" && reconciliation.status !== "already_reconciled") {
      conflict("A provisão não pôde ser conciliada com a despesa real.");
    }
  }

  const requestRef = financialDbAdmin.collection("bankPaymentRequests").doc(requestId);
  const expenseRef = financialDbAdmin.collection("expenses").doc(actualId);
  const expectedRef = financialDbAdmin.collection("expectedBankDebits").doc(`request_${requestId}`);
  return financialDbAdmin.runTransaction(async (tx) => {
    const [expense, existing, byBankId, byBarcode] = await Promise.all([
      tx.get(expenseRef), tx.get(requestRef),
      tx.get(financialDbAdmin.collection("bankPaymentRequests").where("interRequestId", "==", input.interRequestId).limit(2)),
      tx.get(financialDbAdmin.collection("bankPaymentRequests").where("barcodeSnapshot.codeHash", "==", codeHash).limit(2)),
    ]);
    if (!expense.exists) conflict("A despesa real não foi encontrada após a conciliação.");
    if (existing.exists) {
      const prior = existing.data()!;
      if (prior.expenseId !== actualId || prior.interRequestId !== input.interRequestId || prior.barcodeSnapshot?.code !== code) conflict("A transação já está vinculada a outra despesa.");
      return { requestId, expenseId: actualId, status: prior.status, alreadyLinked: true };
    }
    if (!byBankId.empty || !byBarcode.empty) conflict("O boleto ou a transação já possui vínculo no Coala.");
    const data = expense.data()!;
    if (data.workspaceId && data.workspaceId !== workspaceId) conflict("A despesa pertence a outro workspace.");
    if (!bankSupplierTokens.some((token) => new Set(supplierTokens(`${data.supplier || ""} ${data.description || ""}`)).has(token))) {
      conflict("O fornecedor da despesa mudou antes da vinculação.");
    }
    if (data.status !== "pending" || Math.round(Number(data.totalValue) * 100) !== amountCents
      || data.paymentRequestId || data.linkedBankTransactionId) conflict("A despesa mudou antes da vinculação.");
    if (!Array.isArray(data.installments) || data.installments.length !== 1 || data.installments[0]?.status === "paid") {
      conflict("A vinculação exige uma despesa com uma única parcela em aberto.");
    }
    if (data.installments[0]?.paymentRequestId || data.installments[0]?.linkedBankTransactionId
      || data.installments[0]?.paidAt || data.paidAt || data.paymentState === "paid") {
      conflict("A parcela já possui pagamento ou liquidação vinculada.");
    }
    const observation = planBankStatusObservation({
      current: { status: "ready_to_submit" }, nextStatus: status === "paid" ? "awaiting_statement" : "scheduled",
      rawBankStatus: bank.statusPagamento, observedAt: now, scheduledFor,
    });
    const request: BarcodeBankPaymentRequest = {
      id: requestId, workspaceId, sourceType: "expense_boleto", sourceId: actualId, expenseId: actualId,
      bankInstructionOrigin: "inter_dda",
      installmentNumber: Number(data.installments[0].number ?? 1), paymentRail: "barcode", amount: amountCents / 100,
      description: String(data.description || "Despesa").slice(0, 140),
      status: status === "paid" ? "awaiting_statement" : "scheduled",
      barcodeSnapshot: { type: "barcode", code, codeHash, maskedCode: normalizeFinancialDocumentIdentity({ barcode: code }).barcodeMasked || "", dueDate, scheduledFor, beneficiaryDocument },
      idempotencyKey: requestId, interRequestId: input.interRequestId,
      bankStatus: String(bank.statusPagamento || ""),
      bankNominalAmount: amountCents / 100, bankSettlementAmount: settlementAmountCents / 100,
      bankLateChargeAmount: (settlementAmountCents - amountCents) / 100,
      statementReconciliationStatus: "expected", createdAt: now, updatedAt: now, createdBy: actor.uid,
      ...observation.patch,
    };
    const installments = Array.isArray(data.installments) ? data.installments.map((item: Record<string, unknown>) => ({
      ...item, paymentRequestId: requestId, bankPaymentTransactionId: input.interRequestId,
      bankPaymentStatus: bank.statusPagamento || null, paymentSchedulingStatus: request.status,
      bankPaymentScheduledFor: dateTimestamp(scheduledFor),
    })) : [];
    tx.create(requestRef, Object.fromEntries(Object.entries(request).filter(([key]) => key !== "id")));
    tx.create(expectedRef, {
      workspaceId, status: status === "paid" ? "awaiting_statement" : "active",
      paymentRequestId: requestId, financialInboxMessageId: null, sourceType: "expense_boleto",
      expenseId: actualId, amountCents: settlementAmountCents, principalAmountCents: amountCents, expectedDate: scheduledFor,
      dueDate, bankTransactionCode: input.interRequestId, barcodeLastDigits: code.slice(-8),
      counterpartyName: String(bank.nomeBeneficiario || data.supplier || ""), bankStatus: bank.statusPagamento || null,
      createdAt: now, updatedAt: now,
    });
    tx.update(expenseRef, { paymentRequestId: requestId, installments, updatedAt: Timestamp.now(), updatedBy: actor.uid });
    tx.create(requestRef.collection("events").doc("adopted"), {
      type: "EXTERNAL_INTER_PAYMENT_ADOPTED", at: now, actorId: actor.uid, actorEmail: actor.email ?? null,
      expenseId: actualId, interRequestId: input.interRequestId, amountCents, scheduledFor,
    });
    return { requestId, expenseId: actualId, status: request.status, alreadyLinked: false };
  });
}
