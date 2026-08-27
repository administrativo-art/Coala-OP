import { existsSync, readFileSync } from 'node:fs';
import { applicationDefault, cert, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || 'smart-converter-752gf';
function credential() {
  if (process.env.FIREBASE_SERVICE_ACCOUNT) return cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT));
  const path = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
  if (path && existsSync(path)) return cert(JSON.parse(readFileSync(path, 'utf8')));
  return applicationDefault();
}
function normalized(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}
function clean(value) {
  if (value?.toDate) return value.toDate().toISOString();
  if (Array.isArray(value)) return value.map(clean);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clean(item)]));
  return value;
}

const app = getApps()[0] ?? initializeApp({ credential: credential(), projectId });
const db = getFirestore(app, 'coala');
const [entitiesSnap, basesSnap, productsSnap, ordersSnap] = await Promise.all([
  db.collection('entities').get(),
  db.collection('baseProducts').get(),
  db.collection('products').get(),
  db.collection('purchase_orders').get(),
]);

const tokens = ['agua mineral', 'santa joana', 'detergente', 'minuano', 'desinfetante', 'dulago', 'papel toalha', 'malu', 'multiuso', 'veja gold'];
const matchesTokens = (data) => {
  const haystack = normalized([data.name, data.baseName, data.brand, data.description, data.nome, data.category].filter(Boolean).join(' '));
  return tokens.some((token) => haystack.includes(token));
};

const recentMateusOrderDocs = ordersSnap.docs
  .filter((document) => normalized(`${document.get('supplierName')} ${document.get('notes')} ${document.get('sourceRef')}`).includes('mateus'))
  .sort((left, right) => {
    const rightDate = String(right.get('purchaseDate') || right.get('createdAt') || '');
    const leftDate = String(left.get('purchaseDate') || left.get('createdAt') || '');
    return rightDate.localeCompare(leftDate);
  })
  .slice(0, 10);
const recentMateusOrders = await Promise.all(recentMateusOrderDocs.map(async (document) => {
  const items = await document.ref.collection('items').get();
  return {
    id: document.id,
    supplierId: document.get('supplierId'),
    supplierName: document.get('supplierName'),
    purchaseDate: clean(document.get('purchaseDate')),
    status: document.get('status'),
    paymentMethod: document.get('paymentMethod'),
    receiptMode: document.get('receiptMode'),
    accountPlanId: document.get('accountPlanId'),
    accountPlanName: document.get('accountPlanName'),
    freightAccountPlanId: document.get('freightAccountPlanId'),
    freightAccountPlanName: document.get('freightAccountPlanName'),
    resultCenterId: document.get('resultCenterId'),
    resultCenterName: document.get('resultCenterName'),
    items: items.docs.map((item) => ({
      id: item.id,
      baseItemId: item.get('baseItemId'),
      productId: item.get('productId'),
      itemName: item.get('itemName'),
      operationalCategoryId: item.get('operationalCategoryId'),
      operationalCategoryName: item.get('operationalCategoryName'),
      itemDestination: item.get('itemDestination'),
      unit: item.get('unit'),
      purchaseUnitType: item.get('purchaseUnitType'),
      purchaseUnitLabel: item.get('purchaseUnitLabel'),
    })),
  };
}));

console.log(JSON.stringify({
  entities: entitiesSnap.docs
    .filter((document) => normalized(`${document.get('name')} ${document.get('fantasyName')}`).includes('mateus'))
    .map((document) => ({ id: document.id, ...clean(document.data()) })),
  bases: basesSnap.docs
    .filter((document) => matchesTokens(document.data()))
    .map((document) => ({
      id: document.id,
      name: document.get('name'),
      category: document.get('category'),
      unit: document.get('unit'),
      classification: document.get('classification'),
    })),
  products: productsSnap.docs
    .filter((document) => matchesTokens(document.data()))
    .map((document) => ({
      id: document.id,
      baseName: document.get('baseName'),
      brand: document.get('brand'),
      barcode: document.get('barcode'),
      packageSize: document.get('packageSize'),
      packageType: document.get('packageType'),
      unit: document.get('unit'),
      baseProductId: document.get('baseProductId'),
      operationalCategoryId: document.get('operationalCategoryId'),
      operationalCategoryName: document.get('operationalCategoryName'),
      operationalDestination: document.get('operationalDestination'),
    })),
  recentMateusOrders,
}, null, 2));
