import { existsSync, readFileSync } from "node:fs";
import { applicationDefault, cert, getApps, initializeApp } from "firebase-admin/app";
import { FieldValue, Timestamp, getFirestore } from "firebase-admin/firestore";

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID
  || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID
  || "smart-converter-752gf";
const FINANCIAL_DATABASE = process.env.FINANCIAL_FIRESTORE_DATABASE || "coala-financeiro";
const BASIS_EXPENSE_ID = "das-ct-sorvetes-2026-07";
const SERIES_KEY = "das-simples-nacional";
const FIRST_COMPETENCE = "2026-08";
const MONTHS = 12;
const EXECUTE = process.argv.includes("--execute");
const CONFIRMATION = "CONFIRMO-12-PROVISOES-DAS-3921.78";
const PROVIDED_CONFIRMATION = process.argv
  .find((argument) => argument.startsWith("--confirmation="))
  ?.slice("--confirmation=".length);

// Datas sem expediente bancário que podem coincidir com o dia 20 no horizonte.
// A guia efetivamente emitida sempre substitui esta data estimada.
const KNOWN_NON_BANKING_DATES = new Set(["2026-11-20"]);

function loadCredential() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (raw) return cert(JSON.parse(raw));
  const path = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
  if (path && existsSync(path)) return cert(JSON.parse(readFileSync(path, "utf8")));
  return applicationDefault();
}

function getApp() {
  return getApps().find((app) => app.name === "create-ct-das-provisions-12m")
    ?? initializeApp(
      { credential: loadCredential(), projectId: PROJECT_ID },
      "create-ct-das-provisions-12m",
    );
}

function cents(value) {
  return Math.round((Number(value) || 0) * 100);
}

function dateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function nextBankingDay(date) {
  const adjusted = new Date(date);
  while (adjusted.getDay() === 0 || adjusted.getDay() === 6 || KNOWN_NON_BANKING_DATES.has(dateKey(adjusted))) {
    adjusted.setDate(adjusted.getDate() + 1);
  }
  return adjusted;
}

function buildMonth(index) {
  const [firstYear, firstMonth] = FIRST_COMPETENCE.split("-").map(Number);
  const competenceDate = new Date(firstYear, firstMonth - 1 + index, 1, 12, 0, 0);
  const originalDueDate = new Date(
    competenceDate.getFullYear(),
    competenceDate.getMonth() + 1,
    20,
    12,
    0,
    0,
  );
  return {
    competenceDate,
    competence: dateKey(competenceDate).slice(0, 7),
    originalDueDate,
    dueDate: nextBankingDay(originalDueDate),
  };
}

const app = getApp();
const db = getFirestore(app, FINANCIAL_DATABASE);
const basisSnapshot = await db.collection("expenses").doc(BASIS_EXPENSE_ID).get();
if (!basisSnapshot.exists) {
  throw new Error(`A despesa-base ${BASIS_EXPENSE_ID} não existe. Registre primeiro o DAS real de 07/2026.`);
}
const basis = basisSnapshot.data();
if (
  basis.provisionSeriesKey !== SERIES_KEY
  || basis.provisionType !== "actual"
  || !Array.isArray(basis.accountAllocations)
  || basis.accountAllocations.length < 2
) {
  throw new Error("A despesa-base não possui a estrutura contábil esperada do DAS.");
}
const basisTotal = Number(basis.totalValue) || 0;
const allocationTotal = basis.accountAllocations.reduce((total, allocation) => total + cents(allocation.amount), 0);
if (allocationTotal !== cents(basisTotal)) throw new Error("A composição do DAS-base não fecha com o valor total.");

const months = Array.from({ length: MONTHS }, (_, index) => buildMonth(index));
const snapshots = await Promise.all(
  months.map((month) => db.collection("expenses").doc(`das-provision-${month.competence}`).get()),
);
const provisions = months.map((month, index) => {
  const id = `das-provision-${month.competence}`;
  const snapshot = snapshots[index];
  if (snapshot.exists && snapshot.data()?.sourceKey !== `das__forecast__${month.competence}`) {
    throw new Error(`O identificador ${id} já pertence a outra despesa.`);
  }
  return { ...month, id, exists: snapshot.exists };
});

for (const [index, provision] of provisions.entries()) {
  if (!provision.exists) continue;
  const stored = snapshots[index].data();
  if (
    !["provisioned", "reconciled"].includes(stored.status)
    || stored.provisionSeriesKey !== SERIES_KEY
    || stored.provisionCompetence !== provision.competence
    || cents(stored.totalValue) !== cents(basisTotal)
  ) {
    throw new Error(`A provisão existente de ${provision.competence} diverge da série esperada; nenhuma alteração foi feita.`);
  }
}

const summary = {
  mode: EXECUTE ? "execute" : "dry-run",
  basisExpenseId: BASIS_EXPENSE_ID,
  method: "último DAS real mantido como previsão; composição percentual herdada",
  monthlyValue: basisTotal,
  count: provisions.length,
  existing: provisions.filter((provision) => provision.exists).length,
  provisions: provisions.map((provision) => ({
    id: provision.id,
    competence: provision.competence,
    dueDate: dateKey(provision.dueDate),
    dueDateEstimated: true,
    amount: basisTotal,
    action: provision.exists ? "verify" : "create",
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

const batch = db.batch();
for (const provision of provisions) {
  if (provision.exists) continue;
  const reference = db.collection("expenses").doc(provision.id);
  const dueTimestamp = Timestamp.fromDate(provision.dueDate);
  batch.create(reference, {
    accountPlan: basis.accountPlan,
    accountId: basis.accountId || basis.accountPlan,
    accountPlanName: basis.accountPlanName || "DAS",
    hasAccountAllocations: true,
    accountAllocations: basis.accountAllocations,
    description: `Previsão DAS Simples Nacional - competência ${provision.competence.slice(5, 7)}/${provision.competence.slice(0, 4)}`,
    supplier: basis.supplier || "Receita Federal do Brasil",
    notes: `Previsão automática baseada no DAS real de 07/2026 (${basisTotal.toFixed(2)}). Substituir e conciliar quando a guia da competência for emitida.`,
    totalValue: basisTotal,
    competenceDate: Timestamp.fromDate(provision.competenceDate),
    dueDate: dueTimestamp,
    paymentMethod: "single",
    plannedPaymentMethodType: null,
    plannedBankAccountId: null,
    plannedBankAccountName: null,
    plannedPaymentMethodId: null,
    plannedPaymentMethodLabel: null,
    installmentType: null,
    installmentPeriodicity: null,
    installments: [{ number: 1, dueDate: dueTimestamp, value: basisTotal, status: "provisioned" }],
    isApportioned: basis.isApportioned === true,
    resultCenter: basis.resultCenter || null,
    resultCenterId: basis.resultCenterId || null,
    apportionments: Array.isArray(basis.apportionments) ? basis.apportionments : null,
    rateioCriterion: basis.rateioCriterion || null,
    rateioEffectiveFrom: basis.rateioEffectiveFrom || null,
    rateioFirstMonthMode: basis.rateioFirstMonthMode || null,
    status: "provisioned",
    provisionSeriesKey: SERIES_KEY,
    provisionType: "forecast",
    provisionCompetence: provision.competence,
    provisionMethod: "last_actual_carry_forward",
    provisionBasisExpenseId: BASIS_EXPENSE_ID,
    provisionReconciliationStatus: "awaiting_actual",
    dueDateIsEstimated: true,
    originalEstimatedDueDate: Timestamp.fromDate(provision.originalDueDate),
    originModule: "forecast",
    sourceType: "das_forecast",
    sourceReference: provision.competence,
    sourceKey: `das__forecast__${provision.competence}`,
    createdBy: "codex",
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
}
await batch.commit();

const verification = await Promise.all(
  provisions.map((provision) => db.collection("expenses").doc(provision.id).get()),
);
for (const [index, snapshot] of verification.entries()) {
  const expected = provisions[index];
  if (!snapshot.exists) throw new Error(`A provisão ${expected.competence} não foi criada.`);
  const data = snapshot.data();
  if (
    data.sourceKey !== `das__forecast__${expected.competence}`
    || !["provisioned", "reconciled"].includes(data.status)
    || cents(data.totalValue) !== cents(basisTotal)
  ) {
    throw new Error(`A verificação da provisão ${expected.competence} falhou.`);
  }
}

console.log(JSON.stringify({ ...summary, status: "created-and-verified" }, null, 2));
