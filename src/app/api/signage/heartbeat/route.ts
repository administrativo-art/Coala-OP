import { NextRequest, NextResponse } from 'next/server';
import { type z } from 'zod';

import { signageDbAdmin } from '@/lib/firebase-signage-admin';
import { AppError } from '@/lib/observability/app-error';
import { createStandardSecurityEnforcer } from '@/lib/security/enforcer';
import { defineSecurityContract } from '@/lib/security/route-contract';
import { secureRoute } from '@/lib/security/secure-route.server';
import { signageHeartbeatSchema, stripUndefined } from '@/lib/signage';
import { type SignageAccess } from '@/lib/signage-auth';
import { authenticateSignage, canAccessSignageKiosk, requirePlayerScreen, SIGNAGE_PLAYER_CORS_HEADERS, type StaticRouteContext } from '@/lib/signage-server';
import { type PlayerHeartbeat, type SignageScreen } from '@/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type HeartbeatInput = z.infer<typeof signageHeartbeatSchema>;

const listContract = defineSecurityContract({
  schemaVersion: 1,
  id: 'signage.heartbeat.list',
  version: 1,
  surface: { method: 'GET', path: '/api/signage/heartbeat' },
  exposure: 'authenticated',
  identity: { kind: 'active-user' },
  authorization: { kind: 'permission', action: 'signage.view' },
  resourceScope: { kind: 'unit' },
  input: { kind: 'none' },
  effects: { mode: 'read', audit: 'none' },
  errorExposure: 'sanitized',
});

// O player não tem login: a tela é reconhecida pelo id e, quando há um configurado, pelo código de acesso.
const reportContract = defineSecurityContract({
  schemaVersion: 1,
  id: 'signage.heartbeat.report',
  version: 1,
  surface: { method: 'POST', path: '/api/signage/heartbeat' },
  exposure: 'public',
  identity: { kind: 'none' },
  authorization: { kind: 'custom', strategy: 'signage.device-token-when-configured' },
  resourceScope: { kind: 'custom', strategy: 'signage.screen' },
  input: { kind: 'schema', schema: 'signage.heartbeat.input', unknownFields: 'strip' },
  effects: { mode: 'write', audit: 'none' },
  errorExposure: 'sanitized',
});

const listEnforcer = createStandardSecurityEnforcer<NextRequest, StaticRouteContext, unknown, SignageAccess, undefined, SignageAccess>(listContract, {
  authenticate: ({ request }) => authenticateSignage(request, 'view'),
  loadResource: ({ actor }) => actor,
  authorize: () => undefined,
  // Listagem: o escopo é aplicado como filtro no handler.
  assertScope: () => undefined,
});

const reportEnforcer = createStandardSecurityEnforcer<NextRequest, StaticRouteContext, unknown, undefined, HeartbeatInput, SignageScreen>(reportContract, {
  async parseInput({ request }) {
    const parsed = signageHeartbeatSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      throw new AppError({ code: 'SIGNAGE_HEARTBEAT_INPUT_INVALID', kind: 'VALIDATION', safeMessage: 'Tela não informada.' });
    }
    return parsed.data;
  },
  // `requirePlayerScreen` confere a existência da tela e o código de acesso.
  loadResource: ({ request, input }) => requirePlayerScreen((input.screenId ?? input.kioskId) as string, request.headers.get('x-device-token') ?? input.token ?? null),
  authorize: () => undefined,
  assertScope: () => undefined,
});

export const GET = secureRoute({ contract: listContract, enforcer: listEnforcer }, async ({ security }) => {
  // Um documento por tela; a coleção cresce com o número de TVs.
  const snapshot = await signageDbAdmin.collection('playerHeartbeats').get();
  const heartbeats = snapshot.docs
    .map((doc) => ({ ...doc.data(), screenId: doc.id } as PlayerHeartbeat))
    .filter((heartbeat) => canAccessSignageKiosk(security.resource, heartbeat.kioskId ?? heartbeat.screenId ?? ''));

  return NextResponse.json({ heartbeats });
});

export const POST = secureRoute({ contract: reportContract, enforcer: reportEnforcer }, async ({ security }) => {
  const { input, resource: screen } = security;
  const heartbeat = stripUndefined({
    kioskId: screen.kioskId,
    kioskName: screen.kioskName,
    screenId: screen.id,
    lastSeenAt: new Date().toISOString(),
    status: input.status ?? 'cache',
    currentSlideId: input.currentSlideId,
    updatedAt: input.updatedAt,
    appVersion: input.appVersion,
  });

  // A resposta leva a data da publicação vigente: o app do monitor só busca a playlist quando ela muda.
  const [, publishedSnap] = await Promise.all([
    signageDbAdmin.collection('playerHeartbeats').doc(screen.id).set(heartbeat, { merge: true }),
    signageDbAdmin.collection('publishedPlayers').doc(screen.id).get(),
  ]);
  const publishedAt = publishedSnap.data()?.updatedAt;
  return NextResponse.json(
    { success: true, publishedAt: typeof publishedAt === 'string' ? publishedAt : null },
    { headers: SIGNAGE_PLAYER_CORS_HEADERS },
  );
});
