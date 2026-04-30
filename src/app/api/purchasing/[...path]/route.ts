import { NextRequest, NextResponse } from 'next/server';
import { Timestamp } from 'firebase-admin/firestore';
import { addMonths } from 'date-fns';

import { dbAdmin } from '@/lib/firebase-admin';
import { financialDbAdmin } from '@/lib/firebase-financial-admin';
import { verifyAuth } from '@/lib/verify-auth';
import { PURCHASING_COLLECTIONS } from '@/lib/purchasing-constants';
import {
  calculatePricePerBaseUnit,
  calculateStockQuantityFromPurchase,
} from '@/lib/purchasing-units';
import { type Product, type BaseProduct } from '@/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const WORKSPACE_ID = process.env.NEXT_PUBLIC_WORKSPACE_ID ?? process.env.WORKSPACE_ID ?? 'coala';

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

async function assertAuth(request: NextRequest) {
  try {
    return await verifyAuth(request);
  } catch {
    return null;
  }
}

function docData(doc: FirebaseFirestore.DocumentSnapshot) {
  return doc.exists ? { id: doc.id, ...doc.data() } : null;
}

function collectionData(snapshot: FirebaseFirestore.QuerySnapshot) {
  return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
}

function buildExpenseInstallments(totalValue: number, count: number, firstDueDateIso: string) {
  const safeCount = Math.max(2, count);
  const baseValue = Number.parseFloat((totalValue / safeCount).toFixed(2));
  const diff = Number.parseFloat((totalValue - baseValue * safeCount).toFixed(2));
  const firstDueDate = new Date(firstDueDateIso);

  return Array.from({ length: safeCount }, (_, index) => {
    const value = index === safeCount - 1 ? Number.parseFloat((baseValue + diff).toFixed(2)) : baseValue;
    return {
      number: index + 1,
      dueDate: Timestamp.fromDate(addMonths(firstDueDate, index)),
      value,
      status: 'pending',
    };
  });
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
    totalValue,
    dueDate: Timestamp.fromDate(new Date(orderData.paymentDueDate)),
    competenceDate: Timestamp.fromDate(new Date(orderData.createdAt ?? orderData.paymentDueDate)),
    paymentMethod: orderData.paymentCondition === 'installments' ? 'installments' : 'single',
    installments:
      orderData.paymentCondition === 'installments'
        ? buildExpenseInstallments(totalValue, Number(orderData.installmentsCount ?? 2), orderData.paymentDueDate)
        : null,
    installmentType: orderData.paymentCondition === 'installments' ? 'equal' : null,
    installmentPeriodicity: orderData.paymentCondition === 'installments' ? 'monthly' : null,
    firstInstallmentDueDate:
      orderData.paymentCondition === 'installments' ? Timestamp.fromDate(new Date(orderData.paymentDueDate)) : null,
    isApportioned: false,
    resultCenter: orderData.resultCenterId ?? null,
    apportionments: null,
    notes: orderData.notes
      ? `${orderData.notes}\n\n[AUDITORIA DE COMPRAS PENDENTE] Revise parcelamento, conta financeira e liquidação.`
      : '[AUDITORIA DE COMPRAS PENDENTE] Revise parcelamento, conta financeira e liquidação.',
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
  const decoded = await assertAuth(request);
  if (!decoded) return jsonError('Não autorizado.', 401);

  const path = (await context.params).path ?? [];
  const [resource, id, child, childId] = path;

  if (resource === 'barcode' && id === 'lookup') {
    return lookupBarcode(request.nextUrl.searchParams.get('barcode'));
  }

  if (resource === 'quotations' && id === 'compare') {
    return compareQuotations(request.nextUrl.searchParams.get('baseItemId'));
  }

  if (resource === 'classification-options') {
    const [accountPlansSnap, resultCentersSnap] = await Promise.all([
      financialDbAdmin.collection('accountPlans').get(),
      financialDbAdmin.collection('resultCenters').get(),
    ]);

    return NextResponse.json({
      accountPlans: accountPlansSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() })),
      resultCenters: resultCentersSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() })),
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
  const decoded = await assertAuth(request);
  if (!decoded) return jsonError('Não autorizado.', 401);

  const path = (await context.params).path ?? [];
  const [resource, id, child, childId, action] = path;
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

  if (resource === 'orders' && !id) {
    const ref = dbAdmin.collection('purchase_orders').doc();
    const items = Array.isArray(body.items) ? body.items : [];
    const itemsTotal = items.reduce((sum: number, item: any) => sum + (Number(item.quantityOrdered || 0) * Number(item.unitPriceOrdered || 0)), 0);
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
      installmentsCount: Number(body.installmentsCount ?? 1),
      accountPlanId: body.accountPlanId ?? null,
      accountPlanName: body.accountPlanName ?? null,
      freightAccountPlanId: body.freightAccountPlanId ?? null,
      freightAccountPlanName: body.freightAccountPlanName ?? null,
      resultCenterId: body.resultCenterId ?? null,
      resultCenterName: body.resultCenterName ?? null,
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
        batch.set(itemRef, {
          purchaseOrderId: ref.id,
          baseItemId: item.baseItemId || '',
          productId: item.productId ?? null,
          unit: item.unit || '',
          purchaseUnitType: item.purchaseUnitType ?? 'content',
          purchaseUnitLabel: item.purchaseUnitLabel ?? (item.unit || ''),
          quantityOrdered: q,
          unitPriceOrdered: p,
          discountOrdered: d,
          totalOrdered: Math.max((q * p) - d, 0),
          quotationItemId: item.quotationItemId ?? null,
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
      batch.set(receiptItemRef, {
        purchaseReceiptId: receiptRef.id,
        purchaseOrderItemId: itemDoc.id,
        baseItemId: item.baseItemId,
        productId: item.productId ?? null,
        unit: item.unit,
        purchaseUnitType: item.purchaseUnitType || 'content',
        purchaseUnitLabel: item.purchaseUnitLabel || item.unit,
        quantityOrdered: item.quantityOrdered,
        unitPriceOrdered: item.unitPriceOrdered,
        quantityReceived: 0,
        unitPriceConfirmed: 0,
        status: 'pending',
      });
    }

    batch.set(financialRef, {
      workspaceId: WORKSPACE_ID,
      purchaseOrderId: id,
      supplierId: order.supplierId,
      supplierName: order.supplierName,
      amountEstimated: totalEstimated,
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
    await dbAdmin.collection('purchase_orders').doc(id).update({ status: 'cancelled', cancelledAt: now, updatedAt: now });

    // Try to cancel the financial expense as well
    const financialSnap = await financialDbAdmin
      .collection('expenses')
      .where('purchaseOrderId', '==', id)
      .limit(1)
      .get();
    
    if (!financialSnap.empty) {
      await financialSnap.docs[0].ref.update({
        status: 'cancelled',
        updatedAt: Timestamp.now(),
        notes: `Cancelado junto com o pedido de compra em ${new Date().toLocaleDateString('pt-BR')}.`,
      });
    }

    return NextResponse.json({ ok: true });
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

    if (quantityReceived === 0) return 'cancelled';
    if (quantityReceived < quantityOrdered) return 'partial';
    if (divergenceReason || quantityDiffers || priceDiffers) return 'divergent';
    return 'received';
  }

  if (resource === 'receipts' && id && child === 'save-conference') {
    const batch = dbAdmin.batch();
    const receiptRef = dbAdmin.collection('purchase_receipts').doc(id);
    const receiptSnap = await receiptRef.get();
    if (!receiptSnap.exists) return jsonError('Recebimento não encontrado.', 404);
    const receipt = receiptSnap.data()!;

    const orderRef = dbAdmin.collection('purchase_orders').doc(receipt.purchaseOrderId);
    const orderItemsSnap = await orderRef.collection('items').get();
    const orderItemsById = new Map(orderItemsSnap.docs.map((d) => [d.id, d.data()]));

    let totalConfirmed = 0;
    let hasDivergence = false;
    let hasRemaining = false;

    if (Array.isArray(body.items)) {
      for (const item of body.items) {
        const orderItem = orderItemsById.get(item.purchaseOrderItemId);
        const quantityOrdered = Number(orderItem?.quantityOrdered ?? item.quantityReceived);
        const unitPriceOrdered = Number(orderItem?.unitPriceOrdered ?? item.unitPriceConfirmed);
        const itemStatus = getReceiptItemStatus(
          item.quantityReceived,
          quantityOrdered,
          item.unitPriceConfirmed,
          unitPriceOrdered,
          item.divergenceReason,
        );

        totalConfirmed += item.quantityReceived * item.unitPriceConfirmed;
        if (itemStatus === 'partial') hasRemaining = true;
        if (itemStatus === 'partial' || itemStatus === 'divergent') hasDivergence = true;

        batch.update(receiptRef.collection('items').doc(item.receiptItemId), {
          unit: item.unit,
          purchaseUnitType: item.purchaseUnitType ?? orderItem?.purchaseUnitType ?? 'content',
          purchaseUnitLabel: item.purchaseUnitLabel ?? orderItem?.purchaseUnitLabel ?? item.unit,
          quantityReceived: item.quantityReceived,
          unitPriceConfirmed: item.unitPriceConfirmed,
          totalConfirmed: item.quantityReceived * item.unitPriceConfirmed,
          status: itemStatus,
          divergenceReason: item.divergenceReason?.trim() || null,
        });
      }
    }

    batch.update(receiptRef, {
      status: 'awaiting_stock',
      totalConfirmed,
      conferenceCompletedAt: now,
      updatedAt: now,
      notes: body.notes ?? receipt.notes ?? null,
      receiptProofUrl: body.receiptProofUrl ?? receipt.receiptProofUrl ?? null,
      receiptProofDescription: body.receiptProofDescription ?? receipt.receiptProofDescription ?? null,
    });

    batch.update(orderRef, { totalConfirmed, updatedAt: now });

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
    return NextResponse.json({ ok: true });
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

        const [productDoc, baseProductDoc] = await Promise.all([
          dbAdmin.collection('products').doc(item.productId).get(),
          dbAdmin.collection('baseProducts').doc(item.baseItemId).get(),
        ]);

        if (!productDoc.exists || !baseProductDoc.exists) {
          return jsonError('Unidade de estoque ou insumo base não encontrado.');
        }

        const product = { id: productDoc.id, ...productDoc.data() } as Product;
        const baseProduct = { id: baseProductDoc.id, ...baseProductDoc.data() } as BaseProduct;

        const purchaseUnitType =
          item.purchaseUnitType ?? existingReceiptItem?.purchaseUnitType ?? orderItem?.purchaseUnitType ?? 'content';
        const purchaseUnitLabel =
          item.purchaseUnitLabel ??
          existingReceiptItem?.purchaseUnitLabel ??
          orderItem?.purchaseUnitLabel ??
          existingReceiptItem?.unit ??
          orderItem?.unit ??
          '';

        const confirmedUnitPrice = existingReceiptItem?.unitPriceConfirmed ?? orderItem?.unitPriceOrdered ?? 0;
        const cumulativeReceived = existingReceiptItem?.quantityReceived ?? orderItem?.quantityOrdered ?? 0;

        const convertedPrice = calculatePricePerBaseUnit(
          confirmedUnitPrice,
          product,
          baseProduct,
          purchaseUnitType,
        );
        if (!convertedPrice.ok) return jsonError(convertedPrice.error || 'Erro na conversão de preço.');

        totalConfirmed += cumulativeReceived * confirmedUnitPrice;

        const receiptItemStatus = getReceiptItemStatus(
          cumulativeReceived,
          Number(orderItem?.quantityOrdered ?? cumulativeReceived),
          confirmedUnitPrice,
          Number(orderItem?.unitPriceOrdered ?? confirmedUnitPrice),
          existingReceiptItem?.divergenceReason,
        );

        if (receiptItemStatus === 'divergent' || receiptItemStatus === 'partial') hasDivergence = true;
        if (receiptItemStatus === 'partial') hasRemaining = true;

        if (Array.isArray(item.lots)) {
          for (const lot of item.lots) {
            const stockConversion = calculateStockQuantityFromPurchase(
              lot.quantity,
              product,
              product,
              baseProduct,
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

            const lotKey = `${item.productId}_${body.destinationKioskId}_${lot.lotCode}_${
              lot.expiryDate ?? 'noval'
            }`;
            const stockLotRef = dbAdmin.collection('lots').doc(lotKey);
            batch.set(
              stockLotRef,
              {
                productId: item.productId,
                productName: item.productName ?? item.baseItemId,
                lotNumber: lot.lotCode,
                expiryDate: lot.expiryDate ?? null,
                kioskId: body.destinationKioskId,
                quantity: Timestamp.fromMillis(stockConversion.stockQuantity), // increment hack? no, use FieldValue
                updatedAt: Timestamp.now(),
              },
              { merge: true },
            );
            // Need to fix increment logic for Admin SDK:
            const adminIncrement = (val: number) => require('firebase-admin').firestore.FieldValue.increment(val);
            batch.update(stockLotRef, { quantity: adminIncrement(stockConversion.stockQuantity) });

            const movRef = dbAdmin.collection('movementHistory').doc();
            batch.set(movRef, {
              lotId: lotKey,
              productId: item.productId,
              productName: item.productName ?? item.baseItemId,
              lotNumber: lot.lotCode,
              type: 'ENTRADA',
              quantityChange: stockConversion.stockQuantity,
              toKioskId: body.destinationKioskId,
              toKioskName: body.destinationKioskName,
              userId: decoded.uid,
              username: body.username ?? 'Sistema',
              timestamp: now,
              sourceType: 'purchase_receipt',
              sourceId: id,
            });
          }
        }
      }
    }

    receiptItemsById.forEach((existingItem, rId) => {
      if (payloadReceiptItemIds.has(rId)) return;
      totalConfirmed +=
        (existingItem.quantityReceived ?? 0) * (existingItem.unitPriceConfirmed ?? existingItem.unitPriceOrdered ?? 0);
      if (existingItem.status === 'partial') hasRemaining = true;
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
      receivedAt: now,
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
          ? buildExpenseInstallments(totalValue, Number(order.installmentsCount ?? 2), order.paymentDueDate)
          : null,
      installmentType: order.paymentCondition === 'installments' ? 'equal' : null,
      installmentPeriodicity: order.paymentCondition === 'installments' ? 'monthly' : null,
      firstInstallmentDueDate:
        order.paymentCondition === 'installments' ? Timestamp.fromDate(new Date(order.paymentDueDate)) : null,
      isApportioned: false,
      resultCenter: order.resultCenterId ?? null,
      apportionments: null,
      notes: order.notes
        ? `${order.notes}\n\n[AUDITORIA DE COMPRAS PENDENTE] Revise parcelamento, conta financeira e liquidação.`
        : '[AUDITORIA DE COMPRAS PENDENTE] Revise parcelamento, conta financeira e liquidação.',
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
  const decoded = await assertAuth(request);
  if (!decoded) return jsonError('Não autorizado.', 401);

  const path = (await context.params).path ?? [];
  const [resource, id, child, childId] = path;
  const body = await request.json().catch(() => ({}));
  const now = new Date().toISOString();

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

  if (resource === 'orders' && id && !child) {
    const orderRef = dbAdmin.collection('purchase_orders').doc(id);
    const orderSnap = await orderRef.get();
    if (!orderSnap.exists) return jsonError('Pedido não encontrado.', 404);
    const currentOrder = orderSnap.data()!;

    const { items, ...rest } = body;
    const batch = dbAdmin.batch();

    // If items are provided, we need to recalculate the totalEstimated
    if (Array.isArray(items)) {
      const itemsTotal = items.reduce(
        (sum: number, item: any) =>
          sum + (Number(item.quantityOrdered || 0) * Number(item.unitPriceOrdered || 0)) - Number(item.discountOrdered || 0),
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
        batch.set(itemRef, {
          purchaseOrderId: id,
          baseItemId: item.baseItemId || '',
          productId: item.productId ?? null,
          unit: item.unit || '',
          purchaseUnitType: item.purchaseUnitType ?? 'content',
          purchaseUnitLabel: item.purchaseUnitLabel ?? (item.unit || ''),
          quantityOrdered: q,
          unitPriceOrdered: p,
          discountOrdered: d,
          totalOrdered: Math.max((q * p) - d, 0),
          quotationItemId: item.quotationItemId ?? null,
          notes: item.notes ?? null,
        });
      }
    }

    batch.update(orderRef, { ...rest, updatedAt: now });
    await batch.commit();
    return NextResponse.json({ ok: true });
  }

  return jsonError('Operação PATCH não implementada para este caminho.', 404);
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ path?: string[] }> }) {
  const decoded = await assertAuth(request);
  if (!decoded) return jsonError('Não autorizado.', 401);

  const path = (await context.params).path ?? [];
  const [resource, id, child, childId] = path;

  if (resource === 'quotations' && id && child === 'items' && childId) {
    await dbAdmin.collection('quotations').doc(id).collection('items').doc(childId).delete();
    return NextResponse.json({ ok: true });
  }

  return jsonError('Operação DELETE não implementada para este caminho.', 404);
}
