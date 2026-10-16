import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { requireUser, type ServerUserContext } from '@/lib/auth-server';
import { hrDbAdmin } from '@/lib/firebase-rh-admin';
import { AppError } from '@/lib/observability/app-error';
import { rethrowServerAuthenticationFailure } from '@/lib/server-authentication-failure';
import { canAccessUnit } from '@/lib/unit-access';
import { absenceCivilDateSchema } from '@/features/dp/absences/requests/schemas';
import { belemCivilDate } from '@/features/dp/absences/requests/core';
import { decideAbsenceRetention } from '@/features/dp/absences/requests/retention.server';
import { defineSecurityContract } from '@/lib/security/route-contract';
import { defineSecurityEnforcer } from '@/lib/security/enforcer';
import { secureRoute } from '@/lib/security/secure-route.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ caseId: string }> };
const paramsSchema = z.object({ caseId: z.string().regex(/^[A-Za-z0-9_-]{1,256}$/) }).strict();
const operationId = z.string().uuid();
const common = { reason: z.string().trim().min(10).max(1000), expectedVersion: z.number().int().positive(), operationId };
const bodySchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('authorize_delete'), ...common }).strict(),
  z.object({ action: z.literal('retain'), ...common, nextReviewAfter: absenceCivilDateSchema }).strict(),
]);
type Input = z.infer<typeof bodySchema> & { caseId: string };
const contract = defineSecurityContract({ schemaVersion: 1, id: 'dp.absence-retention.decision', version: 1,
  surface: { method: 'POST', path: '/api/dp/absence-retention/[caseId]/decision' }, exposure: 'authenticated',
  identity: { kind: 'active-user' }, authorization: { kind: 'permission', action: 'dp.requests.review' },
  resourceScope: { kind: 'unit' }, input: { kind: 'schema', schema: 'absence-retention.decision', unknownFields: 'reject' },
  effects: { mode: 'write', audit: 'server-authoritative' }, errorExposure: 'sanitized' });
const enforcer = defineSecurityEnforcer<NextRequest, Context, unknown, ServerUserContext, Input,
  { workspaceId: string; unitId: string }>({
  id: 'dp-absence-retention-decision-v1', guarantees: ['authenticated-user', 'active-user', 'permission-checked',
    'unit-scoped', 'input-validated', 'fields-allowlisted'],
  async enforce({ request, routeContext }) {
    const actor = await requireUser(request).catch((error) => rethrowServerAuthenticationFailure(error));
    if (!actor.isDefaultAdmin && actor.permissions.dp.requests.review !== true) throw new AppError({ code: 'ABSENCE_RETENTION_FORBIDDEN', kind: 'AUTHORIZATION' });
    const params = paramsSchema.safeParse(await routeContext.params);
    const body = bodySchema.safeParse(await request.json().catch(() => null));
    if (!params.success || !body.success) throw new AppError({ code: 'ABSENCE_RETENTION_INPUT_INVALID', kind: 'VALIDATION' });
    const source = await hrDbAdmin.collection('dp_absenceRetentionCases').doc(params.data.caseId).get();
    if (!source.exists || source.get('workspaceId') !== actor.workspace_id
      || source.get('custodianUid') !== actor.decoded.uid || source.get('beneficiaryUid') === actor.decoded.uid
      || !canAccessUnit(actor.userDoc, source.get('unitId'), { isDefaultAdmin: actor.isDefaultAdmin })) {
      throw new AppError({ code: 'ABSENCE_RETENTION_NOT_FOUND', kind: 'NOT_FOUND' });
    }
    if (body.data.action === 'retain' && body.data.nextReviewAfter <= belemCivilDate(new Date())) {
      throw new AppError({ code: 'ABSENCE_RETENTION_INPUT_INVALID', kind: 'VALIDATION' });
    }
    return { actor, input: { ...params.data, ...body.data }, resource: { workspaceId: actor.workspace_id,
      unitId: source.get('unitId') as string } };
  },
});
export const POST = secureRoute({ contract, enforcer }, async ({ security }) => NextResponse.json(
  await decideAbsenceRetention(security.actor, security.input.caseId, security.input),
  { headers: { 'Cache-Control': 'private, no-store' } }));
