import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { isCivilDate } from '@/features/dp/employment-reference/resolve';

import { EXTERNAL_CANDIDATE_MAX_RESULTS, listExternalCoverageCandidates } from '@/features/dp/external-candidates/service.server';
import { requireUser, type ServerUserContext } from '@/lib/auth-server';
import { dbAdmin } from '@/lib/firebase-admin';
import { AppError } from '@/lib/observability/app-error';
import { createInMemoryRateLimiter } from '@/lib/observability/rate-limit';
import { defineSecurityEnforcer } from '@/lib/security/enforcer';
import { defineSecurityContract } from '@/lib/security/route-contract';
import { secureRoute } from '@/lib/security/secure-route.server';
import { canAccessUnit } from '@/lib/unit-access';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type RouteContext = { params: Promise<{ scheduleId: string }> };
type Input = { search: string; limit: number; date?: string };
type Resource = { unitId: string; scheduleId: string };
const routeSchema = z.object({ scheduleId: z.string().trim().min(1).max(180) }).strict();
const querySchema = z.object({ search: z.string().trim().min(2).max(80), limit: z.coerce.number().int().min(1).max(EXTERNAL_CANDIDATE_MAX_RESULTS).default(15),
  date: z.preprocess((value) => value === '' ? undefined : value, z.string().refine(isCivilDate).optional()) }).strict();
const searchLimiter = createInMemoryRateLimiter({ limit: 30, windowMs: 60_000, maxKeys: 5_000 });
const contract = defineSecurityContract({ schemaVersion: 1, id: 'dp.schedules.external-candidates.list', version: 1, surface: { method: 'GET', path: '/api/dp/schedules/[scheduleId]/external-candidates' }, exposure: 'authenticated', identity: { kind: 'active-user' }, authorization: { kind: 'permission', action: 'dp.schedules.assign-external' }, resourceScope: { kind: 'unit' }, input: { kind: 'schema', schema: 'dp.schedules.external-candidates.query', unknownFields: 'reject' }, effects: { mode: 'read', audit: 'none' }, errorExposure: 'sanitized' });
const enforcer = defineSecurityEnforcer<NextRequest, RouteContext, unknown, ServerUserContext, Input, Resource>({
  id: 'dp-schedules-external-candidates-list-v1', guarantees: ['authenticated-user', 'active-user', 'permission-checked', 'unit-scoped', 'input-validated', 'fields-allowlisted'],
  async enforce({ request, routeContext }) {
    const actor = await requireUser(request).catch((cause) => { throw new AppError({ code: 'DP_EXTERNAL_CANDIDATES_AUTH_REQUIRED', kind: 'AUTHENTICATION', cause }); });
    if (!actor.isDefaultAdmin && (actor.permissions.dp.schedules.view !== true || actor.permissions.dp.schedules.edit !== true || actor.permissions.dp.schedules.assignExternal !== true)) throw new AppError({ code: 'DP_EXTERNAL_CANDIDATES_FORBIDDEN', kind: 'AUTHORIZATION', safeMessage: 'Sem permissão para consultar coberturas externas.' });
    const route = routeSchema.safeParse(await routeContext.params);
    const query = querySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams.entries()));
    if (!route.success || !query.success) throw new AppError({ code: 'DP_EXTERNAL_CANDIDATES_INPUT_INVALID', kind: 'VALIDATION', safeMessage: 'Informe ao menos dois caracteres para buscar.' });
    const schedule = await dbAdmin.collection('dp_schedules').doc(route.data.scheduleId).get();
    const unitId = schedule.get('unitId');
    if (!schedule.exists || typeof unitId !== 'string' || !unitId) throw new AppError({ code: 'DP_EXTERNAL_CANDIDATES_SCHEDULE_INVALID', kind: 'NOT_FOUND', safeMessage: 'Escala não encontrada.' });
    if (!canAccessUnit(actor.userDoc, unitId, { isDefaultAdmin: actor.isDefaultAdmin })) throw new AppError({ code: 'DP_EXTERNAL_CANDIDATES_UNIT_FORBIDDEN', kind: 'AUTHORIZATION', safeMessage: 'Sem acesso à unidade desta escala.' });
    return { actor, input: query.data, resource: { unitId, scheduleId: route.data.scheduleId } };
  },
});

export const GET = secureRoute({ contract, enforcer }, async ({ security }) => {
  const rate = searchLimiter.check(`${security.actor.decoded.uid}:${security.resource.scheduleId}`);
  if (!rate.allowed) {
    throw new AppError({
      code: 'DP_EXTERNAL_CANDIDATES_RATE_LIMITED',
      kind: 'EXPECTED_BUSINESS',
      httpStatus: 429,
      safeMessage: 'Muitas buscas foram feitas. Aguarde um instante e tente novamente.',
    });
  }
  return NextResponse.json(await listExternalCoverageCandidates({ context: security.actor, scheduleId: security.resource.scheduleId, search: security.input.search, limit: security.input.limit, date: security.input.date }), { headers: { 'Cache-Control': 'private, no-store' } });
});
