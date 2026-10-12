import { NextRequest, NextResponse } from 'next/server';

import { assertCanManageMobileSignage, loadMobileSignageUnits } from '@/features/signage/mobile-screen.server';
import { requireUser, type ServerUserContext } from '@/lib/auth-server';
import { AppError } from '@/lib/observability/app-error';
import { defineSecurityEnforcer } from '@/lib/security/enforcer';
import { assertMobileAppAttested } from '@/lib/security/mobile-app-attestation.server';
import { defineSecurityContract } from '@/lib/security/route-contract';
import { secureRoute } from '@/lib/security/secure-route.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type StaticRouteContext = { params: Promise<Record<string, never>> };

const contract = defineSecurityContract({
  schemaVersion: 1,
  id: 'signage.mobile.units',
  version: 1,
  surface: { method: 'GET', path: '/api/signage/mobile' },
  exposure: 'authenticated',
  identity: { kind: 'active-user' },
  authorization: { kind: 'permission', action: 'app.signage.manage' },
  resourceScope: { kind: 'workspace' },
  input: { kind: 'none' },
  effects: { mode: 'read', audit: 'none' },
  errorExposure: 'sanitized',
});

const enforcer = defineSecurityEnforcer<NextRequest, StaticRouteContext, unknown, ServerUserContext, null, { workspaceId: string }>({
  id: 'signage-mobile-units-v1',
  guarantees: ['authenticated-user', 'active-user', 'permission-checked', 'workspace-scoped'],
  async enforce({ request }) {
    const actor = await requireUser(request).catch((cause) => {
      throw new AppError({ code: 'MOBILE_SIGNAGE_AUTH_REQUIRED', kind: 'AUTHENTICATION', cause });
    });
    assertMobileAppAttested(request, actor.decoded.uid);
    assertCanManageMobileSignage(actor);
    return { actor, input: null, resource: { workspaceId: actor.workspace_id } };
  },
});

// As unidades são restritas ao escopo do usuário dentro da listagem.
export const GET = secureRoute({ contract, enforcer }, async ({ security }) =>
  NextResponse.json(await loadMobileSignageUnits(security.actor), { headers: { 'Cache-Control': 'private, no-store' } }));
