import { NextRequest, NextResponse } from 'next/server';
import { dbAdmin } from '@/lib/firebase-admin';
import { requireUser } from '@/lib/auth-server';
import { InternalProductRepository } from '@/lib/barcode/internal-product-repository';
import type { Product } from '@/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function PUT(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const userContext = await requireUser(request).catch(() => null);
  if (!userContext) return jsonError('Não autorizado.', 401);
  const permissions = userContext.permissions;
  if (!userContext.isDefaultAdmin && !permissions.registration.items.edit && !permissions.purchasing.manageBaseItems) {
    return jsonError('Sem permissão para atualizar produtos.', 403);
  }

  const { id } = await context.params;
  const body = (await request.json().catch(() => ({}))) as Partial<Product>;
  const repository = new InternalProductRepository(dbAdmin);
  const result = await repository.updateProduct(id, body, userContext.decoded.uid);
  return NextResponse.json(result);
}
