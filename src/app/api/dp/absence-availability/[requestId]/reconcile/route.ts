import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { requireUser, type ServerUserContext } from '@/lib/auth-server';
import { hrDbAdmin } from '@/lib/firebase-rh-admin';
import { AppError } from '@/lib/observability/app-error';
import { rethrowServerAuthenticationFailure } from '@/lib/server-authentication-failure';
import { canAccessUnit } from '@/lib/unit-access';
import { reconcileAbsenceAvailabilityShadow } from '@/features/dp/absences/requests/availability-shadow.server';
import { defineSecurityContract } from '@/lib/security/route-contract';
import { defineSecurityEnforcer } from '@/lib/security/enforcer';
import { secureRoute } from '@/lib/security/secure-route.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ requestId: string }> };
type Input = { requestId: string; expectedVersion: number; operationId: string };
type Resource = { workspaceId: string; unitId: string };
const paramsSchema = z.object({ requestId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/) }).strict();
const bodySchema = z.object({ expectedVersion: z.number().int().positive(), operationId: z.string().uuid() }).strict();
const contract = defineSecurityContract({ schemaVersion: 1, id: 'dp.absence-availability.shadow-reconcile', version: 1,
  surface: { method: 'POST', path: '/api/dp/absence-availability/[requestId]/reconcile' },
  exposure: 'authenticated', identity: { kind: 'active-user' },
  authorization: { kind: 'permission', action: 'dp.schedules.edit' }, resourceScope: { kind: 'unit' },
  input: { kind: 'schema', schema: 'absence-availability.shadow-reconcile', unknownFields: 'reject' },
  effects: { mode: 'write', audit: 'server-authoritative' }, errorExposure: 'sanitized' });
const enforcer = defineSecurityEnforcer<NextRequest, Context, unknown, ServerUserContext, Input, Resource>({
  id: 'dp-absence-availability-shadow-reconcile-v1', guarantees: ['authenticated-user', 'active-user',
    'permission-checked', 'unit-scoped', 'input-validated', 'fields-allowlisted'],
  async enforce({ request, routeContext }) {
    const actor = await requireUser(request).catch((error) => rethrowServerAuthenticationFailure(error));
    const params = paramsSchema.safeParse(await routeContext.params);
    const body = bodySchema.safeParse(await request.json().catch(() => null));
    if (!params.success || !body.success) throw new AppError({ code: 'ABSENCE_SHADOW_INPUT_INVALID', kind: 'VALIDATION', safeMessage: 'Dados inválidos.' });
    if (!actor.isDefaultAdmin && actor.permissions.dp.schedules.edit !== true) {
      throw new AppError({ code: 'ABSENCE_SHADOW_FORBIDDEN', kind: 'AUTHORIZATION' });
    }
    const source = await hrDbAdmin.collection('dp_absenceRequests').doc(params.data.requestId).get();
    if (!source.exists || source.get('workspaceId') !== actor.workspace_id) {
      throw new AppError({ code: 'ABSENCE_SHADOW_NOT_FOUND', kind: 'NOT_FOUND' });
    }
    const unitId = source.get('unitId');
    if (typeof unitId !== 'string' || !canAccessUnit(actor.userDoc, unitId, { isDefaultAdmin: actor.isDefaultAdmin })) {
      throw new AppError({ code: 'ABSENCE_SHADOW_NOT_FOUND', kind: 'NOT_FOUND' });
    }
    return { actor, input: { ...params.data, ...body.data }, resource: { workspaceId: actor.workspace_id, unitId } };
  },
});
export const POST = secureRoute({ contract, enforcer }, async ({ security }) => NextResponse.json(
  await reconcileAbsenceAvailabilityShadow(security.actor, security.input.requestId, security.input),
  { headers: { 'Cache-Control': 'private, no-store' } }));
