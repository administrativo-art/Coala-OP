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
  params: Promise<{ groupId: string }>;
};

export async function PATCH(request: NextRequest, contextArg: RouteContext) {
  try {
    await requireOperationalUnitManager(request);
    const { groupId } = await contextArg.params;
    const body = await readJsonObject(request);
    const update: Record<string, unknown> = { updatedAt: new Date() };

    if (Object.prototype.hasOwnProperty.call(body, "name")) {
      update.name = requiredString(body, "name", "Nome do grupo");
    }
    setOptionalStringPatch(update, body, "organizationId");
    applyResponsibilityPatch(update, body);

    await dbAdmin.collection("dp_unitGroups").doc(groupId).update(update);

    return NextResponse.json({ ok: true });
  } catch (error) {
    return jsonError(error, "Falha ao atualizar grupo.");
  }
}

export async function DELETE(request: NextRequest, contextArg: RouteContext) {
  try {
    await requireOperationalUnitManager(request);
    const { groupId } = await contextArg.params;

    await dbAdmin.collection("dp_unitGroups").doc(groupId).delete();

    return NextResponse.json({ ok: true });
  } catch (error) {
    return jsonError(error, "Falha ao excluir grupo.");
  }
}
