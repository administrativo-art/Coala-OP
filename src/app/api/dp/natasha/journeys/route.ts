import { NextResponse, type NextRequest } from 'next/server';

import { loadNatashaJourneyDirectory } from '@/features/dp/natasha-journeys/service.server';
import { requireUser, type ServerUserContext } from '@/lib/auth-server';
import { natashaJourneyDirectoryRequestSchema } from '@/lib/natasha-journey-directory';
import { AppError } from '@/lib/observability';
import { defineSecurityEnforcer } from '@/lib/security/enforcer';
import { defineSecurityContract } from '@/lib/security/route-contract';
import { secureRoute } from '@/lib/security/secure-route.server';
import { canAccessUnit } from '@/lib/unit-access';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type StaticContext = { params: Promise<Record<string, never>> };
type Input = { period: string; unitIds: string[]; employeeIds: string[] };
type Resource = { unitIds: string[] };

const contract = defineSecurityContract({ schemaVersion: 1, id: 'dp.natasha.journeys.resolve', version: 1, surface: { method: 'GET', path: '/api/dp/natasha/journeys' }, exposure: 'authenticated', identity: { kind: 'active-user' }, authorization: { kind: 'permission', action: 'dp.schedules.view-team' }, resourceScope: { kind: 'custom', strategy: 'requested-unit-list' }, input: { kind: 'schema', schema: 'dp.natasha.journeys.query', unknownFields: 'reject' }, effects: { mode: 'read', audit: 'none' }, errorExposure: 'sanitized' });
const enforcer = defineSecurityEnforcer<NextRequest, StaticContext, unknown, ServerUserContext, Input, Resource>({
  id: 'dp-natasha-journeys-resolve-v1', guarantees: ['authenticated-user', 'active-user', 'permission-checked', 'scope:requested-unit-list', 'input-validated', 'fields-allowlisted'],
  async enforce({ request }) {
    const actor = await requireUser(request).catch((cause) => { throw new AppError({ code: 'AUTHENTICATION_REQUIRED', kind: 'AUTHENTICATION', cause }); });
    const canReadPeople = actor.permissions.settings.manageUsers === true
      || (actor.permissions.dp?.collaborators?.view === true && actor.permissions.dp.collaborators.ownProfileOnly !== true);
    if (!actor.isDefaultAdmin && (!actor.permissions.dp?.schedules?.view || !canReadPeople)) {
      throw new AppError({ code: 'NATASHA_JOURNEY_FORBIDDEN', kind: 'AUTHORIZATION', safeMessage: 'Sem permissão para resolver jornadas da equipe.' });
    }
    const parsed = natashaJourneyDirectoryRequestSchema.safeParse({ period: request.nextUrl.searchParams.get('period'), unitIds: request.nextUrl.searchParams.getAll('unit'), employeeIds: request.nextUrl.searchParams.getAll('employee') });
    if (!parsed.success) throw new AppError({ code: 'NATASHA_JOURNEY_QUERY_INVALID', kind: 'VALIDATION', safeMessage: 'Informe competência, unidades e a equipe confirmada sem repetições.', cause: parsed.error });
    if (parsed.data.unitIds.some((unitId) => !canAccessUnit(actor.userDoc, unitId, { isDefaultAdmin: actor.isDefaultAdmin }))) {
      throw new AppError({ code: 'NATASHA_JOURNEY_UNIT_FORBIDDEN', kind: 'AUTHORIZATION', safeMessage: 'Sem acesso a uma das unidades solicitadas.' });
    }
    return { actor, input: parsed.data, resource: { unitIds: parsed.data.unitIds } };
  },
});

export const GET = secureRoute({ contract, enforcer }, async ({ security }) => {
  const result = await loadNatashaJourneyDirectory({ context: security.actor, ...security.input });
  return NextResponse.json(result, {
    status: 200,
    headers: { 'Cache-Control': 'private, no-store' },
  });
});
