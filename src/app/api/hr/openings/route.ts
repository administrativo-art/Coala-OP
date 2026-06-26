import { NextRequest, NextResponse } from 'next/server';
import { dbAdmin } from '@/lib/firebase-admin';
import { hrDbAdmin } from '@/lib/firebase-rh-admin';
import { assertHrAccess } from '@/features/hr/lib/server-access';
import { logAction } from '@/lib/log-action';
import { resolveJobOpeningQuestions } from '@/lib/recruitment-forms';
import { mergeRecruitmentStageModels, normalizeRecruitmentStages } from '@/lib/recruitment-pipeline';
import {
  applyRecruitmentScoring,
  getRecruitmentScoringBlockMessage,
  RECRUITMENT_COMPOSITION_PRESETS,
} from '@/lib/recruitment-scoring';
import type { RecruitmentCompositionPreset } from '@/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function slugify(text: string) {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

function normalizeCompositionPreset(value: unknown): RecruitmentCompositionPreset {
  return typeof value === 'string' && value in RECRUITMENT_COMPOSITION_PRESETS
    ? value as RecruitmentCompositionPreset
    : 'role_70_function_30';
}

export async function GET(request: NextRequest) {
  const access = await assertHrAccess(request, 'view').catch(() => null);
  if (!access) return jsonError('Sem permissão.', 403);

  const snapshot = await hrDbAdmin.collection('jobOpenings').orderBy('createdAt', 'desc').get();
  const openings = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  return NextResponse.json(openings);
}

export async function POST(request: NextRequest) {
  const access = await assertHrAccess(request, 'manage').catch(() => null);
  if (!access) return jsonError('Sem permissão para gerenciar vagas.', 403);

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
    applicationSuccessMessage,
    lgpdContractText,
    location,
    workType,
    contractTypeLabel,
    workSchedule,
    slots,
    applicationStartAt,
    applicationEndAt,
    closesAt,
    formQuestions,
    compositionPreset,
    scoringAlertJustification,
    pipelineStages,
  } = body;

  if (!title?.trim() || !jobRoleId) {
    return jsonError('Título e cargo são obrigatórios.');
  }

  const now = new Date().toISOString();
  const baseSlug = slugify(title.trim());
  const slug = `${baseSlug}-${Date.now().toString(36)}`;

  if (applicationStartAt && applicationEndAt && String(applicationEndAt) < String(applicationStartAt)) {
    return jsonError('Período de inscrição inválido.');
  }

  // Resolve role/function/unit/shift names and inherit model questions when needed.
  let jobRoleName: string | undefined;
  let functionName: string | null = null;
  let unitName: string | null = null;
  let shiftDefinitionName: string | null = null;
  let roleFormQuestions: unknown;
  let functionFormQuestions: unknown;
  let rolePipelineStages: unknown;
  let functionPipelineStages: unknown;
  try {
    const roleDoc = await hrDbAdmin.collection('jobRoles').doc(jobRoleId).get();
    const roleData = roleDoc.data();
    jobRoleName = roleData?.name;
    roleFormQuestions = roleData?.formQuestions;
    rolePipelineStages = roleData?.pipelineStages;

    if (functionId) {
      const functionDoc = await hrDbAdmin.collection('jobFunctions').doc(functionId).get();
      const functionData = functionDoc.data();
      functionName = typeof functionData?.name === 'string' ? functionData.name : null;
      functionFormQuestions = functionData?.formQuestions;
      functionPipelineStages = functionData?.pipelineStages;
      const compatibleRoleIds = Array.isArray(functionData?.compatibleRoleIds) ? functionData.compatibleRoleIds : [];
      if (compatibleRoleIds.length > 0 && !compatibleRoleIds.includes(jobRoleId)) {
        return jsonError('Função incompatível com o cargo selecionado.');
      }
    }

    if (unitId) {
      const unitDoc = await dbAdmin.collection('dp_units').doc(unitId).get();
      unitName = typeof unitDoc.data()?.name === 'string' ? unitDoc.data()?.name : null;
    }

    if (shiftDefinitionId) {
      const shiftDoc = await dbAdmin.collection('dp_shiftDefinitions').doc(shiftDefinitionId).get();
      shiftDefinitionName = typeof shiftDoc.data()?.name === 'string' ? shiftDoc.data()?.name : null;
    }
  } catch {
    // best-effort
  }

  const resolvedQuestions = resolveJobOpeningQuestions(formQuestions, roleFormQuestions, functionFormQuestions);
  const selectedCompositionPreset = normalizeCompositionPreset(compositionPreset);
  const scoringModel = applyRecruitmentScoring(resolvedQuestions, selectedCompositionPreset);
  const scoringBlock = getRecruitmentScoringBlockMessage(scoringModel.snapshot);
  if (scoringBlock) return jsonError(scoringBlock);
  const scoringWarnings = scoringModel.snapshot.alerts.filter(alert => alert.severity === 'warning');
  const scoringWarningJustification = typeof scoringAlertJustification === 'string'
    ? scoringAlertJustification.trim().slice(0, 500)
    : '';
  if (scoringWarnings.length > 0 && !scoringWarningJustification) {
    return jsonError('Justifique os alertas de pontuação antes de publicar a vaga.');
  }

  const resolvedPipelineStages = Array.isArray(pipelineStages) && pipelineStages.length > 0
    ? normalizeRecruitmentStages(pipelineStages)
    : mergeRecruitmentStageModels(rolePipelineStages, functionPipelineStages);

  const ref = await hrDbAdmin.collection('jobOpenings').add({
    title: title.trim(),
    slug,
    jobRoleId,
    jobRoleName,
    functionId: functionId || null,
    functionName,
    unitId: unitId || null,
    unitName,
    shiftDefinitionId: shiftDefinitionId || null,
    shiftDefinitionName,
    description: description?.trim() || null,
    requirements: Array.isArray(requirements) ? requirements : [],
    benefits: Array.isArray(benefits) ? benefits : [],
    publicSalaryRange: publicSalaryRange || null,
    applyButtonLabel: typeof applyButtonLabel === 'string' ? applyButtonLabel.trim() || null : null,
    applicationSuccessMessage: typeof applicationSuccessMessage === 'string' ? applicationSuccessMessage.trim().slice(0, 500) || null : null,
    lgpdContractText: typeof lgpdContractText === 'string' ? lgpdContractText.trim().slice(0, 4000) || null : null,
    formQuestions: scoringModel.questions,
    compositionPreset: scoringModel.snapshot.preset,
    recruitmentScoring: scoringModel.snapshot,
    recruitmentScoringAlertAcknowledgement: scoringWarnings.length > 0
      ? {
          note: scoringWarningJustification,
          alertCodes: scoringWarnings.map(alert => alert.code),
          acknowledgedAt: now,
          acknowledgedBy: access.decoded.uid,
        }
      : null,
    pipelineStages: resolvedPipelineStages,
    location: location?.trim() || null,
    workType: workType || null,
    contractTypeLabel: typeof contractTypeLabel === 'string' ? contractTypeLabel.trim() || null : null,
    workSchedule: typeof workSchedule === 'string' ? workSchedule.trim() || null : null,
    slots: Number(slots) || 1,
    status: 'open',
    applicationStartAt: applicationStartAt || null,
    applicationEndAt: applicationEndAt || null,
    closesAt: closesAt || null,
    createdAt: now,
    updatedAt: now,
    createdBy: access.decoded.uid,
  });

  await logAction({
    user_id: access.decoded.uid,
    username: access.decoded.email ?? null,
    module: 'recruitment.openings',
    action: 'opening_created',
    metadata: {
      target_type: 'job_opening',
      target_id: ref.id,
      target_name: title.trim(),
      job_role_id: jobRoleId,
      job_role_name: jobRoleName ?? null,
      function_id: functionId || null,
      function_name: functionName,
      unit_id: unitId || null,
      unit_name: unitName,
      shift_definition_id: shiftDefinitionId || null,
      shift_definition_name: shiftDefinitionName,
      slots: Number(slots) || 1,
      status: 'open',
      composition_preset: scoringModel.snapshot.preset,
      scoring_alerts: scoringModel.snapshot.alerts,
      scoring_alert_acknowledged: scoringWarnings.length > 0,
    },
    ttl_days: 365,
  });

  return NextResponse.json({ id: ref.id, slug }, { status: 201 });
}
