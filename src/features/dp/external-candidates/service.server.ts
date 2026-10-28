import 'server-only';

import type { ServerUserContext } from '@/lib/auth-server';
import { resolveDPShiftAssignment } from '@/lib/dp-external-coverage';
import { usernameSearchVariants } from '@/lib/username-search';
import { dbAdmin } from '@/lib/firebase-admin';
import { AppError } from '@/lib/observability/app-error';
import { canAccessUnit } from '@/lib/unit-access';

const QUERY_MULTIPLIER = 3;
const MAX_AFFILIATED_UNITS = 20;
export const EXTERNAL_CANDIDATE_MAX_RESULTS = 20;
export const EXTERNAL_CANDIDATE_MAX_READS = (EXTERNAL_CANDIDATE_MAX_RESULTS * QUERY_MULTIPLIER + 1) * 5
  + EXTERNAL_CANDIDATE_MAX_RESULTS * MAX_AFFILIATED_UNITS;

export async function listExternalCoverageCandidates(params: {
  context: ServerUserContext;
  scheduleId: string;
  search: string;
  limit: number;
}) {
  const { context, scheduleId, search, limit } = params;
  if (!context.isDefaultAdmin && (
    context.permissions.dp.schedules.view !== true
    || context.permissions.dp.schedules.edit !== true
    || context.permissions.dp.schedules.assignExternal !== true
  )) {
    throw new AppError({ code: 'DP_EXTERNAL_CANDIDATES_FORBIDDEN', kind: 'AUTHORIZATION', safeMessage: 'Sem permissão para consultar coberturas externas.' });
  }

  const schedule = await dbAdmin.collection('dp_schedules').doc(scheduleId).get();
  if (!schedule.exists) throw new AppError({ code: 'DP_SCHEDULE_NOT_FOUND', kind: 'NOT_FOUND', safeMessage: 'Escala não encontrada.' });
  const executionUnitId = schedule.get('unitId');
  if (typeof executionUnitId !== 'string' || !executionUnitId) {
    throw new AppError({ code: 'DP_EXTERNAL_CANDIDATES_UNIT_REQUIRED', kind: 'VALIDATION', safeMessage: 'A escala precisa estar vinculada a uma unidade.' });
  }
  if (!canAccessUnit(context.userDoc, executionUnitId, { isDefaultAdmin: context.isDefaultAdmin })) {
    throw new AppError({ code: 'DP_EXTERNAL_CANDIDATES_UNIT_FORBIDDEN', kind: 'AUTHORIZATION', safeMessage: 'Sem acesso à unidade desta escala.' });
  }
  const unit = await dbAdmin.collection('dp_units').doc(executionUnitId).get();
  if (!unit.exists || unit.get('isArchived') === true) {
    throw new AppError({ code: 'DP_SHIFT_UNIT_UNAVAILABLE', kind: 'EXPECTED_BUSINESS', safeMessage: 'A unidade da escala não está disponível.' });
  }

  const boundedLimit = Math.min(Math.max(limit, 1), EXTERNAL_CANDIDATE_MAX_RESULTS);
  // O nome é gravado como digitado no cadastro; o Firestore só busca por prefixo exato, então tentamos as grafias comuns.
  const snapshots = await Promise.all(usernameSearchVariants(search).map((variant) => dbAdmin.collection('users')
    .orderBy('username')
    .startAt(variant)
    .endAt(`${variant}\uf8ff`)
    .select('username', 'isActive', 'unitId', 'unitIds', 'assignedKioskIds', 'jobRoleId', 'jobRoleName', 'jobFunctionIds', 'jobFunctionNames', 'shiftDefinitionId')
    .limit(boundedLimit * QUERY_MULTIPLIER + 1)
    .get()));
  const documents = [...new Map(snapshots.flatMap((snapshot) => snapshot.docs).map((document) => [document.id, document])).values()]
    .sort((left, right) => String(left.get('username') ?? '').localeCompare(String(right.get('username') ?? ''), 'pt-BR'));

  const candidates = documents.flatMap((document) => {
    if (document.get('isActive') === false) return [];
    try {
      const assignment = resolveDPShiftAssignment({
        executionUnitId,
        executionUnitExternalId: typeof unit.get('externalId') === 'string' ? unit.get('externalId') : undefined,
        user: document.data(),
      });
      if (assignment.assignmentKind !== 'external_coverage') return [];
      return [{
        id: document.id,
        username: String(document.get('username') ?? ''),
        originUnitId: assignment.originUnitId,
        affiliatedUnitIds: [...new Set((Array.isArray(document.get('unitIds')) ? document.get('unitIds') as unknown[] : [])
          .filter((id): id is string => typeof id === 'string' && Boolean(id)))].slice(0, MAX_AFFILIATED_UNITS),
        jobRoleId: typeof document.get('jobRoleId') === 'string' ? document.get('jobRoleId') : undefined,
        jobRoleName: typeof document.get('jobRoleName') === 'string' ? document.get('jobRoleName') : undefined,
        jobFunctionIds: Array.isArray(document.get('jobFunctionIds')) ? document.get('jobFunctionIds') : [],
        jobFunctionNames: Array.isArray(document.get('jobFunctionNames')) ? document.get('jobFunctionNames') : [],
        shiftDefinitionId: typeof document.get('shiftDefinitionId') === 'string' ? document.get('shiftDefinitionId') : undefined,
      }];
    } catch {
      return [];
    }
  }).slice(0, boundedLimit);

  const originIds = [...new Set(candidates.flatMap((candidate) => [candidate.originUnitId, ...candidate.affiliatedUnitIds]))];
  const origins = originIds.length
    ? await dbAdmin.getAll(...originIds.map((id) => dbAdmin.collection('dp_units').doc(id)))
    : [];
  const originNameById = new Map(origins.filter((origin) => origin.exists).map((origin) => [origin.id, String(origin.get('name') ?? origin.id)]));

  return {
    candidates: candidates.map((candidate) => ({ ...candidate,
      originUnitName: originNameById.get(candidate.originUnitId) ?? candidate.originUnitId,
      affiliatedUnitNames: (candidate.affiliatedUnitIds.length ? candidate.affiliatedUnitIds : [candidate.originUnitId])
        .map((id) => originNameById.get(id) ?? id) })),
    truncated: snapshots.some((snapshot) => snapshot.size > boundedLimit * QUERY_MULTIPLIER),
  };
}
