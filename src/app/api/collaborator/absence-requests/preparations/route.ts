import { NextResponse, type NextRequest } from 'next/server';
import type { ServerUserContext } from '@/lib/auth-server';
import { requireAbsenceRequestAccess } from '@/features/dp/absences/requests/access.server';
import { prepareAbsenceFiles } from '@/features/dp/absences/requests/files.server';
import { AppError } from '@/lib/observability/app-error';
import { defineSecurityEnforcer } from '@/lib/security/enforcer';
import { defineSecurityContract } from '@/lib/security/route-contract';
import { secureRoute } from '@/lib/security/secure-route.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const contract = defineSecurityContract({ schemaVersion: 1, id: 'collaborator.absence-requests.preparations', version: 1,
  surface: { method: 'POST', path: '/api/collaborator/absence-requests/preparations' }, exposure: 'authenticated', identity: { kind: 'active-user' },
  authorization: { kind: 'permission', action: 'absence.requests.prepare' }, resourceScope: { kind: 'workspace' },
  input: { kind: 'schema', schema: 'absence-requests.preparation-multipart', unknownFields: 'reject' }, effects: { mode: 'write', audit: 'server-authoritative' }, errorExposure: 'sanitized' });
const enforcer = defineSecurityEnforcer<NextRequest, { params: Promise<Record<string, never>> }, unknown, ServerUserContext, FormData, { ownerId: string; workspaceId: string }>({
  id: 'collaborator-absence-preparation-v2', guarantees: ['authenticated-user', 'active-user', 'permission-checked', 'workspace-scoped', 'input-validated', 'fields-allowlisted'],
  async enforce({ request }) {
    const actor = await requireAbsenceRequestAccess(request);
    const length = Number(request.headers.get('content-length'));
    if (Number.isFinite(length) && length > 52 * 1024 * 1024) throw new AppError({ code: 'ABSENCE_FILE_LIMIT', kind: 'VALIDATION', safeMessage: 'Arquivos acima do limite permitido.' });
    const form = await request.formData().catch(() => { throw new AppError({ code: 'ABSENCE_FILE_INVALID', kind: 'VALIDATION' }); });
    if ([...form.keys()].some((key) => !['files', 'proposedRequestId', 'beneficiaryUid', 'parentRequestId'].includes(key))) throw new AppError({ code: 'ABSENCE_FILE_INVALID', kind: 'VALIDATION' });
    return { actor, input: form, resource: { ownerId: actor.decoded.uid, workspaceId: actor.workspace_id } };
  },
});
export const POST = secureRoute({ contract, enforcer }, async ({ security }) => NextResponse.json(
  await prepareAbsenceFiles(security.actor, security.input), { status: 201, headers: { 'Cache-Control': 'private, no-store' } }));
