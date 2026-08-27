import { NextRequest, NextResponse } from "next/server";

import { dbAdmin } from "@/lib/firebase-admin";
import {
  buildResponsibilityCreatePayload,
  cleanDocument,
  jsonError,
  optionalString,
  readJsonObject,
  requireOperationalUnitManager,
  requiredString,
} from "@/app/api/dp/_unit-structure";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    await requireOperationalUnitManager(request);
    const body = await readJsonObject(request);
    const now = new Date();
    const ref = dbAdmin.collection("dp_unitGroups").doc();

    const payload = cleanDocument({
      name: requiredString(body, "name", "Nome do grupo"),
      organizationId: optionalString(body.organizationId),
      unitCount: 0,
      ...buildResponsibilityCreatePayload(body),
      createdAt: now,
      updatedAt: now,
    });

    await ref.set(payload);

    return NextResponse.json({ group: { id: ref.id, ...payload } }, { status: 201 });
  } catch (error) {
    return jsonError(error, "Falha ao criar grupo.");
  }
}
