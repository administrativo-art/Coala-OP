import { NextResponse, type NextRequest } from 'next/server';

import { listScheduleAbsences } from '@/features/dp/schedules/read-service.server';
import { bulkWorkShiftRouteSchema } from '@/features/dp/shifts/schemas';
import { requireUser, type ServerUserContext } from '@/lib/auth-server';
import { AppError } from '@/lib/observability/app-error';
import { defineSecurityEnforcer } from '@/lib/security/enforcer';
import { defineSecurityContract } from '@/lib/security/route-contract';
import { secureRoute } from '@/lib/security/secure-route.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ scheduleId: string }> };
type Resource = { workspaceId: string; scheduleId: string };

const contract = defineSecurityContract({
  schemaVersion: 1,
  id: 'dp.schedules.absences.list',
  version: 1,
  surface: { method: 'GET', path: '/api/dp/schedules/[scheduleId]/absences' },
  exposure: 'authenticated',
  identity: { kind: 'active-user' },
  authorization: { kind: 'permission', action: 'dp.schedules.view' },
  resourceScope: { kind: 'unit' },
  input: { kind: 'schema', schema: 'dp.schedule.route', unknownFields: 'reject' },
  effects: { mode: 'read', audit: 'none' },
  errorExposure: 'sanitized',
});

const enforcer = defineSecurityEnforcer<NextRequest, RouteContext, unknown, ServerUserContext, null, Resource>({
  id: 'dp-schedule-absences-list-v1',
  guarantees: ['authenticated-user', 'active-user', 'permission-checked', 'unit-scoped', 'input-validated', 'fields-allowlisted'],
  async enforce({ request, routeContext }) {
    const actor = await requireUser(request).catch((cause) => {
      throw new AppError({ code: 'AUTHENTICATION_REQUIRED', kind: 'AUTHENTICATION', cause });
    });
    const parsed = bulkWorkShiftRouteSchema.safeParse(await routeContext.params);
    if (!parsed.success) throw new AppError({ code: 'DP_SCHEDULE_ID_INVALID', kind: 'VALIDATION' });
    return { actor, input: null, resource: { workspaceId: actor.workspace_id, scheduleId: parsed.data.scheduleId } };
  },
});

export const GET = secureRoute({ contract, enforcer }, async ({ security }) =>
  NextResponse.json(
    { absences: await listScheduleAbsences(security.actor, security.resource.scheduleId) },
    { headers: { 'Cache-Control': 'private, no-store' } },
  ));
