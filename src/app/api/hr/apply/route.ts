import { NextRequest, NextResponse } from 'next/server';
import { hrDbAdmin } from '@/lib/firebase-rh-admin';
import { getFeatureFlags } from '@/lib/feature-flags';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const APPLY_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const APPLY_LIMIT_MAX = 5;
const rateBuckets = new Map<string, { count: number; resetAt: number }>();

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

function trimText(value: unknown, maxLength: number) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function isRateLimited(key: string) {
  const now = Date.now();
  for (const [bucketKey, bucket] of rateBuckets.entries()) {
    if (now > bucket.resetAt) rateBuckets.delete(bucketKey);
  }

  const current = rateBuckets.get(key);
  if (!current || now > current.resetAt) {
    rateBuckets.set(key, { count: 1, resetAt: now + APPLY_LIMIT_WINDOW_MS });
    return false;
  }
  current.count += 1;
  return current.count > APPLY_LIMIT_MAX;
}

function getClientKey(request: NextRequest) {
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return forwarded || request.headers.get('x-real-ip') || 'unknown';
}

function isAllowedResumeUrl(value: unknown) {
  return typeof value === 'string' &&
    value.startsWith('https://firebasestorage.googleapis.com/') &&
    value.length <= 1200;
}

export async function POST(request: NextRequest) {
  const flags = await getFeatureFlags();
  if (flags.kill_recruitment_public_landing) {
    return jsonError('Candidaturas temporariamente indisponíveis.', 503);
  }

  if (isRateLimited(getClientKey(request))) {
    return jsonError('Muitas tentativas. Tente novamente em alguns minutos.', 429);
  }

  const body = await request.json().catch(() => null);
  if (!body) return jsonError('Payload inválido.');

  const slug = trimText(body.slug, 120);
  const name = trimText(body.name, 120);
  const email = trimText(body.email, 180).toLowerCase();
  const phone = trimText(body.phone, 40);
  const coverMessage = trimText(body.message, 1500);
  const source = trimText(body.source, 40) || 'site';
  const resumeUrl = isAllowedResumeUrl(body.resumeUrl) ? body.resumeUrl : null;
  const resumePath = trimText(body.resumePath, 500) || null;
  const consentAccepted = body.consentAccepted === true;
  const website = trimText(body.website, 200);

  if (website) return jsonError('Candidatura não aceita.', 400);
  if (!consentAccepted) return jsonError('É necessário aceitar o tratamento dos dados para enviar a candidatura.');
  if (!slug) return jsonError('Identificador da vaga ausente.');
  if (!name) return jsonError('Nome é obrigatório.');
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return jsonError('E-mail inválido.');
  }

  // Verify opening exists and is open
  const snapshot = await hrDbAdmin
    .collection('jobOpenings')
    .where('slug', '==', slug)
    .where('status', '==', 'open')
    .limit(1)
    .get();

  if (snapshot.empty) return jsonError('Vaga não encontrada ou não está aberta.', 404);

  const opening = snapshot.docs[0];
  const openingData = opening.data();

  const existingCandidate = await hrDbAdmin
    .collection('candidates')
    .where('email', '==', email)
    .limit(1)
    .get();

  const now = new Date().toISOString();
  const candidateRef = existingCandidate.empty
    ? hrDbAdmin.collection('candidates').doc()
    : existingCandidate.docs[0].ref;
  const candidateData = existingCandidate.empty ? null : existingCandidate.docs[0].data();
  const applicationRef = hrDbAdmin.collection('applications').doc(`${candidateRef.id}_${opening.id}`);
  const applicationDoc = await applicationRef.get();

  if (applicationDoc.exists || candidateData?.jobOpeningId === opening.id) {
    return jsonError('Este e-mail já tem uma candidatura para esta vaga.', 409);
  }

  const applicationPayload = {
    candidateId: candidateRef.id,
    jobOpeningId: opening.id,
    jobRoleId: openingData.jobRoleId,
    jobRoleName: openingData.jobRoleName,
    stage: 'applied',
    status: 'active',
    source,
    notes: coverMessage || null,
    resumeUrl,
    resumePath,
    appliedAt: now,
    updatedAt: now,
    createdBy: 'public',
  };

  const candidatePayload = {
    name,
    email,
    phone: phone || null,
    jobRoleId: openingData.jobRoleId,
    jobRoleName: openingData.jobRoleName,
    jobOpeningId: opening.id,
    latestApplicationId: applicationRef.id,
    status: 'applied',
    notes: coverMessage || null,
    source,
    resumeUrl,
    resumePath,
    rating: 0,
    consent: {
      accepted: true,
      acceptedAt: now,
      purpose: 'recruitment',
      retention: 'recruitment_process',
    },
    publicMetadata: {
      ip: getClientKey(request),
      userAgent: request.headers.get('user-agent')?.slice(0, 300) || null,
    },
    appliedAt: now,
    updatedAt: now,
    createdBy: 'public',
  };

  const batch = hrDbAdmin.batch();
  batch.set(applicationRef, applicationPayload);
  if (existingCandidate.empty) {
    batch.set(candidateRef, candidatePayload);
  } else {
    batch.set(candidateRef, {
      ...candidatePayload,
      createdBy: candidateData?.createdBy ?? 'public',
      firstAppliedAt: candidateData?.firstAppliedAt ?? candidateData?.appliedAt ?? now,
    }, { merge: true });
  }
  await batch.commit();

  return NextResponse.json({ ok: true }, { status: 201 });
}
