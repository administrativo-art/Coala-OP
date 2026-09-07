import { existsSync, readFileSync } from "node:fs";
import { applicationDefault, cert, getApps, initializeApp } from "firebase-admin/app";
import { FieldValue, Timestamp, getFirestore } from "firebase-admin/firestore";

const PROJECT_ID = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "smart-converter-752gf";
const MAIN_DATABASE = process.env.NEXT_PUBLIC_FIREBASE_DATABASE_ID || "coala";
const RECEIPT_ID = "receipt_mateus_202608201707094";
const ORDER_ID = "purchase_mateus_202608201707094";
const BACKUP_ID = "fix-mateus-agua-cancelada-20260905-receivedat-v1";
// Data em que o recebimento físico de fato ficou resolvido: Nesquik/Oreo
// entraram em estoque e a água foi cancelada pelo fornecedor no mesmo dia.
const RECEIVED_AT = Timestamp.fromDate(new Date("2026-08-21T14:55:32.252Z"));
const APPLY = process.argv.includes("--apply");
const ROLLBACK = process.argv.includes("--rollback");

if (APPLY && ROLLBACK) throw new Error("Use apenas --apply ou --rollback.");

function credential() {
  if (process.env.FIREBASE_SERVICE_ACCOUNT) return cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT));
  const path = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
  if (path && existsSync(path)) return cert(JSON.parse(readFileSync(path, "utf8")));
  return applicationDefault();
}

const app = getApps()[0] ?? initializeApp({ credential: credential(), projectId: PROJECT_ID });
const db = getFirestore(app, MAIN_DATABASE);
const backupRef = db.collection("system_migration_backups").doc(BACKUP_ID);

const receiptRef = db.collection("purchase_receipts").doc(RECEIPT_ID);
const orderRef = db.collection("purchase_orders").doc(ORDER_ID);

async function readContext() {
  const [receipt, order] = await Promise.all([receiptRef.get(), orderRef.get()]);
  if (!receipt.exists) throw new Error("Recebimento não encontrado.");
  if (!order.exists) throw new Error("Pedido não encontrado.");
  if (receipt.get("receivedAt")) throw new Error("Recebimento já tem receivedAt — não é o caso esperado.");
  if (order.get("receivedAt")) throw new Error("Pedido já tem receivedAt — não é o caso esperado.");
  if (receipt.get("status") !== "stocked_with_divergence") {
    throw new Error(`status do recebimento esperado "stocked_with_divergence", encontrado "${receipt.get("status")}". Rode primeiro fix-mateus-agua-cancelada-20260905.mjs.`);
  }
  return { receipt, order };
}

async function createBackup(context) {
  if ((await backupRef.get()).exists) throw new Error(`Backup ${BACKUP_ID} já existe; aplicação duplicada bloqueada.`);
  const records = [
    { path: context.receipt.ref.path, data: context.receipt.data() },
    { path: context.order.ref.path, data: context.order.data() },
  ];
  const batch = db.batch();
  batch.create(backupRef, {
    status: "prepared",
    reason: "Pedido/recebimento resolvidos (2 itens estocados em 21/08, água cancelada pelo fornecedor) nunca receberam receivedAt, então o pedido continuava classificado como 'Pedido confirmado' (não 'Recebida') nas telas de Recebimentos/Pedidos de compra, que dependem exclusivamente de order.receivedAt.",
    createdAt: FieldValue.serverTimestamp(),
    recordCount: records.length,
  });
  for (const record of records) {
    batch.create(backupRef.collection("documents").doc(record.path.replace(/\//g, "__")), record);
  }
  await batch.commit();
}

async function restoreBackup(status = "rolled_back") {
  const backup = await backupRef.get();
  if (!backup.exists) throw new Error(`Backup ${BACKUP_ID} não encontrado.`);
  const records = await backupRef.collection("documents").get();
  const batch = db.batch();
  for (const record of records.docs) {
    const data = record.data();
    batch.set(db.doc(data.path), data.data, { merge: false });
  }
  await batch.commit();
  await backupRef.set({ status, restoredAt: FieldValue.serverTimestamp() }, { merge: true });
}

async function verify() {
  const [receipt, order] = await Promise.all([receiptRef.get(), orderRef.get()]);
  if (!receipt.get("receivedAt")) throw new Error("Verificação falhou: receipt.receivedAt não foi setado.");
  if (!order.get("receivedAt")) throw new Error("Verificação falhou: order.receivedAt não foi setado.");
}

if (ROLLBACK) {
  await restoreBackup();
  console.log(`Rollback concluído a partir de ${BACKUP_ID}.`);
  process.exit(0);
}

const context = await readContext();

console.log(JSON.stringify({
  mode: APPLY ? "apply" : "dry-run",
  receiptId: RECEIPT_ID,
  orderId: ORDER_ID,
  receivedAt: RECEIVED_AT.toDate().toISOString(),
  before: { receipt: { receivedAt: null }, order: { receivedAt: null } },
  after: { receipt: { receivedAt: RECEIVED_AT.toDate().toISOString() }, order: { receivedAt: RECEIVED_AT.toDate().toISOString() } },
}, null, 2));

if (!APPLY) {
  console.log("Dry-run concluído. Nenhum dado foi alterado. Rode novamente com --apply para aplicar.");
  process.exit(0);
}

await createBackup(context);
try {
  const batch = db.batch();
  batch.update(receiptRef, { receivedAt: RECEIVED_AT, updatedAt: FieldValue.serverTimestamp() });
  batch.update(orderRef, { receivedAt: RECEIVED_AT, updatedAt: FieldValue.serverTimestamp() });
  await batch.commit();

  await verify();
  await backupRef.set({ status: "applied", appliedAt: FieldValue.serverTimestamp() }, { merge: true });
  console.log(`Correção aplicada e verificada. Backup: ${BACKUP_ID}.`);
} catch (error) {
  await restoreBackup("auto_rolled_back");
  throw new Error(`Correção falhou e foi revertida automaticamente: ${error instanceof Error ? error.message : String(error)}`);
}
