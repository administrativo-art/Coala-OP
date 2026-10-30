import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';

import { requireUser, type ServerUserContext } from '@/lib/auth-server';
import { AppError } from '@/lib/observability/app-error';
import { assertOfficialMobileApp } from '@/lib/security/mobile-app-attestation.server';
import { defineSecurityContract } from '@/lib/security/route-contract';
import { defineSecurityEnforcer } from '@/lib/security/enforcer';
import { secureRoute } from '@/lib/security/secure-route.server';
import { rethrowServerAuthenticationFailure } from '@/lib/server-authentication-failure';
import { ownCorporateDevice, requestCorporateDevice } from '@/features/mobile/corporate-device/server';
import { corporateDeviceRequestSchema, type CorporateDeviceRequestInput } from '@/features/mobile/corporate-device/schemas';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const path = '/api/mobile/corporate-device' as const;
const querySchema = z.object({ installationId: z.string().uuid() }).strict();
type Resource = { ownerId: string };

async function actor(request: NextRequest) {
  const current = await requireUser(request).catch((cause) => rethrowServerAuthenticationFailure(cause));
  assertOfficialMobileApp(request, current.decoded.uid);
  return current;
}

const getContract = defineSecurityContract({ schemaVersion: 1, id: 'mobile.corporate-device.read-own', version: 1,
  surface: { method: 'GET', path }, exposure: 'authenticated', identity: { kind: 'active-user' }, authorization: { kind: 'owner' },
  resourceScope: { kind: 'owner' }, input: { kind: 'schema', schema: 'mobile.corporate-device.status-query', unknownFields: 'reject' },
  effects: { mode: 'read', audit: 'none' }, errorExposure: 'sanitized', additionalGuarantees: ['control:mobile-app-attested'] });
const postContract = defineSecurityContract({ schemaVersion: 1, id: 'mobile.corporate-device.request-own', version: 1,
  surface: { method: 'POST', path }, exposure: 'authenticated', identity: { kind: 'active-user' }, authorization: { kind: 'owner' },
  resourceScope: { kind: 'owner' }, input: { kind: 'schema', schema: 'mobile.corporate-device.request', unknownFields: 'reject' },
  effects: { mode: 'write', audit: 'server-authoritative' }, errorExposure: 'sanitized', additionalGuarantees: ['control:mobile-app-attested'] });

const getEnforcer = defineSecurityEnforcer<NextRequest, unknown, unknown, ServerUserContext, { installationId: string }, Resource>({
  id: 'mobile-corporate-device-read-own-v1', guarantees: ['authenticated-user', 'active-user', 'owner-checked', 'input-validated', 'fields-allowlisted', 'control:mobile-app-attested'],
  async enforce({ request }) { const current = await actor(request); const raw = Object.fromEntries(request.nextUrl.searchParams.entries());
    const parsed = querySchema.safeParse(raw); if (!parsed.success) throw new AppError({ code: 'CORPORATE_DEVICE_QUERY_INVALID', kind: 'VALIDATION' });
    return { actor: current, input: parsed.data, resource: { ownerId: current.decoded.uid } }; },
});
const postEnforcer = defineSecurityEnforcer<NextRequest, unknown, unknown, ServerUserContext, CorporateDeviceRequestInput, Resource>({
  id: 'mobile-corporate-device-request-own-v1', guarantees: ['authenticated-user', 'active-user', 'owner-checked', 'input-validated', 'fields-allowlisted', 'control:mobile-app-attested'],
  async enforce({ request }) { const current = await actor(request); const parsed = corporateDeviceRequestSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) throw new AppError({ code: 'CORPORATE_DEVICE_INPUT_INVALID', kind: 'VALIDATION', safeMessage: 'Dados do aparelho inválidos.' });
    return { actor: current, input: parsed.data, resource: { ownerId: current.decoded.uid } }; },
});

export const GET = secureRoute({ contract: getContract, enforcer: getEnforcer }, async ({ security }) =>
  NextResponse.json(await ownCorporateDevice(security.actor, security.input.installationId), { headers: { 'Cache-Control': 'private, no-store' } }));
export const POST = secureRoute({ contract: postContract, enforcer: postEnforcer }, async ({ security }) =>
  NextResponse.json(await requestCorporateDevice(security.actor, security.input), { headers: { 'Cache-Control': 'private, no-store' } }));
