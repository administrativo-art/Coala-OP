import { NextRequest, NextResponse } from 'next/server';
import { dbAdmin } from '@/lib/firebase-admin';
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

  await dbAdmin.collection('candidates').doc(id).update({
    ...body,
    updatedAt: new Date().toISOString(),
  });

  return NextResponse.json({ ok: true });
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const access = await assertHrAccess(request, 'manage').catch(() => null);
  if (!access) return jsonError('Sem permissão para gerenciar candidatos.', 403);

  const { id } = await context.params;
  await dbAdmin.collection('candidates').doc(id).delete();
  return NextResponse.json({ ok: true });
}
