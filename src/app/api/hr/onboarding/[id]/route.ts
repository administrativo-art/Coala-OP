import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'node:crypto';
import { Timestamp } from 'firebase-admin/firestore';

import { resolveCollaboratorCore } from '@/features/hr/lib/collaborator-core.server';
import { initialTransportVoucherHistory } from '@/features/hr/lib/collaborator-data-contract';
import { integrationTemplateVersionSchema, type IntegrationTemplateVersion } from '@/features/hr/integration/schemas';
import { assertFormalizationAccess, serializeHrValue } from '@/features/hr/lib/server-access';
import { shiftDefinitionMatchesUnit } from '@/lib/dp-shift-definitions';
import { authAdmin, dbAdmin } from '@/lib/firebase-admin';
import { createFirstAccessLink } from '@/lib/first-access-links';
import { isEmploymentRelationshipType } from '@/lib/hr/employment-relationship';
import { sendTrackedIntegrationCommunication } from '@/lib/email/integration-communications';
import { hrDbAdmin } from '@/lib/firebase-rh-admin';
import { findBizneoUser } from '@/lib/integrations/bizneo-admin';
import { findPdvLegalUser } from '@/lib/integrations/pdv-legal-admin';
import { logAction } from '@/lib/log-action';
import { requiredOnboardingIntegrationsResolved } from '@/lib/hr/onboarding-integrations';
import { promoteApprovedOnboardingDocuments } from '@/lib/hr/promote-onboarding-documents';
import { listSignatureWorkflow, promoteSignedOnboardingDocuments } from '@/features/hr/documents/signature-workflow.server';
import { setPjWorkflowStep } from '@/features/hr/onboarding-pj/core';
import { extendOnboardingPublicLink, onboardingPublicLinkExtensionUsed } from '@/lib/hr/onboarding-public-link';
import { CnpjValidator } from '@/lib/company/cnpj-validator';
import {
  canUpdateExpectedAdmissionDate,
  normalizeOnboardingCancellationReason,
  normalizeOnboardingDateOnly,
  ONBOARDING_CANCELLATION_REASON_MIN_LENGTH,
} from '@/features/hr/onboarding-lifecycle';
import type { OnboardingDocument, OnboardingProcess, OnboardingStageId, PjOnboardingWorkflow } from '@/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

function asString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function normalizeEmail(value: unknown) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function asStringArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  value.forEach((entry) => {
    if (typeof entry !== 'string') return;
    const normalized = entry.trim();
    if (normalized) seen.add(normalized);
  });
  return Array.from(seen);
}

type IntegrationAlert = NonNullable<OnboardingProcess['integrationAlerts']>[number];

async function verifyAccessIntegrations(params: {
  process: Record<string, unknown>;
  collaboratorUserId: string;
  now: string;
}): Promise<IntegrationAlert[]> {
  const userRef = dbAdmin.collection('users').doc(params.collaboratorUserId);
  const candidateId = asString(params.process.candidateId);
  const candidateRef = candidateId ? hrDbAdmin.collection('candidates').doc(candidateId) : null;
  const [userDoc, candidateDoc] = await Promise.all([
    userRef.get(),
    candidateRef ? candidateRef.get() : Promise.resolve(null),
  ]);
  if (!userDoc.exists) throw new Error('Cadastro interno do colaborador não encontrado.');

  const user = userDoc.data() ?? {};
  const candidate = candidateDoc?.data() ?? {};
  const email = normalizeEmail(user.email ?? params.process.candidateEmail);
  const knownBizneoId = asString(user.registrationIdBizneo) ?? asString(candidate.registrationIdBizneo);
  const knownPdvId = asString(user.registrationIdPdv) ?? asString(candidate.registrationIdPdv);
  const existingAlerts = Array.isArray(params.process.integrationAlerts)
    ? params.process.integrationAlerts.map(entry => asRecord(entry))
    : [];

  let bizneoAlert: IntegrationAlert;
  try {
    const bizneoUser = await findBizneoUser({ email, id: knownBizneoId });
    if (bizneoUser) {
      const registrationIdBizneo = String(bizneoUser.id);
      await userRef.set({ registrationIdBizneo, updatedAt: params.now }, { merge: true });
      bizneoAlert = { id: 'bizneo_id', label: 'Bizneo HR', status: 'resolved', message: `Cadastro localizado e vinculado pelo e-mail (ID ${registrationIdBizneo}).`, checkedAt: params.now, externalId: registrationIdBizneo, source: 'bizneo_api' };
    } else {
      bizneoAlert = { id: 'bizneo_id', label: 'Bizneo HR', status: 'pending', message: 'Colaborador não localizado no Bizneo. Cadastre-o e verifique novamente.', checkedAt: params.now, source: 'bizneo_api' };
    }
  } catch (cause) {
    bizneoAlert = { id: 'bizneo_id', label: 'Bizneo HR', status: 'pending', message: cause instanceof Error ? `Não foi possível consultar o Bizneo: ${cause.message}` : 'Não foi possível consultar o Bizneo.', checkedAt: params.now, source: 'bizneo_api' };
  }

  let pdvAlert: IntegrationAlert;
  const pdvAccess = asRecord(params.process.pdvAccess);
  if (pdvAccess.required !== true) {
    pdvAlert = { id: 'pdv_id', label: 'PDV Legal', status: 'resolved', message: 'Acesso ao PDV não solicitado para este colaborador.', checkedAt: params.now, source: 'onboarding_configuration' };
  } else {
    try {
      const pdvUser = await findPdvLegalUser({
        id: knownPdvId,
        name: asString(user.username) ?? asString(params.process.candidateName) ?? '',
        filialId: asString(pdvAccess.filialId),
      });
      if (pdvUser) {
        const currentAccesses = Array.isArray(user.pdvAccesses)
          ? user.pdvAccesses.filter((entry): entry is Record<string, unknown> => Boolean(entry && typeof entry === 'object' && !Array.isArray(entry)))
          : [];
        const nextAccess = {
          externalUserId: pdvUser.id,
          unitId: asString(pdvAccess.unitId),
          unitName: asString(pdvAccess.unitName),
          filialId: asString(pdvAccess.filialId),
          filialName: asString(pdvAccess.filialName),
          profileId: asString(pdvAccess.profileId),
          profileName: asString(pdvAccess.profileName),
          status: 'active',
          updatedAt: params.now,
        };
        const pdvAccesses = [
          ...currentAccesses.filter(entry => asString(entry.externalUserId) !== pdvUser.id),
          nextAccess,
        ];
        await userRef.set({
          registrationIdPdv: pdvUser.id,
          pdvAccessProfileId: asString(pdvAccess.profileId),
          pdvAccessProfileName: asString(pdvAccess.profileName),
          pdvAccessFilialId: asString(pdvAccess.filialId),
          pdvAccessFilialName: asString(pdvAccess.filialName),
          pdvAccesses,
          updatedAt: params.now,
        }, { merge: true });
        pdvAlert = { id: 'pdv_id', label: 'PDV Legal', status: 'resolved', message: `Cadastro localizado na filial vinculada (ID ${pdvUser.id}).`, checkedAt: params.now, externalId: pdvUser.id, source: 'pdv_api' };
      } else {
        pdvAlert = { id: 'pdv_id', label: 'PDV Legal', status: 'pending', message: 'Colaborador não localizado no PDV Legal para a filial desta unidade.', checkedAt: params.now, source: 'pdv_api' };
      }
    } catch (cause) {
      pdvAlert = { id: 'pdv_id', label: 'PDV Legal', status: 'pending', message: cause instanceof Error ? `Não foi possível consultar o PDV Legal: ${cause.message}` : 'Não foi possível consultar o PDV Legal.', checkedAt: params.now, source: 'pdv_api' };
    }
  }

  const requiredIds = new Set(['bizneo_id', 'pdv_id']);
  return [bizneoAlert, pdvAlert, ...existingAlerts
    .filter(alert => !requiredIds.has(asString(alert.id) ?? ''))
    .map(alert => alert as IntegrationAlert)];
}

function answerString(answers: Record<string, unknown>, key: string) {
  return asString(answers[key]) ?? '';
}

function answerBoolean(answers: Record<string, unknown>, key: string) {
  const value = answerString(answers, key);
  if (value === 'yes') return true;
  if (value === 'no') return false;
  return null;
}

function asBoolean(value: unknown) {
  return typeof value === 'boolean' ? value : null;
}

function asNumber(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value.replace(',', '.'));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function makeInternalPassword() {
  return `${randomBytes(24).toString('base64url')}Aa1!`;
}

function appBaseUrl(request: NextRequest) {
  const configured = process.env.NEXT_PUBLIC_APP_URL ?? process.env.APP_URL;
  if (configured?.trim()) return configured.trim();
  return new URL(request.url).origin;
}

function dependentAge(birthDate?: string | null) {
  if (!birthDate) return null;
  const date = new Date(`${birthDate}T12:00:00.000Z`);
  if (!Number.isFinite(date.getTime())) return null;
  const today = new Date();
  let age = today.getFullYear() - date.getFullYear();
  const monthDelta = today.getMonth() - date.getMonth();
  if (monthDelta < 0 || (monthDelta === 0 && today.getDate() < date.getDate())) age -= 1;
  return age;
}

function childEntitlementEndsAt(birthDate?: string | null) {
  if (!birthDate) return null;
  const date = new Date(`${birthDate}T12:00:00.000Z`);
  if (!Number.isFinite(date.getTime())) return null;
  date.setFullYear(date.getFullYear() + 14);
  return date.toISOString().slice(0, 10);
}

function childCountLabel(count: number) {
  if (count <= 0) return 'Nenhum';
  if (count >= 4) return '4 ou mais';
  return String(count);
}

function timestampFromDateString(value: unknown) {
  const dateText = asString(value)?.slice(0, 10);
  if (!dateText || !/^\d{4}-\d{2}-\d{2}$/.test(dateText)) return Timestamp.now();
  const date = new Date(`${dateText}T12:00:00.000Z`);
  return Number.isFinite(date.getTime()) ? Timestamp.fromDate(date) : Timestamp.now();
}

function childrenFromAnswers(answers: Record<string, unknown>) {
  const children = Array.isArray(answers.children) ? answers.children : [];
  return children
    .slice(0, 12)
    .map((entry, index) => {
      const data = asRecord(entry);
      const birthDate = answerString(data, 'birthDate').slice(0, 10);
      return {
        key: `filho_${index + 1}`,
        name: answerString(data, 'name') || null,
        birthDate: /^\d{4}-\d{2}-\d{2}$/.test(birthDate) ? birthDate : null,
        cpf: answerString(data, 'cpf') || null,
        rg: null,
        relationship: 'Filho(a)',
        documents: {},
        entitlementEndsAt: childEntitlementEndsAt(birthDate),
      };
    });
}

function nextStatusForStage(stage: OnboardingStageId | undefined): OnboardingProcess['status'] {
  if (stage === 'documents') return 'collecting_documents';
  if (stage === 'document_review') return 'reviewing_documents';
  if (stage === 'accountant') return 'accountant_pending';
  if (stage === 'signature_preparation' || stage === 'signature') return 'contract_pending';
  if (stage === 'formalization_validation') return 'ready_to_create_user';
  if (stage === 'integration' || stage === 'probation') return 'active';
  if (stage === 'done') return 'completed';
  return 'pending_setup';
}

function isDocumentReceivedStatus(status: OnboardingDocument['status']) {
  return status === 'received' || status === 'ai_approved' || status === 'review_required' || status === 'approved';
}

function hasAuditableDocumentFile(document: OnboardingDocument) {
  return typeof document.fileUrl === 'string' && document.fileUrl.trim().length > 0;
}

function mergeDocumentStatus(
  documents: OnboardingDocument[],
  documentId: string,
  status: OnboardingDocument['status'],
  note: string | null,
  now: string
) {
  return documents.map((document) => {
    if (document.id !== documentId) return document;
    return {
      ...document,
      status,
      note,
      updatedAt: now,
      receivedAt: isDocumentReceivedStatus(status)
        ? document.receivedAt ?? now
        : status === 'pending'
          ? null
          : document.receivedAt ?? null,
      approvedAt: status === 'approved' ? now : null,
    };
  });
}

function mergeDocumentStatuses(
  documents: OnboardingDocument[],
  documentIds: string[],
  status: OnboardingDocument['status'],
  note: string | null,
  now: string
) {
  const targetIds = new Set(documentIds);
  return documents.map((document) => {
    if (!targetIds.has(document.id)) return document;
    return {
      ...document,
      status,
      note,
      updatedAt: now,
      receivedAt: isDocumentReceivedStatus(status)
        ? document.receivedAt ?? now
        : status === 'pending'
          ? null
          : document.receivedAt ?? null,
      approvedAt: status === 'approved' ? now : null,
    };
  });
}

async function getOrCreateAuthUser(email: string, displayName: string) {
  try {
    return { user: await authAdmin.getUserByEmail(email), created: false };
  } catch {
    return {
      user: await authAdmin.createUser({
      email,
      password: makeInternalPassword(),
      displayName,
      emailVerified: false,
      disabled: false,
      }),
      created: true,
    };
  }
}

async function createPjUserFromOnboarding(params: {
  processId: string;
  process: Record<string, unknown>;
  actorId: string;
  actorName: string;
  actorEmail: string | null;
  baseUrl: string;
}) {
  const workflow = params.process.pjWorkflow && typeof params.process.pjWorkflow === 'object' && !Array.isArray(params.process.pjWorkflow)
    ? params.process.pjWorkflow as PjOnboardingWorkflow
    : null;
  if (!workflow) throw new Error('O fluxo PJ está incompleto.');
  if (workflow.finance?.status !== 'approved' || workflow.access?.status !== 'configured') {
    throw new Error('Aprovação financeira e configuração dos acessos são obrigatórias antes da criação do usuário.');
  }
  const name = asString(workflow.access.userName);
  const cpf = String(workflow.access.userCpf ?? '').replace(/\D/g, '');
  const profileId = asString(workflow.access.profileId);
  const unitIds = Array.isArray(workflow.access.unitIds) ? workflow.access.unitIds.filter(Boolean) : [];
  const email = normalizeEmail(workflow.provider.email ?? params.process.candidateEmail);
  if (!name || cpf.length !== 11 || !profileId || !unitIds.length || !email) {
    throw new Error('Revise nome, CPF, e-mail, perfil e unidades do acesso.');
  }
  const [profileDocument, ...unitDocuments] = await Promise.all([
    dbAdmin.collection('profiles').doc(profileId).get(),
    ...unitIds.map(unitId => dbAdmin.collection('dp_units').doc(unitId).get()),
  ]);
  if (!profileDocument.exists || profileDocument.get('isDefaultAdmin') === true) throw new Error('Perfil de acesso inválido para a prestadora.');
  if (unitDocuments.some(document => !document.exists || document.get('isArchived') === true)) throw new Error('Uma das unidades de acesso não está disponível.');

  const authResult = await getOrCreateAuthUser(email, name);
  const authUser = authResult.user;
  if (!authResult.created) {
    const existing = await dbAdmin.collection('users').doc(authUser.uid).get();
    const existingSource = asString(existing.get('source'));
    const existingOnboardingId = asString(existing.get('onboardingId'));
    if (existing.exists && existingSource !== 'recruitment_onboarding' && existingOnboardingId !== params.processId) {
      throw new Error('Já existe um usuário com este e-mail. Revise o cadastro antes de criar o acesso.');
    }
  }
  await authAdmin.setCustomUserClaims(authUser.uid, { profileId, isDefaultAdmin: false });
  const now = new Date().toISOString();
  const startTimestamp = timestampFromDateString(workflow.terms.contractStartDate);
  await dbAdmin.collection('users').doc(authUser.uid).set({
    username: name,
    email,
    cpf,
    hrEmployeeId: authUser.uid,
    personRecordType: 'pj',
    employmentRelationshipType: 'pj',
    profileId,
    unitId: unitIds[0],
    unitIds,
    assignedKioskIds: unitIds,
    isActive: true,
    admissionDate: startTimestamp,
    mustChangePassword: true,
    providerCnpj: workflow.provider.cnpj,
    providerLegalName: workflow.provider.legalName,
    source: 'recruitment_onboarding',
    recruitmentCandidateId: asString(params.process.candidateId),
    onboardingId: params.processId,
    profileCompliance: {
      status: 'pending', policyVersion: 1, missingFields: [], invalidFields: [],
      evaluatedAt: null, completedAt: null, lastConfirmedAt: null, nextReviewAt: null,
    },
    updatedAt: now,
    createdAt: now,
  }, { merge: true });
  await hrDbAdmin.collection('employees').doc(authUser.uid).set({
    auth_uid: authUser.uid,
    source_user_id: authUser.uid,
    source: 'recruitment_onboarding',
    name,
    email,
    access_email: email,
    cpf,
    person_record_type: 'pj',
    employment_relationship_type: 'pj',
    provider_cnpj: workflow.provider.cnpj,
    provider_legal_name: workflow.provider.legalName,
    status: 'active',
    unit_id: unitIds[0],
    unit_ids: unitIds,
    profile_id: profileId,
    profile_completion: 0,
    synced_at: startTimestamp,
    created_at: startTimestamp,
    updated_at: startTimestamp,
  }, { merge: true });
  const firstAccessLink = await createFirstAccessLink({
    userId: authUser.uid,
    onboardingId: params.processId,
    baseUrl: params.baseUrl,
    createdBy: params.actorId,
    createdByEmail: params.actorEmail,
  });
  return {
    userId: authUser.uid,
    employeeId: authUser.uid,
    firstAccessLink,
    promotedDocuments: { documents: Array.isArray(params.process.documents) ? params.process.documents : [], promotedCount: 0, duplicateCount: 0, promotedDocumentIds: [] },
    promotedSignedDocumentIds: [] as string[],
  };
}

async function createCollaboratorFromOnboarding(params: {
  processId: string;
  process: Record<string, unknown>;
  actorId: string;
  actorName: string;
  actorEmail: string | null;
  baseUrl: string;
}) {
  if (params.process.employmentRelationshipType === 'pj') {
    return createPjUserFromOnboarding(params);
  }
  const publicAnswers = asRecord(params.process.publicFormAnswers);
  const name = answerString(publicAnswers, 'fullName') || asString(params.process.candidateName) || 'Novo colaborador';
  const email = normalizeEmail(params.process.candidateEmail);
  if (!email) throw new Error('Candidato sem e-mail para criação do usuário.');

  const authResult = await getOrCreateAuthUser(email, name);
  const authUser = authResult.user;
  if (!authResult.created) {
    const existingUserDoc = await dbAdmin.collection('users').doc(authUser.uid).get();
    const existingUser = existingUserDoc.data() ?? {};
    const existingSource = asString(existingUser.source);
    const existingOnboardingId = asString(existingUser.onboardingId);
    if (existingUserDoc.exists && existingSource !== 'recruitment_onboarding' && existingOnboardingId !== params.processId) {
      throw new Error('Já existe um usuário com este e-mail. Revise o cadastro antes de criar o colaborador.');
    }
  }
  const now = new Date().toISOString();
  const admissionTimestamp = timestampFromDateString(params.process.expectedAdmissionDate);
  const unitId = asString(params.process.unitId);
  const finalization = asRecord(params.process.finalizationSettings);
  const childRecords = childrenFromAnswers(publicAnswers);
  const childrenUnder14 = childRecords.filter((child) => {
    const age = dependentAge(child.birthDate);
    return age == null || (age >= 0 && age < 14);
  }).length;
  const hasCnh = answerBoolean(publicAnswers, 'hasCnh');
  const wantsTransportVoucher = answerBoolean(publicAnswers, 'wantsTransportVoucher');
  const hasFoodRestriction = answerBoolean(publicAnswers, 'hasFoodRestriction');
  const operational = asBoolean(finalization.operational) ?? false;
  const participatesInGoals = asBoolean(finalization.participatesInGoals) ?? false;
  const loginRestrictionEnabled = asBoolean(finalization.loginRestrictionEnabled) ?? false;
  const needsTransportVoucher = asBoolean(finalization.needsTransportVoucher) ?? wantsTransportVoucher ?? false;
  const transportVoucherValue = needsTransportVoucher ? asNumber(finalization.transportVoucherValue) ?? undefined : undefined;
  const transportVoucherHistory = initialTransportVoucherHistory({
    active: needsTransportVoucher,
    value: transportVoucherValue,
    effectiveDate: asString(params.process.expectedAdmissionDate)?.slice(0, 10) ?? now.slice(0, 10),
    actor: { userId: params.actorId, username: params.actorName },
  });
  const shiftDefinitionId = asString(finalization.shiftDefinitionId) ?? asString(params.process.shiftDefinitionId);
  const collaboratorCore = await resolveCollaboratorCore({
    jobRoleId: params.process.jobRoleId,
    functionId: params.process.functionId,
    unitId,
    shiftDefinitionId,
    operational,
    participatesInGoals,
    loginRestrictionEnabled,
    needsTransportVoucher,
    transportVoucherValue,
  }, { syncProfile: true });
  if (!collaboratorCore.role?.defaultProfileId) {
    throw new Error('Todo cargo ativo deve possuir um perfil de acesso padrão antes da criação do colaborador.');
  }
  const profileId = collaboratorCore.effectiveProfileId;
  if (!profileId) {
    throw new Error('O cargo selecionado não possui perfil de acesso padrão. Configure o cargo antes de criar o colaborador.');
  }
  const [roleProfileDoc, profileDoc] = await Promise.all([
    dbAdmin.collection('profiles').doc(collaboratorCore.role.defaultProfileId).get(),
    dbAdmin.collection('profiles').doc(profileId).get(),
  ]);
  if (!roleProfileDoc.exists) {
    throw new Error('O perfil de acesso padrão configurado no cargo não existe.');
  }
  if (!profileDoc.exists) {
    throw new Error('O perfil de acesso configurado no cargo ou função não existe.');
  }

  const employeeId = authUser.uid;
  const relationship = isEmploymentRelationshipType(params.process.employmentRelationshipType)
    ? params.process.employmentRelationshipType
    : 'clt';
  const personRecordType = relationship === 'pj'
    ? 'pj'
    : relationship === 'internship'
      ? 'internship'
      : 'employee';

  await dbAdmin.collection('users').doc(authUser.uid).set({
    username: name,
    email,
    hrEmployeeId: employeeId,
    personRecordType,
    profileCompliance: {
      status: 'pending',
      policyVersion: 1,
      missingFields: [],
      invalidFields: [],
      evaluatedAt: null,
      completedAt: null,
      lastConfirmedAt: null,
      nextReviewAt: null,
    },
    profileId,
    employmentRelationshipType: relationship,
    ...collaboratorCore.userPatch,
    transportVoucherHistory,
    isActive: true,
    admissionDate: admissionTimestamp,
    mustChangePassword: true,
    source: 'recruitment_onboarding',
    recruitmentCandidateId: asString(params.process.candidateId),
    onboardingId: params.processId,
    updatedAt: now,
    createdAt: now,
  }, { merge: true });

  const employeeRef = hrDbAdmin.collection('employees').doc(employeeId);
  const onboardingImageVoiceConsent = asRecord(params.process.consentimento_imagem_voz);
  const hasExplicitImageVoiceDecision = typeof onboardingImageVoiceConsent.autorizado === 'boolean';
  const onboardingPrivacyAcknowledgement = asRecord(params.process.publicPrivacyAcceptance);
  const hasPrivacyAcknowledgement = onboardingPrivacyAcknowledgement.acknowledged === true;
  await employeeRef.set({
    bizneo_employee_id: employeeId,
    auth_uid: authUser.uid,
    source_user_id: authUser.uid,
    source: 'recruitment_onboarding',
    name,
    email,
    access_email: email,
    person_record_type: personRecordType,
    status: 'active',
    job_role_id: collaboratorCore.role?.id ?? asString(params.process.jobRoleId) ?? profileId,
    unit_id: unitId ?? 'sem-unidade',
    profile_completion: 0,
    synced_at: admissionTimestamp,
    created_at: admissionTimestamp,
    updated_at: admissionTimestamp,
    ...(hasExplicitImageVoiceDecision
      ? { consentimento_imagem_voz: onboardingImageVoiceConsent }
      : {}),
    ...(hasPrivacyAcknowledgement
      ? {
          ciencia_privacidade_onboarding: {
            ...onboardingPrivacyAcknowledgement,
            onboarding_id: params.processId,
          },
        }
      : {}),
  }, { merge: true });

  if (hasExplicitImageVoiceDecision) {
    const eventId = asString(onboardingImageVoiceConsent.protocolo) ?? `onboarding_${params.processId}`;
    const eventRef = employeeRef.collection('consentimentos_imagem_voz_historico').doc(eventId);
    const existingEvent = await eventRef.get();
    if (!existingEvent.exists) {
      await eventRef.create({
        ...onboardingImageVoiceConsent,
        evento: onboardingImageVoiceConsent.autorizado === true
          ? 'autorizacao_concedida'
          : 'autorizacao_nao_concedida',
        migrated_to_employee_at: now,
        employee_id: employeeId,
      });
    }
  }

  const batch = hrDbAdmin.batch();
  const fieldValuesRef = employeeRef.collection('field_values');
  const values: Record<string, Record<string, unknown>> = {
    'employee.name': { value_text: name },
    'employee.job_role_id': { value_text: collaboratorCore.role?.name ?? asString(params.process.jobRoleName) ?? asString(params.process.jobRoleId) ?? '' },
    'employee.admission_date': { value_date: admissionTimestamp },
  };

  const textAnswers: Array<[string, string]> = [
    ['employee.cpf', answerString(publicAnswers, 'cpf')],
    ['employee.bank_name', answerString(publicAnswers, 'bankName')],
    ['employee.bank_agency', answerString(publicAnswers, 'bankAgency')],
    ['employee.bank_account', answerString(publicAnswers, 'bankAccount')],
    ['employee.pix_key', answerString(publicAnswers, 'pixKey')],
    ['employee.uniform_shirt_size', answerString(publicAnswers, 'uniformShirtSize')],
    ['employee.uniform_pants_size', answerString(publicAnswers, 'uniformPantsSize')],
    ['employee.uniform_shoe_size', answerString(publicAnswers, 'uniformShoeSize')],
    ['employee.emergency_name', answerString(publicAnswers, 'emergencyName')],
    ['employee.emergency_phone', answerString(publicAnswers, 'emergencyPhone')],
    ['employee.emergency_relation', answerString(publicAnswers, 'emergencyRelation')],
    ['employee.education_level', answerString(publicAnswers, 'educationLevel')],
    ['employee.education_course', answerString(publicAnswers, 'educationCourse')],
    ['employee.education_institution', answerString(publicAnswers, 'educationInstitution')],
  ];
  for (const [fieldKey, value] of textAnswers) {
    if (value) values[fieldKey] = { value_text: value };
  }
  if (hasCnh !== null) values['employee.has_cnh'] = { value_boolean: hasCnh };
  if (hasFoodRestriction !== null) values['employee.has_food_restriction'] = { value_boolean: hasFoodRestriction };
  const educationEndDate = answerString(publicAnswers, 'educationEndDate');
  if (educationEndDate) values['employee.education_end_date'] = { value_date: timestampFromDateString(educationEndDate) };
  const foodRestrictions = Array.isArray(publicAnswers.foodRestrictions)
    ? publicAnswers.foodRestrictions.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    : [];
  if (foodRestrictions.length > 0) values['employee.food_restrictions'] = { value_json: foodRestrictions };
  const foodRestrictionOther = answerString(publicAnswers, 'foodRestrictionOther');
  if (foodRestrictionOther) values['employee.food_restriction_other'] = { value_text: foodRestrictionOther };
  const foodRestrictionActivityEffects = Array.isArray(publicAnswers.foodRestrictionActivityEffects)
    ? publicAnswers.foodRestrictionActivityEffects.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    : [];
  if (foodRestrictionActivityEffects.length > 0) values['employee.food_restriction_activity_effects'] = { value_json: foodRestrictionActivityEffects };
  values['employee.has_vt'] = { value_boolean: needsTransportVoucher };
  if (needsTransportVoucher && transportVoucherValue != null) {
    values['employee.vt_daily_value'] = { value_number: Math.round(transportVoucherValue * 100) };
  }
  if (childRecords.length > 0) {
    values['employee.children'] = { value_json: childRecords };
    values['employee.children_under_14'] = { value_text: childCountLabel(childrenUnder14) };
    values['employee.has_family_salary'] = { value_boolean: childrenUnder14 > 0 };
  }

  Object.entries(values).forEach(([fieldKey, value]) => {
    batch.set(fieldValuesRef.doc(fieldKey), {
      field_key: fieldKey,
      ...value,
      updated_at: admissionTimestamp,
      updated_by: params.actorId,
      source: 'recruitment_onboarding',
    }, { merge: true });
  });
  await batch.commit();

  const promotedDocuments = await promoteApprovedOnboardingDocuments({
    onboardingId: params.processId,
    employeeId,
    process: params.process,
    actorId: params.actorId,
    actorName: params.actorName,
  });
  const promotedSignedDocumentIds = await promoteSignedOnboardingDocuments({
    onboardingId: params.processId,
    employeeId,
  });

  const firstAccessLink = await createFirstAccessLink({
    userId: authUser.uid,
    onboardingId: params.processId,
    baseUrl: params.baseUrl,
    createdBy: params.actorId,
    createdByEmail: params.actorEmail,
  });

  return { userId: authUser.uid, employeeId, firstAccessLink, promotedDocuments, promotedSignedDocumentIds };
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const access = await assertFormalizationAccess(request, 'onboarding.manage').catch(() => null);
  if (!access) return jsonError('Sem permissão para gerenciar onboarding.', 403);

  const { id } = await context.params;
  const body = await request.json();
  const action = asString(body.action);
  const ref = hrDbAdmin.collection('onboardingProcesses').doc(id);
  const snap = await ref.get();
  if (!snap.exists) return jsonError('Onboarding não encontrado.', 404);

  const process = snap.data() ?? {};
  if (process.status === 'cancelled') {
    return jsonError('Esta integração foi encerrada e está disponível somente para consulta.', 409);
  }
  const now = new Date().toISOString();
  let firstAccessEmail: {
    url: string;
    expiresAt: string;
    template: IntegrationTemplateVersion;
    force?: boolean;
  } | null = null;
  const update: Record<string, unknown> = { updatedAt: now };
  let responseFirstAccessUrl: string | null = null;
  let changedDocumentsCount: number | null = null;

  if (action === 'update_expected_admission_date') {
    if (!canUpdateExpectedAdmissionDate(process as OnboardingProcess)) {
      return jsonError('A data prevista só pode ser alterada até a conclusão da primeira etapa.', 409);
    }
    const expectedAdmissionDate = normalizeOnboardingDateOnly(body.expectedAdmissionDate);
    if (!expectedAdmissionDate) {
      return jsonError('Informe uma data prevista para admissão válida.');
    }
    update.expectedAdmissionDate = expectedAdmissionDate;
    update.expectedAdmissionDateUpdatedAt = now;
    update.expectedAdmissionDateUpdatedBy = access.decoded.uid;
    update.expectedAdmissionDateUpdatedByEmail = access.decoded.email ?? null;
  } else if (action === 'set_employer_unit') {
    const employerUnitId = asString(body.employerUnitId);
    if (!employerUnitId) return jsonError('Selecione o CNPJ responsável pela contratação.');
    const employerUnitDoc = await dbAdmin.collection('dp_units').doc(employerUnitId).get();
    if (!employerUnitDoc.exists || employerUnitDoc.data()?.isArchived === true) {
      return jsonError('O CNPJ responsável selecionado não está disponível.', 404);
    }
    const employerCnpj = CnpjValidator.clean(asString(employerUnitDoc.data()?.cnpj) ?? '');
    if (!CnpjValidator.validate(employerCnpj).valid) {
      return jsonError('A unidade responsável selecionada não possui um CNPJ válido. Corrija o cadastro da unidade.', 400);
    }
    update.employerUnitId = employerUnitDoc.id;
    update.employerUnitName = asString(employerUnitDoc.data()?.name);
    update.employerCnpj = employerCnpj;
    update.employerAddress = asString(employerUnitDoc.data()?.address);
    update.employerSelection = {
      selectedAt: now,
      selectedBy: access.decoded.uid,
      selectedByEmail: access.decoded.email ?? null,
    };
  } else if (action === 'document_status') {
    const documentId = asString(body.documentId);
    const status = asString(body.status) as OnboardingDocument['status'] | null;
    if (!documentId || !status || !['pending', 'received', 'ai_approved', 'review_required', 'approved', 'rejected'].includes(status)) {
      return jsonError('Documento ou status inválido.');
    }
    const documents = Array.isArray(process.documents) ? process.documents as OnboardingDocument[] : [];
    const document = documents.find(item => item.id === documentId);
    if (!document) return jsonError('Documento não encontrado.', 404);
    if (['approved', 'rejected', 'review_required'].includes(status)) {
      if (process.currentStage !== 'document_review') {
        return jsonError('A conferência documental só pode ser feita na etapa Formalização · Conferência.', 400);
      }
      if (!hasAuditableDocumentFile(document)) {
        return jsonError('Não é possível conferir um documento sem arquivo anexado para auditoria.', 400);
      }
    }
    update.documents = mergeDocumentStatus(documents, documentId, status, asString(body.note), now);
    changedDocumentsCount = 1;
  } else if (action === 'document_status_bulk') {
    const documentIds = asStringArray(body.documentIds);
    const status = asString(body.status) as OnboardingDocument['status'] | null;
    if (documentIds.length === 0 || status !== 'approved') {
      return jsonError('Documentos ou status inválido.');
    }
    if (process.currentStage !== 'document_review') {
      return jsonError('A conferência documental só pode ser feita na etapa Formalização · Conferência.', 400);
    }

    const documents = Array.isArray(process.documents) ? process.documents as OnboardingDocument[] : [];
    const documentsById = new Map(documents.map(document => [document.id, document]));
    const missingDocumentId = documentIds.find(documentId => !documentsById.has(documentId));
    if (missingDocumentId) return jsonError('Documento não encontrado.', 404);

    const invalidDocument = documentIds
      .map(documentId => documentsById.get(documentId))
      .find(document => !document || !hasAuditableDocumentFile(document));
    if (invalidDocument) {
      return jsonError('Não é possível aprovar em lote documentos sem arquivo anexado para auditoria.', 400);
    }

    update.documents = mergeDocumentStatuses(documents, documentIds, status, asString(body.note), now);
    changedDocumentsCount = documentIds.length;
  } else if (action === 'advance_stage') {
    const currentStage = asString(body.currentStage) as OnboardingStageId | null;
    if (!currentStage) return jsonError('Etapa inválida.');
    if (process.currentStage === 'document_review' && currentStage !== 'document_review' && currentStage !== 'accountant') {
      return jsonError('Após a conferência documental, o processo deve passar pela etapa do contador.', 409);
    }
    if (process.currentStage === 'accountant' && currentStage !== 'accountant' && asString(asRecord(process.accountantWorkflow).status) !== 'completed') {
      return jsonError('A etapa do contador só avança após a aprovação da Ficha de Registro de Empregado.', 409);
    }
    if (
      (process.currentStage === 'signature_preparation' || process.currentStage === 'signature') &&
      currentStage !== process.currentStage
    ) {
      const signatureWorkflow = await listSignatureWorkflow(id);
      const selected = signatureWorkflow.documents.filter(document => document.selected === true);
      const completed = new Set(['signed', 'signed_archived_pending_employee', 'archived']);
      if (!selected.length || selected.some(document => !completed.has(String(document.status)))) {
        return jsonError('A etapa só avança quando todos os documentos selecionados estiverem assinados e arquivados.', 409);
      }
    }
    if (process.currentStage === 'formalization_validation' && currentStage !== 'formalization_validation') {
      const accessProvisioning = asRecord(process.accessProvisioning);
      const accessEmail = asRecord(accessProvisioning.email);
      const firstAccess = asRecord(process.firstAccess);
      const accessReady = Boolean(asString(process.collaboratorUserId)) &&
        accessEmail.status === 'delivered' &&
        firstAccess.status === 'used';
      if (!accessReady) {
        return jsonError('A formalização só avança após criar o cadastro, confirmar a entrega do e-mail e cadastrar a senha.', 409);
      }
    }
    if (process.currentStage === 'integration' && currentStage !== 'integration' && !requiredOnboardingIntegrationsResolved(process.integrationAlerts)) {
      return jsonError('Confirme a sincronização do Bizneo e do PDV Legal antes de avançar.', 409);
    }
    update.currentStage = currentStage;
    update.status = nextStatusForStage(currentStage);
  } else if (action === 'save_finalization') {
    if (process.currentStage !== 'formalization_validation') {
      return jsonError('As configurações finais só podem ser salvas na etapa Formalização · Finalização.', 400);
    }
    const finalization = asRecord(body.finalizationSettings);
    const needsTransportVoucher = asBoolean(finalization.needsTransportVoucher) ?? false;
    const shiftDefinitionId = asString(finalization.shiftDefinitionId);
    if (shiftDefinitionId) {
      const shiftDefinitionDoc = await dbAdmin.collection('dp_shiftDefinitions').doc(shiftDefinitionId).get();
      if (!shiftDefinitionDoc.exists) return jsonError('Turno não encontrado.', 404);
      const processUnitId = asString(process.unitId);
      if (processUnitId && !shiftDefinitionMatchesUnit(shiftDefinitionDoc.data(), processUnitId)) {
        return jsonError('O turno selecionado não pertence à unidade da integração.', 400);
      }
    }
    update.finalizationSettings = {
      operational: asBoolean(finalization.operational) ?? false,
      participatesInGoals: asBoolean(finalization.participatesInGoals) ?? false,
      loginRestrictionEnabled: asBoolean(finalization.loginRestrictionEnabled) ?? false,
      needsTransportVoucher,
      transportVoucherValue: needsTransportVoucher ? asNumber(finalization.transportVoucherValue) ?? null : null,
      shiftDefinitionId,
    };
  } else if (action === 'extend_public_link') {
    if (!process.publicToken || process.publicTokenClosedAt || process.status === 'cancelled' || process.status === 'completed') {
      return jsonError('Este link não pode mais ser prorrogado.', 400);
    }
    if (onboardingPublicLinkExtensionUsed(process)) {
      return jsonError('A prorrogação única de 24 horas já foi utilizada.', 400);
    }
    const nextExpiry = extendOnboardingPublicLink(process, new Date(now));
    if (!nextExpiry) return jsonError('A prorrogação única de 24 horas já foi utilizada.', 400);
    update.publicTokenExpiresAt = nextExpiry;
    update.publicTokenExtensionUsed = true;
    update.publicTokenExtendedAt = now;
    update.publicTokenExtendedBy = access.decoded.uid;
  } else if (action === 'create_collaborator') {
    const isPj = process.employmentRelationshipType === 'pj';
    const pjWorkflow = process.pjWorkflow && typeof process.pjWorkflow === 'object' && !Array.isArray(process.pjWorkflow)
      ? process.pjWorkflow as PjOnboardingWorkflow
      : null;
    if (isPj) {
      if (process.currentStage !== 'integration' || pjWorkflow?.currentStep !== 'access_configuration') {
        return jsonError('Conclua a aprovação financeira antes de criar o acesso da prestadora.', 400);
      }
      if (pjWorkflow.finance?.status !== 'approved' || pjWorkflow.access?.status !== 'configured') {
        return jsonError('Aprovação financeira e configuração dos acessos são obrigatórias.', 400);
      }
    } else if (process.currentStage !== 'formalization_validation' && process.status !== 'ready_to_create_user') {
      return jsonError('Valide a formalização antes de criar o colaborador.', 400);
    }
    if (!isPj && (!asRecord(process.finalizationSettings) || Object.keys(asRecord(process.finalizationSettings)).length === 0)) {
      return jsonError('Salve a validação final antes de criar o colaborador.', 400);
    }
    if (asString(process.collaboratorUserId)) {
      return jsonError('O cadastro deste colaborador já foi criado.', 409);
    }
    const accessRecipient = normalizeEmail(process.candidateEmail);
    if (!accessRecipient || !accessRecipient.includes('@')) {
      return jsonError('Corrija o e-mail pessoal da colaboradora antes de criar e enviar o acesso.', 400);
    }
    const created = await createCollaboratorFromOnboarding({
      processId: id,
      process,
      actorId: access.decoded.uid,
      actorName: access.actorName,
      actorEmail: access.decoded.email ?? null,
      baseUrl: appBaseUrl(request),
    });
    update.collaboratorUserId = created.userId;
    update.employeeId = created.employeeId;
    update.documents = created.promotedDocuments.documents;
    update.documentPromotion = {
      status: 'completed',
      promotedCount: created.promotedDocuments.promotedCount,
      duplicateCount: created.promotedDocuments.duplicateCount,
      employeeDocumentIds: created.promotedDocuments.promotedDocumentIds,
      signedEmployeeDocumentIds: created.promotedSignedDocumentIds,
      completedAt: now,
      completedBy: access.decoded.uid,
    };
    update.status = isPj ? 'active' : 'awaiting_first_access';
    update.currentStage = isPj ? 'integration' : 'formalization_validation';
    update.publicToken = null;
    update.publicTokenClosedAt = now;
    update.integrationAlerts = isPj ? [] : await verifyAccessIntegrations({ process, collaboratorUserId: created.userId, now });
    update.firstAccess = {
      status: 'pending',
      tokenId: created.firstAccessLink.tokenId,
      createdAt: now,
      expiresAt: created.firstAccessLink.expiresAt,
      usedAt: null,
      createdBy: access.decoded.uid,
    };
    update.accessProvisioning = {
      status: 'awaiting_delivery',
      userCreatedAt: now,
      completedAt: null,
      email: {
        status: 'pending',
        recipient: accessRecipient,
        providerId: null,
        lastError: null,
      },
    };
    if (isPj && pjWorkflow) {
      update.pjWorkflow = setPjWorkflowStep({
        ...pjWorkflow,
        access: { ...pjWorkflow.access, status: 'invitation_sent' },
      }, 'provider_activation', now, access.decoded.uid);
    }
    responseFirstAccessUrl = created.firstAccessLink.url;
    const integrationSnapshot = integrationTemplateVersionSchema.safeParse(
      asRecord(asRecord(process.integrationV2).snapshot)
    );
    if (integrationSnapshot.success) {
      firstAccessEmail = {
        url: created.firstAccessLink.url,
        expiresAt: created.firstAccessLink.expiresAt,
        template: integrationSnapshot.data,
      };
    } else {
      update.communicationWarning = 'O modelo de integração não possui snapshot válido para enviar o primeiro acesso.';
    }
  } else if (action === 'create_first_access_link') {
    const collaboratorUserId = asString(process.collaboratorUserId);
    if (!collaboratorUserId) return jsonError('Crie o colaborador antes de gerar o link de primeiro acesso.');
    const userDoc = await dbAdmin.collection('users').doc(collaboratorUserId).get();
    const userData = userDoc.data() ?? {};
    if (!userDoc.exists || asString(userData.source) !== 'recruitment_onboarding' || asString(userData.onboardingId) !== id) {
      return jsonError('Este colaborador não foi criado por esta formalização.', 403);
    }
    if (asRecord(process.firstAccess).status === 'used') {
      return jsonError('A senha já foi cadastrada. Não é necessário reenviar o primeiro acesso.', 409);
    }
    const firstAccessLink = await createFirstAccessLink({
      userId: collaboratorUserId,
      onboardingId: id,
      baseUrl: appBaseUrl(request),
      createdBy: access.decoded.uid,
      createdByEmail: access.decoded.email ?? null,
    });
    update.firstAccess = {
      status: 'pending',
      tokenId: firstAccessLink.tokenId,
      createdAt: now,
      expiresAt: firstAccessLink.expiresAt,
      usedAt: null,
      createdBy: access.decoded.uid,
    };
    responseFirstAccessUrl = firstAccessLink.url;
    const integrationSnapshot = integrationTemplateVersionSchema.safeParse(
      asRecord(asRecord(process.integrationV2).snapshot)
    );
    if (!integrationSnapshot.success) {
      return jsonError('O modelo da integração não permite reenviar o e-mail de primeiro acesso.', 409);
    }
    firstAccessEmail = {
      url: firstAccessLink.url,
      expiresAt: firstAccessLink.expiresAt,
      template: integrationSnapshot.data,
      force: true,
    };
  } else if (action === 'verify_integrations') {
    const collaboratorUserId = asString(process.collaboratorUserId);
    if (!collaboratorUserId) return jsonError('Crie o colaborador antes de verificar os acessos.');
    if (process.currentStage !== 'integration') return jsonError('Os acessos só podem ser verificados na etapa de integração.', 409);
    update.integrationAlerts = await verifyAccessIntegrations({ process, collaboratorUserId, now });
  } else if (action === 'set_access_operational_check') {
    if (process.currentStage !== 'integration') {
      return jsonError('Os controles operacionais só podem ser atualizados na etapa de acessos.', 409);
    }
    const checkId = asString(body.checkId);
    if (checkId !== 'odontoprev' && checkId !== 'transportVoucherSystem') {
      return jsonError('Controle operacional inválido.');
    }
    const completed = asBoolean(body.completed);
    if (completed === null) return jsonError('Informe se o controle foi concluído.');

    const accessProvisioning = asRecord(process.accessProvisioning);
    const operationalChecks = asRecord(accessProvisioning.operationalChecks);
    update.accessProvisioning = {
      ...accessProvisioning,
      operationalChecks: {
        ...operationalChecks,
        [checkId]: {
          completed,
          updatedAt: now,
          updatedBy: access.decoded.uid,
        },
      },
    };
  } else if (action === 'complete') {
    if (!process.collaboratorUserId) return jsonError('Crie o colaborador antes de finalizar o onboarding.');
    if (process.currentStage !== 'integration') return jsonError('A integração não está na etapa de acessos.', 409);
    if (!requiredOnboardingIntegrationsResolved(process.integrationAlerts)) {
      return jsonError('Confirme a sincronização do Bizneo e do PDV Legal antes de finalizar.', 409);
    }
    update.status = 'completed';
    update.currentStage = 'done';
    update.completedAt = now;
  } else if (action === 'cancel') {
    if (process.status === 'completed') {
      return jsonError('Uma integração concluída não pode ser encerrada sem finalização.', 409);
    }
    if (process.status === 'cancelled') {
      return jsonError('Esta integração já foi encerrada.', 409);
    }
    const reason = normalizeOnboardingCancellationReason(body.reason);
    if (!reason) {
      return jsonError(`Detalhe o motivo do encerramento com pelo menos ${ONBOARDING_CANCELLATION_REASON_MIN_LENGTH} caracteres.`);
    }
    update.status = 'cancelled';
    update.cancelReason = reason;
    update.cancelledAt = now;
    update.cancelledAtStage = asString(process.currentStage);
    update.cancelledBy = access.decoded.uid;
    update.cancelledByEmail = access.decoded.email ?? null;
    update.publicTokenClosedAt = now;
  } else {
    return jsonError('Ação inválida.');
  }

  await ref.set(update, { merge: true });

  await logAction({
    user_id: access.decoded.uid,
    username: access.decoded.email ?? null,
    module: 'recruitment.onboarding',
    action: `onboarding_${action}`,
    metadata: {
      target_type: 'onboarding',
      target_id: id,
      target_name: process.candidateName ?? id,
      changed_fields: Object.keys(update),
      ...(changedDocumentsCount !== null ? { changed_documents: changedDocumentsCount } : {}),
    },
    ttl_days: 365,
  });

  if (firstAccessEmail) {
    await sendTrackedIntegrationCommunication({
      onboardingId: id,
      event: 'first_access',
      template: firstAccessEmail.template,
      recipient: normalizeEmail(process.candidateEmail),
      actionUrl: firstAccessEmail.url,
      expiresAt: firstAccessEmail.expiresAt,
      variables: {
        'employee.name': process.employmentRelationshipType === 'pj'
          ? asString((process.pjWorkflow as PjOnboardingWorkflow | undefined)?.access?.userName)
          : asString(process.candidateName),
        'employee.personal_email': normalizeEmail(process.candidateEmail),
        'system.role.job_role': asString(process.jobRoleName),
        'system.role.functions': asString(process.functionName),
        'system.schedule.units': asString(process.unitName),
        'system.schedule.shift': asString(process.shiftDefinitionName),
        'integration.expected_admission_date': asString(process.expectedAdmissionDate),
      },
      force: firstAccessEmail.force,
    });
  }

  const saved = await ref.get();
  return NextResponse.json({
    process: {
      id: saved.id,
      ...((serializeHrValue(saved.data()) as Record<string, unknown>) ?? {}),
      ...(responseFirstAccessUrl ? { firstAccessUrl: responseFirstAccessUrl } : {}),
    },
  });
}
