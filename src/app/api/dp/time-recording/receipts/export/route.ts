import { NextResponse, type NextRequest } from 'next/server';

import { exportOwnRepPReceipts } from '@/features/dp/rep-p/service.server';
import { repPOwnHistorySchema, type RepPOwnHistoryRequest } from '@/features/dp/rep-p/schemas';
import { requireAuthenticatedUser, type ServerUserContext } from '@/lib/auth-server';
import { AppError } from '@/lib/observability/app-error';
import { defineSecurityEnforcer } from '@/lib/security/enforcer';
import { defineSecurityContract } from '@/lib/security/route-contract';
import { secureRoute } from '@/lib/security/secure-route.server';
import { rethrowServerAuthenticationFailure } from '@/lib/server-authentication-failure';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const path = '/api/dp/time-recording/receipts/export' as const;
const contract = defineSecurityContract({
  schemaVersion: 1, id: 'dp.time-recording.receipts.export-own', version: 1,
  surface: { method: 'GET', path }, exposure: 'authenticated', identity: { kind: 'active-user' },
  authorization: { kind: 'owner' }, resourceScope: { kind: 'owner' },
  input: { kind: 'schema', schema: 'dp.rep-p.own-history', unknownFields: 'reject' },
  effects: { mode: 'read', audit: 'none' }, errorExposure: 'sanitized',
});
const enforcer = defineSecurityEnforcer<NextRequest, unknown, unknown, ServerUserContext, RepPOwnHistoryRequest,
  { workspaceId: string; employeeId: string }>({
  id: 'dp-rep-p-receipt-archive-own-v1',
  guarantees: ['authenticated-user', 'active-user', 'owner-checked', 'input-validated', 'fields-allowlisted'],
  async enforce({ request }) {
    const actor = await requireAuthenticatedUser(request).catch((cause) => rethrowServerAuthenticationFailure(cause));
    const parsed = repPOwnHistorySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams.entries()));
    if (!parsed.success) throw new AppError({ code: 'REP_P_RECEIPT_ARCHIVE_INPUT_INVALID', kind: 'VALIDATION', safeMessage: 'Período de exportação inválido.' });
    return { actor, input: parsed.data, resource: { workspaceId: actor.workspace_id, employeeId: actor.decoded.uid } };
  },
});

export const GET = secureRoute({ contract, enforcer }, async ({ security }) => {
  const result = await exportOwnRepPReceipts(security.actor, security.input);
  return new NextResponse(new Uint8Array(result.bytes), { headers: {
    'Cache-Control': 'private, no-store',
    'Content-Type': 'application/zip',
    'Content-Disposition': `attachment; filename="${result.filename}"`,
    'Content-Length': String(result.bytes.byteLength),
    'X-Coala-Archive-Complete': result.complete ? 'true' : 'false',
    'X-Coala-Archive-Sha256': result.sha256,
    'X-Coala-Archive-Unavailable': String(result.unavailable),
  } });
});
