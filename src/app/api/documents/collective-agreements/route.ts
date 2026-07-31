import { NextRequest, NextResponse } from "next/server";
import { Timestamp } from "firebase-admin/firestore";

import {
  collectiveAgreementInputSchema,
  collectiveAgreementPeriodsOverlap,
} from "@/features/hr/documents/collective-agreement";
import { assertFormalizationAccess, serializeHrValue } from "@/features/hr/lib/server-access";
import { dbAdmin } from "@/lib/firebase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const COLLECTION = "documentCollectiveAgreements";

function message(cause: unknown, fallback: string) {
  return cause instanceof Error ? cause.message : fallback;
}

export async function GET(request: NextRequest) {
  try {
    await assertFormalizationAccess(request, "templates.view");
    const [agreementsSnapshot, unitsSnapshot] = await Promise.all([
      dbAdmin.collection(COLLECTION).get(),
      dbAdmin.collection("dp_units").get(),
    ]);
    const units = unitsSnapshot.docs
      .filter((document) => document.get("isArchived") !== true)
      .map((document) => ({
        id: document.id,
        name: String(document.get("name") ?? "Unidade sem nome"),
        address: typeof document.get("address") === "string" ? document.get("address") : null,
      }))
      .sort((left, right) => left.name.localeCompare(right.name, "pt-BR"));
    const unitNames = new Map(units.map((unit) => [unit.id, unit.name]));
    const agreements: Record<string, unknown>[] = agreementsSnapshot.docs
      .map((document): Record<string, unknown> => ({
        id: document.id,
        ...((serializeHrValue(document.data()) as Record<string, unknown>) ?? {}),
        unitName: unitNames.get(String(document.get("unitId") ?? "")) ?? "Unidade removida",
      }))
      .sort((left, right) => {
        const unitComparison = String(left.unitName).localeCompare(String(right.unitName), "pt-BR");
        return unitComparison || String(right.validFrom ?? "").localeCompare(String(left.validFrom ?? ""));
      });
    return NextResponse.json({ agreements, units });
  } catch (cause) {
    return NextResponse.json(
      { error: message(cause, "Falha ao carregar as convenções coletivas.") },
      { status: 403 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const access = await assertFormalizationAccess(request, "templates.manage");
    const input = collectiveAgreementInputSchema.parse(await request.json());
    const unit = await dbAdmin.collection("dp_units").doc(input.unitId).get();
    if (!unit.exists || unit.get("isArchived") === true) {
      return NextResponse.json({ error: "A unidade selecionada não existe ou está arquivada." }, { status: 400 });
    }

    const existingSnapshot = await dbAdmin.collection(COLLECTION)
      .where("unitId", "==", input.unitId)
      .get();
    const conflicting = existingSnapshot.docs.find((document) => {
      if (document.get("status") === "archived") return false;
      const validFrom = document.get("validFrom");
      const validUntil = document.get("validUntil");
      return typeof validFrom === "string"
        && typeof validUntil === "string"
        && collectiveAgreementPeriodsOverlap(input, { validFrom, validUntil });
    });
    if (conflicting) {
      return NextResponse.json(
        { error: "Já existe uma CCT ativa com vigência sobreposta para esta unidade. Arquive-a ou ajuste as datas." },
        { status: 409 },
      );
    }

    const now = Timestamp.now();
    const reference = dbAdmin.collection(COLLECTION).doc();
    const data = {
      ...input,
      notes: input.notes || null,
      unitName: String(unit.get("name") ?? ""),
      status: "active",
      createdAt: now,
      createdBy: access.decoded.uid,
      createdByName: access.actorName,
      updatedAt: now,
      updatedBy: access.decoded.uid,
      updatedByName: access.actorName,
    };
    await reference.set(data);
    return NextResponse.json(
      { agreement: { id: reference.id, ...(serializeHrValue(data) as Record<string, unknown>) } },
      { status: 201 },
    );
  } catch (cause) {
    return NextResponse.json(
      { error: message(cause, "Falha ao cadastrar a convenção coletiva.") },
      { status: 400 },
    );
  }
}
