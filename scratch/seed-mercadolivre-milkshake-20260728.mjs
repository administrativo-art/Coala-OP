import { existsSync, readFileSync } from 'node:fs';
import { applicationDefault, cert, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || 'smart-converter-752gf';
const apply = process.argv.includes('--apply');
const sourceRef = 'mercadolivre-2000014239476263-20260728';

function credential() {
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    return cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT));
  }
  const path = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
  if (path && existsSync(path)) {
    return cert(JSON.parse(readFileSync(path, 'utf8')));
  }
  return applicationDefault();
}

function clean(value) {
  if (value?.toDate) return value.toDate().toISOString();
  if (Array.isArray(value)) return value.map(clean);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clean(item)]));
  }
  return value;
}

const app = getApps()[0] ?? initializeApp({ credential: credential(), projectId });
const db = getFirestore(app, 'coala');

const existing = await db.collection('purchase_orders').where('sourceRef', '==', sourceRef).get();
if (!existing.empty) {
  console.log(JSON.stringify({
    status: 'already_exists',
    sourceRef,
    orders: existing.docs.map((document) => ({ id: document.id, ...clean(document.data()) })),
  }, null, 2));
  process.exit(0);
}

const supplierId = 'kxuQMC1QTu52MpFYLpVf'; // Mercado Livre
const now = new Date().toISOString();

const order = {
  workspaceId: 'coala',
  sourceRef,
  origin: 'direct',
  quotationId: null,
  supplierId,
  supplierName: 'Mercadolivre.Com Atividades De Internet Ltda',
  receiptMode: 'future_delivery',
  status: 'created',
  purchaseDate: '2026-07-28',
  estimatedReceiptDate: '2026-08-04',
  paymentDueDate: '2026-07-28',
  paymentMethod: 'card_credit',
  paymentMethodLabel: 'Cartão Crédito Inter - 1127',
  paymentAccountId: 'PoulVqBxvW6XNgLEeoob',
  paymentAccountName: 'BANCO INTER',
  paymentMethodId: 'aa6d0fd9-a60f-438c-b0bd-6df107c9e8cd',
  paymentCondition: 'cash',
  installmentsCount: 1,
  installmentDueDates: [],
  deliveryFee: 0,
  totalEstimated: 2967.53,
  totalConfirmed: 0,
  freightPaymentMode: null,
  externalOrderNumber: '2000014239476263',
  accountPlanId: '6KgVwllAo3unPAaIvspW',
  accountPlanName: 'Equipamentos e maquinários',
  freightAccountPlanId: '',
  freightAccountPlanName: '',
  resultCenterId: 'KNKNWZ7tdhIxnrlStRum',
  resultCenterName: 'Centro administrativo - Renascença',
  trackingInfo: [
    'Pacote 1 — Batedor Milk Shake Gelateria Sorveteria Potente 1200W Inox: envio no prazo, chega entre 2 e 4 de agosto de 2026.',
    'Pacote 2 — Extensor Inox Resistente Profissional Copo Alto Milk Shake: envio no prazo, chega entre 31/07 e 1/08 de 2026.',
    'Endereço de entrega: Avenida Coronel Colares Moreira 01, São Luís, Maranhão.',
  ].join(' '),
  notes: [
    'Compra lançada a partir de capturas de tela do "Detalhe da compra" e do rastreio do Mercado Livre.',
    'Compra Mercado Livre nº 2000014239476263, 28/07/2026. Pagamento: 1x R$2.967,53 no Mastercard final 1127, pagamento aprovado (transação nº 170052305875).',
    'Produtos (4 unidades no total): Pacote 1 — Batedor Milk Shake Gelateria Sorveteria Potente 1200W Inox, cor Cinza claro, voltagem 220V, 1 unidade, R$2.580,95. Pacote 2 — Extensor Inox Resistente Profissional Copo Alto Milk Shake, 3 unidades, R$386,58 (R$128,86/un).',
    'Frete grátis. Pedido mantido como Criado para conferência e confirmação manual (recebimento, financeiro e patrimônio/estoque ainda não foram criados).',
  ].join(' '),
  createdAt: now,
  updatedAt: now,
  createdBy: 'script-seed-mercadolivre-milkshake-20260728',
};

const items = [
  {
    baseItemId: null,
    productId: null,
    itemName: 'Batedor Milk Shake Gelateria Sorveteria Potente 1200W Inox',
    operationalCategoryId: null,
    operationalCategoryName: 'Patrimônio',
    itemDestination: 'asset',
    entryType: 'asset',
    itemTreatment: 'asset',
    linkedAssetId: null,
    linkedAssetCode: null,
    linkedAssetName: null,
    componentAction: null,
    unit: 'un',
    purchaseUnitType: 'content',
    purchaseUnitLabel: 'un',
    quantityOrdered: 1,
    unitPriceOrdered: 2580.95,
    netUnitPriceOrdered: 2580.95,
    discountOrdered: 0,
    totalOrdered: 2580.95,
    quotationItemId: null,
    notes: 'Cor: Cinza claro. Voltagem: 220V. Sem produto cadastrado em baseProducts — gera patrimônio individual no recebimento.',
  },
  {
    baseItemId: 's0IHZda0vJ0SxKI7HewI',
    productId: 'UVBXuTPU1JRcEynbkcFQ',
    itemName: 'EXTENSOR INOX',
    operationalCategoryId: 'UaVsSf56A2bNRCefHSNT',
    operationalCategoryName: 'Utensílios operacionais',
    itemDestination: 'stock',
    entryType: 'stock',
    itemTreatment: 'stock',
    linkedAssetId: null,
    linkedAssetCode: null,
    linkedAssetName: null,
    componentAction: null,
    unit: 'un',
    purchaseUnitType: 'content',
    purchaseUnitLabel: 'un',
    quantityOrdered: 3,
    unitPriceOrdered: 128.86,
    netUnitPriceOrdered: 128.86,
    discountOrdered: 0,
    totalOrdered: 386.58,
    quotationItemId: null,
    notes: 'Extensor Inox Resistente Profissional Copo Alto Milk Shake. Preço coincide com o último custo confirmado (R$128,86/un, mesmo fornecedor Mercado Livre).',
  },
];

if (!apply) {
  console.log(JSON.stringify({
    status: 'dry_run',
    sourceRef,
    order,
    items,
    checksum: {
      sumItems: items.reduce((acc, item) => acc + item.totalOrdered, 0),
      totalEstimated: order.totalEstimated,
    },
  }, null, 2));
  process.exit(0);
}

const orderRef = db.collection('purchase_orders').doc();
const batch = db.batch();
batch.set(orderRef, order);
const itemRefs = items.map((item) => {
  const itemRef = orderRef.collection('items').doc();
  batch.set(itemRef, { ...item, purchaseOrderId: orderRef.id });
  return itemRef;
});
await batch.commit();

const savedOrder = await orderRef.get();
const savedItems = await Promise.all(itemRefs.map((ref) => ref.get()));
console.log(JSON.stringify({
  status: 'created',
  orderId: orderRef.id,
  order: clean(savedOrder.data()),
  items: savedItems.map((doc) => ({ id: doc.id, ...clean(doc.data()) })),
}, null, 2));
