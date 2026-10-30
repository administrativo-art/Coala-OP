import { NextResponse, type NextRequest } from 'next/server';

import { issueOwnJourneyLocationLease } from '@/features/dp/rep-p/journey-location-lease.server';
import { journeyLocationLeaseSchema, type JourneyLocationLeaseInput } from '@/features/dp/rep-p/schemas';
import { requireUser, type ServerUserContext } from '@/lib/auth-server';
import { AppError } from '@/lib/observability/app-error';
import { defineSecurityEnforcer } from '@/lib/security/enforcer';
import { assertOfficialMobileApp } from '@/lib/security/mobile-app-attestation.server';
import { defineSecurityContract } from '@/lib/security/route-contract';
import { secureRoute } from '@/lib/security/secure-route.server';
import { rethrowServerAuthenticationFailure } from '@/lib/server-authentication-failure';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const path = '/api/dp/time-recording/journey-location/lease' as const;
const contract = defineSecurityContract({ schemaVersion: 1, id: 'dp.time-recording.journey-location.lease-own', version: 1,
  surface: { method: 'POST', path }, exposure: 'authenticated', identity: { kind: 'active-user' },
  authorization: { kind: 'owner' }, resourceScope: { kind: 'owner' },
  input: { kind: 'schema', schema: 'dp.rep-p.journey-location-lease', unknownFields: 'reject' },
  effects: { mode: 'write', audit: 'server-authoritative' }, errorExposure: 'sanitized',
  additionalGuarantees: ['control:mobile-app-attested', 'authorization:live-shift-policy'], });
const enforcer = defineSecurityEnforcer<NextRequest, unknown, unknown, ServerUserContext, JourneyLocationLeaseInput,
  { workspaceId: string; employeeId: string }>({ id: 'dp-rep-p-journey-location-lease-own-v1',
  guarantees: ['authenticated-user', 'active-user', 'owner-checked', 'workspace-scoped', 'input-validated', 'fields-allowlisted',
    'control:mobile-app-attested', 'authorization:live-shift-policy'],
  async enforce({ request }) {
    const actor = await requireUser(request).catch((cause) => rethrowServerAuthenticationFailure(cause));
    assertOfficialMobileApp(request, actor.decoded.uid);
    if ([...request.nextUrl.searchParams.keys()].length) throw new AppError({ code: 'DP_JOURNEY_LOCATION_LEASE_QUERY_INVALID', kind: 'VALIDATION' });
    const parsed = journeyLocationLeaseSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) throw new AppError({ code: 'DP_JOURNEY_LOCATION_LEASE_INPUT_INVALID', kind: 'VALIDATION', safeMessage: parsed.error.issues[0]?.message });
    return { actor, input: parsed.data, resource: { workspaceId: actor.workspace_id, employeeId: actor.decoded.uid } };
  }, });
export const POST = secureRoute({ contract, enforcer }, async ({ security }) =>
  NextResponse.json(await issueOwnJourneyLocationLease(security.actor, security.input), { headers: { 'Cache-Control': 'private, no-store' } }));
