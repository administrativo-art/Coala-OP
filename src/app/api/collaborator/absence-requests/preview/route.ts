import { NextResponse, type NextRequest } from 'next/server';
import type { ServerUserContext } from '@/lib/auth-server';
import { requireAbsenceRequestAccess } from '@/features/dp/absences/requests/access.server';
import { absenceRequestPreviewRouteSchema } from '@/features/dp/absences/requests/schemas';
import type { z } from 'zod';
import { previewOwnAbsenceRequest } from '@/features/dp/absences/requests/service.server';
import { AppError } from '@/lib/observability/app-error';
import { defineSecurityEnforcer } from '@/lib/security/enforcer';
import { defineSecurityContract } from '@/lib/security/route-contract';
import { secureRoute } from '@/lib/security/secure-route.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const contract = defineSecurityContract({ schemaVersion: 1, id: 'collaborator.absence-requests.preview', version: 1, surface: { method: 'POST', path: '/api/collaborator/absence-requests/preview' }, exposure: 'authenticated', identity: { kind: 'active-user' }, authorization: { kind: 'permission', action: 'absence.requests.preview' }, resourceScope: { kind: 'workspace' }, input: { kind: 'schema', schema: 'collaborator.absence-preview', unknownFields: 'reject' }, effects: { mode: 'read', audit: 'none' }, errorExposure: 'sanitized' });
const enforcer = defineSecurityEnforcer<NextRequest, { params: Promise<Record<string, never>> }, unknown, ServerUserContext, z.infer<typeof absenceRequestPreviewRouteSchema>, { workspaceId: string }>({
  id: 'collaborator-absence-preview-v2', guarantees: ['authenticated-user', 'active-user', 'permission-checked', 'workspace-scoped', 'input-validated', 'fields-allowlisted'],
  async enforce({ request }) {
    const actor = await requireAbsenceRequestAccess(request);
    const parsed = absenceRequestPreviewRouteSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) throw new AppError({ code: 'ABSENCE_PREVIEW_INPUT_INVALID', kind: 'VALIDATION', safeMessage: parsed.error.issues[0]?.message ?? 'Dados da prévia inválidos.' });
    return { actor, input: parsed.data, resource: { workspaceId: actor.workspace_id } };
  },
});

export const POST = secureRoute({ contract, enforcer }, async ({ security }) => {
  const { beneficiaryUid, ...input } = security.input;
  return NextResponse.json({ preview: await previewOwnAbsenceRequest(security.actor, input, new Date(), beneficiaryUid) },
    { headers: { 'Cache-Control': 'private, no-store' } });
});
