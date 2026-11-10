/**
 * Audited one-time link of the eleven Isabela forecasts to the validated RH beneficiary.
 * Read-only by default. Production write requires all three explicit switches.
 *
 * node --env-file=.env.local --import tsx scripts/financial/bind-isabela-consultancy-provisions.mts
 * node --env-file=.env.local --import tsx scripts/financial/bind-isabela-consultancy-provisions.mts --apply --production --confirm-financial-actions
 */
import { financialDbAdmin } from "../../src/lib/firebase-financial-admin";
import { hrDbAdmin } from "../../src/lib/firebase-rh-admin";
import { WORKSPACE_ID } from "../../src/lib/workspace";

const employeeId = "17517966";
const contractDocumentId = "b21ae9fc5f770b8b74a5d6d3bfe9fe2c1c62";
const contractHash = "b21ae9fc5f770b8b74a5d6d3bfe9fe2c1c62b11ed4bc9c629d7ca5d2611cfbc0";
const series = "recurring:consultoria-rh:isabela-dominici-silva";
const supplier = "Isabela Dominici Silva";
const amountCents = 105078;
const auditId = "consultancy_employee_binding_20261109";
const apply = process.argv.includes("--apply");
if (apply && (!process.argv.includes("--production") || !process.argv.includes("--confirm-financial-actions"))) {
  throw new Error("Escrita em produção exige --apply --production --confirm-financial-actions.");
}

const targets = Array.from({ length: 11 }, (_, offset) => {
  const monthIndex = 10 + offset;
  const year = 2026 + Math.floor(monthIndex / 12);
  const month = (monthIndex % 12) + 1;
  const competence = `${year}-${String(month).padStart(2, "0")}`;
  return { id: `provision_isabela_dominici_${year}_${String(month).padStart(2, "0")}`, competence, due: `${competence}-20` };
});

function day(value: unknown) {
  const date = value && typeof value === "object" && "toDate" in value && typeof value.toDate === "function"
    ? value.toDate() as Date : value instanceof Date ? value : typeof value === "string" ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date.toISOString().slice(0, 10) : "";
}
function normalized(value: unknown) {
  return String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLocaleLowerCase("pt-BR");
}

function validateExpense(id: string, data: FirebaseFirestore.DocumentData, competence: string, due: string) {
  const installment = Array.isArray(data.installments) && data.installments.length === 1 ? data.installments[0] : null;
  if ((data.workspaceId && data.workspaceId !== WORKSPACE_ID) || data.status !== "provisioned" || data.provisionType !== "forecast"
    || data.provisionSeriesKey !== series || data.provisionCompetence !== competence
    || data.supplier !== supplier || data.description !== `Consultoria de RH - ${competence.slice(5)}/${competence.slice(0,4)} | ${supplier}`
    || Math.round(Number(data.totalValue) * 100) !== amountCents || day(data.dueDate) !== due
    || !installment || installment.status !== "pending" || Math.round(Number(installment.value) * 100) !== amountCents
    || day(installment.dueDate) !== due || data.paymentRequestId || data.paidAt || data.linkedBankTransactionId
    || installment.paymentRequestId || installment.paidAt || installment.linkedBankTransactionId) {
    throw new Error(`Provisão ${id} diverge do contrato; nenhuma associação foi aplicada.`);
  }
  if (data.consultancyEmployeeId && data.consultancyEmployeeId !== employeeId) throw new Error(`Provisão ${id} está vinculada a outro favorecido.`);
  if (data.consultancyContractDocumentId && data.consultancyContractDocumentId !== contractDocumentId) throw new Error(`Provisão ${id} aponta para outro contrato.`);
}

const [employee, contract] = await Promise.all([
  hrDbAdmin.collection("employees").doc(employeeId).get(),
  hrDbAdmin.collection("employeeDocuments").doc(contractDocumentId).get(),
]);
if (!employee.exists || employee.get("status") !== "active" || normalized(employee.get("name")) !== normalized(supplier)) throw new Error("Cadastro RH da prestadora não confere.");
const extracted = contract.data()?.extractedFields ?? {};
if (!contract.exists || contract.get("employeeId") !== employeeId || contract.get("documentTypeCode") !== "SERVICE_PROVIDER_CONTRACT_ADDENDUM"
  || contract.get("status") !== "validated" || contract.get("contentHash") !== contractHash
  || extracted.employeeName !== supplier.toUpperCase() || extracted.contractorCnpj !== "62992756000111"
  || extracted.startDate !== "2026-10-20" || extracted.endDate !== "2027-10-01") {
  throw new Error("O aditivo validado no Acervo não confere com a associação solicitada.");
}

const refs = targets.map((target) => ({ ...target, ref: financialDbAdmin.collection("expenses").doc(target.id) }));
const snapshots = await Promise.all(refs.map((target) => target.ref.get()));
for (let index = 0; index < refs.length; index++) {
  if (!snapshots[index].exists) throw new Error(`Provisão ${refs[index].id} ausente.`);
  validateExpense(refs[index].id, snapshots[index].data() ?? {}, refs[index].competence, refs[index].due);
}
const linked = snapshots.filter((item) => item.get("consultancyEmployeeId") === employeeId).length;
process.stdout.write(JSON.stringify({ mode: apply ? "apply" : "dry-run", count: refs.length, alreadyLinked: linked, employeeId, contractDocumentId,
  totalCents: amountCents * refs.length, firstDue: refs[0].due, lastDue: refs.at(-1)?.due }) + "\n");
if (!apply) process.exit(0);

await financialDbAdmin.runTransaction(async (tx) => {
  const [current, audits, payments, requests] = await Promise.all([
    Promise.all(refs.map((target) => tx.get(target.ref))),
    Promise.all(refs.map((target) => tx.get(target.ref.collection("audit").doc(auditId)))),
    Promise.all(refs.map((target) => tx.get(financialDbAdmin.collection("payments").where("expenseId", "==", target.id).limit(2)))),
    Promise.all(refs.map((target) => tx.get(financialDbAdmin.collection("bankPaymentRequests").where("expenseId", "==", target.id).limit(2)))),
  ]);
  for (let index = 0; index < refs.length; index++) {
    const target = refs[index];
    if (!current[index].exists) throw new Error(`Provisão ${target.id} deixou de existir.`);
    validateExpense(target.id, current[index].data() ?? {}, target.competence, target.due);
    if (payments[index].docs.some((item) => item.get("reversed") !== true) || !requests[index].empty) throw new Error(`Provisão ${target.id} recebeu pagamento ou ordem; associação bloqueada.`);
  }
  const at = new Date().toISOString();
  for (let index = 0; index < refs.length; index++) {
    if (current[index].get("consultancyEmployeeId") !== employeeId) {
      tx.update(refs[index].ref, { consultancyEmployeeId: employeeId, consultancyContractDocumentId: contractDocumentId, consultancyBeneficiaryVerifiedAt: at, updatedAt: at });
    }
    if (!audits[index].exists) tx.create(refs[index].ref.collection("audit").doc(auditId), {
      action: "CONSULTANCY_BENEFICIARY_BOUND", actorId: "codex:user-authorized", at,
      employeeId, contractDocumentId, contractHash, series, competence: refs[index].competence,
    });
  }
});
const verified = await Promise.all(refs.map((target) => target.ref.get()));
if (!verified.every((item) => item.get("consultancyEmployeeId") === employeeId && item.get("consultancyContractDocumentId") === contractDocumentId)) {
  throw new Error("Associação foi aplicada, mas a leitura posterior não confirmou todos os vínculos; não repetir sem diagnóstico.");
}
process.stdout.write(JSON.stringify({ mode: "verified", count: verified.length, employeeId, contractDocumentId }) + "\n");
