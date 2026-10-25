import { NextResponse, type NextRequest } from 'next/server';

import { listOwnPublishedDocuments } from '@/features/hr/documents/publication.server';
import { requireUser, type ServerUserContext } from '@/lib/auth-server';
import { AppError } from '@/lib/observability/app-error';
import { defineSecurityEnforcer } from '@/lib/security/enforcer';
import { defineSecurityContract } from '@/lib/security/route-contract';
import { secureRoute } from '@/lib/security/secure-route.server';
import { rethrowServerAuthenticationFailure } from '@/lib/server-authentication-failure';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const path = '/api/collaborator/documents' as const;
type Resource = { workspaceId: string; employeeId: string };
// Macro 02, a própria pasta: só documentos do titular publicados para ele; o filtro é feito no servidor.
const contract = defineSecurityContract({
  schemaVersion: 1, id: 'collaborator.documents.list', version: 1,
  surface: { method: 'GET', path }, exposure: 'authenticated', identity: { kind: 'active-user' },
  authorization: { kind: 'owner' }, resourceScope: { kind: 'owner' },
  input: { kind: 'none' }, effects: { mode: 'read', audit: 'none' }, errorExposure: 'sanitized',
});
const enforcer = defineSecurityEnforcer<NextRequest, unknown, unknown, ServerUserContext, Record<string, never>, Resource>({
  id: 'collaborator-documents-list-v1',
  guarantees: ['authenticated-user', 'active-user', 'owner-checked'],
  async enforce({ request }) {
    const actor = await requireUser(request).catch((cause) => rethrowServerAuthenticationFailure(cause));
    if ([...request.nextUrl.searchParams.keys()].length) throw new AppError({ code: 'COLLABORATOR_DOCUMENTS_QUERY_INVALID', kind: 'VALIDATION' });
    return { actor, input: {}, resource: { workspaceId: actor.workspace_id, employeeId: actor.decoded.uid } };
  },
});

export const GET = secureRoute({ contract, enforcer }, async ({ security }) =>
  NextResponse.json({ documents: await listOwnPublishedDocuments(security.actor) }, { headers: { 'Cache-Control': 'private, no-store' } }));
