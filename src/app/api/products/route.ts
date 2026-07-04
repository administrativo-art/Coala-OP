import { NextRequest, NextResponse } from 'next/server';
import { dbAdmin } from '@/lib/firebase-admin';
import { requireUser } from '@/lib/auth-server';
import { InternalProductRepository } from '@/lib/barcode/internal-product-repository';
import type { ProductSavePayload } from '@/lib/barcode/product-lookup-types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(request: NextRequest) {
  const userContext = await requireUser(request).catch(() => null);
  if (!userContext) return jsonError('Não autorizado.', 401);
  const permissions = userContext.permissions;
  if (!userContext.isDefaultAdmin && !permissions.registration.items.add && !permissions.purchasing.manageBaseItems) {
    return jsonError('Sem permissão para salvar produtos.', 403);
  }

  const body = (await request.json().catch(() => ({}))) as ProductSavePayload;
  const repository = new InternalProductRepository(dbAdmin);
  const result = await repository.saveProduct(body, userContext.decoded.uid);
  return NextResponse.json(result, { status: 201 });
}
