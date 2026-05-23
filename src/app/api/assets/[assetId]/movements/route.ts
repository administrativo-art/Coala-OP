import { NextRequest, NextResponse } from 'next/server';

import { requireUser } from '@/lib/auth-server';
import { dbAdmin } from '@/lib/firebase-admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest, context: { params: Promise<{ assetId: string }> }) {
  const userContext = await requireUser(request);
  if (!userContext.permissions.assets?.viewHistory) {
    return NextResponse.json({ error: 'Sem permissão para ver histórico de patrimônio.' }, { status: 403 });
  }

  const { assetId } = await context.params;
  const snap = await dbAdmin
    .collection('assetMovements')
    .where('assetId', '==', assetId)
    .get();
  const data = snap.docs
    .map((doc) => ({ id: doc.id, ...doc.data() }))
    .sort((a: any, b: any) => String(b.occurredAt).localeCompare(String(a.occurredAt)));
  return NextResponse.json(data);
}
