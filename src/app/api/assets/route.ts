import { NextRequest, NextResponse } from 'next/server';

import { requireUser } from '@/lib/auth-server';
import { dbAdmin } from '@/lib/firebase-admin';
import { WORKSPACE_ID } from '@/lib/workspace';
import type { Asset, AssetMovement, AssetStatus } from '@/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

function canManageAsset(permissions: Awaited<ReturnType<typeof requireUser>>['permissions'], action: 'create' | 'edit' | 'transfer' | 'retire') {
  return permissions.assets?.[action] === true;
}

async function nextAssetCode() {
  const counterRef = dbAdmin.collection('counters').doc('assets');
  const next = await dbAdmin.runTransaction(async (tx) => {
    const snap = await tx.get(counterRef);
    const current = Number(snap.data()?.next ?? 1);
    tx.set(counterRef, { next: current + 1, updatedAt: new Date().toISOString() }, { merge: true });
    return current;
  });
  return `PAT-${String(next).padStart(6, '0')}`;
}

async function addMovement(input: Omit<AssetMovement, 'id'>) {
  await dbAdmin.collection('assetMovements').add(input);
}

export async function GET(request: NextRequest) {
  const context = await requireUser(request);
  if (!context.permissions.assets?.view) return jsonError('Sem permissão para visualizar patrimônio.', 403);

  const snapshot = await dbAdmin
    .collection('assets')
    .where('workspaceId', '==', WORKSPACE_ID)
    .get();
  const assets = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  return NextResponse.json(assets);
}

export async function POST(request: NextRequest) {
  const context = await requireUser(request);
  if (!canManageAsset(context.permissions, 'create')) return jsonError('Sem permissão para criar patrimônio.', 403);

  const body = await request.json().catch(() => ({}));
  const name = String(body.name ?? '').trim();
  const currentKioskId = String(body.currentKioskId ?? '').trim();
  if (!name || !currentKioskId) return jsonError('Nome e unidade atual são obrigatórios.');

  const now = new Date().toISOString();
  const code = await nextAssetCode();
  const assetRef = dbAdmin.collection('assets').doc();
  const asset: Asset & { workspaceId: string } = {
    id: assetRef.id,
    workspaceId: WORKSPACE_ID,
    code,
    name,
    category: body.category?.trim?.() || undefined,
    brand: body.brand?.trim?.() || undefined,
    model: body.model?.trim?.() || undefined,
    serialNumber: body.serialNumber?.trim?.() || undefined,
    currentKioskId,
    currentKioskName: body.currentKioskName?.trim?.() || undefined,
    status: (body.status as AssetStatus) || 'ativo',
    purchaseDate: body.purchaseDate || undefined,
    purchaseValue: Number.isFinite(Number(body.purchaseValue)) ? Number(body.purchaseValue) : undefined,
    supplierId: body.supplierId || undefined,
    supplierName: body.supplierName || undefined,
    imageUrl: body.imageUrl || undefined,
    notes: body.notes || undefined,
    sourceType: body.sourceType === 'purchase_receipt' ? 'purchase_receipt' : 'manual',
    purchaseOrderId: body.purchaseOrderId || undefined,
    purchaseReceiptId: body.purchaseReceiptId || undefined,
    purchaseReceiptItemId: body.purchaseReceiptItemId || undefined,
    createdAt: now,
    updatedAt: now,
    createdBy: context.userDoc.id,
  };

  await assetRef.set(asset);
  await addMovement({
    assetId: assetRef.id,
    assetCode: code,
    assetName: name,
    type: 'CRIACAO',
    toKioskId: currentKioskId,
    toKioskName: asset.currentKioskName,
    toStatus: asset.status,
    userId: context.userDoc.id,
    username: context.userDoc.username,
    occurredAt: now,
    notes: body.notes || 'Cadastro de patrimônio.',
    sourceType: asset.sourceType,
    sourceId: asset.purchaseReceiptId,
  });

  return NextResponse.json({ id: assetRef.id, code }, { status: 201 });
}
