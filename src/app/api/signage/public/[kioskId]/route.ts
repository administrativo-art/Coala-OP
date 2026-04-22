import { NextResponse } from 'next/server';

import { signageDbAdmin } from '@/lib/firebase-signage-admin';

export async function GET(_: Request, { params }: { params: Promise<{ kioskId: string }> }) {
  const { kioskId } = await params;
  const snapshot = await signageDbAdmin.collection('publishedPlayers').doc(kioskId).get();

  if (!snapshot.exists) {
    return NextResponse.json({ error: 'Nenhum conteúdo publicado para este quiosque.' }, { status: 404 });
  }

  return NextResponse.json(snapshot.data());
}
