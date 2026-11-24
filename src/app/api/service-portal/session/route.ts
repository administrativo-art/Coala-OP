import { NextResponse, type NextRequest } from 'next/server';
import { authenticatePortalSession } from '@/features/service-portal/auth.server';
import { listPortalGrants } from '@/features/service-portal/management.server';
import { PORTAL_COOKIE } from '@/features/service-portal/route-security.server';
import type { PortalPrincipal } from '@/features/service-portal/types';
import { dbAdmin } from '@/lib/firebase-admin';
import { AppError } from '@/lib/observability/app-error';
import { defineSecurityContract } from '@/lib/security/route-contract';
import { defineSecurityEnforcer } from '@/lib/security/enforcer';
import { secureRoute } from '@/lib/security/secure-route.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const contract = defineSecurityContract({
  schemaVersion: 1, id: 'service-portal.session', version: 1,
  surface: { method: 'GET', path: '/api/service-portal/session' }, exposure: 'authenticated',
  identity: { kind: 'custom', strategy: 'service-provider-session', guarantees: ['authenticated-user', 'active-user'] },
  authorization: { kind: 'owner' }, resourceScope: { kind: 'owner' },
  input: { kind: 'none' }, effects: { mode: 'read', audit: 'none' }, errorExposure: 'sanitized',
});
const enforcer = defineSecurityEnforcer<NextRequest, unknown, unknown, PortalPrincipal, undefined, { memberId: string }>({
  id: 'service-provider-session-v1', guarantees: ['identity:service-provider-session', 'authenticated-user', 'active-user', 'owner-checked'],
  async enforce({ request }) {
    const token = request.cookies.get(PORTAL_COOKIE)?.value;
    if (!token) throw new AppError({ code: 'PROVIDER_SESSION_REQUIRED', kind: 'AUTHENTICATION', safeMessage: 'Entre no Portal do Contador.' });
    const actor = await authenticatePortalSession(token);
    return { actor, input: undefined, resource: { memberId: actor.memberId } };
  },
});
export const GET = secureRoute({ contract, enforcer }, async ({ security }) => {
  const grants = await listPortalGrants(security.actor);
  const employerIds = [...new Set(grants.map((grant) => grant.employerUnitId))];
  const employers = employerIds.length ? await dbAdmin.getAll(...employerIds.map((id) => dbAdmin.collection('dp_units').doc(id)), { fieldMask: ['name', 'cnpj'] }) : [];
  const companies = new Map(employers.map((doc) => [doc.id, {
    name: String(doc.get('name') ?? 'Empresa autorizada'), cnpj: String(doc.get('cnpj') ?? ''),
  }]));
  return NextResponse.json({
    principal: security.actor,
    grants: grants.map((grant) => ({
      id: grant.id, employerUnitId: grant.employerUnitId,
      employerName: companies.get(grant.employerUnitId)?.name ?? 'Empresa autorizada',
      employerCnpj: companies.get(grant.employerUnitId)?.cnpj ?? '',
      competence: grant.competence, expiresAt: grant.expiresAt,
    })),
  }, { headers: { 'Cache-Control': 'private, no-store' } });
});
