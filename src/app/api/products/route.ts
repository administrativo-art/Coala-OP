import { NextRequest, NextResponse } from 'next/server';
import { dbAdmin } from '@/lib/firebase-admin';
import { requireUser } from '@/lib/auth-server';
import { InternalProductRepository } from '@/lib/barcode/internal-product-repository';
import type { ProductSavePayload } from '@/lib/barcode/product-lookup-types';
import { AppError, withApiErrorHandling } from '@/lib/observability';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = withApiErrorHandling({
  source: "api",
  operation: "save-product",
  routeOrJob: "/api/products",
}, async (request: NextRequest) => {
  const userContext = await requireUser(request).catch((cause) => {
    throw new AppError({ code: "AUTHENTICATION_REQUIRED", kind: "AUTHENTICATION", cause });
  });
  const permissions = userContext.permissions;
  if (!userContext.isDefaultAdmin && !permissions.registration.items.add && !permissions.purchasing.manageBaseItems) {
    throw new AppError({
      code: "PRODUCT_CREATE_FORBIDDEN",
      kind: "AUTHORIZATION",
      safeMessage: "Sem permissão para salvar produtos.",
    });
  }

  const body = (await request.json().catch(() => ({}))) as ProductSavePayload;
  const repository = new InternalProductRepository(dbAdmin);
  const result = await repository.saveProduct(body, userContext.decoded.uid);
  return NextResponse.json(result, { status: 201 });
});
