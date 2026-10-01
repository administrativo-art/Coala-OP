import 'server-only';

import type { QueryDocumentSnapshot } from 'firebase-admin/firestore';

import type { ServerUserContext } from '@/lib/auth-server';
import { dbAdmin } from '@/lib/firebase-admin';
import { prepareNatashaTeamDirectory } from '@/lib/natasha-team-directory';
import { AppError } from '@/lib/observability';
import { canAccessUnit } from '@/lib/unit-access';

const QUERY_LIMIT = 51;
const PROJECTED_FIELDS = [
  'username', 'isActive', 'inactivationType', 'unitId', 'unitIds', 'assignedKioskIds',
  'jobRoleId', 'jobFunctionIds', 'shiftDefinitionId',
] as const;

function assertPermission(context: ServerUserContext) {
  const canReadPeople = context.permissions.settings.manageUsers === true
    || (context.permissions.dp?.collaborators?.view === true
      && context.permissions.dp.collaborators.ownProfileOnly !== true);
  if (!context.isDefaultAdmin && (!context.permissions.dp?.schedules?.view || !canReadPeople)) {
    throw new AppError({
      code: 'NATASHA_TEAM_FORBIDDEN',
      kind: 'AUTHORIZATION',
      safeMessage: 'Sem permissão para consultar a equipe candidata da escala.',
    });
  }
}

function documentData(document: QueryDocumentSnapshot) {
  return { id: document.id, ...document.data() };
}

export async function loadNatashaTeam(params: {
  context: ServerUserContext;
  unitIds: string[];
}) {
  const { context, unitIds } = params;
  assertPermission(context);
  for (const unitId of unitIds) {
    if (!canAccessUnit(context.userDoc, unitId, { isDefaultAdmin: context.isDefaultAdmin })) {
      throw new AppError({
        code: 'NATASHA_TEAM_UNIT_FORBIDDEN',
        kind: 'AUTHORIZATION',
        safeMessage: 'Sem acesso a uma das unidades solicitadas.',
      });
    }
  }

  const unitSnapshots = await dbAdmin.getAll(...unitIds.map((unitId) => dbAdmin.collection('dp_units').doc(unitId)));
  const units = unitSnapshots.map((snapshot) => {
    if (!snapshot.exists || snapshot.get('isArchived') === true) {
      throw new AppError({
        code: 'NATASHA_TEAM_UNIT_UNAVAILABLE',
        kind: 'EXPECTED_BUSINESS',
        safeMessage: 'Uma das unidades não existe ou está arquivada.',
        metadata: { unitId: snapshot.id },
      });
    }
    const externalId = snapshot.get('externalId');
    return { id: snapshot.id, ...(typeof externalId === 'string' && externalId ? { externalId } : {}) };
  });

  const querySpecs = units.flatMap((unit) => [
    { field: 'unitIds', operator: 'array-contains' as const, value: unit.id, label: `unitIds:${unit.id}` },
    { field: 'unitId', operator: '==' as const, value: unit.id, label: `unitId:${unit.id}` },
    ...(unit.externalId ? [{
      field: 'assignedKioskIds', operator: 'array-contains' as const,
      value: unit.externalId, label: `assignedKioskIds:${unit.id}`,
    }] : []),
  ]);
  const batches = await Promise.all(querySpecs.map(async (spec) => {
    const snapshot = await dbAdmin.collection('users')
      .where(spec.field, spec.operator, spec.value)
      .select(...PROJECTED_FIELDS)
      .limit(QUERY_LIMIT)
      .get();
    if (snapshot.size === QUERY_LIMIT) {
      throw new AppError({
        code: 'NATASHA_TEAM_QUERY_LIMIT_REACHED',
        kind: 'DATA_INTEGRITY',
        safeMessage: 'Há pessoas demais para confirmar a equipe candidata com segurança.',
        metadata: { field: spec.field, unitId: spec.label.split(':')[1], queryLimit: QUERY_LIMIT },
      });
    }
    return snapshot.docs.map(documentData);
  }));

  return prepareNatashaTeamDirectory({
    unitIds,
    units,
    users: batches.flat(),
    sourceQueries: querySpecs.map((spec) => spec.label),
  });
}

export const NATASHA_TEAM_QUERY_LIMITS = {
  maxUnits: 5,
  maxQueriesPerUnit: 3,
  maxDocumentsPerQuery: QUERY_LIMIT - 1,
  maxEmployeesReturned: 50,
} as const;
