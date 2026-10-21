import { NextResponse, type NextRequest } from 'next/server';

import { requireTimeManager } from '@/features/dp/time-config/access.server';
import { exportAej } from '@/features/dp/time-adjustments/aej.server';
import { aejExportSchema, type AejExportInput } from '@/features/dp/time-adjustments/schemas';
import type { ServerUserContext } from '@/lib/auth-server';
import { AppError } from '@/lib/observability/app-error';
import { defineSecurityEnforcer } from '@/lib/security/enforcer';
import { defineSecurityContract } from '@/lib/security/route-contract';
import { secureRoute } from '@/lib/security/secure-route.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const path = '/api/dp/time-recording/aej' as const;
// Mesmo gestor de ponto que exporta o AFD; o AEJ é extração fiscal restrita por estabelecimento e período.
const contract = defineSecurityContract({
  schemaVersion: 1, id: 'dp.time-recording.aej.export', version: 1,
  surface: { method: 'POST', path }, exposure: 'authenticated', identity: { kind: 'active-user' },
  authorization: { kind: 'custom', strategy: 'dp-time-manager' }, resourceScope: { kind: 'workspace' },
  input: { kind: 'schema', schema: 'dp.ptrp.aej-export', unknownFields: 'reject' },
  effects: { mode: 'write', audit: 'server-authoritative' }, errorExposure: 'sanitized',
});
const enforcer = defineSecurityEnforcer<NextRequest, unknown, unknown, ServerUserContext, AejExportInput, { workspaceId: string; establishmentId: string }>({
  id: 'dp-ptrp-aej-export-v1',
  guarantees: ['authenticated-user', 'active-user', 'authorization:dp-time-manager', 'workspace-scoped', 'input-validated', 'fields-allowlisted'],
  async enforce({ request }) {
    const actor = await requireTimeManager(request);
    if ([...request.nextUrl.searchParams.keys()].length) throw new AppError({ code: 'PTRP_AEJ_QUERY_INVALID', kind: 'VALIDATION' });
    const parsed = aejExportSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) throw new AppError({ code: 'PTRP_AEJ_INPUT_INVALID', kind: 'VALIDATION', safeMessage: 'Período de exportação inválido.' });
    return { actor, input: parsed.data, resource: { workspaceId: actor.workspace_id, establishmentId: parsed.data.establishmentId } };
  },
});

export const POST = secureRoute({ contract, enforcer }, async ({ security }) =>
  NextResponse.json(await exportAej(security.actor, security.input), { headers: { 'Cache-Control': 'private, no-store',
    'Content-Disposition': 'attachment; filename="aej-package.json"' } }));
