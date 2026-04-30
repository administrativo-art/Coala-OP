import { NextRequest, NextResponse } from 'next/server';
import { dbAdmin } from '@/lib/firebase-admin';
import { verifyAuth } from '@/lib/verify-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const decoded = await verifyAuth(request).catch(() => null);
  if (!decoded || decoded.email !== 'imated@gmail.com') { // Basic safety check for the user
     return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
  }

  const ordersSnap = await dbAdmin.collection('purchase_orders')
    .where('status', '==', 'confirmed')
    .get();

  const results = [];
  const now = new Date().toISOString();

  for (const orderDoc of ordersSnap.docs) {
    const orderId = orderDoc.id;
    const orderData = orderDoc.data();

    // Check if a receipt already exists
    const receiptSnap = await dbAdmin.collection('purchase_receipts')
      .where('purchaseOrderId', '==', orderId)
      .limit(1)
      .get();

    if (receiptSnap.empty) {
      const receiptRef = dbAdmin.collection('purchase_receipts').doc();
      const batch = dbAdmin.batch();

      batch.set(receiptRef, {
        workspaceId: orderData.workspaceId || 'coala',
        purchaseOrderId: orderId,
        supplierId: orderData.supplierId,
        supplierName: orderData.supplierName,
        status: 'awaiting_delivery',
        receiptMode: orderData.paymentCondition === 'immediate' ? 'immediate_pickup' : 'future_delivery',
        expectedDate: orderData.paymentDueDate || now,
        totalEstimated: orderData.totalEstimated || 0,
        totalConfirmed: 0,
        createdAt: now,
        updatedAt: now,
      });

      const itemsSnap = await orderDoc.ref.collection('items').get();
      for (const itemDoc of itemsSnap.docs) {
        const item = itemDoc.data();
        const itemRef = receiptRef.collection('items').doc();
        batch.set(itemRef, {
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

      await batch.commit();
      results.push({ orderId, receiptId: receiptRef.id, supplier: orderData.supplierName });
    }
  }

  return NextResponse.json({ ok: true, recovered: results });
}
