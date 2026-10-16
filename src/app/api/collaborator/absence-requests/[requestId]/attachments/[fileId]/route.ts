import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import type { ServerUserContext } from '@/lib/auth-server';
import { requireAbsenceRequestAccess } from '@/features/dp/absences/requests/access.server';
import { readAbsenceAttachment, removeAbsenceAttachment } from '@/features/dp/absences/requests/attachment-access.server';
import { AppError } from '@/lib/observability/app-error';
import { defineSecurityEnforcer } from '@/lib/security/enforcer';
import { defineSecurityContract } from '@/lib/security/route-contract';
import { secureRoute } from '@/lib/security/secure-route.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const id = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
const paramsSchema = z.object({ requestId: id, fileId: id }).strict();
const deletionSchema = z.object({ reason: z.string().trim().min(10).max(1000) }).strict();
const contract = defineSecurityContract({ schemaVersion: 1, id: 'collaborator.absence-requests.attachment', version: 1,
  surface: { method: 'GET', path: '/api/collaborator/absence-requests/[requestId]/attachments/[fileId]' }, exposure: 'authenticated', identity: { kind: 'active-user' },
  authorization: { kind: 'permission', action: 'absence.requests.attachment.read' }, resourceScope: { kind: 'workspace' },
  input: { kind: 'schema', schema: 'absence-requests.attachment-id', unknownFields: 'reject' }, effects: { mode: 'read', audit: 'server-authoritative' }, errorExposure: 'sanitized' });
const deleteContract = defineSecurityContract({ schemaVersion: 1, id: 'collaborator.absence-requests.attachment-delete', version: 1,
  surface: { method: 'DELETE', path: '/api/collaborator/absence-requests/[requestId]/attachments/[fileId]' }, exposure: 'authenticated', identity: { kind: 'active-user' },
  authorization: { kind: 'permission', action: 'absence.requests.attachment.delete' }, resourceScope: { kind: 'workspace' },
  input: { kind: 'schema', schema: 'absence-requests.attachment-delete', unknownFields: 'reject' }, effects: { mode: 'delete', audit: 'none' }, errorExposure: 'sanitized' });
const enforcer = defineSecurityEnforcer<NextRequest, { params: Promise<{ requestId: string; fileId: string }> }, unknown, ServerUserContext, { requestId: string; fileId: string }, { ownerId: string; workspaceId: string }>({
  id: 'collaborator-absence-attachment-v1', guarantees: ['authenticated-user', 'active-user', 'permission-checked', 'workspace-scoped', 'input-validated', 'fields-allowlisted'],
  async enforce({ request, routeContext }) {
    const actor = await requireAbsenceRequestAccess(request);
    const parsed = paramsSchema.safeParse(await routeContext.params);
    if (!parsed.success) throw new AppError({ code: 'ABSENCE_ATTACHMENT_ID_INVALID', kind: 'VALIDATION' });
    return { actor, input: parsed.data, resource: { ownerId: actor.decoded.uid, workspaceId: actor.workspace_id } };
  },
});
const deleteEnforcer = defineSecurityEnforcer<NextRequest, { params: Promise<{ requestId: string; fileId: string }> }, unknown, ServerUserContext,
  { requestId: string; fileId: string; reason: string }, { ownerId: string; workspaceId: string }>({
  id: 'collaborator-absence-attachment-delete-v1', guarantees: ['authenticated-user', 'active-user', 'permission-checked', 'workspace-scoped', 'input-validated', 'fields-allowlisted'],
  async enforce({ request, routeContext }) {
    const actor = await requireAbsenceRequestAccess(request);
    const params = paramsSchema.safeParse(await routeContext.params);
    const body = deletionSchema.safeParse(await request.json().catch(() => null));
    if (!params.success || !body.success) throw new AppError({ code: 'ABSENCE_ATTACHMENT_DELETE_INPUT_INVALID', kind: 'VALIDATION' });
    return { actor, input: { ...params.data, ...body.data }, resource: { ownerId: actor.decoded.uid, workspaceId: actor.workspace_id } };
  },
});
export const GET = secureRoute({ contract, enforcer }, async ({ security }) => {
  const file = await readAbsenceAttachment(security.actor, security.input.requestId, security.input.fileId);
  return new NextResponse(new Uint8Array(file.bytes), { headers: { 'Content-Type': file.mime,
    'Content-Disposition': 'attachment; filename="comprovante"', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } });
});
export const DELETE = secureRoute({ contract: deleteContract, enforcer: deleteEnforcer }, async ({ security }) => NextResponse.json(
  await removeAbsenceAttachment(security.actor, security.input.requestId, security.input.fileId, security.input.reason),
  { headers: { 'Cache-Control': 'private, no-store' } }));
