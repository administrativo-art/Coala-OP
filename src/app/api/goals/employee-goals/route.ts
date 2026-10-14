import { NextRequest, NextResponse } from 'next/server';

import { createEmployeeGoalSchema, type CreateEmployeeGoalInput } from '@/features/goals/employee-goals/schemas';
import { createEmployeeGoal } from '@/features/goals/employee-goals/service.server';
import { requireUser, type ServerUserContext } from '@/lib/auth-server';
import { AppError } from '@/lib/observability/app-error';
import { defineSecurityEnforcer } from '@/lib/security/enforcer';
import { defineSecurityContract } from '@/lib/security/route-contract';
import { secureRoute } from '@/lib/security/secure-route.server';
import { canAccessUnit } from '@/lib/unit-access';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type StaticContext = { params: Promise<Record<string, never>> };
type Resource = { workspaceId: string; unitId: string };

const contract = defineSecurityContract({
  schemaVersion: 1,
  id: 'goals.employee-goals.create',
  version: 1,
  surface: { method: 'POST', path: '/api/goals/employee-goals' },
  exposure: 'authenticated',
  identity: { kind: 'active-user' },
  authorization: { kind: 'permission', action: 'goals.manage' },
  resourceScope: { kind: 'unit' },
  input: { kind: 'schema', schema: 'goals.employee-goal.create', unknownFields: 'reject' },
  effects: { mode: 'write', audit: 'server-authoritative' },
  errorExposure: 'sanitized',
});

const enforcer = defineSecurityEnforcer<NextRequest, StaticContext, unknown, ServerUserContext, CreateEmployeeGoalInput, Resource>({
  id: 'goals-employee-goals-create-v1',
  guarantees: ['authenticated-user', 'active-user', 'permission-checked', 'unit-scoped', 'input-validated', 'fields-allowlisted'],
  async enforce({ request }) {
    const actor = await requireUser(request).catch((cause) => {
      throw new AppError({ code: 'EMPLOYEE_GOAL_AUTH_REQUIRED', kind: 'AUTHENTICATION', cause });
    });
    if (!actor.isDefaultAdmin && actor.permissions.goals.manage !== true && actor.permissions.settings.manageUsers !== true) {
      throw new AppError({ code: 'EMPLOYEE_GOAL_FORBIDDEN', kind: 'AUTHORIZATION', safeMessage: 'Sem permissão para gerenciar participantes de metas.' });
    }
    const parsed = createEmployeeGoalSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      throw new AppError({ code: 'EMPLOYEE_GOAL_INPUT_INVALID', kind: 'VALIDATION', safeMessage: parsed.error.issues[0]?.message ?? 'Participante de meta inválido.' });
    }
    if (!canAccessUnit(actor.userDoc, parsed.data.kioskId, { isDefaultAdmin: actor.isDefaultAdmin })) {
      throw new AppError({ code: 'EMPLOYEE_GOAL_UNIT_FORBIDDEN', kind: 'AUTHORIZATION', safeMessage: 'Sem acesso à unidade desta meta.' });
    }
    return { actor, input: parsed.data, resource: { workspaceId: actor.workspace_id, unitId: parsed.data.kioskId } };
  },
});

export const POST = secureRoute({ contract, enforcer }, async ({ security, observation }) =>
  NextResponse.json({
    employeeGoal: await createEmployeeGoal({ context: security.actor, input: security.input, requestId: observation.requestId }),
  }, { status: 201, headers: { 'Cache-Control': 'private, no-store' } }));
