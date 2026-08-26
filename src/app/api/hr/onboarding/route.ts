import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { FieldPath, type Query } from 'firebase-admin/firestore';

import { assertFormalizationAccess, serializeHrValue } from '@/features/hr/lib/server-access';
import { shiftDefinitionMatchesUnit } from '@/lib/dp-shift-definitions';
import { dbAdmin } from '@/lib/firebase-admin';
import { hrDbAdmin } from '@/lib/firebase-rh-admin';
import { logAction } from '@/lib/log-action';
import { createOnboardingPublicLinkWindow } from '@/lib/hr/onboarding-public-link';
import { createIntegrationExecution } from '@/features/hr/integration/process';
import { createProbationProcess } from '@/features/hr/integration/probation-process';
import {
  DEFAULT_PROBATION_FIRST_PERIOD_DAYS,
  probationConfigForFirstPeriod,
} from '@/features/hr/integration/probation';
import { blankIntegrationTemplateContent, getIntegrationTemplate, getIntegrationTemplateVersion } from '@/features/hr/integration/server';
import { probationConfigSchema, type IntegrationTemplateVersion } from '@/features/hr/integration/schemas';
import { sendTrackedIntegrationCommunication } from '@/lib/email/integration-communications';
import { CnpjValidator } from '@/lib/company/cnpj-validator';
import { resolveCompanyProcessContact } from '@/lib/company/company-process-contact.server';
import { isEmploymentRelationshipType } from '@/lib/hr/employment-relationship';
import { fetchPdvLegalFiliais, fetchPdvLegalProfiles } from '@/lib/integrations/pdv-legal-admin';
import { createPjOnboardingWorkflow, sanitizePjServiceItems } from '@/features/hr/onboarding-pj/core';
import { redactOnboardingProcess } from '@/features/hr/onboarding/process-redaction.server';
import {
  resolveConfiguredMonthlySalary,
  salaryBaseFunctionId,
} from '@/features/hr/compensation/job-function-salary';
import {
  applyOnboardingSignatureMode,
  instantiateOnboardingDocuments,
  mergeOnboardingDocumentModels,
  mergeOnboardingStageModels,
  PJ_ONBOARDING_DOCUMENTS,
  PJ_ONBOARDING_STAGES,
} from '@/lib/recruitment-onboarding';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ACTIVE_ONBOARDING_STATUSES = [
  'pending_setup',
  'collecting_documents',
  'reviewing_documents',
  'accountant_pending',
  'contract_pending',
  'ready_to_create_user',
  'awaiting_first_access',
  'active',
] as const;
const ONBOARDING_OVERVIEW_LIMITS = {
  active: 120,
  completed: 40,
  cancelled: 40,
} as const;
const ONBOARDING_PAGE_LIMIT = 40;
type OnboardingScope = keyof typeof ONBOARDING_OVERVIEW_LIMITS;

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

async function createPjOnboarding(params: {
  input: Record<string, unknown>;
  access: NonNullable<Awaited<ReturnType<typeof assertFormalizationAccess>>>;
}) {
  const providerCnpj = CnpjValidator.clean(asString(params.input.providerCnpj) ?? '');
  const providerLegalName = asString(params.input.providerLegalName);
  const providerTradeName = asString(params.input.providerTradeName);
  const providerEmail = normalizeEmail(params.input.candidateEmail);
  const employerUnitId = asString(params.input.employerUnitId);
  const contractStartDate = asDateString(params.input.contractStartDate);
  const termType = params.input.termType === 'fixed' ? 'fixed' : params.input.termType === 'indefinite' ? 'indefinite' : null;
  const contractEndDate = asDateString(params.input.contractEndDate);
  const monthlyValue = asNumber(params.input.monthlyValue);
  const paymentDay = asNumber(params.input.paymentDay);
  const serviceItems = sanitizePjServiceItems(params.input.serviceItems);

  if (!CnpjValidator.validate(providerCnpj).valid) return jsonError('Informe um CNPJ válido para a prestadora.');
  if (!providerLegalName) return jsonError('Informe a razão social da prestadora.');
  if (!providerEmail || !providerEmail.includes('@')) return jsonError('Informe o e-mail único da prestadora.');
  if (!employerUnitId) return jsonError('Selecione a empresa contratante.');
  if (!contractStartDate) return jsonError('Informe a data de início da prestação.');
  if (!termType) return jsonError('Informe se o prazo é determinado ou indeterminado.');
  if (termType === 'fixed' && (!contractEndDate || contractEndDate < contractStartDate)) {
    return jsonError('Informe uma data de término igual ou posterior à data de início.');
  }
  if (monthlyValue === null || monthlyValue <= 0) return jsonError('Informe um valor mensal maior que zero.');
  if (paymentDay === null || !Number.isInteger(paymentDay) || paymentDay < 1 || paymentDay > 31) {
    return jsonError('Informe um dia de pagamento entre 1 e 31.');
  }
  if (!serviceItems.length || serviceItems.some(item => !item.front || !item.deliverable)) {
    return jsonError('Informe ao menos uma frente com seu respectivo entregável.');
  }

  const employerUnitDoc = await dbAdmin.collection('dp_units').doc(employerUnitId).get();
  if (!employerUnitDoc.exists || employerUnitDoc.data()?.isArchived === true) {
    return jsonError('A empresa contratante selecionada não está disponível.', 404);
  }
  const employerCnpj = CnpjValidator.clean(asString(employerUnitDoc.data()?.cnpj) ?? '');
  if (!CnpjValidator.validate(employerCnpj).valid) {
    return jsonError('A empresa contratante selecionada não possui um CNPJ válido.', 400);
  }

  const existing = await hrDbAdmin.collection('onboardingProcesses')
    .where('providerCnpj', '==', providerCnpj)
    .where('status', 'in', [...ACTIVE_ONBOARDING_STATUSES])
    .limit(1)
    .get();
  const duplicate = existing.docs[0];
  if (duplicate) return jsonError('Já existe uma integração em andamento para este CNPJ.', 409);

  const now = new Date().toISOString();
  const publicToken = createPublicToken();
  const publicLinkWindow = createOnboardingPublicLinkWindow(new Date(now));
  const onboardingRef = hrDbAdmin.collection('onboardingProcesses').doc();
  const integrationSnapshot: IntegrationTemplateVersion = {
    schemaVersion: 'coala-integration-v1',
    templateId: `pj_${onboardingRef.id}`,
    version: 1,
    name: `Integração PJ · ${providerLegalName}`,
    roleId: 'pj-contracting',
    functionId: null,
    createdAt: now,
    createdBy: params.access.decoded.uid,
    publishedAt: null,
    ...blankIntegrationTemplateContent(),
  };
  const pjWorkflow = createPjOnboardingWorkflow({
    cnpj: providerCnpj,
    legalName: providerLegalName,
    tradeName: providerTradeName,
    email: providerEmail,
    contractStartDate,
    termType,
    contractEndDate,
    monthlyValue,
    paymentDay,
    serviceItems,
    now,
    actorId: params.access.decoded.uid,
  });

  await onboardingRef.set({
    candidateId: `pj_${onboardingRef.id}`,
    candidateName: providerLegalName,
    candidateEmail: providerEmail,
    providerCnpj,
    providerLegalName,
    providerTradeName: providerTradeName ?? null,
    applicationId: null,
    jobOpeningId: null,
    jobRoleId: null,
    jobRoleName: 'Prestadora de serviços',
    functionId: null,
    functionName: null,
    employmentRelationshipType: 'pj',
    employerUnitId: employerUnitDoc.id,
    employerUnitName: asString(employerUnitDoc.data()?.name),
    employerCnpj,
    employerAddress: asString(employerUnitDoc.data()?.address),
    expectedAdmissionDate: contractStartDate,
    generateSignatureDocuments: true,
    source: 'manual',
    integrationV2: createIntegrationExecution({ mode: 'blank', snapshot: integrationSnapshot, now }),
    probationV2: null,
    pjWorkflow,
    publicToken,
    ...publicLinkWindow,
    status: 'collecting_documents',
    currentStage: 'documents',
    currentStageStartedAt: now,
    stages: PJ_ONBOARDING_STAGES,
    documents: instantiateOnboardingDocuments(PJ_ONBOARDING_DOCUMENTS),
    integrationAlerts: [],
    approvedAt: now,
    approvedBy: params.access.decoded.uid,
    approvedByEmail: params.access.decoded.email ?? null,
    createdAt: now,
    updatedAt: now,
  });

  await logAction({
    user_id: params.access.decoded.uid,
    username: params.access.decoded.email ?? null,
    module: 'recruitment.onboarding',
    action: 'onboarding_pj_created',
    metadata: {
      target_type: 'onboarding',
      target_id: onboardingRef.id,
      target_name: providerLegalName,
      provider_cnpj: providerCnpj,
      employer_unit_id: employerUnitDoc.id,
      employer_cnpj: employerCnpj,
    },
    ttl_days: 365,
  });

  await sendTrackedIntegrationCommunication({
    onboardingId: onboardingRef.id,
    event: 'formalization_started',
    template: integrationSnapshot,
    recipient: providerEmail,
    actionUrl: `https://vagas.coalashakes.com/onboarding/${encodeURIComponent(publicToken)}`,
    expiresAt: publicLinkWindow.publicTokenExpiresAt,
    variables: {
      'employee.name': providerLegalName,
      'employee.personal_email': providerEmail,
      'system.role.job_role': 'Prestadora de serviços',
      'system.role.functions': 'Cadastro da empresa prestadora',
      'system.schedule.units': asString(employerUnitDoc.data()?.name),
      'system.schedule.shift': null,
      'integration.expected_admission_date': contractStartDate,
    },
  });

  const saved = await onboardingRef.get();
  return NextResponse.json({
    process: { id: saved.id, ...((serializeHrValue(saved.data()) as Record<string, unknown>) ?? {}) },
  }, { status: 201 });
}

export async function GET(request: NextRequest) {
  const access = await assertFormalizationAccess(request, 'view').catch(() => null);
  if (!access) return jsonError('Sem permissão para acessar onboarding.', 403);

  const collection = hrDbAdmin.collection('onboardingProcesses');
  const scopedQuery = (scope: OnboardingScope) => {
    const scoped = scope === 'active'
      ? collection.where('status', 'in', [...ACTIVE_ONBOARDING_STATUSES])
      : collection.where('status', '==', scope);
    return scoped
      .orderBy('createdAt', 'desc')
      .orderBy(FieldPath.documentId(), 'desc') as Query;
  };

  const requestedScope = request.nextUrl.searchParams.get('scope');
  if (requestedScope) {
    if (!['active', 'completed', 'cancelled'].includes(requestedScope)) {
      return jsonError('Escopo de paginação inválido.');
    }
    const scope = requestedScope as OnboardingScope;
    const cursorId = request.nextUrl.searchParams.get('cursorId');
    let query = scopedQuery(scope);
    if (cursorId) {
      const cursorDocument = await collection.doc(cursorId).get();
      if (!cursorDocument.exists) return jsonError('Cursor de paginação expirado.', 409);
      const cursorStatus = String(cursorDocument.get('status') ?? '');
      const cursorMatchesScope = scope === 'active'
        ? ACTIVE_ONBOARDING_STATUSES.includes(cursorStatus as (typeof ACTIVE_ONBOARDING_STATUSES)[number])
        : cursorStatus === scope;
      if (!cursorMatchesScope) return jsonError('Cursor de paginação não pertence a esta lista.', 409);
      query = query.startAfter(cursorDocument);
    }
    const snapshot = await query.limit(ONBOARDING_PAGE_LIMIT + 1).get();
    const pageDocuments = snapshot.docs.slice(0, ONBOARDING_PAGE_LIMIT);
    const lastDocument = pageDocuments.at(-1);
    return NextResponse.json({
      processes: pageDocuments.map(doc => redactOnboardingProcess({
        id: doc.id,
        ...((serializeHrValue(doc.data()) as Record<string, unknown>) ?? {}),
      }, access)),
      pageInfo: {
        [scope]: {
          limit: ONBOARDING_PAGE_LIMIT,
          hasMore: snapshot.docs.length > ONBOARDING_PAGE_LIMIT,
          cursorId: lastDocument?.id ?? null,
        },
      },
    });
  }

  const overviewQuery = (scope: OnboardingScope) => scopedQuery(scope)
    .limit(ONBOARDING_OVERVIEW_LIMITS[scope] + 1);
  const [activeSnapshot, completedSnapshot, cancelledSnapshot] = await Promise.all([
    overviewQuery('active').get(),
    overviewQuery('completed').get(),
    overviewQuery('cancelled').get(),
  ]);
  const snapshots = {
    active: activeSnapshot,
    completed: completedSnapshot,
    cancelled: cancelledSnapshot,
  };
  const pageInfo = Object.fromEntries(
    (Object.keys(snapshots) as OnboardingScope[]).map(scope => {
      const pageDocuments = snapshots[scope].docs.slice(0, ONBOARDING_OVERVIEW_LIMITS[scope]);
      const lastDocument = pageDocuments.at(-1);
      return [scope, {
      limit: ONBOARDING_OVERVIEW_LIMITS[scope],
      hasMore: snapshots[scope].docs.length > ONBOARDING_OVERVIEW_LIMITS[scope],
      cursorId: lastDocument?.id ?? null,
    }];
    }),
  );
  const documents = (Object.keys(snapshots) as OnboardingScope[])
    .flatMap(scope => snapshots[scope].docs.slice(0, ONBOARDING_OVERVIEW_LIMITS[scope]));

  return NextResponse.json({
    processes: documents.map(doc => redactOnboardingProcess({
      id: doc.id,
      ...((serializeHrValue(doc.data()) as Record<string, unknown>) ?? {}),
    }, access)),
    pageInfo,
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
  const probationFirstPeriodDays = asNumber(input.probationFirstPeriodDays) ?? DEFAULT_PROBATION_FIRST_PERIOD_DAYS;
  const operational = asBoolean(input.operational);
  const participatesInGoals = asBoolean(input.participatesInGoals);
  const loginRestrictionEnabled = asBoolean(input.loginRestrictionEnabled);
  const transportVoucherValue = asNumber(input.transportVoucherValue);
  const generateSignatureDocuments = asBoolean(input.generateSignatureDocuments);
  const integrationMode = input.integrationMode === 'import' ? 'import' : 'blank';
  const integrationTemplateId = asString(input.integrationTemplateId);
  const requestedTemplateVersion = asNumber(input.integrationTemplateVersion);
  const requiresPdvAccess = asBoolean(input.requiresPdvAccess);
  const pdvProfileId = asString(input.pdvProfileId);

  if (employmentRelationshipType === 'pj') {
    return createPjOnboarding({ input, access });
  }

  if (!candidateName) return jsonError('Informe o nome da pessoa em integração.');
  if (!candidateEmail || !candidateEmail.includes('@')) return jsonError('Informe um e-mail válido.');
  if (!jobRoleId) return jsonError('Selecione o cargo da integração.');
  if (!functionId) return jsonError('Selecione a função da integração.');
  if (!isEmploymentRelationshipType(employmentRelationshipType)) {
    return jsonError('Selecione o tipo de vínculo: CLT, PJ ou Estágio.');
  }
  if (!employerUnitId) return jsonError('Selecione o CNPJ responsável pela contratação.');
  if (integrationMode === 'import' && !integrationTemplateId) return jsonError('Selecione o modelo que será importado.');
  if (transportVoucherValue === null || transportVoucherValue < 0) {
    return jsonError('Informe o valor diário do vale-transporte.');
  }
  if (requiresPdvAccess && !unitId) return jsonError('Selecione a unidade para liberar o PDV Legal.');
  if (requiresPdvAccess && !pdvProfileId) return jsonError('Selecione o perfil de acesso do PDV Legal.');

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
  let pdvAccess: Record<string, unknown> = { required: false, status: 'not_required' };
  if (requiresPdvAccess) {
    const filialId = asString(unitDoc?.data()?.pdvFilialId);
    if (!filialId) return jsonError('A unidade escolhida ainda não está vinculada a uma filial do PDV Legal.', 400);
    const [profiles, filiais] = await Promise.all([fetchPdvLegalProfiles(), fetchPdvLegalFiliais()]);
    const profile = profiles.find(item => item.id === pdvProfileId);
    const filial = filiais.find(item => item.id === filialId);
    if (!profile) return jsonError('O perfil escolhido não existe mais no PDV Legal. Sincronize e escolha novamente.', 400);
    if (!filial) return jsonError('A filial vinculada à unidade não existe mais no PDV Legal.', 400);
    pdvAccess = {
      required: true,
      profileId: profile.id,
      profileName: profile.name,
      filialId: filial.id,
      filialName: filial.name,
      unitId: unitDoc?.id ?? unitId,
      unitName: asString(unitDoc?.data()?.name),
      status: 'pending_password',
    };
  }

  const roleData = roleDoc.data() ?? {};
  const functionData = functionDoc.data() ?? {};
  const baseFunctionId = salaryBaseFunctionId(functionData);
  const baseFunctionDoc = baseFunctionId
    ? await hrDbAdmin.collection('jobFunctions').doc(baseFunctionId).get()
    : null;
  if (baseFunctionId && !baseFunctionDoc?.exists) {
    return jsonError('A função-base da regra salarial não foi encontrada. Corrija o cadastro da função antes de iniciar a integração.', 409);
  }
  const monthlySalary = resolveConfiguredMonthlySalary({
    jobFunction: functionData,
    jobRole: roleData,
    baseFunction: baseFunctionDoc?.data(),
  });
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
  const accountantContact = await resolveCompanyProcessContact('onboarding');
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
  try {
    const currentProbation = probationConfigSchema.parse(integrationSnapshot.probation ?? {});
    const probation = probationConfigForFirstPeriod(
      probationFirstPeriodDays,
      currentProbation,
    );
    integrationSnapshot = {
      ...integrationSnapshot,
      probation: { ...currentProbation, ...probation },
    };
  } catch (cause) {
    return jsonError(cause instanceof Error ? cause.message : 'Período de experiência inválido.');
  }
  const integrationV2 = createIntegrationExecution({ mode: integrationMode, snapshot: integrationSnapshot, now });
  const probationV2 = createProbationProcess(expectedAdmissionDate, integrationV2.snapshot.probation, now);
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
      transportVoucherValue,
      shiftDefinitionId: shiftDefinitionDoc?.exists ? shiftDefinitionDoc.id : null,
    },
    accountantWorkflow: {
      status: 'pending',
      suggestedRecipientEmail: accountantContact?.email ?? null,
      suggestedRecipientDepartment: accountantContact?.department ?? null,
      suggestedRecipientCompanyId: accountantContact?.entityId ?? null,
      suggestedRecipientCompanyName: accountantContact?.companyName ?? null,
    },
    pdvAccess,
    source: 'manual',
    integrationV2,
    probationV2,
    publicToken,
    ...publicLinkWindow,
    status: 'collecting_documents',
    currentStage: 'documents',
    currentStageStartedAt: now,
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
