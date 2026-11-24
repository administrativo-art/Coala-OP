import type { z } from 'zod';
import { NextResponse, type NextRequest } from 'next/server';
import { dayCorrectionAction, dayCorrectionQuery } from '@/features/dp/time-adjustments/day-corrections';
import { actOnDayCorrection, authorizeDayCorrection, listDayCorrections } from '@/features/dp/time-adjustments/day-corrections.server';
import { requireUser, type ServerUserContext } from '@/lib/auth-server';
import { AppError } from '@/lib/observability/app-error';
import { defineSecurityEnforcer } from '@/lib/security/enforcer';
import { defineSecurityContract } from '@/lib/security/route-contract';
import { secureRoute } from '@/lib/security/secure-route.server';
import { rethrowServerAuthenticationFailure } from '@/lib/server-authentication-failure';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const path = '/api/dp/time-recording/day-corrections' as const;
const contract = (method: 'GET' | 'POST') => defineSecurityContract({
  schemaVersion: 1, id: 'dp.day-corrections.' + method.toLowerCase(), version: 1,
  surface: { method, path }, exposure: 'authenticated', identity: { kind: 'active-user' },
  authorization: { kind: 'custom', strategy: 'day-correction-owner-or-scoped-reviewer' }, resourceScope: { kind: 'workspace' },
  input: { kind: 'schema', schema: 'dp.day-corrections', unknownFields: 'reject' },
  effects: { mode: method === 'GET' ? 'read' : 'write', audit: method === 'GET' ? 'none' : 'server-authoritative' },
  errorExposure: 'sanitized',
});
async function actorFor(request: NextRequest) {
  return requireUser(request).catch((cause) => rethrowServerAuthenticationFailure(cause));
}
const enforcer = defineSecurityEnforcer<NextRequest, unknown, unknown, ServerUserContext, { query?: z.infer<typeof dayCorrectionQuery>; action?: z.infer<typeof dayCorrectionAction> }, { workspaceId: string }>({
  id: 'dp-day-corrections-v1', guarantees: ['authenticated-user', 'active-user', 'authorization:day-correction-owner-or-scoped-reviewer', 'owner-checked', 'permission-checked', 'workspace-scoped', 'input-validated', 'fields-allowlisted'],
  async enforce({ request }) {
    const actor = await actorFor(request);
    const input = request.method === 'GET'
      ? dayCorrectionQuery.safeParse(Object.fromEntries(request.nextUrl.searchParams.entries()))
      : dayCorrectionAction.safeParse(await request.json().catch(() => null));
    if (!input.success) throw new AppError({ code: 'PTRP_DAY_CORRECTION_INPUT_INVALID', kind: 'VALIDATION', safeMessage: input.error.issues[0]?.message ?? 'Pedido inválido.' });
    await authorizeDayCorrection(actor, input.data);
    return { actor, input: request.method === 'GET' ? { query: input.data as z.infer<typeof dayCorrectionQuery> } : { action: input.data as z.infer<typeof dayCorrectionAction> }, resource: { workspaceId: actor.workspace_id } };
  },
});
export const GET = secureRoute({ contract: contract('GET'), enforcer }, async ({ security }) => {
  const query = security.input.query!;
  return NextResponse.json(await listDayCorrections(security.actor, query.month, query.employeeUid), { headers: { 'Cache-Control': 'private, no-store' } });
});
export const POST = secureRoute({ contract: contract('POST'), enforcer }, async ({ security }) =>
  NextResponse.json(await actOnDayCorrection(security.actor, security.input.action!), { headers: { 'Cache-Control': 'private, no-store' } }));
