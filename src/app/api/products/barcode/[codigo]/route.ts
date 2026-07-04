import { NextRequest, NextResponse } from 'next/server';
import { dbAdmin } from '@/lib/firebase-admin';
import { requireUser } from '@/lib/auth-server';
import { canViewPurchasing } from '@/lib/purchasing-permissions';
import { InternalProductRepository } from '@/lib/barcode/internal-product-repository';
import { ProductLookupService } from '@/lib/barcode/product-lookup-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function GET(request: NextRequest, context: { params: Promise<{ codigo: string }> }) {
  const userContext = await requireUser(request).catch(() => null);
  if (!userContext) return jsonError('Não autorizado.', 401);
  const permissions = userContext.permissions;
  const canLookup =
    userContext.isDefaultAdmin ||
    permissions.registration.view ||
    permissions.registration.items.add ||
    canViewPurchasing(permissions);
  if (!canLookup) return jsonError('Sem permissão para consultar produtos.', 403);

  const { codigo } = await context.params;
  const repository = new InternalProductRepository(dbAdmin);
  const service = new ProductLookupService(repository);
  const result = await service.lookup(codigo, userContext.decoded.uid);
  return NextResponse.json(result, { status: result.mensagem?.includes('invalido') ? 400 : 200 });
}
