import { NextRequest, NextResponse } from 'next/server';

import { type Kiosk, type SignageSlide } from '@/types';
import { dbAdmin } from '@/lib/firebase-admin';
import { signageDbAdmin } from '@/lib/firebase-signage-admin';
import { buildPublishedPlayerDocument, sanitizeKioskIds } from '@/lib/signage';
import { assertSignageAccess } from '@/lib/signage-auth';

export async function POST(req: NextRequest) {
  try {
    const access = await assertSignageAccess(req, 'manage');
    const payload = await req.json();
    const requestedKioskIds = Array.isArray(payload.kioskIds) ? payload.kioskIds.map(String) : [];
    const kioskIds = sanitizeKioskIds(requestedKioskIds, access.allowedKioskIds, access.isAdmin);

    if (!kioskIds.length) {
      return NextResponse.json({ error: 'Selecione ao menos um quiosque para publicar.' }, { status: 400 });
    }

    const [slidesSnap, kiosksSnap] = await Promise.all([
      signageDbAdmin.collection('slides').get(),
      dbAdmin.collection('kiosks').get(),
    ]);

    const slides = slidesSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as SignageSlide));
    const kiosks = kiosksSnap.docs
      .map(doc => ({ id: doc.id, ...doc.data() } as Kiosk))
      .filter(kiosk => kioskIds.includes(kiosk.id));

    const batch = signageDbAdmin.batch();
    kiosks.forEach((kiosk) => {
      const published = buildPublishedPlayerDocument(
        kiosk,
        slides,
        { userId: access.user.id, username: access.user.username }
      );
      batch.set(signageDbAdmin.collection('publishedPlayers').doc(kiosk.id), published);
    });

    await batch.commit();

    return NextResponse.json({
      success: true,
      publishedKioskIds: kiosks.map(kiosk => kiosk.id),
    });
  } catch (error) {
    console.error('[signage/publish][POST]', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Falha ao publicar signage.' },
      { status: 400 }
    );
  }
}
