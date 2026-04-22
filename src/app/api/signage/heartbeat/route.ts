import { NextRequest, NextResponse } from 'next/server';

import { type Kiosk, type PlayerHeartbeat } from '@/types';
import { dbAdmin } from '@/lib/firebase-admin';
import { signageDbAdmin } from '@/lib/firebase-signage-admin';
import { assertSignageAccess } from '@/lib/signage-auth';
import { stripUndefined } from '@/lib/signage';

export async function GET(req: NextRequest) {
  try {
    const access = await assertSignageAccess(req, 'view');
    const snapshot = await signageDbAdmin.collection('playerHeartbeats').get();
    const heartbeats = snapshot.docs
      .map(doc => ({ kioskId: doc.id, ...doc.data() } as PlayerHeartbeat))
      .filter((heartbeat) => access.isAdmin || access.allowedKioskIds.includes(heartbeat.kioskId));

    return NextResponse.json({ heartbeats });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Falha ao carregar heartbeats.' },
      { status: 403 }
    );
  }
}

export async function POST(req: NextRequest) {
  const payload = await req.json();
  const kioskId = typeof payload.kioskId === 'string' ? payload.kioskId.trim() : '';

  if (!kioskId) {
    return NextResponse.json({ error: 'kioskId é obrigatório.' }, { status: 400 });
  }

  const kioskSnap = await dbAdmin.collection('kiosks').doc(kioskId).get();
  if (!kioskSnap.exists) {
    return NextResponse.json({ error: 'Quiosque inválido.' }, { status: 404 });
  }

  const kiosk = { id: kioskSnap.id, ...kioskSnap.data() } as Kiosk;
  const heartbeat = stripUndefined({
    kioskId,
    kioskName: kiosk.name,
    lastSeenAt: new Date().toISOString(),
    status: payload.status === 'realtime' ? 'realtime' : 'cache',
    currentSlideId: typeof payload.currentSlideId === 'string' ? payload.currentSlideId : undefined,
    updatedAt: typeof payload.updatedAt === 'string' ? payload.updatedAt : undefined,
  });

  await signageDbAdmin.collection('playerHeartbeats').doc(kioskId).set(heartbeat, { merge: true });
  return NextResponse.json({ success: true });
}
