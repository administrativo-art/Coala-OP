import { NextRequest, NextResponse } from "next/server";

import { dbAdmin } from "@/lib/firebase-admin";
import { CnpjValidator } from "@/lib/company/cnpj-validator";
import {
  jsonError,
  readJsonObject,
  requireOperationalUnitManager,
  requiredString,
  setOptionalBooleanPatch,
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
    if (Object.prototype.hasOwnProperty.call(body, "cnpj")) {
      const rawCnpj = typeof body.cnpj === "string" ? body.cnpj.trim() : "";
      if (!rawCnpj) {
        setOptionalStringPatch(update, body, "cnpj");
      } else {
        const cnpj = CnpjValidator.validate(rawCnpj);
        if (!cnpj.valid) throw new Error(cnpj.message);
        update.cnpj = cnpj.clean;
      }
    }
    setOptionalStringPatch(update, body, "address");
    setOptionalStringPatch(update, body, "unitType");
    setOptionalBooleanPatch(update, body, "isArchived");
    setOptionalStringPatch(update, body, "mergedIntoUnitId");
    setOptionalStringPatch(update, body, "mergedIntoUnitName");
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

    const referenceQueries = await Promise.all([
      dbAdmin.collection("users").where("unitIds", "array-contains", unitId).limit(1).get(),
      dbAdmin.collection("users").where("responsibleUnitIds", "array-contains", unitId).limit(1).get(),
      dbAdmin.collection("users").where("assignedKioskIds", "array-contains", unitId).limit(1).get(),
      dbAdmin.collection("dp_shiftDefinitions").where("unitIds", "array-contains", unitId).limit(1).get(),
      dbAdmin.collection("dp_shiftDefinitions").where("unitId", "==", unitId).limit(1).get(),
      dbAdmin.collection("dp_schedules").where("unitId", "==", unitId).limit(1).get(),
    ]);

    if (referenceQueries.some((snapshot) => !snapshot.empty)) {
      throw new Error("A unidade possui vínculos e não pode ser excluída. Arquive ou migre os vínculos primeiro.");
    }

    await dbAdmin.collection("dp_units").doc(unitId).delete();

    return NextResponse.json({ ok: true });
  } catch (error) {
    return jsonError(error, "Falha ao excluir unidade.");
  }
}
