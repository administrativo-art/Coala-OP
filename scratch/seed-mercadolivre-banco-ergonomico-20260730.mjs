import { existsSync, readFileSync } from 'node:fs';
import { applicationDefault, cert, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || 'smart-converter-752gf';
const apply = process.argv.includes('--apply');
const sourceRef = 'mercadolivre-2000017670161156-20260730';

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
  purchaseDate: '2026-07-30',
  estimatedReceiptDate: '2026-08-13',
  paymentDueDate: '2026-07-30',
  paymentMethod: 'card_credit',
  paymentMethodLabel: 'Cartão Crédito Inter - 1127',
  paymentAccountId: 'PoulVqBxvW6XNgLEeoob',
  paymentAccountName: 'BANCO INTER',
  paymentMethodId: 'aa6d0fd9-a60f-438c-b0bd-6df107c9e8cd',
  paymentCondition: 'installments',
  installmentsCount: 8,
  installmentDueDates: [],
  deliveryFee: 0,
  totalEstimated: 439.00,
  totalConfirmed: 0,
  freightPaymentMode: null,
  externalOrderNumber: '2000017670161156',
  accountPlanId: '6KgVwllAo3unPAaIvspW',
  accountPlanName: 'Equipamentos e maquinários',
  freightAccountPlanId: '',
  freightAccountPlanName: '',
  resultCenterId: 'KNKNWZ7tdhIxnrlStRum',
  resultCenterName: 'Centro administrativo - Renascença',
  trackingInfo: 'Pedido confirmado, entrega agendada entre 7 e 13 de agosto de 2026 (vendedor planejando o envio). Endereço: Avenida Coronel Colares Moreira 01, Renascença, São Luís, Maranhão.',
  notes: [
    'Compra lançada a partir de captura de tela do "Status da compra" do Mercado Livre.',
    'Compra Mercado Livre nº 2000017670161156, 30/07/2026. Pagamento: 8x R$54,88 no Mastercard final 1127, pagamento aprovado (transação nº 171253385088).',
    'Produto: Banco Semi Sentado Ergonômico Urban Office Com Encosto, Em Couro Sintético Preto, 1 unidade. Preço de R$649,00 com desconto à vista de R$210,00 = R$439,00. Frete grátis (economia de R$21,99).',
    'NF-e não disponível no momento da compra.',
    'Pedido mantido como Criado para conferência e confirmação manual (recebimento, financeiro e patrimônio ainda não foram criados).',
  ].join(' '),
  createdAt: now,
  updatedAt: now,
  createdBy: 'script-seed-mercadolivre-banco-ergonomico-20260730',
};

const items = [
  {
    baseItemId: null,
    productId: null,
    itemName: 'Banco Semi Sentado Ergonômico Urban Office Com Encosto, Em Couro Sintético Preto',
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
    unitPriceOrdered: 649.00,
    netUnitPriceOrdered: 439.00,
    discountOrdered: 210.00,
    totalOrdered: 439.00,
    quotationItemId: null,
    notes: 'Cor: Preto. Material do estofamento: Couro Sintético. Sem produto cadastrado em baseProducts — gera patrimônio individual no recebimento.',
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
