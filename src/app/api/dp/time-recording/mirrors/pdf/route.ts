import { NextResponse, type NextRequest } from 'next/server';

import { mirrorPdf } from '@/features/dp/time-adjustments/mirror.server';
import { mirrorQuerySchema } from '@/features/dp/time-adjustments/schemas';
import { requireAuthenticatedUser, type ServerUserContext } from '@/lib/auth-server';
import { AppError } from '@/lib/observability/app-error';
import { defineSecurityEnforcer } from '@/lib/security/enforcer';
import { defineSecurityContract } from '@/lib/security/route-contract';
import { secureRoute } from '@/lib/security/secure-route.server';
import { rethrowServerAuthenticationFailure } from '@/lib/server-authentication-failure';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const contract = defineSecurityContract({
  schemaVersion: 1, id: 'dp.time-recording.mirrors.pdf', version: 1,
  surface: { method: 'GET', path: '/api/dp/time-recording/mirrors/pdf' }, exposure: 'authenticated', identity: { kind: 'active-user' },
  authorization: { kind: 'custom', strategy: 'owner-or-time-closure' }, resourceScope: { kind: 'workspace' },
  input: { kind: 'schema', schema: 'dp.time-mirror.query', unknownFields: 'reject' },
  effects: { mode: 'read', audit: 'none' }, errorExposure: 'sanitized',
});
const enforcer = defineSecurityEnforcer<NextRequest, unknown, unknown, ServerUserContext, { competence: string; employeeUid?: string }, { workspaceId: string }>({
  id: 'dp-time-mirror-pdf-v1',
  guarantees: ['authenticated-user', 'active-user', 'authorization:owner-or-time-closure', 'workspace-scoped', 'input-validated', 'fields-allowlisted'],
  async enforce({ request }) {
    const actor = await requireAuthenticatedUser(request).catch((cause) => rethrowServerAuthenticationFailure(cause));
    const parsed = mirrorQuerySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams.entries()));
    if (!parsed.success) throw new AppError({ code: 'PTRP_MIRROR_INPUT_INVALID', kind: 'VALIDATION', safeMessage: 'Competência inválida.' });
    return { actor, input: parsed.data, resource: { workspaceId: actor.workspace_id } };
  },
});

export const GET = secureRoute({ contract, enforcer }, async ({ security }) => {
  const file = await mirrorPdf(security.actor, security.input.competence, security.input.employeeUid);
  return new NextResponse(new Uint8Array(file.bytes), { headers: {
    'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${file.filename}"`, 'Cache-Control': 'private, no-store',
  } });
});
