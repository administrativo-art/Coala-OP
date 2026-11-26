import { NextResponse } from 'next/server';
import { portalClosureQuerySchema, portalClosureAccessSchema } from '@/features/service-portal/closure-schemas';
import { portalClosureEnforcer } from '@/features/service-portal/closure-route-security.server';
import { listReleasedClosures, readReleasedPayslip, recordClosureAccess } from '@/features/service-portal/closure-server';
import { closureStorage } from '@/features/service-portal/closure-storage.server';
import { defineSecurityContract } from '@/lib/security/route-contract';
import { secureRoute } from '@/lib/security/secure-route.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const contract = (method: 'GET' | 'POST') => defineSecurityContract({
  schemaVersion: 1, id: 'service-portal.closures.' + method.toLowerCase(), version: 1,
  surface: { method, path: '/api/service-portal/closures' }, exposure: 'authenticated',
  identity: { kind: 'custom', strategy: 'service-provider-session', guarantees: ['authenticated-user', 'active-user'] },
  authorization: { kind: 'custom', strategy: 'provider-closure-grant' }, resourceScope: { kind: 'workspace' },
  input: { kind: 'schema', schema: 'service-portal.closure-access', unknownFields: 'reject' },
  effects: { mode: method === 'GET' ? 'read' : 'write', audit: method === 'GET' ? 'none' : 'server-authoritative' }, errorExposure: 'sanitized',
});
export const GET = secureRoute({ contract: contract('GET'), enforcer: portalClosureEnforcer(portalClosureQuerySchema) }, async ({ security }) =>
  NextResponse.json(await listReleasedClosures(security.actor, security.input.grantId), { headers: { 'Cache-Control': 'private, no-store' } }));
export const POST = secureRoute({ contract: contract('POST'), enforcer: portalClosureEnforcer(portalClosureAccessSchema) }, async ({ security }) => {
  const input = security.input;
  if (input.action === 'open') {
    return NextResponse.json(await recordClosureAccess(security.actor, input), { headers: { 'Cache-Control': 'private, no-store' } });
  }
  const file = await readReleasedPayslip(security.actor, input.grantId, input.releaseId, closureStorage);
  await recordClosureAccess(security.actor, input);
  return new NextResponse(new Uint8Array(file.bytes), {
    headers: { 'Cache-Control': 'private, no-store', 'Content-Type': 'application/pdf',
      'Content-Disposition': "attachment; filename*=UTF-8''" + encodeURIComponent(file.filename), 'X-Content-Type-Options': 'nosniff' },
  });
});
