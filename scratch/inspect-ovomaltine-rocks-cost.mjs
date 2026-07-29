import { existsSync, readFileSync } from "node:fs";
import { applicationDefault, cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "smart-converter-752gf";

function credential() {
  if (process.env.FIREBASE_SERVICE_ACCOUNT) return cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT));
  const path = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
  if (path && existsSync(path)) return cert(JSON.parse(readFileSync(path, "utf8")));
  return applicationDefault();
}

function normalized(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function matches(value) {
  const text = normalized(value);
  return text.includes("ovomaltine") && text.includes("rock");
}

function clean(value) {
  if (value?.toDate) return value.toDate().toISOString();
  if (Array.isArray(value)) return value.map(clean);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clean(item)]));
  return value;
}

const app = getApps()[0] ?? initializeApp({ credential: credential(), projectId });
const db = getFirestore(app, "coala");
const [baseSnap, productSnap, entitySnap] = await Promise.all([
  db.collection("baseProducts").get(),
  db.collection("products").get(),
  db.collection("entities").get(),
]);

const baseMatches = baseSnap.docs.filter((doc) => matches(doc.get("name"))).map((doc) => ({ id: doc.id, ...clean(doc.data()) }));
const productMatches = productSnap.docs.filter((doc) => {
  const data = doc.data();
  return matches(data.baseName) || matches(data.name) || matches(data.nome) || matches(data.description);
}).map((doc) => {
  const data = clean(doc.data());
  return {
    id: doc.id,
    baseName: data.baseName,
    brand: data.brand,
    barcode: data.barcode,
    category: data.category,
    packageSize: data.packageSize,
    unit: data.unit,
    baseProductId: data.baseProductId,
    packageType: data.packageType,
    multiplo_caixa: data.multiplo_caixa,
    rotulo_caixa: data.rotulo_caixa,
  };
});

const baseIds = new Set([
  ...baseMatches.map((item) => item.id),
  ...productMatches.map((item) => item.baseProductId).filter(Boolean),
]);
if (!baseIds.size) throw new Error("Ovomaltine Rocks não localizado no cadastro de insumos.");

const entities = new Map(entitySnap.docs.map((doc) => [doc.id, { id: doc.id, ...clean(doc.data()) }]));
const parentCollections = ['quotations', 'purchase_orders', 'purchase_receipts'];
const parentSnapshots = await Promise.all(parentCollections.map((collection) => db.collection(collection).get()));
const allPurchasingRecords = [];
for (let index = 0; index < parentCollections.length; index += 1) {
  const collection = parentCollections[index];
  for (const parentDoc of parentSnapshots[index].docs) {
    const parent = { id: parentDoc.id, ...clean(parentDoc.data()) };
    const items = await parentDoc.ref.collection('items').get();
    for (const itemDoc of items.docs) {
      if (!baseIds.has(itemDoc.get('baseItemId'))) continue;
      const supplierId = parent.supplierId ?? null;
      const supplier = supplierId ? entities.get(supplierId) : null;
      allPurchasingRecords.push({
        baseItemId: itemDoc.get('baseItemId'),
        collection,
        parentId: parentDoc.id,
        itemId: itemDoc.id,
        supplier: supplier ? {
          id: supplier.id,
          name: supplier.fantasyName || supplier.name,
          legalName: supplier.name,
        } : (parent.supplierName ? { id: supplierId, name: parent.supplierName } : null),
        parent,
        item: clean(itemDoc.data()),
      });
    }
  }
}

const result = [];
for (const baseItemId of baseIds) {
  const [baseDoc, costSnap] = await Promise.all([
    db.collection("baseProducts").doc(baseItemId).get(),
    db.collection("effective_cost_history").where("baseItemId", "==", baseItemId).get(),
  ]);
  const base = baseDoc.exists ? { id: baseDoc.id, ...clean(baseDoc.data()) } : null;
  const products = productSnap.docs
    .filter((doc) => doc.get("baseProductId") === baseItemId)
    .map((doc) => {
      const data = clean(doc.data());
      return {
        id: doc.id,
        baseName: data.baseName,
        brand: data.brand,
        barcode: data.barcode,
        category: data.category,
        packageSize: data.packageSize,
        unit: data.unit,
        baseProductId: data.baseProductId,
        packageType: data.packageType,
        multiplo_caixa: data.multiplo_caixa,
        rotulo_caixa: data.rotulo_caixa,
      };
    });
  const [legacyHistorySnap, ...legacyItemSnaps] = await Promise.all([
    db.collection('priceHistory').where('baseProductId', '==', baseItemId).get(),
    ...products.map((product) => db.collection('purchaseItems').where('productId', '==', product.id).get()),
  ]);
  const legacyHistory = legacyHistorySnap.docs
    .map((doc) => ({ id: doc.id, ...clean(doc.data()) }))
    .sort((a, b) => String(a.confirmedAt).localeCompare(String(b.confirmedAt)));
  const legacyItems = [];
  for (const snap of legacyItemSnaps) {
    for (const itemDoc of snap.docs) {
      const item = { id: itemDoc.id, ...clean(itemDoc.data()) };
      const [sessionSnap] = await Promise.all([
        item.sessionId ? db.collection('purchaseSessions').doc(item.sessionId).get() : Promise.resolve(null),
      ]);
      legacyItems.push({
        item,
        session: sessionSnap?.exists ? { id: sessionSnap.id, ...clean(sessionSnap.data()) } : null,
        supplier: entities.get(item.entityId)?.fantasyName || entities.get(item.entityId)?.name || item.entityId || null,
      });
    }
  }
  const costs = costSnap.docs
    .map((doc) => ({ id: doc.id, ...clean(doc.data()) }))
    .sort((a, b) => String(a.occurredAt).localeCompare(String(b.occurredAt)));

  const records = allPurchasingRecords.filter((record) => record.baseItemId === baseItemId);

  const weightedQuantity = costs.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
  const weightedTotal = costs.reduce((sum, item) => sum + Number(item.unitCost || 0) * Number(item.quantity || 0), 0);
  const simpleAverage = costs.length ? costs.reduce((sum, item) => sum + Number(item.unitCost || 0), 0) / costs.length : null;
  const weightedAverage = weightedQuantity > 0 ? weightedTotal / weightedQuantity : null;
  const latest = costs.at(-1) ?? null;

  result.push({
    baseItemId,
    base,
    products,
    calculations: {
      receivedLots: costs.length,
      totalBaseQuantity: weightedQuantity,
      totalEffectiveValue: weightedTotal,
      weightedAverage,
      simpleAverage,
      latestEffectiveUnitCost: latest?.unitCost ?? base?.lastEffectivePrice?.pricePerUnit ?? null,
      latestOccurredAt: latest?.occurredAt ?? base?.lastEffectivePrice?.confirmedAt ?? null,
      baseUnit: base?.unit ?? null,
    },
    effectiveCosts: costs.map((cost) => ({
      ...cost,
      supplier: entities.get(cost.supplierId)?.fantasyName || entities.get(cost.supplierId)?.name || cost.supplierId,
    })),
    legacyPriceHistory: legacyHistory.map((entry) => ({
      ...entry,
      supplier: entities.get(entry.entityId)?.fantasyName || entities.get(entry.entityId)?.name || entry.entityId,
    })),
    legacyPurchaseItems: legacyItems,
    purchasingRecords: records,
  });
}

console.log(JSON.stringify({ projectId, matches: result }, null, 2));
