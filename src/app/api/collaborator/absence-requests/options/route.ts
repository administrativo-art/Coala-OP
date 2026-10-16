import { NextResponse, type NextRequest } from 'next/server';
import type { ServerUserContext } from '@/lib/auth-server';
import { requireAbsenceRequestAccess } from '@/features/dp/absences/requests/access.server';
import { absenceRequestTargetUidSchema } from '@/features/dp/absences/requests/schemas';
import { z } from 'zod';
import { AppError } from '@/lib/observability/app-error';
import { listOwnAbsenceRequestOptions } from '@/features/dp/absences/requests/service.server';
import { absenceCatalogDatabase, absenceWorkflowReady } from '@/features/dp/absences/catalog.server';
import { defineSecurityEnforcer } from '@/lib/security/enforcer';
import { defineSecurityContract } from '@/lib/security/route-contract';
import { secureRoute } from '@/lib/security/secure-route.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const querySchema = z.object({ beneficiaryUid: absenceRequestTargetUidSchema.optional() }).strict();
const contract = defineSecurityContract({ schemaVersion: 1, id: 'collaborator.absence-requests.options', version: 1, surface: { method: 'GET', path: '/api/collaborator/absence-requests/options' }, exposure: 'authenticated', identity: { kind: 'active-user' }, authorization: { kind: 'permission', action: 'absence.requests.options' }, resourceScope: { kind: 'workspace' }, input: { kind: 'schema', schema: 'absence-options.query', unknownFields: 'reject' }, effects: { mode: 'read', audit: 'none' }, errorExposure: 'sanitized' });
const enforcer = defineSecurityEnforcer<NextRequest, { params: Promise<Record<string, never>> }, unknown, ServerUserContext, { beneficiaryUid?: string }, { workspaceId: string }>({
  id: 'collaborator-absence-options-v2', guarantees: ['authenticated-user', 'active-user', 'permission-checked', 'workspace-scoped', 'input-validated', 'fields-allowlisted'],
  async enforce({ request }) {
    const actor = await requireAbsenceRequestAccess(request);
    const query = querySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
    if (!query.success) throw new AppError({ code: 'ABSENCE_OPTIONS_INPUT_INVALID', kind: 'VALIDATION' });
    return { actor, input: query.data, resource: { workspaceId: actor.workspace_id } };
  },
});

export const GET = secureRoute({ contract, enforcer }, async ({ security }) => NextResponse.json(
  { absenceTypes: await listOwnAbsenceRequestOptions(security.actor, new Date(), security.input.beneficiaryUid), capabilities: { canCreate: await absenceWorkflowReady(), catalogDatabase: absenceCatalogDatabase() } },
  { headers: { 'Cache-Control': 'private, no-store' } },
));
