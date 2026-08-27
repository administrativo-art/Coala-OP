import { NextRequest, NextResponse } from 'next/server';
import { dbAdmin } from '@/lib/firebase-admin';
import { requireUser } from '@/lib/auth-server';
import { BarcodeValidator } from '@/lib/barcode/barcode-validator';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function GET(request: NextRequest, context: { params: Promise<{ codigo: string }> }) {
  const userContext = await requireUser(request).catch(() => null);
  if (!userContext) return jsonError('Não autorizado.', 401);

  const { codigo } = await context.params;
  const validation = BarcodeValidator.validate(codigo);
  if (!validation.ok) return jsonError(validation.error, 400);

  const cacheSnap = await dbAdmin.collection('barcodeLookupCache').doc(validation.code).get();
  const sourcesSnap = await dbAdmin
    .collection('fontes_produto')
    .where('codigo_barras', '==', validation.code)
    .orderBy('data_consulta', 'desc')
    .limit(20)
    .get()
    .catch(() => null);

  return NextResponse.json({
    codigo_barras: validation.code,
    cache: cacheSnap.exists ? cacheSnap.data() : null,
    sources: sourcesSnap?.docs.map((doc) => ({ id: doc.id, ...doc.data() })) ?? [],
  });
}
