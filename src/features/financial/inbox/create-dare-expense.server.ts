import "server-only";
import { Timestamp } from "firebase-admin/firestore";

import { financialDbAdmin } from "@/lib/firebase-financial-admin";
import { WORKSPACE_ID } from "@/lib/workspace";
import { financialExpenseAccountingFields } from "@/features/financial/lib/expense-accounting-contract";

import { confirmFinancialInboxDocument } from "./confirmed-document";
import { financialDocumentIdentityFromClassification, paymentBarcodeHash } from "./document-identity";
import { inboxDareExpenseFingerprint, type InboxDareExpenseInput } from "./expense-create-contract";
import type { FinancialInboxMessage } from "./types";

function catalogInWorkspace(value: Record<string, unknown>, workspaceId: string) {
  return String(value.workspaceId ?? WORKSPACE_ID) === workspaceId;
}

export async function createInboxDareExpense(params: {
  inboxId: string;
  workspaceId: string;
  actor: { uid: string; email?: string | null };
  input: InboxDareExpenseInput;
}) {
  const { inboxId, workspaceId, input } = params;
  const expenseId = `inbox_${inboxId}`;
  const fingerprint = inboxDareExpenseFingerprint(input);
  const inboxRef = financialDbAdmin.collection("financialInboxMessages").doc(inboxId);
  const expenseRef = financialDbAdmin.collection("expenses").doc(expenseId);
  const accountRef = financialDbAdmin.collection("accounts").doc(input.accountPlanId);
  const centerIds = [input.referenceResultCenterId, ...input.apportionments.map((entry) => entry.resultCenterId)];
  const uniqueCenterIds = [...new Set(centerIds)];
  const centerRefs = uniqueCenterIds.map((id) => financialDbAdmin.collection("resultCenters").doc(id));
  const barcodeHash = paymentBarcodeHash(input.documentConfirmation.barcode);
  if (!barcodeHash) throw new Error("A guia não possui código válido.");

  return financialDbAdmin.runTransaction(async (transaction) => {
    const [inboxSnapshot, expenseSnapshot, accountSnapshot, accountChildren, centerSnapshots,
      sameSource, sameCode] = await Promise.all([
      transaction.get(inboxRef),
      transaction.get(expenseRef),
      transaction.get(accountRef),
      transaction.get(financialDbAdmin.collection("accounts").where("parentId", "==", input.accountPlanId).limit(1)),
      transaction.getAll(...centerRefs),
      transaction.get(financialDbAdmin.collection("expenses").where("financialInboxMessageId", "==", inboxId).limit(2)),
      transaction.get(financialDbAdmin.collection("expenses").where("documentIdentity.barcodeHash", "==", barcodeHash).limit(2)),
    ]);
    if (!inboxSnapshot.exists || inboxSnapshot.get("workspaceId") !== workspaceId) throw new Error("Cobrança não encontrada.");
    const message = { id: inboxId, ...inboxSnapshot.data() } as FinancialInboxMessage;
    if (message.linkedExpenseId && message.linkedExpenseId !== expenseId) throw new Error("Cobrança já vinculada a outra despesa.");
    const attachment = message.attachments.find((entry) => entry.id === input.sourceAttachmentId);
    if (!attachment || attachment.archiveStatus !== "stored" || attachment.contentType !== "application/pdf"
      || attachment.sha256 !== input.sourceAttachmentSha256 || !attachment.storagePath) {
      throw new Error("O PDF arquivado da guia mudou ou não está disponível.");
    }
    const classification = confirmFinancialInboxDocument(message.classification, input.documentConfirmation);
    if (classification.fiscalIdentity?.documentKind !== "dare"
      || classification.fiscalIdentity.taxpayerTaxId !== input.documentConfirmation.fiscalIdentity.taxpayerTaxId
      || classification.amountCents !== input.documentConfirmation.amountCents) {
      throw new Error("A confirmação fiscal da guia diverge do documento.");
    }
    if (sameSource.docs.some((document) => document.id !== expenseId)
      || sameCode.docs.some((document) => document.id !== expenseId)) {
      throw new Error("A cobrança ou linha digitável já consta em outra despesa.");
    }
    if (expenseSnapshot.exists) {
      if (expenseSnapshot.get("workspaceId") !== workspaceId
        || expenseSnapshot.get("inboxCreationFingerprint") !== fingerprint
        || expenseSnapshot.get("financialInboxMessageId") !== inboxId) {
        throw new Error("A despesa existente diverge da criação confirmada.");
      }
      return { expenseId, duplicate: true };
    }
    if (message.linkedExpenseId || message.paymentRequestId
      || !["document_pending", "pending_review", "suggestion_available"].includes(message.status)) {
      throw new Error("A cobrança já foi tratada; confira a caixa antes de criar a despesa.");
    }
    const account = accountSnapshot.data() as Record<string, unknown> | undefined;
    if (!account || account.active !== true || account.isGroup === true || !accountChildren.empty
      || !catalogInWorkspace(account, workspaceId)) {
      throw new Error("Selecione uma subconta ativa e final do plano de contas.");
    }
    const centers = new Map(centerSnapshots.map((snapshot) => [snapshot.id, snapshot.data() as Record<string, unknown> | undefined]));
    if (uniqueCenterIds.some((id) => {
      const center = centers.get(id);
      return !center || center.active === false || !catalogInWorkspace(center, workspaceId) || !String(center.name ?? "").trim();
    })) {
      throw new Error("Um dos centros de resultado está inativo ou fora do workspace.");
    }
    const apportionments = input.apportionments.map((entry) => ({
      resultCenter: String(centers.get(entry.resultCenterId)?.name),
      percentage: entry.percentage,
    }));
    if (new Set(apportionments.map((entry) => entry.resultCenter)).size !== apportionments.length) {
      throw new Error("O rateio contém centros com o mesmo nome; escolha centros distintos.");
    }
    const now = Timestamp.now();
    const dueDate = Timestamp.fromDate(new Date(`${classification.dueDate}T12:00:00-03:00`));
    const competenceDate = Timestamp.fromDate(new Date(`${classification.competence}-01T12:00:00-03:00`));
    const totalValue = input.documentConfirmation.amountCents / 100;
    const rateioVersionId = `inbox_${inboxId}`;
    const referenceName = String(centers.get(input.referenceResultCenterId)?.name);
    transaction.create(expenseRef, {
      ...financialExpenseAccountingFields({ competenceDate, provisionCompetence: classification.competence }),
      workspaceId,
      description: `DARE — competência ${classification.competence}`,
      supplier: classification.supplierName,
      notes: `Guia recebida na caixa de cobranças: ${message.subject}`,
      totalValue,
      competenceDate,
      dueDate,
      paymentMethod: "single",
      installments: [{ number: 1, dueDate, value: totalValue, status: "pending" }],
      status: "pending",
      provisionType: "actual",
      provisionCompetence: classification.competence,
      accountPlan: input.accountPlanId,
      accountId: input.accountPlanId,
      accountPlanName: String(account.name ?? input.accountPlanId),
      hasAccountAllocations: false,
      accountAllocations: null,
      hasPersonAllocations: false,
      personAllocations: null,
      isApportioned: true,
      resultCenter: null,
      resultCenterId: null,
      resultCenterName: null,
      referenceResultCenterId: input.referenceResultCenterId,
      referenceResultCenterName: referenceName,
      apportionments,
      rateioCriterion: "equal",
      rateioEffectiveFrom: competenceDate,
      rateioFirstMonthMode: "full",
      rateioVersionId,
      rateioPolicy: {
        versionId: rateioVersionId,
        criterion: "equal",
        effectiveFrom: `${classification.competence}-01`,
        firstMonthMode: "full",
        participants: apportionments.map((entry) => ({
          ...entry, participationStartDate: `${classification.competence}-01`,
        })),
      },
      obligationId: `obl_${expenseId}`,
      originModule: "financial_inbox",
      financialInboxMessageId: inboxId,
      inboxCreationFingerprint: fingerprint,
      sourceAttachmentId: input.sourceAttachmentId,
      sourceAttachmentSha256: input.sourceAttachmentSha256,
      billingIdentity: classification.billingIdentity ?? null,
      fiscalIdentity: classification.fiscalIdentity,
      documentIdentity: financialDocumentIdentityFromClassification(classification, inboxId),
      createdBy: params.actor.uid,
      createdAt: now,
      updatedAt: now,
    });
    transaction.create(inboxRef.collection("events").doc(), {
      type: "DARE_EXPENSE_CREATED",
      at: now.toDate().toISOString(),
      actorId: params.actor.uid,
      actorEmail: params.actor.email ?? null,
      expenseId,
      sourceAttachmentId: input.sourceAttachmentId,
      sourceAttachmentSha256: input.sourceAttachmentSha256,
      barcodeHash,
      amountCents: input.documentConfirmation.amountCents,
      competence: classification.competence,
      accountPlanId: input.accountPlanId,
      referenceResultCenterId: input.referenceResultCenterId,
      apportionments,
    });
    return { expenseId, duplicate: false };
  });
}
