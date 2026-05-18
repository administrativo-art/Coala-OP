import { NextRequest, NextResponse } from 'next/server';
import { hrDbAdmin } from '@/lib/firebase-rh-admin';
import { assertHrAccess } from '@/features/hr/lib/server-access';
import { logAction } from '@/lib/log-action';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

function normalizeEmail(value: unknown) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

export async function GET(request: NextRequest) {
  const access = await assertHrAccess(request, 'view').catch(() => null);
  if (!access) return jsonError('Sem permissão para acessar candidatos.', 403);

  const snapshot = await hrDbAdmin.collection('candidates').orderBy('appliedAt', 'desc').get();
  const candidates = await Promise.all(snapshot.docs.map(async (doc) => {
    const data = doc.data();
    const latestApplicationId = typeof data.latestApplicationId === 'string' ? data.latestApplicationId : null;
    if (!latestApplicationId) return { id: doc.id, ...data };

    const applicationDoc = await hrDbAdmin.collection('applications').doc(latestApplicationId).get();
    return {
      id: doc.id,
      ...data,
      latestApplication: applicationDoc.exists
        ? { id: applicationDoc.id, ...applicationDoc.data() }
        : null,
    };
  }));
  return NextResponse.json(candidates);
}

export async function POST(request: NextRequest) {
  const access = await assertHrAccess(request, 'manage').catch(() => null);
  if (!access) return jsonError('Sem permissão para gerenciar candidatos.', 403);

  const body = await request.json();
  const now = new Date().toISOString();
  const email = normalizeEmail(body.email);

  if (!email) return jsonError('E-mail é obrigatório.');

  const existing = await hrDbAdmin
    .collection('candidates')
    .where('email', '==', email)
    .limit(1)
    .get();

  const candidateRef = existing.empty ? hrDbAdmin.collection('candidates').doc() : existing.docs[0].ref;
  const existingData = existing.empty ? null : existing.docs[0].data();
  let latestApplicationId = body.latestApplicationId ?? existingData?.latestApplicationId ?? null;

  if (body.jobOpeningId) {
    const applicationRef = hrDbAdmin.collection('applications').doc(`${candidateRef.id}_${body.jobOpeningId}`);
    const applicationDoc = await applicationRef.get();
    if (applicationDoc.exists && existingData?.jobOpeningId !== body.jobOpeningId) {
      return jsonError('Este candidato já tem candidatura para esta vaga.', 409);
    }
    latestApplicationId = applicationRef.id;
    await applicationRef.set({
      candidateId: candidateRef.id,
      jobOpeningId: body.jobOpeningId,
      jobRoleId: body.jobRoleId,
      jobRoleName: body.jobRoleName ?? null,
      stage: body.status || 'applied',
      status: 'active',
      source: body.source ?? 'manual',
      notes: body.notes ?? null,
      resumeUrl: body.resumeUrl ?? null,
      resumePath: body.resumePath ?? null,
      appliedAt: body.appliedAt || now,
      updatedAt: now,
      createdBy: access.decoded.uid,
    }, { merge: true });
  }

  await candidateRef.set({
    ...body,
    email,
    latestApplicationId,
    appliedAt: body.appliedAt || now,
    updatedAt: now,
    createdBy: existingData?.createdBy ?? access.decoded.uid,
    firstAppliedAt: existingData?.firstAppliedAt ?? existingData?.appliedAt ?? body.appliedAt ?? now,
  }, { merge: true });

  await logAction({
    user_id: access.decoded.uid,
    username: access.decoded.email ?? null,
    module: 'recruitment.candidates',
    action: existing.empty ? 'candidate_created' : 'candidate_updated',
    metadata: {
      target_type: 'candidate',
      target_id: candidateRef.id,
      target_name: body.name ?? email,
      email,
      job_opening_id: body.jobOpeningId ?? null,
      latest_application_id: latestApplicationId,
      reused: !existing.empty,
    },
    ttl_days: 365,
  });

  return NextResponse.json({ id: candidateRef.id, reused: !existing.empty }, { status: existing.empty ? 201 : 200 });
}
