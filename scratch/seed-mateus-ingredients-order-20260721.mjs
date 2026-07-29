import { existsSync, readFileSync } from 'node:fs';
import { applicationDefault, cert, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || 'smart-converter-752gf';
const apply = process.argv.includes('--apply');
const sourceRef = 'mateus-mais-paid-20260721-oreo-farinha-ninho-34198';

function credential() {
  if (process.env.FIREBASE_SERVICE_ACCOUNT) return cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT));
  const path = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
  if (path && existsSync(path)) return cert(JSON.parse(readFileSync(path, 'utf8')));
  return applicationDefault();
}
function normalized(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}
function clean(value) {
  if (value?.toDate) return value.toDate().toISOString();
  if (Array.isArray(value)) return value.map(clean);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clean(item)]));
  return value;
}

const app = getApps()[0] ?? initializeApp({ credential: credential(), projectId });
const db = getFirestore(app, 'coala');
const duplicate = await db.collection('purchase_orders').where('sourceRef', '==', sourceRef).get();
if (!duplicate.empty) {
  console.log(JSON.stringify({ status: 'already_exists', sourceRef, orders: duplicate.docs.map((doc) => ({ id: doc.id, ...clean(doc.data()) })) }, null, 2));
  process.exit(0);
}

const now = new Date().toISOString();
const productsSnap = await db.collection('products').where('baseProductId', '==', 'bHtB0kDDidg8q4bVDOwI').get();
const existingFlour = productsSnap.docs.find((doc) => {
  const data = doc.data();
  return Number(data.packageSize) === 360 && normalized(data.brand).includes('nestle');
});
const flourRef = existingFlour?.ref ?? db.collection('products').doc();
const flourProduct = existingFlour?.data() ?? {
  workspaceId: 'coala',
  baseProductId: 'bHtB0kDDidg8q4bVDOwI',
  baseName: 'Farinha Láctea Nestlé Tradicional 360g',
  name: 'Farinha Láctea Nestlé Tradicional 360g',
  brand: 'NESTLÉ',
  barcode: '',
  category: 'Massa',
  packageSize: 360,
  packageType: 'Pacote',
  unit: 'g',
  secondaryUnit: 'g',
  secondaryUnitValue: 360,
  notes: 'Pacote de 360 gramas.',
  defaultCountingUnit: 'package',
  operationalCategoryId: 'insumo',
  operationalCategoryName: 'Perecíveis',
  operationalDestination: 'stock',
  createdAt: now,
  updatedAt: now,
  createdBy: 'script-seed-mateus-ingredients-order-20260721',
};

const order = {
  workspaceId: 'coala',
  sourceRef,
  origin: 'direct',
  quotationId: null,
  supplierId: 'DgUVATAT7BNCasJe7qvL',
  supplierName: 'Hiper Mateus / MATEUS SUPERMERCADOS S.A.',
  receiptMode: 'future_delivery',
  status: 'created',
  purchaseDate: '2026-07-21',
  estimatedReceiptDate: '2026-07-21',
  paymentDueDate: '2026-07-21',
  paymentMethod: 'pix',
  paymentMethodLabel: 'Pix',
  paymentCondition: 'cash',
  installmentsCount: 1,
  installmentDueDates: [],
  deliveryFee: 10,
  totalEstimated: 341.98,
  totalConfirmed: 0,
  freightPaymentMode: 'separate',
  accountPlanId: 'OofGtZoVn15nmmy2xaI8',
  accountPlanName: 'Insumos composição',
  freightAccountPlanId: 'yw96wgNNf695d7GaGfiG',
  freightAccountPlanName: 'Frete | Compras gerais',
  resultCenterId: 'KNKNWZ7tdhIxnrlStRum',
  resultCenterName: 'Centro administrativo - Renascença',
  deliveryAddress: 'Avenida Coronel Colares Moreira, 1 - Jardim Renascença, CEP 65081-000, São Luís/MA',
  externalOrderNumber: null,
  notes: [
    'Compra lançada pelo Codex a partir da tela Meus pedidos do Mateus Mais.',
    'A tela informa pagamento via Pix concluído no valor de R$ 341,98.',
    'Produtos: R$ 331,99. Taxa de serviço: R$ 0,00. Entrega: R$ 10,00. Ajuste de arredondamento do aplicativo: -R$ 0,01.',
    'O pedido foi mantido como Criado para conferência e confirmação manual do recebimento.',
    'Nenhum recebimento, financeiro confirmado, lote, custo efetivo ou movimentação de estoque foi criado.',
  ].join(' '),
  createdAt: now,
  updatedAt: now,
  createdBy: 'script-seed-mateus-ingredients-order-20260721',
};

const common = {
  operationalCategoryId: 'insumo',
  operationalCategoryName: 'Perecíveis',
  itemDestination: 'stock',
  entryType: 'stock',
  itemTreatment: 'stock',
  linkedAssetId: null,
  linkedAssetCode: null,
  linkedAssetName: null,
  componentAction: null,
  purchaseUnitType: 'content',
  quotationItemId: null,
  discountOrdered: 0,
};
const items = [
  {
    baseItemId: 'DxLsiTKFX0FESuJEVFgn', productId: 'ateSC34kOSfSNV4u5C4V', itemName: 'BISC OREO RECH ORIGINAL 144G',
    unit: 'Pacote', purchaseUnitLabel: 'Pacote', quantityOrdered: 20, unitPriceOrdered: 7.39, totalOrdered: 147.80,
  },
  {
    baseItemId: 'bHtB0kDDidg8q4bVDOwI', productId: flourRef.id, itemName: 'Farinha Láctea Nestlé Tradicional 360g',
    unit: 'Pacote', purchaseUnitLabel: 'Pacote', quantityOrdered: 8, unitPriceOrdered: 13.03, totalOrdered: 104.24,
  },
  {
    baseItemId: 'axTQQzmUOfTRVq74zbRY', productId: 'LfWtUdlHZYhNyQiKGTkS', itemName: 'Leite em Pó Ninho Integral Lata 380g',
    unit: 'Lata', purchaseUnitLabel: 'Lata', quantityOrdered: 5, unitPriceOrdered: 15.99, totalOrdered: 79.95,
  },
].map((item) => ({ ...common, ...item, netUnitPriceOrdered: Number((item.totalOrdered / item.quantityOrdered).toFixed(6)), notes: 'Valores transcritos da tela do pedido Mateus Mais.' }));

if (!apply) {
  console.log(JSON.stringify({
    status: 'dry_run', sourceRef, order,
    flourProduct: { id: flourRef.id, exists: Boolean(existingFlour), ...clean(flourProduct) },
    items,
    itemTotal: items.reduce((sum, item) => sum + item.totalOrdered, 0),
    reconciliation: Number((items.reduce((sum, item) => sum + item.totalOrdered, 0) + order.deliveryFee - order.totalEstimated).toFixed(2)),
  }, null, 2));
  process.exit(0);
}

const orderRef = db.collection('purchase_orders').doc();
const batch = db.batch();
if (!existingFlour) batch.set(flourRef, flourProduct);
batch.set(orderRef, order);
items.forEach((item) => batch.set(orderRef.collection('items').doc(), { ...item, purchaseOrderId: orderRef.id }));
await batch.commit();

console.log(JSON.stringify({
  status: 'created', orderId: orderRef.id, sourceRef, itemCount: items.length,
  flourProductId: flourRef.id, flourProductCreated: !existingFlour, totalEstimated: order.totalEstimated,
}, null, 2));
