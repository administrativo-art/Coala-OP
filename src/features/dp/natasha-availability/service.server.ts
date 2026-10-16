import 'server-only';

import type { QueryDocumentSnapshot } from 'firebase-admin/firestore';

import { loadNatashaTeam } from '@/features/dp/natasha-team/service.server';
import type { ServerUserContext } from '@/lib/auth-server';
import { dbAdmin } from '@/lib/firebase-admin';
import { hrDbAdmin } from '@/lib/firebase-rh-admin';
import { natashaAvailabilityWindow, prepareNatashaAvailability } from '@/lib/natasha-availability';
import { operationalGuardRequested, operationalReadinessRef,
  operationalReadinessValid } from '@/features/dp/absences/operational/occupancy-guard.server';
import { absenceCivilDateSchema } from '@/features/dp/absences/requests/schemas';
import { AppError } from '@/lib/observability';

const QUERY_LIMIT = 301;
const PROJECTED_FIELDS = ['userId', 'startDate', 'endDate', 'recordType', 'status'] as const;
const ABSENCE_QUERY_LIMIT = 51;
const ABSENCE_TOTAL_LIMIT = 200;

function documentData(document: QueryDocumentSnapshot) {
  return { ...document.data(), id: document.id };
}

export async function loadNatashaAvailability(params: {
  context: ServerUserContext;
  period: string;
  unitIds: string[];
}) {
  const { context, period, unitIds } = params;
  // Reutiliza a autorização, os vínculos e os limites da equipe candidata. Isso
  // evita buscar férias apenas de quem apareceu na escala anterior.
  const team = await loadNatashaTeam({ context, unitIds });
  if (team.status !== 'ready_for_confirmation') {
    return prepareNatashaAvailability({
      period,
      team,
      vacationDocuments: [],
      sourceQuery: 'not_run:team_incomplete',
      operational: { workspaceId: context.workspace_id, sourceReady: false, epoch: null,
        projectionDocuments: [], requestDocuments: [], sourceQuery: 'not_run:team_incomplete' },
    });
  }
  const window = natashaAvailabilityWindow(period);
  const snapshot = await dbAdmin.collection('dp_vacations')
    .where('endDate', '>=', window.from)
    .where('endDate', '<=', window.queryEnd)
    .orderBy('endDate', 'asc')
    .select(...PROJECTED_FIELDS)
    .limit(QUERY_LIMIT)
    .get();

  if (snapshot.size === QUERY_LIMIT) {
    throw new AppError({
      code: 'NATASHA_AVAILABILITY_QUERY_LIMIT_REACHED',
      kind: 'DATA_INTEGRITY',
      safeMessage: 'Há férias demais para confirmar a disponibilidade da equipe com segurança.',
      metadata: { period, queryLimit: QUERY_LIMIT },
    });
  }

  let operational: { workspaceId: string; sourceReady: boolean; epoch: string | null;
    projectionDocuments: Record<string, unknown>[]; requestDocuments: Record<string, unknown>[]; sourceQuery: string } = {
      workspaceId: context.workspace_id, sourceReady: false, epoch: null,
      projectionDocuments: [], requestDocuments: [], sourceQuery: 'not_run:operational_guard_off',
    };
  let guardEnabled = false;
  try { guardEnabled = operationalGuardRequested(); }
  catch { operational = { ...operational, sourceQuery: 'not_run:operational_guard_invalid' }; }
  if (guardEnabled) {
    const receipt = await operationalReadinessRef(context.workspace_id).get().catch(() => null);
    if (receipt && operationalReadinessValid(receipt, context.workspace_id)
      && absenceCivilDateSchema.safeParse(receipt.get('coverageFrom')).success
      && absenceCivilDateSchema.safeParse(receipt.get('coverageThrough')).success
      && receipt.get('coverageFrom') <= window.from && receipt.get('coverageThrough') >= window.through) {
      const ids = team.employees.map((employee) => employee.id);
      // Five candidates × at most five units = 25 Firestore disjunctions per query.
      const chunks = Array.from({ length: Math.ceil(ids.length / 5) }, (_, index) => ids.slice(index * 5, index * 5 + 5));
      const batches = await Promise.all([
        Promise.all(chunks.map((chunk) => dbAdmin.collection('dp_absenceOperationalAvailability')
          .where('workspaceId', '==', context.workspace_id).where('unitId', 'in', unitIds)
          .where('beneficiaryUid', 'in', chunk)
          .where('startDate', '<=', window.through).where('endDate', '>=', window.from)
          .limit(ABSENCE_QUERY_LIMIT).get())),
        Promise.all(chunks.map((chunk) => hrDbAdmin.collection('dp_absenceRequests')
          .where('workspaceId', '==', context.workspace_id).where('unitId', 'in', unitIds)
          .where('beneficiaryUid', 'in', chunk)
          .where('startDate', '<=', window.through).where('endDate', '>=', window.from)
          .limit(ABSENCE_QUERY_LIMIT).get())),
      ]).catch(() => null);
      if (!batches) {
        operational = { ...operational, sourceQuery: 'incomplete:absence_source_unavailable' };
      } else {
      const [projectionBatches, requestBatches] = batches;
      const projectionCount = projectionBatches.reduce((count, batch) => count + batch.size, 0);
      const requestCount = requestBatches.reduce((count, batch) => count + batch.size, 0);
      if (projectionBatches.some((batch) => batch.size === ABSENCE_QUERY_LIMIT)
        || requestBatches.some((batch) => batch.size === ABSENCE_QUERY_LIMIT)
        || projectionCount > ABSENCE_TOTAL_LIMIT || requestCount > ABSENCE_TOTAL_LIMIT) {
        operational = { ...operational, sourceQuery: 'incomplete:absence_query_limit' };
      } else {
        operational = { workspaceId: context.workspace_id, sourceReady: true,
          epoch: receipt.get('epoch') as string,
          projectionDocuments: projectionBatches.flatMap((batch) => batch.docs.map(documentData)),
          requestDocuments: requestBatches.flatMap((batch) => batch.docs.map(documentData)),
          sourceQuery: 'coala:dp_absenceOperationalAvailability+coala-rh:dp_absenceRequests:bounded_window',
        };
      }
      }
    } else operational = { ...operational, sourceQuery: 'not_run:readiness_incomplete' };
  }

  return prepareNatashaAvailability({
    period,
    team,
    vacationDocuments: snapshot.docs.map(documentData),
    sourceQuery: `dp_vacations:endDate:${window.from}:${window.queryEnd}`,
    operational,
  });
}

export const NATASHA_AVAILABILITY_QUERY_LIMITS = {
  maxVacationDocuments: QUERY_LIMIT - 1,
  continuationDays: 14,
  maximumVacationDays: 30,
  maxAbsenceDocumentsPerSource: ABSENCE_TOTAL_LIMIT,
  maxAbsenceQueryDocumentsPerChunk: ABSENCE_QUERY_LIMIT - 1,
} as const;
