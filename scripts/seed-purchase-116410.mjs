/**
 * Popula a compra do "Pedido força venda Nº 116.410" (C T Sorvetes) como
 * PEDIDO DE COMPRA RASCUNHO (status 'created') na coleção `purchase_orders`.
 *
 * - NÃO toca em financeiro nem estoque (isso só ocorre ao CONFIRMAR no app).
 * - É seguro re-rodar: marca `sourceRef` e não duplica.
 * - Classificação (plano de contas, centro de resultado, conta de pagamento)
 *   fica em branco de propósito — complete no app antes de confirmar.
 *
 * USO:
 *   node scripts/seed-purchase-116410.mjs
 *   (usa scripts/smart-converter-752gf-firebase-adminsdk-fbsvc-aaa18b4778.json,
 *    ou passe --sa=caminho/para/serviceAccount.json)
 */

import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync, existsSync } from 'node:fs';

const WORKSPACE_ID = 'coala';
const SOURCE_REF = 'forca-venda-116410';

function resolveArg(name) {
  const arg = process.argv.find((a) => a.startsWith(`--${name}=`));
  return arg ? arg.split('=')[1] : null;
}

const saPath =
  resolveArg('sa') ?? 'scripts/smart-converter-752gf-firebase-adminsdk-fbsvc-aaa18b4778.json';
if (!existsSync(saPath)) {
  console.error(`❌ Service account não encontrado em: ${saPath}`);
  process.exit(1);
}
const sa = JSON.parse(readFileSync(saPath, 'utf8'));
const app = getApps().find((a) => a.name === 'seed-purchase') ?? initializeApp({ credential: cert(sa) }, 'seed-purchase');
// O projeto usa Firestore multi-database; o banco principal é o named DB "coala".
const db = getFirestore(app, 'coala');

// ─── Dados da nota ────────────────────────────────────────────────────────────
const SUPPLIER = { id: '7LTJflWNJfAZKxKUSRAF', name: 'C T SORVETES LTDA' };
const PURCHASE_DATE = '2026-06-11'; // data de solicitação da nota; pagamento à vista

// productId (confirmado), quantidade, preço unitário e o nome da planilha (referência)
const LINES = [
  { productId: 'uJwW1CrGWHEemL51Ph9g', sheetName: 'NUTELLA 650G FERRERO', qty: 20, price: 39.99 },
  { productId: 'RqukGnuzvW8S0M8534wI', sheetName: 'COBERTURA P/SORVETE CHOCOLATE 1,3KG SELECTA', qty: 12, price: 24.99 },
  { productId: 'JCVymoXMhNFNoiACpwfi', sheetName: 'AMENDOIM TORRADO GRANULADO 1,05KG VABENE', qty: 20, price: 17.69 },
  { productId: 'By10ajCQSKOLlOw1rPQH', sheetName: 'CANUDINHO ROLINHO DE BIJU 1KG NUTRILAR', qty: 4, price: 30.0 },
];

async function main() {
  // Evita duplicar em re-execuções.
  const existing = await db
    .collection('purchase_orders')
    .where('workspaceId', '==', WORKSPACE_ID)
    .where('sourceRef', '==', SOURCE_REF)
    .limit(1)
    .get();
  if (!existing.empty) {
    console.log(`⚠️  Já existe um pedido para ${SOURCE_REF} (id ${existing.docs[0].id}). Nada a fazer.`);
    return;
  }

  // Resolve cada produto (pega baseProductId, unidade, categoria operacional).
  const items = [];
  for (const line of LINES) {
    const snap = await db.collection('products').doc(line.productId).get();
    if (!snap.exists) throw new Error(`Produto ${line.productId} (${line.sheetName}) não encontrado.`);
    const p = snap.data();
    if (!p.baseProductId) throw new Error(`Produto ${line.productId} sem baseProductId.`);

    const itemName = [p.baseName, p.packageSize ? `${p.packageSize}${p.unit || ''}` : '', p.brand]
      .filter(Boolean)
      .join(' ')
      .trim();
    const purchaseUnitLabel = p.packageType || p.unit || 'un';
    const totalOrdered = Math.max(line.qty * line.price, 0);

    items.push({
      baseItemId: p.baseProductId,
      productId: line.productId,
      itemName: itemName || line.sheetName,
      operationalCategoryId: p.operationalCategoryId ?? null,
      operationalCategoryName: p.operationalCategoryName ?? null,
      itemDestination: 'stock',
      entryType: 'stock',
      itemTreatment: 'stock',
      linkedAssetId: null,
      linkedAssetCode: null,
      linkedAssetName: null,
      componentAction: null,
      unit: purchaseUnitLabel,
      purchaseUnitType: 'content',
      purchaseUnitLabel,
      quantityOrdered: line.qty,
      unitPriceOrdered: line.price,
      discountOrdered: 0,
      totalOrdered,
      quotationItemId: null,
      notes: `Importado do force-venda 116.410: ${line.sheetName}`,
    });
  }

  const totalEstimated = Number(items.reduce((s, it) => s + it.totalOrdered, 0).toFixed(2));
  const now = new Date().toISOString();

  const orderRef = db.collection('purchase_orders').doc();
  const orderData = {
    workspaceId: WORKSPACE_ID,
    sourceRef: SOURCE_REF,
    origin: 'direct',
    supplierId: SUPPLIER.id,
    supplierName: SUPPLIER.name,
    status: 'created',
    receiptMode: 'future_delivery',
    estimatedReceiptDate: PURCHASE_DATE,
    paymentDueDate: PURCHASE_DATE,
    purchaseDate: PURCHASE_DATE,
    totalEstimated,
    totalConfirmed: 0,
    deliveryFee: 0,
    paymentCondition: 'cash',
    paymentMethod: 'pix',
    installmentsCount: 1,
    paymentAccountId: null,
    paymentAccountName: null,
    paymentMethodId: null,
    paymentMethodLabel: null,
    accountPlanId: null,
    accountPlanName: null,
    freightAccountPlanId: null,
    freightAccountPlanName: null,
    freightPaymentMode: null,
    resultCenterId: null,
    resultCenterName: null,
    trackingInfo: null,
    quotationId: null,
    invoiceNumber: '116410',
    notes: 'Importado do Pedido força venda Nº 116.410 (Pedido Nº 119.342) — C T Sorvetes. Solicitação 11/06/2026. Pagamento PIX à vista. Revise classificação antes de confirmar.',
    createdAt: now,
    updatedAt: now,
    createdBy: 'script-seed-purchase-116410',
  };

  const batch = db.batch();
  batch.set(orderRef, orderData);
  for (const it of items) {
    const itemRef = orderRef.collection('items').doc();
    batch.set(itemRef, { purchaseOrderId: orderRef.id, ...it });
  }
  await batch.commit();

  console.log('✅ Pedido de compra criado (rascunho):');
  console.log('   id:', orderRef.id);
  console.log('   fornecedor:', SUPPLIER.name);
  console.log('   total:', totalEstimated.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));
  console.log('   itens:');
  for (const it of items) {
    console.log(`   - ${it.itemName} · ${it.quantityOrdered} × R$ ${it.unitPriceOrdered} = R$ ${it.totalOrdered.toFixed(2)}`);
  }
  console.log('\n👉 Abra no app (Compras), revise classificação e confirme para gerar recebimento/financeiro.');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('❌ Falhou:', err);
    process.exit(1);
  });
