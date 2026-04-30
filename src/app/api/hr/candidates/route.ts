import { NextRequest, NextResponse } from 'next/server';
import { dbAdmin } from '@/lib/firebase-admin';
import { verifyAuth } from '@/lib/verify-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function GET(request: NextRequest) {
  const decoded = await verifyAuth(request).catch(() => null);
  if (!decoded) return jsonError('Não autorizado.', 401);

  const snapshot = await dbAdmin.collection('candidates').orderBy('appliedAt', 'desc').get();
  const candidates = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  return NextResponse.json(candidates);
}

export async function POST(request: NextRequest) {
  const decoded = await verifyAuth(request).catch(() => null);
  if (!decoded) return jsonError('Não autorizado.', 401);

  const body = await request.json();
  const now = new Date().toISOString();

  const ref = await dbAdmin.collection('candidates').add({
    ...body,
    appliedAt: body.appliedAt || now,
    updatedAt: now,
    createdBy: decoded.uid,
  });

  return NextResponse.json({ id: ref.id }, { status: 201 });
}
