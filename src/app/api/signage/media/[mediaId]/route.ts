import { NextRequest, NextResponse } from 'next/server';
import { getStorage } from 'firebase-admin/storage';
import { type z } from 'zod';

import { adminApp } from '@/lib/firebase-admin';
import { signageDbAdmin } from '@/lib/firebase-signage-admin';
import { AppError } from '@/lib/observability/app-error';
import { createStandardSecurityEnforcer } from '@/lib/security/enforcer';
import { defineSecurityContract } from '@/lib/security/route-contract';
import { secureRoute } from '@/lib/security/secure-route.server';
import { SIGNAGE_STORAGE_BUCKET, signageMediaUpdateSchema } from '@/lib/signage';
import { type SignageAccess } from '@/lib/signage-auth';
import { authenticateSignage, requireRouteId, requireSignageMediaFolder, serializeSignageMedia } from '@/lib/signage-server';
import { type SignageMediaItem } from '@/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ mediaId: string }> };
type UpdateInput = z.infer<typeof signageMediaUpdateSchema>;

const updateContract = defineSecurityContract({
  schemaVersion: 1,
  id: 'signage.media.update',
  version: 1,
  surface: { method: 'PATCH', path: '/api/signage/media/[mediaId]' },
  exposure: 'authenticated',
  identity: { kind: 'active-user' },
  authorization: { kind: 'permission', action: 'signage.manage' },
  resourceScope: { kind: 'custom', strategy: 'signage.media-library-item' },
  input: { kind: 'schema', schema: 'signage.media.update-input', unknownFields: 'reject' },
  effects: { mode: 'write', audit: 'none' },
  errorExposure: 'sanitized',
});

const deleteContract = defineSecurityContract({
  schemaVersion: 1,
  id: 'signage.media.delete',
  version: 1,
  surface: { method: 'DELETE', path: '/api/signage/media/[mediaId]' },
  exposure: 'authenticated',
  identity: { kind: 'active-user' },
  authorization: { kind: 'permission', action: 'signage.manage' },
  resourceScope: { kind: 'custom', strategy: 'signage.media-library-item' },
  input: { kind: 'none' },
  effects: { mode: 'delete', audit: 'none' },
  errorExposure: 'sanitized',
});

async function loadMedia(routeContext: RouteContext): Promise<SignageMediaItem> {
  const { mediaId } = await routeContext.params;
  const snapshot = await signageDbAdmin.collection('mediaLibrary').doc(requireRouteId(mediaId, 'Mídia')).get();
  const data = snapshot.data();
  if (!snapshot.exists || !data || typeof data.assetPath !== 'string') {
    throw new AppError({ code: 'SIGNAGE_MEDIA_NOT_FOUND', kind: 'NOT_FOUND', safeMessage: 'Mídia não encontrada.' });
  }
  return serializeSignageMedia(snapshot.id, data);
}

const updateEnforcer = createStandardSecurityEnforcer<NextRequest, RouteContext, unknown, SignageAccess, UpdateInput, SignageMediaItem>(updateContract, {
  authenticate: ({ request }) => authenticateSignage(request, 'manage'),
  async parseInput({ request }) {
    const parsed = signageMediaUpdateSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      throw new AppError({ code: 'SIGNAGE_MEDIA_INPUT_INVALID', kind: 'VALIDATION', safeMessage: 'Informe um nome de até 120 caracteres.' });
    }
    return parsed.data;
  },
  loadResource: ({ routeContext }) => loadMedia(routeContext),
  authorize: () => undefined,
  // A biblioteca é compartilhada por todo o signage; não há recorte por unidade.
  assertScope: () => undefined,
});

const deleteEnforcer = createStandardSecurityEnforcer<NextRequest, RouteContext, unknown, SignageAccess, undefined, SignageMediaItem>(deleteContract, {
  authenticate: ({ request }) => authenticateSignage(request, 'manage'),
  loadResource: ({ routeContext }) => loadMedia(routeContext),
  authorize: () => undefined,
  assertScope: () => undefined,
});

export const PATCH = secureRoute({ contract: updateContract, enforcer: updateEnforcer }, async ({ security }) => {
  const { input, resource: media } = security;
  if (input.folderId !== undefined) await requireSignageMediaFolder(input.folderId);

  await signageDbAdmin.collection('mediaLibrary').doc(media.id).update({
    ...(input.fileName !== undefined ? { fileName: input.fileName } : {}),
    ...(input.folderId !== undefined ? { folderId: input.folderId } : {}),
  });
  return NextResponse.json({
    item: { ...media, fileName: input.fileName ?? media.fileName, folderId: input.folderId !== undefined ? input.folderId : media.folderId },
  });
});

export const DELETE = secureRoute({ contract: deleteContract, enforcer: deleteEnforcer }, async ({ security }) => {
  const media = security.resource;
  // Conferido no servidor em todos os slides, inclusive os de unidades que quem exclui não enxerga.
  const usage = await signageDbAdmin.collection('slides').where('assetPath', '==', media.assetPath).limit(1).get();
  if (!usage.empty) {
    throw new AppError({ code: 'SIGNAGE_MEDIA_IN_USE', kind: 'CONFLICT', safeMessage: 'Esta mídia está em uso em um slide. Remova o slide antes de excluir.' });
  }

  await signageDbAdmin.collection('mediaLibrary').doc(media.id).delete();
  await getStorage(adminApp).bucket(SIGNAGE_STORAGE_BUCKET).file(media.assetPath).delete({ ignoreNotFound: true });
  return NextResponse.json({ success: true });
});
