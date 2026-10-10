import { NextRequest, NextResponse } from 'next/server';

import { signageDbAdmin } from '@/lib/firebase-signage-admin';
import { AppError } from '@/lib/observability/app-error';
import { createStandardSecurityEnforcer } from '@/lib/security/enforcer';
import { defineSecurityContract } from '@/lib/security/route-contract';
import { secureRoute } from '@/lib/security/secure-route.server';
import { pruneOrderByScreen, signageSlideSchema, stripUndefined, type SignageSlideInput } from '@/lib/signage';
import { type SignageAccess } from '@/lib/signage-auth';
import {
  assertSignageKioskAccess,
  authenticateSignage,
  canAccessSignageKiosk,
  normalizeSignageSlide,
  requireSignageScreens,
  type StaticRouteContext,
} from '@/lib/signage-server';
import { type SignageScreen } from '@/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const listContract = defineSecurityContract({
  schemaVersion: 1,
  id: 'signage.slide.list',
  version: 1,
  surface: { method: 'GET', path: '/api/signage/slides' },
  exposure: 'authenticated',
  identity: { kind: 'active-user' },
  authorization: { kind: 'permission', action: 'signage.view' },
  resourceScope: { kind: 'unit' },
  input: { kind: 'none' },
  effects: { mode: 'read', audit: 'none' },
  errorExposure: 'sanitized',
});

const createContract = defineSecurityContract({
  schemaVersion: 1,
  id: 'signage.slide.create',
  version: 1,
  surface: { method: 'POST', path: '/api/signage/slides' },
  exposure: 'authenticated',
  identity: { kind: 'active-user' },
  authorization: { kind: 'permission', action: 'signage.manage' },
  resourceScope: { kind: 'unit' },
  input: { kind: 'schema', schema: 'signage.slide.input', unknownFields: 'reject' },
  effects: { mode: 'write', audit: 'server-authoritative' },
  errorExposure: 'sanitized',
});

// A permissão é conferida em `authenticateSignage`; `authorize` existe para o contrato exigir a etapa.
const listEnforcer = createStandardSecurityEnforcer<NextRequest, StaticRouteContext, unknown, SignageAccess, undefined, SignageAccess>(listContract, {
  authenticate: ({ request }) => authenticateSignage(request, 'view'),
  loadResource: ({ actor }) => actor,
  authorize: () => undefined,
  // Listagem: o escopo é aplicado como filtro no handler.
  assertScope: () => undefined,
});

const createEnforcer = createStandardSecurityEnforcer<NextRequest, StaticRouteContext, unknown, SignageAccess, SignageSlideInput, SignageScreen[]>(createContract, {
  authenticate: ({ request }) => authenticateSignage(request, 'manage'),
  async parseInput({ request }) {
    const parsed = signageSlideSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      throw new AppError({ code: 'SIGNAGE_SLIDE_INPUT_INVALID', kind: 'VALIDATION', safeMessage: parsed.error.issues[0]?.message ?? 'Dados do slide inválidos.' });
    }
    return parsed.data;
  },
  loadResource: ({ input }) => requireSignageScreens(input.screenIds),
  authorize: () => undefined,
  assertScope: ({ actor, resource }) => assertSignageKioskAccess(actor, resource.map((screen) => screen.kioskId)),
});

export const GET = secureRoute({ contract: listContract, enforcer: listEnforcer }, async ({ security }) => {
  // Coleção inteira, como antes das telas: slides antigos não têm `screenIds` para filtrar na consulta.
  const snapshot = await signageDbAdmin.collection('slides').orderBy('order', 'asc').get();
  const slides = snapshot.docs
    .map((doc) => normalizeSignageSlide(doc.id, doc.data()))
    .filter((slide) => slide.kioskIds.some((kioskId) => canAccessSignageKiosk(security.resource, kioskId)));

  return NextResponse.json({ slides });
});

export const POST = secureRoute({ contract: createContract, enforcer: createEnforcer }, async ({ security }) => {
  const { actor, input, resource: screens } = security;
  const screenIds = screens.map((screen) => screen.id);
  const now = new Date().toISOString();
  const author = { userId: actor.user.id, username: actor.user.username };
  const slideData = stripUndefined({
    ...input,
    screenIds,
    kioskIds: Array.from(new Set(screens.map((screen) => screen.kioskId))),
    orderByScreen: pruneOrderByScreen(input.orderByScreen, screenIds),
    createdAt: now,
    updatedAt: now,
    createdBy: author,
    updatedBy: author,
  });

  const ref = await signageDbAdmin.collection('slides').add(slideData);
  return NextResponse.json({ slide: normalizeSignageSlide(ref.id, slideData) }, { status: 201 });
});
