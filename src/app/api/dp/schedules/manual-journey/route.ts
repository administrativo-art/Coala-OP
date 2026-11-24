import { NextResponse, type NextRequest } from 'next/server';
import { stageManualJourneyDraft } from '@/features/dp/schedules/publication-service.server';
import { manualJourneyDraftSchema, type ManualJourneyDraftInput } from '@/features/dp/shifts/schemas';
import { requireUser, type ServerUserContext } from '@/lib/auth-server';
import { AppError } from '@/lib/observability/app-error';
import { defineSecurityContract } from '@/lib/security/route-contract';
import { defineSecurityEnforcer } from '@/lib/security/enforcer';
import { secureRoute } from '@/lib/security/secure-route.server';

export const runtime = 'nodejs';

const contract = defineSecurityContract({
  schemaVersion: 1, id: 'dp.schedules.manual-journey', version: 1,
  surface: { method: 'POST', path: '/api/dp/schedules/manual-journey' },
  exposure: 'authenticated', identity: { kind: 'active-user' },
  authorization: { kind: 'permission', action: 'dp.schedules.edit' },
  resourceScope: { kind: 'unit' },
  input: { kind: 'schema', schema: 'dp.schedule.manual-journey', unknownFields: 'reject' },
  effects: { mode: 'write', audit: 'server-authoritative' }, errorExposure: 'sanitized',
});

const enforcer = defineSecurityEnforcer<NextRequest, unknown, unknown, ServerUserContext,
  ManualJourneyDraftInput, null>({
  id: 'dp-schedule-manual-journey-v1',
  guarantees: ['authenticated-user', 'active-user', 'permission-checked', 'unit-scoped',
    'input-validated', 'fields-allowlisted'],
  async enforce({ request }) {
    const actor = await requireUser(request).catch((cause) => {
      throw new AppError({ code: 'AUTHENTICATION_REQUIRED', kind: 'AUTHENTICATION', cause });
    });
    if (!actor.isDefaultAdmin && actor.permissions.dp.schedules.edit !== true) {
      throw new AppError({ code: 'DP_SCHEDULE_DRAFT_FORBIDDEN', kind: 'AUTHORIZATION' });
    }
    const input = manualJourneyDraftSchema.safeParse(await request.json().catch(() => null));
    if (!input.success) throw new AppError({ code: 'DP_MANUAL_JOURNEY_INPUT_INVALID', kind: 'VALIDATION' });
    // The transaction checks edit access and workspace membership for every schedule it reads or writes.
    return { actor, input: input.data, resource: null };
  },
});

export const POST = secureRoute({ contract, enforcer }, async ({ security, observation }) =>
  NextResponse.json(await stageManualJourneyDraft(security.actor, security.input, observation.requestId),
    { headers: { 'Cache-Control': 'private, no-store' } }));
