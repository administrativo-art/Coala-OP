import { NextRequest, NextResponse } from 'next/server';
import { createHash, randomBytes } from 'crypto';

import { serializeHrValue } from '@/features/hr/lib/server-access';
import {
  applicableOnboardingDocuments,
  presentOnboardingDocumentForAnswers,
  requiredFamilyDocumentKinds,
} from '@/features/hr/onboarding/document-applicability';
import { hrDbAdmin } from '@/lib/firebase-rh-admin';
import { DEFAULT_ONBOARDING_DOCUMENTS, instantiateOnboardingDocuments } from '@/lib/recruitment-onboarding';
import {
  closeOnboardingPublicLink,
  onboardingPublicLinkClosedMessage,
  onboardingPublicLinkExpired,
  onboardingPublicLinkExpiresAt,
} from '@/lib/hr/onboarding-public-link';
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
import {
  IMAGE_VOICE_CONSENT_EFFECTIVE_AT,
  IMAGE_VOICE_CONSENT_SNAPSHOT_ID,
  parseImageVoiceConsentDecision,
  publicImageVoiceConsentTerm,
} from '@/lib/hr/image-voice-consent';
import type { OnboardingDocument } from '@/types';
import type { PjOnboardingWorkflow } from '@/types';
import { pjRequiredRegistrationFieldsMissing, setPjWorkflowStep } from '@/features/hr/onboarding-pj/core';
import {
  changedIdentityFields,
  nextPublicFormRevision,
  publicFormAnswersEqual,
} from '@/features/hr/onboarding/public-form-revision';
import { resolveSubmittedImageVoiceAuthorization } from '@/features/hr/onboarding/image-voice-consent-state';
import { ONBOARDING_MARITAL_STATUSES } from '@/features/hr/onboarding/marital-status';
import {
  mergeOnboardingDocumentExtraction,
  onboardingDocumentExtractionCacheId,
  type OnboardingDocumentExtractionRecord,
} from '@/features/hr/onboarding/document-ai-extraction';
import { reportSystemError } from '@/lib/observability';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SUBMIT_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const SUBMIT_LIMIT_MAX = 8;
const rateBuckets = new Map<string, { count: number; resetAt: number }>();

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, {
    status,
    headers: { 'Cache-Control': 'private, no-store, max-age=0, must-revalidate' },
  });
}

function jsonSuccess(payload: unknown) {
  return NextResponse.json(payload, {
    headers: { 'Cache-Control': 'private, no-store, max-age=0, must-revalidate' },
  });
}

function trimText(value: unknown, maxLength: number) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
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
    maritalStatus: cleanChoice(rawAnswers.maritalStatus, ONBOARDING_MARITAL_STATUSES),
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

function sanitizePjPublicAnswers(raw: Record<string, unknown>) {
  const bankMethod = cleanChoice(raw.bankMethod, ['pix', 'bank']);
  const authoritySource = cleanChoice(raw.authoritySource, ['social_contract', 'power_of_attorney']);
  return {
    companyAddress: trimText(raw.companyAddress, 500),
    companyPhone: trimText(raw.companyPhone, 30),
    municipalRegistration: trimText(raw.municipalRegistration, 80),
    stateRegistration: trimText(raw.stateRegistration, 80),
    representativeName: trimText(raw.representativeName, 160),
    representativeCpf: trimText(raw.representativeCpf, 20).replace(/\D/g, '').slice(0, 11),
    representativeQualification: trimText(raw.representativeQualification, 240),
    authoritySource,
    bankMethod,
    bankHolderName: trimText(raw.bankHolderName, 160),
    bankHolderDocument: trimText(raw.bankHolderDocument, 24).replace(/\D/g, '').slice(0, 14),
    pixKey: bankMethod === 'pix' ? trimText(raw.pixKey, 200) : '',
    bankName: bankMethod === 'bank' ? trimText(raw.bankName, 120) : '',
    bankAgency: bankMethod === 'bank' ? trimText(raw.bankAgency, 40) : '',
    bankAccount: bankMethod === 'bank' ? trimText(raw.bankAccount, 80) : '',
    notes: trimText(raw.notes, 1000),
    dataAccuracyConfirmed: raw.dataAccuracyConfirmed === true,
    representationAuthorityConfirmed: raw.representationAuthorityConfirmed === true,
    invoiceAcknowledged: raw.invoiceAcknowledged === true,
  };
}

function buildChildDocumentTemplates(answers: ReturnType<typeof sanitizePublicAnswers>): OnboardingDocument[] {
  return answers.children.flatMap((child, index) =>
    requiredFamilyDocumentKinds(child.birthDate).map((kind, order) => ({
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
  ).map((document) => {
    if (document.id === 'profile_photo') return { ...document, documentTypeCode: 'PROFILE_PHOTO', required: true };
    if (document.id === 'aso_admission' || document.documentTypeCode === 'ASO_ADMISSION') return { ...document, required: false };
    return document;
  });
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

async function loadSubmittedDocumentExtractions(
  processRef: FirebaseFirestore.DocumentReference,
  rawDocuments: Record<string, unknown>,
) {
  const submitted = Object.entries(rawDocuments).flatMap(([documentId, value]) => {
    const data = record(value);
    const hash = trimText(data.sha256, 64).toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(hash)) return [];
    return [{ documentId, hash }];
  });
  if (submitted.length > 30) throw new Error('Quantidade de documentos acima do limite permitido.');

  const snapshots = await Promise.all(submitted.map(({ documentId, hash }) => processRef
    .collection('documentExtractions')
    .doc(onboardingDocumentExtractionCacheId(documentId, hash))
    .get()));
  return new Map(snapshots.flatMap((snapshot, index) => snapshot.exists
    ? [[`${submitted[index].documentId}:${submitted[index].hash}`, snapshot.data() as OnboardingDocumentExtractionRecord] as const]
    : []));
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

async function ensureImageVoiceConsentSnapshot(
  term: ReturnType<typeof publicImageVoiceConsentTerm>,
  now: string,
) {
  const ref = hrDbAdmin.collection('privacy_notice_versions').doc(IMAGE_VOICE_CONSENT_SNAPSHOT_ID);
  await hrDbAdmin.runTransaction(async transaction => {
    const snapshot = await transaction.get(ref);
    if (snapshot.exists) {
      if (snapshot.data()?.hash_sha256 !== term.hash) {
        throw new Error('A versão publicada do Termo de Imagem e Voz não pode ser alterada. Publique uma nova versão.');
      }
      return;
    }
    transaction.create(ref, {
      version: term.version,
      title: term.title,
      full_text: term.termText,
      canonical_text: term.termText,
      checkbox_text: term.checkboxText,
      explanation: term.explanation,
      hash_sha256: term.hash,
      published_at: now,
      effective_at: IMAGE_VOICE_CONSENT_EFFECTIVE_AT,
      is_active: true,
      created_by: 'system',
      purpose: 'image_voice_consent',
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

async function syncPrivacyAndConsentToExistingEmployee(params: {
  candidateEmail: unknown;
  imageVoiceConsent: Record<string, unknown>;
  privacyAcknowledgement: Record<string, unknown>;
  protocol: string;
  now: string;
}) {
  const email = trimText(params.candidateEmail, 320).toLowerCase();
  if (!email) return null;
  const employees = await hrDbAdmin.collection('employees').where('email', '==', email).limit(2).get();
  if (employees.size !== 1) return null;

  const employeeRef = employees.docs[0].ref;
  const employeeId = employees.docs[0].id;
  const eventRef = employeeRef.collection('consentimentos_imagem_voz_historico').doc(params.protocol);
  const event = await eventRef.get();
  const batch = hrDbAdmin.batch();
  batch.set(employeeRef, {
    consentimento_imagem_voz: params.imageVoiceConsent,
    ciencia_privacidade_onboarding: params.privacyAcknowledgement,
    updated_at: params.now,
  }, { merge: true });
  if (!event.exists) {
    batch.create(eventRef, {
      ...params.imageVoiceConsent,
      evento: params.imageVoiceConsent.autorizado === true
        ? 'autorizacao_concedida'
        : 'autorizacao_nao_concedida',
      employee_id: employeeId,
      synced_from_onboarding_at: params.now,
    });
  }
  await batch.commit();
  return employeeId;
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

function storedImageVoiceConsentDecision(data: FirebaseFirestore.DocumentData) {
  const stored = record(data.consentimento_imagem_voz);
  if (Object.keys(stored).length === 0) return null;
  return {
    authorized: stored.autorizado === true,
    status: typeof stored.status === 'string' ? stored.status : null,
    termVersion: typeof stored.termVersion === 'string'
      ? stored.termVersion
      : typeof stored.versao_termo === 'string'
        ? stored.versao_termo
        : null,
    termHash: typeof stored.termHash === 'string'
      ? stored.termHash
      : typeof stored.hash_termo_exibido === 'string'
        ? stored.hash_termo_exibido
        : null,
    revokedAt: typeof stored.revokedAt === 'string' ? stored.revokedAt : null,
  };
}

function publicPayload(id: string, data: FirebaseFirestore.DocumentData) {
  const processDocuments = Array.isArray(data.documents) ? data.documents as OnboardingDocument[] : [];
  const imageVoiceConsentDecision = storedImageVoiceConsentDecision(data);
  const documents = data.employmentRelationshipType === 'pj'
    ? processDocuments
    : withUniversalDocuments(processDocuments);
  return {
    id,
    candidateName: data.candidateName ?? null,
    candidateEmail: data.candidateEmail ?? null,
    jobRoleName: data.jobRoleName ?? null,
    functionName: data.functionName ?? null,
    unitName: data.unitName ?? null,
    employmentRelationshipType: data.employmentRelationshipType ?? null,
    providerCnpj: data.providerCnpj ?? null,
    providerLegalName: data.providerLegalName ?? null,
    providerTradeName: data.providerTradeName ?? null,
    employerUnitName: data.employerUnitName ?? null,
    pjWorkflow: data.pjWorkflow ?? null,
    status: data.status ?? null,
    currentStage: data.currentStage ?? null,
    documents: documents
      .filter(document => document.id !== 'aso_admission' && document.documentTypeCode !== 'ASO_ADMISSION')
      .map(document => presentOnboardingDocumentForAnswers(document, data.publicFormAnswers))
      .map(document => ({
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
    identityCorrectionAllowed: record(data.identityCorrection).status === 'authorized',
    publicTokenExpiresAt: onboardingPublicLinkExpiresAt(data)?.toISOString() ?? null,
    publicTokenExtensionUsed: data.publicTokenExtensionUsed === true,
    privacyNotice: publicPrivacyNotice(),
    imageVoiceConsentTerm: publicImageVoiceConsentTerm(),
    imageVoiceConsentDecision,
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
  const closedMessage = onboardingPublicLinkClosedMessage(data);
  if (closedMessage) return jsonError(closedMessage, 410);
  if (data.status === 'cancelled' || data.status === 'completed') {
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
  return jsonSuccess(publicPayload(doc.id, serializeHrValue(data) as FirebaseFirestore.DocumentData));
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
  const closedMessage = onboardingPublicLinkClosedMessage(data);
  if (closedMessage) return jsonError(closedMessage, 410);
  if (data.status === 'cancelled' || data.status === 'completed') {
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

  if (data.employmentRelationshipType === 'pj') {
    const publicFormAnswers = sanitizePjPublicAnswers(rawAnswers);
    const missing = pjRequiredRegistrationFieldsMissing(publicFormAnswers);
    if (publicFormAnswers.representativeCpf.length !== 11) missing.push('CPF válido do representante legal');
    if (![11, 14].includes(publicFormAnswers.bankHolderDocument.length)) missing.push('CPF ou CNPJ válido do titular');
    if (!publicFormAnswers.authoritySource) missing.push('Origem dos poderes de representação');
    if (!publicFormAnswers.dataAccuracyConfirmed) missing.push('Declaração de veracidade dos dados');
    if (!publicFormAnswers.representationAuthorityConfirmed) missing.push('Declaração de poderes de representação');
    if (!publicFormAnswers.invoiceAcknowledged) missing.push('Ciência da obrigatoriedade da nota fiscal');
    if (missing.length) return jsonError(`Preencha os campos obrigatórios: ${Array.from(new Set(missing)).join(', ')}.`);

    const notice = publicPrivacyNotice();
    const acceptanceInput = input.privacyAcceptance && typeof input.privacyAcceptance === 'object' && !Array.isArray(input.privacyAcceptance)
      ? input.privacyAcceptance as Record<string, unknown>
      : {};
    const noticeMatches = trimText(acceptanceInput.noticeVersion, 80) === notice.version
      && trimText(acceptanceInput.noticeHash, 128) === notice.hash;
    if (!noticeMatches || acceptanceInput.acknowledged !== true) {
      return jsonError('Leia e confirme o Aviso de Privacidade para enviar o cadastro.');
    }

    const documents = (Array.isArray(data.documents) ? data.documents as OnboardingDocument[] : [])
      .map(document => document.id === 'power_of_attorney'
        ? { ...document, required: publicFormAnswers.authoritySource === 'power_of_attorney' }
        : document);
    const blocked = Object.keys(rawDocuments).find(documentId => {
      const current = documents.find(document => document.id === documentId);
      return current ? !canCandidateUploadDocument(current) : true;
    });
    if (blocked) return jsonError('Documento já enviado ou não reconhecido. O RH precisa liberá-lo para substituição.', 403);
    const nextDocuments = documents.map(document => {
      const submitted = rawDocuments[document.id];
      if (!submitted || typeof submitted !== 'object' || Array.isArray(submitted)) return document;
      const submittedData = submitted as Record<string, unknown>;
      const fileUrl = isAllowedStorageUrl(submittedData.fileUrl) ? submittedData.fileUrl : null;
      if (!fileUrl) return document;
      return {
        ...document,
        status: 'received' as const,
        fileUrl,
        filePath: trimText(submittedData.filePath, 700) || document.filePath || null,
        fileHashSha256: /^[a-f0-9]{64}$/i.test(trimText(submittedData.sha256, 64))
          ? trimText(submittedData.sha256, 64).toLowerCase()
          : document.fileHashSha256 ?? null,
        receivedAt: now,
        approvedAt: null,
        updatedAt: now,
      };
    });
    if (!requiredDocumentsSubmitted(nextDocuments)) {
      return jsonError('Anexe todos os documentos obrigatórios antes de enviar o cadastro.');
    }

    const protocol = createSubmissionProtocol(new Date(now));
    const privacyNoticeSnapshotId = await ensurePrivacyNoticeSnapshot(notice, now);
    const previousAcceptance = data.publicPrivacyAcceptance && typeof data.publicPrivacyAcceptance === 'object'
      ? data.publicPrivacyAcceptance as Record<string, unknown>
      : {};
    const publicPrivacyAcceptance = {
      noticeVersion: notice.version,
      noticeHash: notice.hash,
      noticeTitle: notice.title,
      noticeSummary: notice.summary,
      noticeText: notice.text,
      acknowledgementText: notice.acknowledgementText,
      confirmationNote: notice.confirmationNote,
      acknowledged: true,
      firstAcceptedAt: previousAcceptance.noticeVersion === notice.version ? previousAcceptance.firstAcceptedAt ?? now : now,
      lastConfirmedAt: now,
      privacyNoticeSnapshotId,
      lastProtocol: protocol,
    };
    const workflow = data.pjWorkflow as PjOnboardingWorkflow;
    const nextWorkflow = setPjWorkflowStep({
      ...workflow,
      currentStep: 'provider_registration',
      steps: {
        ...workflow.steps,
        provider_registration: { ...workflow.steps.provider_registration, status: 'active' },
      },
    }, 'registration_review', now, 'provider');
    await doc.ref.set({
      documents: nextDocuments,
      publicFormAnswers,
      publicFormSubmittedAt: data.publicFormSubmittedAt ?? now,
      publicFormLastSubmittedAt: now,
      ...closeOnboardingPublicLink(new Date(now)),
      publicPrivacyAcceptance,
      pjWorkflow: nextWorkflow,
      currentStage: 'document_review',
      currentStageStartedAt: data.currentStage === 'document_review'
        ? data.currentStageStartedAt ?? now
        : now,
      status: 'reviewing_documents',
      updatedAt: now,
    }, { merge: true });
    await doc.ref.collection('audit').add({
      action: 'PJ_PROVIDER_REGISTRATION_SUBMITTED',
      protocol,
      tokenHash: sha256(cleanToken),
      submittedDocumentIds: Object.keys(rawDocuments),
      privacyNoticeVersion: notice.version,
      privacyNoticeHash: notice.hash,
      ...clientEvidence(request),
      at: now,
    });
    const saved = await doc.ref.get();
    return jsonSuccess(publicPayload(saved.id, serializeHrValue(saved.data()) as FirebaseFirestore.DocumentData));
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
  const previousPublicFormAnswers = sanitizePublicAnswers(record(data.publicFormAnswers));
  const hasPreviousSubmission = Boolean(data.publicFormSubmittedAt);
  const identityChanges = hasPreviousSubmission
    ? changedIdentityFields(previousPublicFormAnswers, publicFormAnswers)
    : [];
  const identityCorrection = record(data.identityCorrection);
  const identityCorrectionAuthorized = identityCorrection.status === 'authorized';
  if (identityChanges.length > 0 && !identityCorrectionAuthorized) {
    return jsonError('Nome e CPF ficam bloqueados após o primeiro envio. Solicite ao RH a liberação para corrigir esses dados.', 403);
  }
  const formAnswersChanged = hasPreviousSubmission
    ? !publicFormAnswersEqual(previousPublicFormAnswers, publicFormAnswers)
    : true;
  const publicFormRevision = nextPublicFormRevision({
    currentRevision: data.publicFormRevision,
    hasPreviousSubmission,
    answersChanged: formAnswersChanged,
  });
  if (!publicFormAnswers.fullName) return jsonError('Informe o nome completo.');
  if (publicFormAnswers.cpf.length !== 11) return jsonError('Informe um CPF com 11 dígitos.');
  if (!publicFormAnswers.maritalStatus) return jsonError('Informe o estado civil.');
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
  const submittedImageVoiceConsent = record(input.imageVoiceConsent);
  const imageVoiceDecision = parseImageVoiceConsentDecision(submittedImageVoiceConsent);
  const imageVoiceTerm = imageVoiceDecision.term;
  if (!imageVoiceDecision.valid) {
    return jsonError('Não foi possível registrar sua decisão sobre o uso opcional de imagem e voz. Recarregue a página e tente novamente.');
  }
  const imageVoiceDecisionChanged = submittedImageVoiceConsent.decisionChanged === true || !hasPreviousSubmission;
  const imageVoiceAuthorized = resolveSubmittedImageVoiceAuthorization({
    decisionChanged: imageVoiceDecisionChanged,
    hasPreviousSubmission,
    previousDecision: storedImageVoiceConsentDecision(data),
    currentTerm: imageVoiceTerm,
    submittedAuthorized: imageVoiceDecision.authorized,
  });
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

  let submittedExtractions: Map<string, OnboardingDocumentExtractionRecord>;
  try {
    submittedExtractions = await loadSubmittedDocumentExtractions(doc.ref, rawDocuments);
  } catch (error) {
    reportSystemError({
      error,
      code: 'ONBOARDING_DOCUMENT_EXTRACTION_LOAD_FAILED',
      source: 'api',
      operation: 'load-onboarding-document-extractions',
      routeOrJob: '/api/hr/onboarding/public/[token]',
      metadata: { processId: doc.id },
    });
    return jsonError('Não foi possível validar a análise dos documentos enviados.', 500);
  }

  const nextDocuments = expectedDocuments.map((document) => {
    const submitted = rawDocuments[document.id];
    if (!submitted || typeof submitted !== 'object' || Array.isArray(submitted)) return document;
    const submittedData = submitted as Record<string, unknown>;
    const fileUrl = isAllowedStorageUrl(submittedData.fileUrl) ? submittedData.fileUrl : null;
    if (!fileUrl) return document;
    const sourceFileHashSha256 = /^[a-f0-9]{64}$/i.test(trimText(submittedData.sha256, 64))
      ? trimText(submittedData.sha256, 64).toLowerCase()
      : (document as OnboardingDocument & { fileHashSha256?: string | null }).fileHashSha256 ?? '';
    const extraction = sourceFileHashSha256
      ? submittedExtractions.get(`${document.id}:${sourceFileHashSha256}`)
      : null;
    const extracted = mergeOnboardingDocumentExtraction({
      document,
      sourceFileHashSha256,
      extraction,
    });
    return {
      ...document,
      ...extracted,
      fileUrl,
      filePath: trimText(submittedData.filePath, 700) || (document.filePath ?? null),
      fileHashSha256: sourceFileHashSha256 || null,
      note: trimText(submittedData.note, 500) || (document.note ?? null),
      receivedAt: now,
      approvedAt: null,
      updatedAt: now,
    };
  });
  const allRequiredDocumentsSubmitted = requiredDocumentsSubmitted(
    applicableOnboardingDocuments(nextDocuments, publicFormAnswers),
  );
  const shouldMoveToReview = data.currentStage === 'documents' || !data.currentStage;
  const submittedAt = new Date(now);
  const protocol = createSubmissionProtocol(submittedAt);
  const sessionId = trimText(input.sessionId, 120) || randomBytes(12).toString('hex');
  let privacyNoticeSnapshotId: string;
  let allergyNoticeSnapshotId: string;
  let imageVoiceConsentSnapshotId: string;
  try {
    privacyNoticeSnapshotId = await ensurePrivacyNoticeSnapshot(notice, now);
    allergyNoticeSnapshotId = await ensureAllergyNoticeSnapshot(notice, now);
    imageVoiceConsentSnapshotId = await ensureImageVoiceConsentSnapshot(imageVoiceTerm, now);
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
  const evidence = clientEvidence(request);
  const imageVoiceConsent = {
    autorizado: imageVoiceAuthorized,
    respondido_em: now,
    versao_termo: imageVoiceTerm.version,
    ip: evidence.clientIp,
    user_agent: evidence.userAgent,
    hash_termo_exibido: imageVoiceTerm.hash,
    termo_snapshot_id: imageVoiceConsentSnapshotId,
    protocolo: protocol,
    origem: 'onboarding_publico',
    onboarding_id: doc.id,
    status: imageVoiceAuthorized ? 'granted' : 'denied',
    termVersion: imageVoiceTerm.version,
    termHash: imageVoiceTerm.hash,
    decisionAt: now,
    decisionChannel: 'onboarding_public',
    decisionEvidence: {
      protocol,
      ip: evidence.clientIp,
      userAgent: evidence.userAgent,
      snapshotId: imageVoiceConsentSnapshotId,
    },
    signedDocumentId: null,
    revokedAt: null,
    revocationReason: null,
    revocationChannel: null,
    operationalEffectStatus: 'not_applicable',
    operationalEffectAt: null,
    usages: [],
  };

  const identityCorrectionConsumed = identityChanges.length > 0 && identityCorrectionAuthorized;
  const asoWorkflow = record(data.asoWorkflow);
  const candidateNotification = record(asoWorkflow.candidateNotification);
  const schedulingEmailSentAt = trimText(candidateNotification.sentAt, 40);
  const guideBecameOutdated = identityChanges.length > 0 && !schedulingEmailSentAt;
  const shouldUpdateAsoWorkflow = guideBecameOutdated;
  const nextAsoWorkflow = {
    ...asoWorkflow,
    ...(guideBecameOutdated ? { latestGuideRequiresRegeneration: true } : {}),
  };

  await doc.ref.set({
    documents: nextDocuments,
    candidateName: publicFormAnswers.fullName,
    publicFormAnswers,
    publicFormSubmittedAt: data.publicFormSubmittedAt ?? now,
    publicFormLastSubmittedAt: now,
    publicFormRevision,
    ...closeOnboardingPublicLink(new Date(now)),
    ...(identityCorrectionConsumed ? {
      identityCorrection: {
        ...identityCorrection,
        status: 'consumed',
        consumedAt: now,
        submissionProtocol: protocol,
        changedFields: identityChanges,
        clinicRevalidationRequired: schedulingEmailSentAt ? false : null,
      },
    } : {}),
    ...(shouldUpdateAsoWorkflow ? { asoWorkflow: nextAsoWorkflow } : {}),
    publicPrivacyAcceptance,
    consentimento_imagem_voz: imageVoiceConsent,
    currentStage: shouldMoveToReview
      ? 'document_review'
      : data.currentStage ?? 'documents',
    currentStageStartedAt: shouldMoveToReview
      ? now
      : data.currentStageStartedAt ?? data.createdAt ?? now,
    status: shouldMoveToReview && (data.status === 'collecting_documents' || data.status === 'pending_setup')
      ? 'reviewing_documents'
      : data.status === 'pending_setup'
        ? 'collecting_documents'
        : data.status,
    updatedAt: now,
  }, { merge: true });

  await doc.ref.collection('consentimentos_imagem_voz_historico').doc(protocol).set({
    ...imageVoiceConsent,
    evento: imageVoiceAuthorized ? 'autorizacao_concedida' : 'autorizacao_nao_concedida',
    created_at: now,
  });

  const existingEmployeeId = await syncPrivacyAndConsentToExistingEmployee({
    candidateEmail: data.candidateEmail,
    imageVoiceConsent,
    privacyAcknowledgement: {
      ...publicPrivacyAcceptance,
      onboarding_id: doc.id,
    },
    protocol,
    now,
  }).catch(error => {
    console.error('[onboarding] Falha ao sincronizar privacidade e consentimento com colaborador existente.', error);
    return null;
  });

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
    allRequiredDocumentsSubmitted,
    movedToReview: shouldMoveToReview,
    publicFormRevision,
    formAnswersChanged,
    identityCorrectionApplied: identityCorrectionConsumed,
    identityCorrectionChangedFields: identityChanges,
    clinicRevalidationRequired: identityCorrectionConsumed && schedulingEmailSentAt ? false : null,
    asoGuideRequiresRegeneration: guideBecameOutdated,
    existing_employee_consent_synced: Boolean(existingEmployeeId),
    existing_employee_id: existingEmployeeId,
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
    consentimento_imagem_voz_autorizado: imageVoiceAuthorized,
    consentimento_imagem_voz_versao: imageVoiceTerm.version,
    consentimento_imagem_voz_hash: imageVoiceTerm.hash,
    consentimento_imagem_voz_snapshot_id: imageVoiceConsentSnapshotId,
    consentimento_imagem_voz_checkbox_text: imageVoiceTerm.checkboxText,
    consentimento_imagem_voz_decisao_alterada: imageVoiceDecisionChanged,
    submitted_at: now,
    ...clientEvidence(request),
    at: now,
  });

  const saved = await doc.ref.get();
  return jsonSuccess(publicPayload(saved.id, serializeHrValue(saved.data()) as FirebaseFirestore.DocumentData));
}
