import { NextRequest, NextResponse } from 'next/server';
import { Timestamp } from 'firebase-admin/firestore';
import { addMonths } from 'date-fns';

import { dbAdmin } from '@/lib/firebase-admin';
import { financialDbAdmin } from '@/lib/firebase-financial-admin';
import { verifyAuth } from '@/lib/verify-auth';

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

  if (resource === 'quotations' && id && child === 'items') {
    if (childId) {
      const doc = await dbAdmin.collection('quotations').doc(id).collection('items').doc(childId).get();
      return NextResponse.json(docData(doc));
    }
    const snapshot = await dbAdmin.collection('quotations').doc(id).collection('items').get();
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
    await ref.set({
      workspaceId: WORKSPACE_ID,
      supplierId: body.supplierId,
      mode: body.mode ?? 'remote',
      status: 'draft',
      validUntil: body.validUntil ?? null,
      notes: body.notes ?? null,
      createdAt: now,
      createdBy: decoded.uid,
    });
    return NextResponse.json({ id: ref.id }, { status: 201 });
  }

  if (resource === 'quotations' && id && child === 'finalize') {
    const selectedItemIds: string[] = Array.isArray(body.selectedItemIds) ? body.selectedItemIds : [];
    const batch = dbAdmin.batch();
    batch.update(dbAdmin.collection('quotations').doc(id), { status: 'quoted', finalizedAt: now });
    if (selectedItemIds.length > 0) {
      const itemsSnap = await dbAdmin.collection('quotations').doc(id).collection('items').get();
      for (const itemDoc of itemsSnap.docs) {
        const nextStatus = selectedItemIds.includes(itemDoc.id) ? 'selected' : 'pending';
        batch.update(itemDoc.ref, { conversionStatus: nextStatus });
      }
    }
    await batch.commit();
    return NextResponse.json({ ok: true });
  }

  if (resource === 'quotations' && id && child === 'cancel') {
    await dbAdmin.collection('quotations').doc(id).update({ status: 'cancelled', cancelledAt: now });
    return NextResponse.json({ ok: true });
  }

  if (resource === 'quotations' && id && child === 'items' && !childId) {
    const ref = dbAdmin.collection('quotations').doc(id).collection('items').doc();
    const quantity = Number(body.quantity ?? 0);
    const unitPrice = Number(body.unitPrice ?? 0);
    const discount = Number(body.discount ?? 0);
    await ref.set({
      quotationId: id,
      baseItemId: body.baseItemId ?? null,
      productId: body.productId ?? null,
      freeText: body.freeText ?? null,
      barcode: body.barcode ?? null,
      unit: body.unit,
      purchaseUnitType: body.purchaseUnitType ?? 'content',
      purchaseUnitLabel: body.purchaseUnitLabel ?? body.unit,
      quantity,
      unitPrice,
      discount,
      totalPrice: Math.max(quantity * unitPrice - discount, 0),
      deliveryEstimateDays: body.deliveryEstimateDays ?? null,
      observation: body.observation ?? null,
      conversionStatus: 'pending',
    });
    return NextResponse.json({ id: ref.id }, { status: 201 });
  }

  if (resource === 'quotations' && id && child === 'items' && childId && action === 'normalize') {
    await dbAdmin.collection('quotations').doc(id).collection('items').doc(childId).update({
      baseItemId: body.baseItemId,
      freeText: null,
    });
    return NextResponse.json({ ok: true });
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

  if (resource === 'quotations' && id && !child) {
    await dbAdmin.collection('quotations').doc(id).update(body);
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
