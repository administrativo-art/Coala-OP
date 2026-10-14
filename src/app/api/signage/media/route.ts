import { NextRequest, NextResponse } from 'next/server';
import { getStorage } from 'firebase-admin/storage';

import { adminApp } from '@/lib/firebase-admin';
import { signageDbAdmin } from '@/lib/firebase-signage-admin';
import { AppError } from '@/lib/observability/app-error';
import { createStandardSecurityEnforcer } from '@/lib/security/enforcer';
import { defineSecurityContract } from '@/lib/security/route-contract';
import { secureRoute } from '@/lib/security/secure-route.server';
import { SIGNAGE_IMAGE_MAX_BYTES, SIGNAGE_MEDIA_FOLDER_MAX, SIGNAGE_MEDIA_LIST_LIMIT, SIGNAGE_STORAGE_BUCKET, SIGNAGE_VIDEO_MAX_BYTES } from '@/lib/signage';
import { type SignageAccess } from '@/lib/signage-auth';
import {
  authenticateSignage,
  detectSignageAsset,
  getSignageMediaId,
  requireSignageMediaFolder,
  serializeSignageMedia,
  serializeSignageMediaFolder,
  type StaticRouteContext,
} from '@/lib/signage-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type UploadInput = { file: File; folderId: string | null };

// A biblioteca é uma só para todo o signage: quem tem a permissão vê e usa todas as mídias.
const listContract = defineSecurityContract({
  schemaVersion: 1,
  id: 'signage.media.list',
  version: 1,
  surface: { method: 'GET', path: '/api/signage/media' },
  exposure: 'authenticated',
  identity: { kind: 'active-user' },
  authorization: { kind: 'permission', action: 'signage.view' },
  resourceScope: { kind: 'none' },
  input: { kind: 'none' },
  effects: { mode: 'read', audit: 'none' },
  errorExposure: 'sanitized',
});

const uploadContract = defineSecurityContract({
  schemaVersion: 1,
  id: 'signage.media.upload',
  version: 1,
  surface: { method: 'POST', path: '/api/signage/media' },
  exposure: 'authenticated',
  identity: { kind: 'active-user' },
  authorization: { kind: 'permission', action: 'signage.manage' },
  resourceScope: { kind: 'none' },
  input: { kind: 'schema', schema: 'signage.media.upload-form', unknownFields: 'strip' },
  effects: { mode: 'write', audit: 'server-authoritative' },
  errorExposure: 'sanitized',
});

const listEnforcer = createStandardSecurityEnforcer<NextRequest, StaticRouteContext, unknown, SignageAccess, undefined, undefined>(listContract, {
  authenticate: ({ request }) => authenticateSignage(request, 'view'),
  authorize: () => undefined,
});

const uploadEnforcer = createStandardSecurityEnforcer<NextRequest, StaticRouteContext, unknown, SignageAccess, UploadInput, undefined>(uploadContract, {
  authenticate: ({ request }) => authenticateSignage(request, 'manage'),
  async parseInput({ request }) {
    const form = await request.formData().catch(() => null);
    const file = form?.get('file');
    const folderId = form?.get('folderId');
    if (!(file instanceof File) || file.size <= 0) {
      throw new AppError({ code: 'SIGNAGE_MEDIA_FILE_MISSING', kind: 'VALIDATION', safeMessage: 'Escolha um arquivo para enviar.' });
    }
    if (file.size > SIGNAGE_VIDEO_MAX_BYTES) {
      throw new AppError({ code: 'SIGNAGE_MEDIA_TOO_LARGE', kind: 'VALIDATION', safeMessage: 'Vídeos devem ter até 30 MB e imagens até 2 MB.' });
    }
    const validFolder = typeof folderId === 'string' && folderId && !folderId.includes('/') && folderId.length <= 160;
    return { file, folderId: validFolder ? folderId : null };
  },
  authorize: () => undefined,
});

export const GET = secureRoute({ contract: listContract, enforcer: listEnforcer }, async () => {
  // Biblioteca e pastas são limitadas; a mais recente primeiro.
  const [mediaSnap, foldersSnap] = await Promise.all([
    signageDbAdmin.collection('mediaLibrary').orderBy('createdAt', 'desc').limit(SIGNAGE_MEDIA_LIST_LIMIT).get(),
    signageDbAdmin.collection('mediaFolders').limit(SIGNAGE_MEDIA_FOLDER_MAX).get(),
  ]);
  return NextResponse.json({
    items: mediaSnap.docs.map((doc) => serializeSignageMedia(doc.id, doc.data())),
    folders: foldersSnap.docs
      .map((doc) => serializeSignageMediaFolder(doc.id, doc.data()))
      .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')),
    truncated: mediaSnap.size >= SIGNAGE_MEDIA_LIST_LIMIT,
  });
});

export const POST = secureRoute({ contract: uploadContract, enforcer: uploadEnforcer }, async ({ security }) => {
  const { file, folderId } = security.input;
  const buffer = Buffer.from(await file.arrayBuffer());
  const detected = detectSignageAsset(buffer);
  if (!detected) {
    throw new AppError({ code: 'SIGNAGE_MEDIA_TYPE_INVALID', kind: 'VALIDATION', safeMessage: 'Envie uma imagem (PNG, JPG ou WebP) ou um vídeo MP4.' });
  }
  if (detected.kind === 'image' && buffer.byteLength > SIGNAGE_IMAGE_MAX_BYTES) {
    throw new AppError({ code: 'SIGNAGE_MEDIA_TOO_LARGE', kind: 'VALIDATION', safeMessage: 'Imagens devem ter até 2 MB.' });
  }
  await requireSignageMediaFolder(folderId);

  const safeName = file.name.toLowerCase().replace(/[^a-z0-9.\-_]+/g, '-').slice(-80) || 'midia';
  const assetPath = `signage/${Date.now()}-${safeName}`;
  const object = getStorage(adminApp).bucket(SIGNAGE_STORAGE_BUCKET).file(assetPath);
  await object.save(buffer, { resumable: false, metadata: { contentType: detected.contentType } });

  const ref = signageDbAdmin.collection('mediaLibrary').doc(getSignageMediaId(assetPath));
  const data = {
    fileName: file.name.slice(0, 120) || safeName,
    kind: detected.kind,
    contentType: detected.contentType,
    sizeBytes: buffer.byteLength,
    assetPath,
    folderId,
    createdAt: new Date().toISOString(),
    createdBy: { userId: security.actor.user.id, username: security.actor.user.username },
  };
  try {
    await ref.create(data);
  } catch (cause) {
    // Sem o registro, o arquivo ficaria no bucket sem dono.
    await object.delete({ ignoreNotFound: true }).catch(() => undefined);
    throw cause;
  }

  return NextResponse.json({ item: serializeSignageMedia(ref.id, data) });
});
