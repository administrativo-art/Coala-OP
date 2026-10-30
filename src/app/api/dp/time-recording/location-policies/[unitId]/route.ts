import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';

import { canManageRepPLocationPolicy, readRepPLocationPolicy, repPLocationPolicyInputSchema,
  saveRepPLocationPolicy, type RepPLocationPolicyInput } from '@/features/dp/rep-p/location-policy.server';
import { requireUser, type ServerUserContext } from '@/lib/auth-server';
import { AppError } from '@/lib/observability/app-error';
import { defineSecurityEnforcer } from '@/lib/security/enforcer';
import { defineSecurityContract } from '@/lib/security/route-contract';
import { secureRoute } from '@/lib/security/secure-route.server';
import { rethrowServerAuthenticationFailure } from '@/lib/server-authentication-failure';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ unitId: string }> };
type Resource = { workspaceId: string; unitId: string };
const path = '/api/dp/time-recording/location-policies/[unitId]' as const;
const routeSchema = z.object({ unitId: z.string().trim().min(1).max(180).regex(/^[A-Za-z0-9_-]+$/) }).strict();

async function actorAndResource(request: NextRequest, routeContext: RouteContext) {
  if ([...request.nextUrl.searchParams.keys()].length) throw new AppError({ code: 'DP_TIME_LOCATION_POLICY_QUERY_INVALID', kind: 'VALIDATION' });
  const actor = await requireUser(request).catch((cause) => rethrowServerAuthenticationFailure(cause));
  const route = routeSchema.safeParse(await routeContext.params);
  if (!route.success) throw new AppError({ code: 'DP_TIME_LOCATION_POLICY_UNIT_INVALID', kind: 'VALIDATION', safeMessage: 'Unidade inválida.' });
  if (!canManageRepPLocationPolicy(actor, route.data.unitId)) {
    throw new AppError({ code: 'DP_TIME_LOCATION_POLICY_FORBIDDEN', kind: 'AUTHORIZATION', safeMessage: 'Sem permissão para configurar esta unidade.' });
  }
  return { actor, resource: { workspaceId: actor.workspace_id, unitId: route.data.unitId } };
}

const getContract = defineSecurityContract({
  schemaVersion: 1, id: 'dp.time-recording.location-policy.read', version: 1,
  surface: { method: 'GET', path }, exposure: 'authenticated', identity: { kind: 'active-user' },
  authorization: { kind: 'permission', action: 'dp.time.manage' }, resourceScope: { kind: 'unit' },
  input: { kind: 'none' }, effects: { mode: 'read', audit: 'none' }, errorExposure: 'sanitized',
});
const putContract = defineSecurityContract({
  schemaVersion: 1, id: 'dp.time-recording.location-policy.update', version: 1,
  surface: { method: 'PUT', path }, exposure: 'authenticated', identity: { kind: 'active-user' },
  authorization: { kind: 'permission', action: 'dp.time.manage' }, resourceScope: { kind: 'unit' },
  input: { kind: 'schema', schema: 'dp.time-recording.location-policy', unknownFields: 'reject' },
  effects: { mode: 'write', audit: 'server-authoritative' }, errorExposure: 'sanitized',
});

const getEnforcer = defineSecurityEnforcer<NextRequest, RouteContext, unknown, ServerUserContext, null, Resource>({
  id: 'dp-time-location-policy-read-v1',
  guarantees: ['authenticated-user', 'active-user', 'permission-checked', 'unit-scoped'],
  async enforce({ request, routeContext }) {
    const value = await actorAndResource(request, routeContext);
    return { ...value, input: null };
  },
});
const putEnforcer = defineSecurityEnforcer<NextRequest, RouteContext, unknown, ServerUserContext, RepPLocationPolicyInput, Resource>({
  id: 'dp-time-location-policy-update-v1',
  guarantees: ['authenticated-user', 'active-user', 'permission-checked', 'unit-scoped', 'input-validated', 'fields-allowlisted'],
  async enforce({ request, routeContext }) {
    const value = await actorAndResource(request, routeContext);
    const parsed = repPLocationPolicyInputSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) throw new AppError({ code: 'DP_TIME_LOCATION_POLICY_INPUT_INVALID', kind: 'VALIDATION',
      safeMessage: parsed.error.issues[0]?.message ?? 'Política inválida.' });
    return { ...value, input: parsed.data };
  },
});

export const GET = secureRoute({ contract: getContract, enforcer: getEnforcer }, async ({ security }) => {
  const result = await readRepPLocationPolicy(security.actor, security.resource.unitId);
  // Chave de navegador: chega somente à tela autorizada e continua protegida pelas restrições de site e API no Google Cloud.
  const mapsBrowserApiKey = process.env.GOOGLE_MAPS_BROWSER_API_KEY?.trim() || null;
  return NextResponse.json({ ...result, mapsBrowserApiKey }, { headers: { 'Cache-Control': 'private, no-store' } });
});

export const PUT = secureRoute({ contract: putContract, enforcer: putEnforcer }, async ({ security }) =>
  NextResponse.json(await saveRepPLocationPolicy(security.actor, security.resource.unitId, security.input),
    { headers: { 'Cache-Control': 'private, no-store' } }));
