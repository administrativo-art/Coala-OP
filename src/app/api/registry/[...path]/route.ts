import { NextRequest, NextResponse } from 'next/server';
import { dbAdmin } from '@/lib/firebase-admin';
import { requireUser, type ServerUserContext } from '@/lib/auth-server';
import { canViewPurchasing } from '@/lib/purchasing-permissions';
import {
  cancelStockCountTaskSafely,
  syncStockCountTaskSafely,
} from '@/features/stock-count/lib/task-sync';
import {
  completeStockCountSession,
  isStockCountOwner,
} from '@/features/stock-count/lib/finalize';
import { type StockAuditSession } from '@/types';
import { normalizeMeasurementUnit } from '@/lib/conversion';
import { canAccessUnit } from '@/lib/unit-access';
import { parseBaseProductStockLevels, BaseProductPolicyValidationError, writableBaseProductPayload } from '@/lib/base-product-stock-levels';
import { ZodError } from 'zod';
import type { Transaction } from 'firebase-admin/firestore';
import { toErrorResponse } from '@/lib/observability/api-error';
import { resolveRequestId, resolveCorrelationId } from '@/lib/observability/ids';
import { reportSystemError } from '@/lib/observability/reporter';
import { replenishmentPolicyEnabled } from '@/lib/replenishment-feature';
import { runMinimumStockRecalculation } from '@/lib/replenishment-recalculate';
import { companyEmailPurposeIndex } from '@/lib/company/company-process-contact';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const WORKSPACE_ID = process.env.NEXT_PUBLIC_WORKSPACE_ID ?? 'coala';

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

async function getUserContext(request: NextRequest) {
  try {
    return await requireUser(request);
  } catch {
    return null;
  }
}

type RegistryAction = 'read' | 'create' | 'update' | 'delete';

function canUseRegistryResource(
  context: ServerUserContext,
  resource: string | undefined,
  action: RegistryAction,
) {
  if (context.isDefaultAdmin) return true;
  const permissions = context.permissions;

  if (resource === 'products') {
    if (action === 'read') {
      return permissions.registration.view ||
        permissions.stock.inventoryControl.view ||
        canViewPurchasing(permissions) ||
        permissions.commercial.technicalSheets.view;
    }
    if (action === 'create') {
      return permissions.registration.items.add ||
        permissions.purchasing.manageBaseItems ||
        permissions.commercial.technicalSheets.create;
    }
    if (action === 'update') {
      return permissions.registration.items.edit ||
        permissions.purchasing.manageBaseItems ||
        permissions.commercial.technicalSheets.edit;
    }
    return permissions.registration.items.delete ||
      permissions.commercial.technicalSheets.delete;
  }

  if (resource === 'base-products') {
    if (action === 'read') {
      return permissions.registration.view ||
        permissions.stock.view ||
        canViewPurchasing(permissions) ||
        permissions.pricing.view ||
        permissions.commercial.technicalSheets.view;
    }
    if (action === 'create') {
      return permissions.registration.baseProducts.add ||
        permissions.purchasing.manageBaseItems ||
        permissions.commercial.technicalSheets.create;
    }
    if (action === 'update') {
      return permissions.registration.baseProducts.edit ||
        permissions.purchasing.manageBaseItems ||
        permissions.commercial.technicalSheets.edit;
    }
    return permissions.registration.baseProducts.delete ||
      permissions.commercial.technicalSheets.delete;
  }

  if (resource === 'entities') {
    if (action === 'read') {
      return permissions.registration.view || canViewPurchasing(permissions);
    }
    if (action === 'create') return permissions.registration.entities.add;
    if (action === 'update') return permissions.registration.entities.edit;
    return permissions.registration.entities.delete;
  }

  if (resource === 'stock-audit') {
    if (action === 'read') {
      return permissions.stock.stockCount.view || permissions.stock.audit.view;
    }
    if (action === 'create') {
      return permissions.stock.stockCount.perform || permissions.stock.audit.start;
    }
    if (action === 'update') {
      return permissions.stock.stockCount.perform ||
        permissions.stock.stockCount.approve ||
        permissions.stock.audit.approve;
    }
    return permissions.stock.stockCount.approve || permissions.stock.audit.approve;
  }

  if (resource === 'competitors') {
    return permissions.pricing.view;
  }

  if (resource === 'operational-categories') {
    return action === 'read'
      ? canViewPurchasing(permissions)
      : permissions.purchasing.manageBaseItems;
  }

  return false;
}

function permissionError() {
  return jsonError('Sem permissão para esta operação.', 403);
}

function errorStatus(error: unknown, fallback = 400) {
  return typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'number'
    ? error.code
    : fallback;
}

function normalizeEntityDocument(value: unknown) {
  return typeof value === 'string' ? value.replace(/\D/g, '') : '';
}

function normalizeRegistryMeasurementUnit(resource: string | undefined, body: Record<string, any>) {
  if (!['products', 'base-products'].includes(resource ?? '') || typeof body.unit !== 'string') {
    return body;
  }
  return { ...body, unit: normalizeMeasurementUnit(body.unit) };
}

async function directUnitsExist(stockLevels: Record<string, { supplyMode?: string }>, transaction?: Transaction) {
  for (const [kioskId, level] of Object.entries(stockLevels)) {
    if (level.supplyMode !== 'direct') continue;
    const kioskRef = dbAdmin.collection('kiosks').doc(kioskId);
    const unitsQuery = dbAdmin.collection('dp_units').where('externalId', '==', kioskId).limit(3);
    const [kiosk, units] = await Promise.all([
      transaction ? transaction.get(kioskRef) : kioskRef.get(),
      transaction ? transaction.get(unitsQuery) : unitsQuery.get(),
    ]);
    if (!kiosk.exists || kiosk.get('isArchived') === true || !units.docs.some(doc => {
      const unit = doc.data();
      return unit.externalSource === 'kiosk' && unit.isArchived !== true &&
        ['commercial', 'mixed'].includes(unit.stockRole ?? 'commercial');
    })) return false;
  }
  return true;
}

async function assertUniqueEntityDocument(value: unknown, currentId?: string) {
  const normalized = normalizeEntityDocument(value);
  if (!normalized) return normalized;
  if (![11, 14].includes(normalized.length)) {
    throw new Error('CPF/CNPJ inválido.');
  }
  const snapshot = await dbAdmin.collection('entities').get();
  const duplicate = snapshot.docs.find((document) => {
    if (document.id === currentId) return false;
    const data = document.data();
    return normalizeEntityDocument(data.documentNormalized ?? data.document ?? data.cnpj) === normalized;
  });
  if (duplicate) throw new Error('Já existe uma pessoa ou empresa cadastrada com este CPF/CNPJ.');
  return normalized;
}

export async function GET(request: NextRequest, context: { params: Promise<{ path?: string[] }> }) {
  const path = (await context.params).path ?? [];
  const [resource, id] = path;
  const userContext = await getUserContext(request);
  if (!userContext) return jsonError('Não autorizado.', 401);
  if (!canUseRegistryResource(userContext, resource, 'read')) return permissionError();

  const collectionMap: Record<string, string> = {
    'products': 'products',
    'base-products': 'baseProducts',
    'entities': 'entities',
    'stock-audit': 'stockAuditSessions',
    'competitors': 'concorrentes',
    'operational-categories': 'operationalItemCategories',
  };

  const collectionName = collectionMap[resource];
  if (!collectionName) return jsonError('Recurso não encontrado.', 404);

  if (id) {
    const doc = await dbAdmin.collection(collectionName).doc(id).get();
    if (!doc.exists) return jsonError('Documento não encontrado.', 404);
    if (resource === 'stock-audit' && !canAccessUnit(
      userContext.userDoc,
      String(doc.get('kioskId') ?? ''),
      { isDefaultAdmin: userContext.isDefaultAdmin },
    )) {
      return permissionError();
    }
    return NextResponse.json({ id: doc.id, ...doc.data() });
  }

  if (resource === 'stock-audit') {
    return jsonError('Use a listagem paginada de contagens.', 400);
  }

  const snapshot = await dbAdmin.collection(collectionName).get();
  const data = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
  return NextResponse.json(data);
}

export async function POST(request: NextRequest, context: { params: Promise<{ path?: string[] }> }) {
  const path = (await context.params).path ?? [];
  const [resource] = path;
  const userContext = await getUserContext(request);
  if (!userContext) return jsonError('Não autorizado.', 401);
  if (!canUseRegistryResource(userContext, resource, 'create')) return permissionError();
  const rawBody = await request.json().catch(() => ({})) as Record<string, any>;
  const normalizedBody = normalizeRegistryMeasurementUnit(resource,
    resource === 'base-products' ? writableBaseProductPayload(rawBody) : rawBody);
  const body = resource === 'entities'
    ? { ...normalizedBody, departmentEmailPurposes: companyEmailPurposeIndex(normalizedBody) }
    : normalizedBody;

  const collectionMap: Record<string, string> = {
    'products': 'products',
    'base-products': 'baseProducts',
    'entities': 'entities',
    'stock-audit': 'stockAuditSessions',
    'competitors': 'concorrentes',
    'operational-categories': 'operationalItemCategories',
  };

  const collectionName = collectionMap[resource];
  if (!collectionName) return jsonError('Recurso não encontrado.', 404);
  if (resource === 'base-products' && body.minStockRecalcPeriod !== undefined &&
    !['monthly', 'biweekly'].includes(body.minStockRecalcPeriod)) {
    return jsonError('Ciclo de reposição inválido.');
  }
  let baseProductLevels: ReturnType<typeof parseBaseProductStockLevels> | undefined;
  if (resource === 'base-products') {
    try {
      baseProductLevels = parseBaseProductStockLevels(body.stockLevels ?? {}, {}, kioskId =>
        canAccessUnit(userContext.userDoc, kioskId, { isDefaultAdmin: userContext.isDefaultAdmin }),
        replenishmentPolicyEnabled());
      if (!await directUnitsExist(baseProductLevels)) return jsonError('Compra direta exige unidade comercial ativa.');
    } catch (error) {
      if (error instanceof BaseProductPolicyValidationError || error instanceof ZodError) {
        return jsonError('Rota, prazo ou unidade do estoque inválidos.', 400);
      }
      return toErrorResponse(error, resolveRequestId(request), resolveCorrelationId(request),
        { source: 'api-registry', operation: 'validate-base-product-policy', routeOrJob: '/api/registry/base-products' });
    }
  }

  let normalizedEntityDocument = '';
  if (resource === 'entities') {
    try {
      normalizedEntityDocument = await assertUniqueEntityDocument(body.document ?? body.cnpj);
    } catch (error) {
      return jsonError(error instanceof Error ? error.message : 'CPF/CNPJ inválido.');
    }
  }

  const stockAuditPayload = resource === 'stock-audit'
    ? {
        kioskId: String(body.kioskId ?? '').trim(),
        kioskName: String(body.kioskName ?? '').trim(),
        status: 'pending_review',
        auditedBy: {
          userId: userContext.userDoc.id,
          username: userContext.userDoc.username,
        },
        startedAt: new Date().toISOString(),
        items: Array.isArray(body.items) ? body.items : [],
      }
    : body;
  if (resource === 'stock-audit' && (!stockAuditPayload.kioskId || !stockAuditPayload.kioskName || stockAuditPayload.items.length === 0)) {
    return jsonError('Unidade e itens da contagem são obrigatórios.');
  }
  if (resource === 'stock-audit' && !canAccessUnit(
    userContext.userDoc,
    stockAuditPayload.kioskId,
    { isDefaultAdmin: userContext.isDefaultAdmin },
  )) {
    return permissionError();
  }

  const ref = await dbAdmin.collection(collectionName).add({
    ...stockAuditPayload,
    ...(resource === 'base-products' ? {
      stockLevels: replenishmentPolicyEnabled()
        ? Object.fromEntries(Object.entries(baseProductLevels ?? {}).map(([key, level]) =>
            [key, { ...level, min: 0, override: false, calculationStatus: 'pending' }]))
        : baseProductLevels,
      replenishmentPolicyVersion: replenishmentPolicyEnabled() ? 1 : 0,
    } : {}),
    ...(resource === 'entities' && normalizedEntityDocument
      ? { documentNormalized: normalizedEntityDocument }
      : {}),
    workspaceId: WORKSPACE_ID,
    createdAt: new Date().toISOString(),
    createdBy: userContext.decoded.uid,
  });

  if (resource === 'stock-audit') {
    const createdSnap = await ref.get();
    await syncStockCountTaskSafely({
      context: userContext,
      session: { id: ref.id, ...(createdSnap.data() ?? {}) } as StockAuditSession,
      label: 'create',
    });
  }

  if (resource === 'base-products') {
    try {
      await runMinimumStockRecalculation(dbAdmin, new Date(), ref.id, replenishmentPolicyEnabled());
    } catch (error) {
      const reference = reportSystemError({ error, source: 'api-registry', operation: 'recalculate-created-base-product',
        routeOrJob: '/api/registry/base-products', requestId: resolveRequestId(request) });
      return NextResponse.json({ id: ref.id, recalculation: { status: 'pending', eventId: reference.eventId } }, { status: 201 });
    }
  }

  return NextResponse.json({ id: ref.id }, { status: 201 });
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ path?: string[] }> }) {
  const path = (await context.params).path ?? [];
  const [resource, id] = path;
  const userContext = await getUserContext(request);
  if (!userContext) return jsonError('Não autorizado.', 401);
  if (!canUseRegistryResource(userContext, resource, 'update')) return permissionError();
  const rawBody = await request.json().catch(() => ({})) as Record<string, any>;
  const body = normalizeRegistryMeasurementUnit(resource,
    resource === 'base-products' ? writableBaseProductPayload(rawBody) : rawBody);

  const collectionMap: Record<string, string> = {
    'products': 'products',
    'base-products': 'baseProducts',
    'entities': 'entities',
    'stock-audit': 'stockAuditSessions',
    'competitors': 'concorrentes',
    'operational-categories': 'operationalItemCategories',
  };

  const collectionName = collectionMap[resource];
  if (!collectionName || !id) return jsonError('Recurso ou ID inválido.', 404);
  if (resource === 'base-products' && body.minStockRecalcPeriod !== undefined &&
    !['monthly', 'biweekly'].includes(body.minStockRecalcPeriod)) {
    return jsonError('Ciclo de reposição inválido.');
  }

  if (resource === 'stock-audit') {
    const existingSnap = await dbAdmin.collection(collectionName).doc(id).get();
    if (!existingSnap.exists) return jsonError('Sessão de contagem não encontrada.', 404);
    const existingSession = {
      id: existingSnap.id,
      ...(existingSnap.data() ?? {}),
    } as StockAuditSession;
    if (!isStockCountOwner(userContext, existingSession)) {
      return jsonError('Somente a pessoa que iniciou a contagem pode alterá-la ou concluí-la.', 403);
    }

    if (body.status === 'completed') {
      try {
        const result = await completeStockCountSession({
          context: userContext,
          sessionId: id,
          items: body.items,
        });
        await syncStockCountTaskSafely({
          context: userContext,
          session: result.session,
          label: 'complete',
        });
        return NextResponse.json({ ok: true, alreadyCompleted: result.alreadyCompleted });
      } catch (error) {
        return jsonError(
          error instanceof Error ? error.message : 'Não foi possível concluir a contagem.',
          errorStatus(error),
        );
      }
    }

    if (!Array.isArray(body.items)) return jsonError('Os itens da contagem são obrigatórios.');
    await dbAdmin.collection(collectionName).doc(id).update({
      items: body.items,
      updatedAt: new Date().toISOString(),
      updatedBy: userContext.userDoc.id,
    });
    const updatedSnap = await dbAdmin.collection(collectionName).doc(id).get();
    await syncStockCountTaskSafely({
      context: userContext,
      session: { id: updatedSnap.id, ...(updatedSnap.data() ?? {}) } as StockAuditSession,
      label: 'update',
    });
    return NextResponse.json({ ok: true });
  }

  let normalizedEntityDocument = '';
  if (resource === 'entities') {
    try {
      const current = await dbAdmin.collection(collectionName).doc(id).get();
      if (!current.exists) return jsonError('Empresa não encontrada.', 404);
      normalizedEntityDocument = await assertUniqueEntityDocument(
        body.document ?? body.cnpj ?? current.get('document') ?? current.get('cnpj'),
        id,
      );
    } catch (error) {
      return jsonError(error instanceof Error ? error.message : 'CPF/CNPJ inválido.');
    }
  }

  const updatePayload = {
    ...body,
    ...(resource === 'entities' && normalizedEntityDocument
      ? { documentNormalized: normalizedEntityDocument }
      : {}),
    updatedAt: new Date().toISOString(),
    updatedBy: userContext.decoded.uid,
  };

  if (resource === 'operational-categories') {
    await dbAdmin.collection(collectionName).doc(id).set(
      {
        ...updatePayload,
        workspaceId: WORKSPACE_ID,
        createdAt: body.createdAt ?? new Date().toISOString(),
        createdBy: body.createdBy ?? userContext.decoded.uid,
      },
      { merge: true },
    );
  } else if (resource === 'entities') {
    const entityRef = dbAdmin.collection(collectionName).doc(id);
    await dbAdmin.runTransaction(async (transaction) => {
      const current = await transaction.get(entityRef);
      if (!current.exists) throw new Error('Empresa não encontrada.');
      transaction.update(entityRef, {
        ...updatePayload,
        departmentEmailPurposes: companyEmailPurposeIndex(body, current.data()),
      });
    });
  } else if (resource === 'base-products') {
    const enabled = replenishmentPolicyEnabled();
    const shouldRecalculate = body.stockLevels !== undefined || body.minStockRecalcPeriod !== undefined
      || body.unit !== undefined || body.category !== undefined;
    try {
      await dbAdmin.runTransaction(async transaction => {
        const ref = dbAdmin.collection(collectionName).doc(id);
        const current = await transaction.get(ref);
        if (!current.exists) throw new Error('Produto base não encontrado.');
        let stockLevels = body.stockLevels === undefined
          ? current.get('stockLevels') ?? {}
          : parseBaseProductStockLevels(body.stockLevels, current.get('stockLevels') ?? {}, kioskId =>
              canAccessUnit(userContext.userDoc, kioskId, { isDefaultAdmin: userContext.isDefaultAdmin }),
              replenishmentPolicyEnabled());
        const editedLevels = Object.fromEntries(Object.keys(body.stockLevels ?? {}).map(key => [key, stockLevels[key]]));
        if (!await directUnitsExist(editedLevels, transaction)) {
          throw new BaseProductPolicyValidationError('Compra direta exige unidade comercial ativa.');
        }
        const pendingLevels = Object.fromEntries(
          Object.entries(stockLevels).map(([key, value]) => [key, {
            ...(value as Record<string, unknown>),
            min: 0, override: false, calculationStatus: 'pending', source: 'none',
            sourceLimitation: 'Aguardando recálculo após alteração da política.',
          }]));
        if (shouldRecalculate && enabled) stockLevels = pendingLevels;
        transaction.update(ref, { ...updatePayload, stockLevels,
          ...(shouldRecalculate && !enabled ? { replenishmentPreview: pendingLevels } : {}),
          ...(shouldRecalculate
            ? { replenishmentPolicyVersion: Number(current.get('replenishmentPolicyVersion') ?? 0) + 1 }
            : {}) });
      });
    } catch (error) {
      if (error instanceof BaseProductPolicyValidationError || error instanceof ZodError) {
        return jsonError('Rota, prazo ou unidade do estoque inválidos.', 400);
      }
      return toErrorResponse(error, resolveRequestId(request), resolveCorrelationId(request),
        { source: 'api-registry', operation: 'save-base-product-policy', routeOrJob: '/api/registry/base-products' });
    }
    if (shouldRecalculate) {
      try {
        await runMinimumStockRecalculation(dbAdmin, new Date(), id, enabled);
      } catch (error) {
        const reference = reportSystemError({ error, source: 'api-registry', operation: 'recalculate-updated-base-product',
          routeOrJob: '/api/registry/base-products', requestId: resolveRequestId(request) });
        return NextResponse.json({ ok: true, recalculation: { status: 'pending', eventId: reference.eventId } });
      }
    }
  } else {
    await dbAdmin.collection(collectionName).doc(id).update(updatePayload);
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ path?: string[] }> }) {
  const path = (await context.params).path ?? [];
  const [resource, id] = path;
  const userContext = await getUserContext(request);
  if (!userContext) return jsonError('Não autorizado.', 401);
  if (!canUseRegistryResource(userContext, resource, 'delete')) return permissionError();

  const collectionMap: Record<string, string> = {
    'products': 'products',
    'base-products': 'baseProducts',
    'entities': 'entities',
    'stock-audit': 'stockAuditSessions',
    'competitors': 'concorrentes',
    'operational-categories': 'operationalItemCategories',
  };

  const collectionName = collectionMap[resource];
  if (!collectionName || !id) return jsonError('Recurso ou ID inválido.', 404);

  const existingSnap =
    resource === 'stock-audit'
      ? await dbAdmin.collection(collectionName).doc(id).get()
      : null;

  if (resource === 'stock-audit') {
    if (!existingSnap?.exists) return jsonError('Sessão de contagem não encontrada.', 404);
    const existingSession = {
      id: existingSnap.id,
      ...(existingSnap.data() ?? {}),
    } as StockAuditSession;
    if (!isStockCountOwner(userContext, existingSession)) {
      return jsonError('Somente a pessoa que iniciou a contagem pode cancelá-la.', 403);
    }
  }

  if (resource === 'entities') {
    await dbAdmin.collection(collectionName).doc(id).set({
      status: 'inactive',
      updatedAt: new Date().toISOString(),
      updatedBy: userContext.decoded.uid,
      inactivatedAt: new Date().toISOString(),
      inactivatedBy: userContext.decoded.uid,
    }, { merge: true });
  } else {
    await dbAdmin.collection(collectionName).doc(id).delete();
  }

  if (resource === 'stock-audit') {
    const existingData = existingSnap?.data() as Partial<StockAuditSession> | undefined;
    await cancelStockCountTaskSafely({
      context: userContext,
      sessionId: id,
      taskId: existingData?.taskId,
      label: 'delete',
    });
  }

  return NextResponse.json({ ok: true });
}
