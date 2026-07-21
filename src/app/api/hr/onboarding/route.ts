import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';

import { assertFormalizationAccess, serializeHrValue } from '@/features/hr/lib/server-access';
import { shiftDefinitionMatchesUnit } from '@/lib/dp-shift-definitions';
import { dbAdmin } from '@/lib/firebase-admin';
import { hrDbAdmin } from '@/lib/firebase-rh-admin';
import { logAction } from '@/lib/log-action';
import { createOnboardingPublicLinkWindow } from '@/lib/hr/onboarding-public-link';
import { createIntegrationExecution } from '@/features/hr/integration/process';
import { createProbationProcess } from '@/features/hr/integration/probation-process';
import { blankIntegrationTemplateContent, getIntegrationTemplate, getIntegrationTemplateVersion } from '@/features/hr/integration/server';
import type { IntegrationTemplateVersion } from '@/features/hr/integration/schemas';
import { sendTrackedIntegrationCommunication } from '@/lib/email/integration-communications';
import { CnpjValidator } from '@/lib/company/cnpj-validator';
import { hasFormalizationPermission } from '@/lib/hr-formalization-permissions';
import { isEmploymentRelationshipType } from '@/lib/hr/employment-relationship';
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

function salaryFrom(source: Record<string, unknown>) {
  const salaryRange = source.salaryRange && typeof source.salaryRange === 'object' && !Array.isArray(source.salaryRange)
    ? source.salaryRange as Record<string, unknown>
    : {};
  const publicRange = source.publicSalaryRange && typeof source.publicSalaryRange === 'object' && !Array.isArray(source.publicSalaryRange)
    ? source.publicSalaryRange as Record<string, unknown>
    : {};
  return asNumber(salaryRange.min) ?? asNumber(publicRange.min);
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

function redactOnboardingProcess(
  process: Record<string, unknown>,
  access: Awaited<ReturnType<typeof assertFormalizationAccess>>,
) {
  const result = structuredClone(process) as Record<string, unknown>;
  const allowed = (action: Parameters<typeof hasFormalizationPermission>[1]) =>
    hasFormalizationPermission(access.permissions, action, access.isDefaultAdmin);

  if (!allowed('aso.view')) delete result.asoWorkflow;
  if (!allowed('accountant.view')) delete result.accountantWorkflow;
  if (!allowed('consents.view')) {
    delete result.consentimento_imagem_voz;
    delete result.publicPrivacyAcceptance;
  }
  if (!allowed('onboarding.manage')) {
    delete result.publicToken;
    delete result.publicTokenExtendedBy;
  }
  if (!allowed('documents.view')) {
    const documents = Array.isArray(result.documents) ? result.documents : [];
    result.documents = documents.map(entry => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return entry;
      const document = { ...(entry as Record<string, unknown>) };
      delete document.fileUrl;
      delete document.storagePath;
      delete document.hashSha256;
      return document;
    });
  }
  if (!allowed('sensitiveData.view')) {
    delete result.monthlySalary;
    const answers = result.publicFormAnswers && typeof result.publicFormAnswers === 'object' && !Array.isArray(result.publicFormAnswers)
      ? { ...(result.publicFormAnswers as Record<string, unknown>) }
      : null;
    if (answers) {
      for (const key of ['cpf', 'rg', 'identityNumber', 'bankName', 'bankAgency', 'bankAccount', 'pixKey']) {
        delete answers[key];
      }
      if (Array.isArray(answers.children)) {
        answers.children = answers.children.map(child => {
          if (!child || typeof child !== 'object' || Array.isArray(child)) return child;
          const safeChild = { ...(child as Record<string, unknown>) };
          delete safeChild.cpf;
          return safeChild;
        });
      }
      result.publicFormAnswers = answers;
    }
  }
  return result;
}

export async function GET(request: NextRequest) {
  const access = await assertFormalizationAccess(request, 'view').catch(() => null);
  if (!access) return jsonError('Sem permissão para acessar onboarding.', 403);

  const snapshot = await hrDbAdmin
    .collection('onboardingProcesses')
    .orderBy('createdAt', 'desc')
    .get();

  return NextResponse.json({
    processes: snapshot.docs.map(doc => redactOnboardingProcess({
      id: doc.id,
      ...((serializeHrValue(doc.data()) as Record<string, unknown>) ?? {}),
    }, access)),
  });
}

export async function POST(request: NextRequest) {
  const access = await assertFormalizationAccess(request, 'onboarding.manage').catch(() => null);
  if (!access) return jsonError('Sem permissão para iniciar onboarding.', 403);

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') return jsonError('Payload inválido.');

  const input = body as Record<string, unknown>;
  const candidateName = asString(input.candidateName);
  const candidateEmail = normalizeEmail(input.candidateEmail);
  const jobRoleId = asString(input.jobRoleId);
  const functionId = asString(input.functionId);
  const employmentRelationshipType = asString(input.employmentRelationshipType);
  const unitId = asString(input.unitId);
  const employerUnitId = asString(input.employerUnitId);
  const shiftDefinitionId = asString(input.shiftDefinitionId);
  const expectedAdmissionDate = asDateString(input.expectedAdmissionDate);
  const operational = asBoolean(input.operational);
  const participatesInGoals = asBoolean(input.participatesInGoals);
  const loginRestrictionEnabled = asBoolean(input.loginRestrictionEnabled);
  const needsTransportVoucher = asBoolean(input.needsTransportVoucher);
  const transportVoucherValue = needsTransportVoucher ? asNumber(input.transportVoucherValue) : null;
  const generateSignatureDocuments = asBoolean(input.generateSignatureDocuments);
  const integrationMode = input.integrationMode === 'import' ? 'import' : 'blank';
  const integrationTemplateId = asString(input.integrationTemplateId);
  const requestedTemplateVersion = asNumber(input.integrationTemplateVersion);

  if (!candidateName) return jsonError('Informe o nome da pessoa em integração.');
  if (!candidateEmail || !candidateEmail.includes('@')) return jsonError('Informe um e-mail válido.');
  if (!jobRoleId) return jsonError('Selecione o cargo da integração.');
  if (!functionId) return jsonError('Selecione a função da integração.');
  if (!isEmploymentRelationshipType(employmentRelationshipType)) {
    return jsonError('Selecione o tipo de vínculo: CLT, PJ ou Estágio.');
  }
  if (!employerUnitId) return jsonError('Selecione o CNPJ responsável pela contratação.');
  if (integrationMode === 'import' && !integrationTemplateId) return jsonError('Selecione o modelo que será importado.');
  if (needsTransportVoucher && (transportVoucherValue === null || transportVoucherValue < 0)) {
    return jsonError('Informe o valor diário do vale-transporte.');
  }

  const [roleDoc, functionDoc, unitDoc, employerUnitDoc, shiftDefinitionDoc] = await Promise.all([
    hrDbAdmin.collection('jobRoles').doc(jobRoleId).get(),
    hrDbAdmin.collection('jobFunctions').doc(functionId).get(),
    unitId ? dbAdmin.collection('dp_units').doc(unitId).get() : Promise.resolve(null),
    dbAdmin.collection('dp_units').doc(employerUnitId).get(),
    shiftDefinitionId ? dbAdmin.collection('dp_shiftDefinitions').doc(shiftDefinitionId).get() : Promise.resolve(null),
  ]);

  if (!roleDoc.exists) return jsonError('Cargo não encontrado.', 404);
  if (!functionDoc.exists) return jsonError('Função não encontrada.', 404);
  if (unitId && !unitDoc?.exists) return jsonError('Unidade não encontrada.', 404);
  if (!employerUnitDoc.exists || employerUnitDoc.data()?.isArchived === true) {
    return jsonError('O CNPJ responsável selecionado não está disponível.', 404);
  }
  const employerCnpj = CnpjValidator.clean(asString(employerUnitDoc.data()?.cnpj) ?? '');
  if (!CnpjValidator.validate(employerCnpj).valid) {
    return jsonError('A unidade responsável selecionada não possui um CNPJ válido. Corrija o cadastro da unidade.', 400);
  }
  if (unitDoc?.exists && unitDoc.data()?.isArchived === true) {
    return jsonError('Unidade indisponível para novos processos.', 400);
  }
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
  const monthlySalary = salaryFrom(functionData) ?? salaryFrom(roleData);
  const roleDefaultProfileId = asString(roleData.defaultProfileId);
  if (roleData.isActive !== false && !roleDefaultProfileId) {
    return jsonError('O cargo selecionado não possui um perfil de acesso padrão. Configure o cargo antes de iniciar a integração.', 400);
  }
  const effectiveProfileId = asString(functionData.defaultProfileId) ?? roleDefaultProfileId;
  if (!effectiveProfileId) {
    return jsonError('Não foi possível determinar o perfil de acesso desta integração.', 400);
  }
  const [roleProfileDoc, effectiveProfileDoc] = await Promise.all([
    roleDefaultProfileId ? dbAdmin.collection('profiles').doc(roleDefaultProfileId).get() : Promise.resolve(null),
    dbAdmin.collection('profiles').doc(effectiveProfileId).get(),
  ]);
  if (!roleProfileDoc?.exists) {
    return jsonError('O perfil de acesso padrão configurado no cargo não existe.', 400);
  }
  if (!effectiveProfileDoc.exists) {
    return jsonError('O perfil de acesso configurado no cargo ou função não existe.', 400);
  }
  const compatibleRoleIds = Array.isArray(functionData.compatibleRoleIds)
    ? functionData.compatibleRoleIds.filter((value): value is string => typeof value === 'string')
    : [];

  if (compatibleRoleIds.length > 0 && !compatibleRoleIds.includes(jobRoleId)) {
    return jsonError('A função selecionada não está vinculada ao cargo escolhido.', 400);
  }

  const nowDate = new Date();
  const now = nowDate.toISOString();
  const publicToken = createPublicToken();
  const publicLinkWindow = createOnboardingPublicLinkWindow(nowDate);
  const onboardingRef = hrDbAdmin.collection('onboardingProcesses').doc();
  let integrationSnapshot: IntegrationTemplateVersion;
  if (integrationMode === 'import' && integrationTemplateId) {
    const template = await getIntegrationTemplate(integrationTemplateId);
    if (!template) return jsonError('Modelo de integração não encontrado.', 404);
    if (template.metadata.status !== 'published' || template.metadata.currentVersion < 1) return jsonError('O modelo selecionado não possui versão publicada.');
    if (template.metadata.roleId !== jobRoleId) return jsonError('O modelo selecionado pertence a outro cargo.');
    if (template.metadata.functionId && template.metadata.functionId !== functionId) return jsonError('O modelo selecionado pertence a outra função.');
    const version = requestedTemplateVersion && requestedTemplateVersion > 0 ? requestedTemplateVersion : template.metadata.currentVersion;
    const published = await getIntegrationTemplateVersion(integrationTemplateId, version);
    if (!published) return jsonError('Versão publicada do modelo não encontrada.', 404);
    integrationSnapshot = published;
  } else {
    integrationSnapshot = {
      schemaVersion: 'coala-integration-v1',
      templateId: `instance_${onboardingRef.id}`,
      version: 1,
      name: `Integração de ${candidateName}`,
      roleId: jobRoleId,
      functionId,
      createdAt: now,
      createdBy: access.decoded.uid,
      publishedAt: null,
      ...blankIntegrationTemplateContent(),
    };
  }
  const integrationV2 = createIntegrationExecution({ mode: integrationMode, snapshot: integrationSnapshot, now });
  const probationV2 = createProbationProcess(expectedAdmissionDate, integrationSnapshot.probation, now);
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
    employmentRelationshipType,
    unitId: unitDoc?.exists ? unitDoc.id : null,
    unitName: unitDoc?.exists ? asString(unitDoc.data()?.name) : null,
    employerUnitId: employerUnitDoc.id,
    employerUnitName: asString(employerUnitDoc.data()?.name),
    employerCnpj,
    employerAddress: asString(employerUnitDoc.data()?.address),
    monthlySalary,
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
    integrationV2,
    probationV2,
    publicToken,
    ...publicLinkWindow,
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
      employment_relationship_type: employmentRelationshipType,
      employer_unit_id: employerUnitDoc.id,
      employer_cnpj: employerCnpj,
    },
    ttl_days: 365,
  });

  await sendTrackedIntegrationCommunication({
    onboardingId: onboardingRef.id,
    event: 'formalization_started',
    template: integrationSnapshot,
    recipient: candidateEmail,
    actionUrl: `https://vagas.coalashakes.com/onboarding/${encodeURIComponent(publicToken)}`,
    expiresAt: publicLinkWindow.publicTokenExpiresAt,
    variables: {
      'employee.name': candidateName,
      'employee.personal_email': candidateEmail,
      'system.role.job_role': asString(roleData.name) ?? asString(roleData.publicTitle),
      'system.role.functions': asString(functionData.name) ?? asString(functionData.publicTitle),
      'system.schedule.units': unitDoc?.exists ? asString(unitDoc.data()?.name) : null,
      'system.schedule.shift': shiftDefinitionDoc?.exists ? asString(shiftDefinitionDoc.data()?.name) : null,
      'integration.expected_admission_date': expectedAdmissionDate,
    },
  });

  const saved = await onboardingRef.get();
  return NextResponse.json({
    process: {
      id: saved.id,
      ...((serializeHrValue(saved.data()) as Record<string, unknown>) ?? {}),
    },
  }, { status: 201 });
}
