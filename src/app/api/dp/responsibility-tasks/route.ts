import { NextResponse, type NextRequest } from 'next/server';

import { responsibilityTaskListSchema } from '@/features/dp/responsibility-coverage/schemas';
import { listResponsibilityTasks } from '@/features/dp/responsibility-coverage/tasks.server';
import { requireUser, type ServerUserContext } from '@/lib/auth-server';
import { AppError } from '@/lib/observability/app-error';
import { defineSecurityEnforcer } from '@/lib/security/enforcer';
import { defineSecurityContract } from '@/lib/security/route-contract';
import { secureRoute } from '@/lib/security/secure-route.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = { params: Promise<Record<string, never>> };
type Resource = { workspaceId: string };
const contract = defineSecurityContract({
  schemaVersion: 1, id: 'dp.responsibility-tasks.list', version: 1,
  surface: { method: 'GET', path: '/api/dp/responsibility-tasks' }, exposure: 'authenticated',
  identity: { kind: 'active-user' }, authorization: { kind: 'permission', action: 'dp.schedules.edit-or-responsibility-alert' },
  resourceScope: { kind: 'workspace' }, input: { kind: 'schema', schema: 'dp.responsibility-tasks.list', unknownFields: 'reject' },
  effects: { mode: 'read', audit: 'none' }, errorExposure: 'sanitized',
});
const enforcer = defineSecurityEnforcer<NextRequest, Context, unknown, ServerUserContext, ReturnType<typeof responsibilityTaskListSchema.parse>, Resource>({
  id: 'dp-responsibility-tasks-list-v1', guarantees: ['authenticated-user', 'active-user', 'permission-checked', 'workspace-scoped', 'input-validated', 'fields-allowlisted'],
  async enforce({ request }) {
    const actor = await requireUser(request).catch((cause) => { throw new AppError({ code: 'AUTHENTICATION_REQUIRED', kind: 'AUTHENTICATION', cause }); });
    const parsed = responsibilityTaskListSchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
    if (!parsed.success) throw new AppError({ code: 'DP_RESPONSIBILITY_TASK_LIST_INPUT_INVALID', kind: 'VALIDATION' });
    if (!actor.isDefaultAdmin && actor.permissions.dp.schedules.edit !== true
      && actor.permissions.dp.responsibilities.manage !== true
      && actor.permissions.dp.responsibilities.receiveUnassignedAlerts !== true) {
      throw new AppError({ code: 'DP_RESPONSIBILITY_TASK_READ_FORBIDDEN', kind: 'AUTHORIZATION' });
    }
    return { actor, input: parsed.data, resource: { workspaceId: actor.workspace_id } };
  },
});

export const GET = secureRoute({ contract, enforcer }, async ({ security }) =>
  NextResponse.json(await listResponsibilityTasks(security.actor, security.input),
    { headers: { 'Cache-Control': 'private, no-store' } }));
