import { NextRequest, NextResponse } from 'next/server';
import { dbAdmin } from '@/lib/firebase-admin';
import { requireUser, type ServerUserContext } from '@/lib/auth-server';
import { canViewPurchasing } from '@/lib/purchasing-permissions';
import {
  cancelStockCountTaskSafely,
  syncStockCountTaskSafely,
} from '@/features/stock-count/lib/task-sync';
import { type StockAuditSession } from '@/types';

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
    return NextResponse.json({ id: doc.id, ...doc.data() });
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
  const body = await request.json().catch(() => ({}));

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

  const ref = await dbAdmin.collection(collectionName).add({
    ...body,
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

  return NextResponse.json({ id: ref.id }, { status: 201 });
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ path?: string[] }> }) {
  const path = (await context.params).path ?? [];
  const [resource, id] = path;
  const userContext = await getUserContext(request);
  if (!userContext) return jsonError('Não autorizado.', 401);
  if (!canUseRegistryResource(userContext, resource, 'update')) return permissionError();
  const body = await request.json().catch(() => ({}));

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

  const updatePayload = {
    ...body,
    updatedAt: new Date().toISOString(),
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
  } else {
    await dbAdmin.collection(collectionName).doc(id).update(updatePayload);
  }

  if (resource === 'stock-audit') {
    const updatedSnap = await dbAdmin.collection(collectionName).doc(id).get();
    if (updatedSnap.exists) {
      await syncStockCountTaskSafely({
        context: userContext,
        session: { id: updatedSnap.id, ...(updatedSnap.data() ?? {}) } as StockAuditSession,
        label: 'update',
      });
    }
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

  await dbAdmin.collection(collectionName).doc(id).delete();

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
