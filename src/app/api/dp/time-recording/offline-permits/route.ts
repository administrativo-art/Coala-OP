import { NextResponse, type NextRequest } from 'next/server';

import { repPOfflinePermitSchema, type RepPOfflinePermitRequest } from '@/features/dp/rep-p/schemas';
import { issueOwnRepPOfflinePermit } from '@/features/dp/rep-p/service.server';
import { requireUser, type ServerUserContext } from '@/lib/auth-server';
import { AppError } from '@/lib/observability/app-error';
import { defineSecurityEnforcer } from '@/lib/security/enforcer';
import { assertOfficialMobileApp } from '@/lib/security/mobile-app-attestation.server';
import { defineSecurityContract } from '@/lib/security/route-contract';
import { secureRoute } from '@/lib/security/secure-route.server';
import { rethrowServerAuthenticationFailure } from '@/lib/server-authentication-failure';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const path = '/api/dp/time-recording/offline-permits' as const;
const contract = defineSecurityContract({
  schemaVersion: 1, id: 'dp.time-recording.offline-permits.create', version: 1,
  surface: { method: 'POST', path }, exposure: 'authenticated', identity: { kind: 'active-user' },
  authorization: { kind: 'owner' }, resourceScope: { kind: 'owner' },
  input: { kind: 'schema', schema: 'dp.rep-p.offline-permit', unknownFields: 'reject' },
  effects: { mode: 'write', audit: 'server-authoritative' }, errorExposure: 'sanitized',
  additionalGuarantees: ['replay-protected', 'control:mobile-app-attested'],
});
const enforcer = defineSecurityEnforcer<NextRequest, unknown, unknown, ServerUserContext, RepPOfflinePermitRequest,
  { workspaceId: string; employeeId: string }>({
  id: 'dp-rep-p-offline-permit-create-v1',
  guarantees: ['authenticated-user', 'active-user', 'owner-checked', 'input-validated', 'fields-allowlisted',
    'replay-protected', 'control:mobile-app-attested'],
  async enforce({ request }) {
    const actor = await requireUser(request).catch((cause) => rethrowServerAuthenticationFailure(cause));
    assertOfficialMobileApp(request, actor.decoded.uid);
    if ([...request.nextUrl.searchParams.keys()].length) throw new AppError({ code: 'REP_P_OFFLINE_PERMIT_QUERY_INVALID', kind: 'VALIDATION' });
    const parsed = repPOfflinePermitSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) throw new AppError({ code: 'REP_P_OFFLINE_PERMIT_INPUT_INVALID', kind: 'VALIDATION', safeMessage: 'Solicitação de contingência inválida.' });
    return { actor, input: parsed.data, resource: { workspaceId: actor.workspace_id, employeeId: actor.decoded.uid } };
  },
});

export const POST = secureRoute({ contract, enforcer }, async ({ security }) => {
  const permit = await issueOwnRepPOfflinePermit(security.actor, security.input);
  return NextResponse.json({ permit }, { status: 201, headers: { 'Cache-Control': 'private, no-store' } });
});
