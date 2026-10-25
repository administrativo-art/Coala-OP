import { NextResponse, type NextRequest } from 'next/server';

import { checkRepPCollectorAvailability } from '@/features/dp/rep-p/availability.server';
import { createStandardSecurityEnforcer } from '@/lib/security/enforcer';
import { defineSecurityContract } from '@/lib/security/route-contract';
import { secureRoute } from '@/lib/security/secure-route.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type StaticRouteContext = { params: Promise<Record<string, never>> };

const contract = defineSecurityContract({
  schemaVersion: 1,
  id: 'rep-p.availability.check',
  version: 1,
  surface: { method: 'GET', path: '/api/dp/time-recording/availability' },
  exposure: 'public',
  identity: { kind: 'none' },
  authorization: { kind: 'none' },
  resourceScope: { kind: 'none' },
  input: { kind: 'none' },
  effects: { mode: 'read', audit: 'none' },
  errorExposure: 'sanitized',
});

const enforcer = createStandardSecurityEnforcer<NextRequest, StaticRouteContext, unknown>(contract, {});

export const GET = secureRoute({ contract, enforcer,
  observability: { source: 'rep-p', operation: 'availability-check' } }, async () => {
  try {
    await checkRepPCollectorAvailability();
    return NextResponse.json({ status: 'ok' }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({ status: 'unavailable' }, {
      status: 503,
      headers: { 'Cache-Control': 'no-store', 'Retry-After': '30' },
    });
  }
});
