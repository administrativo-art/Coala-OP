import { NextResponse, type NextRequest } from 'next/server';

import { getOwnRepPReceipt, retryOwnRepPReceipt } from '@/features/dp/rep-p/service.server';
import { requireAuthenticatedUser, requireUser, type ServerUserContext } from '@/lib/auth-server';
import { AppError } from '@/lib/observability/app-error';
import { defineSecurityEnforcer } from '@/lib/security/enforcer';
import { defineSecurityContract } from '@/lib/security/route-contract';
import { secureRoute } from '@/lib/security/secure-route.server';
import { rethrowServerAuthenticationFailure } from '@/lib/server-authentication-failure';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ receiptId: string }> };
type ReceiptResource = { workspaceId: string; employeeId: string; receiptId: string };

const path = '/api/dp/time-recording/receipts/[receiptId]' as const;
const base = {
  schemaVersion: 1, version: 1, exposure: 'authenticated', identity: { kind: 'active-user' },
  authorization: { kind: 'owner' }, resourceScope: { kind: 'owner' }, input: { kind: 'none' },
  errorExposure: 'sanitized',
} as const;
const readContract = defineSecurityContract({ ...base, id: 'dp.time-recording.receipts.read',
  surface: { method: 'GET', path }, effects: { mode: 'read', audit: 'none' } });
const retryContract = defineSecurityContract({ ...base, id: 'dp.time-recording.receipts.retry',
  surface: { method: 'POST', path }, effects: { mode: 'write', audit: 'server-authoritative' } });

// O dono é sempre o usuário autenticado; o serviço recusa comprovante de outra pessoa como inexistente.
function ownerEnforcer(id: string, authenticate: typeof requireUser) {
  return defineSecurityEnforcer<NextRequest, RouteContext, unknown, ServerUserContext, undefined, ReceiptResource>({
    id,
    guarantees: ['authenticated-user', 'active-user', 'owner-checked'],
    async enforce({ request, routeContext }) {
      const actor = await authenticate(request).catch((cause) => rethrowServerAuthenticationFailure(cause));
      if ([...request.nextUrl.searchParams.keys()].length) throw new AppError({ code: 'REP_P_RECEIPT_QUERY_INVALID', kind: 'VALIDATION' });
      const { receiptId } = await routeContext.params;
      return { actor, input: undefined,
        resource: { workspaceId: actor.workspace_id, employeeId: actor.decoded.uid, receiptId } };
    },
  });
}

export const GET = secureRoute({ contract: readContract, enforcer: ownerEnforcer('dp-rep-p-receipt-read-v1', requireAuthenticatedUser) }, async ({ security }) => {
  const receipt = await getOwnRepPReceipt(security.actor, security.resource.receiptId);
  return new NextResponse(new Uint8Array(receipt.bytes), { headers: {
    'Content-Type': 'application/pdf',
    'Content-Disposition': `inline; filename="${receipt.filename}"`,
    'Cache-Control': 'private, no-store',
    'X-Content-SHA256': receipt.sha256,
  } });
});

export const POST = secureRoute({ contract: retryContract, enforcer: ownerEnforcer('dp-rep-p-receipt-retry-v1', requireUser) }, async ({ security }) => {
  const result = await retryOwnRepPReceipt(security.actor, security.resource.receiptId);
  return NextResponse.json(result, { headers: { 'Cache-Control': 'private, no-store' } });
});
