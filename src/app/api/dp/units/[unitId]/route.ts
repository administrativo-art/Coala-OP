import { NextRequest, NextResponse } from "next/server";

import { dbAdmin } from "@/lib/firebase-admin";
import {
  jsonError,
  readJsonObject,
  requireOperationalUnitManager,
  requiredString,
  setOptionalNumberPatch,
  setOptionalStringPatch,
} from "@/app/api/dp/_unit-structure";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ unitId: string }>;
};

function normalizeExternalSource(value: unknown) {
  if (value === "manual" || value === "kiosk" || value === "pdvlegal" || value === "bizneo") {
    return value;
  }
  return null;
}

export async function PATCH(request: NextRequest, contextArg: RouteContext) {
  try {
    await requireOperationalUnitManager(request);
    const { unitId } = await contextArg.params;
    const body = await readJsonObject(request);
    const update: Record<string, unknown> = { updatedAt: new Date() };

    if (Object.prototype.hasOwnProperty.call(body, "name")) {
      update.name = requiredString(body, "name", "Nome da unidade");
    }
    setOptionalStringPatch(update, body, "organizationId");
    setOptionalStringPatch(update, body, "groupId");
    setOptionalStringPatch(update, body, "externalId");
    setOptionalStringPatch(update, body, "pdvFilialId");
    setOptionalNumberPatch(update, body, "bizneoTaxonId");
    setOptionalNumberPatch(update, body, "auditChecklistThreshold");

    if (Object.prototype.hasOwnProperty.call(body, "externalSource")) {
      const externalSource = normalizeExternalSource(body.externalSource);
      if (externalSource) update.externalSource = externalSource;
    }

    await dbAdmin.collection("dp_units").doc(unitId).update(update);

    return NextResponse.json({ ok: true });
  } catch (error) {
    return jsonError(error, "Falha ao atualizar unidade.");
  }
}

export async function DELETE(request: NextRequest, contextArg: RouteContext) {
  try {
    await requireOperationalUnitManager(request);
    const { unitId } = await contextArg.params;

    await dbAdmin.collection("dp_units").doc(unitId).delete();

    return NextResponse.json({ ok: true });
  } catch (error) {
    return jsonError(error, "Falha ao excluir unidade.");
  }
}
