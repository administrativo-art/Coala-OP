import { NextRequest, NextResponse } from 'next/server';

import { dbAdmin } from '@/lib/firebase-admin';
import { signageDbAdmin } from '@/lib/firebase-signage-admin';
import { type Kiosk } from '@/types';

export async function GET(req: NextRequest, { params }: { params: Promise<{ kioskId: string }> }) {
  const { kioskId } = await params;

  const kioskSnap = await dbAdmin.collection('kiosks').doc(kioskId).get();
  if (!kioskSnap.exists) {
    return NextResponse.json({ error: 'Quiosque não encontrado.' }, { status: 404 });
  }

  const kiosk = { id: kioskSnap.id, ...kioskSnap.data() } as Kiosk;
  if (kiosk.deviceToken) {
    const token = new URL(req.url).searchParams.get('token') ?? '';
    if (token !== kiosk.deviceToken) {
      return NextResponse.json({ error: 'Token inválido.' }, { status: 403 });
    }
  }

  const snapshot = await signageDbAdmin.collection('publishedPlayers').doc(kioskId).get();
  if (!snapshot.exists) {
    return NextResponse.json({ error: 'Nenhum conteúdo publicado para este quiosque.' }, { status: 404 });
  }

  return NextResponse.json(snapshot.data());
}
