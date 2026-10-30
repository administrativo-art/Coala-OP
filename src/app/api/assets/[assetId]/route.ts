import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { changedPurchaseLinkedFields, normalizedAssetLifecycle } from '@/features/assets/lifecycle';
import { deactivateAssetMaintenance } from '@/features/assets/maintenance.server';
import { requireUser } from '@/lib/auth-server';
import { dbAdmin } from '@/lib/firebase-admin';
import { AppError } from '@/lib/observability/app-error';
import { createStandardSecurityEnforcer } from '@/lib/security/enforcer';
import { defineSecurityContract } from '@/lib/security/route-contract';
import { secureRoute } from '@/lib/security/secure-route.server';
import { WORKSPACE_ID } from '@/lib/workspace';
import type { AssetStatus } from '@/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ assetId: string }> };
type AssetResource = { id: string; data: Record<string, any> };
const routeBodySchema = z.record(z.string().max(80), z.unknown()).refine((body) => Object.keys(body).length <= 100, 'Muitos campos enviados.');

function contract(method: 'GET' | 'PATCH' | 'POST', id: string, action: string, mode: 'read' | 'write') {
  return defineSecurityContract({ schemaVersion: 1, id, version: 1, surface: { method, path: '/api/assets/[assetId]' }, exposure: 'authenticated', identity: { kind: 'active-user' }, authorization: { kind: 'custom', strategy: action }, resourceScope: { kind: 'workspace' }, input: method === 'GET' ? { kind: 'none' } : { kind: 'schema', schema: `assets.${method.toLowerCase()}-input`, unknownFields: 'reject' }, effects: { mode, audit: mode === 'write' ? 'server-authoritative' : 'none' }, errorExposure: 'sanitized' });
}
const getContract = contract('GET', 'assets.detail.get', 'assets-detail-view', 'read');
const patchContract = contract('PATCH', 'assets.detail.patch', 'assets-detail-edit', 'write');
const postContract = contract('POST', 'assets.detail.action', 'assets-detail-action', 'write');

async function loadAsset(routeContext: RouteContext): Promise<AssetResource> {
  const { assetId } = await routeContext.params;
  const snapshot = await dbAdmin.collection('assets').doc(assetId).get();
  if (!snapshot.exists) throw new AppError({ code: 'ASSET_NOT_FOUND', kind: 'NOT_FOUND', safeMessage: 'Patrimônio não encontrado.' });
  return { id: snapshot.id, data: snapshot.data() ?? {} };
}

function makeEnforcer(routeContract: ReturnType<typeof contract>, method: 'GET' | 'PATCH' | 'POST') {
  return createStandardSecurityEnforcer<any, RouteContext, unknown, Awaited<ReturnType<typeof requireUser>>, Record<string, unknown> | undefined, AssetResource>(routeContract, {
    authenticate: ({ request }) => requireUser(request),
    ...(method === 'GET' ? {} : { parseInput: async ({ request }: any) => { const parsed = routeBodySchema.safeParse(await request.clone().json().catch(() => null)); if (!parsed.success) throw new AppError({ code: 'ASSET_INPUT_INVALID', kind: 'VALIDATION', safeMessage: 'Dados do patrimônio inválidos.' }); return parsed.data; } }),
    loadResource: ({ routeContext }) => loadAsset(routeContext),
    authorize: ({ actor, input }) => {
      if (method === 'GET' && !actor.permissions.assets?.view) throw new AppError({ code: 'ASSET_VIEW_FORBIDDEN', kind: 'AUTHORIZATION' });
      if (method === 'PATCH' && !actor.permissions.assets?.edit) throw new AppError({ code: 'ASSET_EDIT_FORBIDDEN', kind: 'AUTHORIZATION' });
      if (method === 'POST') {
        const action = String(input?.action ?? '');
        const allowed = action === 'print-label' ? actor.permissions.assets?.printLabels : action === 'status' ? (input?.status === 'baixado' ? actor.permissions.assets?.retire : actor.permissions.assets?.edit) : actor.permissions.assets?.transfer;
        if (!allowed) throw new AppError({ code: 'ASSET_ACTION_FORBIDDEN', kind: 'AUTHORIZATION' });
      }
    },
    assertScope: ({ actor, resource }) => { if ((resource.data.workspaceId ?? WORKSPACE_ID) !== actor.workspace_id) throw new AppError({ code: 'ASSET_WORKSPACE_FORBIDDEN', kind: 'AUTHORIZATION' }); },
  });
}
const getEnforcer = makeEnforcer(getContract, 'GET');
const patchEnforcer = makeEnforcer(patchContract, 'PATCH');
const postEnforcer = makeEnforcer(postContract, 'POST');

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

async function handleGet(request: NextRequest, context: RouteContext) {
  const userContext = await requireUser(request);
  if (!userContext.permissions.assets?.view) return jsonError('Sem permissão para visualizar patrimônio.', 403);

  const { assetId } = await context.params;
  const snap = await dbAdmin.collection('assets').doc(assetId).get();
  if (!snap.exists) return jsonError('Patrimônio não encontrado.', 404);
  const raw = { id: snap.id, ...snap.data() };
  return NextResponse.json({ ...raw, ...normalizedAssetLifecycle(raw) });
}

async function handlePatch(request: NextRequest, context: RouteContext) {
  const userContext = await requireUser(request);
  if (!userContext.permissions.assets?.edit) return jsonError('Sem permissão para editar patrimônio.', 403);

  const { assetId } = await context.params;
  const body = await request.json().catch(() => ({}));
  const ref = dbAdmin.collection('assets').doc(assetId);
  const snap = await ref.get();
  if (!snap.exists) return jsonError('Patrimônio não encontrado.', 404);
  const current = snap.data()!;
  const changedPurchaseFields = current.sourceType === 'purchase_receipt'
    ? changedPurchaseLinkedFields(current, body)
    : [];
  if (changedPurchaseFields.length > 0) {
    return jsonError(`Dados de aquisição vinculados à compra são somente leitura: ${changedPurchaseFields.join(', ')}.`, 409);
  }
  const responsibleChanged = [
    ['responsibleUserId', current.responsibleUserId],
    ['responsibleName', current.responsibleName],
  ].some(([field, value]) => Object.prototype.hasOwnProperty.call(body, field) && String(body[field] ?? '') !== String(value ?? ''));
  if (responsibleChanged) return jsonError('Use Transferir posse para alterar o responsável pelo patrimônio.', 409);
  const purchaseLinked = current.sourceType === 'purchase_receipt';
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
    responsibleUserId: current.responsibleUserId ?? null,
    responsibleName: current.responsibleName ?? null,
    responsibilityStatus: current.responsibilityStatus ?? null,
    previousResponsibleUserId: null,
    previousResponsibleName: null,
    responsibilityVacatedAt: null,
    inUse: typeof body.inUse === 'boolean' ? body.inUse : current.inUse ?? true,
    possessionStatus: body.possessionStatus?.trim?.() || null,
    purchaseDate: purchaseLinked ? current.purchaseDate ?? null : body.purchaseDate || null,
    purchaseValue: purchaseLinked ? current.purchaseValue ?? null : Number.isFinite(Number(body.purchaseValue)) ? Number(body.purchaseValue) : null,
    supplierId: purchaseLinked ? current.supplierId ?? null : body.supplierId || null,
    supplierName: purchaseLinked ? current.supplierName ?? null : body.supplierName || null,
    invoiceNumber: purchaseLinked ? current.invoiceNumber ?? null : body.invoiceNumber?.trim?.() || null,
    paymentMethod: purchaseLinked ? current.paymentMethod ?? null : body.paymentMethod?.trim?.() || null,
    costCenter: purchaseLinked ? current.costCenter ?? null : body.costCenter?.trim?.() || null,
    accountingAccount: purchaseLinked ? current.accountingAccount ?? null : body.accountingAccount?.trim?.() || null,
    documentUrl: purchaseLinked ? current.documentUrl ?? null : body.documentUrl || null,
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

async function handlePost(request: NextRequest, context: RouteContext) {
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
    return jsonError('Use a rota de movimentação com versão esperada para alterar a localização.', 409);
  }

  if (action === 'status') {
    const toStatus = body.status as AssetStatus;
    const canChangeStatus = toStatus === 'baixado' ? userContext.permissions.assets?.retire : userContext.permissions.assets?.edit;
    if (!canChangeStatus) return jsonError('Sem permissão para alterar status.', 403);
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
    if (toStatus === 'baixado') await deactivateAssetMaintenance(userContext, assetId);
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
    return jsonError('Escolha Registrar movimentação ou Transferir posse no novo fluxo patrimonial.', 409);
  }

  return jsonError('Ação inválida.');
}

export const GET = secureRoute<RouteContext>({ contract: getContract, enforcer: getEnforcer as any }, ({ request, routeContext }) => handleGet(request, routeContext));
export const PATCH = secureRoute<RouteContext>({ contract: patchContract, enforcer: patchEnforcer as any }, ({ request, routeContext }) => handlePatch(request, routeContext));
export const POST = secureRoute<RouteContext>({ contract: postContract, enforcer: postEnforcer as any }, ({ request, routeContext }) => handlePost(request, routeContext));
