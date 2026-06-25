import { NextRequest, NextResponse } from 'next/server';
import { dbAdmin } from '@/lib/firebase-admin';
import { hrDbAdmin } from '@/lib/firebase-rh-admin';
import { assertHrAccess } from '@/features/hr/lib/server-access';
import { logAction } from '@/lib/log-action';
import { normalizeRecruitmentQuestions, resolveJobOpeningQuestions } from '@/lib/recruitment-forms';
import { normalizeRecruitmentStages } from '@/lib/recruitment-pipeline';
import {
  applyRecruitmentScoring,
  getRecruitmentScoringBlockMessage,
  RECRUITMENT_COMPOSITION_PRESETS,
} from '@/lib/recruitment-scoring';
import type { RecruitmentCompositionPreset } from '@/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

function normalizeCompositionPreset(value: unknown, fallback: unknown): RecruitmentCompositionPreset {
  const candidate = typeof value === 'string' ? value : fallback;
  return typeof candidate === 'string' && candidate in RECRUITMENT_COMPOSITION_PRESETS
    ? candidate as RecruitmentCompositionPreset
    : 'role_70_function_30';
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const access = await assertHrAccess(request, 'manage').catch(() => null);
  if (!access) return jsonError('Sem permissão para gerenciar vagas.', 403);

  const { id } = await context.params;
  const body = await request.json();
  const {
    title,
    jobRoleId,
    functionId,
    unitId,
    shiftDefinitionId,
    description,
    requirements,
    benefits,
    publicSalaryRange,
    applyButtonLabel,
    location,
    workType,
    slots,
    status,
    applicationStartAt,
    applicationEndAt,
    closesAt,
    formQuestions,
    compositionPreset,
    scoringAlertJustification,
    pipelineStages,
  } = body;

  const currentDoc = await hrDbAdmin.collection('jobOpenings').doc(id).get();
  const before = currentDoc.data() ?? {};
  const resolvedApplicationStartAt = applicationStartAt !== undefined ? applicationStartAt : before.applicationStartAt;
  const resolvedApplicationEndAt = applicationEndAt !== undefined ? applicationEndAt : before.applicationEndAt;

  if (resolvedApplicationStartAt && resolvedApplicationEndAt && String(resolvedApplicationEndAt) < String(resolvedApplicationStartAt)) {
    return jsonError('Período de inscrição inválido.');
  }

  const update: Record<string, unknown> = { updatedAt: new Date().toISOString() };
  if (title !== undefined) update.title = title;
  if (jobRoleId !== undefined) {
    update.jobRoleId = jobRoleId;
    const roleDoc = await hrDbAdmin.collection('jobRoles').doc(jobRoleId).get();
    update.jobRoleName = roleDoc.data()?.name ?? null;
  }
  if (functionId !== undefined) {
    update.functionId = functionId || null;
    update.functionName = null;
    if (functionId) {
      const functionDoc = await hrDbAdmin.collection('jobFunctions').doc(functionId).get();
      const functionData = functionDoc.data();
      const compatibleRoleIds = Array.isArray(functionData?.compatibleRoleIds) ? functionData.compatibleRoleIds : [];
      const resolvedJobRoleId = typeof jobRoleId === 'string'
        ? jobRoleId
        : typeof before.jobRoleId === 'string'
          ? before.jobRoleId
          : undefined;
      if (resolvedJobRoleId && compatibleRoleIds.length > 0 && !compatibleRoleIds.includes(resolvedJobRoleId)) {
        return jsonError('Função incompatível com o cargo selecionado.');
      }
      update.functionName = functionData?.name ?? null;
    }
  }
  if (unitId !== undefined) {
    update.unitId = unitId || null;
    update.unitName = null;
    if (unitId) {
      const unitDoc = await dbAdmin.collection('dp_units').doc(unitId).get();
      update.unitName = unitDoc.data()?.name ?? null;
    }
  }
  if (shiftDefinitionId !== undefined) {
    update.shiftDefinitionId = shiftDefinitionId || null;
    update.shiftDefinitionName = null;
    if (shiftDefinitionId) {
      const shiftDoc = await dbAdmin.collection('dp_shiftDefinitions').doc(shiftDefinitionId).get();
      update.shiftDefinitionName = shiftDoc.data()?.name ?? null;
    }
  }
  if (description !== undefined) update.description = description;
  if (requirements !== undefined) update.requirements = requirements;
  if (benefits !== undefined) update.benefits = Array.isArray(benefits) ? benefits : [];
  if (publicSalaryRange !== undefined) update.publicSalaryRange = publicSalaryRange || null;
  if (applyButtonLabel !== undefined) {
    update.applyButtonLabel = typeof applyButtonLabel === 'string' ? applyButtonLabel.trim() || null : null;
  }
  const shouldRecomputeScoring =
    formQuestions !== undefined ||
    compositionPreset !== undefined ||
    jobRoleId !== undefined ||
    functionId !== undefined;
  if (shouldRecomputeScoring) {
    const resolvedJobRoleId = typeof update.jobRoleId === 'string'
      ? update.jobRoleId
      : typeof before.jobRoleId === 'string'
        ? before.jobRoleId
        : undefined;
    const resolvedFunctionId = typeof update.functionId === 'string'
      ? update.functionId
      : typeof before.functionId === 'string'
        ? before.functionId
        : undefined;
    const [roleDoc, functionDoc] = await Promise.all([
      resolvedJobRoleId ? hrDbAdmin.collection('jobRoles').doc(resolvedJobRoleId).get() : Promise.resolve(null),
      resolvedFunctionId ? hrDbAdmin.collection('jobFunctions').doc(resolvedFunctionId).get() : Promise.resolve(null),
    ]);
    const roleQuestions = roleDoc?.data()?.formQuestions;
    const functionQuestions = functionDoc?.data()?.formQuestions;
    const questionsForScoring = formQuestions !== undefined
      ? normalizeRecruitmentQuestions(formQuestions)
      : jobRoleId !== undefined || functionId !== undefined
        ? resolveJobOpeningQuestions(undefined, roleQuestions, functionQuestions)
        : normalizeRecruitmentQuestions(before.formQuestions);
    const selectedPreset = normalizeCompositionPreset(compositionPreset, before.compositionPreset);
    const scoringModel = applyRecruitmentScoring(questionsForScoring, selectedPreset);
    const scoringBlock = getRecruitmentScoringBlockMessage(scoringModel.snapshot);
    if (scoringBlock) return jsonError(scoringBlock);
    const scoringWarnings = scoringModel.snapshot.alerts.filter(alert => alert.severity === 'warning');
    const scoringWarningJustification = typeof scoringAlertJustification === 'string'
      ? scoringAlertJustification.trim().slice(0, 500)
      : '';
    if (scoringWarnings.length > 0 && !scoringWarningJustification) {
      return jsonError('Justifique os alertas de pontuação antes de salvar a vaga.');
    }

    update.formQuestions = scoringModel.questions;
    update.compositionPreset = scoringModel.snapshot.preset;
    update.recruitmentScoring = scoringModel.snapshot;
    update.recruitmentScoringAlertAcknowledgement = scoringWarnings.length > 0
      ? {
          note: scoringWarningJustification,
          alertCodes: scoringWarnings.map(alert => alert.code),
          acknowledgedAt: update.updatedAt,
          acknowledgedBy: access.decoded.uid,
        }
      : null;
  }
  if (pipelineStages !== undefined) update.pipelineStages = normalizeRecruitmentStages(pipelineStages);
  if (location !== undefined) update.location = location;
  if (workType !== undefined) update.workType = workType;
  if (slots !== undefined) update.slots = Number(slots);
  if (status !== undefined) update.status = status;
  if (applicationStartAt !== undefined) update.applicationStartAt = applicationStartAt;
  if (applicationEndAt !== undefined) update.applicationEndAt = applicationEndAt;
  if (closesAt !== undefined) update.closesAt = closesAt;

  await hrDbAdmin.collection('jobOpenings').doc(id).update(update);
  await logAction({
    user_id: access.decoded.uid,
    username: access.decoded.email ?? null,
    module: 'recruitment.openings',
    action: 'opening_updated',
    metadata: {
      target_type: 'job_opening',
      target_id: id,
      target_name: update.title ?? before.title ?? id,
      changed_fields: Object.keys(update).filter((key) => key !== 'updatedAt'),
      before: {
        title: before.title ?? null,
        status: before.status ?? null,
        slots: before.slots ?? null,
        location: before.location ?? null,
        functionId: before.functionId ?? null,
        unitId: before.unitId ?? null,
        shiftDefinitionId: before.shiftDefinitionId ?? null,
      },
      after: {
        title: update.title ?? before.title ?? null,
        status: update.status ?? before.status ?? null,
        slots: update.slots ?? before.slots ?? null,
        location: update.location ?? before.location ?? null,
        functionId: update.functionId ?? before.functionId ?? null,
        unitId: update.unitId ?? before.unitId ?? null,
        shiftDefinitionId: update.shiftDefinitionId ?? before.shiftDefinitionId ?? null,
      },
    },
    ttl_days: 365,
  });
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const access = await assertHrAccess(request, 'manage').catch(() => null);
  if (!access) return jsonError('Sem permissão para gerenciar vagas.', 403);

  const { id } = await context.params;
  const currentDoc = await hrDbAdmin.collection('jobOpenings').doc(id).get();
  const before = currentDoc.data() ?? {};
  await hrDbAdmin.collection('jobOpenings').doc(id).delete();
  await logAction({
    user_id: access.decoded.uid,
    username: access.decoded.email ?? null,
    module: 'recruitment.openings',
    action: 'opening_deleted',
    metadata: {
      target_type: 'job_opening',
      target_id: id,
      target_name: before.title ?? id,
      status: before.status ?? null,
      slots: before.slots ?? null,
    },
    ttl_days: 365,
  });
  return NextResponse.json({ ok: true });
}
