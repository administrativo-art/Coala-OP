import { NextRequest, NextResponse } from 'next/server';

import { requireTimeManager } from '@/features/dp/time-config/access.server';
import { createJourneySchema, type CreateJourneyInput } from '@/features/dp/time-config/schemas';
import { createTimeConfig, DP_TIME_COLLECTIONS, listTimeConfigs } from '@/features/dp/time-config/service.server';
import type { ServerUserContext } from '@/lib/auth-server';
import { AppError } from '@/lib/observability/app-error';
import { defineSecurityEnforcer } from '@/lib/security/enforcer';
import { defineSecurityContract } from '@/lib/security/route-contract';
import { secureRoute } from '@/lib/security/secure-route.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type StaticContext = { params: Promise<Record<string, never>> };
type WorkspaceResource = { workspaceId: string };

const getContract = defineSecurityContract({ schemaVersion: 1, id: 'dp.time.journeys.list', version: 1, surface: { method: 'GET', path: '/api/dp/time/journeys' }, exposure: 'authenticated', identity: { kind: 'active-user' }, authorization: { kind: 'permission', action: 'dp.time.manage' }, resourceScope: { kind: 'workspace' }, input: { kind: 'none' }, effects: { mode: 'read', audit: 'none' }, errorExposure: 'sanitized' });
const postContract = defineSecurityContract({ schemaVersion: 1, id: 'dp.time.journeys.create', version: 1, surface: { method: 'POST', path: '/api/dp/time/journeys' }, exposure: 'authenticated', identity: { kind: 'active-user' }, authorization: { kind: 'permission', action: 'dp.time.manage' }, resourceScope: { kind: 'workspace' }, input: { kind: 'schema', schema: 'dp.time.journey.create', unknownFields: 'reject' }, effects: { mode: 'write', audit: 'server-authoritative' }, errorExposure: 'sanitized' });

const getEnforcer = defineSecurityEnforcer<NextRequest, StaticContext, unknown, ServerUserContext, null, WorkspaceResource>({
  id: 'dp-time-journeys-list-v1', guarantees: ['authenticated-user', 'active-user', 'permission-checked', 'workspace-scoped'],
  async enforce({ request }) { const actor = await requireTimeManager(request); return { actor, input: null, resource: { workspaceId: actor.workspace_id } }; },
});
const postEnforcer = defineSecurityEnforcer<NextRequest, StaticContext, unknown, ServerUserContext, CreateJourneyInput, WorkspaceResource>({
  id: 'dp-time-journeys-create-v1', guarantees: ['authenticated-user', 'active-user', 'permission-checked', 'workspace-scoped', 'input-validated', 'fields-allowlisted'],
  async enforce({ request }) {
    const actor = await requireTimeManager(request);
    const parsed = createJourneySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) throw new AppError({ code: 'DP_JOURNEY_INPUT_INVALID', kind: 'VALIDATION', safeMessage: parsed.error.issues[0]?.message ?? 'Dados da jornada inválidos.' });
    return { actor, input: parsed.data, resource: { workspaceId: actor.workspace_id } };
  },
});

export const GET = secureRoute({ contract: getContract, enforcer: getEnforcer }, async ({ security }) =>
  NextResponse.json({ journeys: await listTimeConfigs(security.actor, DP_TIME_COLLECTIONS.journeys) }, { headers: { 'Cache-Control': 'private, no-store' } }));

export const POST = secureRoute({ contract: postContract, enforcer: postEnforcer }, async ({ security, observation }) =>
  NextResponse.json({ journey: await createTimeConfig({ context: security.actor, collectionName: DP_TIME_COLLECTIONS.journeys, input: security.input, requestId: observation.requestId }) }, { status: 201, headers: { 'Cache-Control': 'private, no-store' } }));
