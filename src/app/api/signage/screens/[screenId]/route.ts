import { NextRequest, NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { type z } from 'zod';

import { dbAdmin } from '@/lib/firebase-admin';
import { signageDbAdmin } from '@/lib/firebase-signage-admin';
import { AppError } from '@/lib/observability/app-error';
import { createStandardSecurityEnforcer } from '@/lib/security/enforcer';
import { defineSecurityContract } from '@/lib/security/route-contract';
import { secureRoute } from '@/lib/security/secure-route.server';
import { getSlideScreenIds, pruneOrderByScreen, signageScreenUpdateSchema } from '@/lib/signage';
import { type SignageAccess } from '@/lib/signage-auth';
import {
  assertSignageKioskAccess,
  authenticateSignage,
  deleteSignageAssetIfOrphaned,
  generateDeviceToken,
  requireRouteId,
  resolveSignageScreen,
} from '@/lib/signage-server';
import { type SignageScreen } from '@/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_SLIDES_PER_SCREEN_DELETE = 400;

type RouteContext = { params: Promise<{ screenId: string }> };
type UpdateInput = z.infer<typeof signageScreenUpdateSchema>;

const updateContract = defineSecurityContract({
  schemaVersion: 1,
  id: 'signage.screen.update',
  version: 1,
  surface: { method: 'PATCH', path: '/api/signage/screens/[screenId]' },
  exposure: 'authenticated',
  identity: { kind: 'active-user' },
  authorization: { kind: 'permission', action: 'signage.manage' },
  resourceScope: { kind: 'unit' },
  input: { kind: 'schema', schema: 'signage.screen.update-input', unknownFields: 'reject' },
  effects: { mode: 'write', audit: 'none' },
  errorExposure: 'sanitized',
});

const deleteContract = defineSecurityContract({
  schemaVersion: 1,
  id: 'signage.screen.delete',
  version: 1,
  surface: { method: 'DELETE', path: '/api/signage/screens/[screenId]' },
  exposure: 'authenticated',
  identity: { kind: 'active-user' },
  authorization: { kind: 'permission', action: 'signage.manage' },
  resourceScope: { kind: 'unit' },
  input: { kind: 'none' },
  effects: { mode: 'delete', audit: 'none' },
  errorExposure: 'sanitized',
});

async function loadScreen(routeContext: RouteContext): Promise<SignageScreen> {
  const { screenId } = await routeContext.params;
  const screen = await resolveSignageScreen(requireRouteId(screenId, 'Tela'));
  if (!screen) throw new AppError({ code: 'SIGNAGE_SCREEN_NOT_FOUND', kind: 'NOT_FOUND', safeMessage: 'Tela não encontrada.' });
  return screen;
}

const updateEnforcer = createStandardSecurityEnforcer<NextRequest, RouteContext, unknown, SignageAccess, UpdateInput, SignageScreen>(updateContract, {
  authenticate: ({ request }) => authenticateSignage(request, 'manage'),
  async parseInput({ request }) {
    const parsed = signageScreenUpdateSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      throw new AppError({ code: 'SIGNAGE_SCREEN_INPUT_INVALID', kind: 'VALIDATION', safeMessage: 'Informe um nome de até 60 caracteres.' });
    }
    return parsed.data;
  },
  loadResource: ({ routeContext }) => loadScreen(routeContext),
  authorize: () => undefined,
  assertScope: ({ actor, resource }) => assertSignageKioskAccess(actor, [resource.kioskId]),
});

const deleteEnforcer = createStandardSecurityEnforcer<NextRequest, RouteContext, unknown, SignageAccess, undefined, SignageScreen>(deleteContract, {
  authenticate: ({ request }) => authenticateSignage(request, 'manage'),
  loadResource: ({ routeContext }) => loadScreen(routeContext),
  authorize: () => undefined,
  assertScope: ({ actor, resource }) => assertSignageKioskAccess(actor, [resource.kioskId]),
});

export const PATCH = secureRoute({ contract: updateContract, enforcer: updateEnforcer }, async ({ security }) => {
  const { input, resource: screen } = security;
  const nextToken = input.token === 'rotate' ? generateDeviceToken() : undefined;
  const screenRef = signageDbAdmin.collection('screens').doc(screen.id);

  if (screen.isDefault) {
    // O nome da tela padrão fica num documento de mesmo id da unidade; o código continua no cadastro da unidade.
    if (input.name !== undefined) await screenRef.set({ kioskId: screen.kioskId, name: input.name }, { merge: true });
    if (input.token) {
      await dbAdmin.collection('kiosks').doc(screen.kioskId).update({ deviceToken: nextToken ?? FieldValue.delete() });
    }
  } else {
    await screenRef.update({
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.token ? { deviceToken: nextToken ?? FieldValue.delete() } : {}),
    });
  }

  const updated: SignageScreen = {
    id: screen.id,
    kioskId: screen.kioskId,
    kioskName: screen.kioskName,
    name: input.name ?? screen.name,
    isDefault: screen.isDefault,
    ...(input.token ? (nextToken ? { deviceToken: nextToken } : {}) : (screen.deviceToken ? { deviceToken: screen.deviceToken } : {})),
  };
  return NextResponse.json({ screen: updated });
});

export const DELETE = secureRoute({ contract: deleteContract, enforcer: deleteEnforcer }, async ({ security }) => {
  const screen = security.resource;
  if (screen.isDefault) {
    throw new AppError({ code: 'SIGNAGE_SCREEN_DEFAULT', kind: 'CONFLICT', safeMessage: 'A primeira tela da unidade não pode ser excluída.' });
  }

  const slidesSnap = await signageDbAdmin.collection('slides')
    .where('screenIds', 'array-contains', screen.id)
    .limit(MAX_SLIDES_PER_SCREEN_DELETE + 1)
    .get();
  if (slidesSnap.size > MAX_SLIDES_PER_SCREEN_DELETE) {
    throw new AppError({ code: 'SIGNAGE_SCREEN_TOO_MANY_SLIDES', kind: 'CONFLICT', safeMessage: 'Esta tela tem slides demais para excluir de uma vez. Remova parte deles antes.' });
  }

  // Telas restantes de cada slide, para recalcular as unidades donas sem ler tela por tela.
  const kioskByScreen = new Map<string, string>();
  const otherScreenIds = new Set(slidesSnap.docs.flatMap((doc) => getSlideScreenIds(doc.data())).filter((id) => id !== screen.id));
  await Promise.all(Array.from(otherScreenIds).map(async (screenId) => {
    const other = await resolveSignageScreen(screenId);
    if (other) kioskByScreen.set(screenId, other.kioskId);
  }));

  const orphanedAssets: Array<{ assetPath: string; slideId: string }> = [];
  const batch = signageDbAdmin.batch();
  slidesSnap.docs.forEach((doc) => {
    const data = doc.data();
    const remaining = getSlideScreenIds(data).filter((id) => id !== screen.id && kioskByScreen.has(id));
    if (!remaining.length) {
      // Slide que só existia nesta tela sai junto com ela.
      batch.delete(doc.ref);
      if (typeof data.assetPath === 'string') orphanedAssets.push({ assetPath: data.assetPath, slideId: doc.id });
      return;
    }
    batch.update(doc.ref, {
      screenIds: remaining,
      kioskIds: Array.from(new Set(remaining.map((id) => kioskByScreen.get(id) as string))),
      orderByScreen: pruneOrderByScreen(data.orderByScreen, remaining) ?? FieldValue.delete(),
    });
  });
  batch.delete(signageDbAdmin.collection('publishedPlayers').doc(screen.id));
  batch.delete(signageDbAdmin.collection('playerHeartbeats').doc(screen.id));
  batch.delete(signageDbAdmin.collection('screens').doc(screen.id));
  await batch.commit();

  // A mídia sai do Storage depois do commit; uma falha aqui deixa só um arquivo sem uso.
  await Promise.allSettled(orphanedAssets.map(({ assetPath, slideId }) => deleteSignageAssetIfOrphaned(assetPath, slideId)));
  return NextResponse.json({ success: true, removedSlides: orphanedAssets.length });
});
