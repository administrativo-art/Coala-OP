import { NextRequest, NextResponse } from "next/server";
import { Timestamp } from "firebase-admin/firestore";

import {
  normalizeFieldMapping,
  pendingPlaceholders,
  suggestSystemKey,
} from "@/features/hr/documents/field-mapping";
import { assertFormalizationAccess, serializeHrValue } from "@/features/hr/lib/server-access";
import { dbAdmin } from "@/lib/firebase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const COLLECTION = "companyDocumentTemplates";

function error(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

function serializedObject(value: unknown): Record<string, unknown> {
  const serialized = serializeHrValue(value);
  return serialized && typeof serialized === "object" && !Array.isArray(serialized)
    ? (serialized as Record<string, unknown>)
    : {};
}

function templateVariables(document: FirebaseFirestore.DocumentSnapshot): string[] {
  const variables = document.get("variables");
  return Array.isArray(variables) ? variables.filter((item): item is string => typeof item === "string") : [];
}

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    await assertFormalizationAccess(request, "templates.view");
    const { id } = await context.params;
    const document = await dbAdmin.collection(COLLECTION).doc(id).get();
    if (!document.exists || document.get("deletedAt")) return error("Modelo não encontrado.", 404);
    const variables = templateVariables(document);
    const mapping = normalizeFieldMapping(document.get("fieldMapping"), variables);
    const pending = pendingPlaceholders(variables, mapping);
    const suggestions = Object.fromEntries(
      pending
        .map((placeholder) => [placeholder, suggestSystemKey(placeholder)] as const)
        .filter(([, suggestion]) => suggestion),
    );
    return NextResponse.json({
      template: { id, ...serializedObject(document.data()), fieldMapping: mapping },
      pending,
      suggestions,
    });
  } catch (cause) {
    return error(cause instanceof Error ? cause.message : "Acesso negado.", 403);
  }
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const reference = dbAdmin.collection(COLLECTION).doc(id);
    const document = await reference.get();
    if (!document.exists || document.get("deletedAt")) return error("Modelo não encontrado.", 404);
    const body = await request.json().catch(() => ({}));
    const access = await assertFormalizationAccess(
      request,
      body.status === "published" ? "templates.publish" : "templates.manage",
    );
    const variables = templateVariables(document);
    const update: Record<string, unknown> = {};

    if (typeof body.name === "string" && body.name.trim()) update.name = body.name.trim().slice(0, 160);
    if (typeof body.category === "string" && body.category.trim()) update.category = body.category.trim().slice(0, 80);

    const mapping = body.fieldMapping !== undefined
      ? normalizeFieldMapping(body.fieldMapping, variables)
      : normalizeFieldMapping(document.get("fieldMapping"), variables);
    const pending = pendingPlaceholders(variables, mapping);
    if (body.fieldMapping !== undefined) {
      update.fieldMapping = mapping;
      update.unknownVariables = pending;
    }

    if (body.status !== undefined) {
      if (body.status !== "draft" && body.status !== "published") return error("Status inválido.");
      if (body.status === "published") {
        if (typeof document.get("storagePath") !== "string") return error("Envie o arquivo DOCX antes de publicar.");
        if (pending.length) return error(`Defina a origem destes campos antes de publicar: ${pending.join(", ")}.`);
      }
      update.status = body.status;
    }

    if (!Object.keys(update).length) return error("Nada para atualizar.");
    update.updatedAt = Timestamp.now();
    update.updatedBy = access.decoded.uid;
    update.updatedByName = access.actorName;
    await reference.update(update);
    return NextResponse.json({
      template: { id, ...serializedObject({ ...document.data(), ...update }), fieldMapping: mapping },
      pending,
    });
  } catch (cause) {
    return error(cause instanceof Error ? cause.message : "Falha ao atualizar modelo.", 403);
  }
}
