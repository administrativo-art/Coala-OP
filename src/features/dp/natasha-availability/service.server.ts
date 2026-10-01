import 'server-only';

import type { QueryDocumentSnapshot } from 'firebase-admin/firestore';

import { loadNatashaTeam } from '@/features/dp/natasha-team/service.server';
import type { ServerUserContext } from '@/lib/auth-server';
import { dbAdmin } from '@/lib/firebase-admin';
import { natashaAvailabilityWindow, prepareNatashaAvailability } from '@/lib/natasha-availability';
import { AppError } from '@/lib/observability';

const QUERY_LIMIT = 301;
const PROJECTED_FIELDS = ['userId', 'startDate', 'endDate', 'recordType', 'status'] as const;

function documentData(document: QueryDocumentSnapshot) {
  return { id: document.id, ...document.data() };
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

  return prepareNatashaAvailability({
    period,
    team,
    vacationDocuments: snapshot.docs.map(documentData),
    sourceQuery: `dp_vacations:endDate:${window.from}:${window.queryEnd}`,
  });
}

export const NATASHA_AVAILABILITY_QUERY_LIMITS = {
  maxVacationDocuments: QUERY_LIMIT - 1,
  continuationDays: 14,
  maximumVacationDays: 30,
} as const;
