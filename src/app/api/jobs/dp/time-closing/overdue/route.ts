import { timingSafeEqual } from 'node:crypto';

import { NextResponse, type NextRequest } from 'next/server';

import { checkOverdueClosingPackages } from '@/features/dp/time-adjustments/closing-package.server';
import { AppError } from '@/lib/observability';
import { createStandardSecurityEnforcer } from '@/lib/security/enforcer';
import { defineSecurityContract } from '@/lib/security/route-contract';
import { secureRoute } from '@/lib/security/secure-route.server';
import { WORKSPACE_ID } from '@/lib/workspace';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type StaticRouteContext = { params: Promise<Record<string, never>> };

// Pacotes do fechamento sem assinatura em 24 horas ou recusados: aviso no sino de quem fecha o mês, de hora em hora.
const contract = defineSecurityContract({
  schemaVersion: 1, id: 'dp.time-closing.overdue.run', version: 1,
  surface: { method: 'POST', path: '/api/jobs/dp/time-closing/overdue' },
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

export const POST = secureRoute({ contract, enforcer, observability: { source: 'job-api', operation: 'dp-time-closing-overdue' } },
  async ({ security }) => {
    const result = await checkOverdueClosingPackages(security.resource.workspaceId);
    return NextResponse.json(result, { headers: { 'Cache-Control': 'private, no-store' } });
  });
