import { existsSync, readFileSync } from 'node:fs';
import { applicationDefault, cert, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || 'smart-converter-752gf';
const apply = process.argv.includes('--apply');
const sourceRef = 'amazon-checkout-20260721-ovomaltine-rocks-15x110g';

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

const supplierId = 'FMbYfsbWCoia6ME11TlG';
const baseItemId = '6bFqoouDA3eWIBTnISK5';
const productId = 'PAQgC9lmv7REZrD9bckz';
const quantityOrdered = 15;
const unitPriceOrdered = 17.49;
const discountOrdered = 26.24;
const totalOrdered = 236.11;
const now = new Date().toISOString();

const order = {
  workspaceId: 'coala',
  sourceRef,
  origin: 'direct',
  quotationId: null,
  supplierId,
  supplierName: 'Amazon Servicos De Varejo Do Brasil Ltda.',
  receiptMode: 'future_delivery',
  status: 'created',
  purchaseDate: '2026-07-21',
  estimatedReceiptDate: '2026-07-25',
  paymentDueDate: '2026-07-21',
  paymentMethod: 'card_credit',
  paymentMethodLabel: 'Cartão Crédito Inter - 1127',
  paymentAccountId: 'PoulVqBxvW6XNgLEeoob',
  paymentAccountName: 'BANCO INTER',
  paymentMethodId: 'aa6d0fd9-a60f-438c-b0bd-6df107c9e8cd',
  paymentCondition: 'cash',
  installmentsCount: 1,
  installmentDueDates: [],
  deliveryFee: 0,
  totalEstimated: totalOrdered,
  totalConfirmed: 0,
  freightPaymentMode: null,
  accountPlanId: 'OofGtZoVn15nmmy2xaI8',
  accountPlanName: 'Insumos composição',
  freightAccountPlanId: '',
  freightAccountPlanName: '',
  resultCenterId: 'KNKNWZ7tdhIxnrlStRum',
  resultCenterName: 'Centro administrativo - Renascença',
  trackingInfo: 'Entrega prevista para sábado, 25/07/2026, com frete grátis.',
  externalOrderNumber: null,
  notes: [
    'Compra lançada pelo Codex a partir da tela de confirmação do checkout Amazon.',
    'Origem ainda exibia o botão “Confirmar pedido com cartão 1127”; por isso o pedido foi mantido como Criado para conferência e confirmação manual.',
    'Produto: OVOMALTINE Chocolate Rocks 110G, vendido e enviado por Amazon.com.br.',
    'Quantidade: 15 pacotes. Preço bruto unitário: R$ 17,49. Itens: R$ 262,35.',
    'Descontos exibidos: +5% Mais por Menos -R$ 13,12 e 5% Mais por Menos -R$ 13,12; desconto total R$ 26,24.',
    'Frete: R$ 0,00. Total do pedido: R$ 236,11, em 1x sem juros.',
    'Entrega prevista: sábado, 25/07/2026.',
    'Endereço exibido: Avenida Coronel Colares Moreira, Ed. Adriana, 1º andar, 1, Pharmapele São Francisco, São Luís/MA, CEP 65075-440.',
    'Nenhum recebimento, financeiro confirmado, lote, custo efetivo ou movimentação de estoque foi criado.',
  ].join(' '),
  createdAt: now,
  updatedAt: now,
  createdBy: 'script-seed-amazon-ovomaltine-20260721',
};

const item = {
  baseItemId,
  productId,
  itemName: 'Ovomaltine Rocks Tradicional 110g',
  operationalCategoryId: 'insumo',
  operationalCategoryName: 'Perecíveis',
  itemDestination: 'stock',
  entryType: 'stock',
  itemTreatment: 'stock',
  linkedAssetId: null,
  linkedAssetCode: null,
  linkedAssetName: null,
  componentAction: null,
  unit: 'Pacote',
  purchaseUnitType: 'content',
  purchaseUnitLabel: 'Pacote',
  quantityOrdered,
  unitPriceOrdered,
  netUnitPriceOrdered: totalOrdered / quantityOrdered,
  discountOrdered,
  totalOrdered,
  quotationItemId: null,
  notes: [
    'OVOMALTINE Chocolate Rocks 110G, vendido e enviado por Amazon.com.br.',
    'Quantidade 15; preço bruto R$ 17,49 por pacote; desconto total R$ 26,24; total líquido R$ 236,11.',
    'Produto vinculado ao derivado cadastrado Ovomaltine Rocks Tradicional 110g, pacote de 110g.',
  ].join(' '),
};

if (!apply) {
  console.log(JSON.stringify({
    status: 'dry_run',
    sourceRef,
    order,
    item,
    calculations: {
      grossTotal: quantityOrdered * unitPriceOrdered,
      netUnitPrice: totalOrdered / quantityOrdered,
      totalWeightGrams: quantityOrdered * 110,
      netPricePerGram: totalOrdered / (quantityOrdered * 110),
    },
  }, null, 2));
  process.exit(0);
}

const orderRef = db.collection('purchase_orders').doc();
const itemRef = orderRef.collection('items').doc();
const batch = db.batch();
batch.set(orderRef, order);
batch.set(itemRef, { ...item, purchaseOrderId: orderRef.id });
await batch.commit();

const [savedOrder, savedItem] = await Promise.all([orderRef.get(), itemRef.get()]);
console.log(JSON.stringify({
  status: 'created',
  orderId: orderRef.id,
  itemId: itemRef.id,
  order: clean(savedOrder.data()),
  item: clean(savedItem.data()),
}, null, 2));
