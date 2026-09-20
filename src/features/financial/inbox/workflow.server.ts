import { FieldValue, Timestamp } from "firebase-admin/firestore";

import { financialDbAdmin } from "@/lib/firebase-financial-admin";
import { WORKSPACE_ID } from "@/lib/workspace";
import { calculateFinancialObligationSummary } from "@/features/financial/obligations/calculations";
import { financialExpenseAccountingFields } from "@/features/financial/lib/expense-accounting-contract";
import { inheritExpenseReferenceCenter } from "@/features/financial/lib/expense-reference-center";
import type { PaymentActor } from "@/features/financial/payment-requests/types";
import { classifyFinancialEmail, mergeBillingIdentities } from "./parser";
import { chooseExistingExpenseSuggestion, existingPayment, type InboxExpenseCandidate } from "./expense-suggestions";
import { chooseProvisionSuggestion, scoreProvisionCandidate, type ProvisionCandidate } from "./provision-suggestions";
import { chooseCreationSuggestion } from "./creation-suggestions";
import { shouldAutomaticallyIdentifyInboxCharge } from "./automation-policy";
import {
  defaultFinancialInboxAutomationSettings,
  getFinancialInboxAutomationSettings,
} from "./automation-settings.server";
import {
  automaticReminderResolutionPatch,
  discardedFinancialInboxResolution,
  FINANCIAL_INBOX_RESOLUTION_VERSION,
  identifiedFinancialInboxResolution,
  pendingFinancialInboxResolution,
  resolutionForDisplay,
} from "./resolution-contract";
import { prepareFinancialInboxDocuments } from "./document-processing.server";
import {
  financialDocumentIdentityFromClassification,
  mergeFinancialDocumentIdentities,
  paymentBarcodeHash,
} from "./document-identity";
import { getFinancialInboxMessage } from "./repository.server";
import {
  buildFinancialInboxSearchTerms,
  FINANCIAL_INBOX_SEARCH_INDEX_VERSION,
} from "./search-index";
import type { FinancialInboxMessage } from "./types";

const MAX_PROVISION_CANDIDATES = 100;
const MAX_EXISTING_EXPENSE_CANDIDATES = 500;
const MAX_MATCHED_PAYMENT_CANDIDATES = 100;
const MAX_MATCHED_BARCODE_PAYMENT_CANDIDATES = 10;
// Custo de triagem: no máximo 10 leituras por cobrança relevante. Com 300
// cobranças/mês, o teto esperado é 3.000 leituras/mês, além de reanálises manuais.
// O cruzamento lê no máximo 501 despesas abertas, 101 pagamentos do mesmo valor,
// 22 solicitações pelo hash/código de barras, 110 despesas referenciadas e 100 previsões.
// Com 50 cobranças/mês, o teto é 41.700 leituras/mês, incluindo análise automática
// e reanálises manuais.
// Um candidato documental forte acrescenta 1 leitura pontual da configuração
// opt-in do workspace antes de qualquer identificação automática.

function money(value: unknown) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function dateTimestamp(value: string | null, fallback: Date) {
  if (!value) return Timestamp.fromDate(fallback);
  const date = new Date(`${value}T12:00:00-03:00`);
  return Timestamp.fromDate(Number.isNaN(date.getTime()) ? fallback : date);
}

function inboxThreadMessage(
  message: Pick<FinancialInboxMessage, "id" | "subject" | "receivedAt" | "status" | "resolution">,
) {
  const kind = message.resolution?.kind;
  return {
    id: message.id,
    subject: message.subject,
    receivedAt: message.receivedAt,
    status: message.status,
    kind: kind === "new_charge" || kind === "reminder" || kind === "duplicate" ? kind : null,
  } as const;
}

function mergeInboxThreadMessages(...groups: unknown[]) {
  const byId = new Map<string, ReturnType<typeof inboxThreadMessage>>();
  groups.flatMap((group) => Array.isArray(group) ? group : []).forEach((value) => {
    if (!value || typeof value !== "object") return;
    const message = value as ReturnType<typeof inboxThreadMessage>;
    if (!message.id || !message.subject || !message.receivedAt) return;
    byId.set(message.id, message);
  });
  return [...byId.values()].sort((left, right) => left.receivedAt.localeCompare(right.receivedAt));
}

function mergeExpenseAliases(currentValue: unknown, ...candidates: unknown[]) {
  const values = [
    ...(Array.isArray(currentValue) ? currentValue : []),
    ...candidates,
  ].map((value) => String(value ?? "").trim()).filter(Boolean);
  const byKey = new Map<string, string>();
  values.forEach((value) => {
    const key = value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR");
    if (!byKey.has(key)) byKey.set(key, value);
  });
  return [...byKey.values()].slice(0, 20);
}

function isoDateKey(value: unknown) {
  try {
    const date = value && typeof (value as { toDate?: unknown }).toDate === "function"
      ? (value as { toDate: () => Date }).toDate()
      : value ? new Date(value as string | number | Date) : null;
    return date && !Number.isNaN(date.getTime()) ? date.toISOString().slice(0, 10) : null;
  } catch {
    return null;
  }
}

function copyExpenseClassification(provision: Record<string, unknown>) {
  const fields = [
    "accountPlan", "accountId", "accountPlanName", "hasAccountAllocations", "accountAllocations",
    "hasPersonAllocations", "personAllocations", "isApportioned", "resultCenter", "resultCenterId", "resultCenterName",
    "referenceResultCenterId", "referenceResultCenterName",
    "apportionments", "rateioCriterion", "rateioEffectiveFrom", "rateioFirstMonthMode",
    "plannedPaymentMethodType", "plannedBankAccountId", "plannedBankAccountName",
    "plannedPaymentMethodId", "plannedPaymentMethodLabel", "provisionSeriesKey",
    "aliases",
  ];
  return Object.fromEntries(fields.filter((field) => field in provision).map((field) => [field, provision[field]]));
}

export async function analyzeFinancialInboxMessage(id: string, expectedWorkspaceId?: string) {
  const message = await getFinancialInboxMessage(id);
  if (expectedWorkspaceId && message.workspaceId !== expectedWorkspaceId) {
    throw new Error("Cobrança recebida não encontrada.");
  }
  const checkedAt = new Date().toISOString();
  const documents = await prepareFinancialInboxDocuments(message);
  const reparsed = classifyFinancialEmail({
    subject: message.subject,
    text: message.textContent,
    senderDomain: message.senderDomain,
    documentText: documents.documentText,
    documentHints: documents.hints,
    documentReferences: message.attachments.map((attachment) => attachment.filename),
  }).classification;
  const classification = {
    ...reparsed,
    links: message.classification.links?.length ? message.classification.links : reparsed.links,
  };

  let expenseCandidates: InboxExpenseCandidate[] = [];
  let expenseScanTruncated = false;
  if (classification.financeLikely && (
    Boolean(classification.barcode)
    || Boolean(classification.amountCents && classification.dueDate && classification.supplierName)
  )) {
    const incomingBarcodeHash = paymentBarcodeHash(classification.barcode);
    const [openSnapshot, paymentSnapshot, barcodeHashPaymentSnapshot, legacyBarcodePaymentSnapshot] = await Promise.all([
      financialDbAdmin.collection("expenses")
      .where("status", "in", ["pending", "partially_paid"])
      .limit(MAX_EXISTING_EXPENSE_CANDIDATES + 1)
      .get(),
      classification.amountCents
        ? financialDbAdmin.collection("payments")
          .where("principalAmountCents", "==", classification.amountCents)
          .limit(MAX_MATCHED_PAYMENT_CANDIDATES + 1)
          .get()
        : Promise.resolve(null),
      classification.barcode
        ? financialDbAdmin.collection("bankPaymentRequests")
          .where("barcodeSnapshot.codeHash", "==", incomingBarcodeHash)
          .limit(MAX_MATCHED_BARCODE_PAYMENT_CANDIDATES + 1)
          .get()
        : Promise.resolve(null),
      classification.barcode
        ? financialDbAdmin.collection("bankPaymentRequests")
          .where("barcodeSnapshot.code", "==", classification.barcode)
          .limit(MAX_MATCHED_BARCODE_PAYMENT_CANDIDATES + 1)
          .get()
        : Promise.resolve(null),
    ]);
    expenseScanTruncated = openSnapshot.size > MAX_EXISTING_EXPENSE_CANDIDATES
      || Boolean(paymentSnapshot && paymentSnapshot.size > MAX_MATCHED_PAYMENT_CANDIDATES)
      || Boolean(barcodeHashPaymentSnapshot && barcodeHashPaymentSnapshot.size > MAX_MATCHED_BARCODE_PAYMENT_CANDIDATES)
      || Boolean(legacyBarcodePaymentSnapshot && legacyBarcodePaymentSnapshot.size > MAX_MATCHED_BARCODE_PAYMENT_CANDIDATES);
    if (!expenseScanTruncated) {
      const evidenceByExpenseId = new Map<string, Array<{ transactionId: string; paidAt: string | null }>>();
      const barcodeEvidenceByExpenseId = new Map<string, Array<{
        code: string;
        installmentNumber: number | null;
        payment: { transactionId: string; bankStatus: string | null; schedulingStatus: string | null; scheduledFor: string | null };
      }>>();
      for (const document of paymentSnapshot?.docs ?? []) {
        const payment = document.data();
        const expenseId = String(payment.expenseId ?? "").trim();
        const transactionId = String(payment.bankTransactionId ?? "").trim();
        if (!expenseId || !transactionId || payment.status !== "MATCHED" || payment.evidenceSource !== "BANK_STATEMENT") continue;
        const paidAt = isoDateKey(payment.paidAt);
        evidenceByExpenseId.set(expenseId, [
          ...(evidenceByExpenseId.get(expenseId) ?? []),
          { transactionId, paidAt },
        ]);
      }
      const barcodePaymentDocuments = new Map([
        ...(barcodeHashPaymentSnapshot?.docs ?? []),
        ...(legacyBarcodePaymentSnapshot?.docs ?? []),
      ].map((document) => [document.id, document]));
      for (const document of barcodePaymentDocuments.values()) {
        const payment = document.data();
        const expenseId = String(payment.expenseId ?? "").trim();
        const code = String(payment.barcodeSnapshot?.code ?? "").trim();
        const codeHash = String(payment.barcodeSnapshot?.codeHash || paymentBarcodeHash(code) || "");
        const status = String(payment.status ?? "").trim();
        if (!expenseId || !code || !incomingBarcodeHash || codeHash !== incomingBarcodeHash
          || /^(?:cancelled|rejected|failed|approval_expired)$/.test(status)) continue;
        barcodeEvidenceByExpenseId.set(expenseId, [
          ...(barcodeEvidenceByExpenseId.get(expenseId) ?? []),
          {
            code,
            installmentNumber: Number.isInteger(Number(payment.installmentNumber))
              && Number(payment.installmentNumber) > 0
              ? Number(payment.installmentNumber)
              : null,
            payment: {
              transactionId: String(payment.interRequestId ?? document.id),
              bankStatus: typeof payment.bankStatus === "string" ? payment.bankStatus : null,
              schedulingStatus: status || null,
              scheduledFor: typeof payment.barcodeSnapshot?.scheduledFor === "string"
                ? payment.barcodeSnapshot.scheduledFor
                : null,
            },
          },
        ]);
      }
      const openById = new Map(openSnapshot.docs.map((document) => [document.id, document]));
      const missingPaidRefs = [...new Set([
        ...evidenceByExpenseId.keys(),
        ...barcodeEvidenceByExpenseId.keys(),
      ])]
        .filter((expenseId) => !openById.has(expenseId))
        .map((expenseId) => financialDbAdmin.collection("expenses").doc(expenseId));
      const paidSnapshots = missingPaidRefs.length ? await financialDbAdmin.getAll(...missingPaidRefs) : [];
      expenseCandidates = [...openSnapshot.docs, ...paidSnapshots.filter((document) => document.exists)]
        .map((document) => ({
          id: document.id,
          ...document.data(),
          settlementEvidence: evidenceByExpenseId.get(document.id) ?? null,
          bankPaymentEvidence: barcodeEvidenceByExpenseId.get(document.id) ?? null,
        }));
    }
  }
  const existingExpenseSuggestion = chooseExistingExpenseSuggestion(classification, expenseCandidates);
  if (expenseScanTruncated) {
    existingExpenseSuggestion.status = "ambiguous";
    existingExpenseSuggestion.reasons = ["há mais despesas abertas do que o limite seguro da análise"];
  }

  let candidates: ProvisionCandidate[] = [];
  if (existingExpenseSuggestion.status !== "suggested" && classification.financeLikely && classification.competence) {
    const snapshot = await financialDbAdmin.collection("expenses")
      .where("provisionType", "==", "forecast")
      .where("status", "==", "provisioned")
      .where("provisionCompetence", "==", classification.competence)
      .limit(MAX_PROVISION_CANDIDATES)
      .get();
    candidates = snapshot.docs.map((document) => ({ id: document.id, ...document.data() }));
  }
  const suggestion = chooseProvisionSuggestion(classification, candidates, checkedAt);
  const creationSuggestion = chooseCreationSuggestion({
    subject: message.subject,
    classification,
    existingExpenseSuggestion,
    provisionSuggestion: suggestion,
  });
  const analysisCanResolve = ["pending_review", "document_pending", "suggestion_available"].includes(message.status);
  const automationSettings = analysisCanResolve && existingExpenseSuggestion.automaticLinkEligible === true
    ? await getFinancialInboxAutomationSettings(message.workspaceId)
    : defaultFinancialInboxAutomationSettings();
  const automaticIdentificationAllowed = shouldAutomaticallyIdentifyInboxCharge({
    settings: automationSettings,
    suggestion: existingExpenseSuggestion,
  });
  const automaticReminder = classification.marketingLikely || !analysisCanResolve
    ? null
    : automaticIdentificationAllowed
      ? automaticReminderResolutionPatch({ suggestion: existingExpenseSuggestion, at: checkedAt })
      : null;
  const nextResolution = automaticReminder?.resolution
    ?? (classification.marketingLikely && analysisCanResolve
      ? discardedFinancialInboxResolution({
          mode: "automatic",
          at: checkedAt,
          by: "system:financial-inbox",
          reasons: ["mensagem classificada como conteúdo não financeiro"],
        })
      : analysisCanResolve
        ? pendingFinancialInboxResolution()
        : resolutionForDisplay(message));
  const nextStatus = classification.marketingLikely
    ? "ignored"
    : automaticReminder
      ? automaticReminder.status
    : existingExpenseSuggestion.status === "suggested"
      || suggestion.status === "suggested"
      || creationSuggestion.status === "suggested"
      ? "suggestion_available"
      : message.status === "document_pending"
        && documents.attachments.some((attachment) => ["extracted", "ocr_extracted"].includes(attachment.extractionStatus ?? ""))
        ? "pending_review"
        : message.status;
  const persistedStatus = ["pending_review", "document_pending", "suggestion_available"].includes(message.status)
    ? nextStatus
    : message.status;
  const messageRef = financialDbAdmin.collection("financialInboxMessages").doc(id);
  const batch = financialDbAdmin.batch();
  batch.set(messageRef, {
    classification,
    searchTerms: buildFinancialInboxSearchTerms({ ...message, classification }),
    searchIndexVersion: FINANCIAL_INBOX_SEARCH_INDEX_VERSION,
    searchIndexedAt: checkedAt,
    attachments: documents.attachments,
    archiveWarnings: [...new Set([...(message.archiveWarnings ?? []), ...documents.warnings])],
    linkResolution: documents.linkResolution,
    existingExpenseSuggestion,
    provisionSuggestion: suggestion,
    creationSuggestion,
    status: persistedStatus,
    resolution: nextResolution,
    resolutionContractVersion: FINANCIAL_INBOX_RESOLUTION_VERSION,
    ...(automaticReminder ? {
      bankState: automaticReminder.bankState,
    } : {}),
    updatedAt: checkedAt,
  }, { merge: true });
  if (persistedStatus === "ignored" && message.status !== "ignored" && classification.marketingLikely) {
    batch.set(messageRef.collection("events").doc("auto-marketing-v1"), {
      type: "MESSAGE_AUTO_IGNORED_MARKETING",
      at: checkedAt,
      actorId: "system:financial-inbox",
    }, { merge: true });
  }
  if (automaticReminder) {
    const targetExpense = expenseCandidates.find((candidate) => candidate.id === automaticReminder.resolution.targetId);
    if (targetExpense) {
      const obligationId = String((targetExpense as Record<string, unknown>).obligationId || `obl_${targetExpense.id}`);
      const billingIdentity = mergeBillingIdentities(
        targetExpense.billingIdentity ?? {
          supplierTaxId: null,
          customerAccount: null,
          contractNumber: null,
          serviceType: null,
          serviceNumbers: [],
        },
        [classification.billingIdentity],
      );
      const documentIdentity = mergeFinancialDocumentIdentities(
        targetExpense.documentIdentity,
        financialDocumentIdentityFromClassification(classification, id),
      );
      const targetInstallmentNumber = automaticReminder.resolution.installmentNumber;
      const targetInstallments = Array.isArray(targetExpense.installments)
        ? targetExpense.installments as Array<Record<string, unknown>>
        : [];
      const enrichedInstallments = targetInstallmentNumber == null
        ? targetInstallments
        : targetInstallments.map((installment, index) => (
          Number(installment.number ?? index + 1) === targetInstallmentNumber
            ? {
                ...installment,
                documentIdentity: mergeFinancialDocumentIdentities(
                  installment.documentIdentity,
                  financialDocumentIdentityFromClassification(classification, id),
                ),
              }
            : installment
        ));
      batch.set(financialDbAdmin.collection("expenses").doc(targetExpense.id), {
        aliases: mergeExpenseAliases((targetExpense as Record<string, unknown>).aliases, message.subject),
        billingIdentity,
        documentIdentity,
        fiscalIdentity: classification.fiscalIdentity ?? targetExpense.fiscalIdentity ?? null,
        ...(targetInstallmentNumber == null ? {} : { installments: enrichedInstallments }),
        updatedAt: checkedAt,
      }, { merge: true });
      const primaryMessageId = String((targetExpense as Record<string, unknown>).financialInboxMessageId || id);
      const primaryMessageSnapshot = primaryMessageId === id
        ? null
        : await financialDbAdmin.collection("financialInboxMessages").doc(primaryMessageId).get();
      const primaryMessage = primaryMessageSnapshot?.exists
        ? { id: primaryMessageSnapshot.id, ...primaryMessageSnapshot.data() } as FinancialInboxMessage
        : null;
      const currentThreadMessage = inboxThreadMessage({
        ...message,
        status: automaticReminder.status,
        resolution: automaticReminder.resolution,
      });
      const threadMessages = mergeInboxThreadMessages(
        primaryMessage?.thread?.messages,
        primaryMessage ? [inboxThreadMessage(primaryMessage)] : [],
        [currentThreadMessage],
      );
      const thread = { primaryMessageId, messageCount: threadMessages.length, messages: threadMessages };
      batch.set(messageRef, {
        obligationId,
        thread,
      }, { merge: true });
      if (primaryMessageId !== id) {
        batch.set(financialDbAdmin.collection("financialInboxMessages").doc(primaryMessageId), {
          thread,
          updatedAt: checkedAt,
        }, { merge: true });
      }
      batch.set(financialDbAdmin.collection("financialObligations").doc(obligationId), {
        id: obligationId,
        billingIdentity,
        documentIdentity,
        fiscalIdentity: classification.fiscalIdentity ?? targetExpense.fiscalIdentity ?? null,
        primaryInboxMessageId: primaryMessageId,
        inboxMessageIds: FieldValue.arrayUnion(primaryMessageId, id),
        inboxMessageSummaries: threadMessages,
        updatedAt: checkedAt,
      }, { merge: true });
    }
    batch.set(messageRef.collection("events").doc("automatic-reminder-identification-v1"), {
      type: "CHARGE_IDENTIFIED_AS_EXISTING",
      at: checkedAt,
      actorId: "system:financial-inbox",
      expenseId: automaticReminder.resolution.targetId,
      installmentNumber: automaticReminder.resolution.installmentNumber,
      financialState: automaticReminder.resolution.financialState,
      reasons: automaticReminder.resolution.reasons,
      automationMode: automationSettings.mode,
      automationPolicyVersion: automationSettings.policyVersion,
      resolutionOnly: true,
    }, { merge: true });
  }
  await batch.commit();
  return {
    ...message,
    classification,
    attachments: documents.attachments,
    archiveWarnings: [...new Set([...(message.archiveWarnings ?? []), ...documents.warnings])],
    linkResolution: documents.linkResolution,
    existingExpenseSuggestion,
    provisionSuggestion: suggestion,
    creationSuggestion,
    status: persistedStatus,
    resolution: nextResolution,
    ...(automaticReminder ? {
      bankState: automaticReminder.bankState,
    } : {}),
  } as FinancialInboxMessage;
}

export async function linkSuggestedInboxCharge(id: string, actor: PaymentActor, expectedWorkspaceId: string) {
  const analyzedMessage = await getFinancialInboxMessage(id);
  if (analyzedMessage.workspaceId !== expectedWorkspaceId) throw new Error("Cobrança recebida não encontrada.");
  if (analyzedMessage.existingExpenseSuggestion?.status === "suggested"
    && analyzedMessage.existingExpenseSuggestion.expenseId) {
    return linkInboxChargeToExistingExpense(
      id,
      analyzedMessage.existingExpenseSuggestion.expenseId,
      actor,
      expectedWorkspaceId,
      analyzedMessage.existingExpenseSuggestion.installmentNumber,
    );
  }
  const messageRef = financialDbAdmin.collection("financialInboxMessages").doc(id);
  const actualRef = financialDbAdmin.collection("expenses").doc(`inbox_${id}`);
  const now = Timestamp.now();
  const nowIso = now.toDate().toISOString();

  return financialDbAdmin.runTransaction(async (transaction) => {
    const messageSnapshot = await transaction.get(messageRef);
    if (!messageSnapshot.exists) throw new Error("Cobrança recebida não encontrada.");
    const message = { id: messageSnapshot.id, ...messageSnapshot.data() } as FinancialInboxMessage;
    if (message.workspaceId !== expectedWorkspaceId) throw new Error("Cobrança recebida não encontrada.");
    if (message.linkedExpenseId) return { message, expenseId: message.linkedExpenseId, duplicate: true };
    const provisionId = message.provisionSuggestion?.status === "suggested"
      ? message.provisionSuggestion.provisionExpenseId
      : null;
    if (!provisionId) throw new Error("A cobrança não possui uma sugestão única de provisionamento.");
    if (message.classification.amountCents == null || message.classification.amountCents <= 0) {
      throw new Error("Confirme o valor da cobrança antes de vinculá-la.");
    }
    const provisionRef = financialDbAdmin.collection("expenses").doc(provisionId);
    const provisionSnapshot = await transaction.get(provisionRef);
    if (!provisionSnapshot.exists) throw new Error("O provisionamento sugerido não existe mais.");
    const provision = provisionSnapshot.data() as Record<string, unknown>;
    if (provision.provisionType !== "forecast" || provision.status !== "provisioned") {
      throw new Error("O provisionamento sugerido já foi tratado. Analise novamente a cobrança.");
    }
    if (provision.provisionCompetence !== message.classification.competence) {
      throw new Error("A competência da cobrança diverge do provisionamento.");
    }
    if (["tax", "fgts", "inss_darf"].includes(message.classification.documentType)
      && !message.classification.fiscalIdentity) {
      throw new Error("Reanalise o documento fiscal antes de vincular a cobrança à previsão.");
    }
    const provisionMatch = scoreProvisionCandidate(message.classification, {
      id: provisionId,
      ...provision,
    });
    if (!provisionMatch.eligible || provisionMatch.score < 50) {
      throw new Error("A natureza fiscal do documento não corresponde à previsão sugerida. Reanalise a cobrança.");
    }

    const actualValue = money(message.classification.amountCents / 100);
    const provisionedValue = money(provision.totalValue);
    const variance = money(actualValue - provisionedValue);
    const obligationId = String(provision.obligationId || `obl_${provisionId}`);
    const dueDate = dateTimestamp(message.classification.dueDate, now.toDate());
    const competenceDate = dateTimestamp(
      message.classification.competence ? `${message.classification.competence}-01` : null,
      dueDate.toDate(),
    );
    const supplier = message.classification.supplierName || String(provision.supplier || "");
    const description = String(provision.description || message.subject).trim();
    const aliases = mergeExpenseAliases(provision.aliases, message.subject);
    const documentIdentity = financialDocumentIdentityFromClassification(message.classification, id);
    const initialResolution = identifiedFinancialInboxResolution({
      kind: "new_charge",
      targetType: "expense",
      targetId: actualRef.id,
      financialState: "open",
      mode: "manual",
      confidence: message.provisionSuggestion?.confidence ?? null,
      reasons: message.provisionSuggestion?.reasons ?? [],
      at: nowIso,
      by: actor.uid,
    });
    const initialThreadMessage = inboxThreadMessage({
      ...message,
      status: "linked",
      resolution: initialResolution,
    });
    const actual = {
      ...copyExpenseClassification(provision),
      ...inheritExpenseReferenceCenter({}, provision),
      ...financialExpenseAccountingFields({
        competenceMonth: message.classification.competence,
        competenceDate,
      }),
      workspaceId: WORKSPACE_ID,
      description,
      aliases,
      supplier,
      notes: `Cobrança recebida por e-mail: ${message.subject}`,
      totalValue: actualValue,
      competenceDate,
      dueDate,
      paymentMethod: "single",
      installments: [{ number: 1, dueDate, value: actualValue, status: "pending" }],
      provisionType: "actual",
      provisionCompetence: message.classification.competence,
      obligationId,
      reconciledProvisionId: provisionId,
      provisionReconciliationStatus: "reconciled",
      provisionedValue,
      provisionVariance: variance,
      provisionReconciledAt: now,
      provisionReconciledBy: actor.uid,
      originModule: "financial_inbox",
      financialInboxMessageId: id,
      billingIdentity: message.classification.billingIdentity ?? null,
      documentIdentity,
      fiscalIdentity: message.classification.fiscalIdentity ?? null,
      status: "pending",
      createdAt: now,
      createdBy: actor.uid,
      updatedAt: now,
    };
    const summary = calculateFinancialObligationSummary({
      forecastAmountCents: Math.round(provisionedValue * 100),
      actualAmountCents: message.classification.amountCents,
      settlementAmountCents: message.classification.amountCents,
    });
    transaction.create(actualRef, actual);
    transaction.set(provisionRef, {
      obligationId,
      status: "reconciled",
      replacedByExpenseId: actualRef.id,
      actualValue,
      provisionVariance: variance,
      provisionReconciliationStatus: "reconciled",
      provisionReconciledAt: now,
      provisionReconciledBy: actor.uid,
      updatedAt: now,
    }, { merge: true });
    transaction.set(financialDbAdmin.collection("financialObligations").doc(obligationId), {
      seriesKey: provision.provisionSeriesKey || null,
      competenceKey: message.classification.competence,
      sourceType: "financial_inbox",
      sourceId: id,
      supplierName: supplier || null,
      billingIdentity: message.classification.billingIdentity ?? null,
      documentIdentity,
      fiscalIdentity: message.classification.fiscalIdentity ?? null,
      primaryInboxMessageId: id,
      inboxMessageIds: FieldValue.arrayUnion(id),
      inboxMessageSummaries: [initialThreadMessage],
      status: summary.obligationStatus,
      reconciliationStatus: summary.reconciliationStatus,
      summary,
      forecastExpenseId: provisionId,
      actualExpenseId: actualRef.id,
      createdAt: provision.createdAt || now,
      updatedAt: now,
    }, { merge: true });
    transaction.set(messageRef, {
      status: "linked",
      linkedExpenseId: actualRef.id,
      linkedProvisionId: provisionId,
      obligationId,
      resolution: initialResolution,
      thread: { primaryMessageId: id, messageCount: 1, messages: [initialThreadMessage] },
      resolutionContractVersion: FINANCIAL_INBOX_RESOLUTION_VERSION,
      "provisionSuggestion.status": "linked",
      reviewedAt: nowIso,
      reviewedBy: actor.uid,
      updatedAt: nowIso,
    }, { merge: true });
    transaction.create(messageRef.collection("events").doc(), {
      type: "CHARGE_LINKED_TO_PROVISION",
      at: nowIso,
      actorId: actor.uid,
      actorEmail: actor.email ?? null,
      expenseId: actualRef.id,
      provisionExpenseId: provisionId,
      obligationId,
      actualValue,
      provisionedValue,
      variance,
    });
    return { message: { ...message, linkedExpenseId: actualRef.id }, expenseId: actualRef.id, duplicate: false };
  });
}

function inboxStateForExistingMatch(
  settlement: FinancialInboxMessage["existingSettlement"],
  payment: FinancialInboxMessage["existingBankPayment"],
) {
  if (settlement) return { status: "reconciled" as const, bankState: "reconciled" as const };
  if (!payment) return { status: "linked" as const, bankState: "not_prepared" as const };
  const state = `${payment.schedulingStatus ?? ""} ${payment.bankStatus ?? ""}`.toLowerCase();
  if (/aguardando[_\s-]*(?:aprova|autoriza)|awaiting[_\s-]*(?:approval|authorization)/.test(state)) {
    return { status: "awaiting_authorization" as const, bankState: "awaiting_bank_approval" as const };
  }
  if (/agendad|scheduled/.test(state)) return { status: "scheduled" as const, bankState: "scheduled" as const };
  if (/process|execut|paid|pago|conclu/.test(state)) {
    return { status: "awaiting_statement" as const, bankState: "awaiting_statement" as const };
  }
  return { status: "linked" as const, bankState: "not_prepared" as const };
}

export async function linkInboxChargeToExistingExpense(
  id: string,
  expenseId: string,
  actor: PaymentActor,
  expectedWorkspaceId: string,
  installmentNumber: number | null = null,
  resolutionOnly = false,
) {
  const messageRef = financialDbAdmin.collection("financialInboxMessages").doc(id);
  const expenseRef = financialDbAdmin.collection("expenses").doc(expenseId);
  const now = new Date().toISOString();
  return financialDbAdmin.runTransaction(async (transaction) => {
    const [messageSnapshot, expenseSnapshot] = await Promise.all([
      transaction.get(messageRef),
      transaction.get(expenseRef),
    ]);
    if (!messageSnapshot.exists) throw new Error("Cobrança recebida não encontrada.");
    if (!expenseSnapshot.exists) throw new Error("Despesa não encontrada.");
    const message = { id: messageSnapshot.id, ...messageSnapshot.data() } as FinancialInboxMessage;
    if (message.workspaceId !== expectedWorkspaceId) throw new Error("Cobrança recebida não encontrada.");
    const expense = expenseSnapshot.data() || {};
    if (message.linkedExpenseId && message.linkedExpenseId !== expenseId) {
      throw new Error("A cobrança já está vinculada a outra despesa.");
    }
    if (resolutionOnly
      && message.resolution?.status === "identified"
      && message.resolution.targetId
      && message.resolution.targetId !== expenseId) {
      throw new Error("A cobrança já foi identificada com outro lançamento.");
    }
    if (resolutionOnly
      && message.resolution?.status === "identified"
      && message.resolution.targetId === expenseId
      && message.resolution.installmentNumber === installmentNumber) {
      return { message, expenseId, duplicate: true };
    }
    if (expense.provisionType === "forecast") throw new Error("A cobrança deve ser vinculada à despesa real, não à previsão.");
    if (["tax", "fgts", "inss_darf"].includes(message.classification.documentType)
      && !message.classification.fiscalIdentity) {
      throw new Error("Reanalise o documento fiscal antes de vinculá-lo a uma despesa.");
    }
    const reevaluatedSuggestion = chooseExistingExpenseSuggestion(message.classification, [{ id: expenseId, ...expense }]);
    const selectedAlternative = reevaluatedSuggestion.alternatives?.find((alternative) => (
      alternative.expenseId === expenseId
      && alternative.installmentNumber === installmentNumber
    )) ?? null;
    if (installmentNumber != null && !selectedAlternative) {
      throw new Error("A parcela selecionada não corresponde mais à cobrança. Analise novamente.");
    }
    const exactSuggestion = reevaluatedSuggestion.status === "suggested"
      && reevaluatedSuggestion.installmentNumber === installmentNumber
      ? reevaluatedSuggestion
      : null;
    if (resolutionOnly && !exactSuggestion && !selectedAlternative) {
      throw new Error("A despesa selecionada não corresponde mais à cobrança. Analise novamente.");
    }
    const installments = Array.isArray(expense.installments)
      ? expense.installments as Array<Record<string, unknown>>
      : [];
    const installmentIndex = installmentNumber == null
      ? -1
      : installments.findIndex((installment, index) => Number(installment.number ?? index + 1) === installmentNumber);
    if (installmentNumber != null && installmentIndex < 0) throw new Error("A parcela sugerida não existe mais.");
    const targetInstallment = installmentIndex >= 0 ? installments[installmentIndex] : null;
    if (!resolutionOnly
      && message.linkedExpenseId === expenseId
      && (installmentNumber == null || message.linkedExpenseInstallmentNumber === installmentNumber)) {
      return { message, expenseId, duplicate: true };
    }
    if (!resolutionOnly && targetInstallment?.financialInboxMessageId && targetInstallment.financialInboxMessageId !== id) {
      throw new Error("A parcela já está vinculada a outra cobrança recebida.");
    }
    if (!resolutionOnly && installmentNumber == null && expense.financialInboxMessageId && expense.financialInboxMessageId !== id) {
      throw new Error("A despesa já está vinculada a outra cobrança recebida.");
    }
    const obligationId = String(expense.obligationId || `obl_${expenseId}`);
    const obligationRef = financialDbAdmin.collection("financialObligations").doc(obligationId);
    const obligationSnapshot = await transaction.get(obligationRef);
    const obligation = obligationSnapshot.data() || {};
    const primaryMessageId = String(obligation.primaryInboxMessageId || expense.financialInboxMessageId || id);
    const primaryMessageRef = financialDbAdmin.collection("financialInboxMessages").doc(primaryMessageId);
    const primaryMessageSnapshot = primaryMessageId === id ? messageSnapshot : await transaction.get(primaryMessageRef);
    const primaryMessage = primaryMessageSnapshot.exists
      ? { id: primaryMessageSnapshot.id, ...primaryMessageSnapshot.data() } as FinancialInboxMessage
      : null;
    const expenseDateKey = (value: unknown, competence = false) => {
      const date = value && typeof (value as { toDate?: unknown }).toDate === "function"
        ? (value as { toDate: () => Date }).toDate()
        : value ? new Date(value as string | number | Date) : null;
      if (!date || Number.isNaN(date.getTime())) return null;
      const iso = date.toISOString().slice(0, 10);
      return competence ? iso.slice(0, 7) : iso;
    };
    const classificationSource = exactSuggestion?.status === "suggested" ? exactSuggestion : selectedAlternative;
    const classification = {
      ...message.classification,
      supplierName: message.classification.supplierName || String(expense.supplier || "") || null,
      amountCents: message.classification.amountCents == null && Number(classificationSource?.amountCents ?? expense.totalValue) > 0
        ? Math.round(Number(classificationSource?.amountCents ?? Number(expense.totalValue) * 100))
        : message.classification.amountCents,
      dueDate: message.classification.dueDate || classificationSource?.dueDate || expenseDateKey(expense.dueDate),
      competence: message.classification.competence || expenseDateKey(expense.competenceDate, true),
    };
    const directSettlementId = String(targetInstallment?.linkedBankTransactionId ?? "").trim();
    const existingSettlement = exactSuggestion?.existingSettlement
      ?? (directSettlementId ? { transactionId: directSettlementId, paidAt: isoDateKey(targetInstallment?.paidAt) } : null);
    const existingBankPayment = exactSuggestion?.existingBankPayment
      ?? (existingSettlement || !targetInstallment ? null : existingPayment(targetInstallment));
    const inboxState = inboxStateForExistingMatch(existingSettlement, existingBankPayment);
    const billingIdentity = mergeBillingIdentities(
      (expense.billingIdentity as FinancialInboxMessage["classification"]["billingIdentity"]) ?? {
        supplierTaxId: null,
        customerAccount: null,
        contractNumber: null,
        serviceType: null,
        serviceNumbers: [],
      },
      [message.classification.billingIdentity],
    );
    const documentIdentity = mergeFinancialDocumentIdentities(
      expense.documentIdentity ?? obligation.documentIdentity,
      financialDocumentIdentityFromClassification(classification, id),
    );
    const fiscalIdentity = message.classification.fiscalIdentity
      ?? expense.fiscalIdentity
      ?? obligation.fiscalIdentity
      ?? null;
    const identityPatch = {
      aliases: mergeExpenseAliases(expense.aliases, message.subject),
      billingIdentity,
      documentIdentity,
      fiscalIdentity,
      updatedAt: Timestamp.now(),
    };
    if (!resolutionOnly && installmentIndex >= 0) {
      const nextInstallments = installments.map((installment, index) => index === installmentIndex
        ? {
            ...installment,
            financialInboxMessageId: id,
            financialInboxLinkedAt: now,
            financialInboxLinkedBy: actor.uid,
            documentIdentity: mergeFinancialDocumentIdentities(
              installment.documentIdentity,
              financialDocumentIdentityFromClassification(classification, id),
            ),
          }
        : installment);
      transaction.set(expenseRef, {
        ...identityPatch,
        installments: nextInstallments,
      }, { merge: true });
    } else if (!resolutionOnly) {
      transaction.set(expenseRef, {
        ...identityPatch,
        financialInboxMessageId: id,
      }, { merge: true });
    } else {
      transaction.set(expenseRef, identityPatch, { merge: true });
    }
    const isNewCharge = !resolutionOnly && (
      expense.financialInboxMessageId === id
      || String(expense.originModule ?? "") === "financial_inbox"
      || Boolean(expense.reconciledProvisionId)
    );
    const financialState = existingSettlement
      ? "reconciled" as const
      : existingBankPayment
        ? inboxState.status === "scheduled" || inboxState.status === "awaiting_statement"
          ? "scheduled" as const
          : "payment_prepared" as const
        : "open" as const;
    const resolution = identifiedFinancialInboxResolution({
      kind: isNewCharge ? "new_charge" : "reminder",
      targetType: "expense",
      targetId: expenseId,
      installmentNumber,
      financialState,
      mode: "manual",
      confidence: classificationSource?.matchStrength === "document" || classificationSource?.matchStrength === "identity"
        ? "high"
        : "medium",
      reasons: classificationSource?.reasons ?? [],
      at: now,
      by: actor.uid,
    });
    const currentThreadMessage = inboxThreadMessage({
      ...message,
      status: resolutionOnly ? "identified" : inboxState.status,
      resolution,
    });
    const primaryThreadMessages = primaryMessage?.thread?.messages
      ?? (primaryMessage ? [inboxThreadMessage(primaryMessage)] : []);
    const threadMessages = mergeInboxThreadMessages(
      obligation.inboxMessageSummaries,
      primaryThreadMessages,
      [currentThreadMessage],
    );
    const thread = { primaryMessageId, messageCount: threadMessages.length, messages: threadMessages };
    transaction.set(obligationRef, {
      id: obligationId,
      billingIdentity,
      documentIdentity,
      fiscalIdentity,
      primaryInboxMessageId: primaryMessageId,
      inboxMessageIds: FieldValue.arrayUnion(id),
      inboxMessageSummaries: threadMessages,
      updatedAt: now,
    }, { merge: true });
    if (primaryMessageId !== id) transaction.set(primaryMessageRef, { thread, updatedAt: now }, { merge: true });
    transaction.set(messageRef, {
      status: resolutionOnly ? "identified" : inboxState.status,
      bankState: inboxState.bankState,
      ...(resolutionOnly ? {} : {
        linkedExpenseId: expenseId,
        linkedExpenseInstallmentNumber: installmentNumber,
      }),
      linkedProvisionId: expense.reconciledProvisionId || null,
      obligationId,
      thread,
      resolution,
      resolutionContractVersion: FINANCIAL_INBOX_RESOLUTION_VERSION,
      classification: { ...classification, billingIdentity },
      searchTerms: buildFinancialInboxSearchTerms({
        ...message,
        classification: { ...classification, billingIdentity },
      }),
      searchIndexVersion: FINANCIAL_INBOX_SEARCH_INDEX_VERSION,
      searchIndexedAt: now,
      existingBankPayment,
      existingSettlement,
      ...(classificationSource ? {
        existingExpenseSuggestion: {
          ...message.existingExpenseSuggestion,
          status: "linked",
          expenseId,
          installmentNumber,
          installmentTotal: classificationSource.installmentTotal,
          description: classificationSource.description,
          supplier: classificationSource.supplier,
          amountCents: classificationSource.amountCents,
          dueDate: classificationSource.dueDate,
          reasons: classificationSource.reasons,
          paymentState: existingSettlement ? "paid" : existingBankPayment ? "scheduled" : "needs_scheduling",
          existingBankPayment,
          existingSettlement,
        },
      } : {}),
      reviewedAt: now,
      reviewedBy: actor.uid,
      updatedAt: now,
    }, { merge: true });
    transaction.create(messageRef.collection("events").doc(), {
      type: resolutionOnly
        ? "CHARGE_IDENTIFIED_AS_EXISTING"
        : installmentNumber == null
          ? "CHARGE_LINKED_MANUALLY"
          : "CHARGE_LINKED_TO_EXISTING_INSTALLMENT",
      at: now,
      actorId: actor.uid,
      actorEmail: actor.email ?? null,
      expenseId,
      installmentNumber,
      bankPaymentTransactionId: existingBankPayment?.transactionId ?? null,
      statementTransactionId: existingSettlement?.transactionId ?? null,
      obligationId,
      resolutionOnly,
    });
    return {
      message: {
        ...message,
        status: resolutionOnly ? "identified" as const : inboxState.status,
        resolution,
        ...(resolutionOnly ? {} : { linkedExpenseId: expenseId }),
      },
      expenseId,
      duplicate: resolutionOnly
        ? message.resolution?.targetId === expenseId
        : message.linkedExpenseId === expenseId,
    };
  });
}
