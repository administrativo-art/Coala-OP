import { NextResponse, type NextRequest } from 'next/server';

import { listPendingRepPReceipts } from '@/features/dp/rep-p/service.server';
import { requireTimeManager } from '@/features/dp/time-config/access.server';
import type { ServerUserContext } from '@/lib/auth-server';
import { AppError } from '@/lib/observability/app-error';
import { defineSecurityEnforcer } from '@/lib/security/enforcer';
import { defineSecurityContract } from '@/lib/security/route-contract';
import { secureRoute } from '@/lib/security/secure-route.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const path = '/api/dp/time-recording/pending-receipts' as const;
const contract = defineSecurityContract({
  schemaVersion: 1, id: 'dp.time-recording.pending-receipts.list', version: 1,
  surface: { method: 'GET', path }, exposure: 'authenticated', identity: { kind: 'active-user' },
  authorization: { kind: 'custom', strategy: 'dp-time-manager' }, resourceScope: { kind: 'workspace' },
  input: { kind: 'none' }, effects: { mode: 'read', audit: 'none' }, errorExposure: 'sanitized',
});
const enforcer = defineSecurityEnforcer<NextRequest, unknown, unknown, ServerUserContext, undefined, { workspaceId: string }>({
  id: 'dp-rep-p-pending-receipts-list-v1',
  guarantees: ['authenticated-user', 'active-user', 'authorization:dp-time-manager', 'workspace-scoped'],
  async enforce({ request }) {
    const actor = await requireTimeManager(request);
    if ([...request.nextUrl.searchParams.keys()].length) throw new AppError({ code: 'REP_P_PENDING_QUERY_INVALID', kind: 'VALIDATION' });
    return { actor, input: undefined, resource: { workspaceId: actor.workspace_id } };
  },
});

export const GET = secureRoute({ contract, enforcer }, async ({ security }) => {
  const result = await listPendingRepPReceipts(security.actor);
  return NextResponse.json(result, { headers: { 'Cache-Control': 'private, no-store' } });
});
