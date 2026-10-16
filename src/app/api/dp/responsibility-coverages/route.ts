import { NextResponse, type NextRequest } from 'next/server';

import { listResponsibilityCoverages, saveResponsibilityCoverage } from '@/features/dp/responsibility-coverage/service.server';
import { responsibilityCoverageListSchema, saveResponsibilityCoverageSchema } from '@/features/dp/responsibility-coverage/schemas';
import { requireUser, type ServerUserContext } from '@/lib/auth-server';
import { AppError } from '@/lib/observability/app-error';
import { defineSecurityEnforcer } from '@/lib/security/enforcer';
import { defineSecurityContract } from '@/lib/security/route-contract';
import { secureRoute } from '@/lib/security/secure-route.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = { params: Promise<Record<string, never>> };
type Resource = { workspaceId: string };

const getContract = defineSecurityContract({
  schemaVersion: 1, id: 'dp.responsibility-coverages.list', version: 1,
  surface: { method: 'GET', path: '/api/dp/responsibility-coverages' }, exposure: 'authenticated',
  identity: { kind: 'active-user' }, authorization: { kind: 'permission', action: 'dp.responsibilities.manage' },
  resourceScope: { kind: 'workspace' }, input: { kind: 'schema', schema: 'dp.responsibility-coverages.list', unknownFields: 'reject' },
  effects: { mode: 'read', audit: 'none' }, errorExposure: 'sanitized',
});
const putContract = defineSecurityContract({
  schemaVersion: 1, id: 'dp.responsibility-coverages.save', version: 1,
  surface: { method: 'PUT', path: '/api/dp/responsibility-coverages' }, exposure: 'authenticated',
  identity: { kind: 'active-user' }, authorization: { kind: 'permission', action: 'dp.responsibilities.manage' },
  resourceScope: { kind: 'workspace' }, input: { kind: 'schema', schema: 'dp.responsibility-coverages.save', unknownFields: 'reject' },
  effects: { mode: 'write', audit: 'server-authoritative' }, errorExposure: 'sanitized',
});

const getEnforcer = defineSecurityEnforcer<NextRequest, Context, unknown, ServerUserContext, { activity?: 'schedules' | 'vacations' | 'absences' }, Resource>({
  id: 'dp-responsibility-coverages-list-v1', guarantees: ['authenticated-user', 'active-user', 'permission-checked', 'workspace-scoped', 'input-validated', 'fields-allowlisted'],
  async enforce({ request }) {
    const actor = await requireUser(request).catch((cause) => { throw new AppError({ code: 'AUTHENTICATION_REQUIRED', kind: 'AUTHENTICATION', cause }); });
    const parsed = responsibilityCoverageListSchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
    if (!parsed.success) throw new AppError({ code: 'DP_RESPONSIBILITY_LIST_INPUT_INVALID', kind: 'VALIDATION' });
    if (!actor.isDefaultAdmin && actor.permissions.dp.responsibilities.manage !== true) {
      throw new AppError({ code: 'DP_RESPONSIBILITY_READ_FORBIDDEN', kind: 'AUTHORIZATION' });
    }
    return { actor, input: parsed.data, resource: { workspaceId: actor.workspace_id } };
  },
});

const putEnforcer = defineSecurityEnforcer<NextRequest, Context, unknown, ServerUserContext, ReturnType<typeof saveResponsibilityCoverageSchema.parse>, Resource>({
  id: 'dp-responsibility-coverages-save-v1', guarantees: ['authenticated-user', 'active-user', 'permission-checked', 'workspace-scoped', 'input-validated', 'fields-allowlisted'],
  async enforce({ request }) {
    const actor = await requireUser(request).catch((cause) => { throw new AppError({ code: 'AUTHENTICATION_REQUIRED', kind: 'AUTHENTICATION', cause }); });
    const parsed = saveResponsibilityCoverageSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) throw new AppError({ code: 'DP_RESPONSIBILITY_SAVE_INPUT_INVALID', kind: 'VALIDATION' });
    if (!actor.isDefaultAdmin && actor.permissions.dp.responsibilities.manage !== true) {
      throw new AppError({ code: 'DP_RESPONSIBILITY_MANAGE_FORBIDDEN', kind: 'AUTHORIZATION' });
    }
    return { actor, input: parsed.data, resource: { workspaceId: actor.workspace_id } };
  },
});

export const GET = secureRoute({ contract: getContract, enforcer: getEnforcer }, async ({ security }) =>
  NextResponse.json({ coverages: await listResponsibilityCoverages(security.actor, security.input.activity) },
    { headers: { 'Cache-Control': 'private, no-store' } }));

export const PUT = secureRoute({ contract: putContract, enforcer: putEnforcer }, async ({ security }) =>
  NextResponse.json(await saveResponsibilityCoverage(security.actor, security.input)));
