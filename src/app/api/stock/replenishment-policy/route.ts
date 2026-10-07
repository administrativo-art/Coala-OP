import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth-server';
import { replenishmentPolicyEnabled } from '@/lib/replenishment-feature';
import { withApiErrorHandling } from '@/lib/observability/api-error';
import { rethrowServerAuthenticationFailure } from '@/lib/server-authentication-failure';

export const runtime = 'nodejs';
export const GET = withApiErrorHandling({ source: 'api-stock', operation: 'read-replenishment-policy',
  routeOrJob: '/api/stock/replenishment-policy' }, async (request: NextRequest) => {
  try {
    await requireUser(request);
  } catch (error) {
    rethrowServerAuthenticationFailure(error);
  }
  return NextResponse.json({ enabled: replenishmentPolicyEnabled() });
});
