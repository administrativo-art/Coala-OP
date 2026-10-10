import { NextRequest, NextResponse } from 'next/server';

import { signageDbAdmin } from '@/lib/firebase-signage-admin';
import { AppError } from '@/lib/observability/app-error';
import { createStandardSecurityEnforcer } from '@/lib/security/enforcer';
import { defineSecurityContract } from '@/lib/security/route-contract';
import { secureRoute } from '@/lib/security/secure-route.server';
import { buildPublishedPlayerDocument, signagePublishSchema } from '@/lib/signage';
import { type SignageAccess } from '@/lib/signage-auth';
import {
  assertSignageKioskAccess,
  authenticateSignage,
  normalizeSignageSlide,
  requireSignageScreens,
  type StaticRouteContext,
} from '@/lib/signage-server';
import { type SignageScreen } from '@/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type PublishInput = { screenIds: string[] };

const contract = defineSecurityContract({
  schemaVersion: 1,
  id: 'signage.publish',
  version: 1,
  surface: { method: 'POST', path: '/api/signage/publish' },
  exposure: 'authenticated',
  identity: { kind: 'active-user' },
  authorization: { kind: 'permission', action: 'signage.manage' },
  resourceScope: { kind: 'unit' },
  input: { kind: 'schema', schema: 'signage.publish.input', unknownFields: 'reject' },
  effects: { mode: 'write', audit: 'server-authoritative' },
  errorExposure: 'sanitized',
});

const enforcer = createStandardSecurityEnforcer<NextRequest, StaticRouteContext, unknown, SignageAccess, PublishInput, SignageScreen[]>(contract, {
  authenticate: ({ request }) => authenticateSignage(request, 'manage'),
  async parseInput({ request }) {
    const parsed = signagePublishSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      throw new AppError({ code: 'SIGNAGE_PUBLISH_INPUT_INVALID', kind: 'VALIDATION', safeMessage: 'Selecione ao menos uma tela para publicar.' });
    }
    return parsed.data;
  },
  loadResource: ({ input }) => requireSignageScreens(input.screenIds),
  authorize: () => undefined,
  assertScope: ({ actor, resource }) => assertSignageKioskAccess(actor, resource.map((screen) => screen.kioskId)),
});

export const POST = secureRoute({ contract, enforcer }, async ({ security }) => {
  const { actor, resource: screens } = security;
  // Coleção inteira, como antes das telas: slides antigos não têm `screenIds` para filtrar na consulta.
  const slidesSnap = await signageDbAdmin.collection('slides').get();
  const slides = slidesSnap.docs.map((doc) => normalizeSignageSlide(doc.id, doc.data()));
  const author = { userId: actor.user.id, username: actor.user.username };

  // `generatedBy` e `updatedAt` no próprio documento registram quem publicou e quando.
  const batch = signageDbAdmin.batch();
  screens.forEach((screen) => {
    batch.set(signageDbAdmin.collection('publishedPlayers').doc(screen.id), buildPublishedPlayerDocument(screen, slides, author));
  });
  await batch.commit();

  return NextResponse.json({ success: true, publishedScreenIds: screens.map((screen) => screen.id) });
});
