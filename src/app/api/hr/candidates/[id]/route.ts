import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { hrDbAdmin } from '@/lib/firebase-rh-admin';
import { assertHrAccess } from '@/features/hr/lib/server-access';
import { logAction } from '@/lib/log-action';
import { createOnboardingPublicLinkWindow } from '@/lib/hr/onboarding-public-link';
import { dbAdmin } from '@/lib/firebase-admin';
import { sendTrackedIntegrationCommunication } from '@/lib/email/integration-communications';
import { createIntegrationExecution } from '@/features/hr/integration/process';
import { createProbationProcess } from '@/features/hr/integration/probation-process';
import { integrationTemplateVersionSchema, type IntegrationTemplateVersion } from '@/features/hr/integration/schemas';
import { blankIntegrationTemplateContent, getIntegrationTemplateVersion, listIntegrationTemplates } from '@/features/hr/integration/server';
import {
  applyOnboardingSignatureMode,
  instantiateOnboardingDocuments,
  mergeOnboardingDocumentModels,
  mergeOnboardingStageModels,
} from '@/lib/recruitment-onboarding';
import {
  applicationStatusForCandidateStatus,
  createCandidateStageHistoryEntry,
  isCandidateDecisionAction,
  isCandidateStatus,
  normalizeRecruitmentStages,
} from '@/lib/recruitment-pipeline';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

function createPublicToken() {
  return randomUUID().replace(/-/g, '');
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const access = await assertHrAccess(request, 'manage').catch(() => null);
  if (!access) return jsonError('Sem permissão para gerenciar candidatos.', 403);

  const { id } = await context.params;
  const body = await request.json();
  const now = new Date().toISOString();
  const currentDoc = await hrDbAdmin.collection('candidates').doc(id).get();
  if (!currentDoc.exists) return jsonError('Candidato não encontrado.', 404);
  const before = currentDoc.data() ?? {};
  const { decisionAction, decisionNote, reactivateToOpeningId, reactivateToStage, reuseCandidateData, ...candidatePatch } = body;
  const status = isCandidateStatus(candidatePatch.status) ? candidatePatch.status : null;

  if (candidatePatch.status !== undefined && !status) {
    return jsonError('Status inválido.');
  }

  const beforeStatus = isCandidateStatus(before.status) ? before.status : null;

  if (typeof reactivateToOpeningId === 'string' && reactivateToOpeningId.trim()) {
    const openingDoc = await hrDbAdmin.collection('jobOpenings').doc(reactivateToOpeningId.trim()).get();
    if (!openingDoc.exists) return jsonError('Vaga não encontrada.', 404);
    const opening = openingDoc.data() ?? {};
    if (opening.status !== 'open') return jsonError('A vaga selecionada não está aberta.');
    const stageModels = normalizeRecruitmentStages(opening.pipelineStages);
    const allowedStages = new Set(stageModels.map(stage => stage.id));
    const targetStage = isCandidateStatus(reactivateToStage) && allowedStages.has(reactivateToStage)
      ? reactivateToStage
      : 'applied';
    const shouldReuseData = reuseCandidateData !== false;

    const applicationRef = hrDbAdmin.collection('applications').doc(`${id}_${openingDoc.id}`);
    const applicationDoc = await applicationRef.get();
    if (applicationDoc.exists || before.jobOpeningId === openingDoc.id) {
      return jsonError('Este candidato já está vinculado a esta vaga.', 409);
    }

    const historyEntry = createCandidateStageHistoryEntry({
      fromStatus: beforeStatus,
      toStatus: targetStage,
      action: 'advanced',
      note: typeof decisionNote === 'string' && decisionNote.trim()
        ? decisionNote
        : `Reativado do banco de talentos para ${opening.title ?? 'vaga'}.`,
      actorId: access.decoded.uid,
      actorEmail: access.decoded.email ?? null,
      createdAt: now,
    });

    const applicationPayload = {
      candidateId: id,
      jobOpeningId: openingDoc.id,
      jobRoleId: opening.jobRoleId ?? null,
      jobRoleName: opening.jobRoleName ?? null,
      functionId: opening.functionId ?? null,
      functionName: opening.functionName ?? null,
      unitId: opening.unitId ?? null,
      unitName: opening.unitName ?? null,
      shiftDefinitionId: opening.shiftDefinitionId ?? null,
      shiftDefinitionName: opening.shiftDefinitionName ?? null,
      stage: targetStage,
      status: applicationStatusForCandidateStatus(targetStage),
      source: 'talent_pool',
      notes: historyEntry.note,
      resumeUrl: shouldReuseData ? before.resumeUrl ?? null : null,
      resumePath: shouldReuseData ? before.resumePath ?? null : null,
      formAnswers: shouldReuseData ? before.formAnswers ?? {} : {},
      formQuestionSnapshot: shouldReuseData
        ? before.formQuestionSnapshot ?? opening.formQuestions ?? []
        : opening.formQuestions ?? [],
      appliedAt: now,
      updatedAt: now,
      createdBy: access.decoded.uid,
      stageHistory: [historyEntry],
      reactivatedFromTalentPool: true,
      reactivatedAt: now,
      reactivatedBy: access.decoded.uid,
    };

    const candidateUpdate = {
      jobRoleId: opening.jobRoleId ?? before.jobRoleId ?? 'talent_pool',
      jobRoleName: opening.jobRoleName ?? before.jobRoleName ?? null,
      functionId: opening.functionId ?? null,
      functionName: opening.functionName ?? null,
      unitId: opening.unitId ?? null,
      unitName: opening.unitName ?? null,
      shiftDefinitionId: opening.shiftDefinitionId ?? null,
      shiftDefinitionName: opening.shiftDefinitionName ?? null,
      jobOpeningId: openingDoc.id,
      latestApplicationId: applicationRef.id,
      status: targetStage,
      source: 'talent_pool',
      updatedAt: now,
      appliedAt: now,
      firstAppliedAt: before.firstAppliedAt ?? before.appliedAt ?? now,
      resumeUrl: shouldReuseData ? before.resumeUrl ?? null : null,
      resumePath: shouldReuseData ? before.resumePath ?? null : null,
      formAnswers: shouldReuseData ? before.formAnswers ?? {} : {},
      formQuestionSnapshot: shouldReuseData
        ? before.formQuestionSnapshot ?? opening.formQuestions ?? []
        : opening.formQuestions ?? [],
      recruitmentHistory: FieldValue.arrayUnion(historyEntry),
    };

    const batch = hrDbAdmin.batch();
    batch.set(applicationRef, applicationPayload);
    batch.set(currentDoc.ref, candidateUpdate, { merge: true });
    await batch.commit();

    await logAction({
      user_id: access.decoded.uid,
      username: access.decoded.email ?? null,
      module: 'recruitment.candidates',
      action: 'candidate_reactivated',
      metadata: {
        target_type: 'candidate',
        target_id: id,
        target_name: before.name ?? before.email ?? id,
        job_opening_id: openingDoc.id,
        job_opening_title: opening.title ?? null,
        latest_application_id: applicationRef.id,
        before: {
          status: before.status ?? null,
          jobOpeningId: before.jobOpeningId ?? null,
          latestApplicationId: before.latestApplicationId ?? null,
        },
        after: {
          status: targetStage,
          jobOpeningId: openingDoc.id,
          latestApplicationId: applicationRef.id,
        },
        reuse_candidate_data: shouldReuseData,
      },
      ttl_days: 365,
    });

    return NextResponse.json({ ok: true, latestApplicationId: applicationRef.id, status: targetStage });
  }

  const statusChanged = !!status && status !== beforeStatus;
  const latestApplicationId = typeof candidatePatch.latestApplicationId === 'string'
    ? candidatePatch.latestApplicationId
    : before.latestApplicationId;
  const candidateUpdatePatch: Record<string, unknown> = { ...candidatePatch };
  let onboardingId: string | null = null;

  if (status === 'hired') {
    onboardingId = typeof before.onboardingId === 'string' && before.onboardingId.trim()
      ? before.onboardingId
      : `onboarding_${id}_${latestApplicationId || 'direct'}`;
    candidateUpdatePatch.onboardingId = onboardingId;
    candidateUpdatePatch.hiredAt = before.hiredAt ?? now;

    const roleId = String(candidateUpdatePatch.jobRoleId ?? before.jobRoleId ?? '');
    const functionId = String(candidateUpdatePatch.functionId ?? before.functionId ?? '');
    const [roleDoc, functionDoc] = await Promise.all([
      roleId ? hrDbAdmin.collection('jobRoles').doc(roleId).get() : Promise.resolve(null),
      functionId ? hrDbAdmin.collection('jobFunctions').doc(functionId).get() : Promise.resolve(null),
    ]);
    if (!roleDoc?.exists) return jsonError('Cargo não encontrado para iniciar a integração.', 400);
    if (!functionDoc?.exists) return jsonError('Função não encontrada para iniciar a integração.', 400);
    const roleProfileId = typeof roleDoc.get('defaultProfileId') === 'string' ? roleDoc.get('defaultProfileId').trim() : '';
    if (!roleProfileId) return jsonError('O cargo selecionado não possui um perfil de acesso padrão.', 400);
    const functionProfileId = typeof functionDoc.get('defaultProfileId') === 'string' ? functionDoc.get('defaultProfileId').trim() : '';
    const [roleProfile, effectiveProfile] = await Promise.all([
      dbAdmin.collection('profiles').doc(roleProfileId).get(),
      dbAdmin.collection('profiles').doc(functionProfileId || roleProfileId).get(),
    ]);
    if (!roleProfile.exists || !effectiveProfile.exists) {
      return jsonError('O perfil de acesso configurado no cargo ou função não existe.', 400);
    }
  }

  const historyEntry = statusChanged
    ? createCandidateStageHistoryEntry({
        fromStatus: beforeStatus,
        toStatus: status,
        action: isCandidateDecisionAction(decisionAction) ? decisionAction : null,
        note: typeof decisionNote === 'string' ? decisionNote : null,
        actorId: access.decoded.uid,
        actorEmail: access.decoded.email ?? null,
        createdAt: now,
      })
    : null;

  await hrDbAdmin.collection('candidates').doc(id).update({
    ...candidateUpdatePatch,
    updatedAt: now,
    ...(historyEntry ? { recruitmentHistory: FieldValue.arrayUnion(historyEntry) } : {}),
  });

  if (latestApplicationId && status) {
    await hrDbAdmin.collection('applications').doc(latestApplicationId).set({
      stage: status,
      status: applicationStatusForCandidateStatus(status),
      ...(onboardingId ? { onboardingId, hiredAt: before.hiredAt ?? now } : {}),
      updatedAt: now,
      updatedBy: access.decoded.uid,
      ...(historyEntry ? { stageHistory: FieldValue.arrayUnion(historyEntry) } : {}),
    }, { merge: true });
  }

  if (onboardingId) {
    const onboardingRef = hrDbAdmin.collection('onboardingProcesses').doc(onboardingId);
    const onboardingDoc = await onboardingRef.get();
    const [roleDoc, functionDoc] = await Promise.all([
      (candidateUpdatePatch.jobRoleId ?? before.jobRoleId)
        ? hrDbAdmin.collection('jobRoles').doc(String(candidateUpdatePatch.jobRoleId ?? before.jobRoleId)).get()
        : Promise.resolve(null),
      (candidateUpdatePatch.functionId ?? before.functionId)
        ? hrDbAdmin.collection('jobFunctions').doc(String(candidateUpdatePatch.functionId ?? before.functionId)).get()
        : Promise.resolve(null),
    ]);
    const roleData = roleDoc?.data?.() ?? {};
    const functionData = functionDoc?.data?.() ?? {};
    const existingOnboarding = onboardingDoc.exists ? onboardingDoc.data() ?? {} : {};
    const publicLinkWindow = existingOnboarding.publicTokenExpiresAt
      ? null
      : createOnboardingPublicLinkWindow(new Date(
          typeof existingOnboarding.createdAt === 'string' ? existingOnboarding.createdAt : now
        ));
    const generateSignatureDocuments = existingOnboarding.generateSignatureDocuments === true;
    const stages = applyOnboardingSignatureMode(
      mergeOnboardingStageModels(roleData.onboardingStages, functionData.onboardingStages),
      generateSignatureDocuments
    );
    const documentTemplates = mergeOnboardingDocumentModels(roleData.onboardingDocuments, functionData.onboardingDocuments);
    const documents = instantiateOnboardingDocuments(
      documentTemplates,
      Array.isArray(existingOnboarding.documents) ? existingOnboarding.documents : undefined
    );
    const roleId = String(candidateUpdatePatch.jobRoleId ?? before.jobRoleId ?? '');
    const functionId = String(candidateUpdatePatch.functionId ?? before.functionId ?? '');
    const existingSnapshot = integrationTemplateVersionSchema.safeParse(
      (existingOnboarding.integrationV2 as Record<string, unknown> | undefined)?.snapshot
    );
    let integrationSnapshot: IntegrationTemplateVersion;
    if (existingSnapshot.success) {
      integrationSnapshot = existingSnapshot.data;
    } else {
      const compatibleTemplates = await listIntegrationTemplates({ roleId, functionId, compatibleOnly: true });
      const selectedTemplate = compatibleTemplates.find((item) => item.isDefault) ?? compatibleTemplates[0];
      const published = selectedTemplate
        ? await getIntegrationTemplateVersion(selectedTemplate.id, selectedTemplate.currentVersion)
        : null;
      integrationSnapshot = published ?? integrationTemplateVersionSchema.parse({
        schemaVersion: 'coala-integration-v1',
        templateId: `instance_${onboardingId}`,
        version: 1,
        name: `Integração de ${String(before.name ?? candidateUpdatePatch.name ?? 'candidato')}`,
        roleId,
        functionId,
        createdAt: now,
        createdBy: access.decoded.uid,
        publishedAt: null,
        ...blankIntegrationTemplateContent(),
      });
    }
    const integrationV2 = existingOnboarding.integrationV2 ?? createIntegrationExecution({
      mode: integrationSnapshot.templateId.startsWith('instance_') ? 'blank' : 'import',
      snapshot: integrationSnapshot,
      now,
    });
    const probationV2 = existingOnboarding.probationV2 ?? createProbationProcess(null, integrationSnapshot.probation, now);
    const publicToken = typeof existingOnboarding.publicToken === 'string' && existingOnboarding.publicToken
      ? existingOnboarding.publicToken
      : createPublicToken();
    await onboardingRef.set({
      candidateId: id,
      candidateName: candidateUpdatePatch.name ?? before.name ?? null,
      candidateEmail: candidateUpdatePatch.email ?? before.email ?? null,
      applicationId: latestApplicationId ?? null,
      jobOpeningId: candidateUpdatePatch.jobOpeningId ?? before.jobOpeningId ?? null,
      jobRoleId: candidateUpdatePatch.jobRoleId ?? before.jobRoleId ?? null,
      jobRoleName: candidateUpdatePatch.jobRoleName ?? before.jobRoleName ?? null,
      functionId: candidateUpdatePatch.functionId ?? before.functionId ?? null,
      functionName: candidateUpdatePatch.functionName ?? before.functionName ?? null,
      unitId: candidateUpdatePatch.unitId ?? before.unitId ?? null,
      unitName: candidateUpdatePatch.unitName ?? before.unitName ?? null,
      shiftDefinitionId: candidateUpdatePatch.shiftDefinitionId ?? before.shiftDefinitionId ?? null,
      shiftDefinitionName: candidateUpdatePatch.shiftDefinitionName ?? before.shiftDefinitionName ?? null,
      expectedAdmissionDate: existingOnboarding.expectedAdmissionDate ?? null,
      generateSignatureDocuments,
      source: 'recruitment',
      integrationV2,
      probationV2,
      publicToken,
      ...(publicLinkWindow ?? {}),
      status: existingOnboarding.status ?? 'collecting_documents',
      currentStage: existingOnboarding.currentStage ?? 'documents',
      stages,
      documents,
      integrationAlerts: [
        {
          id: 'bizneo_id',
          label: 'ID do Bizneo',
          status: before.registrationIdBizneo || candidateUpdatePatch.registrationIdBizneo ? 'resolved' : 'pending',
          message: 'Criar ou vincular colaborador no Bizneo.',
        },
        {
          id: 'pdv_id',
          label: 'ID do PDV Legal',
          status: before.registrationIdPdv || candidateUpdatePatch.registrationIdPdv ? 'resolved' : 'pending',
          message: 'Criar ou vincular código operacional no PDV Legal.',
        },
      ],
      approvedAt: before.hiredAt ?? now,
      approvedBy: access.decoded.uid,
      approvedByEmail: access.decoded.email ?? null,
      createdAt: onboardingDoc.exists ? onboardingDoc.data()?.createdAt ?? now : now,
      updatedAt: now,
    }, { merge: true });

    if (!onboardingDoc.exists) {
      const expiresAt = typeof publicLinkWindow?.publicTokenExpiresAt === 'string'
        ? publicLinkWindow.publicTokenExpiresAt
        : typeof existingOnboarding.publicTokenExpiresAt === 'string'
          ? existingOnboarding.publicTokenExpiresAt
          : null;
      await sendTrackedIntegrationCommunication({
        onboardingId,
        event: 'formalization_started',
        template: integrationSnapshot,
        recipient: String(candidateUpdatePatch.email ?? before.email ?? ''),
        actionUrl: `https://vagas.coalashakes.com/onboarding/${encodeURIComponent(publicToken)}`,
        expiresAt,
        variables: {
          'employee.name': String(candidateUpdatePatch.name ?? before.name ?? ''),
          'employee.personal_email': String(candidateUpdatePatch.email ?? before.email ?? ''),
          'system.role.job_role': String(candidateUpdatePatch.jobRoleName ?? before.jobRoleName ?? roleData.name ?? ''),
          'system.role.functions': String(candidateUpdatePatch.functionName ?? before.functionName ?? functionData.name ?? ''),
          'system.schedule.units': String(candidateUpdatePatch.unitName ?? before.unitName ?? ''),
          'system.schedule.shift': String(candidateUpdatePatch.shiftDefinitionName ?? before.shiftDefinitionName ?? ''),
        },
      });
    }
  }

  await logAction({
    user_id: access.decoded.uid,
    username: access.decoded.email ?? null,
    module: 'recruitment.candidates',
    action: 'candidate_updated',
    metadata: {
      target_type: 'candidate',
      target_id: id,
      target_name: before.name ?? before.email ?? id,
      changed_fields: Object.keys(candidateUpdatePatch),
      decision_action: historyEntry?.action ?? null,
      onboarding_id: onboardingId,
      before: {
        status: before.status ?? null,
        jobOpeningId: before.jobOpeningId ?? null,
        latestApplicationId: before.latestApplicationId ?? null,
      },
      after: {
        status: candidateUpdatePatch.status ?? before.status ?? null,
        jobOpeningId: candidateUpdatePatch.jobOpeningId ?? before.jobOpeningId ?? null,
        latestApplicationId,
      },
    },
    ttl_days: 365,
  });

  return NextResponse.json({ ok: true, onboardingId });
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const access = await assertHrAccess(request, 'manage').catch(() => null);
  if (!access) return jsonError('Sem permissão para gerenciar candidatos.', 403);

  const { id } = await context.params;
  const currentDoc = await hrDbAdmin.collection('candidates').doc(id).get();
  const before = currentDoc.data() ?? {};
  await hrDbAdmin.collection('candidates').doc(id).delete();
  await logAction({
    user_id: access.decoded.uid,
    username: access.decoded.email ?? null,
    module: 'recruitment.candidates',
    action: 'candidate_deleted',
    metadata: {
      target_type: 'candidate',
      target_id: id,
      target_name: before.name ?? before.email ?? id,
      email: before.email ?? null,
      status: before.status ?? null,
    },
    ttl_days: 365,
  });
  return NextResponse.json({ ok: true });
}
