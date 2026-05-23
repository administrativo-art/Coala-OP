import { NextRequest, NextResponse } from 'next/server';

import { requireUser } from '@/lib/auth-server';
import { dbAdmin } from '@/lib/firebase-admin';
import type { AssetStatus } from '@/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function GET(request: NextRequest, context: { params: Promise<{ assetId: string }> }) {
  const userContext = await requireUser(request);
  if (!userContext.permissions.assets?.view) return jsonError('Sem permissão para visualizar patrimônio.', 403);

  const { assetId } = await context.params;
  const snap = await dbAdmin.collection('assets').doc(assetId).get();
  if (!snap.exists) return jsonError('Patrimônio não encontrado.', 404);
  return NextResponse.json({ id: snap.id, ...snap.data() });
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ assetId: string }> }) {
  const userContext = await requireUser(request);
  if (!userContext.permissions.assets?.edit) return jsonError('Sem permissão para editar patrimônio.', 403);

  const { assetId } = await context.params;
  const body = await request.json().catch(() => ({}));
  const ref = dbAdmin.collection('assets').doc(assetId);
  const snap = await ref.get();
  if (!snap.exists) return jsonError('Patrimônio não encontrado.', 404);
  const current = snap.data()!;
  const now = new Date().toISOString();

  const patch = {
    name: body.name?.trim?.() ?? current.name,
    category: body.category?.trim?.() || null,
    brand: body.brand?.trim?.() || null,
    model: body.model?.trim?.() || null,
    serialNumber: body.serialNumber?.trim?.() || null,
    purchaseDate: body.purchaseDate || null,
    purchaseValue: Number.isFinite(Number(body.purchaseValue)) ? Number(body.purchaseValue) : null,
    supplierId: body.supplierId || null,
    supplierName: body.supplierName || null,
    imageUrl: body.imageUrl || null,
    notes: body.notes || null,
    updatedAt: now,
  };

  await ref.update(patch);
  await dbAdmin.collection('assetMovements').add({
    assetId,
    assetCode: current.code,
    assetName: patch.name,
    type: 'EDICAO',
    userId: userContext.userDoc.id,
    username: userContext.userDoc.username,
    occurredAt: now,
    notes: body.changeNotes || 'Edição de cadastro.',
  });

  return NextResponse.json({ ok: true });
}

export async function POST(request: NextRequest, context: { params: Promise<{ assetId: string }> }) {
  const userContext = await requireUser(request);
  const { assetId } = await context.params;
  const body = await request.json().catch(() => ({}));
  const action = String(body.action ?? '');
  const ref = dbAdmin.collection('assets').doc(assetId);
  const snap = await ref.get();
  if (!snap.exists) return jsonError('Patrimônio não encontrado.', 404);
  const current = snap.data()!;
  const now = new Date().toISOString();

  if (action === 'transfer') {
    if (!userContext.permissions.assets?.transfer) return jsonError('Sem permissão para transferir patrimônio.', 403);
    const toKioskId = String(body.toKioskId ?? '').trim();
    if (!toKioskId) return jsonError('Unidade de destino obrigatória.');
    await ref.update({
      currentKioskId: toKioskId,
      currentKioskName: body.toKioskName || null,
      updatedAt: now,
    });
    await dbAdmin.collection('assetMovements').add({
      assetId,
      assetCode: current.code,
      assetName: current.name,
      type: 'TRANSFERENCIA',
      fromKioskId: current.currentKioskId,
      fromKioskName: current.currentKioskName,
      toKioskId,
      toKioskName: body.toKioskName || null,
      userId: userContext.userDoc.id,
      username: userContext.userDoc.username,
      occurredAt: now,
      notes: body.notes || null,
    });
    return NextResponse.json({ ok: true });
  }

  if (action === 'status') {
    if (!userContext.permissions.assets?.edit) return jsonError('Sem permissão para alterar status.', 403);
    const toStatus = body.status as AssetStatus;
    if (!['ativo', 'em_manutencao', 'fora_de_uso', 'baixado'].includes(toStatus)) return jsonError('Status inválido.');
    await ref.update({ status: toStatus, updatedAt: now });
    await dbAdmin.collection('assetMovements').add({
      assetId,
      assetCode: current.code,
      assetName: current.name,
      type: toStatus === 'baixado' ? 'BAIXA' : 'ALTERACAO_STATUS',
      fromStatus: current.status,
      toStatus,
      userId: userContext.userDoc.id,
      username: userContext.userDoc.username,
      occurredAt: now,
      notes: body.notes || null,
    });
    return NextResponse.json({ ok: true });
  }

  if (action === 'print-label') {
    if (!userContext.permissions.assets?.printLabels) return jsonError('Sem permissão para imprimir etiquetas.', 403);
    await dbAdmin.collection('assetMovements').add({
      assetId,
      assetCode: current.code,
      assetName: current.name,
      type: 'ETIQUETA_REIMPRESSA',
      userId: userContext.userDoc.id,
      username: userContext.userDoc.username,
      occurredAt: now,
      notes: body.notes || null,
    });
    return NextResponse.json({ ok: true });
  }

  return jsonError('Ação inválida.');
}
