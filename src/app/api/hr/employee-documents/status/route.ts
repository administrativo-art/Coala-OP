import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';

import { assertDocumentsDp, changeEmployeeDocumentStatus } from '@/features/hr/documents/publication.server';
import { requireUser, type ServerUserContext } from '@/lib/auth-server';
import { AppError } from '@/lib/observability/app-error';
import { defineSecurityEnforcer } from '@/lib/security/enforcer';
import { defineSecurityContract } from '@/lib/security/route-contract';
import { secureRoute } from '@/lib/security/secure-route.server';
import { rethrowServerAuthenticationFailure } from '@/lib/server-authentication-failure';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const path = '/api/hr/employee-documents/status' as const;
const inputSchema = z.object({ id: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/), status: z.enum(['pending', 'received', 'validated', 'rejected']) }).strict();
type Input = z.infer<typeof inputSchema>;
type Resource = { workspaceId: string };
const contract = defineSecurityContract({ schemaVersion: 1, id: 'hr.employee-documents.status', version: 1,
  surface: { method: 'POST', path }, exposure: 'authenticated', identity: { kind: 'active-user' },
  authorization: { kind: 'custom', strategy: 'documents-dp' }, resourceScope: { kind: 'workspace' },
  input: { kind: 'schema', schema: 'hr.employee-documents.status', unknownFields: 'reject' },
  effects: { mode: 'write', audit: 'server-authoritative' }, errorExposure: 'sanitized' });
const enforcer = defineSecurityEnforcer<NextRequest, unknown, unknown, ServerUserContext, Input, Resource>({
  id: 'hr-employee-documents-status-v1',
  guarantees: ['authenticated-user', 'active-user', 'authorization:documents-dp', 'workspace-scoped', 'input-validated', 'fields-allowlisted'],
  async enforce({ request }) {
    const actor = await requireUser(request).catch((cause) => rethrowServerAuthenticationFailure(cause));
    assertDocumentsDp(actor);
    if ([...request.nextUrl.searchParams.keys()].length) throw new AppError({ code: 'EMPLOYEE_DOCUMENT_STATUS_QUERY_INVALID', kind: 'VALIDATION' });
    const parsed = inputSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) throw new AppError({ code: 'EMPLOYEE_DOCUMENT_STATUS_INPUT_INVALID', kind: 'VALIDATION', safeMessage: parsed.error.issues[0]?.message ?? 'Situação inválida.' });
    return { actor, input: parsed.data, resource: { workspaceId: actor.workspace_id } };
  },
});
export const POST = secureRoute({ contract, enforcer }, async ({ security }) =>
  NextResponse.json(await changeEmployeeDocumentStatus(security.actor, security.input), { headers: { 'Cache-Control': 'private, no-store' } }));
