import { NextRequest, NextResponse } from "next/server";

import { dbAdmin } from "@/lib/firebase-admin";
import { CnpjValidator } from "@/lib/company/cnpj-validator";
import {
  cleanDocument,
  jsonError,
  optionalBoolean,
  optionalNumber,
  optionalString,
  readJsonObject,
  requireOperationalUnitManager,
  requiredString,
} from "@/app/api/dp/_unit-structure";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function normalizeExternalSource(value: unknown) {
  if (value === "manual" || value === "kiosk" || value === "pdvlegal" || value === "bizneo") {
    return value;
  }
  return "manual";
}

export async function POST(request: NextRequest) {
  try {
    await requireOperationalUnitManager(request);
    const body = await readJsonObject(request);
    const now = new Date();
    const ref = dbAdmin.collection("dp_units").doc();
    const rawCnpj = optionalString(body.cnpj);
    const cnpj = rawCnpj ? CnpjValidator.validate(rawCnpj) : null;
    if (cnpj && !cnpj.valid) throw new Error(cnpj.message);

    const payload = cleanDocument({
      name: requiredString(body, "name", "Nome da unidade"),
      isArchived: optionalBoolean(body.isArchived),
      mergedIntoUnitId: optionalString(body.mergedIntoUnitId),
      mergedIntoUnitName: optionalString(body.mergedIntoUnitName),
      cnpj: cnpj?.clean,
      address: optionalString(body.address),
      unitType: optionalString(body.unitType),
      organizationId: optionalString(body.organizationId),
      groupId: optionalString(body.groupId),
      externalSource: normalizeExternalSource(body.externalSource),
      externalId: optionalString(body.externalId),
      pdvFilialId: optionalString(body.pdvFilialId),
      bizneoTaxonId: optionalNumber(body.bizneoTaxonId),
      auditChecklistThreshold: optionalNumber(body.auditChecklistThreshold),
      createdAt: now,
      updatedAt: now,
    });

    await ref.set(payload);

    return NextResponse.json({ unit: { id: ref.id, ...payload } }, { status: 201 });
  } catch (error) {
    return jsonError(error, "Falha ao criar unidade.");
  }
}
