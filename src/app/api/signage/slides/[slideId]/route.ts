import { NextRequest, NextResponse } from 'next/server';

import { signageDbAdmin } from '@/lib/firebase-signage-admin';
import { AppError } from '@/lib/observability/app-error';
import { createStandardSecurityEnforcer } from '@/lib/security/enforcer';
import { defineSecurityContract } from '@/lib/security/route-contract';
import { secureRoute } from '@/lib/security/secure-route.server';
import {
  getSlideScreenIds,
  mergeSlideScreenIds,
  pruneOrderByScreen,
  signageSlideSchema,
  stripUndefined,
  type SignageSlideInput,
} from '@/lib/signage';
import { type SignageAccess } from '@/lib/signage-auth';
import {
  authenticateSignage,
  canAccessSignageKiosk,
  deleteSignageAssetIfOrphaned,
  normalizeSignageSlide,
  requireRouteId,
  requireSignageScreens,
} from '@/lib/signage-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ slideId: string }> };
type SlideResource = { ref: FirebaseFirestore.DocumentReference; current: FirebaseFirestore.DocumentData };

const updateContract = defineSecurityContract({
  schemaVersion: 1,
  id: 'signage.slide.update',
  version: 1,
  surface: { method: 'PUT', path: '/api/signage/slides/[slideId]' },
  exposure: 'authenticated',
  identity: { kind: 'active-user' },
  authorization: { kind: 'permission', action: 'signage.manage' },
  resourceScope: { kind: 'unit' },
  input: { kind: 'schema', schema: 'signage.slide.input', unknownFields: 'reject' },
  effects: { mode: 'write', audit: 'server-authoritative' },
  errorExposure: 'sanitized',
});

const deleteContract = defineSecurityContract({
  schemaVersion: 1,
  id: 'signage.slide.delete',
  version: 1,
  surface: { method: 'DELETE', path: '/api/signage/slides/[slideId]' },
  exposure: 'authenticated',
  identity: { kind: 'active-user' },
  authorization: { kind: 'permission', action: 'signage.manage' },
  resourceScope: { kind: 'unit' },
  input: { kind: 'none' },
  effects: { mode: 'delete', audit: 'none' },
  errorExposure: 'sanitized',
});

async function loadSlide(routeContext: RouteContext): Promise<SlideResource> {
  const { slideId } = await routeContext.params;
  const ref = signageDbAdmin.collection('slides').doc(requireRouteId(slideId, 'Slide'));
  const snapshot = await ref.get();
  const current = snapshot.data();
  if (!snapshot.exists || !current) {
    throw new AppError({ code: 'SIGNAGE_SLIDE_NOT_FOUND', kind: 'NOT_FOUND', safeMessage: 'Slide não encontrado.' });
  }
  return { ref, current };
}

const updateEnforcer = createStandardSecurityEnforcer<NextRequest, RouteContext, unknown, SignageAccess, SignageSlideInput, SlideResource>(updateContract, {
  authenticate: ({ request }) => authenticateSignage(request, 'manage'),
  async parseInput({ request }) {
    const parsed = signageSlideSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      throw new AppError({ code: 'SIGNAGE_SLIDE_INPUT_INVALID', kind: 'VALIDATION', safeMessage: parsed.error.issues[0]?.message ?? 'Dados do slide inválidos.' });
    }
    return parsed.data;
  },
  loadResource: ({ routeContext }) => loadSlide(routeContext),
  authorize: () => undefined,
  // Editar exige alcançar ao menos uma unidade do slide; telas novas são conferidas no handler.
  assertScope({ actor, resource }) {
    if (!(resource.current.kioskIds ?? []).some((kioskId: string) => canAccessSignageKiosk(actor, kioskId))) {
      throw new AppError({ code: 'SIGNAGE_SLIDE_FORBIDDEN', kind: 'AUTHORIZATION', safeMessage: 'Sem acesso a este slide.' });
    }
  },
});

const deleteEnforcer = createStandardSecurityEnforcer<NextRequest, RouteContext, unknown, SignageAccess, undefined, SlideResource>(deleteContract, {
  authenticate: ({ request }) => authenticateSignage(request, 'manage'),
  loadResource: ({ routeContext }) => loadSlide(routeContext),
  authorize: () => undefined,
  // Excluir apaga o slide de todas as telas, então exige acesso a todas as unidades dele.
  assertScope({ actor, resource }) {
    const kioskIds: string[] = resource.current.kioskIds ?? [];
    if (!kioskIds.length || kioskIds.some((kioskId) => !canAccessSignageKiosk(actor, kioskId))) {
      throw new AppError({
        code: 'SIGNAGE_SLIDE_DELETE_FORBIDDEN',
        kind: 'AUTHORIZATION',
        safeMessage: 'Este slide também é exibido em unidades fora do seu acesso. Remova-o apenas das suas telas.',
      });
    }
  },
});

export const PUT = secureRoute({ contract: updateContract, enforcer: updateEnforcer }, async ({ security }) => {
  const { actor, input, resource } = security;
  const { ref, current } = resource;
  const currentScreenIds = getSlideScreenIds(current);

  // Telas atuais e pedidas, para saber de que unidade é cada uma.
  const known = await requireSignageScreens(input.screenIds);
  const currentOnly = currentScreenIds.filter((screenId) => !known.some((screen) => screen.id === screenId));
  const kioskByScreen = new Map(known.map((screen) => [screen.id, screen.kioskId]));
  // Tela atual que deixou de existir é tratada como fora do acesso e some no merge abaixo.
  const stale = new Set<string>();
  await Promise.all(currentOnly.map(async (screenId) => {
    const [screen] = await requireSignageScreens([screenId]).catch(() => [null]);
    if (screen) kioskByScreen.set(screen.id, screen.kioskId);
    else stale.add(screenId);
  }));

  const { screenIds, forbidden } = mergeSlideScreenIds({
    requested: input.screenIds,
    current: currentScreenIds.filter((screenId) => !stale.has(screenId)),
    canAccess: (screenId) => canAccessSignageKiosk(actor, kioskByScreen.get(screenId) ?? ''),
  });
  if (forbidden.length) {
    throw new AppError({ code: 'SIGNAGE_UNIT_FORBIDDEN', kind: 'AUTHORIZATION', safeMessage: 'Há telas de unidades fora do seu acesso.' });
  }

  // Posições das telas que quem edita não enxerga continuam como estavam.
  const orderByScreen = pruneOrderByScreen({ ...(current.orderByScreen ?? {}), ...(input.orderByScreen ?? {}) }, screenIds);
  const updatedData = stripUndefined({
    ...input,
    screenIds,
    kioskIds: Array.from(new Set(screenIds.map((screenId) => kioskByScreen.get(screenId)).filter((kioskId): kioskId is string => Boolean(kioskId)))),
    orderByScreen,
    createdAt: current.createdAt,
    createdBy: current.createdBy,
    updatedAt: new Date().toISOString(),
    updatedBy: { userId: actor.user.id, username: actor.user.username },
  });

  await ref.set(updatedData);
  if (current.assetPath && current.assetPath !== updatedData.assetPath) {
    await deleteSignageAssetIfOrphaned(current.assetPath, ref.id);
  }
  return NextResponse.json({ slide: normalizeSignageSlide(ref.id, updatedData) });
});

export const DELETE = secureRoute({ contract: deleteContract, enforcer: deleteEnforcer }, async ({ security }) => {
  const { ref, current } = security.resource;
  await ref.delete();
  await deleteSignageAssetIfOrphaned(current.assetPath, ref.id);
  return NextResponse.json({ success: true });
});
