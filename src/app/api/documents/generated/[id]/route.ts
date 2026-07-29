import { NextRequest, NextResponse } from "next/server";
import { Timestamp } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";

import { assertFormalizationAccess, serializeHrValue } from "@/features/hr/lib/server-access";
import { adminApp, dbAdmin } from "@/lib/firebase-admin";
import { firebaseClientConfig } from "@/lib/firebase-client-config";
import { allocateDocumentProtocol } from "@/features/hr/documents/document-protocol.server";
import { documentProtocolEntityFromSnapshot } from "@/features/hr/documents/document-protocol";
import { hasFormalizationPermission } from "@/lib/hr-formalization-permissions";
import {
  canTransitionGeneratedDocument,
  type GeneratedDocumentStatus,
} from "@/features/hr/documents/document-lifecycle";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function error(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

function serialized(id: string, data: unknown, includeSensitive = false) {
  const record = serializeHrValue(data);
  const value = record && typeof record === "object" && !Array.isArray(record) ? record as Record<string, unknown> : {};
  return {
    id,
    ...value,
    storagePath: undefined,
    pdfAvailable: !!value.pdfStoragePath,
    pdfStoragePath: undefined,
    manualValues: includeSensitive ? value.manualValues : undefined,
  };
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const access = await assertFormalizationAccess(request, "documents.review");
    const includeSensitive = hasFormalizationPermission(
      access.permissions,
      "sensitiveData.view",
      access.isDefaultAdmin,
    );
    const { id } = await context.params;
    const reference = dbAdmin.collection("generatedDocuments").doc(id);
    const document = await reference.get();
    if (!document.exists) return error("Documento gerado não encontrado.", 404);
    const body = await request.json().catch(() => ({}));
    if (!["approved", "final", "cancelled"].includes(body.status)) {
      return error("Estado solicitado não é suportado.");
    }
    const storedStatus = String(document.get("status") ?? "draft");
    const current: GeneratedDocumentStatus = storedStatus === "draft"
      ? "review_pending"
      : storedStatus as GeneratedDocumentStatus;
    const next = body.status as GeneratedDocumentStatus;
    if (!canTransitionGeneratedDocument(current, next)) {
      return error(`Não é possível alterar o documento de ${current} para ${next}.`);
    }
    if (current === next) return NextResponse.json({ document: serialized(id, document.data(), includeSensitive) });
    if (!document.get("pdfStoragePath")) {
      return error("O documento só pode ser aprovado ou finalizado depois da geração do PDF oficial.");
    }
    if (Array.isArray(document.get("missingRequired")) && document.get("missingRequired").length) {
      return error("O documento possui informações obrigatórias ausentes.");
    }
    const now = Timestamp.now();
    const update: Record<string, unknown> = next === "approved"
      ? {
        status: "approved",
        reviewedAt: now,
        reviewedBy: access.decoded.uid,
        reviewedByName: access.actorName,
      }
      : next === "cancelled"
        ? {
          status: "cancelled",
          cancelledAt: now,
          cancelledBy: access.decoded.uid,
          cancelledByName: access.actorName,
        }
        : {
          status: "final",
          protocol: typeof document.get("protocol") === "string"
            ? document.get("protocol")
            : await allocateDocumentProtocol({
              entity: documentProtocolEntityFromSnapshot(
                document.get("legalEntitySnapshot"),
                document.get("legalEntityId") ?? "CS",
              ),
              type: "DOC",
              actorId: access.decoded.uid,
            }),
          finalizedAt: now,
          finalizedBy: access.decoded.uid,
          finalizedByName: access.actorName,
        };
    await reference.update(update);
    return NextResponse.json({ document: serialized(id, { ...document.data(), ...update }, includeSensitive) });
  } catch (cause) {
    return error(cause instanceof Error ? cause.message : "Falha ao finalizar documento.", 403);
  }
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    await assertFormalizationAccess(request, "documents.review");
    const { id } = await context.params;
    const reference = dbAdmin.collection("generatedDocuments").doc(id);
    const document = await reference.get();
    if (!document.exists) return error("Documento gerado não encontrado.", 404);
    if (!["draft", "review_pending"].includes(String(document.get("status")))) {
      return error("Somente documentos em conferência podem ser descartados.");
    }
    const bucket = getStorage(adminApp).bucket(firebaseClientConfig.storageBucket);
    const paths = [document.get("storagePath"), document.get("pdfStoragePath")].filter(
      (path): path is string => typeof path === "string" && !!path,
    );
    await Promise.all(paths.map((path) => bucket.file(path).delete({ ignoreNotFound: true })));
    await reference.delete();
    return NextResponse.json({ ok: true });
  } catch (cause) {
    return error(cause instanceof Error ? cause.message : "Falha ao descartar documento.", 403);
  }
}
