import 'server-only';

import type { QueryDocumentSnapshot } from 'firebase-admin/firestore';

import type { ServerUserContext } from '@/lib/auth-server';
import { dbAdmin } from '@/lib/firebase-admin';
import { prepareNatashaShiftDirectory } from '@/lib/natasha-shift-directory';
import { AppError } from '@/lib/observability';
import { canAccessUnit } from '@/lib/unit-access';

const QUERY_LIMIT = 501;
const PROJECTED_FIELDS = [
  'code', 'name', 'startTime', 'endTime', 'breakStart', 'breakEnd',
  'unitId', 'unitIds', 'daysOfWeek',
] as const;

function assertPermission(context: ServerUserContext) {
  if (!context.isDefaultAdmin && context.permissions.dp?.schedules?.view !== true) {
    throw new AppError({
      code: 'NATASHA_SHIFT_DEFINITIONS_FORBIDDEN',
      kind: 'AUTHORIZATION',
      safeMessage: 'Sem permissão para consultar os horários disponíveis para a escala.',
    });
  }
}

function documentData(document: QueryDocumentSnapshot) {
  return { id: document.id, ...document.data() };
}

export async function loadNatashaShiftDirectory(params: {
  context: ServerUserContext;
  unitIds: string[];
}) {
  const { context, unitIds } = params;
  assertPermission(context);
  for (const unitId of unitIds) {
    if (!canAccessUnit(context.userDoc, unitId, { isDefaultAdmin: context.isDefaultAdmin })) {
      throw new AppError({
        code: 'NATASHA_SHIFT_DEFINITION_UNIT_FORBIDDEN',
        kind: 'AUTHORIZATION',
        safeMessage: 'Sem acesso a uma das unidades solicitadas.',
      });
    }
  }

  const units = await dbAdmin.getAll(...unitIds.map((unitId) => dbAdmin.collection('dp_units').doc(unitId)));
  for (const unit of units) {
    if (!unit.exists || unit.get('isArchived') === true) {
      throw new AppError({
        code: 'NATASHA_SHIFT_DEFINITION_UNIT_UNAVAILABLE',
        kind: 'EXPECTED_BUSINESS',
        safeMessage: 'Uma das unidades não existe ou está arquivada.',
        metadata: { unitId: unit.id },
      });
    }
  }

  // Definições sem unidade são globais no contrato atual; por isso a consulta
  // precisa ler o catálogo limitado e filtrar no servidor.
  const snapshot = await dbAdmin.collection('dp_shiftDefinitions')
    .orderBy('name', 'asc')
    .select(...PROJECTED_FIELDS)
    .limit(QUERY_LIMIT)
    .get();
  if (snapshot.size === QUERY_LIMIT) {
    throw new AppError({
      code: 'NATASHA_SHIFT_DEFINITION_QUERY_LIMIT_REACHED',
      kind: 'DATA_INTEGRITY',
      safeMessage: 'Há definições de turno demais para preparar as posições com segurança.',
      metadata: { queryLimit: QUERY_LIMIT },
    });
  }

  return prepareNatashaShiftDirectory({
    unitIds,
    documents: snapshot.docs.map(documentData),
    sourceQuery: 'dp_shiftDefinitions:orderBy:name',
  });
}

export const NATASHA_SHIFT_DIRECTORY_QUERY_LIMITS = {
  maxUnits: 5,
  maxSourceDocuments: QUERY_LIMIT - 1,
  maxDefinitionsReturned: 100,
} as const;
