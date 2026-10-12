import { NextRequest, NextResponse } from 'next/server';

import { signageDbAdmin } from '@/lib/firebase-signage-admin';
import { AppError } from '@/lib/observability/app-error';
import { createStandardSecurityEnforcer } from '@/lib/security/enforcer';
import { defineSecurityContract } from '@/lib/security/route-contract';
import { secureRoute } from '@/lib/security/secure-route.server';
import { requirePlayerScreen, requireRouteId, SIGNAGE_PLAYER_CORS_HEADERS } from '@/lib/signage-server';
import { type SignageScreen } from '@/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// O segmento se chama `kioskId` por histórico; ele carrega o id da tela (a padrão tem o id da unidade).
type RouteContext = { params: Promise<{ kioskId: string }> };

const contract = defineSecurityContract({
  schemaVersion: 1,
  id: 'signage.player.published',
  version: 1,
  surface: { method: 'GET', path: '/api/signage/public/[kioskId]' },
  exposure: 'public',
  identity: { kind: 'none' },
  authorization: { kind: 'custom', strategy: 'signage.device-token-when-configured' },
  resourceScope: { kind: 'custom', strategy: 'signage.screen' },
  input: { kind: 'none' },
  effects: { mode: 'read', audit: 'none' },
  errorExposure: 'sanitized',
});

const enforcer = createStandardSecurityEnforcer<NextRequest, RouteContext, unknown, undefined, undefined, SignageScreen>(contract, {
  // `requirePlayerScreen` confere a existência da tela e o código de acesso.
  async loadResource({ request, routeContext }) {
    const { kioskId } = await routeContext.params;
    const token = request.nextUrl.searchParams.get('token') ?? request.headers.get('x-device-token');
    return requirePlayerScreen(requireRouteId(kioskId, 'Tela'), token);
  },
  authorize: () => undefined,
  assertScope: () => undefined,
});

export const GET = secureRoute({ contract, enforcer }, async ({ security }) => {
  const snapshot = await signageDbAdmin.collection('publishedPlayers').doc(security.resource.id).get();
  if (!snapshot.exists) {
    throw new AppError({ code: 'SIGNAGE_NOT_PUBLISHED', kind: 'NOT_FOUND', safeMessage: 'Nenhum conteúdo publicado para esta tela.' });
  }
  return NextResponse.json(snapshot.data(), { headers: SIGNAGE_PLAYER_CORS_HEADERS });
});
