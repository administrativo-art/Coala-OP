import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';

import { canManageUnitTimeZone, setUnitTimeZone, unitTimeZoneSchema, type UnitTimeZoneInput } from '@/features/dp/rep-p/unit-time-zone.server';
import { requireUser, type ServerUserContext } from '@/lib/auth-server';
import { AppError } from '@/lib/observability/app-error';
import { defineSecurityEnforcer } from '@/lib/security/enforcer';
import { defineSecurityContract } from '@/lib/security/route-contract';
import { secureRoute } from '@/lib/security/secure-route.server';
import { rethrowServerAuthenticationFailure } from '@/lib/server-authentication-failure';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ unitId: string }> };
const routeSchema = z.object({ unitId: z.string().trim().min(1).max(180).regex(/^[A-Za-z0-9_-]+$/) }).strict();
const contract = defineSecurityContract({
  schemaVersion: 1, id: 'dp.units.time-zone.update', version: 1,
  surface: { method: 'PATCH', path: '/api/dp/units/[unitId]/time-zone' }, exposure: 'authenticated', identity: { kind: 'active-user' },
  authorization: { kind: 'permission', action: 'dp.units.manage' }, resourceScope: { kind: 'workspace' },
  input: { kind: 'schema', schema: 'dp.units.time-zone', unknownFields: 'reject' },
  effects: { mode: 'write', audit: 'server-authoritative' }, errorExposure: 'sanitized',
});
const enforcer = defineSecurityEnforcer<NextRequest, RouteContext, unknown, ServerUserContext, UnitTimeZoneInput,
  { workspaceId: string; unitId: string }>({
  id: 'dp-units-time-zone-update-v1',
  guarantees: ['authenticated-user', 'active-user', 'permission-checked', 'workspace-scoped', 'input-validated', 'fields-allowlisted'],
  async enforce({ request, routeContext }) {
    const actor = await requireUser(request).catch((cause) => rethrowServerAuthenticationFailure(cause));
    if (!canManageUnitTimeZone(actor)) {
      throw new AppError({ code: 'DP_UNIT_TIME_ZONE_FORBIDDEN', kind: 'AUTHORIZATION', safeMessage: 'Sem permissão para gerenciar unidades.' });
    }
    const route = routeSchema.safeParse(await routeContext.params);
    if (!route.success) throw new AppError({ code: 'DP_UNIT_ID_INVALID', kind: 'VALIDATION', safeMessage: 'Unidade inválida.' });
    const parsed = unitTimeZoneSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) throw new AppError({ code: 'DP_UNIT_TIME_ZONE_INVALID', kind: 'VALIDATION', safeMessage: 'Fuso horário inválido.' });
    return { actor, input: parsed.data, resource: { workspaceId: actor.workspace_id, unitId: route.data.unitId } };
  },
});

export const PATCH = secureRoute({ contract, enforcer }, async ({ security }) => {
  const result = await setUnitTimeZone(security.actor, security.resource.unitId, security.input);
  return NextResponse.json(result, { headers: { 'Cache-Control': 'private, no-store' } });
});
