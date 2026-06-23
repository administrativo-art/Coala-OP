import { NextRequest, NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { hrDbAdmin } from '@/lib/firebase-rh-admin';
import { assertHrAccess } from '@/features/hr/lib/server-access';
import { logAction } from '@/lib/log-action';
import {
  applicationStatusForCandidateStatus,
  createCandidateStageHistoryEntry,
  isCandidateDecisionAction,
  isCandidateStatus,
} from '@/lib/recruitment-pipeline';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
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
  const { decisionAction, decisionNote, reactivateToOpeningId, ...candidatePatch } = body;
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

    const applicationRef = hrDbAdmin.collection('applications').doc(`${id}_${openingDoc.id}`);
    const applicationDoc = await applicationRef.get();
    if (applicationDoc.exists || before.jobOpeningId === openingDoc.id) {
      return jsonError('Este candidato já está vinculado a esta vaga.', 409);
    }

    const historyEntry = createCandidateStageHistoryEntry({
      fromStatus: beforeStatus,
      toStatus: 'applied',
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
      stage: 'applied',
      status: 'active',
      source: 'talent_pool',
      notes: historyEntry.note,
      resumeUrl: before.resumeUrl ?? null,
      resumePath: before.resumePath ?? null,
      formAnswers: before.formAnswers ?? {},
      formQuestionSnapshot: before.formQuestionSnapshot ?? [],
      appliedAt: now,
      updatedAt: now,
      createdBy: access.decoded.uid,
      stageHistory: [historyEntry],
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
      status: 'applied',
      source: 'talent_pool',
      updatedAt: now,
      appliedAt: now,
      firstAppliedAt: before.firstAppliedAt ?? before.appliedAt ?? now,
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
          status: 'applied',
          jobOpeningId: openingDoc.id,
          latestApplicationId: applicationRef.id,
        },
      },
      ttl_days: 365,
    });

    return NextResponse.json({ ok: true, latestApplicationId: applicationRef.id });
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
    await onboardingRef.set({
      candidateId: id,
      candidateName: before.name ?? candidateUpdatePatch.name ?? null,
      candidateEmail: before.email ?? candidateUpdatePatch.email ?? null,
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
      source: 'recruitment',
      status: 'pending_setup',
      currentStage: 'approved_for_hire',
      approvedAt: before.hiredAt ?? now,
      approvedBy: access.decoded.uid,
      approvedByEmail: access.decoded.email ?? null,
      createdAt: onboardingDoc.exists ? onboardingDoc.data()?.createdAt ?? now : now,
      updatedAt: now,
    }, { merge: true });
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
