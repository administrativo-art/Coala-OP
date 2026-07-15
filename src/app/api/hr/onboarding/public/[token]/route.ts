import { NextRequest, NextResponse } from 'next/server';

import { serializeHrValue } from '@/features/hr/lib/server-access';
import { hrDbAdmin } from '@/lib/firebase-rh-admin';
import { DEFAULT_ONBOARDING_DOCUMENTS, instantiateOnboardingDocuments } from '@/lib/recruitment-onboarding';
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

function cleanChoice(value: unknown, allowed: readonly string[]) {
  const cleaned = trimText(value, 40);
  return allowed.includes(cleaned) ? cleaned : '';
}

function cleanIsoDate(value: unknown) {
  const cleaned = trimText(value, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(cleaned) ? cleaned : '';
}

function dependentAge(birthDate: string) {
  if (!birthDate) return null;
  const date = new Date(`${birthDate}T12:00:00.000Z`);
  if (!Number.isFinite(date.getTime())) return null;
  const today = new Date();
  let age = today.getUTCFullYear() - date.getUTCFullYear();
  const monthDelta = today.getUTCMonth() - date.getUTCMonth();
  if (monthDelta < 0 || (monthDelta === 0 && today.getUTCDate() < date.getUTCDate())) age -= 1;
  return age;
}

function familyRequiredDocs(birthDate: string) {
  const age = dependentAge(birthDate);
  if (age == null) return ['birth_certificate'] as const;
  if (age < 0 || age >= 14) return [] as const;
  if (age < 4) return ['birth_certificate', 'vaccination'] as const;
  if (age < 7) return ['birth_certificate', 'vaccination', 'school_attendance'] as const;
  return ['birth_certificate', 'school_attendance'] as const;
}

function familyDocumentLabel(kind: string, index: number) {
  const suffix = `Filho ${index + 1}`;
  if (kind === 'birth_certificate') return `Certidão de nascimento - ${suffix}`;
  if (kind === 'vaccination') return `Caderneta de vacinação - ${suffix}`;
  if (kind === 'school_attendance') return `Comprovante de frequência escolar - ${suffix}`;
  return `Documento do filho - ${suffix}`;
}

function sanitizeChildren(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, 12)
    .map((entry) => {
      const data = entry && typeof entry === 'object' && !Array.isArray(entry)
        ? entry as Record<string, unknown>
        : {};
      return { birthDate: cleanIsoDate(data.birthDate) };
    });
}

function sanitizePublicAnswers(rawAnswers: Record<string, unknown>) {
  const children = sanitizeChildren(rawAnswers.children);
  const requestedCount = Number(rawAnswers.childrenCount);
  const childrenCount = Number.isFinite(requestedCount)
    ? Math.max(0, Math.min(12, Math.trunc(requestedCount)))
    : children.length;

  return {
    identityDocumentType: cleanChoice(rawAnswers.identityDocumentType, ['identity', 'cnh']),
    bankName: trimText(rawAnswers.bankName, 80),
    bankAgency: trimText(rawAnswers.bankAgency, 40),
    bankAccount: trimText(rawAnswers.bankAccount, 60),
    pixKey: trimText(rawAnswers.pixKey, 120),
    uniformShirtSize: trimText(rawAnswers.uniformShirtSize, 20),
    uniformPantsSize: trimText(rawAnswers.uniformPantsSize, 20),
    uniformShoeSize: trimText(rawAnswers.uniformShoeSize, 20),
    hasCnh: cleanChoice(rawAnswers.hasCnh, ['yes', 'no']),
    wantsTransportVoucher: cleanChoice(rawAnswers.wantsTransportVoucher, ['yes', 'no']),
    childrenCount,
    children: Array.from({ length: childrenCount }, (_, index) => children[index] ?? { birthDate: '' }),
    notes: trimText(rawAnswers.notes, 1000),
  };
}

function buildChildDocumentTemplates(answers: ReturnType<typeof sanitizePublicAnswers>): OnboardingDocument[] {
  return answers.children.flatMap((child, index) =>
    familyRequiredDocs(child.birthDate).map((kind, order) => ({
      id: `child_${index + 1}_${kind}`,
      label: familyDocumentLabel(kind, index),
      documentTypeCode: kind === 'birth_certificate'
        ? 'DEPENDENT_DOCUMENT'
        : kind === 'vaccination'
          ? 'VACCINATION_RECORD'
          : 'SCHOOL_ATTENDANCE',
      description: 'Obrigatório conforme a idade informada para salário-família.',
      required: true,
      order: 100 + index * 10 + order,
      status: 'pending' as const,
      fileUrl: null,
      filePath: null,
      receivedAt: null,
      approvedAt: null,
      updatedAt: null,
      note: null,
    }))
  );
}

function mergeExpectedDocuments(existing: OnboardingDocument[], dynamicDocuments: OnboardingDocument[]) {
  const byId = new Map(existing.map(document => [document.id, document]));
  for (const document of dynamicDocuments) {
    const current = byId.get(document.id);
    byId.set(document.id, {
      ...document,
      ...current,
      label: current?.label ?? document.label,
      description: current?.description ?? document.description,
    });
  }
  return Array.from(byId.values()).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

function withUniversalDocuments(documents: OnboardingDocument[]) {
  return mergeExpectedDocuments(
    documents,
    instantiateOnboardingDocuments(DEFAULT_ONBOARDING_DOCUMENTS, documents)
  ).map((document) =>
    document.id === 'profile_photo'
      ? { ...document, documentTypeCode: 'PROFILE_PHOTO', required: true }
      : document
  );
}

function canCandidateUploadDocument(document: OnboardingDocument) {
  return document.status === 'pending' || document.status === 'rejected';
}

function requiredDocumentsSubmitted(documents: OnboardingDocument[]) {
  return documents.every((document) => {
    if (document.required === false) return true;
    return !canCandidateUploadDocument(document);
  });
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

function isAllowedStorageUrl(value: unknown): value is string {
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
  const documents = withUniversalDocuments(
    Array.isArray(data.documents) ? data.documents as OnboardingDocument[] : []
  );
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
      description: document.description ?? null,
      required: document.required !== false,
      order: document.order ?? 0,
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
  if (data.publicTokenClosedAt || data.status === 'cancelled' || data.status === 'completed') {
    return jsonError('Este link de onboarding não está mais disponível.', 404);
  }
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
  if (data.publicTokenClosedAt || data.status === 'cancelled' || data.status === 'completed') {
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

  const publicFormAnswers = sanitizePublicAnswers(rawAnswers);

  const documents = withUniversalDocuments(
    Array.isArray(data.documents) ? data.documents as OnboardingDocument[] : []
  );
  const expectedDocuments = mergeExpectedDocuments(documents, buildChildDocumentTemplates(publicFormAnswers));
  const blockedSubmittedDocument = Object.keys(rawDocuments).find((documentId) => {
    const current = expectedDocuments.find(document => document.id === documentId);
    return current ? !canCandidateUploadDocument(current) : false;
  });
  if (blockedSubmittedDocument) {
    return jsonError('Documento já enviado. Ele só pode ser substituído se o RH reprovar.', 403);
  }

  const nextDocuments = expectedDocuments.map((document) => {
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
      receivedAt: now,
      approvedAt: null,
      updatedAt: now,
    };
  });
  const allRequiredDocumentsSubmitted = requiredDocumentsSubmitted(nextDocuments);

  await doc.ref.set({
    documents: nextDocuments,
    publicFormAnswers,
    publicFormSubmittedAt: now,
    publicFormLastSubmittedAt: now,
    currentStage: allRequiredDocumentsSubmitted && (data.currentStage === 'documents' || !data.currentStage)
      ? 'document_review'
      : data.currentStage ?? 'documents',
    status: allRequiredDocumentsSubmitted && (data.status === 'collecting_documents' || data.status === 'pending_setup')
      ? 'reviewing_documents'
      : data.status === 'pending_setup'
        ? 'collecting_documents'
        : data.status,
    updatedAt: now,
  }, { merge: true });

  const saved = await doc.ref.get();
  return NextResponse.json(publicPayload(saved.id, serializeHrValue(saved.data()) as FirebaseFirestore.DocumentData));
}
