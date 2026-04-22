import { NextRequest, NextResponse } from 'next/server';
import { getStorage } from 'firebase-admin/storage';

import { adminApp } from '@/lib/firebase-admin';
import { signageDbAdmin } from '@/lib/firebase-signage-admin';
import { sanitizeKioskIds, signageSlideSchema, SIGNAGE_STORAGE_BUCKET, stripUndefined } from '@/lib/signage';
import { assertSignageAccess } from '@/lib/signage-auth';

async function deleteAssetIfOrphaned(assetPath?: string, excludingSlideId?: string) {
  if (!assetPath) return;

  const duplicates = await signageDbAdmin.collection('slides')
    .where('assetPath', '==', assetPath)
    .get();

  const stillReferenced = duplicates.docs.some(doc => doc.id !== excludingSlideId);
  if (stillReferenced) return;

  await getStorage(adminApp).bucket(SIGNAGE_STORAGE_BUCKET).file(assetPath).delete({ ignoreNotFound: true });
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ slideId: string }> }) {
  try {
    const access = await assertSignageAccess(req, 'manage');
    const { slideId } = await params;
    const slideRef = signageDbAdmin.collection('slides').doc(slideId);
    const existing = await slideRef.get();

    if (!existing.exists) {
      return NextResponse.json({ error: 'Slide não encontrado.' }, { status: 404 });
    }

    const current = existing.data()!;
    if (!access.isAdmin && !(current.kioskIds ?? []).some((kioskId: string) => access.allowedKioskIds.includes(kioskId))) {
      return NextResponse.json({ error: 'Sem acesso a este slide.' }, { status: 403 });
    }

    const payload = await req.json();
    const normalizedPayload = {
      ...payload,
      assetPath: payload.assetPath || undefined,
      assetKind: payload.assetKind || undefined,
      text: payload.text || undefined,
      background: payload.background || undefined,
    };
    const parsed = signageSlideSchema.parse({
      ...normalizedPayload,
      durationMs: Number(normalizedPayload.durationMs),
      order: Number(normalizedPayload.order),
      isActive: normalizedPayload.isActive === true,
    });

    const kioskIds = sanitizeKioskIds(parsed.kioskIds, access.allowedKioskIds, access.isAdmin);
    if (!kioskIds.length) {
      return NextResponse.json({ error: 'Selecione ao menos um quiosque permitido.' }, { status: 400 });
    }

    const updatedData = stripUndefined({
      ...parsed,
      kioskIds,
      createdAt: current.createdAt,
      createdBy: current.createdBy,
      updatedAt: new Date().toISOString(),
      updatedBy: { userId: access.user.id, username: access.user.username },
    });

    await slideRef.set(updatedData);
    if (current.assetPath && current.assetPath !== updatedData.assetPath) {
      await deleteAssetIfOrphaned(current.assetPath, slideId);
    }
    return NextResponse.json({ slide: { id: slideId, ...updatedData } });
  } catch (error) {
    console.error('[signage/slides/:id][PUT]', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Falha ao atualizar slide.' },
      { status: 400 }
    );
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ slideId: string }> }) {
  try {
    const access = await assertSignageAccess(req, 'manage');
    const { slideId } = await params;
    const slideRef = signageDbAdmin.collection('slides').doc(slideId);
    const existing = await slideRef.get();

    if (!existing.exists) {
      return NextResponse.json({ error: 'Slide não encontrado.' }, { status: 404 });
    }

    const current = existing.data()!;
    if (!access.isAdmin && !(current.kioskIds ?? []).some((kioskId: string) => access.allowedKioskIds.includes(kioskId))) {
      return NextResponse.json({ error: 'Sem acesso a este slide.' }, { status: 403 });
    }

    await slideRef.delete();
    await deleteAssetIfOrphaned(current.assetPath, slideId);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[signage/slides/:id][DELETE]', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Falha ao remover slide.' },
      { status: 400 }
    );
  }
}
