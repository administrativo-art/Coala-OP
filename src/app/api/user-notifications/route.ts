import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { requireUser, type ServerUserContext } from '@/lib/auth-server';
import { rethrowServerAuthenticationFailure } from '@/lib/server-authentication-failure';
import { AppError } from '@/lib/observability/app-error';
import { defineSecurityEnforcer } from '@/lib/security/enforcer';
import { defineSecurityContract } from '@/lib/security/route-contract';
import { secureRoute } from '@/lib/security/secure-route.server';
import { listUserNotifications, markUserNotificationsRead } from '@/features/notifications/user.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const id = z.string().regex(/^[a-f0-9]{64}$/);
const listSchema = z.object({ limit: z.coerce.number().int().min(1).max(50).default(25), cursor: id.optional() }).strict();
const readSchema = z.object({ ids: z.array(id).min(1).max(25) }).strict();
type Context = { params: Promise<Record<string, never>> };
type Resource = { ownerId: string; workspaceId: string };
const getContract = defineSecurityContract({ schemaVersion: 1, id: 'user-notifications.list', version: 1,
  surface: { method: 'GET', path: '/api/user-notifications' }, exposure: 'authenticated', identity: { kind: 'active-user' },
  authorization: { kind: 'owner' }, resourceScope: { kind: 'owner' }, input: { kind: 'schema', schema: 'user-notifications.list', unknownFields: 'reject' },
  effects: { mode: 'read', audit: 'none' }, errorExposure: 'sanitized' });
const patchContract = defineSecurityContract({ schemaVersion: 1, id: 'user-notifications.read', version: 1,
  surface: { method: 'PATCH', path: '/api/user-notifications' }, exposure: 'authenticated', identity: { kind: 'active-user' },
  authorization: { kind: 'owner' }, resourceScope: { kind: 'owner' }, input: { kind: 'schema', schema: 'user-notifications.mark-read', unknownFields: 'reject' },
  effects: { mode: 'write', audit: 'server-authoritative' }, errorExposure: 'sanitized' });
async function actorFor(request: NextRequest) {
  const actor = await requireUser(request).catch((error) => rethrowServerAuthenticationFailure(error));
  if (actor.userDoc.id !== actor.decoded.uid) throw new AppError({ code: 'USER_NOTIFICATION_OWNER_MISMATCH', kind: 'AUTHORIZATION' });
  return actor;
}
const getEnforcer = defineSecurityEnforcer<NextRequest, Context, unknown, ServerUserContext, z.infer<typeof listSchema>, Resource>({
  id: 'user-notifications-list-v1', guarantees: ['authenticated-user', 'active-user', 'owner-checked', 'input-validated', 'fields-allowlisted'],
  async enforce({ request }) {
    const actor = await actorFor(request);
    const parsed = listSchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
    if (!parsed.success) throw new AppError({ code: 'USER_NOTIFICATION_INPUT_INVALID', kind: 'VALIDATION' });
    return { actor, input: parsed.data, resource: { ownerId: actor.decoded.uid, workspaceId: actor.workspace_id } };
  },
});
const patchEnforcer = defineSecurityEnforcer<NextRequest, Context, unknown, ServerUserContext, z.infer<typeof readSchema>, Resource>({
  id: 'user-notifications-read-v1', guarantees: ['authenticated-user', 'active-user', 'owner-checked', 'input-validated', 'fields-allowlisted'],
  async enforce({ request }) {
    const actor = await actorFor(request);
    const parsed = readSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) throw new AppError({ code: 'USER_NOTIFICATION_INPUT_INVALID', kind: 'VALIDATION' });
    return { actor, input: parsed.data, resource: { ownerId: actor.decoded.uid, workspaceId: actor.workspace_id } };
  },
});
export const GET = secureRoute({ contract: getContract, enforcer: getEnforcer }, async ({ security }) => NextResponse.json(
  await listUserNotifications(security.actor, security.input), { headers: { 'Cache-Control': 'private, no-store' } }));
export const PATCH = secureRoute({ contract: patchContract, enforcer: patchEnforcer }, async ({ security }) => NextResponse.json(
  await markUserNotificationsRead(security.actor, security.input.ids), { headers: { 'Cache-Control': 'private, no-store' } }));
