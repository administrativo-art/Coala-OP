import { NextRequest, NextResponse } from 'next/server';
import { type z } from 'zod';

import { signageDbAdmin } from '@/lib/firebase-signage-admin';
import { AppError } from '@/lib/observability/app-error';
import { createStandardSecurityEnforcer } from '@/lib/security/enforcer';
import { defineSecurityContract } from '@/lib/security/route-contract';
import { secureRoute } from '@/lib/security/secure-route.server';
import { SIGNAGE_MEDIA_LIST_LIMIT, signageMediaFolderSchema } from '@/lib/signage';
import { type SignageAccess } from '@/lib/signage-auth';
import { authenticateSignage, requireRouteId, serializeSignageMediaFolder } from '@/lib/signage-server';
import { type SignageMediaFolder } from '@/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ folderId: string }> };
type FolderInput = z.infer<typeof signageMediaFolderSchema>;

const renameContract = defineSecurityContract({
  schemaVersion: 1,
  id: 'signage.media-folder.rename',
  version: 1,
  surface: { method: 'PATCH', path: '/api/signage/media/folders/[folderId]' },
  exposure: 'authenticated',
  identity: { kind: 'active-user' },
  authorization: { kind: 'permission', action: 'signage.manage' },
  resourceScope: { kind: 'custom', strategy: 'signage.media-library-folder' },
  input: { kind: 'schema', schema: 'signage.media-folder.input', unknownFields: 'reject' },
  effects: { mode: 'write', audit: 'none' },
  errorExposure: 'sanitized',
});

const deleteContract = defineSecurityContract({
  schemaVersion: 1,
  id: 'signage.media-folder.delete',
  version: 1,
  surface: { method: 'DELETE', path: '/api/signage/media/folders/[folderId]' },
  exposure: 'authenticated',
  identity: { kind: 'active-user' },
  authorization: { kind: 'permission', action: 'signage.manage' },
  resourceScope: { kind: 'custom', strategy: 'signage.media-library-folder' },
  input: { kind: 'none' },
  effects: { mode: 'delete', audit: 'none' },
  errorExposure: 'sanitized',
});

async function loadFolder(routeContext: RouteContext): Promise<SignageMediaFolder> {
  const { folderId } = await routeContext.params;
  const snapshot = await signageDbAdmin.collection('mediaFolders').doc(requireRouteId(folderId, 'Pasta')).get();
  const data = snapshot.data();
  if (!snapshot.exists || !data) {
    throw new AppError({ code: 'SIGNAGE_MEDIA_FOLDER_NOT_FOUND', kind: 'NOT_FOUND', safeMessage: 'Pasta não encontrada.' });
  }
  return serializeSignageMediaFolder(snapshot.id, data);
}

const renameEnforcer = createStandardSecurityEnforcer<NextRequest, RouteContext, unknown, SignageAccess, FolderInput, SignageMediaFolder>(renameContract, {
  authenticate: ({ request }) => authenticateSignage(request, 'manage'),
  async parseInput({ request }) {
    const parsed = signageMediaFolderSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      throw new AppError({ code: 'SIGNAGE_MEDIA_FOLDER_INPUT_INVALID', kind: 'VALIDATION', safeMessage: 'Informe um nome de até 60 caracteres.' });
    }
    return parsed.data;
  },
  loadResource: ({ routeContext }) => loadFolder(routeContext),
  authorize: () => undefined,
  // A biblioteca é compartilhada por todo o signage; não há recorte por unidade.
  assertScope: () => undefined,
});

const deleteEnforcer = createStandardSecurityEnforcer<NextRequest, RouteContext, unknown, SignageAccess, undefined, SignageMediaFolder>(deleteContract, {
  authenticate: ({ request }) => authenticateSignage(request, 'manage'),
  loadResource: ({ routeContext }) => loadFolder(routeContext),
  authorize: () => undefined,
  assertScope: () => undefined,
});

export const PATCH = secureRoute({ contract: renameContract, enforcer: renameEnforcer }, async ({ security }) => {
  await signageDbAdmin.collection('mediaFolders').doc(security.resource.id).update({ name: security.input.name });
  return NextResponse.json({ folder: { id: security.resource.id, name: security.input.name } });
});

export const DELETE = secureRoute({ contract: deleteContract, enforcer: deleteEnforcer }, async ({ security }) => {
  const folder = security.resource;
  // As mídias não são apagadas: voltam para "Sem pasta" junto com a exclusão da pasta.
  const mediaSnap = await signageDbAdmin.collection('mediaLibrary').where('folderId', '==', folder.id).limit(SIGNAGE_MEDIA_LIST_LIMIT).get();
  const batch = signageDbAdmin.batch();
  mediaSnap.docs.forEach((doc) => batch.update(doc.ref, { folderId: null }));
  batch.delete(signageDbAdmin.collection('mediaFolders').doc(folder.id));
  await batch.commit();
  return NextResponse.json({ success: true, movedToRoot: mediaSnap.size });
});
