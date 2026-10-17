import {
  analyzeFinancialInboxMessage,
  linkInboxChargeToExistingExpense,
  linkSuggestedInboxCharge,
} from "@/features/financial/inbox/workflow.server";
import { getFinancialInboxMessage } from "@/features/financial/inbox/repository.server";
import { WORKSPACE_ID } from "@/lib/workspace";
import {
  authorizeAndSubmitServiceApprovedPayment,
  createInboxBarcodePaymentRequest,
  FinancialServiceApprovalIneligibleError,
} from "./service.server";
import {
  FINANCIAL_SERVICE_APPROVAL_BENEFICIARY_DOCUMENT,
  FINANCIAL_SERVICE_APPROVER_ID,
} from "./service-approval-policy";
import {
  FinancialServiceInboxPreparationIneligibleError,
  planFinancialServiceInboxPreparation,
} from "./service-inbox-orchestration-policy";
import type { PaymentActor } from "./types";

export { FinancialServiceInboxPreparationIneligibleError } from "./service-inbox-orchestration-policy";

const serviceActor: PaymentActor = {
  uid: FINANCIAL_SERVICE_APPROVER_ID,
  email: null,
  name: "Aprovador financeiro do backend",
};

function todayInBelem() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Belem",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

export async function reconcilePrepareAndSubmitServiceApprovedInboxPayment(
  sourceId: string,
  allowedSourceIds: ReadonlySet<string>,
) {
  let message = await analyzeFinancialInboxMessage(sourceId, WORKSPACE_ID);
  const plan = planFinancialServiceInboxPreparation({
    message,
    sourceId,
    allowedSourceIds,
    workspaceId: WORKSPACE_ID,
    today: todayInBelem(),
  });

  if (plan.kind === "existing_expense") {
    await linkInboxChargeToExistingExpense(
      sourceId,
      plan.expenseId!,
      serviceActor,
      WORKSPACE_ID,
      plan.installmentNumber ?? null,
    );
  } else if (plan.kind === "provision") {
    await linkSuggestedInboxCharge(sourceId, serviceActor, WORKSPACE_ID);
  }

  message = await getFinancialInboxMessage(sourceId);
  if (!message.linkedExpenseId) throw new FinancialServiceInboxPreparationIneligibleError("a cobrança não recebeu vínculo com uma despesa");
  const requestId = message.paymentRequestId || (await createInboxBarcodePaymentRequest({
    inboxMessageId: sourceId,
    workspaceId: WORKSPACE_ID,
    scheduledFor: plan.dueDate,
    barcode: plan.barcode,
    beneficiaryDocument: FINANCIAL_SERVICE_APPROVAL_BENEFICIARY_DOCUMENT,
  }, serviceActor)).id;

  try {
    return await authorizeAndSubmitServiceApprovedPayment(requestId, allowedSourceIds);
  } catch (error) {
    if (error instanceof FinancialServiceApprovalIneligibleError) {
      throw new FinancialServiceInboxPreparationIneligibleError(error.message);
    }
    throw error;
  }
}
