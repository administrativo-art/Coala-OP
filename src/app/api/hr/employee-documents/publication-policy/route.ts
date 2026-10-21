import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';

import { assertDocumentsDp, readDocumentPublicationPolicies, saveDocumentPublicationPolicies } from '@/features/hr/documents/publication.server';
import { requireUser, type ServerUserContext } from '@/lib/auth-server';
import { AppError } from '@/lib/observability/app-error';
import { defineSecurityEnforcer } from '@/lib/security/enforcer';
import { defineSecurityContract } from '@/lib/security/route-contract';
import { secureRoute } from '@/lib/security/secure-route.server';
import { rethrowServerAuthenticationFailure } from '@/lib/server-authentication-failure';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const path = '/api/hr/employee-documents/publication-policy' as const;
const policySchema = z.object({ mode: z.enum(['automatic', 'manual', 'never']), trigger: z.enum(['validated', 'signed']) }).strict();
const documentTypeCodeSchema = z.string().regex(/^[A-Z0-9_]{2,80}$/, 'Código de tipo documental inválido.');
const inputSchema = z.object({ policies: z.record(documentTypeCodeSchema, policySchema) }).strict();
type Input = z.infer<typeof inputSchema>;
type Resource = { workspaceId: string };

const getContract = defineSecurityContract({ schemaVersion: 1, id: 'hr.employee-documents.publication-policy.read', version: 1,
  surface: { method: 'GET', path }, exposure: 'authenticated', identity: { kind: 'active-user' },
  authorization: { kind: 'custom', strategy: 'documents-dp' }, resourceScope: { kind: 'workspace' }, input: { kind: 'none' },
  effects: { mode: 'read', audit: 'none' }, errorExposure: 'sanitized' });
const putContract = defineSecurityContract({ schemaVersion: 1, id: 'hr.employee-documents.publication-policy.update', version: 1,
  surface: { method: 'PUT', path }, exposure: 'authenticated', identity: { kind: 'active-user' },
  authorization: { kind: 'custom', strategy: 'documents-dp' }, resourceScope: { kind: 'workspace' },
  input: { kind: 'schema', schema: 'hr.employee-documents.publication-policy', unknownFields: 'reject' },
  effects: { mode: 'write', audit: 'server-authoritative' }, errorExposure: 'sanitized' });

async function actor(request: NextRequest) {
  const value = await requireUser(request).catch((cause) => rethrowServerAuthenticationFailure(cause));
  assertDocumentsDp(value);
  return value;
}
const getEnforcer = defineSecurityEnforcer<NextRequest, unknown, unknown, ServerUserContext, null, Resource>({
  id: 'hr-employee-documents-publication-policy-read-v1',
  guarantees: ['authenticated-user', 'active-user', 'authorization:documents-dp', 'workspace-scoped'],
  async enforce({ request }) {
    if ([...request.nextUrl.searchParams.keys()].length) throw new AppError({ code: 'EMPLOYEE_DOCUMENT_PUBLICATION_POLICY_QUERY_INVALID', kind: 'VALIDATION' });
    const current = await actor(request);
    return { actor: current, input: null, resource: { workspaceId: current.workspace_id } };
  },
});
const putEnforcer = defineSecurityEnforcer<NextRequest, unknown, unknown, ServerUserContext, Input, Resource>({
  id: 'hr-employee-documents-publication-policy-update-v1',
  guarantees: ['authenticated-user', 'active-user', 'authorization:documents-dp', 'workspace-scoped', 'input-validated', 'fields-allowlisted'],
  async enforce({ request }) {
    if ([...request.nextUrl.searchParams.keys()].length) throw new AppError({ code: 'EMPLOYEE_DOCUMENT_PUBLICATION_POLICY_QUERY_INVALID', kind: 'VALIDATION' });
    const current = await actor(request);
    const parsed = inputSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) throw new AppError({ code: 'EMPLOYEE_DOCUMENT_PUBLICATION_POLICY_INPUT_INVALID', kind: 'VALIDATION', safeMessage: parsed.error.issues[0]?.message ?? 'Política inválida.' });
    return { actor: current, input: parsed.data, resource: { workspaceId: current.workspace_id } };
  },
});

export const GET = secureRoute({ contract: getContract, enforcer: getEnforcer }, async ({ security }) =>
  NextResponse.json({ policies: await readDocumentPublicationPolicies(security.actor) }, { headers: { 'Cache-Control': 'private, no-store' } }));
export const PUT = secureRoute({ contract: putContract, enforcer: putEnforcer }, async ({ security }) =>
  NextResponse.json({ policies: await saveDocumentPublicationPolicies(security.actor, security.input.policies) }, { headers: { 'Cache-Control': 'private, no-store' } }));
