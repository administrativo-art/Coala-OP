import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';

import { assertHrAccess, serializeHrValue } from '@/features/hr/lib/server-access';
import { shiftDefinitionMatchesUnit } from '@/lib/dp-shift-definitions';
import { dbAdmin } from '@/lib/firebase-admin';
import { hrDbAdmin } from '@/lib/firebase-rh-admin';
import { logAction } from '@/lib/log-action';
import {
  applyOnboardingSignatureMode,
  instantiateOnboardingDocuments,
  mergeOnboardingDocumentModels,
  mergeOnboardingStageModels,
} from '@/lib/recruitment-onboarding';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

function asString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function asBoolean(value: unknown) {
  return typeof value === 'boolean' ? value : false;
}

function asNumber(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value.replace(',', '.'));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function asDateString(value: unknown) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : null;
}

function normalizeEmail(value: unknown) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function createPublicToken() {
  return randomUUID().replace(/-/g, '');
}

export async function GET(request: NextRequest) {
  const access = await assertHrAccess(request, 'view').catch(() => null);
  if (!access) return jsonError('Sem permissão para acessar onboarding.', 403);

  const snapshot = await hrDbAdmin
    .collection('onboardingProcesses')
    .orderBy('createdAt', 'desc')
    .get();

  return NextResponse.json({
    processes: snapshot.docs.map(doc => ({
      id: doc.id,
      ...((serializeHrValue(doc.data()) as Record<string, unknown>) ?? {}),
    })),
  });
}

export async function POST(request: NextRequest) {
  const access = await assertHrAccess(request, 'manage').catch(() => null);
  if (!access) return jsonError('Sem permissão para iniciar onboarding.', 403);

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') return jsonError('Payload inválido.');

  const input = body as Record<string, unknown>;
  const candidateName = asString(input.candidateName);
  const candidateEmail = normalizeEmail(input.candidateEmail);
  const jobRoleId = asString(input.jobRoleId);
  const functionId = asString(input.functionId);
  const unitId = asString(input.unitId);
  const shiftDefinitionId = asString(input.shiftDefinitionId);
  const expectedAdmissionDate = asDateString(input.expectedAdmissionDate);
  const operational = asBoolean(input.operational);
  const participatesInGoals = asBoolean(input.participatesInGoals);
  const loginRestrictionEnabled = asBoolean(input.loginRestrictionEnabled);
  const needsTransportVoucher = asBoolean(input.needsTransportVoucher);
  const transportVoucherValue = needsTransportVoucher ? asNumber(input.transportVoucherValue) : null;
  const generateSignatureDocuments = asBoolean(input.generateSignatureDocuments);

  if (!candidateName) return jsonError('Informe o nome da pessoa em integração.');
  if (!candidateEmail || !candidateEmail.includes('@')) return jsonError('Informe um e-mail válido.');
  if (!jobRoleId) return jsonError('Selecione o cargo da integração.');
  if (!functionId) return jsonError('Selecione a função da integração.');
  if (needsTransportVoucher && (transportVoucherValue === null || transportVoucherValue < 0)) {
    return jsonError('Informe o valor diário do vale-transporte.');
  }

  const [roleDoc, functionDoc, unitDoc, shiftDefinitionDoc] = await Promise.all([
    hrDbAdmin.collection('jobRoles').doc(jobRoleId).get(),
    hrDbAdmin.collection('jobFunctions').doc(functionId).get(),
    unitId ? dbAdmin.collection('dp_units').doc(unitId).get() : Promise.resolve(null),
    shiftDefinitionId ? dbAdmin.collection('dp_shiftDefinitions').doc(shiftDefinitionId).get() : Promise.resolve(null),
  ]);

  if (!roleDoc.exists) return jsonError('Cargo não encontrado.', 404);
  if (!functionDoc.exists) return jsonError('Função não encontrada.', 404);
  if (unitId && !unitDoc?.exists) return jsonError('Unidade não encontrada.', 404);
  if (shiftDefinitionId && !shiftDefinitionDoc?.exists) return jsonError('Turno não encontrado.', 404);
  if (
    unitDoc?.exists &&
    shiftDefinitionDoc?.exists &&
    !shiftDefinitionMatchesUnit(shiftDefinitionDoc.data(), unitDoc.id)
  ) {
    return jsonError('O turno selecionado não pertence à unidade escolhida.', 400);
  }

  const roleData = roleDoc.data() ?? {};
  const functionData = functionDoc.data() ?? {};
  const compatibleRoleIds = Array.isArray(functionData.compatibleRoleIds)
    ? functionData.compatibleRoleIds.filter((value): value is string => typeof value === 'string')
    : [];

  if (compatibleRoleIds.length > 0 && !compatibleRoleIds.includes(jobRoleId)) {
    return jsonError('A função selecionada não está vinculada ao cargo escolhido.', 400);
  }

  const now = new Date().toISOString();
  const onboardingRef = hrDbAdmin.collection('onboardingProcesses').doc();
  const stages = applyOnboardingSignatureMode(
    mergeOnboardingStageModels(roleData.onboardingStages, functionData.onboardingStages),
    generateSignatureDocuments
  );
  const documentTemplates = mergeOnboardingDocumentModels(roleData.onboardingDocuments, functionData.onboardingDocuments);
  const documents = instantiateOnboardingDocuments(documentTemplates);

  await onboardingRef.set({
    candidateId: `manual_${onboardingRef.id}`,
    candidateName,
    candidateEmail,
    applicationId: null,
    jobOpeningId: null,
    jobRoleId: roleDoc.id,
    jobRoleName: asString(roleData.name) ?? asString(roleData.publicTitle) ?? null,
    functionId: functionDoc.id,
    functionName: asString(functionData.name) ?? asString(functionData.publicTitle) ?? null,
    unitId: unitDoc?.exists ? unitDoc.id : null,
    unitName: unitDoc?.exists ? asString(unitDoc.data()?.name) : null,
    shiftDefinitionId: shiftDefinitionDoc?.exists ? shiftDefinitionDoc.id : null,
    shiftDefinitionName: shiftDefinitionDoc?.exists ? asString(shiftDefinitionDoc.data()?.name) : null,
    expectedAdmissionDate,
    generateSignatureDocuments,
    finalizationSettings: {
      operational,
      participatesInGoals,
      loginRestrictionEnabled,
      needsTransportVoucher,
      transportVoucherValue,
      shiftDefinitionId: shiftDefinitionDoc?.exists ? shiftDefinitionDoc.id : null,
    },
    source: 'manual',
    publicToken: createPublicToken(),
    status: 'collecting_documents',
    currentStage: 'documents',
    stages,
    documents,
    integrationAlerts: [],
    approvedAt: now,
    approvedBy: access.decoded.uid,
    approvedByEmail: access.decoded.email ?? null,
    createdAt: now,
    updatedAt: now,
  });

  await logAction({
    user_id: access.decoded.uid,
    username: access.decoded.email ?? null,
    module: 'recruitment.onboarding',
    action: 'onboarding_created_manual',
    metadata: {
      target_type: 'onboarding',
      target_id: onboardingRef.id,
      target_name: candidateName,
      job_role_id: roleDoc.id,
      function_id: functionDoc.id,
    },
    ttl_days: 365,
  });

  const saved = await onboardingRef.get();
  return NextResponse.json({
    process: {
      id: saved.id,
      ...((serializeHrValue(saved.data()) as Record<string, unknown>) ?? {}),
    },
  }, { status: 201 });
}
