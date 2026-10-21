import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';

import { openOwnPublishedDocument } from '@/features/hr/documents/publication.server';
import { requireUser, type ServerUserContext } from '@/lib/auth-server';
import { AppError } from '@/lib/observability/app-error';
import { defineSecurityEnforcer } from '@/lib/security/enforcer';
import { defineSecurityContract } from '@/lib/security/route-contract';
import { secureRoute } from '@/lib/security/secure-route.server';
import { rethrowServerAuthenticationFailure } from '@/lib/server-authentication-failure';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const path = '/api/collaborator/documents/access' as const;
const inputSchema = z.object({ id: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/), action: z.enum(['view', 'download']).default('view') }).strict();
type Input = z.infer<typeof inputSchema>;
type Resource = { workspaceId: string; employeeId: string };
// Abre ou baixa documento da própria pasta; registra a visualização na auditoria do documento (por isso POST).
const contract = defineSecurityContract({
  schemaVersion: 1, id: 'collaborator.documents.access', version: 1,
  surface: { method: 'POST', path }, exposure: 'authenticated', identity: { kind: 'active-user' },
  authorization: { kind: 'owner' }, resourceScope: { kind: 'owner' },
  input: { kind: 'schema', schema: 'collaborator.documents.access', unknownFields: 'reject' },
  effects: { mode: 'write', audit: 'server-authoritative' }, errorExposure: 'sanitized',
});
const enforcer = defineSecurityEnforcer<NextRequest, unknown, unknown, ServerUserContext, Input, Resource>({
  id: 'collaborator-documents-access-v1',
  guarantees: ['authenticated-user', 'active-user', 'owner-checked', 'input-validated', 'fields-allowlisted'],
  async enforce({ request }) {
    const actor = await requireUser(request).catch((cause) => rethrowServerAuthenticationFailure(cause));
    if ([...request.nextUrl.searchParams.keys()].length) throw new AppError({ code: 'COLLABORATOR_DOCUMENTS_QUERY_INVALID', kind: 'VALIDATION' });
    const parsed = inputSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) throw new AppError({ code: 'COLLABORATOR_DOCUMENTS_INPUT_INVALID', kind: 'VALIDATION', safeMessage: 'Documento inválido.' });
    return { actor, input: parsed.data, resource: { workspaceId: actor.workspace_id, employeeId: actor.decoded.uid } };
  },
});

export const POST = secureRoute({ contract, enforcer }, async ({ security }) => {
  const file = await openOwnPublishedDocument(security.actor, security.input.id, security.input.action);
  const disposition = `${security.input.action === 'download' ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(file.fileName)}`;
  return new NextResponse(new Uint8Array(file.bytes), { headers: { 'Content-Type': file.mimeType, 'Content-Disposition': disposition, 'Cache-Control': 'private, no-store' } });
});
