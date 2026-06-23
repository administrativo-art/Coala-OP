import { NextRequest, NextResponse } from 'next/server';

import { serializeHrValue } from '@/features/hr/lib/server-access';
import { hrDbAdmin } from '@/lib/firebase-rh-admin';
import type { OnboardingDocument } from '@/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SUBMIT_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const SUBMIT_LIMIT_MAX = 8;
const rateBuckets = new Map<string, { count: number; resetAt: number }>();

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

function trimText(value: unknown, maxLength: number) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function getClientKey(request: NextRequest, token: string) {
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return `${token}:${forwarded || request.headers.get('x-real-ip') || 'unknown'}`;
}

function isRateLimited(key: string) {
  const now = Date.now();
  for (const [bucketKey, bucket] of rateBuckets.entries()) {
    if (now > bucket.resetAt) rateBuckets.delete(bucketKey);
  }

  const current = rateBuckets.get(key);
  if (!current || now > current.resetAt) {
    rateBuckets.set(key, { count: 1, resetAt: now + SUBMIT_LIMIT_WINDOW_MS });
    return false;
  }
  current.count += 1;
  return current.count > SUBMIT_LIMIT_MAX;
}

function isAllowedStorageUrl(value: unknown) {
  return typeof value === 'string' &&
    value.startsWith('https://firebasestorage.googleapis.com/') &&
    value.length <= 1200;
}

async function getOnboardingByToken(token: string) {
  const snap = await hrDbAdmin
    .collection('onboardingProcesses')
    .where('publicToken', '==', token)
    .limit(1)
    .get();
  if (snap.empty) return null;
  return snap.docs[0];
}

function publicPayload(id: string, data: FirebaseFirestore.DocumentData) {
  const documents = Array.isArray(data.documents) ? data.documents as OnboardingDocument[] : [];
  return {
    id,
    candidateName: data.candidateName ?? null,
    candidateEmail: data.candidateEmail ?? null,
    jobRoleName: data.jobRoleName ?? null,
    functionName: data.functionName ?? null,
    unitName: data.unitName ?? null,
    status: data.status ?? null,
    currentStage: data.currentStage ?? null,
    documents: documents.map(document => ({
      id: document.id,
      label: document.label,
      required: document.required !== false,
      status: document.status ?? 'pending',
      fileUrl: document.fileUrl ?? null,
      updatedAt: document.updatedAt ?? null,
    })),
    publicFormAnswers: data.publicFormAnswers ?? {},
    publicFormSubmittedAt: data.publicFormSubmittedAt ?? null,
  };
}

export async function GET(_request: NextRequest, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;
  const cleanToken = trimText(token, 120);
  if (!cleanToken) return jsonError('Token ausente.', 400);

  const doc = await getOnboardingByToken(cleanToken);
  if (!doc) return jsonError('Onboarding não encontrado.', 404);

  const data = doc.data();
  return NextResponse.json(publicPayload(doc.id, serializeHrValue(data) as FirebaseFirestore.DocumentData));
}

export async function POST(request: NextRequest, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;
  const cleanToken = trimText(token, 120);
  if (!cleanToken) return jsonError('Token ausente.', 400);
  if (isRateLimited(getClientKey(request, cleanToken))) {
    return jsonError('Muitas tentativas. Tente novamente em alguns minutos.', 429);
  }

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') return jsonError('Payload inválido.');
  if (trimText((body as Record<string, unknown>).website, 200)) return jsonError('Envio não aceito.', 400);

  const doc = await getOnboardingByToken(cleanToken);
  if (!doc) return jsonError('Onboarding não encontrado.', 404);
  const data = doc.data();
  if (data.status === 'cancelled' || data.status === 'completed') {
    return jsonError('Este onboarding não está aceitando documentos.', 403);
  }

  const now = new Date().toISOString();
  const input = body as Record<string, unknown>;
  const rawAnswers = input.answers && typeof input.answers === 'object' && !Array.isArray(input.answers)
    ? input.answers as Record<string, unknown>
    : {};
  const rawDocuments = input.documents && typeof input.documents === 'object' && !Array.isArray(input.documents)
    ? input.documents as Record<string, unknown>
    : {};

  if (JSON.stringify(rawAnswers).length > 12_000 || JSON.stringify(rawDocuments).length > 20_000) {
    return jsonError('Informações acima do limite permitido.');
  }

  const publicFormAnswers = {
    phone: trimText(rawAnswers.phone, 40),
    birthDate: trimText(rawAnswers.birthDate, 40),
    address: trimText(rawAnswers.address, 500),
    bankInfo: trimText(rawAnswers.bankInfo, 500),
    notes: trimText(rawAnswers.notes, 1000),
  };

  const documents = Array.isArray(data.documents) ? data.documents as OnboardingDocument[] : [];
  const nextDocuments = documents.map((document) => {
    const submitted = rawDocuments[document.id];
    if (!submitted || typeof submitted !== 'object' || Array.isArray(submitted)) return document;
    const submittedData = submitted as Record<string, unknown>;
    const fileUrl = isAllowedStorageUrl(submittedData.fileUrl) ? submittedData.fileUrl : null;
    if (!fileUrl) return document;
    return {
      ...document,
      status: 'received' as const,
      fileUrl,
      filePath: trimText(submittedData.filePath, 700) || (document.filePath ?? null),
      note: trimText(submittedData.note, 500) || (document.note ?? null),
      receivedAt: document.receivedAt ?? now,
      updatedAt: now,
    };
  });

  await doc.ref.set({
    documents: nextDocuments,
    publicFormAnswers,
    publicFormSubmittedAt: now,
    currentStage: data.currentStage === 'documents' || !data.currentStage ? 'document_review' : data.currentStage,
    status: data.status === 'collecting_documents' || data.status === 'pending_setup' ? 'reviewing_documents' : data.status,
    updatedAt: now,
  }, { merge: true });

  const saved = await doc.ref.get();
  return NextResponse.json(publicPayload(saved.id, serializeHrValue(saved.data()) as FirebaseFirestore.DocumentData));
}
