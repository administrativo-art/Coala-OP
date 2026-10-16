import { NextResponse, type NextRequest } from 'next/server';
import type { ServerUserContext } from '@/lib/auth-server';
import { requireUser } from '@/lib/auth-server';
import { registerPushDevice, removePushDevice } from '@/features/mobile/push/devices.server';
import { registerPushDeviceSchema, removePushDeviceSchema, type RegisterPushDeviceInput, type RemovePushDeviceInput } from '@/features/mobile/push/schemas';
import { AppError } from '@/lib/observability/app-error';
import { rethrowServerAuthenticationFailure } from '@/lib/server-authentication-failure';
import { defineSecurityEnforcer } from '@/lib/security/enforcer';
import { assertMobileAppAttested } from '@/lib/security/mobile-app-attestation.server';
import { defineSecurityContract } from '@/lib/security/route-contract';
import { secureRoute } from '@/lib/security/secure-route.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<Record<string, never>> };
type Resource = { ownerId: string; workspaceId: string };

async function actorFor(request: NextRequest) {
  const actor = await requireUser(request).catch((cause) => rethrowServerAuthenticationFailure(cause));
  assertMobileAppAttested(request, actor.decoded.uid);
  if (actor.userDoc.id !== actor.decoded.uid) throw new AppError({ code: 'PUSH_OWNER_MISMATCH', kind: 'AUTHORIZATION' });
  return actor;
}

const postContract = defineSecurityContract({ schemaVersion: 1, id: 'mobile.push.devices.register', version: 1, surface: { method: 'POST', path: '/api/mobile/push/devices' }, exposure: 'authenticated', identity: { kind: 'active-user' }, authorization: { kind: 'owner' }, resourceScope: { kind: 'owner' }, input: { kind: 'schema', schema: 'mobile.push.register', unknownFields: 'reject' }, effects: { mode: 'write', audit: 'server-authoritative' }, errorExposure: 'sanitized' });
const deleteContract = defineSecurityContract({ schemaVersion: 1, id: 'mobile.push.devices.remove', version: 1, surface: { method: 'DELETE', path: '/api/mobile/push/devices' }, exposure: 'authenticated', identity: { kind: 'active-user' }, authorization: { kind: 'owner' }, resourceScope: { kind: 'owner' }, input: { kind: 'schema', schema: 'mobile.push.remove', unknownFields: 'reject' }, effects: { mode: 'delete', audit: 'server-authoritative' }, errorExposure: 'sanitized' });

const postEnforcer = defineSecurityEnforcer<NextRequest, Context, unknown, ServerUserContext, RegisterPushDeviceInput, Resource>({
  id: 'mobile-push-register-v1', guarantees: ['authenticated-user', 'active-user', 'owner-checked', 'input-validated', 'fields-allowlisted'],
  async enforce({ request }) {
    const actor = await actorFor(request);
    const parsed = registerPushDeviceSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) throw new AppError({ code: 'PUSH_DEVICE_INPUT_INVALID', kind: 'VALIDATION', safeMessage: 'Dados do aparelho inválidos.' });
    return { actor, input: parsed.data, resource: { ownerId: actor.decoded.uid, workspaceId: actor.workspace_id } };
  },
});
const deleteEnforcer = defineSecurityEnforcer<NextRequest, Context, unknown, ServerUserContext, RemovePushDeviceInput, Resource>({
  id: 'mobile-push-remove-v1', guarantees: ['authenticated-user', 'active-user', 'owner-checked', 'input-validated', 'fields-allowlisted'],
  async enforce({ request }) {
    const actor = await actorFor(request);
    const parsed = removePushDeviceSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) throw new AppError({ code: 'PUSH_DEVICE_INPUT_INVALID', kind: 'VALIDATION', safeMessage: 'Dados do aparelho inválidos.' });
    return { actor, input: parsed.data, resource: { ownerId: actor.decoded.uid, workspaceId: actor.workspace_id } };
  },
});

export const POST = secureRoute({ contract: postContract, enforcer: postEnforcer }, async ({ security }) => NextResponse.json(
  await registerPushDevice(security.actor, security.input), { headers: { 'Cache-Control': 'no-store' } },
));
export const DELETE = secureRoute({ contract: deleteContract, enforcer: deleteEnforcer }, async ({ security }) => NextResponse.json(
  await removePushDevice(security.actor, security.input.installationId), { headers: { 'Cache-Control': 'no-store' } },
));
