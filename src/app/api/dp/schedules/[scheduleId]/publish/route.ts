import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { publishSchedule } from '@/features/dp/schedules/publication-service.server';
import { bulkWorkShiftRouteSchema } from '@/features/dp/shifts/schemas';
import { requireUser, type ServerUserContext } from '@/lib/auth-server';
import { dbAdmin } from '@/lib/firebase-admin';
import { AppError } from '@/lib/observability/app-error';
import { defineSecurityContract } from '@/lib/security/route-contract';
import { defineSecurityEnforcer } from '@/lib/security/enforcer';
import { secureRoute } from '@/lib/security/secure-route.server';
import { canAccessUnit } from '@/lib/unit-access';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ scheduleId: string }> };
const bodySchema = z.object({ expectedDraftVersion: z.number().int().min(0) }).strict();
const contract = defineSecurityContract({ schemaVersion: 1, id: 'dp.schedules.publish', version: 1,
  surface: { method: 'POST', path: '/api/dp/schedules/[scheduleId]/publish' }, exposure: 'authenticated',
  identity: { kind: 'active-user' }, authorization: { kind: 'permission', action: 'dp.schedules.publish' },
  resourceScope: { kind: 'unit' }, input: { kind: 'schema', schema: 'dp.schedule.publish', unknownFields: 'reject' },
  effects: { mode: 'write', audit: 'server-authoritative' }, errorExposure: 'sanitized' });
const enforcer = defineSecurityEnforcer<NextRequest, RouteContext, unknown, ServerUserContext,
  z.infer<typeof bodySchema>, { scheduleId: string; unitId: string }>({
  id: 'dp-schedule-publish-v1', guarantees: ['authenticated-user', 'active-user', 'permission-checked',
    'unit-scoped', 'input-validated', 'fields-allowlisted'],
  async enforce({ request, routeContext }) {
    const actor = await requireUser(request).catch((cause) => {
      throw new AppError({ code: 'AUTHENTICATION_REQUIRED', kind: 'AUTHENTICATION', cause });
    });
    if (!actor.isDefaultAdmin && (actor.permissions.dp.schedules.publish !== true
      || actor.permissions.dp.schedules.edit !== true)) {
      throw new AppError({ code: 'DP_SCHEDULE_PUBLISH_FORBIDDEN', kind: 'AUTHORIZATION' });
    }
    const parsed = bulkWorkShiftRouteSchema.safeParse(await routeContext.params);
    const body = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success || !body.success) throw new AppError({ code: 'DP_SCHEDULE_PUBLISH_INPUT_INVALID', kind: 'VALIDATION' });
    const schedule = await dbAdmin.collection('dp_schedules').doc(parsed.data.scheduleId).get();
    if (!schedule.exists) throw new AppError({ code: 'DP_SCHEDULE_NOT_FOUND', kind: 'NOT_FOUND' });
    const unitId = schedule.get('unitId');
    if (typeof unitId !== 'string' || !canAccessUnit(actor.userDoc, unitId, { isDefaultAdmin: actor.isDefaultAdmin })) {
      throw new AppError({ code: 'DP_SCHEDULE_UNIT_FORBIDDEN', kind: 'AUTHORIZATION' });
    }
    return { actor, input: body.data, resource: { scheduleId: parsed.data.scheduleId, unitId } };
  },
});

export const POST = secureRoute({ contract, enforcer }, async ({ security, observation }) =>
  NextResponse.json(await publishSchedule(security.actor, security.resource.scheduleId,
    observation.requestId, security.input.expectedDraftVersion),
  { headers: { 'Cache-Control': 'private, no-store' } }));
