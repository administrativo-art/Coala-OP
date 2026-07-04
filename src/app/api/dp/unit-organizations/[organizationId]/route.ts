import { NextRequest, NextResponse } from "next/server";

import { dbAdmin } from "@/lib/firebase-admin";
import {
  applyResponsibilityPatch,
  jsonError,
  readJsonObject,
  requireOperationalUnitManager,
  requiredString,
  setOptionalStringPatch,
} from "@/app/api/dp/_unit-structure";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ organizationId: string }>;
};

export async function PATCH(request: NextRequest, contextArg: RouteContext) {
  try {
    await requireOperationalUnitManager(request);
    const { organizationId } = await contextArg.params;
    const body = await readJsonObject(request);
    const update: Record<string, unknown> = { updatedAt: new Date() };

    if (Object.prototype.hasOwnProperty.call(body, "name")) {
      update.name = requiredString(body, "name", "Nome da organização");
    }
    setOptionalStringPatch(update, body, "description");
    applyResponsibilityPatch(update, body);

    await dbAdmin.collection("dp_unitOrganizations").doc(organizationId).update(update);

    return NextResponse.json({ ok: true });
  } catch (error) {
    return jsonError(error, "Falha ao atualizar organização.");
  }
}

export async function DELETE(request: NextRequest, contextArg: RouteContext) {
  try {
    await requireOperationalUnitManager(request);
    const { organizationId } = await contextArg.params;

    await dbAdmin.collection("dp_unitOrganizations").doc(organizationId).delete();

    return NextResponse.json({ ok: true });
  } catch (error) {
    return jsonError(error, "Falha ao excluir organização.");
  }
}
