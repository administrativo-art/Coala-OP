import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { dbAdmin } from "@/lib/firebase-admin";
import { AppError, withApiErrorHandling } from "@/lib/observability";
import { bioPageSchema, defaultBioPage, uploadedBioProductImageId, validateBioForPublish } from "@/lib/public-bio";
import { bioMediaFile, requireBioManager } from "@/lib/public-bio-media";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ref = dbAdmin.collection("public_site_settings").doc("coala-bio");
const updateSchema = z.object({
  action: z.enum(["save", "publish"]),
  expectedRevision: z.number().int().nonnegative(),
  page: bioPageSchema,
});

export const GET = withApiErrorHandling({
  source: "api", operation: "get-public-bio-settings", routeOrJob: "/api/settings/public-bio",
}, async (request: NextRequest) => {
  await requireBioManager(request);
  const snapshot = await ref.get();
  const data = snapshot.data();
  const draft = bioPageSchema.safeParse(data?.draft);
  return NextResponse.json({
    draft: draft.success ? draft.data : defaultBioPage,
    revision: Number(data?.revision ?? 0),
    publishedAt: data?.publishedAt ?? null,
  }, { headers: { "Cache-Control": "private, no-store" } });
});

export const PUT = withApiErrorHandling({
  source: "api", operation: "update-public-bio-settings", routeOrJob: "/api/settings/public-bio",
}, async (request: NextRequest) => {
  const actor = await requireBioManager(request);
  const body = updateSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) {
    throw new AppError({ code: "PUBLIC_BIO_INVALID_DATA", kind: "VALIDATION", safeMessage: "Verifique os dados da página." });
  }
  if (body.data.action === "publish") {
    const issue = validateBioForPublish(body.data.page);
    if (issue) throw new AppError({ code: "PUBLIC_BIO_INVALID_LINK", kind: "VALIDATION", safeMessage: issue });
    const imageIds = [
      ...body.data.page.menuImages.map((image) => image.id),
      ...body.data.page.promotionImages.map((image) => image.id),
      ...body.data.page.momentProducts.map((product) => uploadedBioProductImageId(product.image)).filter((id): id is string => Boolean(id)),
    ];
    const existing = await Promise.all([...new Set(imageIds)].map(async (id) => (await bioMediaFile(id).exists())[0]));
    if (existing.some((exists) => !exists)) {
      throw new AppError({ code: "PUBLIC_BIO_MISSING_IMAGE", kind: "VALIDATION", safeMessage: "Uma imagem não está mais disponível. Remova-a ou envie novamente." });
    }
  }

  const result = await dbAdmin.runTransaction(async (transaction) => {
    const current = await transaction.get(ref);
    const currentRevision = Number(current.get("revision") ?? 0);
    if (currentRevision !== body.data.expectedRevision) return null;
    const nextRevision = currentRevision + 1;
    const now = new Date().toISOString();
    const patch: Record<string, unknown> = {
      draft: body.data.page,
      revision: nextRevision,
      updatedAt: now,
      updatedBy: actor.decoded.uid,
    };
    if (body.data.action === "publish") {
      patch.published = body.data.page;
      patch.publishedAt = now;
      patch.publishedBy = actor.decoded.uid;
    }
    transaction.set(ref, patch, { merge: true });
    return { revision: nextRevision, publishedAt: body.data.action === "publish" ? now : current.get("publishedAt") ?? null };
  });
  if (!result) {
    throw new AppError({ code: "PUBLIC_BIO_REVISION_CONFLICT", kind: "CONFLICT", safeMessage: "A página foi alterada em outra sessão. Recarregue antes de salvar." });
  }
  return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
});
