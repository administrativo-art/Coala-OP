import { NextRequest, NextResponse } from 'next/server';

import { type SignageSlide } from '@/types';
import { signageDbAdmin } from '@/lib/firebase-signage-admin';
import { assertSignageAccess } from '@/lib/signage-auth';
import { getSignageAssetUrl, sanitizeKioskIds, signageSlideSchema, stripUndefined } from '@/lib/signage';


function normalizeSlide(id: string, data: FirebaseFirestore.DocumentData): SignageSlide {
  return {
    id,
    title: data.title,
    type: data.type,
    durationMs: data.durationMs,
    order: data.order,
    kioskIds: data.kioskIds ?? [],
    isActive: data.isActive === true,
    assetUrl: getSignageAssetUrl(data.assetPath),
    assetPath: data.assetPath,
    assetKind: data.assetKind,
    text: data.text,
    background: data.background,
    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
    createdBy: data.createdBy,
    updatedBy: data.updatedBy,
  };
}

export async function GET(req: NextRequest) {
  try {
    const access = await assertSignageAccess(req, 'view');
    const snapshot = await signageDbAdmin.collection('slides').orderBy('order', 'asc').get();

    const slides = snapshot.docs
      .map(doc => normalizeSlide(doc.id, doc.data()))
      .filter(slide => access.isAdmin || slide.kioskIds.some(kioskId => access.allowedKioskIds.includes(kioskId)));

    return NextResponse.json({ slides });
  } catch (error) {
    console.error('[signage/slides][GET]', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Falha ao carregar slides.' },
      { status: 403 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const access = await assertSignageAccess(req, 'manage');
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

    const now = new Date().toISOString();
    const actor = { userId: access.user.id, username: access.user.username };
    const slideData = stripUndefined({
      ...parsed,
      kioskIds,
      createdAt: now,
      updatedAt: now,
      createdBy: actor,
      updatedBy: actor,
    });

    const ref = await signageDbAdmin.collection('slides').add(slideData);
    return NextResponse.json({ slide: normalizeSlide(ref.id, slideData) }, { status: 201 });
  } catch (error) {
    console.error('[signage/slides][POST]', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Falha ao criar slide.' },
      { status: 400 }
    );
  }
}
