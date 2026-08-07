import { NextRequest, NextResponse } from 'next/server';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { addMonths } from 'date-fns';

import { dbAdmin } from '@/lib/firebase-admin';
import { financialDbAdmin } from '@/lib/firebase-financial-admin';
import { requireUser, type ServerUserContext } from '@/lib/auth-server';
import { PURCHASING_COLLECTIONS } from '@/lib/purchasing-constants';
import {
  canCancelPurchase,
  canCreatePurchase,
  canCreateQuotation,
  canFinalizeQuotation,
  canManagePurchaseFinancials,
  canReceivePurchase,
  canViewPurchasing,
} from '@/lib/purchasing-permissions';
import {
  calculatePricePerBaseUnit,
  calculateStockQuantityFromPurchase,
} from '@/lib/purchasing-units';
import {
  getPurchaseComponentActionLabel,
  getTreatmentEntryType,
  inferPurchaseItemTreatment,
  purchaseTreatmentCreatesAsset,
  purchaseTreatmentSkipsOperationalEntry,
} from '@/lib/purchasing-item-treatment';
import {
  UNIFORM_STOCK_ID,
  UNIFORM_STOCK_NAME,
  uniformLotId,
} from '@/lib/uniform';
import {
  type Product,
  type BaseProduct,
  type PurchaseDivergenceExcessBillingMode,
  type PurchaseDivergenceResolutionAction,
  type PurchaseItemTreatment,
  type PurchaseStockEntryType,
} from '@/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const WORKSPACE_ID = process.env.NEXT_PUBLIC_WORKSPACE_ID ?? process.env.WORKSPACE_ID ?? 'coala';

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

// Lançamento só é válido em conta folha e ativa: a DRE lê a posição da própria
// conta, então grupo/inativa geraria classificação perdida.
async function validateAccountPlanForPosting(accountPlanId: unknown): Promise<string | null> {
  if (!accountPlanId || typeof accountPlanId !== 'string') return null;
  const doc = await financialDbAdmin.collection('accounts').doc(accountPlanId).get();
  if (!doc.exists) return 'Plano de contas informado não existe.';
  if (doc.data()?.active === false) return 'Plano de contas informado está inativo.';
  const children = await financialDbAdmin
    .collection('accounts')
    .where('parentId', '==', accountPlanId)
    .limit(1)
    .get();
  if (!children.empty) return 'Selecione uma conta específica do plano de contas, não um grupo.';
  return null;
}

async function getUserContext(request: NextRequest) {
  try {
    return await requireUser(request);
  } catch {
    return null;
  }
}

function isAllowed(
  context: ServerUserContext,
  check: (permissions: ServerUserContext['permissions']) => boolean,
) {
  return context.isDefaultAdmin || check(context.permissions);
}

function canPostPath(context: ServerUserContext, path: string[]) {
  const [resource, id, child] = path;
  if (resource === 'barcode' && id === 'lookup') {
    return isAllowed(context, (permissions) =>
      canCreateQuotation(permissions) || canCreatePurchase(permissions));
  }
  if (resource === 'quotations' && !id) {
    return isAllowed(context, canCreateQuotation);
  }
  if (resource === 'quotations' && child === 'items') {
    return isAllowed(context, canCreateQuotation);
  }
  if (resource === 'quotations' && child === 'finalize') {
    return isAllowed(context, canFinalizeQuotation);
  }
  if (resource === 'quotations' && child === 'cancel') {
    return isAllowed(context, (permissions) =>
      canCreateQuotation(permissions) || canFinalizeQuotation(permissions));
  }
  if (resource === 'orders' && !id) {
    return isAllowed(context, canCreatePurchase);
  }
  if (resource === 'orders' && child === 'confirm') {
    return isAllowed(context, canCreatePurchase);
  }
  if (resource === 'orders' && child === 'cancel') {
    return isAllowed(context, canCancelPurchase);
  }
  if (resource === 'orders' && child === 'mark-received-elsewhere') {
    return isAllowed(context, canReceivePurchase);
  }
  if (resource === 'orders' && child === 'sync-expense') {
    return isAllowed(context, canManagePurchaseFinancials);
  }
  if (resource === 'receipts') {
    return isAllowed(context, canReceivePurchase);
  }
  return null;
}

function permissionError() {
  return jsonError('Sem permissão para esta operação de compras.', 403);
}

function docData(doc: FirebaseFirestore.DocumentSnapshot) {
  return doc.exists ? { id: doc.id, ...doc.data() } : null;
}

function collectionData(snapshot: FirebaseFirestore.QuerySnapshot) {
  return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
}

function buildExpenseInstallments(
  totalValue: number,
  count: number,
  firstDueDateIso: string,
  installmentDueDates?: string[],
) {
  const safeCount = Math.max(2, count);
  const baseValue = Number.parseFloat((totalValue / safeCount).toFixed(2));
  const diff = Number.parseFloat((totalValue - baseValue * safeCount).toFixed(2));
  const firstDueDate = new Date(firstDueDateIso);
  const customDates =
    installmentDueDates?.length === safeCount
      ? installmentDueDates.map((date) => new Date(date))
      : null;

  return Array.from({ length: safeCount }, (_, index) => {
    const value = index === safeCount - 1 ? Number.parseFloat((baseValue + diff).toFixed(2)) : baseValue;
    return {
      number: index + 1,
      dueDate: Timestamp.fromDate(customDates?.[index] ?? addMonths(firstDueDate, index)),
      value,
      status: 'pending',
    };
  });
}

function normalizeFreightPaymentMode(
  deliveryFee: number,
  rawValue: unknown,
): 'included_with_goods' | 'separate' | null {
  if (!(deliveryFee > 0)) return null;
  return rawValue === 'included_with_goods' ? 'included_with_goods' : 'separate';
}

function purchaseLineNetTotal(item: Record<string, any>) {
  const quantity = Number(item.quantityOrdered ?? 0);
  const unitPrice = Number(item.unitPriceOrdered ?? 0);
  const discount = Number(item.discountOrdered ?? 0);
  return Math.max(quantity * unitPrice - discount, 0);
}

function purchaseLineEffectiveUnitPrice(item: Record<string, any>) {
  const quantity = Number(item.quantityOrdered ?? 0);
  if (!(quantity > 0)) return Number(item.unitPriceOrdered ?? 0);

  const total =
    item.totalOrdered != null
      ? Math.max(Number(item.totalOrdered ?? 0), 0)
      : purchaseLineNetTotal(item);

  return Number((total / quantity).toFixed(6));
}

function normalizePurchaseStockEntryType(value: unknown): PurchaseStockEntryType {
  return value === 'asset' || value === 'uniform' ? value : 'stock';
}

function normalizePurchaseItemTreatment(item: Record<string, any>): PurchaseItemTreatment {
  const raw = item.itemTreatment;
  if (raw === 'service') return 'expense';
  if (
    raw === 'stock' ||
    raw === 'uniform' ||
    raw === 'asset' ||
    raw === 'asset_component' ||
    raw === 'expense'
  ) {
    return raw;
  }

  return inferPurchaseItemTreatment({
    entryType: normalizePurchaseStockEntryType(item.entryType),
    itemDestination: normalizePurchaseStockEntryType(item.itemDestination),
  });
}

function normalizeItemDestination(item: Record<string, any>): PurchaseStockEntryType {
  return getTreatmentEntryType(normalizePurchaseItemTreatment(item));
}

function purchaseItemTreatmentFields(item: Record<string, any>) {
  const itemTreatment = normalizePurchaseItemTreatment(item);
  return {
    itemTreatment,
    linkedAssetId: item.linkedAssetId ?? null,
    linkedAssetCode: item.linkedAssetCode ?? null,
    linkedAssetName: item.linkedAssetName ?? null,
    componentAction: item.componentAction ?? null,
  };
}

const DIVERGENCE_RESOLUTION_LABELS: Record<PurchaseDivergenceResolutionAction, string> = {
  accept_charged: 'Aceitar excedente/diferença com cobrança',
  bonus: 'Registrar excedente como bonificação',
  return_excess: 'Marcar excedente para devolução',
  keep_pending: 'Manter saldo pendente',
  close_shortage: 'Fechar saldo como não entregue',
  request_replacement: 'Solicitar reposição',
  credit_discount: 'Registrar crédito/desconto',
  correct_entry: 'Corrigir lançamento',
};

function normalizeDivergenceResolutionAction(value: unknown): PurchaseDivergenceResolutionAction | null {
  return typeof value === 'string' && value in DIVERGENCE_RESOLUTION_LABELS
    ? (value as PurchaseDivergenceResolutionAction)
    : null;
}

function normalizeDivergenceExcessBillingMode(value: unknown): PurchaseDivergenceExcessBillingMode {
  return value === 'custom_unit_price' ? 'custom_unit_price' : 'same_unit_price';
}

function isClosingDivergenceAction(action?: PurchaseDivergenceResolutionAction | null) {
  return (
    action === 'accept_charged' ||
    action === 'bonus' ||
    action === 'return_excess' ||
    action === 'close_shortage' ||
    action === 'credit_discount' ||
    action === 'correct_entry'
  );
}

function itemHasCommercialDivergence(item: Record<string, any>) {
  const quantityReceived = Number(item.quantityReceived ?? 0);
  const quantityOrdered = Number(item.quantityOrdered ?? 0);
  const unitPriceConfirmed = Number(item.unitPriceConfirmed ?? 0);
  const unitPriceOrdered = Number(item.unitPriceOrdered ?? 0);
  return (
    Math.abs(quantityReceived - quantityOrdered) > 0.001 ||
    Math.abs(unitPriceConfirmed - unitPriceOrdered) > 0.01 ||
    !!item.divergenceReason ||
    item.receiptDisposition === 'receive_less' ||
    item.receiptDisposition === 'receive_more' ||
    item.receiptDisposition === 'exchange_pending' ||
    item.receiptDisposition === 'returned' ||
    item.status === 'divergent'
  );
}

function chargeableReceiptItemTotal(item: Record<string, any>) {
  const action = normalizeDivergenceResolutionAction(item.divergenceResolutionAction);
  const quantityReceived = Number(item.quantityReceived ?? 0);
  const quantityOrdered = Number(item.quantityOrdered ?? quantityReceived);
  const unitPriceConfirmed = Number(item.unitPriceConfirmed ?? item.unitPriceOrdered ?? 0);

  if (action === 'bonus' || action === 'return_excess') {
    return Math.max(Math.min(quantityReceived, quantityOrdered), 0) * unitPriceConfirmed;
  }

  if (action === 'accept_charged' && quantityReceived > quantityOrdered) {
    const orderedQuantity = Math.max(quantityOrdered, 0);
    const excessQuantity = Math.max(quantityReceived - quantityOrdered, 0);
    const excessBillingMode = normalizeDivergenceExcessBillingMode(item.divergenceExcessBillingMode);
    const excessUnitPrice =
      excessBillingMode === 'custom_unit_price'
        ? Number(item.divergenceExcessUnitPrice ?? unitPriceConfirmed)
        : unitPriceConfirmed;
    return orderedQuantity * unitPriceConfirmed + excessQuantity * excessUnitPrice;
  }

  return Math.max(quantityReceived, 0) * unitPriceConfirmed;
}

function buildPurchaseAuditNotes(orderData: Record<string, any>) {
  const goodsAmount = Number(orderData.totalEstimated ?? 0) - Number(orderData.deliveryFee ?? 0);
  const freightAmount = Number(orderData.deliveryFee ?? 0);
  const freightMode = normalizeFreightPaymentMode(freightAmount, orderData.freightPaymentMode);
  const modeLabel =
    freightAmount > 0
      ? freightMode === 'included_with_goods'
        ? 'Frete pago junto com a mercadoria.'
        : 'Frete previsto para pagamento separado.'
      : 'Pedido sem frete financeiro.';
  const freightPlanLabel =
    freightAmount > 0 ? orderData.freightAccountPlanName ?? 'Plano de contas do frete não definido.' : null;

  const auditBlock = [
    '[AUDITORIA DE COMPRAS PENDENTE] Revise parcelamento, conta financeira e liquidação.',
    `Mercadorias: ${goodsAmount.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}.`,
    freightAmount > 0
      ? `Frete: ${freightAmount.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}.`
      : null,
    modeLabel,
    freightPlanLabel,
  ]
    .filter(Boolean)
    .join('\n');

  return orderData.notes ? `${orderData.notes}\n\n${auditBlock}` : auditBlock;
}

async function readCollection(collectionName: string) {
  const snapshot = await dbAdmin
    .collection(collectionName)
    .where('workspaceId', '==', WORKSPACE_ID)
    .get();
  return collectionData(snapshot);
}

async function compareQuotations(baseItemId: string | null) {
  if (!baseItemId) return jsonError('baseItemId obrigatório.');

  const activeQuotes = await dbAdmin
    .collection('quotations')
    .where('workspaceId', '==', WORKSPACE_ID)
    .where('status', 'in', ['quoted', 'partially_converted'])
    .get();
  const quoteById = new Map(activeQuotes.docs.map((doc) => [doc.id, { id: doc.id, ...doc.data() }]));
  if (quoteById.size === 0) return NextResponse.json([]);

  const rows = await Promise.all(
    [...quoteById.keys()].map(async (quotationId) => {
      const itemSnap = await dbAdmin
        .collection('quotations')
        .doc(quotationId)
        .collection('items')
        .where('baseItemId', '==', baseItemId)
        .get();
      return itemSnap.docs.map((doc) => {
        const quotation = quoteById.get(quotationId) as Record<string, unknown>;
        return {
          id: doc.id,
          quotationId,
          ...doc.data(),
          supplierId: quotation.supplierId,
          validUntil: quotation.validUntil ?? null,
          mode: quotation.mode,
        };
      });
    }),
  );

  return NextResponse.json(
    rows
      .flat()
      .sort((a: Record<string, any>, b: Record<string, any>) => (a.unitPrice ?? 0) - (b.unitPrice ?? 0)),
  );
}

async function lookupBarcode(rawBarcode: string | null) {
  const barcode = rawBarcode?.trim();
  if (!barcode) return jsonError('barcode obrigatório.');
  if (/^2\d{7,12}$/.test(barcode)) {
    return NextResponse.json({ found: false, scaleBarcode: true, barcode });
  }

  const direct = await dbAdmin.collection('baseProducts').where('barcode', '==', barcode).limit(1).get();
  if (!direct.empty) return NextResponse.json({ found: true, item: { id: direct.docs[0].id, ...direct.docs[0].data() } });

  const arrayMatch = await dbAdmin.collection('baseProducts').where('barcodes', 'array-contains', barcode).limit(1).get();
  if (!arrayMatch.empty) return NextResponse.json({ found: true, item: { id: arrayMatch.docs[0].id, ...arrayMatch.docs[0].data() } });

  return NextResponse.json({ found: false, scaleBarcode: false, barcode });
}

async function internalSyncExpense(orderId: string, orderData: any, uid: string) {
  const supplierSnap = orderData.supplierId ? await dbAdmin.collection('entities').doc(orderData.supplierId).get() : null;
  const supplier = supplierSnap?.data() as Record<string, any> | undefined;

  const financialSnap = await financialDbAdmin
    .collection('expenses')
    .where('purchaseOrderId', '==', orderId)
    .limit(1)
    .get();

  const totalValue = Number(orderData.totalEstimated ?? 0);
  const basePayload = {
    description: `Compra ${supplier?.fantasyName || supplier?.name || orderData.supplierId || orderId}`,
    supplier: supplier?.fantasyName || supplier?.name || '',
    accountPlan: orderData.accountPlanId ?? '',
    accountPlanName: orderData.accountPlanName ?? '',
    paymentAccountId: orderData.paymentAccountId ?? null,
    paymentAccountName: orderData.paymentAccountName ?? null,
    paymentMethodId: orderData.paymentMethodId ?? null,
    paymentMethodLabel: orderData.paymentMethodLabel ?? null,
    totalValue,
    dueDate: Timestamp.fromDate(new Date(orderData.paymentDueDate)),
    competenceDate: Timestamp.fromDate(new Date(orderData.createdAt ?? orderData.paymentDueDate)),
    paymentMethod: orderData.paymentCondition === 'installments' ? 'installments' : 'single',
    installments:
      orderData.paymentCondition === 'installments'
          ? buildExpenseInstallments(
              totalValue,
              Number(orderData.installmentsCount ?? 2),
              orderData.paymentDueDate,
              orderData.installmentDueDates,
            )
        : null,
    installmentType: orderData.paymentCondition === 'installments' ? 'equal' : null,
    installmentPeriodicity: orderData.paymentCondition === 'installments' ? 'monthly' : null,
    firstInstallmentDueDate:
      orderData.paymentCondition === 'installments' ? Timestamp.fromDate(new Date(orderData.paymentDueDate)) : null,
    isApportioned: false,
    resultCenter: orderData.resultCenterId ?? null,
    apportionments: null,
    notes: buildPurchaseAuditNotes(orderData),
    status: 'pending',
    originModule: 'purchasing',
    originStatus: 'pending_audit',
    purchaseOrderId: orderId,
    purchaseFinancialStatus: orderData.paymentCondition === 'installments' ? 'installments_pending_audit' : 'pending_audit',
    createdBy: uid,
    updatedAt: Timestamp.now(),
  };

  let expenseId: string;
  if (financialSnap.empty) {
    const expenseRef = financialDbAdmin.collection('expenses').doc();
    expenseId = expenseRef.id;
    await expenseRef.set({ ...basePayload, createdAt: Timestamp.now() });
  } else {
    const existing = financialSnap.docs[0];
    expenseId = existing.id;
    await existing.ref.set(basePayload, { merge: true });
  }

  await Promise.all([
    dbAdmin.collection('purchase_orders').doc(orderId).set({ linkedExpenseId: expenseId }, { merge: true }),
    dbAdmin
      .collection('purchase_financials')
      .where('purchaseOrderId', '==', orderId)
      .get()
      .then((snapshot) =>
        Promise.all(snapshot.docs.map((doc) => doc.ref.set({ linkedExpenseId: expenseId }, { merge: true }))),
      ),
  ]);

  return expenseId;
}

export async function GET(request: NextRequest, context: { params: Promise<{ path?: string[] }> }) {
  const path = (await context.params).path ?? [];
  const [resource, id, child, childId] = path;
  const userContext = await getUserContext(request);
  if (!userContext) return jsonError('Não autorizado.', 401);
  if (!isAllowed(userContext, canViewPurchasing)) return permissionError();

  if (resource === 'barcode' && id === 'lookup') {
    return lookupBarcode(request.nextUrl.searchParams.get('barcode'));
  }

  if (resource === 'quotations' && id === 'compare') {
    return compareQuotations(request.nextUrl.searchParams.get('baseItemId'));
  }

  if (resource === 'classification-options') {
    const [accountPlansSnap, resultCentersSnap, bankAccountsSnap] = await Promise.all([
      financialDbAdmin.collection('accounts').get(),
      financialDbAdmin.collection('resultCenters').get(),
      financialDbAdmin.collection('bankAccounts').get(),
    ]);

    const paymentCards = bankAccountsSnap.docs
      .map((doc) => ({ id: doc.id, ...doc.data() } as any))
      .filter((account) => account.active !== false)
      .flatMap((account) =>
        (Array.isArray(account.paymentMethods) ? account.paymentMethods : [])
          .filter((method: any) => method.type === 'credit_card' || method.type === 'debit_card')
          .map((method: any) => ({
            accountId: account.id,
            accountName: account.name ?? '',
            methodId: method.id,
            methodLabel: method.label ?? '',
            type: method.type,
            lastDigits: method.lastDigits ?? '',
          })),
      );

    return NextResponse.json({
      accountPlans: accountPlansSnap.docs
        .map((doc) => ({ id: doc.id, ...doc.data() }))
        .filter((plan: any) => plan.active !== false),
      resultCenters: resultCentersSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() })),
      paymentCards,
    });
  }

  if ((resource === 'quotations' || resource === 'receipts' || resource === 'orders') && id && child === 'items') {
    const collectionName = resource === 'quotations' ? 'quotations' : resource === 'receipts' ? 'purchase_receipts' : 'purchase_orders';
    if (childId) {
      const doc = await dbAdmin.collection(collectionName).doc(id).collection('items').doc(childId).get();
      return NextResponse.json(docData(doc));
    }
    const snapshot = await dbAdmin.collection(collectionName).doc(id).collection('items').get();
    return NextResponse.json(collectionData(snapshot));
  }

  const collectionName =
    resource === 'quotations'
      ? 'quotations'
      : resource === 'orders'
      ? 'purchase_orders'
      : resource === 'receipts'
      ? 'purchase_receipts'
      : null;

  if (!collectionName) return jsonError('Recurso inválido.', 404);

  if (!id) return NextResponse.json(await readCollection(collectionName));
  const doc = await dbAdmin.collection(collectionName).doc(id).get();
  return NextResponse.json(docData(doc));
}

export async function POST(request: NextRequest, context: { params: Promise<{ path?: string[] }> }) {
  const path = (await context.params).path ?? [];
  const [resource, id, child] = path;
  const userContext = await getUserContext(request);
  if (!userContext) return jsonError('Não autorizado.', 401);
  const canPost = canPostPath(userContext, path);
  if (canPost === false) return permissionError();
  const decoded = userContext.decoded;
  const body = await request.json().catch(() => ({}));
  const now = new Date().toISOString();

  if (resource === 'barcode' && id === 'lookup') {
    return lookupBarcode(body.barcode ?? null);
  }

  if (resource === 'quotations' && !id) {
    const ref = dbAdmin.collection('quotations').doc();
    const quotationData = {
      workspaceId: WORKSPACE_ID,
      supplierId: body.supplierId || null,
      mode: body.mode || 'open',
      validUntil: body.validUntil || null,
      notes: body.notes || null,
      status: 'draft',
      createdAt: now,
      updatedAt: now,
      createdBy: decoded.uid,
    };
    await ref.set(quotationData);
    return NextResponse.json({ id: ref.id }, { status: 201 });
  }

  if (resource === 'quotations' && id && child === 'items') {
    const quotationRef = dbAdmin.collection('quotations').doc(id);
    const quotationSnap = await quotationRef.get();
    if (!quotationSnap.exists) return jsonError('Cotação não encontrada.', 404);
    const itemRef = quotationRef.collection('items').doc();
    const quantity = Number(body.quantity ?? 0);
    const unitPrice = Number(body.unitPrice ?? 0);
    const discount = Number(body.discount ?? 0);
    const itemDestination = normalizeItemDestination(body);
    await itemRef.set({
      quotationId: id,
      baseItemId: body.baseItemId ?? null,
      productId: body.productId ?? null,
      itemName: body.itemName ?? null,
      operationalCategoryId: body.operationalCategoryId ?? null,
      operationalCategoryName: body.operationalCategoryName ?? null,
      itemDestination,
      freeText: body.freeText ?? null,
      barcode: body.barcode ?? null,
      unit: body.unit || '',
      purchaseUnitType: body.purchaseUnitType ?? 'content',
      purchaseUnitLabel: body.purchaseUnitLabel ?? body.unit ?? '',
      quantity,
      unitPrice,
      discount,
      totalPrice: Math.max(quantity * unitPrice - discount, 0),
      deliveryEstimateDays: body.deliveryEstimateDays ?? null,
      observation: body.observation ?? null,
      conversionStatus: body.conversionStatus ?? 'pending',
      createdAt: now,
      updatedAt: now,
      createdBy: decoded.uid,
    });
    return NextResponse.json({ id: itemRef.id }, { status: 201 });
  }

  if (resource === 'quotations' && id && child === 'finalize') {
    const quotationRef = dbAdmin.collection('quotations').doc(id);
    const quotationSnap = await quotationRef.get();
    if (!quotationSnap.exists) return jsonError('Cotação não encontrada.', 404);

    const quotation = quotationSnap.data()!;
    if (quotation.status !== 'draft') return jsonError('Apenas cotações em rascunho podem ser finalizadas.', 400);

    const selectedItemIds = new Set(Array.isArray(body.selectedItemIds) ? body.selectedItemIds : []);
    if (selectedItemIds.size === 0) return jsonError('Selecione ao menos um item normalizado para finalizar a cotação.', 400);

    const itemsSnap = await quotationRef.collection('items').get();
    const selectedItems = itemsSnap.docs.filter((itemDoc) => selectedItemIds.has(itemDoc.id));
    if (selectedItems.length !== selectedItemIds.size) return jsonError('Um ou mais itens selecionados não pertencem à cotação.', 400);
    if (selectedItems.some((itemDoc) => !itemDoc.data().baseItemId)) {
      return jsonError('Itens livres precisam ser normalizados antes da finalização.', 400);
    }

    const batch = dbAdmin.batch();
    batch.update(quotationRef, {
      status: 'quoted',
      finalizedAt: now,
      archivedAt: null,
      updatedAt: now,
    });

    for (const itemDoc of itemsSnap.docs) {
      batch.update(itemDoc.ref, {
        conversionStatus: selectedItemIds.has(itemDoc.id) ? 'selected' : 'discarded',
        updatedAt: now,
      });
    }

    await batch.commit();
    return NextResponse.json({ ok: true });
  }

  if (resource === 'quotations' && id && child === 'cancel') {
    const quotationRef = dbAdmin.collection('quotations').doc(id);
    const quotationSnap = await quotationRef.get();
    if (!quotationSnap.exists) return jsonError('Cotação não encontrada.', 404);

    await quotationRef.update({
      status: 'cancelled',
      cancelledAt: now,
      updatedAt: now,
    });
    return NextResponse.json({ ok: true });
  }

  if (resource === 'orders' && !id) {
    for (const accountField of [body.accountPlanId, body.freightAccountPlanId]) {
      const accountError = await validateAccountPlanForPosting(accountField);
      if (accountError) return jsonError(accountError);
    }
    const ref = dbAdmin.collection('purchase_orders').doc();
    const items = Array.isArray(body.items) ? body.items : [];
    const itemsTotal = items.reduce((sum: number, item: any) => sum + purchaseLineNetTotal(item), 0);
    const deliveryFee = Number(body.deliveryFee ?? 0);
    const totalEstimated = Number(body.totalEstimated ?? (itemsTotal + deliveryFee));

    let supplierName = body.supplierName;
    if (!supplierName && body.supplierId) {
      const s = await dbAdmin.collection('entities').doc(body.supplierId).get();
      if (s.exists) {
        const d = s.data();
        supplierName = d?.fantasyName || d?.name || '';
      }
    }

    const paymentDueDate = body.paymentDueDate || now;
    const estimatedReceiptDate = body.estimatedReceiptDate || paymentDueDate;

    const freightPaymentMode = normalizeFreightPaymentMode(deliveryFee, body.freightPaymentMode);

    const orderData = {
      workspaceId: WORKSPACE_ID,
      supplierId: body.supplierId || '',
      supplierName: supplierName || '',
      status: 'created',
      receiptMode: body.receiptMode || 'future_delivery',
      estimatedReceiptDate,
      totalEstimated,
      totalConfirmed: 0,
      deliveryFee,
      paymentCondition: body.paymentCondition ?? 'cash',
      paymentDueDate,
      paymentMethod: body.paymentMethod || 'pix',
      paymentAccountId: body.paymentAccountId ?? null,
      paymentAccountName: body.paymentAccountName ?? null,
      paymentMethodId: body.paymentMethodId ?? null,
      paymentMethodLabel: body.paymentMethodLabel ?? null,
      installmentsCount: Number(body.installmentsCount ?? 1),
      installmentDueDates: Array.isArray(body.installmentDueDates) ? body.installmentDueDates : null,
      accountPlanId: body.accountPlanId ?? null,
      accountPlanName: body.accountPlanName ?? null,
      freightAccountPlanId: body.freightAccountPlanId ?? null,
      freightAccountPlanName: body.freightAccountPlanName ?? null,
      freightPaymentMode,
      resultCenterId: body.resultCenterId ?? null,
      resultCenterName: body.resultCenterName ?? null,
      trackingInfo: body.trackingInfo ?? null,
      notes: body.notes ?? null,
      quotationId: body.quotationId ?? null,
      createdAt: now,
      updatedAt: now,
      createdBy: decoded.uid,
    };
    await ref.set(orderData);

    if (items.length > 0) {
      const batch = dbAdmin.batch();
      for (const item of items) {
        const itemRef = ref.collection('items').doc();
        const q = Number(item.quantityOrdered || 0);
        const p = Number(item.unitPriceOrdered || 0);
        const d = Number(item.discountOrdered || 0);
        const totalOrdered = purchaseLineNetTotal({ quantityOrdered: q, unitPriceOrdered: p, discountOrdered: d });
        const netUnitPriceOrdered = purchaseLineEffectiveUnitPrice({
          quantityOrdered: q,
          unitPriceOrdered: p,
          discountOrdered: d,
          totalOrdered,
        });
        const treatmentFields = purchaseItemTreatmentFields(item);
        const itemDestination = getTreatmentEntryType(treatmentFields.itemTreatment);
        batch.set(itemRef, {
          purchaseOrderId: ref.id,
          baseItemId: item.baseItemId || '',
          productId: item.productId ?? null,
          itemName: item.itemName ?? null,
          operationalCategoryId: item.operationalCategoryId ?? null,
          operationalCategoryName: item.operationalCategoryName ?? null,
          itemDestination,
          unit: item.unit || '',
          purchaseUnitType: item.purchaseUnitType ?? 'content',
          purchaseUnitLabel: item.purchaseUnitLabel ?? (item.unit || ''),
          quantityOrdered: q,
          unitPriceOrdered: p,
          netUnitPriceOrdered,
          discountOrdered: d,
          totalOrdered,
          quotationItemId: item.quotationItemId ?? null,
          entryType: itemDestination,
          ...treatmentFields,
          notes: item.notes ?? null,
        });
      }
      await batch.commit();
    }
    return NextResponse.json({ id: ref.id }, { status: 201 });
  }

  if (resource === 'orders' && id && child === 'confirm') {
    const orderRef = dbAdmin.collection('purchase_orders').doc(id);
    const orderSnap = await orderRef.get();
    if (!orderSnap.exists) return jsonError('Pedido não encontrado.', 404);
    const order = orderSnap.data()!;

    const batch = dbAdmin.batch();
    
    // Fallback: if totalEstimated is 0 or missing, calculate it from items
    let totalEstimated = order.totalEstimated || 0;
    const itemsSnap = await orderRef.collection('items').get();
    if (totalEstimated === 0) {
      itemsSnap.forEach(doc => {
        totalEstimated += (doc.data().totalOrdered || 0);
      });
      totalEstimated += (order.deliveryFee || 0);
    }

    batch.update(orderRef, { 
      status: 'confirmed', 
      totalEstimated,
      confirmedAt: now, 
      updatedAt: now 
    });

    const receiptRef = dbAdmin.collection('purchase_receipts').doc();
    const financialRef = dbAdmin.collection('purchase_financials').doc();
    
    // Use saved receiptMode or fallback to future_delivery
    const receiptMode = order.receiptMode || (order.paymentCondition === 'immediate' ? 'immediate_pickup' : 'future_delivery');
    // Per user request, all new receipts start as 'awaiting_delivery' (Aguardando recebimento)
    const initialReceiptStatus = 'awaiting_delivery';

    batch.set(receiptRef, {
      workspaceId: WORKSPACE_ID,
      purchaseOrderId: id,
      supplierId: order.supplierId,
      supplierName: order.supplierName,
      status: initialReceiptStatus,
      receiptMode,
      expectedDate: order.estimatedReceiptDate || order.paymentDueDate,
      totalEstimated,
      totalConfirmed: 0,
      createdAt: now,
      updatedAt: now,
    });

    for (const itemDoc of itemsSnap.docs) {
      const item = itemDoc.data();
      const receiptItemRef = receiptRef.collection('items').doc();
      const treatmentFields = purchaseItemTreatmentFields(item);
      const itemDestination = getTreatmentEntryType(treatmentFields.itemTreatment);
      const effectiveUnitPriceOrdered = purchaseLineEffectiveUnitPrice(item);
      batch.set(receiptItemRef, {
        purchaseReceiptId: receiptRef.id,
        purchaseOrderItemId: itemDoc.id,
        baseItemId: item.baseItemId,
        productId: item.productId ?? null,
        itemName: item.itemName ?? null,
        operationalCategoryId: item.operationalCategoryId ?? null,
        operationalCategoryName: item.operationalCategoryName ?? null,
        itemDestination,
        unit: item.unit,
        purchaseUnitType: item.purchaseUnitType || 'content',
        purchaseUnitLabel: item.purchaseUnitLabel || item.unit,
        quantityOrdered: item.quantityOrdered,
        unitPriceOrdered: effectiveUnitPriceOrdered,
        grossUnitPriceOrdered: item.unitPriceOrdered ?? effectiveUnitPriceOrdered,
        discountOrdered: Number(item.discountOrdered ?? 0),
        totalOrdered: item.totalOrdered ?? purchaseLineNetTotal(item),
        quantityReceived: 0,
        unitPriceConfirmed: 0,
        status: 'pending',
        entryType: itemDestination,
        ...treatmentFields,
      });
    }

    const goodsAmountEstimated = Math.max(totalEstimated - Number(order.deliveryFee ?? 0), 0);
    const freightAmountEstimated = Number(order.deliveryFee ?? 0);
    const freightPaymentMode = normalizeFreightPaymentMode(
      freightAmountEstimated,
      order.freightPaymentMode,
    );

    batch.set(financialRef, {
      workspaceId: WORKSPACE_ID,
      purchaseOrderId: id,
      supplierId: order.supplierId,
      supplierName: order.supplierName,
      amountEstimated: totalEstimated,
      goodsAmountEstimated,
      freightAmountEstimated,
      freightPaymentMode,
      paymentMethod: order.paymentMethod ?? null,
      paymentAccountId: order.paymentAccountId ?? null,
      paymentAccountName: order.paymentAccountName ?? null,
      paymentMethodId: order.paymentMethodId ?? null,
      paymentMethodLabel: order.paymentMethodLabel ?? null,
      dueDate: order.paymentDueDate,
      status: 'confirmed',
      createdAt: now,
      updatedAt: now,
    });

    await batch.commit();

    // Sync financial expense
    await internalSyncExpense(id, { ...order, totalEstimated }, decoded.uid).catch(e => console.error('Sync expense error:', e));

    return NextResponse.json({ ok: true, receiptId: receiptRef.id });
  }


  if (resource === 'orders' && id && child === 'cancel') {
    const orderRef = dbAdmin.collection('purchase_orders').doc(id);
    const [orderSnap, receiptsSnap, purchaseFinancialsSnap, expensesSnap] = await Promise.all([
      orderRef.get(),
      dbAdmin.collection('purchase_receipts').where('purchaseOrderId', '==', id).get(),
      dbAdmin.collection('purchase_financials').where('purchaseOrderId', '==', id).get(),
      financialDbAdmin.collection('expenses').where('purchaseOrderId', '==', id).get(),
    ]);

    if (!orderSnap.exists) return jsonError('Pedido não encontrado.', 404);

    const hasStockEntry =
      Boolean(orderSnap.data()?.receivedAt) ||
      receiptsSnap.docs.some((receipt) => receipt.data().status === 'stocked');
    if (hasStockEntry) {
      return jsonError(
        'A compra já gerou entrada no estoque. Reverta a movimentação antes de cancelar o pedido.',
        409,
      );
    }

    const cancellationNote = `Cancelado junto com o pedido de compra em ${new Date().toLocaleDateString('pt-BR')}.`;
    const purchasingBatch = dbAdmin.batch();
    purchasingBatch.update(orderRef, {
      status: 'cancelled',
      cancelledAt: now,
      cancelledBy: decoded.uid,
      updatedAt: now,
    });

    for (const receiptDoc of receiptsSnap.docs) {
      purchasingBatch.update(receiptDoc.ref, {
        status: 'cancelled',
        cancelledAt: now,
        cancelledBy: decoded.uid,
        updatedAt: now,
      });
      const receiptItemsSnap = await receiptDoc.ref.collection('items').get();
      receiptItemsSnap.forEach((itemDoc) => {
        purchasingBatch.update(itemDoc.ref, {
          status: 'cancelled',
          cancelledAt: now,
          updatedAt: now,
        });
      });
    }

    purchaseFinancialsSnap.forEach((financialDoc) => {
      purchasingBatch.update(financialDoc.ref, {
        status: 'cancelled',
        cancelledAt: now,
        cancelledBy: decoded.uid,
        updatedAt: now,
      });
    });
    await purchasingBatch.commit();

    const financialBatch = financialDbAdmin.batch();
    expensesSnap.forEach((expenseDoc) => {
      const previousNotes = expenseDoc.data().notes;
      financialBatch.update(expenseDoc.ref, {
        status: 'cancelled',
        cancelledAt: now,
        cancelledBy: decoded.uid,
        updatedAt: now,
        notes: previousNotes ? `${previousNotes}\n\n${cancellationNote}` : cancellationNote,
      });
    });
    await financialBatch.commit();

    return NextResponse.json({ ok: true });
  }

  if (resource === 'orders' && id && child === 'mark-received-elsewhere') {
    const orderRef = dbAdmin.collection('purchase_orders').doc(id);
    const orderSnap = await orderRef.get();
    if (!orderSnap.exists) return jsonError('Pedido não encontrado.', 404);

    const order = orderSnap.data()!;
    if (order.status !== 'confirmed') return jsonError('Apenas compras confirmadas podem ser baixadas.', 400);
    if (order.receivedAt) return jsonError('Compra já baixada como recebida.', 400);

    const receiptSnap = await dbAdmin
      .collection('purchase_receipts')
      .where('purchaseOrderId', '==', id)
      .limit(1)
      .get();
    if (receiptSnap.empty) return jsonError('Recebimento vinculado não encontrado.', 404);

    const receiptDoc = receiptSnap.docs[0];
    const receiptRef = receiptDoc.ref;
    const receiptItemsSnap = await receiptRef.collection('items').get();
    const notes = body.notes?.trim() || null;
    const auditNote = notes
      ? `Recebida por outro meio do sistema. ${notes}`
      : 'Recebida por outro meio do sistema.';

    const batch = dbAdmin.batch();
    let totalConfirmed = 0;

    for (const itemDoc of receiptItemsSnap.docs) {
      const item = itemDoc.data();
      const quantityReceived = Number(item.quantityOrdered ?? 0);
      const unitPriceConfirmed = purchaseLineEffectiveUnitPrice(item);
      const totalItemConfirmed = quantityReceived * unitPriceConfirmed;
      totalConfirmed += totalItemConfirmed;

      batch.update(itemDoc.ref, {
        quantityReceived,
        unitPriceConfirmed,
        totalConfirmed: totalItemConfirmed,
        status: 'received',
        receiptDisposition: 'received_elsewhere',
        divergenceReason: auditNote,
        updatedAt: now,
      });
    }

    batch.update(receiptRef, {
      status: 'stocked',
      receivedByOtherMeans: true,
      receivedByOtherMeansAt: now,
      receivedAt: now,
      totalConfirmed,
      updatedAt: now,
      notes: receiptDoc.data().notes ? `${receiptDoc.data().notes}\n\n${auditNote}` : auditNote,
    });

    batch.update(orderRef, {
      receivedAt: now,
      receivedByOtherMeans: true,
      receivedByOtherMeansAt: now,
      receivedByOtherMeansNotes: notes,
      totalConfirmed,
      updatedAt: now,
    });

    const finSnap = await dbAdmin
      .collection('purchase_financials')
      .where('purchaseOrderId', '==', id)
      .get();
    finSnap.forEach((d) => {
      batch.update(d.ref, {
        status: 'confirmed',
        amountConfirmed: totalConfirmed,
        updatedAt: now,
      });
    });

    await batch.commit();
    return NextResponse.json({ ok: true, receiptId: receiptDoc.id, status: 'stocked' });
  }

  if (resource === 'receipts' && id && child === 'start-conference') {
    await dbAdmin.collection('purchase_receipts').doc(id).update({
      status: 'in_conference',
      conferenceStartedAt: now,
      updatedAt: now,
    });
    return NextResponse.json({ ok: true });
  }

  function getReceiptItemStatus(
    quantityReceived: number,
    quantityOrdered: number,
    unitPriceConfirmed: number,
    unitPriceOrdered: number,
    divergenceReason?: string,
  ) {
    const quantityDiffers = Math.abs(quantityReceived - quantityOrdered) > 0.001;
    const priceDiffers = Math.abs(unitPriceConfirmed - unitPriceOrdered) > 0.01;

    if (quantityReceived === 0) return 'pending';
    if (quantityReceived < quantityOrdered) return 'partial';
    if (divergenceReason || quantityDiffers || priceDiffers) return 'divergent';
    return 'received';
  }

  if (resource === 'receipts' && id && child === 'resolve-divergence') {
    const receiptRef = dbAdmin.collection('purchase_receipts').doc(id);
    const receiptSnap = await receiptRef.get();
    if (!receiptSnap.exists) return jsonError('Recebimento não encontrado.', 404);
    const receipt = receiptSnap.data()!;

    const items = Array.isArray(body.items) ? body.items : [];
    if (items.length === 0) return jsonError('Informe ao menos uma divergência para tratar.');

    const orderRef = dbAdmin.collection('purchase_orders').doc(receipt.purchaseOrderId);
    const orderSnap = await orderRef.get();
    const order = orderSnap.data() ?? {};
    const receiptItemsSnap = await receiptRef.collection('items').get();
    const receiptItems = receiptItemsSnap.docs.map((itemDoc) => ({
      id: itemDoc.id,
      ref: itemDoc.ref,
      data: itemDoc.data(),
    }));
    const receiptItemsById = new Map(receiptItems.map((item) => [item.id, item]));
    const resolutions = new Map<
      string,
      {
        action: PurchaseDivergenceResolutionAction;
        notes?: string;
        excessBillingMode?: PurchaseDivergenceExcessBillingMode;
        excessUnitPrice?: number | null;
      }
    >();

    for (const item of items) {
      const receiptItemId = String(item.receiptItemId ?? '');
      const action = normalizeDivergenceResolutionAction(item.action);
      if (!receiptItemId || !action) return jsonError('Ação de divergência inválida.', 400);
      if (!receiptItemsById.has(receiptItemId)) return jsonError('Item de recebimento inválido.', 404);
      const excessBillingMode =
        action === 'accept_charged'
          ? normalizeDivergenceExcessBillingMode(item.excessBillingMode)
          : undefined;
      const excessUnitPrice: number | null =
        action === 'accept_charged' && excessBillingMode === 'custom_unit_price'
          ? Number(item.excessUnitPrice)
          : null;
      const invalidCustomExcessPrice =
        excessBillingMode === 'custom_unit_price' &&
        (excessUnitPrice === null || !Number.isFinite(excessUnitPrice) || excessUnitPrice < 0);
      if (
        action === 'accept_charged' &&
        invalidCustomExcessPrice
      ) {
        return jsonError('Informe um valor válido para o excedente.', 400);
      }
      resolutions.set(receiptItemId, {
        action,
        notes: typeof item.notes === 'string' ? item.notes.trim() : '',
        excessBillingMode,
        excessUnitPrice,
      });
    }

    const batch = dbAdmin.batch();
    const nextItems: Array<Record<string, any>> = [];
    const username = body.username ?? 'Sistema';

    for (const item of receiptItems) {
      const resolution = resolutions.get(item.id);
      const nextItem = { ...item.data };

      if (resolution) {
        const { action, notes, excessBillingMode, excessUnitPrice } = resolution;
        const quantityReceived = Number(nextItem.quantityReceived ?? 0);
        const quantityOrdered = Number(nextItem.quantityOrdered ?? 0);
        const hasExcess = quantityReceived > quantityOrdered;
        const nextExcessBillingMode =
          action === 'accept_charged' && hasExcess
            ? excessBillingMode ?? 'same_unit_price'
            : null;
        const nextExcessUnitPrice =
          action === 'accept_charged' && hasExcess && nextExcessBillingMode === 'custom_unit_price'
            ? excessUnitPrice
            : null;
        const nextTotalConfirmed = chargeableReceiptItemTotal({
          ...nextItem,
          divergenceResolutionAction: action,
          divergenceExcessBillingMode: nextExcessBillingMode,
          divergenceExcessUnitPrice: nextExcessUnitPrice,
        });
        const status =
          action === 'keep_pending' || action === 'request_replacement'
            ? 'partial'
            : quantityReceived > 0
            ? 'received'
            : 'cancelled';
        const disposition =
          action === 'keep_pending' ||
          action === 'request_replacement' ||
          action === 'close_shortage' ||
          action === 'credit_discount'
            ? 'receive_less'
            : action === 'return_excess' || action === 'bonus' || action === 'accept_charged'
            ? 'receive_more'
            : nextItem.receiptDisposition ?? 'receive';
        const auditEntry = {
          action,
          label: DIVERGENCE_RESOLUTION_LABELS[action],
          excessBillingMode: nextExcessBillingMode,
          excessUnitPrice: nextExcessUnitPrice,
          notes: notes || null,
          resolvedAt: now,
          resolvedBy: decoded.uid,
          resolvedByName: username,
        };

        Object.assign(nextItem, {
          status,
          receiptDisposition: disposition,
          divergenceResolutionAction: action,
          divergenceExcessBillingMode: nextExcessBillingMode,
          divergenceExcessUnitPrice: nextExcessUnitPrice,
          totalConfirmed: nextTotalConfirmed,
          divergenceResolvedAt: now,
          divergenceResolvedBy: decoded.uid,
          resolutionNotes: notes || DIVERGENCE_RESOLUTION_LABELS[action],
        });

        batch.update(item.ref, {
          status,
          receiptDisposition: disposition,
          divergenceResolutionAction: action,
          divergenceExcessBillingMode: nextExcessBillingMode,
          divergenceExcessUnitPrice: nextExcessUnitPrice,
          totalConfirmed: nextTotalConfirmed,
          divergenceResolvedAt: now,
          divergenceResolvedBy: decoded.uid,
          resolutionNotes: notes || DIVERGENCE_RESOLUTION_LABELS[action],
          divergenceResolutionHistory: FieldValue.arrayUnion(auditEntry),
          updatedAt: now,
        });
      }

      nextItems.push(nextItem);
    }

    let goodsConfirmed = 0;
    let hasOpenBalance = false;
    let hasUnresolvedDivergence = false;

    for (const item of nextItems) {
      goodsConfirmed += chargeableReceiptItemTotal(item);

      const action = normalizeDivergenceResolutionAction(item.divergenceResolutionAction);
      const itemDiverges = itemHasCommercialDivergence(item);
      const hasResolution = !!action;
      const keepsBalanceOpen = action === 'keep_pending' || action === 'request_replacement';

      if (keepsBalanceOpen || (!isClosingDivergenceAction(action) && item.status === 'partial')) {
        hasOpenBalance = true;
      }

      if (itemDiverges && !hasResolution) {
        hasUnresolvedDivergence = true;
      }
    }

    const finalStatus = hasOpenBalance
      ? 'partially_stocked'
      : hasUnresolvedDivergence
      ? 'stocked_with_divergence'
      : 'stocked';
    const deliveryFee = Number(order.deliveryFee ?? 0);
    const financialConfirmed = goodsConfirmed + deliveryFee;
    const resolutionSummary = items
      .map((item: any) => {
        const action = normalizeDivergenceResolutionAction(item.action);
        return action ? DIVERGENCE_RESOLUTION_LABELS[action] : null;
      })
      .filter(Boolean)
      .join('; ');

    batch.update(receiptRef, {
      status: finalStatus,
      totalConfirmed: goodsConfirmed,
      divergenceResolvedAt: finalStatus === 'stocked' ? now : null,
      divergenceResolvedBy: decoded.uid,
      divergenceResolutionSummary: resolutionSummary || null,
      ...(finalStatus === 'stocked' ? { receivedAt: now } : {}),
      updatedAt: now,
      notes: body.notes ?? receipt.notes ?? null,
    });

    batch.update(orderRef, {
      totalConfirmed: goodsConfirmed,
      ...(finalStatus === 'stocked' ? { receivedAt: now } : {}),
      updatedAt: now,
    });

    const finSnap = await dbAdmin
      .collection('purchase_financials')
      .where('purchaseOrderId', '==', receipt.purchaseOrderId)
      .get();
    finSnap.forEach((financialDoc) => {
      batch.update(financialDoc.ref, {
        status:
          finalStatus === 'stocked'
            ? 'confirmed'
            : finalStatus === 'partially_stocked'
            ? 'forecasted'
            : 'divergent',
        amountConfirmed: financialConfirmed,
        updatedAt: now,
      });
    });

    await batch.commit();
    return NextResponse.json({
      ok: true,
      status: finalStatus,
      totalConfirmed: goodsConfirmed,
      amountConfirmed: financialConfirmed,
    });
  }

  if (resource === 'receipts' && id && child === 'save-conference') {
    const batch = dbAdmin.batch();
    const receiptRef = dbAdmin.collection('purchase_receipts').doc(id);
    const receiptSnap = await receiptRef.get();
    if (!receiptSnap.exists) return jsonError('Recebimento não encontrado.', 404);
    const receipt = receiptSnap.data()!;

    const orderRef = dbAdmin.collection('purchase_orders').doc(receipt.purchaseOrderId);
    const orderSnap = await orderRef.get();
    const order = orderSnap.data() ?? {};
    const orderItemsSnap = await orderRef.collection('items').get();
    const orderItemsById = new Map(orderItemsSnap.docs.map((d) => [d.id, d.data()]));
    const receiptItemsSnap = await receiptRef.collection('items').get();
    const receiptItemsById = new Map(receiptItemsSnap.docs.map((d) => [d.id, d.data()]));
    const payloadReceiptItemIds = new Set(
      Array.isArray(body.items) ? body.items.map((i: any) => i.receiptItemId) : [],
    );

    let totalConfirmed = 0;
    let hasDivergence = false;
    let hasRemaining = false;
    let hasStockEntry = false;

    if (Array.isArray(body.items)) {
      for (const item of body.items) {
        const orderItem = orderItemsById.get(item.purchaseOrderItemId);
        const existingReceiptItem = receiptItemsById.get(item.receiptItemId);
        const treatmentFields = purchaseItemTreatmentFields({ ...(orderItem ?? {}), ...item });
        const itemDestination = getTreatmentEntryType(treatmentFields.itemTreatment);
        const quantityOrdered = Number(orderItem?.quantityOrdered ?? item.quantityReceived);
        const unitPriceOrdered = purchaseLineEffectiveUnitPrice(
          orderItem ?? existingReceiptItem ?? { quantityOrdered, unitPriceOrdered: item.unitPriceConfirmed },
        );
        const disposition = item.receiptDisposition ?? 'receive';
        const previousReceived = Number(existingReceiptItem?.quantityReceived ?? 0);
        const currentReceived =
          disposition === 'receive' || disposition === 'receive_less' || disposition === 'receive_more'
            ? Number(item.quantityReceived ?? 0)
            : 0;
        const quantityReceived = Math.max(previousReceived + currentReceived, 0);
        const hasOpenBalance = quantityReceived < quantityOrdered;
        const itemStatus =
          disposition === 'pending'
            ? previousReceived > 0
              ? getReceiptItemStatus(
                  previousReceived,
                  quantityOrdered,
                  item.unitPriceConfirmed,
                  unitPriceOrdered,
                  item.divergenceReason,
                )
              : 'pending'
            : disposition === 'receive_less'
            ? 'partial'
            : disposition === 'receive_more'
            ? 'divergent'
            : disposition === 'returned'
            ? 'cancelled'
            : disposition === 'exchange_pending'
            ? 'partial'
            : getReceiptItemStatus(
                quantityReceived,
                quantityOrdered,
                item.unitPriceConfirmed,
                unitPriceOrdered,
                item.divergenceReason,
              );

        totalConfirmed += quantityReceived * item.unitPriceConfirmed;
        if (currentReceived > 0) hasStockEntry = true;
        if (hasOpenBalance || itemStatus === 'partial' || itemStatus === 'pending') hasRemaining = true;
        if (itemStatus === 'partial' || itemStatus === 'divergent' || disposition !== 'receive') hasDivergence = true;

        batch.update(receiptRef.collection('items').doc(item.receiptItemId), {
          unit: item.unit,
          purchaseUnitType: item.purchaseUnitType ?? orderItem?.purchaseUnitType ?? 'content',
          purchaseUnitLabel: item.purchaseUnitLabel ?? orderItem?.purchaseUnitLabel ?? item.unit,
          itemDestination,
          entryType: itemDestination,
          ...treatmentFields,
          quantityReceived,
          quantityPendingStockEntry: currentReceived,
          unitPriceConfirmed: item.unitPriceConfirmed,
          totalConfirmed: quantityReceived * item.unitPriceConfirmed,
          status: itemStatus,
          receiptDisposition: disposition,
          resolutionNotes: item.resolutionNotes?.trim() || null,
          divergenceReason:
            item.resolutionNotes?.trim() ||
            item.divergenceReason?.trim() ||
            (disposition === 'exchange_pending' ? 'Troca pendente com fornecedor.' : null),
        });
      }
    }

    receiptItemsById.forEach((existingItem, rId) => {
      if (payloadReceiptItemIds.has(rId)) return;
      const existingTotal =
        Number(existingItem.quantityReceived ?? 0) *
        Number(existingItem.unitPriceConfirmed ?? existingItem.unitPriceOrdered ?? 0);
      totalConfirmed += existingTotal;
      if (existingItem.status === 'partial' || existingItem.status === 'pending') hasRemaining = true;
      if (existingItem.status === 'partial' || existingItem.status === 'divergent') hasDivergence = true;
    });

    const nextReceiptStatus = hasStockEntry
      ? 'awaiting_stock'
      : hasRemaining
      ? 'partially_stocked'
      : hasDivergence
      ? 'stocked_with_divergence'
      : 'stocked';

    batch.update(receiptRef, {
      status: nextReceiptStatus,
      totalConfirmed,
      conferenceCompletedAt: now,
      ...(nextReceiptStatus === 'stocked' || nextReceiptStatus === 'stocked_with_divergence'
        ? { receivedAt: now }
        : {}),
      updatedAt: now,
      notes: body.notes ?? receipt.notes ?? null,
      receiptProofUrl: body.receiptProofUrl ?? receipt.receiptProofUrl ?? null,
      receiptProofDescription: body.receiptProofDescription ?? receipt.receiptProofDescription ?? null,
    });

    batch.update(orderRef, {
      totalConfirmed,
      ...(nextReceiptStatus === 'stocked' || nextReceiptStatus === 'stocked_with_divergence'
        ? { receivedAt: now }
        : {}),
      updatedAt: now,
    });

    const finSnap = await dbAdmin
      .collection('purchase_financials')
      .where('purchaseOrderId', '==', receipt.purchaseOrderId)
      .get();
    finSnap.forEach((d) => {
      const wasDivergent =
        receipt.receiptMode === 'future_delivery' &&
        Math.abs(totalConfirmed - (d.data().amountEstimated ?? 0)) > 0.01;
      batch.update(d.ref, {
        status: hasRemaining ? 'forecasted' : wasDivergent || hasDivergence ? 'divergent' : 'confirmed',
        updatedAt: now,
      });
    });

    await batch.commit();
    return NextResponse.json({ ok: true, status: nextReceiptStatus });
  }

  if (resource === 'receipts' && id && child === 'start-stock-entry') {
    await dbAdmin.collection('purchase_receipts').doc(id).update({
      status: 'in_stock_entry',
      stockEntryStartedAt: now,
      updatedAt: now,
    });
    return NextResponse.json({ ok: true });
  }

  if (resource === 'receipts' && id && child === 'confirm-stock-entry') {
    const batch = dbAdmin.batch();
    const receiptRef = dbAdmin.collection('purchase_receipts').doc(id);
    const receiptSnap = await receiptRef.get();
    if (!receiptSnap.exists) return jsonError('Recebimento não encontrado.', 404);
    const receipt = receiptSnap.data()!;

    const orderRef = dbAdmin.collection('purchase_orders').doc(receipt.purchaseOrderId);
    const orderSnap = await orderRef.get();
    const order = orderSnap.data() ?? {};
    const orderItemsSnap = await orderRef.collection('items').get();
    const orderItemsById = new Map(orderItemsSnap.docs.map((d) => [d.id, d.data()]));

    const receiptItemsSnap = await receiptRef.collection('items').get();
    const receiptItemsById = new Map(receiptItemsSnap.docs.map((d) => [d.id, d.data()]));

    let totalConfirmed = 0;
    let hasDivergence = false;
    let hasRemaining = false;
    const payloadReceiptItemIds = new Set(
      Array.isArray(body.items) ? body.items.map((i: any) => i.receiptItemId) : [],
    );

    if (Array.isArray(body.items)) {
      for (const item of body.items) {
        const orderItem = orderItemsById.get(item.purchaseOrderItemId);
        const existingReceiptItem = receiptItemsById.get(item.receiptItemId);
        const treatmentFields = purchaseItemTreatmentFields({
          ...(orderItem ?? {}),
          ...(existingReceiptItem ?? {}),
          ...item,
        });
        const entryType = getTreatmentEntryType(treatmentFields.itemTreatment);
        const skipsOperationalEntry = purchaseTreatmentSkipsOperationalEntry(treatmentFields.itemTreatment);
        const createsAsset = purchaseTreatmentCreatesAsset(treatmentFields.itemTreatment);
        const destinationKioskId = entryType === 'uniform'
          ? UNIFORM_STOCK_ID
          : String(body.destinationKioskId ?? '').trim();
        const destinationKioskName = entryType === 'uniform'
          ? UNIFORM_STOCK_NAME
          : String(body.destinationKioskName ?? '').trim();

        if (!skipsOperationalEntry && entryType !== 'uniform' && !destinationKioskId) {
          return jsonError('Defina o quiosque de destino para os itens de estoque ou patrimônio.');
        }

        const baseProductDoc = item.baseItemId
          ? await dbAdmin.collection('baseProducts').doc(item.baseItemId).get()
          : null;
        if (!createsAsset && !skipsOperationalEntry && !baseProductDoc?.exists) {
          return jsonError('Insumo base não encontrado.');
        }
        const baseProduct = baseProductDoc?.exists
          ? ({ id: baseProductDoc.id, ...baseProductDoc.data() } as BaseProduct)
          : null;

        const purchaseUnitType =
          item.purchaseUnitType ?? existingReceiptItem?.purchaseUnitType ?? orderItem?.purchaseUnitType ?? 'content';
        const purchaseUnitLabel =
          item.purchaseUnitLabel ??
          existingReceiptItem?.purchaseUnitLabel ??
          orderItem?.purchaseUnitLabel ??
          existingReceiptItem?.unit ??
          orderItem?.unit ??
          '';

        const orderedUnitPrice = purchaseLineEffectiveUnitPrice(orderItem ?? existingReceiptItem ?? {});
        const confirmedUnitPrice = Number(existingReceiptItem?.unitPriceConfirmed || orderedUnitPrice || 0);
        const previousReceived = Number(existingReceiptItem?.quantityReceived ?? 0);
        const pendingStockEntryRaw = existingReceiptItem?.quantityPendingStockEntry;
        const pendingStockEntry = Number(pendingStockEntryRaw ?? 0);
        const hasPendingStockEntry = pendingStockEntryRaw != null && pendingStockEntry > 0;
        const payloadReceivedQuantity = hasPendingStockEntry
          ? pendingStockEntry
          : Number(item.quantityReceived ?? 0);
        const cumulativeReceived = hasPendingStockEntry
          ? previousReceived
          : Math.max(previousReceived, payloadReceivedQuantity);
        const quantityOrdered = Number(orderItem?.quantityOrdered ?? cumulativeReceived);

        if (skipsOperationalEntry) {
          totalConfirmed += cumulativeReceived * confirmedUnitPrice;
          const receiptItemStatus = getReceiptItemStatus(
            cumulativeReceived,
            quantityOrdered,
            confirmedUnitPrice,
            orderedUnitPrice || confirmedUnitPrice,
            existingReceiptItem?.divergenceReason,
          );
          if (receiptItemStatus === 'divergent' || receiptItemStatus === 'partial') hasDivergence = true;
          if (receiptItemStatus === 'partial' || receiptItemStatus === 'pending') hasRemaining = true;

          // Componente de patrimônio vinculado a um patrimônio: registra um
          // histórico nesse patrimônio (valor, data, NF, fornecedor, ação).
          // Guard por stockedAt para não duplicar em reconfirmações.
          if (
            treatmentFields.itemTreatment === 'asset_component' &&
            treatmentFields.linkedAssetId &&
            cumulativeReceived > 0 &&
            !existingReceiptItem?.stockedAt
          ) {
            const componentName =
              item.itemName || existingReceiptItem?.itemName || orderItem?.itemName || 'Componente';
            const totalValue = cumulativeReceived * confirmedUnitPrice;
            const fmt = (value: number) =>
              value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
            const purchaseDate =
              order.purchaseDate ?? order.fiscal?.issuedAt?.slice?.(0, 10) ?? order.createdAt?.slice?.(0, 10) ?? null;
            const supplierName = order.fiscal?.issuerName ?? order.supplierName ?? receipt.supplierName ?? null;
            const invoiceNumber = order.invoiceNumber ?? order.fiscal?.number ?? null;
            const noteParts = [
              `${getPurchaseComponentActionLabel(treatmentFields.componentAction)}: ${componentName}`,
              `${cumulativeReceived}× ${fmt(confirmedUnitPrice)} = ${fmt(totalValue)}`,
              purchaseDate ? `Compra ${String(purchaseDate).split('-').reverse().join('/')}` : null,
              invoiceNumber ? `NF ${invoiceNumber}` : null,
              supplierName ? `Fornecedor: ${supplierName}` : null,
            ].filter(Boolean);
            batch.set(dbAdmin.collection('assetMovements').doc(), {
              assetId: treatmentFields.linkedAssetId,
              assetCode: treatmentFields.linkedAssetCode ?? null,
              assetName: treatmentFields.linkedAssetName ?? null,
              type: 'COMPONENTE',
              userId: decoded.uid,
              username: body.username ?? 'Sistema',
              occurredAt: now,
              notes: noteParts.join(' · '),
              sourceType: 'purchase_receipt',
              sourceId: id,
            });
          }

          batch.update(receiptRef.collection('items').doc(item.receiptItemId), {
            entryType,
            itemDestination: entryType,
            ...treatmentFields,
            quantityReceived: cumulativeReceived,
            quantityPendingStockEntry: 0,
            totalConfirmed: cumulativeReceived * confirmedUnitPrice,
            status: receiptItemStatus,
            lots: [],
            ...(payloadReceivedQuantity > 0 ? { stockedAt: now } : {}),
            updatedAt: now,
          });
          continue;
        }

        if (createsAsset) {
          totalConfirmed += cumulativeReceived * confirmedUnitPrice;
          const receiptItemStatus = getReceiptItemStatus(
            cumulativeReceived,
            quantityOrdered,
            confirmedUnitPrice,
            orderedUnitPrice || confirmedUnitPrice,
            existingReceiptItem?.divergenceReason,
          );
          if (receiptItemStatus === 'divergent' || receiptItemStatus === 'partial') hasDivergence = true;
          if (receiptItemStatus === 'partial' || receiptItemStatus === 'pending') hasRemaining = true;

          const assetCount = Math.max(0, Math.floor(Number(payloadReceivedQuantity || 0)));
          const existingAssetsSnap = item.receiptItemId
            ? await dbAdmin.collection('assets').where('purchaseReceiptItemId', '==', item.receiptItemId).get()
            : null;
          const assetsToCreate = Math.max(0, assetCount - (existingAssetsSnap?.size ?? 0));
          for (let index = 0; index < assetsToCreate; index += 1) {
            const assetRef = dbAdmin.collection('assets').doc();
            const code = `PEND-${assetRef.id.slice(0, 8).toUpperCase()}`;
            const assetName = item.itemName || existingReceiptItem?.itemName || orderItem?.itemName || baseProduct?.name || item.baseItemId || 'Patrimônio';
            batch.set(assetRef, {
              workspaceId: WORKSPACE_ID,
              code,
              name: assetName,
              category: 'Patrimônio',
              currentKioskId: destinationKioskId,
              currentKioskName: destinationKioskName,
              status: 'ativo',
              purchaseDate: order.purchaseDate ?? order.fiscal?.issuedAt?.slice?.(0, 10) ?? order.createdAt?.slice?.(0, 10) ?? null,
              purchaseValue: confirmedUnitPrice,
              supplierId: receipt.supplierId,
              supplierName: order.fiscal?.issuerName ?? receipt.supplierName ?? order.supplierName ?? null,
              invoiceNumber: order.invoiceNumber ?? order.fiscal?.number ?? null,
              paymentMethod: order.paymentMethodLabel ?? order.paymentMethod ?? null,
              costCenter: order.resultCenterName ?? order.resultCenterId ?? null,
              accountingAccount: order.accountPlanId ?? null,
              documentUrl: order.documentUrl ?? order.fiscal?.documentUrl ?? null,
              sourceType: 'purchase_receipt',
              plateStatus: 'pendente',
              purchaseOrderId: receipt.purchaseOrderId,
              purchaseReceiptId: id,
              purchaseReceiptItemId: item.receiptItemId,
              createdAt: now,
              updatedAt: now,
              createdBy: decoded.uid,
            });
            batch.set(dbAdmin.collection('assetMovements').doc(), {
              assetId: assetRef.id,
              assetCode: code,
              assetName,
              type: 'CRIACAO',
              toKioskId: destinationKioskId,
              toKioskName: destinationKioskName,
              toStatus: 'ativo',
              userId: decoded.uid,
              username: body.username ?? 'Sistema',
              occurredAt: now,
              notes: 'Entrada via recebimento de compra. Placa patrimonial pendente de vinculação.',
              sourceType: 'purchase_receipt',
              sourceId: id,
            });
          }

          batch.update(receiptRef.collection('items').doc(item.receiptItemId), {
            entryType,
            itemDestination: entryType,
            ...treatmentFields,
            quantityReceived: cumulativeReceived,
            quantityPendingStockEntry: 0,
            totalConfirmed: cumulativeReceived * confirmedUnitPrice,
            status: receiptItemStatus,
            ...(payloadReceivedQuantity > 0 ? { stockedAt: now } : {}),
            updatedAt: now,
          });
          continue;
        }

        const productDoc = await dbAdmin.collection('products').doc(item.productId).get();
        if (!productDoc.exists) return jsonError('Unidade de estoque não encontrada.');
        const product = { id: productDoc.id, ...productDoc.data() } as Product;

        const convertedPrice = calculatePricePerBaseUnit(
          confirmedUnitPrice,
          product,
          baseProduct!,
          purchaseUnitType,
        );
        if (!convertedPrice.ok) return jsonError(convertedPrice.error || 'Erro na conversão de preço.');

        totalConfirmed += cumulativeReceived * confirmedUnitPrice;

        const receiptItemStatus = getReceiptItemStatus(
          cumulativeReceived,
          quantityOrdered,
          confirmedUnitPrice,
          orderedUnitPrice || confirmedUnitPrice,
          existingReceiptItem?.divergenceReason,
        );

        if (receiptItemStatus === 'divergent' || receiptItemStatus === 'partial') hasDivergence = true;
        if (receiptItemStatus === 'partial' || receiptItemStatus === 'pending') hasRemaining = true;

        if (Array.isArray(item.lots)) {
          for (const lot of item.lots) {
            if (Number(lot.quantity ?? 0) <= 0) continue;

            const stockConversion = calculateStockQuantityFromPurchase(
              lot.quantity,
              product,
              product,
              baseProduct!,
              purchaseUnitType,
            );
            if (!stockConversion.ok) return jsonError(stockConversion.error || 'Erro na conversão de estoque.');

            const lotRef = receiptRef.collection('items').doc(item.receiptItemId).collection('lots').doc();
            batch.set(lotRef, {
              purchaseReceiptItemId: item.receiptItemId,
              baseItemId: item.baseItemId,
              lotCode: lot.lotCode,
              ...(lot.expiryDate != null ? { expiryDate: lot.expiryDate } : {}),
              quantity: lot.quantity,
              stockQuantity: stockConversion.stockQuantity,
              purchaseUnitType,
              purchaseUnitLabel,
              unitCost: confirmedUnitPrice,
              occurredAt: now,
            });

            const costRef = dbAdmin.collection('effective_cost_history').doc();
            batch.set(costRef, {
              workspaceId: WORKSPACE_ID,
              baseItemId: item.baseItemId,
              supplierId: receipt.supplierId,
              unitCost: convertedPrice.pricePerBaseUnit,
              quantity: stockConversion.baseQuantity,
              purchasePrice: confirmedUnitPrice,
              purchaseQuantity: lot.quantity,
              purchaseUnitType,
              purchaseUnitLabel,
              stockProductId: item.productId,
              stockProductQuantity: stockConversion.stockQuantity,
              purchaseReceiptId: id,
              purchaseReceiptLotId: lotRef.id,
              purchaseOrderId: receipt.purchaseOrderId,
              occurredAt: now,
            });

            batch.update(dbAdmin.collection('baseProducts').doc(item.baseItemId), {
              lastEffectivePrice: {
                baseProductId: item.baseItemId,
                productId: item.productId,
                price: confirmedUnitPrice,
                pricePerUnit: convertedPrice.pricePerBaseUnit,
                entityId: receipt.supplierId ?? 'N/A',
                confirmedBy: decoded.uid,
                confirmedAt: now,
              },
            });

            const lotKey = entryType === 'uniform'
              ? uniformLotId({
                  productId: item.productId,
                  condition: 'novo',
                  status: 'disponivel',
                  lotNumber: lot.lotCode,
                })
              : `${item.productId}_${destinationKioskId}_${lot.lotCode}_${lot.expiryDate ?? 'noval'}`;
            const stockLotRef = dbAdmin.collection('lots').doc(lotKey);
            batch.set(
              stockLotRef,
              {
                workspaceId: WORKSPACE_ID,
                productId: item.productId,
                productName: item.productName ?? item.baseItemId,
                lotNumber: lot.lotCode,
                expiryDate: lot.expiryDate ?? null,
                kioskId: destinationKioskId,
                quantity: FieldValue.increment(stockConversion.stockQuantity),
                ...(entryType === 'uniform'
                  ? {
                      condition: 'novo',
                      uniformStockStatus: 'disponivel',
                      apparelType: product.apparelType ?? null,
                      apparelSize: product.apparelSize ?? null,
                      apparelColor: product.apparelColor ?? null,
                      imageUrl: product.imageUrl ?? null,
                    }
                  : {}),
                updatedAt: Timestamp.now(),
              },
              { merge: true },
            );

            const movRef = dbAdmin.collection('movementHistory').doc();
            batch.set(movRef, {
              lotId: lotKey,
              productId: item.productId,
              productName: item.productName ?? item.baseItemId,
              lotNumber: lot.lotCode,
              type: 'ENTRADA',
              quantityChange: stockConversion.stockQuantity,
              toKioskId: destinationKioskId,
              toKioskName: destinationKioskName,
              userId: decoded.uid,
              username: body.username ?? 'Sistema',
              timestamp: now,
              sourceType: 'purchase_receipt',
              sourceId: id,
              ...(entryType === 'uniform' ? { itemClass: 'uniform' } : {}),
            });
          }
        }

        batch.update(receiptRef.collection('items').doc(item.receiptItemId), {
          entryType,
          itemDestination: entryType,
          ...treatmentFields,
          quantityReceived: cumulativeReceived,
          quantityPendingStockEntry: 0,
          totalConfirmed: cumulativeReceived * confirmedUnitPrice,
          status: receiptItemStatus,
          ...(payloadReceivedQuantity > 0 ? { stockedAt: now } : {}),
          updatedAt: now,
        });
      }
    }

    receiptItemsById.forEach((existingItem, rId) => {
      if (payloadReceiptItemIds.has(rId)) return;
      totalConfirmed +=
        (existingItem.quantityReceived ?? 0) * (existingItem.unitPriceConfirmed ?? existingItem.unitPriceOrdered ?? 0);
      if (existingItem.status === 'partial' || existingItem.status === 'pending') hasRemaining = true;
      if (existingItem.status === 'partial' || existingItem.status === 'divergent') hasDivergence = true;
    });

    const finalStatus = hasRemaining
      ? 'partially_stocked'
      : hasDivergence
      ? 'stocked_with_divergence'
      : 'stocked';

    batch.update(receiptRef, {
      status: finalStatus,
      stockEnteredAt: now,
      ...(finalStatus !== 'partially_stocked' ? { receivedAt: now } : {}),
      totalConfirmed,
      updatedAt: now,
      notes: body.notes ?? receipt.notes ?? null,
    });

    batch.update(orderRef, {
      totalConfirmed,
      ...(finalStatus !== 'partially_stocked' ? { receivedAt: now } : {}),
      updatedAt: now,
    });

    const finSnap = await dbAdmin
      .collection('purchase_financials')
      .where('purchaseOrderId', '==', receipt.purchaseOrderId)
      .get();
    finSnap.forEach((d) => {
      const wasDivergent =
        receipt.receiptMode === 'future_delivery' &&
        Math.abs(totalConfirmed - (d.data().amountEstimated ?? 0)) > 0.01;
      batch.update(d.ref, {
        status: finalStatus === 'partially_stocked' ? 'forecasted' : wasDivergent ? 'divergent' : 'confirmed',
        updatedAt: now,
      });
    });

    await batch.commit();
    return NextResponse.json({ ok: true, status: finalStatus });
  }

  if (resource === 'orders' && id && child === 'sync-expense') {
    const orderRef = dbAdmin.collection('purchase_orders').doc(id);
    const orderSnap = await orderRef.get();
    if (!orderSnap.exists) return jsonError('Pedido não encontrado.', 404);

    const order = orderSnap.data() as Record<string, any>;
    const supplierSnap = order.supplierId ? await dbAdmin.collection('entities').doc(order.supplierId).get() : null;
    const supplier = supplierSnap?.data() as Record<string, any> | undefined;

    const financialSnap = await financialDbAdmin
      .collection('expenses')
      .where('purchaseOrderId', '==', id)
      .limit(1)
      .get();

    const totalValue = Number(order.totalEstimated ?? 0);
    const basePayload = {
      description: `Compra ${supplier?.fantasyName || supplier?.name || order.supplierId || id}`,
      supplier: supplier?.fantasyName || supplier?.name || '',
      accountPlan: order.accountPlanId ?? '',
      accountPlanName: order.accountPlanName ?? '',
      totalValue,
      dueDate: Timestamp.fromDate(new Date(order.paymentDueDate)),
      competenceDate: Timestamp.fromDate(new Date(order.createdAt ?? order.paymentDueDate)),
      paymentMethod: order.paymentCondition === 'installments' ? 'installments' : 'single',
      installments:
        order.paymentCondition === 'installments'
          ? buildExpenseInstallments(
              totalValue,
              Number(order.installmentsCount ?? 2),
              order.paymentDueDate,
              order.installmentDueDates,
            )
          : null,
      installmentType: order.paymentCondition === 'installments' ? 'equal' : null,
      installmentPeriodicity: order.paymentCondition === 'installments' ? 'monthly' : null,
      firstInstallmentDueDate:
        order.paymentCondition === 'installments' ? Timestamp.fromDate(new Date(order.paymentDueDate)) : null,
      isApportioned: false,
      resultCenter: order.resultCenterId ?? null,
      apportionments: null,
      notes: buildPurchaseAuditNotes(order),
      status: 'pending',
      originModule: 'purchasing',
      originStatus: 'pending_audit',
      purchaseOrderId: id,
      purchaseFinancialStatus: order.paymentCondition === 'installments' ? 'installments_pending_audit' : 'pending_audit',
      createdBy: decoded.uid,
      updatedAt: Timestamp.now(),
    };

    let expenseId: string;
    if (financialSnap.empty) {
      const expenseRef = financialDbAdmin.collection('expenses').doc();
      expenseId = expenseRef.id;
      await expenseRef.set({
        ...basePayload,
        createdAt: Timestamp.now(),
      });
    } else {
      const existing = financialSnap.docs[0];
      expenseId = existing.id;
      await existing.ref.set(basePayload, { merge: true });
    }

    await Promise.all([
      orderRef.set({ linkedExpenseId: expenseId }, { merge: true }),
      dbAdmin
        .collection('purchase_financials')
        .where('purchaseOrderId', '==', id)
        .get()
        .then((snapshot) =>
          Promise.all(snapshot.docs.map((doc) => doc.ref.set({ linkedExpenseId: expenseId }, { merge: true }))),
        ),
    ]);

    return NextResponse.json({ ok: true, expenseId });
  }

  return jsonError('Operação POST não implementada para este caminho.', 404);
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ path?: string[] }> }) {
  const path = (await context.params).path ?? [];
  const [resource, id, child, childId] = path;
  const userContext = await getUserContext(request);
  if (!userContext) return jsonError('Não autorizado.', 401);
  const canPatch =
    resource === 'quotations'
      ? isAllowed(userContext, canCreateQuotation)
      : resource === 'orders'
        ? isAllowed(userContext, canCreatePurchase)
        : null;
  if (canPatch === false) return permissionError();
  const body = await request.json().catch(() => ({}));
  const now = new Date().toISOString();

  if (resource === 'quotations' && id && !child) {
    const quotationRef = dbAdmin.collection('quotations').doc(id);
    const quotationSnap = await quotationRef.get();
    if (!quotationSnap.exists) return jsonError('Cotação não encontrada.', 404);

    const allowedFields = [
      'supplierId',
      'mode',
      'validUntil',
      'notes',
      'status',
      'finalizedAt',
      'archivedAt',
    ];
    const update = Object.fromEntries(
      Object.entries(body).filter(([key]) => allowedFields.includes(key)),
    );

    if (Object.keys(update).length === 0) return jsonError('Nenhum campo válido para atualizar.', 400);

    await quotationRef.update({ ...update, updatedAt: now });
    return NextResponse.json({ ok: true });
  }

  if (resource === 'quotations' && id && child === 'items' && childId) {
    const update = { ...body };
    if (body.quantity != null || body.unitPrice != null || body.discount != null) {
      const current = await dbAdmin.collection('quotations').doc(id).collection('items').doc(childId).get();
      const data = current.data() ?? {};
      const quantity = Number(body.quantity ?? data.quantity ?? 0);
      const unitPrice = Number(body.unitPrice ?? data.unitPrice ?? 0);
      const discount = Number(body.discount ?? data.discount ?? 0);
      update.totalPrice = Math.max(quantity * unitPrice - discount, 0);
    }
    await dbAdmin.collection('quotations').doc(id).collection('items').doc(childId).update(update);
    return NextResponse.json({ ok: true });
  }

  if (resource === 'orders' && id && child === 'items' && childId) {
    const orderRef = dbAdmin.collection('purchase_orders').doc(id);
    const itemRef = orderRef.collection('items').doc(childId);
    const [orderSnap, itemSnap, itemsSnap] = await Promise.all([
      orderRef.get(),
      itemRef.get(),
      orderRef.collection('items').get(),
    ]);
    if (!orderSnap.exists) return jsonError('Pedido não encontrado.', 404);
    if (!itemSnap.exists) return jsonError('Item do pedido não encontrado.', 404);

    const currentOrder = orderSnap.data()!;
    const currentItem = itemSnap.data() ?? {};
    const nextItem = { ...currentItem, ...body };
    const quantity = Number(nextItem.quantityOrdered ?? 0);
    const unitPrice = Number(nextItem.unitPriceOrdered ?? 0);
    const discount = Number(nextItem.discountOrdered ?? 0);
    if (quantity <= 0 || unitPrice <= 0) {
      return jsonError('Quantidade e preço unitário devem ser maiores que zero.');
    }

    const totalOrdered = purchaseLineNetTotal({
      quantityOrdered: quantity,
      unitPriceOrdered: unitPrice,
      discountOrdered: discount,
    });
    const netUnitPriceOrdered = purchaseLineEffectiveUnitPrice({
      quantityOrdered: quantity,
      unitPriceOrdered: unitPrice,
      discountOrdered: discount,
      totalOrdered,
    });
    const treatmentFields = purchaseItemTreatmentFields(nextItem);
    const itemDestination = getTreatmentEntryType(treatmentFields.itemTreatment);
    const nextTotalEstimated = Math.max(
      itemsSnap.docs.reduce((sum, itemDocument) => {
        if (itemDocument.id === childId) return sum + totalOrdered;
        return sum + purchaseLineNetTotal(itemDocument.data());
      }, 0) + Number(currentOrder.deliveryFee ?? 0),
      0,
    );

    const batch = dbAdmin.batch();
    batch.update(itemRef, {
      baseItemId: nextItem.baseItemId || '',
      productId: nextItem.productId ?? null,
      itemName: nextItem.itemName ?? null,
      operationalCategoryId: nextItem.operationalCategoryId ?? null,
      operationalCategoryName: nextItem.operationalCategoryName ?? null,
      itemDestination,
      unit: nextItem.unit || '',
      purchaseUnitType: nextItem.purchaseUnitType ?? 'content',
      purchaseUnitLabel: nextItem.purchaseUnitLabel ?? (nextItem.unit || ''),
      quantityOrdered: quantity,
      unitPriceOrdered: unitPrice,
      netUnitPriceOrdered,
      discountOrdered: discount,
      totalOrdered,
      quotationItemId: nextItem.quotationItemId ?? null,
      entryType: itemDestination,
      ...treatmentFields,
      notes: nextItem.notes ?? null,
    });
    batch.update(orderRef, { totalEstimated: nextTotalEstimated, updatedAt: now });
    await batch.commit();

    const financialSnap = await dbAdmin
      .collection('purchase_financials')
      .where('purchaseOrderId', '==', id)
      .get();
    if (!financialSnap.empty) {
      const deliveryFee = Number(currentOrder.deliveryFee ?? 0);
      await Promise.all(
        financialSnap.docs.map((financialDoc) =>
          financialDoc.ref.set(
            {
              amountEstimated: nextTotalEstimated,
              goodsAmountEstimated: Math.max(nextTotalEstimated - deliveryFee, 0),
              freightAmountEstimated: deliveryFee,
              updatedAt: now,
            },
            { merge: true },
          ),
        ),
      );
    }

    return NextResponse.json({ ok: true });
  }

  if (resource === 'orders' && id && !child) {
    const orderRef = dbAdmin.collection('purchase_orders').doc(id);
    const orderSnap = await orderRef.get();
    if (!orderSnap.exists) return jsonError('Pedido não encontrado.', 404);
    const currentOrder = orderSnap.data()!;

    const { items, ...rest } = body;
    for (const accountField of [rest.accountPlanId, rest.freightAccountPlanId]) {
      const accountError = await validateAccountPlanForPosting(accountField);
      if (accountError) return jsonError(accountError);
    }
    const batch = dbAdmin.batch();

    // If items are provided, we need to recalculate the totalEstimated
    if (Array.isArray(items)) {
      const itemsTotal = items.reduce(
        (sum: number, item: any) =>
          sum + purchaseLineNetTotal(item),
        0,
      );
      const deliveryFee = Number(rest.deliveryFee ?? currentOrder.deliveryFee ?? 0);
      rest.totalEstimated = Math.max(itemsTotal + deliveryFee, 0);

      // Replace items: delete old ones first
      const itemsSnap = await orderRef.collection('items').get();
      for (const itemDoc of itemsSnap.docs) {
        batch.delete(itemDoc.ref);
      }

      // Add new ones
      for (const item of items) {
        const itemRef = orderRef.collection('items').doc();
        const q = Number(item.quantityOrdered || 0);
        const p = Number(item.unitPriceOrdered || 0);
        const d = Number(item.discountOrdered || 0);
        const totalOrdered = purchaseLineNetTotal({ quantityOrdered: q, unitPriceOrdered: p, discountOrdered: d });
        const netUnitPriceOrdered = purchaseLineEffectiveUnitPrice({
          quantityOrdered: q,
          unitPriceOrdered: p,
          discountOrdered: d,
          totalOrdered,
        });
        const treatmentFields = purchaseItemTreatmentFields(item);
        const itemDestination = getTreatmentEntryType(treatmentFields.itemTreatment);
        batch.set(itemRef, {
          purchaseOrderId: id,
          baseItemId: item.baseItemId || '',
          productId: item.productId ?? null,
          itemName: item.itemName ?? null,
          operationalCategoryId: item.operationalCategoryId ?? null,
          operationalCategoryName: item.operationalCategoryName ?? null,
          itemDestination,
          unit: item.unit || '',
          purchaseUnitType: item.purchaseUnitType ?? 'content',
          purchaseUnitLabel: item.purchaseUnitLabel ?? (item.unit || ''),
          quantityOrdered: q,
          unitPriceOrdered: p,
          netUnitPriceOrdered,
          discountOrdered: d,
          totalOrdered,
          quotationItemId: item.quotationItemId ?? null,
          entryType: itemDestination,
          ...treatmentFields,
          notes: item.notes ?? null,
        });
      }
    } else if ('deliveryFee' in rest) {
      const currentGoodsTotal = Math.max(
        Number(currentOrder.totalEstimated ?? 0) - Number(currentOrder.deliveryFee ?? 0),
        0,
      );
      rest.totalEstimated = Math.max(currentGoodsTotal + Number(rest.deliveryFee ?? 0), 0);
    }

    const normalizedDeliveryFee = Number(rest.deliveryFee ?? currentOrder.deliveryFee ?? 0);
    if ('freightPaymentMode' in rest || 'deliveryFee' in rest) {
      rest.freightPaymentMode = normalizeFreightPaymentMode(
        normalizedDeliveryFee,
        rest.freightPaymentMode ?? currentOrder.freightPaymentMode,
      );
    }

    batch.update(orderRef, { ...rest, updatedAt: now });
    await batch.commit();

    const nextTotalEstimated = Number(rest.totalEstimated ?? currentOrder.totalEstimated ?? 0);
    const nextDeliveryFee = normalizedDeliveryFee;
    const nextGoodsAmountEstimated = Math.max(nextTotalEstimated - nextDeliveryFee, 0);
    const nextFreightPaymentMode =
      'freightPaymentMode' in rest ? rest.freightPaymentMode : currentOrder.freightPaymentMode ?? null;
    const financialSnap = await dbAdmin
      .collection('purchase_financials')
      .where('purchaseOrderId', '==', id)
      .get();
    if (!financialSnap.empty) {
      await Promise.all(
        financialSnap.docs.map((financialDoc) =>
          financialDoc.ref.set(
            {
              amountEstimated: nextTotalEstimated,
              goodsAmountEstimated: nextGoodsAmountEstimated,
              freightAmountEstimated: nextDeliveryFee,
              freightPaymentMode: nextFreightPaymentMode,
              accountPlanId: rest.accountPlanId ?? currentOrder.accountPlanId ?? null,
              accountPlanName: rest.accountPlanName ?? currentOrder.accountPlanName ?? null,
              freightAccountPlanId: rest.freightAccountPlanId ?? currentOrder.freightAccountPlanId ?? null,
              freightAccountPlanName: rest.freightAccountPlanName ?? currentOrder.freightAccountPlanName ?? null,
              resultCenterId: rest.resultCenterId ?? currentOrder.resultCenterId ?? null,
              resultCenterName: rest.resultCenterName ?? currentOrder.resultCenterName ?? null,
              paymentMethod: rest.paymentMethod ?? currentOrder.paymentMethod ?? null,
              paymentAccountId: rest.paymentAccountId ?? currentOrder.paymentAccountId ?? null,
              paymentAccountName: rest.paymentAccountName ?? currentOrder.paymentAccountName ?? null,
              paymentMethodId: rest.paymentMethodId ?? currentOrder.paymentMethodId ?? null,
              paymentMethodLabel: rest.paymentMethodLabel ?? currentOrder.paymentMethodLabel ?? null,
              paymentCondition: rest.paymentCondition ?? currentOrder.paymentCondition ?? null,
              installmentsCount: rest.installmentsCount ?? currentOrder.installmentsCount ?? null,
              installmentDueDates: rest.installmentDueDates ?? currentOrder.installmentDueDates ?? null,
              paymentDueDate: rest.paymentDueDate ?? currentOrder.paymentDueDate ?? null,
              updatedAt: now,
            },
            { merge: true },
          ),
        ),
      );
    }
    return NextResponse.json({ ok: true });
  }

  return jsonError('Operação PATCH não implementada para este caminho.', 404);
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ path?: string[] }> }) {
  const path = (await context.params).path ?? [];
  const [resource, id, child, childId] = path;
  const userContext = await getUserContext(request);
  if (!userContext) return jsonError('Não autorizado.', 401);
  if (resource === 'quotations' && !isAllowed(userContext, canCreateQuotation)) {
    return permissionError();
  }

  if (resource === 'quotations' && id && child === 'items' && childId) {
    await dbAdmin.collection('quotations').doc(id).collection('items').doc(childId).delete();
    return NextResponse.json({ ok: true });
  }

  return jsonError('Operação DELETE não implementada para este caminho.', 404);
}
