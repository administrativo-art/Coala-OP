import { createHash } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
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
import { applyCoalaLetterheadToPdf } from "@/features/hr/documents/letterhead-pdf.server";
import { convertDocxToPdf } from "@/features/hr/documents/pdf-converter.server";

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

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
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
    if (document.get("status") === "discarded") {
      return error("A prévia foi descartada e não possui mais um arquivo de origem.", 409);
    }
    if (typeof document.get("pdfStoragePath") === "string" && document.get("pdfStoragePath")) {
      return NextResponse.json({
        document: serialized(id, document.data(), includeSensitive),
        reused: true,
      });
    }
    const storagePath = document.get("storagePath");
    if (typeof storagePath !== "string" || !storagePath) {
      return error("O arquivo DOCX de origem não está disponível.", 409);
    }

    const bucket = getStorage(adminApp).bucket(firebaseClientConfig.storageBucket);
    const [docx] = await bucket.file(storagePath).download();
    const converted = await convertDocxToPdf(docx);
    if (!converted) {
      await reference.set({
        pdfGenerationStatus: "unavailable",
        pdfGenerationLastAttemptAt: Timestamp.now(),
      }, { merge: true });
      return error("O conversor de PDF está temporariamente indisponível. Tente novamente.", 503);
    }

    const pdf = await applyCoalaLetterheadToPdf(converted);
    const fileName = String(document.get("originalName") ?? "documento.docx")
      .replace(/\.docx$/i, ".pdf");
    const folder = storagePath.slice(0, storagePath.lastIndexOf("/"));
    const pdfStoragePath = `${folder}/${fileName}`;
    const now = Timestamp.now();
    const update = {
      pdfStoragePath,
      pdfContentHash: createHash("sha256").update(pdf).digest("hex"),
      pdfGenerationStatus: "ready",
      pdfGeneratedAt: now,
      pdfGenerationLastAttemptAt: now,
    };
    await Promise.all([
      bucket.file(pdfStoragePath).save(pdf, {
        resumable: false,
        metadata: {
          contentType: "application/pdf",
          cacheControl: "private, no-store",
        },
      }),
      reference.set(update, { merge: true }),
    ]);

    return NextResponse.json({
      document: serialized(id, { ...document.data(), ...update }, includeSensitive),
      reused: false,
    });
  } catch (cause) {
    return error(cause instanceof Error ? cause.message : "Falha ao gerar a prévia em PDF.", 403);
  }
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
    const access = await assertFormalizationAccess(request, "documents.review");
    const { id } = await context.params;
    const reference = dbAdmin.collection("generatedDocuments").doc(id);
    const document = await reference.get();
    if (!document.exists) return error("Documento gerado não encontrado.", 404);
    if (!["draft", "review_pending"].includes(String(document.get("status")))) {
      return error("Somente documentos em conferência podem ser descartados.");
    }
    if (document.get("legalHold") === true) {
      return error("O documento está sob retenção jurídica e não pode ser descartado.", 409);
    }
    const bucket = getStorage(adminApp).bucket(firebaseClientConfig.storageBucket);
    const paths = [document.get("storagePath"), document.get("pdfStoragePath")].filter(
      (path): path is string => typeof path === "string" && !!path,
    );
    await Promise.all(paths.map((path) => bucket.file(path).delete({ ignoreNotFound: true })));
    const now = Timestamp.now();
    const batch = dbAdmin.batch();
    batch.delete(reference.collection("audit").doc("resolvedValues"));
    batch.update(reference, {
      status: "discarded",
      archiveStatus: "disposed",
      discardedAt: now,
      discardedBy: access.decoded.uid,
      discardedByName: access.actorName,
      disposalReason: "user_discarded_preview",
      storagePath: FieldValue.delete(),
      pdfStoragePath: FieldValue.delete(),
      originalName: FieldValue.delete(),
      manualValues: FieldValue.delete(),
      parties: FieldValue.delete(),
      employeeId: FieldValue.delete(),
      employeeName: FieldValue.delete(),
      onboardingId: FieldValue.delete(),
      legalEntitySnapshot: FieldValue.delete(),
      missingRequired: FieldValue.delete(),
      disposedSensitiveValuesAt: now,
    });
    await batch.commit();
    return NextResponse.json({ ok: true });
  } catch (cause) {
    return error(cause instanceof Error ? cause.message : "Falha ao descartar documento.", 403);
  }
}
