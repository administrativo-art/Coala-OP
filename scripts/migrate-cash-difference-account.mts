/**
 * Cria, se ausente, a conta-folha usada por perdas operacionais de caixa.
 * O modo padrão é preflight somente leitura. Uma conta existente com contrato
 * diferente bloqueia a migração para impedir reclassificação silenciosa.
 *
 * Uso:
 *   npm run migrate:cash-difference-account
 *   npm run migrate:cash-difference-account -- --execute --confirmation=CREATE-CASH-DIFFERENCE-ACCOUNT-V1
 *   npm run migrate:cash-difference-account -- --parent-id=<grupo-administrativo>
 */
import { FieldPath, Timestamp } from "firebase-admin/firestore";
import { config } from "dotenv";

config({ path: ".env.local" });
const { financialDbAdmin } = await import("../src/lib/firebase-financial-admin");

const ACCOUNT_ID = "cash-differences-operational-loss-v1";
const ACCOUNT_NAME = "Quebras e diferenças de caixa";
const CONFIRMATION = "CREATE-CASH-DIFFERENCE-ACCOUNT-V1";
const execute = process.argv.includes("--execute");
const confirmation = process.argv.find((value) => value.startsWith("--confirmation="))?.split("=")[1];
const parentId = process.argv.find((value) => value.startsWith("--parent-id="))?.split("=")[1] ?? null;
const maxDocs = Number(process.argv.find((value) => value.startsWith("--max-docs="))?.split("=")[1] ?? 500);
if (!Number.isSafeInteger(maxDocs) || maxDocs < 1 || maxDocs > 5_000) {
  throw new Error("--max-docs deve ser um inteiro entre 1 e 5000.");
}

function normalize(value: unknown) {
  return String(value ?? "").normalize("NFD").replace(/\p{Diacritic}/gu, "").trim().toLocaleLowerCase("pt-BR");
}

async function readAccountsBounded() {
  const documents: FirebaseFirestore.QueryDocumentSnapshot[] = [];
  let lastId: string | null = null;
  while (documents.length <= maxDocs) {
    const requestLimit = Math.min(200, maxDocs + 1 - documents.length);
    let query = financialDbAdmin.collection("accounts").orderBy(FieldPath.documentId()).limit(requestLimit);
    if (lastId) query = query.startAfter(lastId);
    const snapshot = await query.get();
    documents.push(...snapshot.docs);
    if (snapshot.size < requestLimit) return documents;
    lastId = snapshot.docs.at(-1)?.id ?? null;
  }
  throw new Error(`accounts excedeu o teto de ${maxDocs} documentos.`);
}

const accountDocuments = await readAccountsBounded();
const accounts = accountDocuments.map((document) => ({ id: document.id, ...document.data() }));
const matches = accounts.filter((account) => normalize(account.name) === normalize(ACCOUNT_NAME));
if (matches.length > 1) throw new Error(`Foram encontradas ${matches.length} contas chamadas ${ACCOUNT_NAME}.`);
const byStableId = accounts.find((account) => account.id === ACCOUNT_ID) ?? null;
const existing = matches[0] ?? byStableId;
if (byStableId && normalize(byStableId.name) !== normalize(ACCOUNT_NAME)) {
  throw new Error(`O identificador ${ACCOUNT_ID} já pertence à conta ${String(byStableId.name)}.`);
}
if (existing && (
  existing.active === false
  || existing.isGroup === true
  || existing.is_dre_account === false
  || existing.dre_position !== "despesas_operacionais"
)) {
  throw new Error(`A conta ${ACCOUNT_NAME} já existe, mas não é uma conta-folha ativa de despesas operacionais.`);
}
const parent = parentId ? accounts.find((account) => account.id === parentId) : null;
if (parentId && (!parent || parent.active === false || parent.isGroup !== true)) {
  throw new Error("--parent-id precisa apontar para um grupo ativo existente.");
}
if (existing && parentId && (existing.parentId ?? null) !== parentId) {
  throw new Error("A conta existente pertence a outro grupo; nenhuma alteração foi feita.");
}
const siblingOrder = accounts
  .filter((account) => (account.parentId ?? null) === parentId)
  .reduce((maximum, account) => Math.max(maximum, Number(account.order ?? -1)), -1) + 1;
const accountId = existing?.id ?? ACCOUNT_ID;
const summary = {
  mode: execute ? "EXECUTION_REQUESTED" : "DRY_RUN",
  scanned: accounts.length,
  readCeiling: maxDocs + 1,
  account: {
    id: accountId,
    name: ACCOUNT_NAME,
    parentId: existing?.parentId ?? parentId,
    dre_position: "despesas_operacionais",
    action: existing ? "keep" : "create",
  },
};
console.log(JSON.stringify(summary, null, 2));
if (!execute || existing) process.exit(0);
if (confirmation !== CONFIRMATION) {
  throw new Error(`Confirmação ausente. Use --confirmation=${CONFIRMATION}. Nenhuma escrita foi iniciada.`);
}

const now = Timestamp.now();
const accountRef = financialDbAdmin.collection("accounts").doc(accountId);
const migrationRef = financialDbAdmin.collection("systemMigrationRuns").doc("cash-difference-account-v1");
const batch = financialDbAdmin.batch();
batch.create(accountRef, {
  name: ACCOUNT_NAME,
  description: "Perdas físicas confirmadas no fechamento de caixa; o efeito financeiro já ocorreu e não gera nova obrigação bancária.",
  parentId,
  order: siblingOrder,
  active: true,
  isGroup: false,
  is_dre_account: true,
  dre_position: "despesas_operacionais",
  group: String(parent?.group ?? "administrative"),
  searchTerms: ["quebra de caixa", "diferença de caixa", "falta de caixa", "perda operacional"],
  createdAt: now,
  updatedAt: now,
});
batch.create(accountRef.collection("events").doc("cash-difference-account-v1"), {
  action: "created_by_migration",
  migrationId: "cash-difference-account-v1",
  actorId: "migration:cash-difference-account-v1",
  createdAt: now,
});
batch.create(migrationRef, {
  id: migrationRef.id,
  type: "cash_difference_account",
  accountId,
  summary,
  createdAt: now,
});
await batch.commit();

const verified = await accountRef.get();
if (!verified.exists || verified.get("dre_position") !== "despesas_operacionais" || verified.get("isGroup") !== false) {
  throw new Error("A verificação da conta criada falhou.");
}
console.log(JSON.stringify({ ...summary, mode: "EXECUTED_AND_VERIFIED" }, null, 2));
