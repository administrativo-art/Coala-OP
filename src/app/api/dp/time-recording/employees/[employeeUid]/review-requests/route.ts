import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';

import { canReadEmployeeTimeRecording } from '@/features/dp/rep-p/employee-month.server';
import { DP_REVIEW_REASONS, type DPReviewReason } from '@/features/dp/time-review/core';
import { requestReviewByDp } from '@/features/dp/time-review/service.server';
import { requireUser, type ServerUserContext } from '@/lib/auth-server';
import { AppError } from '@/lib/observability/app-error';
import { defineSecurityEnforcer } from '@/lib/security/enforcer';
import { defineSecurityContract } from '@/lib/security/route-contract';
import { secureRoute } from '@/lib/security/secure-route.server';
import { rethrowServerAuthenticationFailure } from '@/lib/server-authentication-failure';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ employeeUid: string }> };
type Resource = { workspaceId: string; employeeUid: string };
type Input = { date: string; reason: DPReviewReason };
const path = '/api/dp/time-recording/employees/[employeeUid]/review-requests' as const;
const routeSchema = z.object({ employeeUid: z.string().trim().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/) }).strict();
const inputSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  reason: z.enum(Object.keys(DP_REVIEW_REASONS) as [DPReviewReason, ...DPReviewReason[]]),
}).strict();

/** "Pedir revisão" do DP na conferência: só pede; nunca lança batida nem ajuste pela pessoa. */
const contract = defineSecurityContract({
  schemaVersion: 1, id: 'dp.time-recording.review-request.create', version: 1,
  surface: { method: 'POST', path }, exposure: 'authenticated', identity: { kind: 'active-user' },
  authorization: { kind: 'permission', action: 'dp.time-recording.view' }, resourceScope: { kind: 'unit' },
  input: { kind: 'schema', schema: 'dp.time-recording.review-request', unknownFields: 'reject' },
  effects: { mode: 'write', audit: 'server-authoritative' }, errorExposure: 'sanitized',
});
const enforcer = defineSecurityEnforcer<NextRequest, RouteContext, unknown, ServerUserContext, Input, Resource>({
  id: 'dp-time-recording-review-request-create-v1',
  guarantees: ['authenticated-user', 'active-user', 'permission-checked', 'unit-scoped', 'input-validated', 'fields-allowlisted', 'server-authoritative-audit'],
  async enforce({ request, routeContext }) {
    const actor = await requireUser(request).catch((cause) => rethrowServerAuthenticationFailure(cause));
    if (!canReadEmployeeTimeRecording(actor)) {
      throw new AppError({ code: 'TIME_REVIEW_FORBIDDEN', kind: 'AUTHORIZATION', safeMessage: 'Sem permissão para pedir revisão.' });
    }
    const route = routeSchema.safeParse(await routeContext.params);
    const input = inputSchema.safeParse(await request.json().catch(() => null));
    if (!route.success || !input.success) {
      throw new AppError({ code: 'TIME_REVIEW_INPUT_INVALID', kind: 'VALIDATION', safeMessage: 'Escolha o dia e o motivo.' });
    }
    return { actor, input: input.data, resource: { workspaceId: actor.workspace_id, employeeUid: route.data.employeeUid } };
  },
});

// O escopo de unidades da pessoa é conferido no serviço, como na consulta mensal.
export const POST = secureRoute({ contract, enforcer }, async ({ security }) =>
  NextResponse.json({ request: await requestReviewByDp(security.actor, security.resource.employeeUid, security.input) },
    { headers: { 'Cache-Control': 'private, no-store' } }));
