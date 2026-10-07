import { NextRequest, NextResponse } from 'next/server';
import { dbAdmin } from '@/lib/firebase-admin';
import { requireUser } from '@/lib/auth-server';
import { ACTIVE_NOTICE_RECEIPT_STATUSES, assertNoticeAccess, pendingNoticeQuantities } from '@/lib/pending-purchase-notice-policy';
import { withApiErrorHandling } from '@/lib/observability/api-error';
import { AppError } from '@/lib/observability/app-error';
import { rethrowServerAuthenticationFailure } from '@/lib/server-authentication-failure';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const WORKSPACE_ID = process.env.NEXT_PUBLIC_WORKSPACE_ID ?? process.env.WORKSPACE_ID ?? 'coala';
const ACTIVE = new Set<string>(ACTIVE_NOTICE_RECEIPT_STATUSES);

/** Operational notice only. It does not modify purchase or financial state. */
export const GET = withApiErrorHandling({ source: 'api-purchasing', operation: 'list-pending-purchase-notices',
  routeOrJob: '/api/purchasing/pending-by-destination' }, async (request: NextRequest) => {
  let user;
  try { user = await requireUser(request); } catch (error) { rethrowServerAuthenticationFailure(error); }
  const kioskId = request.nextUrl.searchParams.get('destinationKioskId')?.trim() ?? '';
  assertNoticeAccess(user, kioskId, 'read');
  const cursor = request.nextUrl.searchParams.get('cursor')?.trim() ?? '';
  let position: [string, string] | null = null;
  try {
    if (cursor) {
      if (cursor.length > 512) throw new Error('cursor');
      const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
      if (!Array.isArray(parsed) || parsed.length !== 2 || !ACTIVE.has(parsed[0]) ||
        typeof parsed[1] !== 'string' || !parsed[1] || parsed[1].includes('/')) throw new Error('cursor');
      position = parsed as [string, string];
    }
  } catch { throw new AppError({ code: 'NOTICE_CURSOR_INVALID', kind: 'VALIDATION', safeMessage: 'Cursor inválido.' }); }
  // At most 20 receipts and 100 items per receipt. One page per deliberate UI request.
  let query = dbAdmin.collection('purchase_receipts')
    .where('workspaceId', '==', WORKSPACE_ID)
    .where('destinationKioskId', '==', kioskId)
    .where('status', 'in', [...ACTIVE])
    .orderBy('status').orderBy('__name__');
  if (position) query = query.startAfter(...position);
  const page = await query.limit(21).get();
  const receipts = page.docs.slice(0, 20);
  const notices = [];
  for (const receipt of receipts) {
    const data = receipt.data();
    const items = await receipt.ref.collection('items').limit(101).get();
    if (items.size > 100) {
      throw new AppError({ code: 'NOTICE_ITEM_LIMIT', kind: 'CONFLICT', safeMessage: 'Recebimento excede o limite de consulta.' });
    }
    for (const item of items.docs) {
      const entry = item.data();
      const quantities = pendingNoticeQuantities(entry);
      if (!quantities) continue;
      notices.push({
        purchaseOrderId: data.purchaseOrderId,
        purchaseReceiptId: receipt.id,
        purchaseReceiptItemId: item.id,
        destinationKioskId: kioskId,
        baseItemId: entry.baseItemId ?? null,
        productId: entry.productId ?? null,
        itemName: entry.itemName ?? null,
        unit: entry.purchaseUnitLabel ?? entry.unit ?? '',
        ...quantities,
        expectedDate: data.expectedDate ?? null,
        receiptStatus: data.status,
      });
    }
  }
  return NextResponse.json({
    notices,
    nextCursor: page.size > 20
      ? Buffer.from(JSON.stringify([receipts[receipts.length - 1].get('status'), receipts[receipts.length - 1].id])).toString('base64url')
      : null,
  });
});
