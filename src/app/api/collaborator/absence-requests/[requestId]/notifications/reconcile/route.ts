import { NextResponse, type NextRequest } from 'next/server';
import type { ServerUserContext } from '@/lib/auth-server';
import { requireAbsenceRequestAccess } from '@/features/dp/absences/requests/access.server';
import { absenceRequestRouteSchema } from '@/features/dp/absences/requests/workflow-schemas';
import { getAbsenceRequest } from '@/features/dp/absences/requests/workflow.server';
import { dispatchAbsenceNotification } from '@/features/dp/absences/requests/notifications.server';
import { AppError } from '@/lib/observability/app-error';
import { defineSecurityEnforcer } from '@/lib/security/enforcer';
import { defineSecurityContract } from '@/lib/security/route-contract';
import { secureRoute } from '@/lib/security/secure-route.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const contract = defineSecurityContract({ schemaVersion: 1, id: 'collaborator.absence-requests.notifications-reconcile', version: 1,
  surface: { method: 'POST', path: '/api/collaborator/absence-requests/[requestId]/notifications/reconcile' }, exposure: 'authenticated',
  identity: { kind: 'active-user' }, authorization: { kind: 'permission', action: 'absence.requests.reconcile' },
  resourceScope: { kind: 'workspace' }, input: { kind: 'schema', schema: 'absence-requests.id', unknownFields: 'reject' },
  effects: { mode: 'write', audit: 'server-authoritative' }, errorExposure: 'sanitized' });
const enforcer = defineSecurityEnforcer<NextRequest, { params: Promise<{ requestId: string }> }, unknown, ServerUserContext,
  { requestId: string }, { workspaceId: string }>({
  id: 'collaborator-absence-reconcile-v1', guarantees: ['authenticated-user', 'active-user', 'permission-checked', 'workspace-scoped', 'input-validated', 'fields-allowlisted'],
  async enforce({ request, routeContext }) {
    const actor = await requireAbsenceRequestAccess(request);
    const id = absenceRequestRouteSchema.safeParse(await routeContext.params);
    if (!id.success || request.headers.get('content-length') && request.headers.get('content-length') !== '0') {
      throw new AppError({ code: 'ABSENCE_RECONCILE_INPUT_INVALID', kind: 'VALIDATION' });
    }
    return { actor, input: id.data, resource: { workspaceId: actor.workspace_id } };
  },
});
export const POST = secureRoute({ contract, enforcer }, async ({ security }) => {
  const request = await getAbsenceRequest(security.actor, security.input.requestId);
  if (![request.beneficiaryUid, request.requesterUid, ...request.assignedReviewerIds].includes(security.actor.decoded.uid)) {
    throw new AppError({ code: 'ABSENCE_RECONCILE_FORBIDDEN', kind: 'AUTHORIZATION' });
  }
  return NextResponse.json(await dispatchAbsenceNotification(request.id, request.version),
    { headers: { 'Cache-Control': 'private, no-store' } });
});
