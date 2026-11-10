import { financialDbAdmin } from "@/lib/firebase-financial-admin";
import { hrDbAdmin } from "@/lib/firebase-rh-admin";
import { WORKSPACE_ID } from "@/lib/workspace";
import { reconcileExpenseProvisionOnServer } from "@/features/financial/expense-provision-reconciliation.server";
import { assertConsultancyActualPaymentTarget, assertConsultancyProvisionPaymentTarget } from "./consultancy-provision-payment";
import { createPaymentRequest } from "./service.server";
import { findPaymentRequestBySource } from "./repository.server";
import type { PaymentActor } from "./types";

function day(value: unknown) {
  const date = value && typeof value === "object" && "toDate" in value && typeof value.toDate === "function"
    ? value.toDate() as Date
    : value instanceof Date ? value : typeof value === "string" ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date.toISOString().slice(0, 10) : "";
}

/** Materializes the contract debt once, then prepares a Pix linked to that debt. No bank call. */
export async function prepareConsultancyProvisionPix(forecastId: string, employeeId: string, scheduledFor: string, actor: PaymentActor) {
  const actualId = `consultancy_actual_${forecastId}`;
  const [forecastSnapshot, employeeSnapshot] = await Promise.all([
    financialDbAdmin.collection("expenses").doc(forecastId).get(),
    hrDbAdmin.collection("employees").doc(employeeId).get(),
  ]);
  if (!forecastSnapshot.exists || !employeeSnapshot.exists) throw new Error("Provisão ou favorecido não encontrado.");
  const forecast = { id: forecastSnapshot.id, ...forecastSnapshot.data() } as FirebaseFirestore.DocumentData & { id: string };
  const employee = { id: employeeSnapshot.id, ...employeeSnapshot.data() } as FirebaseFirestore.DocumentData & { id: string };
  const amount = Number(forecast.totalValue);
  const description = String(forecast.description ?? "").trim();
  const reference = { sourceType: "employee" as const, sourceId: employeeId };
  const existing = await findPaymentRequestBySource("consultancy_provision", forecastId, WORKSPACE_ID);
  if (existing) {
    if (existing.expenseId !== actualId || existing.beneficiaryReference?.sourceType !== "employee" || existing.beneficiaryReference.sourceId !== employeeId
      || existing.scheduledFor !== scheduledFor || Math.round(existing.amount * 100) !== Math.round(amount * 100)) {
      throw new Error("A solicitação existente diverge da provisão; revise antes de continuar.");
    }
    return existing;
  }
  if (forecast.status === "provisioned") {
    assertConsultancyProvisionPaymentTarget({ sourceId: forecastId, expenseId: forecastId, beneficiaryReference: reference, amount, description, scheduledFor }, forecast, employee, WORKSPACE_ID);
    const [payments, requests, existingActual] = await Promise.all([
      financialDbAdmin.collection("payments").where("expenseId", "==", forecastId).limit(2).get(),
      financialDbAdmin.collection("bankPaymentRequests").where("expenseId", "==", forecastId).limit(2).get(),
      financialDbAdmin.collection("expenses").doc(actualId).get(),
    ]);
    if (payments.docs.some((item) => item.get("reversed") !== true) || !requests.empty) throw new Error("A provisão já possui pagamento ou solicitação bancária.");
    if (existingActual.exists && (existingActual.get("sourceType") !== "consultancy_contract_payment" || existingActual.get("provisionSeriesKey") !== forecast.provisionSeriesKey
      || existingActual.get("provisionCompetence") !== forecast.provisionCompetence || Math.round(Number(existingActual.get("totalValue")) * 100) !== Math.round(amount * 100))) {
      throw new Error("Já existe uma obrigação real divergente com o identificador reservado.");
    }
    const actual = {
      workspaceId: WORKSPACE_ID, description, supplier: forecast.supplier, totalValue: amount,
      dueDate: forecast.dueDate, competenceMonth: forecast.competenceMonth ?? forecast.provisionCompetence,
      competenceDate: forecast.competenceDate ?? forecast.dueDate,
      accountPlan: forecast.accountPlan ?? null, accountId: forecast.accountId ?? null, accountPlanName: forecast.accountPlanName ?? null,
      resultCenter: forecast.resultCenter ?? null, resultCenterId: forecast.resultCenterId ?? null, resultCenterName: forecast.resultCenterName ?? null,
      unitId: forecast.unitId ?? null, sourceType: "consultancy_contract_payment",
      consultancyEmployeeId: employeeId,
      consultancyContractDocumentId: forecast.consultancyContractDocumentId ?? null,
      provisionType: "actual" as const, provisionSeriesKey: forecast.provisionSeriesKey, provisionCompetence: forecast.provisionCompetence,
      status: "pending", installments: [{ number: 1, dueDate: forecast.dueDate, value: amount, status: "pending" }],
      paymentMethod: "single", createdAt: new Date().toISOString(), createdBy: actor.uid, updatedAt: new Date().toISOString(),
      notes: "Obrigação contratual materializada para agendamento Pix; documento fiscal da competência ainda deve ser vinculado e conferido.",
    };
    const reconciliation = await reconcileExpenseProvisionOnServer(actualId, actor, {
      identity: { provisionSeriesKey: String(forecast.provisionSeriesKey), provisionCompetence: String(forecast.provisionCompetence), provisionType: "actual" },
      createIfMissing: actual,
    });
    if (!["reconciled", "already_reconciled"].includes(reconciliation.status)) throw new Error("A provisão não pôde ser conciliada com a obrigação contratual.");
  } else if (forecast.status !== "reconciled" || forecast.replacedByExpenseId !== actualId) {
    throw new Error("A provisão mudou e não pode gerar um Pix.");
  }
  const actualSnapshot = await financialDbAdmin.collection("expenses").doc(actualId).get();
  if (!actualSnapshot.exists || day(actualSnapshot.get("dueDate")) !== scheduledFor) throw new Error("A obrigação contratual não preservou o vencimento.");
  assertConsultancyActualPaymentTarget({ sourceId: forecastId, expenseId: actualId, beneficiaryReference: reference, amount, description, scheduledFor },
    { id: actualSnapshot.id, ...actualSnapshot.data() }, employee, WORKSPACE_ID);
  return createPaymentRequest({
    sourceType: "consultancy_provision", sourceId: forecastId, expenseId: actualId,
    beneficiaryReference: reference, amount, description, scheduledFor,
  }, actor);
}
