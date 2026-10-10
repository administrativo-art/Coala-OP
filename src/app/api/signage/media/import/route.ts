import { NextRequest, NextResponse } from 'next/server';
import { getStorage } from 'firebase-admin/storage';

import { adminApp } from '@/lib/firebase-admin';
import { signageDbAdmin } from '@/lib/firebase-signage-admin';
import { createStandardSecurityEnforcer } from '@/lib/security/enforcer';
import { defineSecurityContract } from '@/lib/security/route-contract';
import { secureRoute } from '@/lib/security/secure-route.server';
import { SIGNAGE_STORAGE_BUCKET } from '@/lib/signage';
import { type SignageAccess } from '@/lib/signage-auth';
import { authenticateSignage, getSignageMediaId, type StaticRouteContext } from '@/lib/signage-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_SLIDES_SCANNED = 1000;

// Mídias enviadas antes de a biblioteca existir só estão nos slides; esta ação as registra.
const contract = defineSecurityContract({
  schemaVersion: 1,
  id: 'signage.media.import-from-slides',
  version: 1,
  surface: { method: 'POST', path: '/api/signage/media/import' },
  exposure: 'authenticated',
  identity: { kind: 'active-user' },
  authorization: { kind: 'permission', action: 'signage.manage' },
  resourceScope: { kind: 'none' },
  input: { kind: 'none' },
  effects: { mode: 'write', audit: 'none' },
  errorExposure: 'sanitized',
});

const enforcer = createStandardSecurityEnforcer<NextRequest, StaticRouteContext, unknown, SignageAccess, undefined, undefined>(contract, {
  authenticate: ({ request }) => authenticateSignage(request, 'manage'),
  authorize: () => undefined,
});

export const POST = secureRoute({ contract, enforcer }, async ({ security }) => {
  // Ação manual e rara; lê os slides uma vez, com teto.
  const slidesSnap = await signageDbAdmin.collection('slides').limit(MAX_SLIDES_SCANNED).get();
  const byPath = new Map<string, { title: string; kind: 'image' | 'video' }>();
  slidesSnap.docs.forEach((doc) => {
    const data = doc.data();
    if (typeof data.assetPath !== 'string' || !/^signage\/[^/]+$/.test(data.assetPath) || byPath.has(data.assetPath)) return;
    byPath.set(data.assetPath, { title: String(data.title ?? ''), kind: data.assetKind === 'video' ? 'video' : 'image' });
  });

  const library = signageDbAdmin.collection('mediaLibrary');
  const bucket = getStorage(adminApp).bucket(SIGNAGE_STORAGE_BUCKET);
  let imported = 0;
  for (const [assetPath, slide] of byPath) {
    const ref = library.doc(getSignageMediaId(assetPath));
    if ((await ref.get()).exists) continue;
    const [exists] = await bucket.file(assetPath).exists();
    if (!exists) continue;
    const [metadata] = await bucket.file(assetPath).getMetadata();
    // `create` falha se outra pessoa importou a mesma mídia no meio do caminho; ela já está lá.
    const created = await ref.create({
      fileName: slide.title.slice(0, 120) || assetPath.slice('signage/'.length),
      kind: slide.kind,
      contentType: metadata.contentType ?? (slide.kind === 'video' ? 'video/mp4' : 'image/jpeg'),
      sizeBytes: Number(metadata.size ?? 0),
      assetPath,
      folderId: null,
      createdAt: typeof metadata.timeCreated === 'string' ? metadata.timeCreated : new Date().toISOString(),
      createdBy: { userId: security.actor.user.id, username: security.actor.user.username },
    }).then(() => true, () => false);
    if (created) imported += 1;
  }

  return NextResponse.json({ imported });
});
