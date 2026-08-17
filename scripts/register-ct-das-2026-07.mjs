import { existsSync, readFileSync } from "node:fs";
import { applicationDefault, cert, getApps, initializeApp } from "firebase-admin/app";
import { Timestamp, getFirestore } from "firebase-admin/firestore";

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID
  || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID
  || "smart-converter-752gf";
const FINANCIAL_DATABASE = process.env.FINANCIAL_FIRESTORE_DATABASE || "coala-financeiro";
const EXPENSE_ID = "das-ct-sorvetes-2026-07";
const SOURCE_REFERENCE = "07.20.26225.9872024-0";
const TOTAL_VALUE = 3_921.78;
const RESULT_CENTER = "Centro administrativo - Renascença";
const BANK_SCHEDULE = {
  transactionId: "a341e431-3dd3-4cb1-967e-83bf3a08a7df",
  status: "AGUARDANDO_APROVACAO",
  approversRequired: 1,
};
const EXECUTE = process.argv.includes("--execute");
const CONFIRMATION = "CONFIRMO-DAS-CT-2026-07-3921.78";
const PROVIDED_CONFIRMATION = process.argv
  .find((argument) => argument.startsWith("--confirmation="))
  ?.slice("--confirmation=".length);

const COMPONENTS = [
  { accountPlanId: "das-componente-irpj", accountPlanName: "IRPJ do DAS", amount: 215.70 },
  { accountPlanId: "das-componente-csll", accountPlanName: "CSLL do DAS", amount: 137.26 },
  { accountPlanId: "das-componente-cofins", accountPlanName: "Cofins do DAS", amount: 499.64 },
  { accountPlanId: "das-componente-pis", accountPlanName: "PIS/Pasep do DAS", amount: 108.24 },
  { accountPlanId: "das-componente-cpp", accountPlanName: "CPP do DAS", amount: 1_647.15 },
  { accountPlanId: "das-componente-icms", accountPlanName: "ICMS do DAS", amount: 1_313.79 },
];

function loadCredential() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (raw) return cert(JSON.parse(raw));
  const path = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
  if (path && existsSync(path)) return cert(JSON.parse(readFileSync(path, "utf8")));
  return applicationDefault();
}

function getApp() {
  return getApps().find((app) => app.name === "register-ct-das-2026-07")
    ?? initializeApp(
      { credential: loadCredential(), projectId: PROJECT_ID },
      "register-ct-das-2026-07",
    );
}

function normalize(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim()
    .toLowerCase();
}

function cents(value) {
  return Math.round(Number(value) * 100);
}

const componentTotal = COMPONENTS.reduce((sum, component) => sum + cents(component.amount), 0);
if (componentTotal !== cents(TOTAL_VALUE)) {
  throw new Error(`A composição soma ${(componentTotal / 100).toFixed(2)}, mas o DAS totaliza ${TOTAL_VALUE.toFixed(2)}.`);
}

const app = getApp();
const db = getFirestore(app, FINANCIAL_DATABASE);
const [accountsSnapshot, resultCentersSnapshot, existingExpense] = await Promise.all([
  db.collection("accounts").get(),
  db.collection("resultCenters").get(),
  db.collection("expenses").doc(EXPENSE_ID).get(),
]);
const accounts = accountsSnapshot.docs.map((document) => ({ id: document.id, ...document.data() }));
const dasMatches = accounts.filter((account) => normalize(account.name) === "das");
if (dasMatches.length !== 1) throw new Error(`Esperava uma única conta DAS; encontrei ${dasMatches.length}.`);
const das = dasMatches[0];

if (das.active === false || das.isGroup !== true) {
  throw new Error("A conta DAS não está ativa como conta-mãe. Execute primeiro migrate:das-accounts.");
}

for (const component of COMPONENTS) {
  const account = accounts.find((candidate) => candidate.id === component.accountPlanId);
  if (!account) throw new Error(`A subconta ${component.accountPlanName} não existe. Execute primeiro migrate:das-accounts.`);
  if (
    account.parentId !== das.id
    || account.active === false
    || account.isGroup === true
    || normalize(account.name) !== normalize(component.accountPlanName)
  ) {
    throw new Error(`A subconta ${component.accountPlanName} não corresponde à estrutura esperada do DAS.`);
  }
}

const resultCenters = resultCentersSnapshot.docs.map((document) => ({ id: document.id, ...document.data() }));
const resultCenterMatches = resultCenters.filter((center) => normalize(center.name) === normalize(RESULT_CENTER));
if (resultCenterMatches.length !== 1) {
  throw new Error(`Esperava um único centro de resultado ${RESULT_CENTER}; encontrei ${resultCenterMatches.length}.`);
}
const resultCenter = resultCenterMatches[0];

if (existingExpense.exists && existingExpense.data()?.sourceKey !== "das__ct-sorvetes__2026-07") {
  throw new Error(`O identificador ${EXPENSE_ID} já pertence a outra despesa.`);
}
if (
  existingExpense.exists
  && existingExpense.data()?.bankPaymentTransactionId
  && existingExpense.data()?.bankPaymentTransactionId !== BANK_SCHEDULE.transactionId
) {
  throw new Error("A despesa já está vinculada a outro código de transação bancária.");
}

const competenceDate = new Date("2026-07-01T12:00:00-03:00");
const dueDate = new Date("2026-08-20T12:00:00-03:00");
const now = Timestamp.now();
const data = {
  accountPlan: das.id,
  accountId: das.id,
  accountPlanName: das.name,
  provisionSeriesKey: "das-simples-nacional",
  provisionType: "actual",
  provisionCompetence: "2026-07",
  provisionReconciliationStatus: "not_provisioned",
  hasAccountAllocations: true,
  accountAllocations: COMPONENTS,
  description: "DAS Simples Nacional — competência 07/2026",
  supplier: "Receita Federal do Brasil",
  notes: `Documento ${SOURCE_REFERENCE}. Título único com apropriação contábil pelos tributos demonstrados na composição do DAS.`,
  totalValue: TOTAL_VALUE,
  competenceDate: Timestamp.fromDate(competenceDate),
  dueDate: Timestamp.fromDate(dueDate),
  paymentMethod: "single",
  plannedPaymentMethodType: null,
  plannedBankAccountId: null,
  plannedBankAccountName: null,
  plannedPaymentMethodId: null,
  plannedPaymentMethodLabel: null,
  installmentType: null,
  installmentPeriodicity: null,
  installments: [{
    number: 1,
    dueDate: Timestamp.fromDate(dueDate),
    value: TOTAL_VALUE,
    status: "pending",
  }],
  isApportioned: false,
  resultCenter: resultCenter.name,
  resultCenterId: resultCenter.id,
  apportionments: null,
  rateioCriterion: null,
  rateioEffectiveFrom: null,
  rateioFirstMonthMode: null,
  status: "pending",
  originModule: "manual",
  sourceType: "das_simples_nacional",
  sourceReference: SOURCE_REFERENCE,
  sourceKey: "das__ct-sorvetes__2026-07",
  bankPaymentTransactionId: BANK_SCHEDULE.transactionId,
  bankPaymentStatus: BANK_SCHEDULE.status,
  bankPaymentApproversRequired: BANK_SCHEDULE.approversRequired,
  bankPaymentScheduledFor: Timestamp.fromDate(dueDate),
  paymentSchedulingStatus: "awaiting_approval",
  createdBy: "codex",
  updatedAt: now,
};

const summary = {
  mode: EXECUTE ? "execute" : "dry-run",
  action: existingExpense.exists
    ? existingExpense.data()?.bankPaymentTransactionId ? "verify-existing" : "link-bank-schedule"
    : "create",
  id: EXPENSE_ID,
  account: { id: das.id, name: das.name },
  competence: "07/2026",
  dueDate: "20/08/2026",
  resultCenter: { id: resultCenter.id, name: resultCenter.name },
  sourceReference: SOURCE_REFERENCE,
  totalValue: TOTAL_VALUE,
  components: COMPONENTS,
};

if (!EXECUTE) {
  console.log(JSON.stringify(summary, null, 2));
  console.log(`Dry-run concluído. Para gravar, use --execute --confirmation=${CONFIRMATION}.`);
  process.exit(0);
}

if (PROVIDED_CONFIRMATION !== CONFIRMATION) {
  throw new Error(`Confirmação ausente ou inválida. Informe --confirmation=${CONFIRMATION}.`);
}

const expenseReference = db.collection("expenses").doc(EXPENSE_ID);
if (!existingExpense.exists) {
  await expenseReference.create({ ...data, createdAt: now });
} else {
  const stored = existingExpense.data();
  const storedComponents = Array.isArray(stored.accountAllocations) ? stored.accountAllocations : [];
  const storedTotal = storedComponents.reduce((sum, component) => sum + cents(component.amount), 0);
  if (
    stored.accountPlan !== das.id
    || cents(stored.totalValue) !== cents(TOTAL_VALUE)
    || storedTotal !== cents(TOTAL_VALUE)
    || stored.sourceReference !== SOURCE_REFERENCE
  ) {
    throw new Error("A despesa já existe, mas diverge do DAS esperado; nenhuma sobrescrita foi feita.");
  }
  await expenseReference.set({
    bankPaymentTransactionId: BANK_SCHEDULE.transactionId,
    bankPaymentStatus: BANK_SCHEDULE.status,
    bankPaymentApproversRequired: BANK_SCHEDULE.approversRequired,
    bankPaymentScheduledFor: Timestamp.fromDate(dueDate),
    paymentSchedulingStatus: "awaiting_approval",
    bankPaymentLinkedAt: now,
    updatedAt: now,
  }, { merge: true });
}

const verification = await expenseReference.get();
if (!verification.exists) throw new Error("A despesa do DAS não foi criada.");
const verified = verification.data();
if (
  verified.status !== "pending"
  || verified.hasAccountAllocations !== true
  || cents(verified.totalValue) !== cents(TOTAL_VALUE)
  || verified.accountAllocations.length !== COMPONENTS.length
  || verified.bankPaymentTransactionId !== BANK_SCHEDULE.transactionId
) {
  throw new Error("A verificação posterior do DAS falhou.");
}

console.log(JSON.stringify({ ...summary, status: existingExpense.exists ? "already-registered-and-verified" : "registered-and-verified" }, null, 2));
