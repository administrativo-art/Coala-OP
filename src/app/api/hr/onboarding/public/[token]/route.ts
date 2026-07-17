import { NextRequest, NextResponse } from 'next/server';
import { createHash, randomBytes } from 'crypto';

import { serializeHrValue } from '@/features/hr/lib/server-access';
import { hrDbAdmin } from '@/lib/firebase-rh-admin';
import { DEFAULT_ONBOARDING_DOCUMENTS, instantiateOnboardingDocuments } from '@/lib/recruitment-onboarding';
import { onboardingPublicLinkExpired, onboardingPublicLinkExpiresAt } from '@/lib/hr/onboarding-public-link';
import {
  ONBOARDING_ALLERGY_ACKNOWLEDGEMENT_TEXT,
  ONBOARDING_ALLERGY_CONFIRMATION_NOTE,
  ONBOARDING_ALLERGY_NOTICE_CONTEXT,
  ONBOARDING_ALLERGY_NOTICE_SNAPSHOT_ID,
  ONBOARDING_ALLERGY_NOTICE_TITLE,
  ONBOARDING_ALLERGY_NOTICE_VERSION,
  ONBOARDING_PRIVACY_ACKNOWLEDGEMENT_TEXT,
  ONBOARDING_PRIVACY_CONFIRMATION_NOTE,
  ONBOARDING_PRIVACY_NOTICE_EFFECTIVE_AT,
  ONBOARDING_PRIVACY_NOTICE_SNAPSHOT_ID,
  ONBOARDING_PRIVACY_NOTICE_SUMMARY,
  ONBOARDING_PRIVACY_NOTICE_TEXT,
  ONBOARDING_PRIVACY_NOTICE_TITLE,
  ONBOARDING_PRIVACY_NOTICE_VERSION,
} from '@/lib/hr/onboarding-privacy';
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

function cleanChoices(value: unknown, allowed: readonly string[]) {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.map(item => trimText(item, 60)).filter(item => allowed.includes(item))));
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
  if (age == null) return [] as const;
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
      return {
        birthDate: cleanIsoDate(data.birthDate),
        name: trimText(data.name, 120),
        cpf: trimText(data.cpf, 14).replace(/[^\d.-]/g, ''),
      };
    });
}

function sanitizePublicAnswers(rawAnswers: Record<string, unknown>) {
  const children = sanitizeChildren(rawAnswers.children);
  const hasChildren = cleanChoice(rawAnswers.hasChildren, ['yes', 'no']);
  const requestedCount = Number(rawAnswers.childrenCount);
  const requestedChildrenCount = Number.isFinite(requestedCount)
    ? Math.max(0, Math.min(12, Math.trunc(requestedCount)))
    : children.length;
  const childrenCount = hasChildren === 'no' ? 0 : requestedChildrenCount;

  return {
    fullName: trimText(rawAnswers.fullName, 120),
    cpf: trimText(rawAnswers.cpf, 14).replace(/\D/g, '').slice(0, 11),
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
    hasFoodRestriction: cleanChoice(rawAnswers.hasFoodRestriction, ['yes', 'no']),
    foodRestrictions: cleanChoices(rawAnswers.foodRestrictions, ['Leite e derivados', 'Trigo ou glúten', 'Ovos', 'Soja', 'Amendoim', 'Castanhas ou outras oleaginosas', 'Corantes ou aromatizantes', 'Outro ingrediente']),
    foodRestrictionOther: trimText(rawAnswers.foodRestrictionOther, 160),
    foodRestrictionActivityEffects: cleanChoices(rawAnswers.foodRestrictionActivityEffects, ['Apenas a ingestão ou degustação', 'O contato ou a manipulação', 'Ambos', 'Preciso de avaliação pelo serviço de saúde ocupacional']),
    hasChildren,
    childrenCount,
    children: Array.from({ length: childrenCount }, (_, index) => children[index] ?? { birthDate: '', name: '', cpf: '' }),
    emergencyName: trimText(rawAnswers.emergencyName, 120),
    emergencyPhone: trimText(rawAnswers.emergencyPhone, 15).replace(/[^\d()+\-\s]/g, ''),
    emergencyRelation: cleanChoice(rawAnswers.emergencyRelation, ['Mãe/Pai', 'Cônjuge', 'Filho(a)', 'Irmão/Irmã', 'Parente', 'Amigo(a)', 'Outro']),
    educationLevel: cleanChoice(rawAnswers.educationLevel, ['Fundamental incompleto', 'Fundamental completo', 'Médio incompleto', 'Médio completo', 'Superior incompleto', 'Superior completo']),
    educationCourse: ['Superior incompleto', 'Superior completo'].includes(trimText(rawAnswers.educationLevel, 40))
      ? trimText(rawAnswers.educationCourse, 120)
      : '',
    educationInstitution: trimText(rawAnswers.educationInstitution, 160),
    educationEndDate: cleanIsoDate(rawAnswers.educationEndDate),
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

function sha256(value: string) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function privacyNoticeHash() {
  return sha256([
    ONBOARDING_PRIVACY_NOTICE_VERSION,
    ONBOARDING_PRIVACY_NOTICE_TITLE,
    ONBOARDING_PRIVACY_NOTICE_SUMMARY,
    ONBOARDING_PRIVACY_NOTICE_TEXT,
    ONBOARDING_PRIVACY_ACKNOWLEDGEMENT_TEXT,
    ONBOARDING_PRIVACY_CONFIRMATION_NOTE,
  ].join('\n'));
}

function allergyNoticeHash() {
  return sha256([
    ONBOARDING_ALLERGY_NOTICE_VERSION,
    ONBOARDING_ALLERGY_NOTICE_TITLE,
    ONBOARDING_ALLERGY_NOTICE_CONTEXT,
    ONBOARDING_ALLERGY_ACKNOWLEDGEMENT_TEXT,
    ONBOARDING_ALLERGY_CONFIRMATION_NOTE,
  ].join('\n'));
}

function publicPrivacyNotice() {
  return {
    version: ONBOARDING_PRIVACY_NOTICE_VERSION,
    hash: privacyNoticeHash(),
    title: ONBOARDING_PRIVACY_NOTICE_TITLE,
    summary: ONBOARDING_PRIVACY_NOTICE_SUMMARY,
    text: ONBOARDING_PRIVACY_NOTICE_TEXT,
    acknowledgementText: ONBOARDING_PRIVACY_ACKNOWLEDGEMENT_TEXT,
    confirmationNote: ONBOARDING_PRIVACY_CONFIRMATION_NOTE,
    allergyNoticeVersion: ONBOARDING_ALLERGY_NOTICE_VERSION,
    allergyNoticeHash: allergyNoticeHash(),
    allergyNoticeTitle: ONBOARDING_ALLERGY_NOTICE_TITLE,
    allergyNoticeContext: ONBOARDING_ALLERGY_NOTICE_CONTEXT,
    allergyAcknowledgementText: ONBOARDING_ALLERGY_ACKNOWLEDGEMENT_TEXT,
    allergyConfirmationNote: ONBOARDING_ALLERGY_CONFIRMATION_NOTE,
  };
}

async function ensurePrivacyNoticeSnapshot(notice: ReturnType<typeof publicPrivacyNotice>, now: string) {
  const ref = hrDbAdmin.collection('privacy_notice_versions').doc(ONBOARDING_PRIVACY_NOTICE_SNAPSHOT_ID);
  await hrDbAdmin.runTransaction(async transaction => {
    const snapshot = await transaction.get(ref);
    if (snapshot.exists) {
      if (snapshot.data()?.hash_sha256 !== notice.hash) {
        throw new Error('A versão publicada do Aviso de Privacidade não pode ser alterada. Publique uma nova versão.');
      }
      return;
    }
    transaction.create(ref, {
      version: notice.version,
      title: notice.title,
      full_text: notice.text,
      canonical_text: notice.text,
      hash_sha256: notice.hash,
      published_at: now,
      effective_at: ONBOARDING_PRIVACY_NOTICE_EFFECTIVE_AT,
      is_active: true,
      created_by: 'system',
    });
  });
  return ref.id;
}

async function ensureAllergyNoticeSnapshot(notice: ReturnType<typeof publicPrivacyNotice>, now: string) {
  const ref = hrDbAdmin.collection('privacy_notice_versions').doc(ONBOARDING_ALLERGY_NOTICE_SNAPSHOT_ID);
  const fullText = [
    notice.allergyNoticeTitle,
    notice.allergyNoticeContext,
    notice.allergyAcknowledgementText,
    notice.allergyConfirmationNote,
  ].join('\n\n');
  await hrDbAdmin.runTransaction(async transaction => {
    const snapshot = await transaction.get(ref);
    if (snapshot.exists) {
      if (snapshot.data()?.hash_sha256 !== notice.allergyNoticeHash) {
        throw new Error('A versão publicada do aviso de alergias não pode ser alterada. Publique uma nova versão.');
      }
      return;
    }
    transaction.create(ref, {
      version: notice.allergyNoticeVersion,
      title: notice.allergyNoticeTitle,
      full_text: fullText,
      canonical_text: fullText,
      hash_sha256: notice.allergyNoticeHash,
      published_at: now,
      effective_at: ONBOARDING_PRIVACY_NOTICE_EFFECTIVE_AT,
      is_active: true,
      created_by: 'system',
    });
  });
  return ref.id;
}

function clientEvidence(request: NextRequest) {
  return {
    clientIp: request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
      || request.headers.get('x-real-ip')
      || null,
    userAgent: trimText(request.headers.get('user-agent'), 500) || null,
  };
}

function createSubmissionProtocol(now: Date) {
  const date = now.toISOString().slice(0, 10).replace(/-/g, '');
  return `ONB-${date}-${randomBytes(4).toString('hex').toUpperCase()}`;
}

function hasAllergenInformation(answers: ReturnType<typeof sanitizePublicAnswers>) {
  return Boolean(
    answers.hasFoodRestriction === 'yes' ||
    answers.foodRestrictions.length ||
    answers.foodRestrictionOther ||
    answers.foodRestrictionActivityEffects.length
  );
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
    publicTokenExpiresAt: onboardingPublicLinkExpiresAt(data)?.toISOString() ?? null,
    publicTokenExtensionUsed: data.publicTokenExtensionUsed === true,
    privacyNotice: publicPrivacyNotice(),
    publicPrivacyAcceptance: data.publicPrivacyAcceptance ?? null,
  };
}

export async function GET(request: NextRequest, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;
  const cleanToken = trimText(token, 120);
  if (!cleanToken) return jsonError('Token ausente.', 400);

  const doc = await getOnboardingByToken(cleanToken);
  if (!doc) return jsonError('Onboarding não encontrado.', 404);

  const data = doc.data();
  if (data.publicTokenClosedAt || data.status === 'cancelled' || data.status === 'completed') {
    return jsonError('Este link de onboarding não está mais disponível.', 404);
  }
  if (onboardingPublicLinkExpired(data)) {
    return jsonError('Este link expirou. Solicite ao RH a prorrogação do prazo.', 410);
  }
  const accessedAt = new Date().toISOString();
  await doc.ref.collection('audit').add({
    action: 'PUBLIC_LINK_ACCESSED',
    candidateId: data.candidateId ?? null,
    tokenHash: sha256(cleanToken),
    ...clientEvidence(request),
    at: accessedAt,
  }).catch(error => console.error('[onboarding] Falha ao auditar acesso público.', error));
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
  if (onboardingPublicLinkExpired(data)) {
    return jsonError('Este link expirou. Solicite ao RH a prorrogação do prazo.', 410);
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

  let publicFormAnswers = sanitizePublicAnswers(rawAnswers);
  if (publicFormAnswers.hasFoodRestriction !== 'yes') {
    publicFormAnswers = {
      ...publicFormAnswers,
      foodRestrictions: [],
      foodRestrictionOther: '',
      foodRestrictionActivityEffects: [],
    };
  } else if (!publicFormAnswers.foodRestrictions.includes('Outro ingrediente')) {
    publicFormAnswers = { ...publicFormAnswers, foodRestrictionOther: '' };
  }
  if (!publicFormAnswers.fullName) return jsonError('Informe o nome completo.');
  if (publicFormAnswers.cpf.length !== 11) return jsonError('Informe um CPF com 11 dígitos.');
  if (!publicFormAnswers.hasChildren) return jsonError('Informe se possui filhos.');
  if (publicFormAnswers.hasChildren === 'yes' && publicFormAnswers.childrenCount < 1) {
    return jsonError('Informe a quantidade de filhos.');
  }
  if (!publicFormAnswers.emergencyName) return jsonError('Informe o nome do contato de emergência.');
  if (publicFormAnswers.emergencyPhone.replace(/\D/g, '').length < 10) return jsonError('Informe o celular do contato de emergência com DDD.');
  if (!publicFormAnswers.emergencyRelation) return jsonError('Informe o grau de parentesco do contato de emergência.');
  if (['Superior incompleto', 'Superior completo'].includes(publicFormAnswers.educationLevel) && !publicFormAnswers.educationCourse) {
    return jsonError('Informe o curso da formação superior.');
  }
  const notice = publicPrivacyNotice();
  const acceptanceInput = input.privacyAcceptance && typeof input.privacyAcceptance === 'object' && !Array.isArray(input.privacyAcceptance)
    ? input.privacyAcceptance as Record<string, unknown>
    : {};
  const noticeMatches = trimText(acceptanceInput.noticeVersion, 80) === notice.version
    && trimText(acceptanceInput.noticeHash, 128) === notice.hash;
  const acknowledged = acceptanceInput.acknowledged === true;
  const allergenInformationProvided = hasAllergenInformation(publicFormAnswers);
  const allergyAcknowledged = acceptanceInput.allergyAcknowledged === true;
  const allergyNoticeMatches = trimText(acceptanceInput.allergyNoticeVersion, 80) === notice.allergyNoticeVersion
    && trimText(acceptanceInput.allergyNoticeHash, 128) === notice.allergyNoticeHash;
  if (!noticeMatches || !acknowledged) {
    return jsonError('Leia e confirme o Aviso de Privacidade para enviar o onboarding.');
  }
  if (!allergyNoticeMatches || !allergyAcknowledged) {
    return jsonError('Confirme a ciência sobre o tratamento de informações de alergias e restrições alimentares.');
  }

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
      fileHashSha256: /^[a-f0-9]{64}$/i.test(trimText(submittedData.sha256, 64))
        ? trimText(submittedData.sha256, 64).toLowerCase()
        : (document as OnboardingDocument & { fileHashSha256?: string | null }).fileHashSha256 ?? null,
      note: trimText(submittedData.note, 500) || (document.note ?? null),
      receivedAt: now,
      approvedAt: null,
      updatedAt: now,
    };
  });
  const allRequiredDocumentsSubmitted = requiredDocumentsSubmitted(nextDocuments);
  const submittedAt = new Date(now);
  const protocol = createSubmissionProtocol(submittedAt);
  const sessionId = trimText(input.sessionId, 120) || randomBytes(12).toString('hex');
  let privacyNoticeSnapshotId: string;
  let allergyNoticeSnapshotId: string;
  try {
    privacyNoticeSnapshotId = await ensurePrivacyNoticeSnapshot(notice, now);
    allergyNoticeSnapshotId = await ensureAllergyNoticeSnapshot(notice, now);
  } catch (error) {
    console.error('[onboarding] Falha ao preservar o Aviso de Privacidade.', error);
    return jsonError('Não foi possível validar a versão do Aviso de Privacidade.', 500);
  }
  const previousAcceptance = data.publicPrivacyAcceptance && typeof data.publicPrivacyAcceptance === 'object'
    ? data.publicPrivacyAcceptance as Record<string, unknown>
    : {};
  const firstAcceptedAt = previousAcceptance.noticeVersion === notice.version
    && previousAcceptance.noticeHash === notice.hash
    && typeof previousAcceptance.firstAcceptedAt === 'string'
      ? previousAcceptance.firstAcceptedAt
      : now;
  const publicPrivacyAcceptance = {
    noticeVersion: notice.version,
    noticeHash: notice.hash,
    noticeTitle: notice.title,
    noticeSummary: notice.summary,
    noticeText: notice.text,
    acknowledgementText: notice.acknowledgementText,
    confirmationNote: notice.confirmationNote,
    acknowledged: true,
    firstAcceptedAt,
    lastConfirmedAt: now,
    privacyNoticeSnapshotId,
    allergyNoticeVersion: notice.allergyNoticeVersion,
    allergyNoticeHash: notice.allergyNoticeHash,
    allergyNoticeSnapshotId,
    allergyNoticeTitle: notice.allergyNoticeTitle,
    allergyNoticeContext: notice.allergyNoticeContext,
    allergyAcknowledgementText: notice.allergyAcknowledgementText,
    allergyConfirmationNote: notice.allergyConfirmationNote,
    allergyAcknowledged: true,
    allergyAcknowledgedAt: now,
    lastProtocol: protocol,
  };

  await doc.ref.set({
    documents: nextDocuments,
    candidateName: publicFormAnswers.fullName,
    publicFormAnswers,
    publicFormSubmittedAt: now,
    publicFormLastSubmittedAt: now,
    publicPrivacyAcceptance,
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

  await doc.ref.collection('audit').add({
    action: 'PUBLIC_FORM_SUBMITTED',
    candidateId: data.candidateId ?? null,
    candidateEmail: data.candidateEmail ?? null,
    protocol,
    tokenHash: sha256(cleanToken),
    noticeVersion: notice.version,
    noticeHash: notice.hash,
    noticeTitle: notice.title,
    noticeSummary: notice.summary,
    noticeText: notice.text,
    acknowledgementText: notice.acknowledgementText,
    confirmationNote: notice.confirmationNote,
    acknowledged: true,
    allergenInformationProvided,
    allergyNoticeVersion: notice.allergyNoticeVersion,
    allergyNoticeTitle: notice.allergyNoticeTitle,
    allergyNoticeContext: notice.allergyNoticeContext,
    allergyAcknowledgementText: notice.allergyAcknowledgementText,
    allergyConfirmationNote: notice.allergyConfirmationNote,
    allergyAcknowledged: true,
    submittedDocumentIds: Object.keys(rawDocuments),
    formalization_id: doc.id,
    candidate_id: data.candidateId ?? null,
    invitation_id: data.invitationId ?? null,
    privacy_notice_version: notice.version,
    privacy_notice_snapshot_id: privacyNoticeSnapshotId,
    privacy_notice_hash_sha256: notice.hash,
    privacy_acknowledgement_text: notice.acknowledgementText,
    privacy_acknowledged: true,
    privacy_acknowledged_at: now,
    allergy_notice_version: notice.allergyNoticeVersion,
    allergy_notice_snapshot_id: allergyNoticeSnapshotId,
    allergy_notice_hash_sha256: notice.allergyNoticeHash,
    allergy_acknowledgement_text: notice.allergyAcknowledgementText,
    allergy_acknowledged: true,
    allergy_acknowledged_at: now,
    delivery_channel: data.publicLinkDeliveryChannel ?? null,
    delivery_destination_masked: data.publicLinkDeliveryDestinationMasked ?? null,
    invitation_sent_at: data.publicLinkSentAt ?? null,
    invitation_expires_at: onboardingPublicLinkExpiresAt(data)?.toISOString() ?? null,
    otp_verified: false,
    otp_verified_at: null,
    session_id: sessionId,
    ip_address: clientEvidence(request).clientIp,
    user_agent: clientEvidence(request).userAgent,
    document_ids: Object.keys(rawDocuments),
    document_hashes_sha256: Object.fromEntries(Object.entries(rawDocuments).flatMap(([id, value]) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
      const hash = trimText((value as Record<string, unknown>).sha256, 64);
      return /^[a-f0-9]{64}$/i.test(hash) ? [[id, hash]] : [];
    })),
    submission_protocol: protocol,
    submitted_at: now,
    ...clientEvidence(request),
    at: now,
  });

  const saved = await doc.ref.get();
  return NextResponse.json(publicPayload(saved.id, serializeHrValue(saved.data()) as FirebaseFirestore.DocumentData));
}
