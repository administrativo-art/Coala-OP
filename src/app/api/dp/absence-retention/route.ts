import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { requireUser, type ServerUserContext } from '@/lib/auth-server';
import { AppError } from '@/lib/observability/app-error';
import { rethrowServerAuthenticationFailure } from '@/lib/server-authentication-failure';
import { canAccessUnit } from '@/lib/unit-access';
import { listAbsenceRetentionCases } from '@/features/dp/absences/requests/retention.server';
import { defineSecurityContract } from '@/lib/security/route-contract';
import { defineSecurityEnforcer } from '@/lib/security/enforcer';
import { secureRoute } from '@/lib/security/secure-route.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const id = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
const querySchema = z.object({ unitId: id, state: z.enum(['unanchored', 'scheduled', 'awaiting_authorization',
  'authorized', 'retained_until_review', 'needs_revalidation', 'execution_blocked', 'preparing_execution',
  'executing', 'execution_unknown', 'release_pending', 'execution_review_required', 'removed']).optional(),
limit: z.coerce.number().int().min(1).max(50).default(25), cursor: id.optional() }).strict();
const contract = defineSecurityContract({ schemaVersion: 1, id: 'dp.absence-retention.list', version: 1,
  surface: { method: 'GET', path: '/api/dp/absence-retention' }, exposure: 'authenticated',
  identity: { kind: 'active-user' }, authorization: { kind: 'permission', action: 'dp.requests.review' },
  resourceScope: { kind: 'unit' }, input: { kind: 'schema', schema: 'absence-retention.list', unknownFields: 'reject' },
  effects: { mode: 'read', audit: 'none' }, errorExposure: 'sanitized' });
const enforcer = defineSecurityEnforcer<NextRequest, unknown, unknown, ServerUserContext,
  z.infer<typeof querySchema>, { workspaceId: string; unitId: string }>({
  id: 'dp-absence-retention-list-v1', guarantees: ['authenticated-user', 'active-user', 'permission-checked',
    'unit-scoped', 'input-validated', 'fields-allowlisted'],
  async enforce({ request }) {
    const actor = await requireUser(request).catch((error) => rethrowServerAuthenticationFailure(error));
    if (!actor.isDefaultAdmin && actor.permissions.dp.requests.review !== true) throw new AppError({ code: 'ABSENCE_RETENTION_FORBIDDEN', kind: 'AUTHORIZATION' });
    const url = new URL(request.url);
    const allowed = new Set(['unitId', 'state', 'limit', 'cursor']);
    if ([...url.searchParams.keys()].some((key) => !allowed.has(key) || url.searchParams.getAll(key).length !== 1)) {
      throw new AppError({ code: 'ABSENCE_RETENTION_QUERY_INVALID', kind: 'VALIDATION' });
    }
    const input = querySchema.safeParse(Object.fromEntries(url.searchParams));
    if (!input.success) throw new AppError({ code: 'ABSENCE_RETENTION_QUERY_INVALID', kind: 'VALIDATION' });
    if (!canAccessUnit(actor.userDoc, input.data.unitId, { isDefaultAdmin: actor.isDefaultAdmin })) {
      throw new AppError({ code: 'ABSENCE_RETENTION_FORBIDDEN', kind: 'AUTHORIZATION' });
    }
    return { actor, input: input.data, resource: { workspaceId: actor.workspace_id, unitId: input.data.unitId } };
  },
});
export const GET = secureRoute({ contract, enforcer }, async ({ security }) => NextResponse.json(
  await listAbsenceRetentionCases(security.actor, security.input),
  { headers: { 'Cache-Control': 'private, no-store' } }));
