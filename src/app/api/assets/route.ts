import { NextRequest, NextResponse } from 'next/server';

import { requireUser } from '@/lib/auth-server';
import { dbAdmin } from '@/lib/firebase-admin';
import { WORKSPACE_ID } from '@/lib/workspace';
import type { Asset, AssetMovement, AssetStatus } from '@/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const BARCODE_SETTINGS_DOC_ID = 'barcode-labels';
const DEFAULT_GENERATED_LABELS_UNTIL = 1000;

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

function canManageAsset(permissions: Awaited<ReturnType<typeof requireUser>>['permissions'], action: 'create' | 'edit' | 'transfer' | 'retire') {
  return permissions.assets?.[action] === true;
}

async function nextAssetCode() {
  const counterRef = dbAdmin.collection('counters').doc('assets');
  const settingsRef = dbAdmin.collection('assetSettings').doc(BARCODE_SETTINGS_DOC_ID);
  const next = await dbAdmin.runTransaction(async (tx) => {
    const snap = await tx.get(counterRef);
    const settingsSnap = await tx.get(settingsRef);
    const settings = settingsSnap.data() ?? {};
    const generatedUntil = Math.max(
      DEFAULT_GENERATED_LABELS_UNTIL,
      settings.workspaceId === WORKSPACE_ID ? Number(settings.generatedUntil ?? 0) || 0 : 0
    );
    let current = Number(snap.data()?.next ?? 1) || 1;

    for (let attempts = 0; attempts < 10000; attempts += 1) {
      if (current > generatedUntil) {
        throw new Error(
          `Limite de etiquetas patrimoniais atingido. Gere mais 100 etiquetas antes de cadastrar o próximo patrimônio. Última etiqueta liberada: PAT-${String(generatedUntil).padStart(6, '0')}.`
        );
      }

      const code = `PAT-${String(current).padStart(6, '0')}`;
      const existing = await tx.get(
        dbAdmin
          .collection('assets')
          .where('workspaceId', '==', WORKSPACE_ID)
          .where('code', '==', code)
          .limit(1)
      );
      if (existing.empty) {
        tx.set(counterRef, { next: current + 1, updatedAt: new Date().toISOString() }, { merge: true });
        return current;
      }
      current += 1;
    }

    throw new Error('Não foi possível localizar uma etiqueta patrimonial livre.');
  });
  return `PAT-${String(next).padStart(6, '0')}`;
}

function normalizeAssetCodeInput(value: unknown) {
  const raw = String(value ?? '').trim().toUpperCase().replace(/\s+/g, '');
  if (!raw) return '';
  const patMatch = raw.match(/^PAT[-_]?(\d+)$/);
  if (patMatch) return `PAT-${String(Number(patMatch[1])).padStart(6, '0')}`;
  const digits = raw.replace(/\D/g, '');
  return digits ? `PAT-${String(Number(digits)).padStart(6, '0')}` : raw;
}

async function assertAssetCodeCanBeUsed(code: string) {
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
  if (!existing.empty) {
    throw new Error(`A etiqueta ${code} já está vinculada a outro patrimônio.`);
  }
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
  const requestedCode = normalizeAssetCodeInput(body.code);
  let code: string;
  try {
    if (requestedCode) {
      await assertAssetCodeCanBeUsed(requestedCode);
    }
    code = requestedCode || await nextAssetCode();
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Falha ao reservar etiqueta patrimonial.');
  }
  const assetRef = dbAdmin.collection('assets').doc();
  const asset: Asset & { workspaceId: string } = {
    id: assetRef.id,
    workspaceId: WORKSPACE_ID,
    code,
    name,
    category: body.category?.trim?.() || undefined,
    subcategory: body.subcategory?.trim?.() || undefined,
    brand: body.brand?.trim?.() || undefined,
    model: body.model?.trim?.() || undefined,
    serialNumber: body.serialNumber?.trim?.() || undefined,
    assetTag: body.assetTag?.trim?.() || undefined,
    description: body.description?.trim?.() || undefined,
    currentKioskId,
    currentKioskName: body.currentKioskName?.trim?.() || undefined,
    department: body.department?.trim?.() || undefined,
    exactLocation: body.exactLocation?.trim?.() || undefined,
    responsibleName: body.responsibleName?.trim?.() || undefined,
    inUse: typeof body.inUse === 'boolean' ? body.inUse : true,
    possessionStatus: body.possessionStatus?.trim?.() || undefined,
    status: (body.status as AssetStatus) || 'ativo',
    purchaseDate: body.purchaseDate || undefined,
    purchaseValue: Number.isFinite(Number(body.purchaseValue)) ? Number(body.purchaseValue) : undefined,
    supplierId: body.supplierId || undefined,
    supplierName: body.supplierName || undefined,
    invoiceNumber: body.invoiceNumber?.trim?.() || undefined,
    paymentMethod: body.paymentMethod?.trim?.() || undefined,
    costCenter: body.costCenter?.trim?.() || undefined,
    accountingAccount: body.accountingAccount?.trim?.() || undefined,
    documentUrl: body.documentUrl || undefined,
    usefulLifeYears: Number.isFinite(Number(body.usefulLifeYears)) ? Number(body.usefulLifeYears) : undefined,
    residualValue: Number.isFinite(Number(body.residualValue)) ? Number(body.residualValue) : undefined,
    depreciationMethod: body.depreciationMethod?.trim?.() || undefined,
    accumulatedDepreciation: Number.isFinite(Number(body.accumulatedDepreciation)) ? Number(body.accumulatedDepreciation) : undefined,
    bookValue: Number.isFinite(Number(body.bookValue)) ? Number(body.bookValue) : undefined,
    marketValue: Number.isFinite(Number(body.marketValue)) ? Number(body.marketValue) : undefined,
    conservationState: body.conservationState?.trim?.() || undefined,
    operationalCondition: body.operationalCondition?.trim?.() || undefined,
    conditionNotes: body.conditionNotes?.trim?.() || undefined,
    lastInspectionDate: body.lastInspectionDate || undefined,
    inspectedBy: body.inspectedBy?.trim?.() || undefined,
    nextInspectionDate: body.nextInspectionDate || undefined,
    hasWarranty: typeof body.hasWarranty === 'boolean' ? body.hasWarranty : false,
    warrantyEndsAt: body.warrantyEndsAt || undefined,
    serviceCompany: body.serviceCompany?.trim?.() || undefined,
    serviceContact: body.serviceContact?.trim?.() || undefined,
    maintenanceFrequency: body.maintenanceFrequency?.trim?.() || undefined,
    lastMaintenanceDate: body.lastMaintenanceDate || undefined,
    nextMaintenanceDate: body.nextMaintenanceDate || undefined,
    maintenanceCostTotal: Number.isFinite(Number(body.maintenanceCostTotal)) ? Number(body.maintenanceCostTotal) : undefined,
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
