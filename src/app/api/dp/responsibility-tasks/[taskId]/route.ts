import { NextResponse, type NextRequest } from 'next/server';

import { responsibilityTaskActionSchema, responsibilityTaskRouteSchema } from '@/features/dp/responsibility-coverage/schemas';
import { actOnResponsibilityTask } from '@/features/dp/responsibility-coverage/tasks.server';
import { requireUser, type ServerUserContext } from '@/lib/auth-server';
import { AppError } from '@/lib/observability/app-error';
import { defineSecurityEnforcer } from '@/lib/security/enforcer';
import { defineSecurityContract } from '@/lib/security/route-contract';
import { secureRoute } from '@/lib/security/secure-route.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ taskId: string }> };
type Resource = { workspaceId: string; taskId: string };
const contract = defineSecurityContract({
  schemaVersion: 1, id: 'dp.responsibility-tasks.action', version: 1,
  surface: { method: 'PATCH', path: '/api/dp/responsibility-tasks/[taskId]' }, exposure: 'authenticated',
  identity: { kind: 'active-user' }, authorization: { kind: 'permission', action: 'dp.schedules.edit' },
  resourceScope: { kind: 'workspace' }, input: { kind: 'schema', schema: 'dp.responsibility-tasks.action', unknownFields: 'reject' },
  effects: { mode: 'write', audit: 'server-authoritative' }, errorExposure: 'sanitized',
});
const enforcer = defineSecurityEnforcer<NextRequest, Context, unknown, ServerUserContext,
  ReturnType<typeof responsibilityTaskActionSchema.parse>, Resource>({
  id: 'dp-responsibility-tasks-action-v1', guarantees: ['authenticated-user', 'active-user', 'permission-checked', 'workspace-scoped', 'input-validated', 'fields-allowlisted'],
  async enforce({ request, routeContext }) {
    const actor = await requireUser(request).catch((cause) => { throw new AppError({ code: 'AUTHENTICATION_REQUIRED', kind: 'AUTHENTICATION', cause }); });
    const route = responsibilityTaskRouteSchema.safeParse(await routeContext.params);
    const input = responsibilityTaskActionSchema.safeParse(await request.json().catch(() => null));
    if (!route.success || !input.success) throw new AppError({ code: 'DP_RESPONSIBILITY_TASK_INPUT_INVALID', kind: 'VALIDATION' });
    if (!actor.isDefaultAdmin && actor.permissions.dp.schedules.edit !== true) {
      throw new AppError({ code: 'DP_RESPONSIBILITY_TASK_ACTION_FORBIDDEN', kind: 'AUTHORIZATION' });
    }
    return { actor, input: input.data, resource: { workspaceId: actor.workspace_id, taskId: route.data.taskId } };
  },
});

export const PATCH = secureRoute({ contract, enforcer }, async ({ security }) =>
  NextResponse.json({ task: await actOnResponsibilityTask(security.actor, security.resource.taskId, security.input) }));
