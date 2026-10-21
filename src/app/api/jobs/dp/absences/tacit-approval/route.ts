import { timingSafeEqual } from 'node:crypto';

import { NextResponse, type NextRequest } from 'next/server';

import { applyTacitAbsenceApprovals } from '@/features/dp/absences/requests/workflow.server';
import { AppError } from '@/lib/observability';
import { createStandardSecurityEnforcer } from '@/lib/security/enforcer';
import { defineSecurityContract } from '@/lib/security/route-contract';
import { secureRoute } from '@/lib/security/secure-route.server';
import { WORKSPACE_ID } from '@/lib/workspace';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type StaticRouteContext = { params: Promise<Record<string, never>> };

// Aprovação por decurso de prazo das ausências, de hora em hora; usa o mesmo segredo da rotina de avisos.
const contract = defineSecurityContract({
  schemaVersion: 1, id: 'dp.absences.tacit-approval.run', version: 1,
  surface: { method: 'POST', path: '/api/jobs/dp/absences/tacit-approval' },
  exposure: 'internal-service', identity: { kind: 'service-job', service: 'firebase-scheduler' },
  authorization: { kind: 'none' }, resourceScope: { kind: 'workspace' }, input: { kind: 'none' },
  effects: { mode: 'write', audit: 'server-authoritative' }, errorExposure: 'sanitized',
});

function authorized(actual: string, expected: string) {
  const left = Buffer.from(actual); const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

const enforcer = createStandardSecurityEnforcer<NextRequest, StaticRouteContext, unknown, { service: string }, undefined, { workspaceId: string }>(contract, {
  authenticate({ request }) {
    const secret = process.env.SYSTEM_NOTICES_JOB_SECRET?.trim();
    const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
    if (!secret || !authorized(token, secret)) {
      throw new AppError({ code: 'JOB_AUTHENTICATION_REQUIRED', kind: 'AUTHENTICATION', safeMessage: 'Não autorizado.', reportable: false });
    }
    return { service: 'firebase-scheduler' };
  },
  loadResource: () => ({ workspaceId: WORKSPACE_ID }),
  assertScope: ({ resource }) => {
    if (resource.workspaceId !== WORKSPACE_ID) throw new AppError({ code: 'JOB_WORKSPACE_FORBIDDEN', kind: 'AUTHORIZATION' });
  },
});

export const POST = secureRoute({ contract, enforcer, observability: { source: 'job-api', operation: 'dp-absences-tacit-approval' } },
  async ({ security }) => {
    const result = await applyTacitAbsenceApprovals(security.resource.workspaceId);
    return NextResponse.json(result, { headers: { 'Cache-Control': 'private, no-store' } });
  });
