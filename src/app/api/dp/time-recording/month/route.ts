import { NextResponse, type NextRequest } from 'next/server';

import { readOwnRepPMonth } from '@/features/dp/rep-p/own-month.server';
import { repPOwnMonthSchema, type RepPOwnMonthRequest } from '@/features/dp/rep-p/schemas';
import { requireUser, type ServerUserContext } from '@/lib/auth-server';
import { AppError } from '@/lib/observability/app-error';
import { defineSecurityEnforcer } from '@/lib/security/enforcer';
import { defineSecurityContract } from '@/lib/security/route-contract';
import { secureRoute } from '@/lib/security/secure-route.server';
import { rethrowServerAuthenticationFailure } from '@/lib/server-authentication-failure';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const path = '/api/dp/time-recording/month' as const;
const contract = defineSecurityContract({
  schemaVersion: 1, id: 'dp.time-recording.month.read-own', version: 1,
  surface: { method: 'GET', path }, exposure: 'authenticated', identity: { kind: 'active-user' },
  authorization: { kind: 'owner' }, resourceScope: { kind: 'owner' },
  input: { kind: 'schema', schema: 'dp.rep-p.own-month', unknownFields: 'reject' },
  effects: { mode: 'read', audit: 'none' }, errorExposure: 'sanitized',
});
const enforcer = defineSecurityEnforcer<NextRequest, unknown, unknown, ServerUserContext, RepPOwnMonthRequest,
  { workspaceId: string; employeeId: string }>({
  id: 'dp-rep-p-month-read-own-v1',
  guarantees: ['authenticated-user', 'active-user', 'owner-checked', 'input-validated', 'fields-allowlisted'],
  async enforce({ request }) {
    const actor = await requireUser(request).catch((cause) => rethrowServerAuthenticationFailure(cause));
    if (!actor.isDefaultAdmin && (actor.permissions.dashboard.collaborator ?? actor.permissions.dashboard.view) !== true) {
      throw new AppError({ code: 'REP_P_MONTH_FORBIDDEN', kind: 'AUTHORIZATION', safeMessage: 'Sem permissão para consultar sua escala.' });
    }
    const parsed = repPOwnMonthSchema.safeParse(Object.fromEntries(request.nextUrl.searchParams.entries()));
    if (!parsed.success) throw new AppError({ code: 'REP_P_MONTH_INPUT_INVALID', kind: 'VALIDATION', safeMessage: 'Mês inválido.' });
    return { actor, input: parsed.data, resource: { workspaceId: actor.workspace_id, employeeId: actor.decoded.uid } };
  },
});

export const GET = secureRoute({ contract, enforcer }, async ({ security }) => {
  const result = await readOwnRepPMonth(security.actor, security.input);
  return NextResponse.json(result, { headers: { 'Cache-Control': 'private, no-store' } });
});
