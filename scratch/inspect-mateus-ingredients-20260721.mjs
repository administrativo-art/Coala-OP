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
const [bases, products, orders] = await Promise.all([
  db.collection('baseProducts').get(),
  db.collection('products').get(),
  db.collection('purchase_orders').get(),
]);
const tokens = ['oreo', 'biscoito recheado', 'farinha lactea', 'ninho', 'leite em po integral'];
const match = (data) => {
  const value = normalized([data.name, data.baseName, data.brand, data.description, data.notes].filter(Boolean).join(' '));
  return tokens.some((token) => value.includes(token));
};

const matchedProducts = products.docs.filter((doc) => match(doc.data()));
if (process.argv.includes('--products-only')) {
  console.log(JSON.stringify(matchedProducts.map((doc) => ({
    id: doc.id,
    baseProductId: doc.get('baseProductId'),
    baseName: doc.get('baseName'),
    brand: doc.get('brand'),
    packageSize: doc.get('packageSize'),
    packageType: doc.get('packageType'),
    unit: doc.get('unit'),
    operationalCategoryId: doc.get('operationalCategoryId'),
    operationalCategoryName: doc.get('operationalCategoryName'),
  })), null, 2));
  process.exit(0);
}
const referencedProductIds = new Set(matchedProducts.docs?.map?.((doc) => doc.id) || matchedProducts.map((doc) => doc.id));
const relatedOrders = [];
for (const order of orders.docs) {
  const items = await order.ref.collection('items').get();
  const related = items.docs.filter((item) => referencedProductIds.has(item.get('productId')) || match({ name: item.get('itemName') }));
  if (related.length) {
    relatedOrders.push({
      id: order.id,
      supplierName: order.get('supplierName'),
      purchaseDate: clean(order.get('purchaseDate')),
      status: order.get('status'),
      items: related.map((item) => ({ id: item.id, ...clean(item.data()) })),
    });
  }
}

console.log(JSON.stringify({
  bases: bases.docs.filter((doc) => match(doc.data())).map((doc) => ({ id: doc.id, name: doc.get('name'), unit: doc.get('unit'), category: doc.get('category') })),
  products: matchedProducts.map((doc) => ({
    id: doc.id,
    baseProductId: doc.get('baseProductId'),
    baseName: doc.get('baseName'),
    brand: doc.get('brand'),
    packageSize: doc.get('packageSize'),
    packageType: doc.get('packageType'),
    unit: doc.get('unit'),
    operationalCategoryId: doc.get('operationalCategoryId'),
    operationalCategoryName: doc.get('operationalCategoryName'),
  })),
  relatedOrders: relatedOrders.sort((a, b) => String(b.purchaseDate).localeCompare(String(a.purchaseDate))).slice(0, 12),
}, null, 2));
