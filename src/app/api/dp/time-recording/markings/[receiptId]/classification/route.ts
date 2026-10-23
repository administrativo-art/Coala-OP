import { NextResponse, type NextRequest } from 'next/server';

import { classifyOwnRepPMarking } from '@/features/dp/rep-p/service.server';
import { repPMarkingClassificationSchema, type RepPMarkingClassificationRequest } from '@/features/dp/rep-p/schemas';
import { requireUser, type ServerUserContext } from '@/lib/auth-server';
import { AppError } from '@/lib/observability/app-error';
import { defineSecurityEnforcer } from '@/lib/security/enforcer';
import { defineSecurityContract } from '@/lib/security/route-contract';
import { secureRoute } from '@/lib/security/secure-route.server';
import { rethrowServerAuthenticationFailure } from '@/lib/server-authentication-failure';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type RouteContext = { params: Promise<{ receiptId: string }> };
const path = '/api/dp/time-recording/markings/[receiptId]/classification' as const;
const contract = defineSecurityContract({ schemaVersion: 1, id: 'dp.time-recording.marking-classification.update', version: 1,
  surface: { method: 'PATCH', path }, exposure: 'authenticated', identity: { kind: 'active-user' },
  authorization: { kind: 'owner' }, resourceScope: { kind: 'owner' },
  input: { kind: 'schema', schema: 'dp.rep-p.marking-classification', unknownFields: 'reject' },
  effects: { mode: 'write', audit: 'server-authoritative' }, errorExposure: 'sanitized' });
const enforcer = defineSecurityEnforcer<NextRequest, RouteContext, unknown, ServerUserContext,
  RepPMarkingClassificationRequest, { workspaceId: string; employeeId: string; receiptId: string }>({
  id: 'dp-rep-p-marking-classification-update-v1', guarantees: ['authenticated-user', 'active-user', 'owner-checked', 'input-validated', 'fields-allowlisted'],
  async enforce({ request, routeContext }) {
    const actor = await requireUser(request).catch((cause) => rethrowServerAuthenticationFailure(cause));
    const { receiptId: rawReceiptId } = await routeContext.params;
    const receiptId = String(rawReceiptId ?? '').trim();
    const parsed = repPMarkingClassificationSchema.safeParse(await request.json().catch(() => null));
    if (!receiptId || !parsed.success) throw new AppError({ code: 'REP_P_CLASSIFICATION_INPUT_INVALID', kind: 'VALIDATION', safeMessage: 'Classificação inválida.' });
    return { actor, input: parsed.data, resource: { workspaceId: actor.workspace_id, employeeId: actor.decoded.uid, receiptId } };
  },
});

export const PATCH = secureRoute({ contract, enforcer }, async ({ security }) => {
  const result = await classifyOwnRepPMarking(security.actor, security.resource.receiptId, security.input);
  return NextResponse.json(result, { headers: { 'Cache-Control': 'private, no-store' } });
});
