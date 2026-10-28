import { NextResponse, type NextRequest } from 'next/server';
import { canReadLocation, locationAccessSchema, readLocation, type LocationAccessInput } from '@/features/dp/rep-p/location-access.server';
import { requireAuthenticatedUser, type ServerUserContext } from '@/lib/auth-server';
import { AppError } from '@/lib/observability/app-error';
import { defineSecurityEnforcer } from '@/lib/security/enforcer';
import { defineSecurityContract } from '@/lib/security/route-contract';
import { secureRoute } from '@/lib/security/secure-route.server';
import { rethrowServerAuthenticationFailure } from '@/lib/server-authentication-failure';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type RouteContext = { params: Promise<Record<string, never>> };
type Resource = { workspaceId: string; unitId: string; employeeUid: string };
const contract = defineSecurityContract({
  schemaVersion: 1, id: 'dp.time-recording.location-access.read', version: 1,
  surface: { method: 'POST', path: '/api/dp/time-recording/location-access' }, exposure: 'authenticated',
  identity: { kind: 'active-user' }, authorization: { kind: 'custom', strategy: 'location-owner-or-explicit-reader' },
  resourceScope: { kind: 'unit' },
  input: { kind: 'schema', schema: 'dp.time-recording.location-access', unknownFields: 'reject' },
  effects: { mode: 'write', audit: 'server-authoritative' }, errorExposure: 'sanitized',
});
const enforcer = defineSecurityEnforcer<NextRequest, RouteContext, unknown, ServerUserContext, LocationAccessInput, Resource>({
  id: 'dp-time-location-access-v1',
  guarantees: ['authenticated-user', 'active-user', 'permission-checked', 'authorization:location-owner-or-explicit-reader', 'unit-scoped', 'input-validated', 'fields-allowlisted', 'server-authoritative-audit'],
  async enforce({ request }) {
    const actor = await requireAuthenticatedUser(request).catch((cause) => rethrowServerAuthenticationFailure(cause));
    const parsed = locationAccessSchema.safeParse(await request.json().catch(() => null));
    if (request.nextUrl.search || !parsed.success) throw new AppError({ code: 'REP_P_LOCATION_ACCESS_INPUT_INVALID', kind: 'VALIDATION' });
    if (!canReadLocation(actor, parsed.data)) throw new AppError({ code: 'REP_P_LOCATION_ACCESS_FORBIDDEN', kind: 'AUTHORIZATION' });
    return { actor, input: parsed.data, resource: { workspaceId: actor.workspace_id, unitId: parsed.data.unitId, employeeUid: parsed.data.employeeUid } };
  },
});
export const POST = secureRoute({ contract, enforcer }, async ({ security }) =>
  NextResponse.json(await readLocation(security.actor, security.input), { headers: { 'Cache-Control': 'private, no-store' } }));
