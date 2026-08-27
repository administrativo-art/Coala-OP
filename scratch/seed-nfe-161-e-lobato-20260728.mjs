import { existsSync, readFileSync } from 'node:fs';
import { applicationDefault, cert, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || 'smart-converter-752gf';
const apply = process.argv.includes('--apply');
const sourceRef = 'nfe-161-e-lobato-20260728';

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

const supplierId = 'SNav2Y4APU8TGumqm3tb'; // E LOBATO (EL SORVETES) — mesmo fornecedor da NF-e 144 já cadastrada
const now = new Date().toISOString();

const order = {
  workspaceId: 'coala',
  sourceRef,
  origin: 'direct',
  quotationId: null,
  supplierId,
  supplierName: 'E LOBATO',
  receiptMode: 'future_delivery',
  status: 'created',
  purchaseDate: '2026-07-28',
  estimatedReceiptDate: '2026-07-28',
  paymentDueDate: '2026-07-29',
  paymentMethod: 'boleto',
  paymentMethodLabel: null,
  paymentAccountId: null,
  paymentAccountName: null,
  paymentMethodId: null,
  paymentCondition: 'cash',
  installmentsCount: 1,
  installmentDueDates: ['2026-07-29'],
  deliveryFee: 0,
  totalEstimated: 6800.00,
  totalConfirmed: 0,
  freightPaymentMode: null,
  invoiceNumber: '161',
  invoiceAccessKey: '21260761490711000186550010000001611100009472',
  fiscal: {
    operationNature: 'Venda Dentro do Estado',
    model: '55',
    series: '1',
    number: '161',
    issuedAt: '2026-07-28',
    protocol: '421260029100896',
    issuerCnpj: '61.490.711/0001-86',
    issuerIe: '129126810',
    issuerName: 'E LOBATO ME',
    issuerCity: 'Imperatriz',
    issuerUf: 'MA',
    recipientName: 'CT SORVETES LTDA',
    recipientCity: 'Sao Luis',
    recipientUf: 'MA',
  },
  accountPlanId: 'OofGtZoVn15nmmy2xaI8',
  accountPlanName: 'Insumos composição',
  freightAccountPlanId: '',
  freightAccountPlanName: '',
  resultCenterId: 'KNKNWZ7tdhIxnrlStRum',
  resultCenterName: 'Centro administrativo - Renascença',
  trackingInfo: '',
  externalOrderNumber: null,
  notes: [
    'Compra lançada a partir do DANFE (foto/PDF) da NF-e nº 161, série 1, emitida em 28/07/2026 por E LOBATO ME (CNPJ 61.490.711/0001-86) para CT SORVETES LTDA.',
    'Chave de acesso: 2126 0761 4907 1100 0186 5500 1000 0001 6111 0000 9472. Protocolo de autorização: 421260029100896.',
    'Pedido: 947. Fatura 001, vencimento 29/07/2026, valor R$ 6.800,00 (à vista, 1 parcela). Forma de pagamento/conta não especificada no DANFE — revisar antes de confirmar.',
    'Itens: 20 UN Bebidas Láctea sabor Baunilha (R$170,00/un = R$3.400,00) e 20 UN Bebidas Láctea sabor Chocolate (R$170,00/un = R$3.400,00). Sem ICMS/IPI destacado (emitente optante pelo Simples Nacional).',
    'Data de entrada/saída no DANFE: 28/07/2026 (mercadoria já entregue). Pedido mantido como Criado para conferência e confirmação manual (recebimento, financeiro e lote de estoque ainda não foram criados).',
  ].join(' '),
  createdAt: now,
  updatedAt: now,
  createdBy: 'script-seed-nfe-161-e-lobato-20260728',
};

const items = [
  {
    baseItemId: 'ns2mRB5Fdso6UKWixfb9',
    productId: 'RMW007po45ByC8CnLUcu',
    itemName: 'BEBIDA LÁCTEA DE BAUNILA',
    operationalCategoryId: 'insumo',
    operationalCategoryName: 'Perecíveis',
    itemDestination: 'stock',
    entryType: 'stock',
    itemTreatment: 'stock',
    linkedAssetId: null,
    linkedAssetCode: null,
    linkedAssetName: null,
    componentAction: null,
    unit: 'Embalagem',
    purchaseUnitType: 'content',
    purchaseUnitLabel: 'Embalagem',
    quantityOrdered: 20,
    unitPriceOrdered: 170.00,
    netUnitPriceOrdered: 170.00,
    discountOrdered: 0,
    totalOrdered: 3400.00,
    quotationItemId: null,
    notes: 'Código NF 17898936742008 (barcode 17898936742008). NCM 04039000. UN, qtd 20, valor unit R$170,00.',
  },
  {
    baseItemId: 'LFamDxr3Go7okT9c3Qgl',
    productId: 'XaaAMTBc8HFbE96E4TRe',
    itemName: 'BEBIDA LÁCTEA DE CHOCOLATE',
    operationalCategoryId: 'insumo',
    operationalCategoryName: 'Perecíveis',
    itemDestination: 'stock',
    entryType: 'stock',
    itemTreatment: 'stock',
    linkedAssetId: null,
    linkedAssetCode: null,
    linkedAssetName: null,
    componentAction: null,
    unit: 'Embalagem',
    purchaseUnitType: 'content',
    purchaseUnitLabel: 'Embalagem',
    quantityOrdered: 20,
    unitPriceOrdered: 170.00,
    netUnitPriceOrdered: 170.00,
    discountOrdered: 0,
    totalOrdered: 3400.00,
    quotationItemId: null,
    notes: 'Código NF 17898936742015 (barcode 17898936742015). NCM 22029900. UN, qtd 20, valor unit R$170,00.',
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
