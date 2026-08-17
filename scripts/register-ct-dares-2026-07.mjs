import { existsSync, readFileSync } from "node:fs";
import { applicationDefault, cert, getApps, initializeApp } from "firebase-admin/app";
import { Timestamp, getFirestore } from "firebase-admin/firestore";

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID
  || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID
  || "smart-converter-752gf";
const FINANCIAL_DATABASE = process.env.FINANCIAL_FIRESTORE_DATABASE || "coala-financeiro";
const ACCOUNT_ID = "dare-icms-antecipado";
const EXECUTE = process.argv.includes("--execute");
const CONFIRMATION = "CONFIRMO-REGISTRO-DARES-CT-2026-07-476.45";
const PROVIDED_CONFIRMATION = process.argv
  .find((argument) => argument.startsWith("--confirmation="))
  ?.slice("--confirmation=".length);

const GUIDES = [
  {
    id: "dare-icms-antecipado-ct-matriz-2026-07-177445139",
    establishment: "Matriz",
    cnpj: "14.276.603/0001-25",
    stateRegistration: "12.367413-1",
    ourNumber: "177445139",
    amount: 405.40,
    resultCenterId: "KNKNWZ7tdhIxnrlStRum",
    resultCenterName: "Centro administrativo - Renascença",
  },
  {
    id: "dare-icms-antecipado-ct-filial-003-2026-07-177445641",
    establishment: "Filial 003",
    cnpj: "14.276.603/0003-97",
    stateRegistration: "12.814360-6",
    ourNumber: "177445641",
    amount: 71.05,
    resultCenterId: "KNKNWZ7tdhIxnrlStRum",
    resultCenterName: "Centro administrativo - Renascença",
  },
];

function loadCredential() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (raw) return cert(JSON.parse(raw));
  const path = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
  if (path && existsSync(path)) return cert(JSON.parse(readFileSync(path, "utf8")));
  return applicationDefault();
}

function getApp() {
  return getApps().find((app) => app.name === "register-ct-dares-2026-07")
    ?? initializeApp(
      { credential: loadCredential(), projectId: PROJECT_ID },
      "register-ct-dares-2026-07",
    );
}

function cents(value) {
  return Math.round(Number(value) * 100);
}

const app = getApp();
const db = getFirestore(app, FINANCIAL_DATABASE);
const [accountSnapshot, ...references] = await Promise.all([
  db.collection("accounts").doc(ACCOUNT_ID).get(),
  ...GUIDES.flatMap((guide) => [
    db.collection("resultCenters").doc(guide.resultCenterId).get(),
    db.collection("expenses").doc(guide.id).get(),
  ]),
]);

if (!accountSnapshot.exists) throw new Error("A conta 2.2.1 ICMS antecipado não existe. Execute primeiro migrate:dare-accounts.");
const account = accountSnapshot.data();
if (account.active === false || account.isGroup === true || account.parentId !== "sFVZ3tcW0tdzg8t8eYSW") {
  throw new Error("A conta 2.2.1 ICMS antecipado não corresponde à estrutura esperada do DARE.");
}

const now = Timestamp.now();
const competenceDate = Timestamp.fromDate(new Date("2026-07-01T12:00:00-03:00"));
const dueDate = Timestamp.fromDate(new Date("2026-08-20T12:00:00-03:00"));
const operations = [];

for (const [index, guide] of GUIDES.entries()) {
  const resultCenterSnapshot = references[index * 2];
  const existingExpense = references[index * 2 + 1];
  if (!resultCenterSnapshot.exists || resultCenterSnapshot.data()?.name !== guide.resultCenterName) {
    throw new Error(`O centro de resultado de ${guide.establishment} não corresponde a ${guide.resultCenterName}.`);
  }
  const sourceKey = `dare-icms-antecipado__${guide.cnpj.replace(/\D/g, "")}__2026-07__${guide.ourNumber}`;
  if (existingExpense.exists) {
    const stored = existingExpense.data();
    if (
      stored.sourceKey !== sourceKey
      || stored.accountPlan !== ACCOUNT_ID
      || stored.resultCenterId !== guide.resultCenterId
      || cents(stored.totalValue) !== cents(guide.amount)
    ) {
      throw new Error(`A despesa ${guide.id} já existe com dados divergentes; nenhuma sobrescrita foi feita.`);
    }
  }
  operations.push({ guide, sourceKey, existingExpense });
}

const summary = {
  mode: EXECUTE ? "execute" : "dry-run",
  account: { id: ACCOUNT_ID, name: account.name },
  competence: "07/2026",
  dueDate: "20/08/2026",
  total: GUIDES.reduce((sum, guide) => sum + guide.amount, 0),
  guides: operations.map(({ guide, existingExpense }) => ({
    id: guide.id,
    establishment: guide.establishment,
    cnpj: guide.cnpj,
    ourNumber: guide.ourNumber,
    value: guide.amount,
    resultCenter: guide.resultCenterName,
    action: existingExpense.exists ? "verify-existing" : "create",
  })),
};

if (!EXECUTE) {
  console.log(JSON.stringify(summary, null, 2));
  console.log(`Dry-run concluído. Para gravar, use --execute --confirmation=${CONFIRMATION}.`);
  process.exit(0);
}
if (PROVIDED_CONFIRMATION !== CONFIRMATION) {
  throw new Error(`Confirmação ausente ou inválida. Informe --confirmation=${CONFIRMATION}.`);
}

for (const { guide, sourceKey, existingExpense } of operations) {
  if (existingExpense.exists) continue;
  await db.collection("expenses").doc(guide.id).create({
    accountPlan: ACCOUNT_ID,
    accountId: ACCOUNT_ID,
    accountPlanName: account.name,
    description: `DARE ICMS antecipado — ${guide.establishment} — competência 07/2026`,
    supplier: "Secretaria de Estado da Fazenda do Maranhão",
    notes: `DARE código de receita 101. CNPJ ${guide.cnpj}; inscrição estadual ${guide.stateRegistration}; Nosso Número ${guide.ourNumber}. Guia individual do estabelecimento, sem desmembramento tributário.`,
    totalValue: guide.amount,
    competenceDate,
    dueDate,
    paymentMethod: "single",
    plannedPaymentMethodType: null,
    plannedBankAccountId: null,
    plannedBankAccountName: null,
    plannedPaymentMethodId: null,
    plannedPaymentMethodLabel: null,
    installmentType: null,
    installmentPeriodicity: null,
    installments: [{ number: 1, dueDate, value: guide.amount, status: "pending" }],
    isApportioned: false,
    resultCenter: guide.resultCenterName,
    resultCenterId: guide.resultCenterId,
    apportionments: null,
    rateioCriterion: null,
    rateioEffectiveFrom: null,
    rateioFirstMonthMode: null,
    status: "pending",
    originModule: "manual",
    sourceType: "dare_icms_antecipado",
    sourceReference: guide.ourNumber,
    sourceKey,
    establishmentDocument: guide.cnpj,
    establishmentStateRegistration: guide.stateRegistration,
    createdBy: "codex",
    createdAt: now,
    updatedAt: now,
  });
}

const verification = await Promise.all(GUIDES.map((guide) => db.collection("expenses").doc(guide.id).get()));
for (const [index, document] of verification.entries()) {
  const guide = GUIDES[index];
  const stored = document.data();
  if (
    !document.exists
    || stored.status !== "pending"
    || stored.accountPlan !== ACCOUNT_ID
    || stored.resultCenterId !== guide.resultCenterId
    || cents(stored.totalValue) !== cents(guide.amount)
    || stored.sourceReference !== guide.ourNumber
  ) {
    throw new Error(`A verificação posterior do DARE ${guide.ourNumber} falhou.`);
  }
}

console.log(JSON.stringify({ ...summary, status: "registered-and-verified" }, null, 2));
