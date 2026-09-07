import { existsSync, readFileSync } from "node:fs";
import { applicationDefault, cert, getApps, initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";

const PROJECT_ID = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "smart-converter-752gf";
const MAIN_DATABASE = process.env.NEXT_PUBLIC_FIREBASE_DATABASE_ID || "coala";
const RECEIPT_ID = "receipt_mateus_202608201707094";
const RECEIPT_ITEM_ID = "item_03_agua_santa_joana_500ml";
const ORDER_ID = "purchase_mateus_202608201707094";
const BACKUP_ID = "fix-mateus-agua-cancelada-20260905-v1";
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
const itemRef = receiptRef.collection("items").doc(RECEIPT_ITEM_ID);
const orderRef = db.collection("purchase_orders").doc(ORDER_ID);

async function readContext() {
  const [receipt, item, order] = await Promise.all([receiptRef.get(), itemRef.get(), orderRef.get()]);
  if (!receipt.exists) throw new Error("Recebimento não encontrado.");
  if (!item.exists) throw new Error("Item da água não encontrado.");
  if (!order.exists) throw new Error("Pedido não encontrado.");

  if (item.get("quantityReceived") !== 69) throw new Error(`quantityReceived esperado 69, encontrado ${item.get("quantityReceived")}.`);
  if (item.get("status") !== "received") throw new Error(`status do item esperado "received", encontrado "${item.get("status")}".`);
  if (item.get("quantityCancelledBySupplier") !== 69) throw new Error("quantityCancelledBySupplier não confere — item pode não ser o mesmo caso.");
  if (Math.abs(receipt.get("totalConfirmed") - 375.85) > 0.001) throw new Error(`totalConfirmed do recebimento esperado 375.85, encontrado ${receipt.get("totalConfirmed")}.`);
  if (Math.abs(order.get("totalConfirmed") - 375.85) > 0.001) throw new Error(`totalConfirmed do pedido esperado 375.85, encontrado ${order.get("totalConfirmed")}.`);

  return { receipt, item, order };
}

async function createBackup(context) {
  if ((await backupRef.get()).exists) throw new Error(`Backup ${BACKUP_ID} já existe; aplicação duplicada bloqueada.`);
  const records = [
    { path: context.receipt.ref.path, data: context.receipt.data() },
    { path: context.item.ref.path, data: context.item.data() },
    { path: context.order.ref.path, data: context.order.data() },
  ];
  const batch = db.batch();
  batch.create(backupRef, {
    status: "prepared",
    reason: "Água Santa Joana (69un/R$61,41) cancelada pelo fornecedor por falta de estoque; itens de recebimento nunca refletiram o cancelamento (ficaram com quantityReceived/status/totalConfirmed de default), inflando totalConfirmed do recebimento e do pedido em R$61,41.",
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
  const [receipt, item, order] = await Promise.all([receiptRef.get(), itemRef.get(), orderRef.get()]);
  if (item.get("quantityReceived") !== 0) throw new Error("Verificação falhou: quantityReceived do item não ficou 0.");
  if (item.get("status") !== "cancelled") throw new Error("Verificação falhou: status do item não ficou cancelled.");
  if (item.get("receiptDisposition") !== "returned") throw new Error("Verificação falhou: receiptDisposition do item não ficou returned.");
  if (item.get("totalConfirmed") !== 0) throw new Error("Verificação falhou: totalConfirmed do item não ficou 0.");
  if (item.get("quantityPendingStockEntry") !== 0) throw new Error("Verificação falhou: quantityPendingStockEntry do item não ficou 0.");
  if (Math.abs(receipt.get("totalConfirmed") - 314.44) > 0.001) throw new Error("Verificação falhou: totalConfirmed do recebimento não ficou 314.44.");
  if (receipt.get("status") !== "stocked_with_divergence") throw new Error("Verificação falhou: status do recebimento não ficou stocked_with_divergence.");
  if (Math.abs(order.get("totalConfirmed") - 314.44) > 0.001) throw new Error("Verificação falhou: totalConfirmed do pedido não ficou 314.44.");
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
  itemId: RECEIPT_ITEM_ID,
  orderId: ORDER_ID,
  before: {
    item: {
      quantityReceived: context.item.get("quantityReceived"),
      status: context.item.get("status"),
      receiptDisposition: context.item.get("receiptDisposition"),
      totalConfirmed: context.item.get("totalConfirmed"),
      quantityPendingStockEntry: context.item.get("quantityPendingStockEntry"),
    },
    receipt: { totalConfirmed: context.receipt.get("totalConfirmed"), status: context.receipt.get("status") },
    order: { totalConfirmed: context.order.get("totalConfirmed") },
  },
  after: {
    item: { quantityReceived: 0, status: "cancelled", receiptDisposition: "returned", totalConfirmed: 0, quantityPendingStockEntry: 0 },
    receipt: { totalConfirmed: 314.44, status: "stocked_with_divergence" },
    order: { totalConfirmed: 314.44 },
  },
}, null, 2));

if (!APPLY) {
  console.log("Dry-run concluído. Nenhum dado foi alterado. Rode novamente com --apply para aplicar.");
  process.exit(0);
}

await createBackup(context);
try {
  const batch = db.batch();
  batch.update(itemRef, {
    quantityReceived: 0,
    status: "cancelled",
    receiptDisposition: "returned",
    totalConfirmed: 0,
    quantityPendingStockEntry: 0,
    divergenceReason: "Cancelado pelo fornecedor por indisponibilidade (correção retroativa 2026-09-05).",
  });
  batch.update(receiptRef, {
    totalConfirmed: 314.44,
    status: "stocked_with_divergence",
    updatedAt: FieldValue.serverTimestamp(),
  });
  batch.update(orderRef, {
    totalConfirmed: 314.44,
    updatedAt: FieldValue.serverTimestamp(),
  });
  await batch.commit();

  await verify();
  await backupRef.set({ status: "applied", appliedAt: FieldValue.serverTimestamp() }, { merge: true });
  console.log(`Correção aplicada e verificada. Backup: ${BACKUP_ID}.`);
} catch (error) {
  await restoreBackup("auto_rolled_back");
  throw new Error(`Correção falhou e foi revertida automaticamente: ${error instanceof Error ? error.message : String(error)}`);
}
