import { existsSync, readFileSync } from "node:fs";
import { applicationDefault, cert, getApps, initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID
  || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID
  || "smart-converter-752gf";
const FINANCIAL_DATABASE = process.env.FINANCIAL_FIRESTORE_DATABASE || "coala-financeiro";
const EXECUTE = process.argv.includes("--execute");
const CONFIRMATION = "CONFIRMO-ESTRUTURA-DARE-2.2";
const PROVIDED_CONFIRMATION = process.argv
  .find((argument) => argument.startsWith("--confirmation="))
  ?.slice("--confirmation=".length);

const DARE_CHILDREN = [
  {
    id: "dare-icms-antecipado",
    name: "ICMS antecipado",
    description: "ICMS antecipado recolhido em DARE estadual, separado do ICMS incluído no DAS.",
    searchTerms: ["DARE", "ICMS antecipado", "antecipação ICMS", "SEFAZ MA", "imposto estadual"],
    dre_position: "impostos_deducoes",
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
  return getApps().find((app) => app.name === "migrate-dare-account-structure")
    ?? initializeApp(
      { credential: loadCredential(), projectId: PROJECT_ID },
      "migrate-dare-account-structure",
    );
}

function normalize(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim()
    .toLowerCase();
}

function accountNumber(accounts, targetId) {
  const path = [];
  const byId = new Map(accounts.map((account) => [account.id, account]));
  const visited = new Set();
  let current = byId.get(targetId);

  while (current) {
    if (visited.has(current.id)) throw new Error(`Ciclo detectado no plano de contas em ${current.name}.`);
    visited.add(current.id);
    const parentId = current.parentId ?? null;
    const siblings = accounts
      .filter((account) => (account.parentId ?? null) === parentId)
      .sort((left, right) => (left.order ?? 0) - (right.order ?? 0) || left.name.localeCompare(right.name, "pt-BR"));
    const index = siblings.findIndex((account) => account.id === current.id);
    if (index < 0) throw new Error(`Não foi possível calcular a numeração de ${current.name}.`);
    path.unshift(index + 1);
    current = parentId ? byId.get(parentId) : undefined;
  }

  return path.join(".");
}

function findUniqueAccount(accounts, name) {
  const matches = accounts.filter((account) => normalize(account.name) === normalize(name));
  if (matches.length !== 1) {
    throw new Error(`Esperava uma única conta chamada ${name}; encontrei ${matches.length}.`);
  }
  return matches[0];
}

const app = getApp();
const db = getFirestore(app, FINANCIAL_DATABASE);
const [accountsSnapshot, expensesByPlanSnapshot, expensesByAccountSnapshot] = await Promise.all([
  db.collection("accounts").get(),
  db.collection("expenses").where("accountPlan", "==", "sFVZ3tcW0tdzg8t8eYSW").get(),
  db.collection("expenses").where("accountId", "==", "sFVZ3tcW0tdzg8t8eYSW").get(),
]);
const accounts = accountsSnapshot.docs.map((document) => ({ id: document.id, ...document.data() }));
const dare = findUniqueAccount(accounts, "DARE");
const dareNumber = accountNumber(accounts, dare.id);
const legacyExpenseIds = new Set([
  ...expensesByPlanSnapshot.docs.map((document) => document.id),
  ...expensesByAccountSnapshot.docs.map((document) => document.id),
]);

if (dare.id !== "sFVZ3tcW0tdzg8t8eYSW") {
  throw new Error(`A conta DARE encontrada possui identificador inesperado: ${dare.id}.`);
}
if (dare.active === false) throw new Error("A conta DARE 2.2 está inativa.");
if (dareNumber !== "2.2") {
  throw new Error(`A conta DARE encontrada está numerada como ${dareNumber}, não como 2.2. Nenhuma alteração foi feita.`);
}
if (legacyExpenseIds.size > 0) {
  throw new Error(`A conta DARE possui ${legacyExpenseIds.size} lançamento(s) direto(s); revise o histórico antes de transformá-la em grupo.`);
}

const operations = DARE_CHILDREN.map((definition, index) => {
  const existingById = accounts.find((account) => account.id === definition.id);
  const existingByName = accounts.find(
    (account) => account.parentId === dare.id && normalize(account.name) === normalize(definition.name),
  );
  const existing = existingByName || existingById || null;
  if (existingById && existingById.parentId !== dare.id) {
    throw new Error(`O identificador ${definition.id} já pertence a uma conta fora de DARE.`);
  }
  if (existing && normalize(existing.name) !== normalize(definition.name)) {
    throw new Error(`O identificador ${definition.id} já pertence à conta ${existing.name}.`);
  }
  return {
    ...definition,
    id: existing?.id || definition.id,
    order: index,
    action: existing ? "update" : "create",
  };
});

const summary = {
  mode: EXECUTE ? "execute" : "dry-run",
  projectId: PROJECT_ID,
  database: FINANCIAL_DATABASE,
  parent: { id: dare.id, number: dareNumber, name: dare.name, action: dare.isGroup === true ? "keep" : "mark-as-group" },
  children: operations.map(({ id, name, dre_position, order, action }) => ({
    id,
    number: `${dareNumber}.${order + 1}`,
    name,
    dre_position,
    action,
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
batch.update(db.collection("accounts").doc(dare.id), {
  isGroup: true,
  description: "Grupo das guias estaduais DARE. Os lançamentos devem usar a subconta correspondente à receita estadual.",
  updatedAt: FieldValue.serverTimestamp(),
});

for (const operation of operations) {
  const reference = db.collection("accounts").doc(operation.id);
  const data = {
    name: operation.name,
    description: operation.description,
    searchTerms: operation.searchTerms,
    parentId: dare.id,
    order: operation.order,
    active: true,
    isGroup: false,
    is_dre_account: true,
    dre_position: operation.dre_position,
    group: dare.group || "fiscal",
    category: dare.category || "Impostos e deduções",
    updatedAt: FieldValue.serverTimestamp(),
  };
  if (operation.action === "create") data.createdAt = FieldValue.serverTimestamp();
  batch.set(reference, data, { merge: true });
}

await batch.commit();

const [verifiedParent, ...verifiedChildren] = await Promise.all([
  db.collection("accounts").doc(dare.id).get(),
  ...operations.map((operation) => db.collection("accounts").doc(operation.id).get()),
]);
if (verifiedParent.data()?.isGroup !== true) throw new Error("A conta DARE não foi convertida em grupo.");
for (const [index, document] of verifiedChildren.entries()) {
  const expected = operations[index];
  const data = document.data();
  if (!document.exists || data.parentId !== dare.id || data.isGroup === true || data.dre_position !== expected.dre_position) {
    throw new Error(`A verificação da subconta ${expected.name} falhou.`);
  }
}

console.log(JSON.stringify({ ...summary, status: "migrated-and-verified" }, null, 2));
