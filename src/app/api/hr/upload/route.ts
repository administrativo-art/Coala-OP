import { NextRequest, NextResponse } from 'next/server';
import { createHash, randomUUID } from 'crypto';
import { getStorage } from 'firebase-admin/storage';
import { adminApp } from '@/lib/firebase-admin';
import { assertHrAccess } from '@/features/hr/lib/server-access';
import { firebaseClientConfig } from '@/lib/firebase-client-config';
import { hrDbAdmin } from '@/lib/firebase-rh-admin';
import { getFeatureFlags } from '@/lib/feature-flags';
import { onboardingPublicLinkExpired } from '@/lib/hr/onboarding-public-link';
import {
  analyzeEmployeeDocumentWithAi,
  employeeDocumentAiConfiguration,
} from '@/lib/hr/employee-document-ai';
import {
  buildOnboardingDocumentExtractionRecord,
  inferredOnboardingDocumentTypeCode,
  onboardingDocumentExtractionCacheId,
  type OnboardingDocumentExtractionRecord,
} from '@/features/hr/onboarding/document-ai-extraction';
import type { OnboardingDocument } from '@/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const HR_RESUME_MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED_MIME = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
]);
const UPLOAD_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const UPLOAD_LIMIT_MAX = 5;
const ONBOARDING_UPLOAD_LIMIT_MAX = 30;
const rateBuckets = new Map<string, { count: number; resetAt: number }>();

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

function trimText(value: unknown, maxLength: number) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function hasExpectedFileSignature(buffer: Buffer, mimeType: string) {
  if (mimeType === 'application/pdf') return buffer.subarray(0, 5).toString('ascii') === '%PDF-';
  if (mimeType === 'image/jpeg') return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  if (mimeType === 'image/png') {
    const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    return buffer.length >= signature.length && signature.every((byte, index) => buffer[index] === byte);
  }
  return false;
}

function looksEncryptedPdf(buffer: Buffer) {
  return buffer.includes(Buffer.from('/Encrypt', 'ascii'));
}

function getClientKey(request: NextRequest) {
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return forwarded || request.headers.get('x-real-ip') || 'unknown';
}

function isRateLimited(key: string, max = UPLOAD_LIMIT_MAX) {
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
  return current.count > max;
}

function isInsideApplicationWindow(data: FirebaseFirestore.DocumentData, now: string) {
  const start = typeof data.applicationStartAt === 'string' ? data.applicationStartAt : null;
  const end = typeof data.applicationEndAt === 'string'
    ? data.applicationEndAt
    : typeof data.closesAt === 'string'
      ? data.closesAt
      : null;

  if (start && start > now) return false;
  if (end && end < now) return false;
  return true;
}

async function assertPublicUploadAllowed(request: NextRequest, formData: FormData) {
  const flags = await getFeatureFlags();
  if (flags.kill_recruitment_public_landing) {
    return jsonError('Envio de currículo temporariamente indisponível.', 503);
  }

  const website = trimText(formData.get('website'), 200);
  if (website) return jsonError('Envio não aceito.', 400);

  const onboardingToken = trimText(formData.get('onboardingToken'), 120);
  if (onboardingToken) {
    if (isRateLimited(`onboarding:${onboardingToken}:${getClientKey(request)}`, ONBOARDING_UPLOAD_LIMIT_MAX)) {
      return jsonError('Muitas tentativas. Tente novamente em alguns minutos.', 429);
    }
    const onboarding = await hrDbAdmin
      .collection('onboardingProcesses')
      .where('publicToken', '==', onboardingToken)
      .limit(1)
      .get();
    if (onboarding.empty) return jsonError('Onboarding não encontrado.', 404);
    const data = onboarding.docs[0].data();
    if (data.publicTokenClosedAt || data.status === 'cancelled' || data.status === 'completed') {
      return jsonError('Este onboarding não está aceitando documentos.', 403);
    }
    if (onboardingPublicLinkExpired(data)) {
      return jsonError('Este link expirou. Solicite ao RH a prorrogação do prazo.', 410);
    }
    const onboardingDocumentId = trimText(formData.get('onboardingDocumentId'), 120);
    if (onboardingDocumentId) {
      const documents = Array.isArray(data.documents) ? data.documents as Array<Record<string, unknown>> : [];
      const existing = documents.find(document => document.id === onboardingDocumentId);
      const existingStatus = typeof existing?.status === 'string' ? existing.status : null;
      if (existingStatus && existingStatus !== 'pending' && existingStatus !== 'rejected') {
        return jsonError('Documento já enviado. Ele só pode ser substituído se o RH reprovar.', 403);
      }
    }
    return null;
  }

  if (isRateLimited(getClientKey(request))) {
    return jsonError('Muitas tentativas. Tente novamente em alguns minutos.', 429);
  }

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
  if (!isInsideApplicationWindow(opening.docs[0].data(), new Date().toISOString())) {
    return jsonError('O período de inscrições desta vaga está encerrado.', 403);
  }
  return null;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

async function analyzeOnboardingUpload(params: {
  onboardingToken: string;
  onboardingDocumentId: string;
  file: File;
  contentHash: string;
}) {
  const onboardingQuery = await hrDbAdmin
    .collection('onboardingProcesses')
    .where('publicToken', '==', params.onboardingToken)
    .limit(1)
    .get();
  if (onboardingQuery.empty) return null;

  const processSnapshot = onboardingQuery.docs[0];
  const process = processSnapshot.data();
  if (process.employmentRelationshipType === 'pj' || params.onboardingDocumentId === 'profile_photo') {
    return null;
  }

  const documents = Array.isArray(process.documents) ? process.documents as OnboardingDocument[] : [];
  const document = documents.find(item => item.id === params.onboardingDocumentId);
  const expectedDocumentTypeCode = document?.documentTypeCode
    || inferredOnboardingDocumentTypeCode(params.onboardingDocumentId);
  if (!expectedDocumentTypeCode) return null;

  const configuration = employeeDocumentAiConfiguration();
  const cacheRef = processSnapshot.ref
    .collection('documentExtractions')
    .doc(onboardingDocumentExtractionCacheId(params.onboardingDocumentId, params.contentHash));
  const cachedSnapshot = await cacheRef.get();
  if (cachedSnapshot.exists) {
    const cached = cachedSnapshot.data() as OnboardingDocumentExtractionRecord;
    if (
      cached.aiAnalysis?.provider === 'openai'
      && cached.aiAnalysis.model === configuration.model
      && cached.aiAnalysis.promptVersion === configuration.promptVersion
      && cached.aiAnalysis.schemaVersion === configuration.schemaVersion
    ) {
      return cached;
    }
  }

  const startedAt = Date.now();
  const expectedEmployeeName = trimText(record(process.publicFormAnswers).fullName, 160)
    || trimText(process.candidateName, 160)
    || null;
  const result = await analyzeEmployeeDocumentWithAi({
    file: params.file,
    expectedEmployeeName,
  });
  const analyzedAt = new Date().toISOString();
  const extraction = buildOnboardingDocumentExtractionRecord({
    documentId: params.onboardingDocumentId,
    sourceFileHashSha256: params.contentHash,
    expectedDocumentTypeCode,
    result,
    analyzedAt,
    durationMs: Date.now() - startedAt,
  });
  await cacheRef.set(extraction);
  await processSnapshot.ref.collection('audit').add({
    action: 'DOCUMENT_AI_ANALYZED',
    documentId: params.onboardingDocumentId,
    sourceFileHashSha256: params.contentHash,
    provider: extraction.aiAnalysis.provider,
    model: extraction.aiAnalysis.model,
    reviewStatus: extraction.reviewStatus,
    inputTokens: extraction.aiAnalysis.inputTokens ?? null,
    outputTokens: extraction.aiAnalysis.outputTokens ?? null,
    estimatedCostUsd: extraction.aiAnalysis.estimatedCostUsd ?? null,
    promptVersion: extraction.aiAnalysis.promptVersion ?? null,
    schemaVersion: extraction.aiAnalysis.schemaVersion ?? null,
    at: analyzedAt,
  });
  return extraction;
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
  if (!ALLOWED_MIME.has(file.type)) return jsonError('Somente PDF, JPG e PNG são aceitos.');

  const token = randomUUID();
  const safeName = file.name.replace(/[^a-zA-Z0-9.\-_]/g, '_').slice(0, 80);
  const onboardingToken = trimText(formData.get('onboardingToken'), 120).replace(/[^a-zA-Z0-9_-]/g, '');
  const onboardingDocumentId = trimText(formData.get('onboardingDocumentId'), 120).replace(/[^a-zA-Z0-9_-]/g, '');
  if (onboardingDocumentId === 'profile_photo' && !new Set(['image/jpeg', 'image/png']).has(file.type)) {
    return jsonError('A foto para identificação deve ser enviada em JPG ou PNG.');
  }
  const scope = access ? 'internal' : 'public';
  const objectPath = onboardingToken
    ? `hr/onboarding/${onboardingToken}/${Date.now()}-${token}-${safeName}`
    : `hr/resumes/${scope}/${Date.now()}-${token}-${safeName}`;

  const bucket = getStorage(adminApp).bucket(firebaseClientConfig.storageBucket);
  const buffer = Buffer.from(await file.arrayBuffer());

  if (!hasExpectedFileSignature(buffer, file.type)) {
    return jsonError('O conteúdo do arquivo não corresponde a um PDF, JPG ou PNG válido.');
  }
  if (file.type === 'application/pdf' && looksEncryptedPdf(buffer)) {
    return jsonError('PDF protegido por senha não é aceito. Envie uma cópia sem proteção.');
  }

  const contentHash = createHash('sha256').update(buffer).digest('hex');
  await bucket.file(objectPath).save(buffer, {
    metadata: {
      contentType: file.type,
      metadata: {
        firebaseStorageDownloadTokens: token,
        originalName: file.name.slice(0, 180),
        ...(onboardingDocumentId ? { onboardingDocumentId } : {}),
      },
    },
  });

  const extraction = onboardingToken && onboardingDocumentId
    ? await analyzeOnboardingUpload({
        onboardingToken,
        onboardingDocumentId,
        file: new File([buffer], file.name, { type: file.type }),
        contentHash,
      })
    : null;

  const url = `https://firebasestorage.googleapis.com/v0/b/${firebaseClientConfig.storageBucket}/o/${encodeURIComponent(objectPath)}?alt=media&token=${token}`;
  return NextResponse.json({
    url,
    path: objectPath,
    sha256: contentHash,
    analysisStatus: extraction?.aiAnalysis.status ?? 'not_applicable',
  }, { status: 201 });
}
