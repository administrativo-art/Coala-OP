import { NextRequest, NextResponse } from 'next/server';
import { Timestamp } from 'firebase-admin/firestore';

import { assertHrAccess, serializeHrValue } from '@/features/hr/lib/server-access';
import { authAdmin, dbAdmin } from '@/lib/firebase-admin';
import { hrDbAdmin } from '@/lib/firebase-rh-admin';
import { logAction } from '@/lib/log-action';
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

function nextStatusForStage(stage: OnboardingStageId | undefined): OnboardingProcess['status'] {
  if (stage === 'documents') return 'collecting_documents';
  if (stage === 'document_review') return 'reviewing_documents';
  if (stage === 'contract') return 'contract_pending';
  if (stage === 'system_access') return 'ready_to_create_user';
  if (stage === 'integration' || stage === 'probation') return 'active';
  if (stage === 'done') return 'completed';
  return 'pending_setup';
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
      receivedAt: status === 'received' || status === 'approved'
        ? document.receivedAt ?? now
        : document.receivedAt ?? null,
      approvedAt: status === 'approved' ? now : document.approvedAt ?? null,
    };
  });
}

async function getOrCreateAuthUser(email: string, displayName: string) {
  try {
    return await authAdmin.getUserByEmail(email);
  } catch {
    return authAdmin.createUser({
      email,
      displayName,
      emailVerified: false,
      disabled: false,
    });
  }
}

async function createCollaboratorFromOnboarding(params: {
  processId: string;
  process: Record<string, unknown>;
  actorId: string;
  actorEmail: string | null;
}) {
  const name = asString(params.process.candidateName) ?? 'Novo colaborador';
  const email = normalizeEmail(params.process.candidateEmail);
  if (!email) throw new Error('Candidato sem e-mail para criação do usuário.');

  const [roleDoc, functionDoc] = await Promise.all([
    asString(params.process.jobRoleId)
      ? hrDbAdmin.collection('jobRoles').doc(asString(params.process.jobRoleId)!).get()
      : Promise.resolve(null),
    asString(params.process.functionId)
      ? hrDbAdmin.collection('jobFunctions').doc(asString(params.process.functionId)!).get()
      : Promise.resolve(null),
  ]);
  const role = roleDoc?.data?.() ?? {};
  const fn = functionDoc?.data?.() ?? {};
  const authUser = await getOrCreateAuthUser(email, name);
  const now = new Date().toISOString();
  const admissionTimestamp = Timestamp.now();
  const profileId = asString(fn.defaultProfileId) ?? asString(role.defaultProfileId) ?? '';
  const unitId = asString(params.process.unitId);
  const functionId = asString(params.process.functionId);
  const functionName = asString(params.process.functionName);

  await dbAdmin.collection('users').doc(authUser.uid).set({
    username: name,
    email,
    profileId,
    assignedKioskIds: unitId ? [unitId] : [],
    unitIds: unitId ? [unitId] : [],
    jobRoleId: asString(params.process.jobRoleId) ?? '',
    jobRoleName: asString(params.process.jobRoleName) ?? '',
    jobFunctionIds: functionId ? [functionId] : [],
    jobFunctionNames: functionName ? [functionName] : [],
    shiftDefinitionId: asString(params.process.shiftDefinitionId) ?? null,
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
    job_role_id: asString(params.process.jobRoleId) ?? profileId,
    unit_id: unitId ?? 'sem-unidade',
    profile_completion: 0,
    synced_at: admissionTimestamp,
    created_at: admissionTimestamp,
    updated_at: admissionTimestamp,
  }, { merge: true });

  const batch = hrDbAdmin.batch();
  const fieldValuesRef = employeeRef.collection('field_values');
  const values = {
    'employee.name': { value_text: name },
    'employee.personal_email': { value_text: email },
    'employee.job_role_id': { value_text: asString(params.process.jobRoleName) ?? asString(params.process.jobRoleId) ?? '' },
    'employee.aso_admission_date': { value_date: admissionTimestamp },
  };
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

  return { userId: authUser.uid, employeeId };
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

  if (action === 'document_status') {
    const documentId = asString(body.documentId);
    const status = asString(body.status) as OnboardingDocument['status'] | null;
    if (!documentId || !status || !['pending', 'received', 'approved', 'rejected'].includes(status)) {
      return jsonError('Documento ou status inválido.');
    }
    const documents = Array.isArray(process.documents) ? process.documents as OnboardingDocument[] : [];
    update.documents = mergeDocumentStatus(documents, documentId, status, asString(body.note), now);
  } else if (action === 'advance_stage') {
    const currentStage = asString(body.currentStage) as OnboardingStageId | null;
    if (!currentStage) return jsonError('Etapa inválida.');
    update.currentStage = currentStage;
    update.status = nextStatusForStage(currentStage);
  } else if (action === 'create_collaborator') {
    const created = await createCollaboratorFromOnboarding({
      processId: id,
      process,
      actorId: access.decoded.uid,
      actorEmail: access.decoded.email ?? null,
    });
    update.collaboratorUserId = created.userId;
    update.employeeId = created.employeeId;
    update.status = 'active';
    update.currentStage = 'integration';
    const alerts = Array.isArray(process.integrationAlerts) ? process.integrationAlerts as Array<Record<string, unknown>> : [];
    update.integrationAlerts = alerts.map(alert => ({
      ...alert,
      status: alert.id === 'bizneo_id' || alert.id === 'pdv_id' ? alert.status ?? 'pending' : alert.status,
    }));
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
    },
  });
}
