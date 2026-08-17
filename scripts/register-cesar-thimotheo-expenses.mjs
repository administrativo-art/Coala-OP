import { existsSync, readFileSync } from "node:fs";
import { applicationDefault, cert, getApps, initializeApp } from "firebase-admin/app";
import { Timestamp, getFirestore } from "firebase-admin/firestore";

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "smart-converter-752gf";
const FINANCIAL_DATABASE = process.env.FINANCIAL_FIRESTORE_DATABASE || "coala-financeiro";
const MAIN_DATABASE = process.env.MAIN_FIRESTORE_DATABASE || "coala";
const EXECUTE = process.argv.includes("--execute");

const ACCOUNT_ID = "honorarios-advocaticios";
const ACCOUNT_NAME = "Honorários advocatícios";
const ADMIN_ACCOUNT_ID = "rtmp6WKQJnfCckGln7cb";
const ENTITY_ID = "cesar-thimotheo-23623057000142";
const SUPPLIER = "CESAR THIMOTHEO SOCIEDADE INDIVIDUAL DE ADVOCACIA";
const RESULT_CENTER = "Quiosque Shopping do Automóvel";
const RESULT_CENTER_ID = "eCHb3fsk97fvUqzbT7DR";
const UNIT_ID = "EzISBSwIv3mIH4mRXPGT";
const RECURRENCE_GROUP_ID = "cesar-thimotheo-acordo-2026";
const FIRST_INSTALLMENT = 5;
const LAST_INSTALLMENT = 25;
const INSTALLMENT_VALUE = 1_200;

function loadCredential() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (raw) return cert(JSON.parse(raw));
  const path = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
  if (path && existsSync(path)) return cert(JSON.parse(readFileSync(path, "utf8")));
  return applicationDefault();
}

function getApp() {
  return getApps().find((item) => item.name === "register-cesar-thimotheo-expenses") ??
    initializeApp({ credential: loadCredential(), projectId: PROJECT_ID }, "register-cesar-thimotheo-expenses");
}

function installmentDate(number, day) {
  const zeroBasedMonth = 3 + (number - 1);
  const year = 2026 + Math.floor(zeroBasedMonth / 12);
  const month = (zeroBasedMonth % 12) + 1;
  return new Date(`${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T12:00:00-03:00`);
}

function expenseId(number) {
  return `cesar-thimotheo-acordo-2026-parcela-${String(number).padStart(2, "0")}`;
}

const app = getApp();
const financialDb = getFirestore(app, FINANCIAL_DATABASE);
const mainDb = getFirestore(app, MAIN_DATABASE);
const now = Timestamp.now();
const nowIso = new Date().toISOString();

const schedule = Array.from({ length: LAST_INSTALLMENT - FIRST_INSTALLMENT + 1 }, (_, index) => {
  const number = FIRST_INSTALLMENT + index;
  return {
    number,
    dueDate: Timestamp.fromDate(installmentDate(number, 15)),
    value: INSTALLMENT_VALUE,
  };
});

const expenseRows = schedule.map((installment) => ({
  id: expenseId(installment.number),
  data: {
    accountPlan: ACCOUNT_ID,
    accountId: ACCOUNT_ID,
    accountPlanName: ACCOUNT_NAME,
    description: "Honorários advocatícios — acordo CTA, Diverno e Coala",
    supplier: SUPPLIER,
    notes: "Acordo financeiro em 25 parcelas de R$ 1.200,00. O financeiro do Coala começa na parcela 5/25, em agosto de 2026; as parcelas 1/25 a 4/25 são anteriores ao corte e não foram recriadas.",
    totalValue: INSTALLMENT_VALUE,
    competenceDate: Timestamp.fromDate(installmentDate(installment.number, 1)),
    dueDate: installment.dueDate,
    paymentMethod: "single",
    installmentType: null,
    installmentPeriodicity: "monthly",
    installmentNumber: installment.number,
    installmentTotal: LAST_INSTALLMENT,
    installments: [{ ...installment, status: "pending" }],
    installmentSchedule: schedule,
    agreementTotalValue: LAST_INSTALLMENT * INSTALLMENT_VALUE,
    agreementInstallmentStart: 1,
    recurrenceGroupId: RECURRENCE_GROUP_ID,
    recurrenceIndex: installment.number,
    recurrenceTotal: LAST_INSTALLMENT,
    isApportioned: false,
    resultCenter: RESULT_CENTER,
    resultCenterId: RESULT_CENTER_ID,
    unitId: UNIT_ID,
    apportionments: null,
    status: "pending",
    originModule: "manual",
    sourceType: "asaas_agreement",
    sourceReference: "785495350",
    sourceKey: `${RECURRENCE_GROUP_ID}__${String(installment.number).padStart(2, "0")}`,
    createdBy: "codex",
    createdAt: now,
    updatedAt: now,
  },
}));

const [accountSnapshot, adminAccountSnapshot, entitySnapshot, expenseSnapshots] = await Promise.all([
  financialDb.collection("accounts").doc(ACCOUNT_ID).get(),
  financialDb.collection("accounts").doc(ADMIN_ACCOUNT_ID).get(),
  mainDb.collection("entities").doc(ENTITY_ID).get(),
  Promise.all(expenseRows.map((row) => financialDb.collection("expenses").doc(row.id).get())),
]);

if (!adminAccountSnapshot.exists || adminAccountSnapshot.data()?.name !== "Administrativo") {
  throw new Error("A conta-pai Administrativo não foi encontrada com o identificador esperado.");
}

if (accountSnapshot.exists && accountSnapshot.data()?.name !== ACCOUNT_NAME) {
  throw new Error(`O identificador ${ACCOUNT_ID} já pertence a outra conta.`);
}

const existingExpenses = expenseSnapshots.filter((snapshot) => snapshot.exists);
if (existingExpenses.length > 0 && existingExpenses.length !== expenseRows.length) {
  throw new Error(`Cadastro parcial detectado: ${existingExpenses.length}/${expenseRows.length} parcelas já existem.`);
}
if (existingExpenses.some((snapshot) => snapshot.data()?.sourceKey !== `${RECURRENCE_GROUP_ID}__${snapshot.id.slice(-2)}`)) {
  throw new Error("Uma parcela existente não pertence ao acordo esperado; nenhuma alteração foi feita.");
}

const summary = {
  mode: EXECUTE ? "execute" : "dry-run",
  account: { id: ACCOUNT_ID, name: ACCOUNT_NAME, action: accountSnapshot.exists ? "keep" : "create" },
  supplier: { id: ENTITY_ID, name: SUPPLIER, action: entitySnapshot.exists ? "keep" : "create" },
  resultCenter: RESULT_CENTER,
  installments: {
    first: `${FIRST_INSTALLMENT}/${LAST_INSTALLMENT}`,
    last: `${LAST_INSTALLMENT}/${LAST_INSTALLMENT}`,
    count: expenseRows.length,
    value: INSTALLMENT_VALUE,
    totalFromCutoff: expenseRows.length * INSTALLMENT_VALUE,
    firstDueDate: installmentDate(FIRST_INSTALLMENT, 15).toISOString(),
    lastDueDate: installmentDate(LAST_INSTALLMENT, 15).toISOString(),
    existing: existingExpenses.length,
  },
};

if (!EXECUTE) {
  console.log(JSON.stringify(summary, null, 2));
  console.log("Dry-run concluído. Use --execute para gravar.");
  process.exit(0);
}

if (!entitySnapshot.exists) {
  await mainDb.collection("entities").doc(ENTITY_ID).create({
    type: "pessoa_juridica",
    name: SUPPLIER,
    fantasyName: "César Thimotheo Advogados",
    document: "23.623.057/0001-42",
    documentNormalized: "23623057000142",
    cnpj: "23623057000142",
    razao_social: SUPPLIER,
    nome_fantasia: "César Thimotheo Advogados",
    address: {
      street: "Avenida Coronel Colares Moreira",
      number: "1",
      complement: "Ed. Adriana, 1º andar",
      neighborhood: "Renascença II",
      city: "São Luís",
      state: "MA",
      zipCode: "65075-440",
    },
    contact: {
      phone: "(98) 3266-1181",
      email: "financeiro@cesarthimotheo.com",
    },
    telefone: "(98) 3266-1181",
    email: "financeiro@cesarthimotheo.com",
    website: "www.cesarthimotheo.com.br",
    status: "active",
    origem_dados: "manual",
    createdAt: nowIso,
    createdBy: "codex",
  });
}

if (existingExpenses.length === 0) {
  const batch = financialDb.batch();
  if (!accountSnapshot.exists) {
    batch.create(financialDb.collection("accounts").doc(ACCOUNT_ID), {
      name: ACCOUNT_NAME,
      description: "Honorários de escritório de advocacia, assessoria e serviços jurídicos.",
      searchTerms: ["advogado", "advocacia", "honorário jurídico", "assessoria jurídica", "serviços jurídicos"],
      group: "administrativo",
      category: "Despesas operacionais",
      parentId: ADMIN_ACCOUNT_ID,
      order: 5,
      active: true,
      isGroup: false,
      is_dre_account: true,
      dre_position: "despesas_operacionais",
      createdAt: now,
      updatedAt: now,
    });
  }
  for (const row of expenseRows) {
    batch.create(financialDb.collection("expenses").doc(row.id), row.data);
  }
  await batch.commit();
}

console.log(JSON.stringify({ ...summary, status: existingExpenses.length === expenseRows.length ? "already_registered" : "registered" }, null, 2));
