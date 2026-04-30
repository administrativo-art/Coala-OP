import { NextRequest, NextResponse } from 'next/server';
import { dbAdmin } from '@/lib/firebase-admin';
import { verifyAuth } from '@/lib/verify-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const WORKSPACE_ID = process.env.NEXT_PUBLIC_WORKSPACE_ID ?? 'coala';

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

async function assertAuth(request: NextRequest) {
  try {
    return await verifyAuth(request);
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest, context: { params: Promise<{ path?: string[] }> }) {
  const decoded = await assertAuth(request);
  if (!decoded) return jsonError('Não autorizado.', 401);

  const path = (await context.params).path ?? [];
  const [resource, id] = path;

  const collectionMap: Record<string, string> = {
    'products': 'products',
    'base-products': 'baseProducts',
    'entities': 'entities',
    'stock-audit': 'stockAuditSessions',
    'competitors': 'concorrentes',
  };

  const collectionName = collectionMap[resource];
  if (!collectionName) return jsonError('Recurso não encontrado.', 404);

  if (id) {
    const doc = await dbAdmin.collection(collectionName).doc(id).get();
    if (!doc.exists) return jsonError('Documento não encontrado.', 404);
    return NextResponse.json({ id: doc.id, ...doc.data() });
  }

  const snapshot = await dbAdmin.collection(collectionName).get();
  const data = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
  return NextResponse.json(data);
}

export async function POST(request: NextRequest, context: { params: Promise<{ path?: string[] }> }) {
  const decoded = await assertAuth(request);
  if (!decoded) return jsonError('Não autorizado.', 401);

  const path = (await context.params).path ?? [];
  const [resource] = path;
  const body = await request.json().catch(() => ({}));

  const collectionMap: Record<string, string> = {
    'products': 'products',
    'base-products': 'baseProducts',
    'entities': 'entities',
    'stock-audit': 'stockAuditSessions',
    'competitors': 'concorrentes',
  };

  const collectionName = collectionMap[resource];
  if (!collectionName) return jsonError('Recurso não encontrado.', 404);

  const ref = await dbAdmin.collection(collectionName).add({
    ...body,
    workspaceId: WORKSPACE_ID,
    createdAt: new Date().toISOString(),
    createdBy: decoded.uid,
  });

  return NextResponse.json({ id: ref.id }, { status: 201 });
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ path?: string[] }> }) {
  const decoded = await assertAuth(request);
  if (!decoded) return jsonError('Não autorizado.', 401);

  const path = (await context.params).path ?? [];
  const [resource, id] = path;
  const body = await request.json().catch(() => ({}));

  const collectionMap: Record<string, string> = {
    'products': 'products',
    'base-products': 'baseProducts',
    'entities': 'entities',
    'stock-audit': 'stockAuditSessions',
    'competitors': 'concorrentes',
  };

  const collectionName = collectionMap[resource];
  if (!collectionName || !id) return jsonError('Recurso ou ID inválido.', 404);

  await dbAdmin.collection(collectionName).doc(id).update({
    ...body,
    updatedAt: new Date().toISOString(),
  });

  return NextResponse.json({ ok: true });
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ path?: string[] }> }) {
  const decoded = await assertAuth(request);
  if (!decoded) return jsonError('Não autorizado.', 401);

  const path = (await context.params).path ?? [];
  const [resource, id] = path;

  const collectionMap: Record<string, string> = {
    'products': 'products',
    'base-products': 'baseProducts',
    'entities': 'entities',
    'stock-audit': 'stockAuditSessions',
    'competitors': 'concorrentes',
  };

  const collectionName = collectionMap[resource];
  if (!collectionName || !id) return jsonError('Recurso ou ID inválido.', 404);

  await dbAdmin.collection(collectionName).doc(id).delete();
  return NextResponse.json({ ok: true });
}
