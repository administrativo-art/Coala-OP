import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';

import { canReadEmployeeTimeRecording, readEmployeeTimeRecordingMonth } from '@/features/dp/rep-p/employee-month.server';
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
const path = '/api/dp/time-recording/employees/[employeeUid]' as const;
const routeSchema = z.object({ employeeUid: z.string().trim().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/) }).strict();
const inputSchema = z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/) }).strict();

const contract = defineSecurityContract({
  schemaVersion: 1, id: 'dp.time-recording.employee-month.read', version: 1,
  surface: { method: 'POST', path }, exposure: 'authenticated', identity: { kind: 'active-user' },
  authorization: { kind: 'permission', action: 'dp.time-recording.view' }, resourceScope: { kind: 'unit' },
  input: { kind: 'schema', schema: 'dp.time-recording.employee-month', unknownFields: 'reject' },
  effects: { mode: 'write', audit: 'server-authoritative' }, errorExposure: 'sanitized',
});
const enforcer = defineSecurityEnforcer<NextRequest, RouteContext, unknown, ServerUserContext, { month: string }, Resource>({
  id: 'dp-time-recording-employee-month-read-v1',
  guarantees: ['authenticated-user', 'active-user', 'permission-checked', 'unit-scoped', 'input-validated', 'fields-allowlisted', 'server-authoritative-audit'],
  async enforce({ request, routeContext }) {
    const actor = await requireUser(request).catch((cause) => rethrowServerAuthenticationFailure(cause));
    if (!canReadEmployeeTimeRecording(actor)) {
      throw new AppError({ code: 'REP_P_EMPLOYEE_MONTH_FORBIDDEN', kind: 'AUTHORIZATION', safeMessage: 'Sem permissão para consultar o ponto de colaboradores.' });
    }
    if ([...request.nextUrl.searchParams.keys()].length) {
      throw new AppError({ code: 'REP_P_EMPLOYEE_MONTH_QUERY_INVALID', kind: 'VALIDATION', safeMessage: 'Consulta inválida.' });
    }
    const route = routeSchema.safeParse(await routeContext.params);
    const input = inputSchema.safeParse(await request.json().catch(() => null));
    if (!route.success || !input.success) {
      throw new AppError({ code: 'REP_P_EMPLOYEE_MONTH_INPUT_INVALID', kind: 'VALIDATION', safeMessage: 'Colaborador ou mês inválido.' });
    }
    return { actor, input: input.data, resource: { workspaceId: actor.workspace_id, employeeUid: route.data.employeeUid } };
  },
});

// Abrir dados de jornada de outra pessoa gera trilha de acesso; por isso a operação é POST, não GET.
export const POST = secureRoute({ contract, enforcer }, async ({ security }) =>
  NextResponse.json(await readEmployeeTimeRecordingMonth(security.actor, security.resource.employeeUid, security.input.month),
    { headers: { 'Cache-Control': 'private, no-store' } }));
