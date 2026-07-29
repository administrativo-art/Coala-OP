import { existsSync, readFileSync } from 'node:fs';
import { applicationDefault, cert, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || 'smart-converter-752gf';
const apply = process.argv.includes('--apply');
const sourceRef = 'mateus-mais-separated-20260721-1432-1458-26539';

function credential() {
  if (process.env.FIREBASE_SERVICE_ACCOUNT) return cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT));
  const path = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
  if (path && existsSync(path)) return cert(JSON.parse(readFileSync(path, 'utf8')));
  return applicationDefault();
}
function clean(value) {
  if (value?.toDate) return value.toDate().toISOString();
  if (Array.isArray(value)) return value.map(clean);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clean(item)]));
  return value;
}
function normalized(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

const app = getApps()[0] ?? initializeApp({ credential: credential(), projectId });
const db = getFirestore(app, 'coala');
const existing = await db.collection('purchase_orders').where('sourceRef', '==', sourceRef).get();
if (!existing.empty) {
  console.log(JSON.stringify({ status: 'already_exists', sourceRef, orders: existing.docs.map((doc) => ({ id: doc.id, ...clean(doc.data()) })) }, null, 2));
  process.exit(0);
}

const now = new Date().toISOString();
const productTemplates = [
  {
    key: 'detergent', baseProductId: 'SmiUv7WVoHIYGZck7O7F', baseName: 'Detergente Líquido Coco', brand: 'Minuano',
    packageSize: 1, packageType: 'Frasco', unit: 'un', notes: 'Frasco de 500ml.',
  },
  {
    key: 'disinfectant', baseProductId: 'xga210xmWaHOuNz3BrOM', baseName: 'Desinfetante Lavanda', brand: 'Dulago',
    packageSize: 1, packageType: 'Frasco', unit: 'un', notes: 'Frasco de 1 litro.',
  },
  {
    key: 'paper_towel', baseProductId: 'YufBDYzX1EbqlemOVjVu', baseName: 'Papel Toalha Folha Dupla', brand: 'Malu',
    packageSize: 2, packageType: 'Pacote', unit: 'un', notes: 'Pacote com 2 rolos.',
  },
];

const productsSnap = await db.collection('products').get();
const resolvedProducts = {};
const productsToCreate = [];
for (const template of productTemplates) {
  const match = productsSnap.docs.find((doc) => {
    const data = doc.data();
    return data.baseProductId === template.baseProductId && normalized(data.brand) === normalized(template.brand) && normalized(data.baseName) === normalized(template.baseName);
  });
  if (match) {
    resolvedProducts[template.key] = { id: match.id, ...clean(match.data()) };
  } else {
    const ref = db.collection('products').doc();
    const data = {
      workspaceId: 'coala',
      baseProductId: template.baseProductId,
      baseName: template.baseName,
      name: `${template.baseName} ${template.brand}`,
      brand: template.brand,
      barcode: '',
      category: 'Unidade',
      packageSize: template.packageSize,
      packageType: template.packageType,
      unit: template.unit,
      notes: template.notes,
      defaultCountingUnit: 'package',
      operationalCategoryId: 'material-limpeza',
      operationalCategoryName: 'Material de limpeza',
      operationalDestination: 'stock',
      createdAt: now,
      updatedAt: now,
      createdBy: 'script-seed-mateus-order-20260721',
    };
    resolvedProducts[template.key] = { id: ref.id, ...data };
    productsToCreate.push({ ref, data });
  }
}

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
  deliveryFee: 5,
  totalEstimated: 265.39,
  totalConfirmed: 0,
  freightPaymentMode: 'separate',
  accountPlanId: 'OofGtZoVn15nmmy2xaI8',
  accountPlanName: 'Insumos composição',
  freightAccountPlanId: 'yw96wgNNf695d7GaGfiG',
  freightAccountPlanName: 'Frete | Compras gerais',
  resultCenterId: 'KNKNWZ7tdhIxnrlStRum',
  resultCenterName: 'Centro administrativo - Renascença',
  trackingInfo: 'Pedido em separação em 21/07/2026; atualização exibida às 14:58.',
  externalOrderNumber: null,
  notes: [
    'Compra lançada pelo Codex a partir da tela do pedido Mateus Mais.',
    'A origem exibia pagamento concluído e pedido separado; o registro interno foi mantido como Criado para conferência do recebimento e confirmação manual.',
    'Itens: R$ 260,40. Entrega: R$ 5,00. Ajuste de arredondamento do aplicativo: -R$ 0,01. Total pago: R$ 265,39.',
    'Forma de pagamento registrada: Pix.',
    'Nenhum recebimento, financeiro confirmado, lote, custo efetivo ou movimentação de estoque foi criado.',
  ].join(' '),
  createdAt: now,
  updatedAt: now,
  createdBy: 'script-seed-mateus-order-20260721',
};

const common = {
  itemDestination: 'stock', entryType: 'stock', itemTreatment: 'stock', linkedAssetId: null, linkedAssetCode: null,
  linkedAssetName: null, componentAction: null, unit: 'un', purchaseUnitType: 'content', quotationItemId: null, discountOrdered: 0,
};
const items = [
  { baseItemId: 'YgZfBRPaKUWf2JU7X1ag', productId: 'GRpg4cil8L2YlbPPuXpK', itemName: 'Água Mineral sem Gás Santa Joana 500ml', operationalCategoryId: 'insumo', operationalCategoryName: 'Perecíveis', purchaseUnitLabel: 'Unidade', quantityOrdered: 120, unitPriceOrdered: 0.89, totalOrdered: 106.80 },
  { baseItemId: 'SmiUv7WVoHIYGZck7O7F', productId: resolvedProducts.detergent.id, itemName: 'Detergente Líquido Coco Minuano 500ml', operationalCategoryId: 'material-limpeza', operationalCategoryName: 'Material de limpeza', purchaseUnitLabel: 'Frasco', quantityOrdered: 8, unitPriceOrdered: 1.99, totalOrdered: 15.92 },
  { baseItemId: 'xga210xmWaHOuNz3BrOM', productId: resolvedProducts.disinfectant.id, itemName: 'Desinfetante Lavanda Dulago 1L', operationalCategoryId: 'material-limpeza', operationalCategoryName: 'Material de limpeza', purchaseUnitLabel: 'Frasco', quantityOrdered: 4, unitPriceOrdered: 3.29, totalOrdered: 13.16 },
  { baseItemId: 'YufBDYzX1EbqlemOVjVu', productId: resolvedProducts.paper_towel.id, itemName: 'Papel Toalha Malu Folha Dupla 2 Unidades', operationalCategoryId: 'material-limpeza', operationalCategoryName: 'Material de limpeza', purchaseUnitLabel: 'Pacote', quantityOrdered: 20, unitPriceOrdered: 3.99, totalOrdered: 79.80 },
  { baseItemId: 'NY1m8JDqZmE9HvYgcvb9', productId: 'qH1H8GUZU7fY8P2wji4q', itemName: 'Limpador Multiuso Veja Gold Original 500ml', operationalCategoryId: 'material-limpeza', operationalCategoryName: 'Material de limpeza', purchaseUnitLabel: 'Frasco', quantityOrdered: 8, unitPriceOrdered: 5.59, totalOrdered: 44.72, notes: 'Preço unitário já considera o desconto de 10% exibido no pedido.' },
].map((item) => ({ ...common, ...item, netUnitPriceOrdered: item.totalOrdered / item.quantityOrdered, notes: item.notes || 'Valores transcritos do pedido Mateus Mais.' }));

if (!apply) {
  console.log(JSON.stringify({ status: 'dry_run', sourceRef, order, productsToCreate: productsToCreate.map(({ ref, data }) => ({ id: ref.id, ...data })), items, itemTotal: items.reduce((sum, item) => sum + item.totalOrdered, 0) }, null, 2));
  process.exit(0);
}

const orderRef = db.collection('purchase_orders').doc();
const batch = db.batch();
productsToCreate.forEach(({ ref, data }) => batch.set(ref, data));
batch.set(orderRef, order);
items.forEach((item) => {
  const itemRef = orderRef.collection('items').doc();
  batch.set(itemRef, { ...item, purchaseOrderId: orderRef.id });
});
await batch.commit();

console.log(JSON.stringify({ status: 'created', orderId: orderRef.id, sourceRef, createdProducts: productsToCreate.map(({ ref }) => ref.id), itemCount: items.length, totalEstimated: order.totalEstimated }, null, 2));
