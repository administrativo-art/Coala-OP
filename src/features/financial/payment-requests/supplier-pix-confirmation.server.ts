import { dbAdmin } from "@/lib/firebase-admin";
import { financialDbAdmin } from "@/lib/firebase-financial-admin";
import { CnpjValidator } from "@/lib/company/cnpj-validator";
import { AppError } from "@/lib/observability";
import { normalizeBrazilianDocument } from "../beneficiaries/normalization";
import { decryptPaymentDestination } from "../beneficiaries/security.server";
import { supplierNamesAreCompatible } from "../inbox/confirmed-document";
import { reconcileExpenseProvisionOnServer } from "../expense-provision-reconciliation.server";
import { financialExpenseCompetenceMonth } from "../lib/expense-accounting-contract";
import { assertExpenseAllowsNewPayment } from "../lib/source-settlement";
import type { PaymentActor } from "./types";

export type SupplierPixConfirmation = {
  beneficiaryDocument: string;
  competenceMonth: string;
  previousPaidRequestId: string;
  allowExistingBoleto: boolean;
};

export function supplierPixConflict(safeMessage: string): never {
  throw new AppError({ code: "EXPENSE_SUPPLIER_PIX_CONFLICT", kind: "CONFLICT", safeMessage });
}

export async function confirmSupplierPixSource(
  expenseId: string,
  entityId: string,
  amountCents: number,
  workspace: string,
  actor: PaymentActor,
  confirmation: SupplierPixConfirmation,
  assertUnitAccess?: (expense: FirebaseFirestore.DocumentData | undefined) => void,
  onAfterSourceRead?: () => Promise<void>,
) {
  const document = confirmation.beneficiaryDocument;
  if (!CnpjValidator.validate(document).valid) supplierPixConflict("O CNPJ informado é inválido.");
  const expenses = financialDbAdmin.collection("expenses");
  const requests = financialDbAdmin.collection("bankPaymentRequests");
  const payments = financialDbAdmin.collection("payments");
  const entityRef = dbAdmin.collection("entities").doc(entityId);
  const profileRef = financialDbAdmin.collection("supplierPaymentProfiles").doc(entityId);
  const [expense, entity, previous, profile] = await Promise.all([
    expenses.doc(expenseId).get(), entityRef.get(), requests.doc(confirmation.previousPaidRequestId).get(), profileRef.get(),
  ]);
  const data = expense.data();
  assertUnitAccess?.(data);
  await onAfterSourceRead?.();
  const entityData = entity.data();
  const actualId = data?.provisionType === "forecast" ? `supplier_pix_actual_${expenseId}` : expenseId;
  if (actualId !== expenseId && data?.status === "reconciled") {
    assertUnitAccess?.((await expenses.doc(actualId).get()).data());
  }
  if (!data || !entityData || entityData.status === "inactive" || entityData.type !== "pessoa_juridica"
    || !supplierNamesAreCompatible(data.supplier, entityData.name)
    || (data.supplierId && data.supplierId !== entityId)
    || Math.round(Number(data.totalValue) * 100) !== amountCents
    || financialExpenseCompetenceMonth(data) !== confirmation.competenceMonth
    || actualId.length > 150) {
    supplierPixConflict("A despesa, a competência, o valor ou o cadastro do fornecedor divergem da confirmação.");
  }
  assertExpenseAllowsNewPayment(data);
  const workspaceMatches = data.workspaceId === workspace
    || (!data.workspaceId && data.provisionType === "forecast"
      && data.sourceType === "recurring_expense_forecast" && Boolean(data.unitId));
  if (!workspaceMatches || data.paidAt || data.linkedBankTransactionId || data.financialInboxMessageId
    || data.paymentState === "paid" || !["pending", "provisioned", "reconciled"].includes(data.status)
    || (data.provisionType === "forecast" ? !["provisioned", "reconciled"].includes(data.status) : data.status !== "pending")) {
    supplierPixConflict("A origem da cobrança não está disponível para Pix.");
  }

  const previousExpenseId = previous.get("expenseId");
  const previousWorkspace = previous.get("workspaceId");
  if ((previousWorkspace && previousWorkspace !== workspace) || typeof previousExpenseId !== "string"
    || previous.get("status") !== "paid" || previous.get("statementReconciliationStatus") !== "matched"
    || normalizeBrazilianDocument(previous.get("barcodeSnapshot.beneficiaryDocument")) !== document) {
    supplierPixConflict("A referência anterior precisa comprovar o CNPJ por um pagamento conciliado.");
  }
  const historical = await expenses.doc(previousExpenseId).get();
  if (historical.get("workspaceId") !== workspace || historical.get("paymentRequestId") !== previous.id
    || !supplierNamesAreCompatible(historical.get("supplier"), entityData.name)) {
    supplierPixConflict("O fornecedor do pagamento anterior diverge do cadastro atual.");
  }

  const [priorPayments, priorOrders] = await Promise.all([
    payments.where("expenseId", "==", expenseId).limit(1).get(),
    requests.where("expenseId", "==", expenseId).limit(2).get(),
  ]);
  const expectedRequestId = `expense_supplier_pix_${actualId}`;
  if (!priorPayments.empty || priorOrders.docs.some((item) => item.id !== expectedRequestId)
    || (data.paymentRequestId && data.paymentRequestId !== expectedRequestId)) {
    supplierPixConflict("A despesa ou previsão já tem pagamento ou outra ordem bancária.");
  }

  const registeredDocument = normalizeBrazilianDocument(entityData.document);
  const expenseDocument = normalizeBrazilianDocument(data.billingIdentity?.supplierTaxId);
  if (registeredDocument !== document) {
    supplierPixConflict("Cadastre o CNPJ confirmado na entidade antes de preparar o Pix.");
  }
  if (expenseDocument && expenseDocument !== document) {
    supplierPixConflict("O CNPJ informado diverge do cadastro ou da despesa.");
  }

  const checkProfile = (value: FirebaseFirestore.DocumentSnapshot) => {
    if (!value.exists) supplierPixConflict("Configure e valide o perfil Pix documental do fornecedor antes de preparar.");
    if (value.get("active") !== true || value.get("paymentMethod") !== "pix_key"
      || value.get("pixKeyType") !== "cnpj" || !value.get("validatedAt")
      || normalizeBrazilianDocument(value.get("holderDocument")) !== document
      || normalizeBrazilianDocument(decryptPaymentDestination(String(value.get("encryptedPaymentData") ?? "")).pixKey) !== document) {
      supplierPixConflict("O fornecedor já tem um perfil Pix diferente ou desativado. Confira o cadastro.");
    }
  };
  checkProfile(profile);

  if (actualId !== expenseId) {
    const series = String(data.provisionSeriesKey ?? "");
    if (!series.startsWith("recurring:") || !data.dueDate || !data.unitId || !(data.accountPlan || data.accountId)
      || !(data.referenceResultCenterId || data.resultCenterId)) {
      supplierPixConflict("A previsão precisa de série, vencimento, unidade e classificação contábil confirmados.");
    }
    if (data.status === "reconciled") {
      if (data.replacedByExpenseId !== actualId) supplierPixConflict("A previsão foi conciliada com outra despesa.");
      return actualId;
    }
    const now = new Date().toISOString();
    const result = await reconcileExpenseProvisionOnServer(actualId, actor, {
      requiredProvisionId: expenseId,
      assertRequiredProvisionAccess: assertUnitAccess,
      identity: { provisionSeriesKey: series, provisionCompetence: confirmation.competenceMonth, provisionType: "actual" },
      createIfMissing: {
        workspaceId: workspace, description: data.description, supplier: data.supplier, supplierId: entityId,
        totalValue: amountCents / 100, status: "pending", paymentMethod: "single", dueDate: data.dueDate,
        competenceDate: data.competenceDate ?? data.dueDate, unitId: data.unitId,
        accountPlan: data.accountPlan ?? null, accountId: data.accountId ?? null, accountPlanName: data.accountPlanName ?? null,
        resultCenter: data.resultCenter ?? null, resultCenterId: data.resultCenterId ?? null,
        referenceResultCenterId: data.referenceResultCenterId ?? null,
        installments: [{ number: 1, value: amountCents / 100, status: "pending", dueDate: data.dueDate }],
        billingIdentity: { supplierTaxId: document }, sourceType: "confirmed_supplier_charge",
        notes: "Cobrança do fornecedor confirmada pelo operador para pagamento via Pix.",
        createdAt: now, createdBy: actor.uid,
      },
    });
    if (!["reconciled", "already_reconciled"].includes(result.status)) supplierPixConflict("A previsão não pôde ser conciliada.");
  }
  return actualId;
}
