import { NextRequest, NextResponse } from 'next/server';
import { hrDbAdmin } from '@/lib/firebase-rh-admin';
import { assertHrAccess } from '@/features/hr/lib/server-access';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const access = await assertHrAccess(request, 'manage').catch(() => null);
  if (!access) return jsonError('Sem permissão para gerenciar candidatos.', 403);

  const { id } = await context.params;
  const body = await request.json();
  const now = new Date().toISOString();
  const currentDoc = typeof body.status === 'string'
    ? await hrDbAdmin.collection('candidates').doc(id).get()
    : null;

  await hrDbAdmin.collection('candidates').doc(id).update({
    ...body,
    updatedAt: now,
  });

  const latestApplicationId = typeof body.latestApplicationId === 'string'
    ? body.latestApplicationId
    : currentDoc?.data()?.latestApplicationId;
  const status = typeof body.status === 'string' ? body.status : null;
  if (latestApplicationId && status) {
    await hrDbAdmin.collection('applications').doc(latestApplicationId).set({
      stage: status,
      updatedAt: now,
      updatedBy: access.decoded.uid,
    }, { merge: true });
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const access = await assertHrAccess(request, 'manage').catch(() => null);
  if (!access) return jsonError('Sem permissão para gerenciar candidatos.', 403);

  const { id } = await context.params;
  await hrDbAdmin.collection('candidates').doc(id).delete();
  return NextResponse.json({ ok: true });
}
