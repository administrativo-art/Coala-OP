import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';

import { canViewSystemNotices } from '@/features/system-notices/core';
import { listSystemNotices, systemNoticeActor } from '@/features/system-notices/service.server';
import { requireUser, type ServerUserContext } from '@/lib/auth-server';
import { AppError } from '@/lib/observability/app-error';
import { defineSecurityEnforcer } from '@/lib/security/enforcer';
import { defineSecurityContract } from '@/lib/security/route-contract';
import { secureRoute } from '@/lib/security/secure-route.server';
import { rethrowServerAuthenticationFailure } from '@/lib/server-authentication-failure';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const querySchema = z.object({
  status: z.enum(['open', 'resolved']).default('open'),
  cursor: z.string().regex(/^[a-f0-9]{64}$/).optional(),
}).strict();
type Query = z.infer<typeof querySchema>;

const contract = defineSecurityContract({
  schemaVersion: 1, id: 'system-notices.list', version: 1,
  surface: { method: 'GET', path: '/api/system-notices' }, exposure: 'authenticated', identity: { kind: 'active-user' },
  authorization: { kind: 'permission', action: 'settings.view-system-notices' }, resourceScope: { kind: 'workspace' },
  input: { kind: 'schema', schema: 'system-notices.list-query', unknownFields: 'reject' },
  effects: { mode: 'read', audit: 'none' }, errorExposure: 'sanitized',
});
const enforcer = defineSecurityEnforcer<NextRequest, unknown, unknown, ServerUserContext, Query, { workspaceId: string }>({
  id: 'system-notices-list-v1',
  guarantees: ['authenticated-user', 'active-user', 'permission-checked', 'workspace-scoped',
    'input-validated', 'fields-allowlisted'],
  async enforce({ request }) {
    const actor = await requireUser(request).catch((cause) => rethrowServerAuthenticationFailure(cause));
    if (!canViewSystemNotices(systemNoticeActor(actor))) {
      throw new AppError({ code: 'SYSTEM_NOTICES_FORBIDDEN', kind: 'AUTHORIZATION', safeMessage: 'Sem permissão para ver avisos do sistema.' });
    }
    const parsed = querySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams.entries()));
    if (!parsed.success) throw new AppError({ code: 'SYSTEM_NOTICES_QUERY_INVALID', kind: 'VALIDATION', safeMessage: 'Filtro inválido.' });
    return { actor, input: parsed.data, resource: { workspaceId: actor.workspace_id } };
  },
});

export const GET = secureRoute({ contract, enforcer }, async ({ security }) => {
  const result = await listSystemNotices(security.actor, security.input);
  return NextResponse.json(result, { headers: { 'Cache-Control': 'private, no-store' } });
});
