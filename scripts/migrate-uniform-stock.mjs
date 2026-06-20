import fs from "node:fs";
import process from "node:process";

import { cert, getApps, initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || "smart-converter-752gf";
const DATABASE_ID = process.env.FIRESTORE_DATABASE || "coala";
const WORKSPACE_ID = process.env.WORKSPACE_ID || "coala";
const UNIFORM_STOCK_ID = "__uniform_stock__";
const UNIFORM_STOCK_NAME = "Estoque de uniformes";
const apply = process.argv.includes("--apply");

function credentials() {
  const path = process.env.FIREBASE_SERVICE_ACCOUNT_PATH ||
    "./scripts/smart-converter-752gf-firebase-adminsdk-fbsvc-aaa18b4778.json";
  if (!fs.existsSync(path)) {
    throw new Error(`Credencial não encontrada em ${path}.`);
  }
  return JSON.parse(fs.readFileSync(path, "utf8"));
}

function keyPart(value) {
  return String(value ?? "").trim().replace(/[\/\s]+/g, "_").replace(/[^a-zA-Z0-9_.-]/g, "");
}

function targetLotId(productId, lotNumber) {
  return `uniform_${keyPart(productId)}__novo__disponivel__${keyPart(lotNumber || "sem_lote") || "sem_lote"}`;
}

const app = getApps()[0] ?? initializeApp({
  credential: cert(credentials()),
  projectId: PROJECT_ID,
});
const db = getFirestore(app, DATABASE_ID);

const [productsSnap, lotsSnap, profilesSnap] = await Promise.all([
  db.collection("products").get(),
  db.collection("lots").get(),
  db.collection("profiles").get(),
]);

const uniformProductIds = new Set(
  productsSnap.docs
    .filter((doc) => {
      const data = doc.data();
      return data.operationalDestination === "uniform" || data.category === "Vestimenta";
    })
    .map((doc) => doc.id),
);

const productsById = new Map(productsSnap.docs.map((doc) => [doc.id, doc.data()]));

const sourceLots = lotsSnap.docs.filter((doc) => {
  const data = doc.data();
  return uniformProductIds.has(data.productId) &&
    data.kioskId !== UNIFORM_STOCK_ID &&
    Number(data.quantity ?? 0) > 0;
});

const profileChanges = profilesSnap.docs.map((doc) => {
  const data = doc.data();
  const permissions = data.permissions ?? {};
  const inventory = permissions.stock?.inventoryControl ?? {};
  const collaborators = permissions.dp?.collaborators ?? {};
  const isAdmin = data.isDefaultAdmin === true;
  return {
    ref: doc.ref,
    id: doc.id,
    name: data.name ?? doc.id,
    uniforms: {
      view: isAdmin || inventory.view === true || collaborators.view === true,
      deliver: isAdmin || inventory.writeDown === true || collaborators.edit === true,
      return: isAdmin || inventory.writeDown === true || collaborators.edit === true,
      dispose: isAdmin || inventory.writeDown === true,
      manageEvaluation: isAdmin || inventory.editLot === true,
    },
  };
});

console.log(JSON.stringify({
  mode: apply ? "apply" : "dry-run",
  uniformProducts: uniformProductIds.size,
  lotsToMigrate: sourceLots.map((doc) => ({
    id: doc.id,
    productId: doc.data().productId,
    productName: doc.data().productName,
    fromKioskId: doc.data().kioskId,
    quantity: Number(doc.data().quantity ?? 0),
    targetLotId: targetLotId(doc.data().productId, doc.data().lotNumber),
  })),
  profilePermissions: profileChanges.map(({ id, name, uniforms }) => ({ id, name, uniforms })),
}, null, 2));

if (!apply) {
  console.log("Dry-run concluído. Execute novamente com --apply para efetivar.");
  process.exit(0);
}

for (const sourceDoc of sourceLots) {
  await db.runTransaction(async (tx) => {
    const freshSource = await tx.get(sourceDoc.ref);
    if (!freshSource.exists) return;
    const source = freshSource.data();
    const quantity = Number(source.quantity ?? 0);
    if (quantity <= 0 || source.kioskId === UNIFORM_STOCK_ID) return;

    const targetRef = db.collection("lots").doc(targetLotId(source.productId, source.lotNumber));
    const product = productsById.get(source.productId) ?? {};
    tx.set(targetRef, {
      workspaceId: WORKSPACE_ID,
      productId: source.productId,
      productName: source.productName,
      lotNumber: source.lotNumber || "",
      expiryDate: source.expiryDate ?? null,
      kioskId: UNIFORM_STOCK_ID,
      quantity: FieldValue.increment(quantity),
      condition: "novo",
      uniformStockStatus: "disponivel",
      apparelType: product.apparelType ?? null,
      apparelSize: product.apparelSize ?? null,
      apparelColor: product.apparelColor ?? null,
      imageUrl: product.imageUrl ?? null,
      updatedAt: new Date().toISOString(),
    }, { merge: true });
    tx.update(sourceDoc.ref, {
      quantity: 0,
      migratedToUniformStock: true,
      migratedToLotId: targetRef.id,
      migratedAt: new Date().toISOString(),
    });
    tx.set(db.collection("movementHistory").doc(), {
      lotId: targetRef.id,
      productId: source.productId,
      productName: source.productName,
      lotNumber: source.lotNumber || "",
      type: "MIGRACAO_ESTOQUE_UNIFORME",
      quantityChange: quantity,
      fromKioskId: source.kioskId,
      toKioskId: UNIFORM_STOCK_ID,
      toKioskName: UNIFORM_STOCK_NAME,
      userId: "system",
      username: "Migração de uniformes",
      timestamp: new Date().toISOString(),
      sourceType: "uniform_stock_migration",
      sourceId: sourceDoc.id,
      itemClass: "uniform",
    });
  });
}

for (const profile of profileChanges) {
  await profile.ref.update({
    "permissions.stock.uniforms": profile.uniforms,
    updatedAt: new Date().toISOString(),
  });
}

console.log(`Migração concluída: ${sourceLots.length} lote(s) e ${profileChanges.length} perfil(is).`);
