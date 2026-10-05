import { FieldPath, type Timestamp } from "firebase-admin/firestore";
import { NextRequest, NextResponse } from "next/server";

import { requireInstagramSchedulerUser } from "@/features/instagram-scheduler/access.server";
import { dbAdmin } from "@/lib/firebase-admin";
import { AppError } from "@/lib/observability/app-error";
import { withApiErrorHandling } from "@/lib/observability/api-error";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function timestamp(value: unknown) {
  if (value && typeof (value as Timestamp).toDate === "function") return (value as Timestamp).toDate().toISOString();
  return typeof value === "string" ? value : null;
}

function numberOrNull(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export const GET = withApiErrorHandling(
  { source: "api", operation: "listMarketingProducts", routeOrJob: "/api/integrations/marketing/products" },
  async (request: NextRequest) => {
    const context = await requireInstagramSchedulerUser(request);
    const requested = Number(request.nextUrl.searchParams.get("limit") ?? 100);
    if (!Number.isInteger(requested) || requested < 1) {
      throw new AppError({ code: "MARKETING_PRODUCTS_INVALID_LIMIT", kind: "VALIDATION", safeMessage: "Limite inválido.", reportable: false });
    }
    const limit = Math.min(requested, 250);
    const cursor = request.nextUrl.searchParams.get("cursor")?.trim() ?? "";
    let query = dbAdmin.collection("products").orderBy(FieldPath.documentId()).limit(limit + 1);
    if (cursor) query = query.startAfter(cursor);
    const snapshot = await query.get();
    const docs = snapshot.docs.slice(0, limit);
    const items = docs.map((doc) => {
      const data = doc.data();
      return {
        id: doc.id,
        name: data.nome ?? data.baseName ?? "",
        sku: data.sku ?? null,
        barcode: data.codigo_barras ?? data.barcode ?? data.gtin ?? null,
        brand: data.marca ?? data.brand ?? null,
        category: data.categoria_id ?? data.externalCategory ?? data.category ?? null,
        archived: data.isArchived === true,
        description: data.descricao ?? data.description ?? null,
        ingredients: data.ingredientes ?? data.ingredients ?? null,
        allergens: Array.isArray(data.detectedAllergens) ? data.detectedAllergens : [],
        packageSize: numberOrNull(data.packageSize ?? data.quantidade),
        unit: data.unit ?? data.unidade_medida ?? null,
        imageUrl: data.imagem_url ?? data.imageUrl ?? null,
        sourceUpdatedAt: timestamp(data.updatedAt ?? data.data_consulta ?? data.lastBarcodeLookupAt),
      };
    });
    return NextResponse.json({
      items,
      nextCursor: snapshot.docs.length > limit ? docs.at(-1)?.id ?? null : null,
    }, { headers: { "Cache-Control": "private, no-store" } });
  },
);
