import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'node:crypto';
import { Timestamp } from 'firebase-admin/firestore';

import { resolveCollaboratorCore } from '@/features/hr/lib/collaborator-core.server';
import { assertHrAccess, serializeHrValue } from '@/features/hr/lib/server-access';
import { shiftDefinitionMatchesUnit } from '@/lib/dp-shift-definitions';
import { authAdmin, dbAdmin } from '@/lib/firebase-admin';
import { createFirstAccessLink } from '@/lib/first-access-links';
import { hrDbAdmin } from '@/lib/firebase-rh-admin';
import { logAction } from '@/lib/log-action';
import { promoteApprovedOnboardingDocuments } from '@/lib/hr/promote-onboarding-documents';
import { extendOnboardingPublicLink, onboardingPublicLinkExtensionUsed } from '@/lib/hr/onboarding-public-link';
import type { OnboardingDocument, OnboardingProcess, OnboardingStageId } from '@/types';

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

async function createCollaboratorFromOnboarding(params: {
  processId: string;
  process: Record<string, unknown>;
  actorId: string;
  actorName: string;
  actorEmail: string | null;
  baseUrl: string;
}) {
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
  const profileId = collaboratorCore.effectiveProfileId ?? '';

  await dbAdmin.collection('users').doc(authUser.uid).set({
    username: name,
    email,
    profileId,
    ...collaboratorCore.userPatch,
    isActive: true,
    admissionDate: admissionTimestamp,
    mustChangePassword: true,
    source: 'recruitment_onboarding',
    recruitmentCandidateId: asString(params.process.candidateId),
    onboardingId: params.processId,
    updatedAt: now,
    createdAt: now,
  }, { merge: true });

  const employeeId = authUser.uid;
  const employeeRef = hrDbAdmin.collection('employees').doc(employeeId);
  await employeeRef.set({
    bizneo_employee_id: employeeId,
    auth_uid: authUser.uid,
    source_user_id: authUser.uid,
    source: 'recruitment_onboarding',
    name,
    email,
    status: 'active',
    job_role_id: collaboratorCore.role?.id ?? asString(params.process.jobRoleId) ?? profileId,
    unit_id: unitId ?? 'sem-unidade',
    profile_completion: 0,
    synced_at: admissionTimestamp,
    created_at: admissionTimestamp,
    updated_at: admissionTimestamp,
  }, { merge: true });

  const batch = hrDbAdmin.batch();
  const fieldValuesRef = employeeRef.collection('field_values');
  const values: Record<string, Record<string, unknown>> = {
    'employee.name': { value_text: name },
    'employee.personal_email': { value_text: email },
    'employee.job_role_id': { value_text: collaboratorCore.role?.name ?? asString(params.process.jobRoleName) ?? asString(params.process.jobRoleId) ?? '' },
    'employee.aso_admission_date': { value_date: admissionTimestamp },
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

  const firstAccessLink = await createFirstAccessLink({
    userId: authUser.uid,
    onboardingId: params.processId,
    baseUrl: params.baseUrl,
    createdBy: params.actorId,
    createdByEmail: params.actorEmail,
  });

  return { userId: authUser.uid, employeeId, firstAccessLink, promotedDocuments };
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const access = await assertHrAccess(request, 'manage').catch(() => null);
  if (!access) return jsonError('Sem permissão para gerenciar onboarding.', 403);

  const { id } = await context.params;
  const body = await request.json();
  const action = asString(body.action);
  const ref = hrDbAdmin.collection('onboardingProcesses').doc(id);
  const snap = await ref.get();
  if (!snap.exists) return jsonError('Onboarding não encontrado.', 404);

  const process = snap.data() ?? {};
  const now = new Date().toISOString();
  const update: Record<string, unknown> = { updatedAt: now };
  let responseFirstAccessUrl: string | null = null;

  if (action === 'document_status') {
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
  } else if (action === 'advance_stage') {
    const currentStage = asString(body.currentStage) as OnboardingStageId | null;
    if (!currentStage) return jsonError('Etapa inválida.');
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
    if (process.currentStage !== 'formalization_validation' && process.status !== 'ready_to_create_user') {
      return jsonError('Valide a formalização antes de criar o colaborador.', 400);
    }
    if (!asRecord(process.finalizationSettings) || Object.keys(asRecord(process.finalizationSettings)).length === 0) {
      return jsonError('Salve a validação final antes de criar o colaborador.', 400);
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
      completedAt: now,
      completedBy: access.decoded.uid,
    };
    update.status = 'active';
    update.currentStage = 'integration';
    update.publicToken = null;
    update.publicTokenClosedAt = now;
    const alerts = Array.isArray(process.integrationAlerts) ? process.integrationAlerts as Array<Record<string, unknown>> : [];
    update.integrationAlerts = alerts.map(alert => ({
      ...alert,
      status: alert.id === 'bizneo_id' || alert.id === 'pdv_id' ? alert.status ?? 'pending' : alert.status,
    }));
    update.firstAccess = {
      status: 'pending',
      tokenId: created.firstAccessLink.tokenId,
      createdAt: now,
      expiresAt: created.firstAccessLink.expiresAt,
      usedAt: null,
      createdBy: access.decoded.uid,
    };
    responseFirstAccessUrl = created.firstAccessLink.url;
  } else if (action === 'create_first_access_link') {
    const collaboratorUserId = asString(process.collaboratorUserId);
    if (!collaboratorUserId) return jsonError('Crie o colaborador antes de gerar o link de primeiro acesso.');
    const userDoc = await dbAdmin.collection('users').doc(collaboratorUserId).get();
    const userData = userDoc.data() ?? {};
    if (!userDoc.exists || asString(userData.source) !== 'recruitment_onboarding' || asString(userData.onboardingId) !== id) {
      return jsonError('Este colaborador não foi criado por esta formalização.', 403);
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
  } else if (action === 'complete') {
    if (!process.collaboratorUserId) return jsonError('Crie o colaborador antes de finalizar o onboarding.');
    update.status = 'completed';
    update.currentStage = 'done';
    update.completedAt = now;
  } else if (action === 'cancel') {
    update.status = 'cancelled';
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
    },
    ttl_days: 365,
  });

  const saved = await ref.get();
  return NextResponse.json({
    process: {
      id: saved.id,
      ...((serializeHrValue(saved.data()) as Record<string, unknown>) ?? {}),
      ...(responseFirstAccessUrl ? { firstAccessUrl: responseFirstAccessUrl } : {}),
    },
  });
}
