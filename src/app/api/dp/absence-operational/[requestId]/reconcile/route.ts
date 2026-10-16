import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { requireUser, type ServerUserContext } from '@/lib/auth-server';
import { hrDbAdmin } from '@/lib/firebase-rh-admin';
import { AppError } from '@/lib/observability/app-error';
import { rethrowServerAuthenticationFailure } from '@/lib/server-authentication-failure';
import { canAccessUnit } from '@/lib/unit-access';
import { reconcileOperationalAbsence } from '@/features/dp/absences/operational/protocol.server';
import { defineSecurityContract } from '@/lib/security/route-contract';
import { defineSecurityEnforcer } from '@/lib/security/enforcer';
import { secureRoute } from '@/lib/security/secure-route.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ requestId: string }> };
type Input = { requestId: string; expectedVersion: number; action: 'abort_preparation' | 'activate' | 'reverse' };
type Resource = { workspaceId: string; unitId: string };
const paramsSchema = z.object({ requestId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/) }).strict();
const bodySchema = z.object({ expectedVersion: z.number().int().positive(),
  action: z.enum(['abort_preparation', 'activate', 'reverse']) }).strict();
const contract = defineSecurityContract({ schemaVersion: 1, id: 'dp.absence-operational.reconcile', version: 1,
  surface: { method: 'POST', path: '/api/dp/absence-operational/[requestId]/reconcile' },
  exposure: 'authenticated', identity: { kind: 'active-user' },
  authorization: { kind: 'custom', strategy: 'schedules-edit-plus-review-for-abort' }, resourceScope: { kind: 'unit' },
  input: { kind: 'schema', schema: 'absence-operational.reconcile', unknownFields: 'reject' },
  effects: { mode: 'write', audit: 'server-authoritative' }, errorExposure: 'sanitized' });
const enforcer = defineSecurityEnforcer<NextRequest, Context, unknown, ServerUserContext, Input, Resource>({
  id: 'dp-absence-operational-reconcile-v1', guarantees: ['authenticated-user', 'active-user',
    'authorization:schedules-edit-plus-review-for-abort', 'unit-scoped', 'input-validated', 'fields-allowlisted'],
  async enforce({ request, routeContext }) {
    const actor = await requireUser(request).catch((error) => rethrowServerAuthenticationFailure(error));
    const params = paramsSchema.safeParse(await routeContext.params);
    const body = bodySchema.safeParse(await request.json().catch(() => null));
    if (!params.success || !body.success) throw new AppError({ code: 'ABSENCE_OPERATIONAL_INPUT_INVALID',
      kind: 'VALIDATION', safeMessage: 'Dados inválidos.' });
    if (!actor.isDefaultAdmin && actor.permissions.dp.schedules.edit !== true) {
      throw new AppError({ code: 'ABSENCE_OPERATIONAL_FORBIDDEN', kind: 'AUTHORIZATION' });
    }
    const source = await hrDbAdmin.collection('dp_absenceRequests').doc(params.data.requestId).get();
    if (!source.exists || source.get('workspaceId') !== actor.workspace_id) {
      throw new AppError({ code: 'ABSENCE_OPERATIONAL_NOT_FOUND', kind: 'NOT_FOUND' });
    }
    const unitId = source.get('unitId');
    if (typeof unitId !== 'string' || !canAccessUnit(actor.userDoc, unitId, { isDefaultAdmin: actor.isDefaultAdmin })) {
      throw new AppError({ code: 'ABSENCE_OPERATIONAL_NOT_FOUND', kind: 'NOT_FOUND' });
    }
    const assigned = source.get('assignedReviewerIds');
    const mayAbort = actor.isDefaultAdmin || actor.permissions.dp.requests.review === true
      && (Array.isArray(assigned) && assigned.includes(actor.decoded.uid)
        || source.get('custodianDpUid') === actor.decoded.uid);
    if (body.data.action === 'abort_preparation' && (!mayAbort
      || actor.decoded.uid === source.get('beneficiaryUid')
      || actor.decoded.uid === source.get('requesterUid'))) {
      throw new AppError({ code: 'ABSENCE_OPERATIONAL_ABORT_FORBIDDEN', kind: 'AUTHORIZATION' });
    }
    return { actor, input: { ...params.data, ...body.data }, resource: { workspaceId: actor.workspace_id, unitId } };
  },
});
export const POST = secureRoute({ contract, enforcer }, async ({ security }) => NextResponse.json(
  await reconcileOperationalAbsence(security.actor, security.input.requestId,
    security.input.expectedVersion, security.input.action),
  { headers: { 'Cache-Control': 'private, no-store' } }));
