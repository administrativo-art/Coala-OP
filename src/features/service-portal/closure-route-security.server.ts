import 'server-only';
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireUser, type ServerUserContext } from '@/lib/auth-server';
import { rethrowServerAuthenticationFailure } from '@/lib/server-authentication-failure';
import { dbAdmin } from '@/lib/firebase-admin';
import { AppError } from '@/lib/observability/app-error';
import { resolveUnitAccess } from '@/lib/unit-access';
import { canReview } from '@/features/dp/time-adjustments/service.server';
import { authenticatePortalSession } from './auth.server';
import { assertPortalOrigin, PORTAL_COOKIE } from './route-security.server';
import type { PortalPrincipal } from './types';
import { defineSecurityEnforcer } from '@/lib/security/enforcer';

export async function requireProviderManager(request: NextRequest): Promise<ServerUserContext> {
  const actor = await requireUser(request).catch((cause) => rethrowServerAuthenticationFailure(cause));
  if (actor.viewAs || (!actor.isDefaultAdmin && (actor.permissions.dp?.timeClosure?.close !== true || !canReview(actor)))
    || !resolveUnitAccess(actor.userDoc, { isDefaultAdmin: actor.isDefaultAdmin }).allUnits) {
    throw new AppError({ code: 'PROVIDER_MANAGEMENT_FORBIDDEN', kind: 'AUTHORIZATION', safeMessage: 'A liberação exige revisão e fechamento do RH com acesso a todas as unidades.' });
  }
  return actor;
}
export function portalClosureEnforcer<T extends { grantId: string }>(schema: z.ZodType<T>) {
  return defineSecurityEnforcer<NextRequest, unknown, unknown, PortalPrincipal, T, { workspaceId: string; grantId: string }>({
    id: 'provider-closure-access-v1',
    guarantees: ['identity:service-provider-session', 'authenticated-user', 'active-user', 'authorization:provider-closure-grant', 'workspace-scoped', 'input-validated', 'fields-allowlisted'],
    async enforce({ request }) {
      if (request.method !== 'GET') assertPortalOrigin(request);
      const token = request.cookies.get(PORTAL_COOKIE)?.value;
      if (!token) throw new AppError({ code: 'PROVIDER_SESSION_REQUIRED', kind: 'AUTHENTICATION', safeMessage: 'Entre no Portal do Contador.' });
      const actor = await authenticatePortalSession(token);
      const parsed = schema.safeParse(request.method === 'GET' ? Object.fromEntries(request.nextUrl.searchParams.entries()) : await request.json().catch(() => null));
      if (!parsed.success) throw new AppError({ code: 'PROVIDER_CLOSURE_INPUT', kind: 'VALIDATION', safeMessage: 'Escolha uma competência e um fechamento liberado.' });
      const grant = await dbAdmin.collection('providerPortalGrants').doc(parsed.data.grantId).get();
      if (!grant.exists || grant.get('workspaceId') !== actor.workspaceId || grant.get('officeId') !== actor.officeId
        || grant.get('memberId') !== actor.memberId || grant.get('revokedAt') !== null || !(Date.parse(grant.get('expiresAt')) > Date.now())) {
        throw new AppError({ code: 'PROVIDER_CLOSURE_GRANT', kind: 'AUTHORIZATION', safeMessage: 'Esta competência está fora do seu acesso atual.' });
      }
      return { actor, input: parsed.data, resource: { workspaceId: actor.workspaceId, grantId: parsed.data.grantId } };
    },
  });
}
