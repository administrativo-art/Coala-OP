import { existsSync, readFileSync } from "node:fs";
import { applicationDefault, cert, getApps, initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID
  || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID
  || "smart-converter-752gf";
const FINANCIAL_DATABASE = process.env.FINANCIAL_FIRESTORE_DATABASE || "coala-financeiro";
const EXECUTE = process.argv.includes("--execute");
const CONFIRMATION = "CONFIRMO-ESTRUTURA-DAS-2.1";
const PROVIDED_CONFIRMATION = process.argv
  .find((argument) => argument.startsWith("--confirmation="))
  ?.slice("--confirmation=".length);

const DAS_CHILDREN = [
  {
    id: "das-componente-icms",
    name: "ICMS do DAS",
    description: "Parcela de ICMS identificada na composição do Documento de Arrecadação do Simples Nacional.",
    searchTerms: ["ICMS", "Simples Nacional", "DAS"],
    dre_position: "impostos_deducoes",
  },
  {
    id: "das-componente-cofins",
    name: "Cofins do DAS",
    description: "Parcela de Cofins identificada na composição do Documento de Arrecadação do Simples Nacional.",
    searchTerms: ["Cofins", "Simples Nacional", "DAS"],
    dre_position: "impostos_deducoes",
  },
  {
    id: "das-componente-pis",
    name: "PIS/Pasep do DAS",
    description: "Parcela de PIS/Pasep identificada na composição do Documento de Arrecadação do Simples Nacional.",
    searchTerms: ["PIS", "Pasep", "Simples Nacional", "DAS"],
    dre_position: "impostos_deducoes",
  },
  {
    id: "das-componente-cpp",
    name: "CPP do DAS",
    description: "Contribuição Patronal Previdenciária identificada na composição do Documento de Arrecadação do Simples Nacional.",
    searchTerms: ["CPP", "INSS patronal", "previdenciária", "Simples Nacional", "DAS"],
    dre_position: "pessoal",
  },
  {
    id: "das-componente-irpj",
    name: "IRPJ do DAS",
    description: "Parcela de IRPJ identificada na composição do Documento de Arrecadação do Simples Nacional.",
    searchTerms: ["IRPJ", "Simples Nacional", "DAS"],
    dre_position: "impostos_resultado",
  },
  {
    id: "das-componente-csll",
    name: "CSLL do DAS",
    description: "Parcela de CSLL identificada na composição do Documento de Arrecadação do Simples Nacional.",
    searchTerms: ["CSLL", "Simples Nacional", "DAS"],
    dre_position: "impostos_resultado",
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
  return getApps().find((app) => app.name === "migrate-das-account-structure")
    ?? initializeApp(
      { credential: loadCredential(), projectId: PROJECT_ID },
      "migrate-das-account-structure",
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
const snapshot = await db.collection("accounts").get();
const accounts = snapshot.docs.map((document) => ({ id: document.id, ...document.data() }));
const das = findUniqueAccount(accounts, "DAS");
const dasNumber = accountNumber(accounts, das.id);

if (das.active === false) throw new Error("A conta DAS 2.1 está inativa.");
if (dasNumber !== "2.1") {
  throw new Error(`A conta DAS encontrada está numerada como ${dasNumber}, não como 2.1. Nenhuma alteração foi feita.`);
}

const existingByName = new Map(
  accounts
    .filter((account) => account.parentId === das.id)
    .map((account) => [normalize(account.name), account]),
);
const operations = DAS_CHILDREN.map((definition, index) => {
  const existingById = accounts.find((account) => account.id === definition.id);
  const existing = existingByName.get(normalize(definition.name)) || existingById || null;
  if (existingById && existingById.parentId !== das.id) {
    throw new Error(`O identificador ${definition.id} já pertence a uma conta fora de DAS.`);
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
  parent: { id: das.id, number: dasNumber, name: das.name, action: das.isGroup === true ? "keep" : "mark-as-group" },
  children: operations.map(({ id, name, dre_position, order, action }) => ({
    id,
    number: `${dasNumber}.${order + 1}`,
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
batch.update(db.collection("accounts").doc(das.id), {
  isGroup: true,
  updatedAt: FieldValue.serverTimestamp(),
});

for (const operation of operations) {
  const reference = db.collection("accounts").doc(operation.id);
  const data = {
    name: operation.name,
    description: operation.description,
    searchTerms: operation.searchTerms,
    parentId: das.id,
    order: operation.order,
    active: true,
    isGroup: false,
    is_dre_account: true,
    dre_position: operation.dre_position,
    group: das.group || "fiscal",
    updatedAt: FieldValue.serverTimestamp(),
  };
  if (operation.action === "create") data.createdAt = FieldValue.serverTimestamp();
  batch.set(reference, data, { merge: true });
}

await batch.commit();

const verification = await Promise.all(
  operations.map((operation) => db.collection("accounts").doc(operation.id).get()),
);
for (const [index, document] of verification.entries()) {
  const expected = operations[index];
  if (!document.exists) throw new Error(`A subconta ${expected.name} não foi criada.`);
  const data = document.data();
  if (data.parentId !== das.id || data.dre_position !== expected.dre_position || data.active === false) {
    throw new Error(`A verificação da subconta ${expected.name} falhou.`);
  }
}

console.log(JSON.stringify({ ...summary, status: "migrated-and-verified" }, null, 2));
