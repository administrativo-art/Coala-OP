import { NextResponse, type NextRequest } from 'next/server';

import { requireUser, type ServerUserContext } from '@/lib/auth-server';
import { AppError } from '@/lib/observability/app-error';
import { defineSecurityContract } from '@/lib/security/route-contract';
import { defineSecurityEnforcer } from '@/lib/security/enforcer';
import { secureRoute } from '@/lib/security/secure-route.server';
import { rethrowServerAuthenticationFailure } from '@/lib/server-authentication-failure';
import { decideCorporateDevice, listCorporateDevices } from '@/features/mobile/corporate-device/server';
import { corporateDeviceDecisionSchema, type CorporateDeviceDecisionInput } from '@/features/mobile/corporate-device/schemas';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const path = '/api/users/[userId]/corporate-devices' as const;
type RouteContext = { params: Promise<{ userId: string }> };
type Resource = { userId: string };

async function base(request: NextRequest, routeContext: RouteContext) {
  const actor = await requireUser(request).catch((cause) => rethrowServerAuthenticationFailure(cause));
  const { userId } = await routeContext.params;
  if (!userId || [...request.nextUrl.searchParams.keys()].length) throw new AppError({ code: 'CORPORATE_DEVICE_ROUTE_INVALID', kind: 'VALIDATION' });
  return { actor, userId };
}

const getContract = defineSecurityContract({ schemaVersion: 1, id: 'users.corporate-devices.list', version: 1,
  surface: { method: 'GET', path }, exposure: 'authenticated', identity: { kind: 'active-user' },
  authorization: { kind: 'custom', strategy: 'manage-users' }, resourceScope: { kind: 'custom', strategy: 'employee-unit' },
  input: { kind: 'none' }, effects: { mode: 'read', audit: 'none' }, errorExposure: 'sanitized' });
const postContract = defineSecurityContract({ schemaVersion: 1, id: 'users.corporate-devices.decide', version: 1,
  surface: { method: 'POST', path }, exposure: 'authenticated', identity: { kind: 'active-user' },
  authorization: { kind: 'custom', strategy: 'manage-users' }, resourceScope: { kind: 'custom', strategy: 'employee-unit' },
  input: { kind: 'schema', schema: 'users.corporate-device.decision', unknownFields: 'reject' },
  effects: { mode: 'write', audit: 'server-authoritative' }, errorExposure: 'sanitized' });

const getEnforcer = defineSecurityEnforcer<NextRequest, RouteContext, unknown, ServerUserContext, undefined, Resource>({
  id: 'users-corporate-devices-list-v1', guarantees: ['authenticated-user', 'active-user', 'authorization:manage-users', 'scope:employee-unit'],
  async enforce({ request, routeContext }) { const value = await base(request, routeContext); return { actor: value.actor, input: undefined, resource: { userId: value.userId } }; },
});
const postEnforcer = defineSecurityEnforcer<NextRequest, RouteContext, unknown, ServerUserContext, CorporateDeviceDecisionInput, Resource>({
  id: 'users-corporate-devices-decide-v1', guarantees: ['authenticated-user', 'active-user', 'authorization:manage-users', 'scope:employee-unit', 'input-validated', 'fields-allowlisted'],
  async enforce({ request, routeContext }) { const value = await base(request, routeContext); const parsed = corporateDeviceDecisionSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) throw new AppError({ code: 'CORPORATE_DEVICE_DECISION_INVALID', kind: 'VALIDATION', safeMessage: 'Decisão inválida.' });
    return { actor: value.actor, input: parsed.data, resource: { userId: value.userId } }; },
});

export const GET = secureRoute({ contract: getContract, enforcer: getEnforcer }, async ({ security }) =>
  NextResponse.json(await listCorporateDevices(security.actor, security.resource.userId), { headers: { 'Cache-Control': 'private, no-store' } }));
export const POST = secureRoute({ contract: postContract, enforcer: postEnforcer }, async ({ security }) =>
  NextResponse.json(await decideCorporateDevice(security.actor, security.resource.userId, security.input), { headers: { 'Cache-Control': 'private, no-store' } }));
