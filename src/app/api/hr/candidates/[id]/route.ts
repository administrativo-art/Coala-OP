import { NextRequest, NextResponse } from 'next/server';
import { hrDbAdmin } from '@/lib/firebase-rh-admin';
import { assertHrAccess } from '@/features/hr/lib/server-access';
import { logAction } from '@/lib/log-action';

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
  const currentDoc = await hrDbAdmin.collection('candidates').doc(id).get();
  const before = currentDoc.data() ?? {};

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

  await logAction({
    user_id: access.decoded.uid,
    username: access.decoded.email ?? null,
    module: 'recruitment.candidates',
    action: 'candidate_updated',
    metadata: {
      target_type: 'candidate',
      target_id: id,
      target_name: before.name ?? before.email ?? id,
      changed_fields: Object.keys(body),
      before: {
        status: before.status ?? null,
        jobOpeningId: before.jobOpeningId ?? null,
        latestApplicationId: before.latestApplicationId ?? null,
      },
      after: {
        status: body.status ?? before.status ?? null,
        jobOpeningId: body.jobOpeningId ?? before.jobOpeningId ?? null,
        latestApplicationId,
      },
    },
    ttl_days: 365,
  });

  return NextResponse.json({ ok: true });
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const access = await assertHrAccess(request, 'manage').catch(() => null);
  if (!access) return jsonError('Sem permissão para gerenciar candidatos.', 403);

  const { id } = await context.params;
  const currentDoc = await hrDbAdmin.collection('candidates').doc(id).get();
  const before = currentDoc.data() ?? {};
  await hrDbAdmin.collection('candidates').doc(id).delete();
  await logAction({
    user_id: access.decoded.uid,
    username: access.decoded.email ?? null,
    module: 'recruitment.candidates',
    action: 'candidate_deleted',
    metadata: {
      target_type: 'candidate',
      target_id: id,
      target_name: before.name ?? before.email ?? id,
      email: before.email ?? null,
      status: before.status ?? null,
    },
    ttl_days: 365,
  });
  return NextResponse.json({ ok: true });
}
