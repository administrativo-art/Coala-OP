import { NextRequest, NextResponse } from 'next/server';

import { requireUser } from '@/lib/auth-server';
import { dbAdmin } from '@/lib/firebase-admin';
import { WORKSPACE_ID } from '@/lib/workspace';
import type { AssetStatus } from '@/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

const BARCODE_SETTINGS_DOC_ID = 'barcode-labels';
const DEFAULT_GENERATED_LABELS_UNTIL = 1000;

function normalizeAssetCodeInput(value: unknown) {
  const raw = String(value ?? '').trim().toUpperCase().replace(/\s+/g, '');
  if (!raw) return '';
  if (raw.startsWith('PEND-')) return raw;
  const patMatch = raw.match(/^PAT[-_]?(\d+)$/);
  if (patMatch) return `PAT-${String(Number(patMatch[1])).padStart(6, '0')}`;
  const digits = raw.replace(/\D/g, '');
  return digits ? `PAT-${String(Number(digits)).padStart(6, '0')}` : raw;
}

async function assertAssetCodeCanBeUsed(code: string, currentAssetId: string) {
  const match = code.match(/^PAT-(\d+)$/);
  if (!match) throw new Error('Código patrimonial inválido. Use o formato PAT-000001.');

  const sequence = Number(match[1]);
  if (!Number.isFinite(sequence) || sequence < 1) {
    throw new Error('Código patrimonial inválido. Use uma sequência a partir de PAT-000001.');
  }

  const settingsSnap = await dbAdmin.collection('assetSettings').doc(BARCODE_SETTINGS_DOC_ID).get();
  const settings = settingsSnap.data() ?? {};
  const generatedUntil = Math.max(
    DEFAULT_GENERATED_LABELS_UNTIL,
    settings.workspaceId === WORKSPACE_ID ? Number(settings.generatedUntil ?? 0) || 0 : 0
  );

  if (sequence > generatedUntil) {
    throw new Error(
      `A etiqueta ${code} ainda não foi gerada. Gere mais etiquetas antes de usar esta numeração. Última etiqueta liberada: PAT-${String(generatedUntil).padStart(6, '0')}.`
    );
  }

  const existing = await dbAdmin
    .collection('assets')
    .where('workspaceId', '==', WORKSPACE_ID)
    .where('code', '==', code)
    .limit(1)
    .get();
  const alreadyUsedByAnotherAsset = existing.docs.some((doc) => doc.id !== currentAssetId);
  if (alreadyUsedByAnotherAsset) {
    throw new Error(`A etiqueta ${code} já está vinculada a outro patrimônio.`);
  }
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
  const incomingCode = body.code !== undefined ? normalizeAssetCodeInput(body.code) : String(current.code ?? '');
  let nextCode = String(current.code ?? '');
  let nextPlateStatus = current.plateStatus ?? (String(current.code ?? '').startsWith('PEND-') ? 'pendente' : 'vinculada');
  let plateLinkedAt = current.plateLinkedAt ?? null;
  let plateLinkedBy = current.plateLinkedBy ?? null;

  if (body.code !== undefined && incomingCode && incomingCode !== current.code) {
    try {
      await assertAssetCodeCanBeUsed(incomingCode, assetId);
      nextCode = incomingCode;
      nextPlateStatus = 'vinculada';
      plateLinkedAt = now;
      plateLinkedBy = userContext.userDoc.id;
    } catch (error) {
      return jsonError(error instanceof Error ? error.message : 'Falha ao vincular placa patrimonial.');
    }
  } else if (/^PAT-\d+$/.test(nextCode) && nextPlateStatus !== 'vinculada') {
    nextPlateStatus = 'vinculada';
    plateLinkedAt = now;
    plateLinkedBy = userContext.userDoc.id;
  }

  const patch = {
    code: nextCode,
    name: body.name?.trim?.() ?? current.name,
    category: body.category?.trim?.() || null,
    subcategory: body.subcategory?.trim?.() || null,
    brand: body.brand?.trim?.() || null,
    model: body.model?.trim?.() || null,
    serialNumber: body.serialNumber?.trim?.() || null,
    assetTag: body.assetTag?.trim?.() || null,
    description: body.description?.trim?.() || null,
    department: body.department?.trim?.() || null,
    exactLocation: body.exactLocation?.trim?.() || null,
    responsibleName: body.responsibleName?.trim?.() || null,
    inUse: typeof body.inUse === 'boolean' ? body.inUse : current.inUse ?? true,
    possessionStatus: body.possessionStatus?.trim?.() || null,
    purchaseDate: body.purchaseDate || null,
    purchaseValue: Number.isFinite(Number(body.purchaseValue)) ? Number(body.purchaseValue) : null,
    supplierId: body.supplierId || null,
    supplierName: body.supplierName || null,
    invoiceNumber: body.invoiceNumber?.trim?.() || null,
    paymentMethod: body.paymentMethod?.trim?.() || null,
    costCenter: body.costCenter?.trim?.() || null,
    accountingAccount: body.accountingAccount?.trim?.() || null,
    documentUrl: body.documentUrl || null,
    usefulLifeYears: Number.isFinite(Number(body.usefulLifeYears)) ? Number(body.usefulLifeYears) : null,
    residualValue: Number.isFinite(Number(body.residualValue)) ? Number(body.residualValue) : null,
    depreciationMethod: body.depreciationMethod?.trim?.() || null,
    accumulatedDepreciation: Number.isFinite(Number(body.accumulatedDepreciation)) ? Number(body.accumulatedDepreciation) : null,
    bookValue: Number.isFinite(Number(body.bookValue)) ? Number(body.bookValue) : null,
    marketValue: Number.isFinite(Number(body.marketValue)) ? Number(body.marketValue) : null,
    conservationState: body.conservationState?.trim?.() || null,
    operationalCondition: body.operationalCondition?.trim?.() || null,
    conditionNotes: body.conditionNotes?.trim?.() || null,
    lastInspectionDate: body.lastInspectionDate || null,
    inspectedBy: body.inspectedBy?.trim?.() || null,
    nextInspectionDate: body.nextInspectionDate || null,
    hasWarranty: typeof body.hasWarranty === 'boolean' ? body.hasWarranty : current.hasWarranty ?? false,
    warrantyEndsAt: body.warrantyEndsAt || null,
    serviceCompany: body.serviceCompany?.trim?.() || null,
    serviceContact: body.serviceContact?.trim?.() || null,
    maintenanceFrequency: body.maintenanceFrequency?.trim?.() || null,
    lastMaintenanceDate: body.lastMaintenanceDate || null,
    nextMaintenanceDate: body.nextMaintenanceDate || null,
    maintenanceCostTotal: Number.isFinite(Number(body.maintenanceCostTotal)) ? Number(body.maintenanceCostTotal) : null,
    retiredAt: body.retiredAt || null,
    retirementReason: body.retirementReason?.trim?.() || null,
    saleValue: Number.isFinite(Number(body.saleValue)) ? Number(body.saleValue) : null,
    buyerOrDestination: body.buyerOrDestination?.trim?.() || null,
    retirementAuthorizedBy: body.retirementAuthorizedBy?.trim?.() || null,
    retirementDocumentUrl: body.retirementDocumentUrl || null,
    imageUrl: body.imageUrl || null,
    notes: body.notes || null,
    plateStatus: nextPlateStatus,
    plateLinkedAt,
    plateLinkedBy,
    updatedAt: now,
  };

  await ref.update(patch);
  await dbAdmin.collection('assetMovements').add({
    assetId,
    assetCode: nextCode,
    assetName: patch.name,
    type: 'EDICAO',
    userId: userContext.userDoc.id,
    username: userContext.userDoc.username,
    occurredAt: now,
    notes: body.changeNotes || (nextCode !== current.code ? `Vinculação de placa: ${current.code} → ${nextCode}.` : 'Edição de cadastro.'),
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
    if (!['ativo', 'em_manutencao', 'fora_de_uso', 'extraviado', 'vendido', 'descartado', 'baixado'].includes(toStatus)) return jsonError('Status inválido.');
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

  if (action === 'retirada') {
    if (!userContext.permissions.assets?.edit) return jsonError('Sem permissão.', 403);
    const withdrawerName = String(body.withdrawerName ?? '').trim();
    const destinationName = String(body.destinationName ?? '').trim();
    const newResponsibleName = String(body.newResponsibleName ?? '').trim() || null;
    if (!withdrawerName || !destinationName) return jsonError('Quem retira e destino são obrigatórios.');
    await dbAdmin.collection('assetMovements').add({
      assetId,
      assetCode: current.code,
      assetName: current.name,
      type: 'RETIRADA',
      userId: body.withdrawerUserId || 'externo',
      username: withdrawerName,
      fromKioskId: current.currentKioskId || null,
      fromKioskName: current.currentKioskName || null,
      toKioskId: body.destinationKioskId || null,
      toKioskName: destinationName,
      notes: body.notes || null,
      occurredAt: now,
    });
    const assetUpdates: Record<string, unknown> = {};
    if (body.destinationKioskId) {
      assetUpdates.currentKioskId = body.destinationKioskId;
      assetUpdates.currentKioskName = destinationName;
    }
    if (newResponsibleName) {
      assetUpdates.responsibleName = newResponsibleName;
    }
    if (Object.keys(assetUpdates).length > 0) {
      await ref.update({ ...assetUpdates, updatedAt: now });
    }
    return NextResponse.json({ ok: true });
  }

  return jsonError('Ação inválida.');
}
