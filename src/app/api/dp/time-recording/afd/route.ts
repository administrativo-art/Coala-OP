import { NextResponse, type NextRequest } from 'next/server';

import { exportSignedRepPAfd } from '@/features/dp/rep-p/service.server';
import { repPAfdExportSchema, type RepPAfdExportRequest } from '@/features/dp/rep-p/schemas';
import { requireTimeManager } from '@/features/dp/time-config/access.server';
import type { ServerUserContext } from '@/lib/auth-server';
import { AppError } from '@/lib/observability/app-error';
import { defineSecurityEnforcer } from '@/lib/security/enforcer';
import { defineSecurityContract } from '@/lib/security/route-contract';
import { secureRoute } from '@/lib/security/secure-route.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const path = '/api/dp/time-recording/afd' as const;
const contract = defineSecurityContract({
  schemaVersion: 1, id: 'dp.time-recording.afd.export', version: 1,
  surface: { method: 'POST', path }, exposure: 'authenticated', identity: { kind: 'active-user' },
  authorization: { kind: 'custom', strategy: 'dp-time-manager' }, resourceScope: { kind: 'workspace' },
  input: { kind: 'schema', schema: 'dp.rep-p.afd-export', unknownFields: 'reject' },
  effects: { mode: 'write', audit: 'server-authoritative' }, errorExposure: 'sanitized',
});
const enforcer = defineSecurityEnforcer<NextRequest, unknown, unknown, ServerUserContext, RepPAfdExportRequest,
  { workspaceId: string; establishmentId: string }>({
  id: 'dp-rep-p-afd-export-v1',
  guarantees: ['authenticated-user', 'active-user', 'authorization:dp-time-manager', 'workspace-scoped',
    'input-validated', 'fields-allowlisted'],
  async enforce({ request }) {
    const actor = await requireTimeManager(request);
    if ([...request.nextUrl.searchParams.keys()].length) throw new AppError({ code: 'REP_P_AFD_QUERY_INVALID', kind: 'VALIDATION' });
    const parsed = repPAfdExportSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) throw new AppError({ code: 'REP_P_AFD_INPUT_INVALID', kind: 'VALIDATION', safeMessage: 'Período de exportação inválido.' });
    return { actor, input: parsed.data,
      resource: { workspaceId: actor.workspace_id, establishmentId: parsed.data.establishmentId } };
  },
});

export const POST = secureRoute({ contract, enforcer }, async ({ security }) => {
  const result = await exportSignedRepPAfd(security.actor, security.input);
  return NextResponse.json(result, { headers: { 'Cache-Control': 'private, no-store',
    'Content-Disposition': 'attachment; filename="afd-package.json"' } });
});
