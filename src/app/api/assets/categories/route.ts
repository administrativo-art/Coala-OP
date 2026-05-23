import { NextRequest, NextResponse } from 'next/server';

import { requireUser } from '@/lib/auth-server';
import { dbAdmin } from '@/lib/firebase-admin';
import { WORKSPACE_ID } from '@/lib/workspace';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function GET(request: NextRequest) {
  const context = await requireUser(request);
  if (!context.permissions.assets?.view) return jsonError('Sem permissão para visualizar categorias.', 403);

  const snap = await dbAdmin
    .collection('assetCategories')
    .where('workspaceId', '==', WORKSPACE_ID)
    .get();
  const data = snap.docs
    .map((doc) => ({ id: doc.id, ...doc.data() }))
    .sort((a: any, b: any) => String(a.name).localeCompare(String(b.name)));
  return NextResponse.json(data);
}

export async function POST(request: NextRequest) {
  const context = await requireUser(request);
  if (!context.permissions.assets?.create && !context.permissions.assets?.edit) {
    return jsonError('Sem permissão para cadastrar categorias.', 403);
  }

  const body = await request.json().catch(() => ({}));
  const name = String(body.name ?? '').trim();
  if (!name) return jsonError('Nome da categoria é obrigatório.');

  const now = new Date().toISOString();
  const ref = await dbAdmin.collection('assetCategories').add({
    workspaceId: WORKSPACE_ID,
    name,
    description: body.description?.trim?.() || null,
    createdAt: now,
    updatedAt: now,
    createdBy: context.userDoc.id,
  });

  return NextResponse.json({ id: ref.id }, { status: 201 });
}
