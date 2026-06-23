import { NextRequest, NextResponse } from 'next/server';
import { dbAdmin } from '@/lib/firebase-admin';
import { hrDbAdmin } from '@/lib/firebase-rh-admin';
import { assertHrAccess } from '@/features/hr/lib/server-access';
import { logAction } from '@/lib/log-action';
import { normalizeRecruitmentQuestions } from '@/lib/recruitment-forms';
import { mergeRecruitmentStageModels, normalizeRecruitmentStages } from '@/lib/recruitment-pipeline';

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
    location,
    workType,
    slots,
    applicationStartAt,
    applicationEndAt,
    closesAt,
    formQuestions,
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
  let inheritedQuestions: unknown[] = [];
  let rolePipelineStages: unknown;
  let functionPipelineStages: unknown;
  try {
    const roleDoc = await hrDbAdmin.collection('jobRoles').doc(jobRoleId).get();
    const roleData = roleDoc.data();
    jobRoleName = roleData?.name;
    rolePipelineStages = roleData?.pipelineStages;
    if (!Array.isArray(formQuestions) || formQuestions.length === 0) {
      if (Array.isArray(roleData?.formQuestions)) {
        inheritedQuestions = roleData.formQuestions;
      }
    }

    if (functionId) {
      const functionDoc = await hrDbAdmin.collection('jobFunctions').doc(functionId).get();
      const functionData = functionDoc.data();
      functionName = typeof functionData?.name === 'string' ? functionData.name : null;
      functionPipelineStages = functionData?.pipelineStages;
      const compatibleRoleIds = Array.isArray(functionData?.compatibleRoleIds) ? functionData.compatibleRoleIds : [];
      if (compatibleRoleIds.length > 0 && !compatibleRoleIds.includes(jobRoleId)) {
        return jsonError('Função incompatível com o cargo selecionado.');
      }
      if ((!Array.isArray(formQuestions) || formQuestions.length === 0) && Array.isArray(functionData?.formQuestions)) {
        inheritedQuestions = [...inheritedQuestions, ...functionData.formQuestions];
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

  const resolvedQuestions = Array.isArray(formQuestions) && formQuestions.length > 0
    ? formQuestions
    : inheritedQuestions;
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
    formQuestions: normalizeRecruitmentQuestions(resolvedQuestions),
    pipelineStages: resolvedPipelineStages,
    location: location?.trim() || null,
    workType: workType || null,
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
    },
    ttl_days: 365,
  });

  return NextResponse.json({ id: ref.id, slug }, { status: 201 });
}
