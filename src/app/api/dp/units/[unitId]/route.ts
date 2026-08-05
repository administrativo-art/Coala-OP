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
    const unitRef = dbAdmin.collection("dp_units").doc(unitId);
    const currentSnapshot = await unitRef.get();
    if (!currentSnapshot.exists) throw new Error("Unidade não encontrada.");
    const current = currentSnapshot.data() ?? {};

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

    const nextExternalSource = Object.prototype.hasOwnProperty.call(update, "externalSource")
      ? update.externalSource
      : current.externalSource;
    const nextExternalId = Object.prototype.hasOwnProperty.call(body, "externalId")
      ? (typeof body.externalId === "string" ? body.externalId.trim() : "")
      : typeof current.externalId === "string" ? current.externalId.trim() : "";
    const nextPdvFilialId = Object.prototype.hasOwnProperty.call(body, "pdvFilialId")
      ? (typeof body.pdvFilialId === "string" ? body.pdvFilialId.trim() : "")
      : typeof current.pdvFilialId === "string" ? current.pdvFilialId.trim() : "";

    const batch = dbAdmin.batch();
    batch.update(unitRef, update);
    if (nextExternalSource === "kiosk" && nextExternalId) {
      batch.set(dbAdmin.collection("kiosks").doc(nextExternalId), {
        pdvFilialId: nextPdvFilialId || null,
        pdvLinkManagedByUnitId: unitId,
        pdvLinkSyncedAt: update.updatedAt,
      }, { merge: true });
    }
    await batch.commit();

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
