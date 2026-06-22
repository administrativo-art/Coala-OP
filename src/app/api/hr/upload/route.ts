import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { getStorage } from 'firebase-admin/storage';
import { adminApp } from '@/lib/firebase-admin';
import { assertHrAccess } from '@/features/hr/lib/server-access';
import { firebaseClientConfig } from '@/lib/firebase-client-config';
import { hrDbAdmin } from '@/lib/firebase-rh-admin';
import { getFeatureFlags } from '@/lib/feature-flags';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const HR_RESUME_MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED_MIME = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);
const UPLOAD_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const UPLOAD_LIMIT_MAX = 5;
const rateBuckets = new Map<string, { count: number; resetAt: number }>();

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

function trimText(value: unknown, maxLength: number) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function getClientKey(request: NextRequest) {
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return forwarded || request.headers.get('x-real-ip') || 'unknown';
}

function isRateLimited(key: string) {
  const now = Date.now();
  for (const [bucketKey, bucket] of rateBuckets.entries()) {
    if (now > bucket.resetAt) rateBuckets.delete(bucketKey);
  }

  const current = rateBuckets.get(key);
  if (!current || now > current.resetAt) {
    rateBuckets.set(key, { count: 1, resetAt: now + UPLOAD_LIMIT_WINDOW_MS });
    return false;
  }
  current.count += 1;
  return current.count > UPLOAD_LIMIT_MAX;
}

async function assertPublicUploadAllowed(request: NextRequest, formData: FormData) {
  const flags = await getFeatureFlags();
  if (flags.kill_recruitment_public_landing) {
    return jsonError('Envio de currículo temporariamente indisponível.', 503);
  }

  if (isRateLimited(getClientKey(request))) {
    return jsonError('Muitas tentativas. Tente novamente em alguns minutos.', 429);
  }

  const website = trimText(formData.get('website'), 200);
  if (website) return jsonError('Envio não aceito.', 400);

  if (trimText(formData.get('talentPool'), 20) === 'true') {
    return null;
  }

  const slug = trimText(formData.get('slug'), 120);
  if (!slug) return jsonError('Identificador da vaga ausente.');

  const opening = await hrDbAdmin
    .collection('jobOpenings')
    .where('slug', '==', slug)
    .where('status', '==', 'open')
    .limit(1)
    .get();

  if (opening.empty) return jsonError('Vaga não encontrada ou não está aberta.', 404);
  return null;
}

export async function POST(request: NextRequest) {
  const access = await assertHrAccess(request, 'view').catch(() => null);
  const formData = await request.formData();

  if (!access) {
    const publicError = await assertPublicUploadAllowed(request, formData);
    if (publicError) return publicError;
  }

  const file = formData.get('file');

  if (!(file instanceof File)) return jsonError('Arquivo ausente.');
  if (file.size > HR_RESUME_MAX_BYTES) return jsonError('Arquivo acima do limite de 10 MB.');
  if (!ALLOWED_MIME.has(file.type)) return jsonError('Somente PDF, DOC e DOCX são aceitos.');

  const token = randomUUID();
  const safeName = file.name.replace(/[^a-zA-Z0-9.\-_]/g, '_').slice(0, 80);
  const scope = access ? 'internal' : 'public';
  const objectPath = `hr/resumes/${scope}/${Date.now()}-${token}-${safeName}`;

  const bucket = getStorage(adminApp).bucket(firebaseClientConfig.storageBucket);
  const buffer = Buffer.from(await file.arrayBuffer());

  await bucket.file(objectPath).save(buffer, {
    metadata: {
      contentType: file.type,
      metadata: { firebaseStorageDownloadTokens: token },
    },
  });

  const url = `https://firebasestorage.googleapis.com/v0/b/${firebaseClientConfig.storageBucket}/o/${encodeURIComponent(objectPath)}?alt=media&token=${token}`;
  return NextResponse.json({ url, path: objectPath }, { status: 201 });
}
