import { getStorage } from "firebase-admin/storage";
import { NextRequest, NextResponse } from "next/server";

import {
  generateSelectedSignatureDocuments,
  listSignatureWorkflow,
  reconcileSignatureDocuments,
  reviewSignatureDocument,
  selectSignatureTemplates,
  sendSignatureDocuments,
} from "@/features/hr/documents/signature-workflow.server";
import { assertFormalizationAccess, serializeHrValue } from "@/features/hr/lib/server-access";
import { hasFormalizationPermission, type FormalizationAction } from "@/lib/hr-formalization-permissions";
import { adminApp } from "@/lib/firebase-admin";
import { firebaseClientConfig } from "@/lib/firebase-client-config";
import { hrDbAdmin } from "@/lib/firebase-rh-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function error(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    await assertFormalizationAccess(request, "signatures.view");
    const { id } = await context.params;
    const documentId = request.nextUrl.searchParams.get("documentId");
    const download = request.nextUrl.searchParams.get("download");
    if (documentId && download) {
      if (!["generated", "preview", "signed"].includes(download)) {
        return error("Formato de documento inválido.");
      }
      const document = await hrDbAdmin.collection("hrSignatureDocuments").doc(documentId).get();
      if (!document.exists || document.get("onboardingId") !== id) return error("Documento não encontrado.", 404);
      const path = download === "signed"
        ? document.get("signedStoragePath")
        : download === "preview"
          ? document.get("generatedPdfStoragePath")
          : document.get("generatedStoragePath");
      if (typeof path !== "string" || !path.trim()) return error("Arquivo ainda não disponível.", 404);
      const [buffer] = await getStorage(adminApp).bucket(firebaseClientConfig.storageBucket).file(path).download();
      const signed = download === "signed";
      const preview = download === "preview";
      const fileName = String(
        signed
          ? `${document.get("documentName") ?? "Documento assinado"}.pdf`
          : preview
            ? `${document.get("documentName") ?? "Documento gerado"}.pdf`
          : document.get("generatedFileName") ?? "documento.docx"
      ).replace(/[\r\n"]/g, "");
      return new NextResponse(new Uint8Array(buffer), {
        headers: {
          "Content-Type": signed || preview
            ? "application/pdf"
            : "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          "Content-Disposition": `${preview ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(fileName)}`,
          "Cache-Control": "private, no-store",
        },
      });
    }
    return NextResponse.json(serializeHrValue(await listSignatureWorkflow(id)));
  } catch (cause) {
    return error(cause instanceof Error ? cause.message : "Falha ao carregar documentos.", 403);
  }
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const body = record(await request.json().catch(() => null));
    const action = typeof body.action === "string" ? body.action : "";
    const requiredAction: FormalizationAction = action === "send"
      ? "signatures.send"
      : action === "reconcile"
        ? "signatures.view"
      : action === "approve" || action === "request_changes"
        ? "documents.review"
        : "documents.generate";
    const access = await assertFormalizationAccess(request, requiredAction);
    const includeSensitive = hasFormalizationPermission(access.permissions, "sensitiveData.view", access.isDefaultAdmin);
    let result;
    if (action === "select") {
      result = await selectSignatureTemplates({
        onboardingId: id,
        templateIds: stringArray(body.templateIds),
        actorId: access.decoded.uid,
        actorName: access.actorName,
      });
    } else if (action === "generate") {
      result = await generateSelectedSignatureDocuments({
        onboardingId: id,
        documentIds: stringArray(body.documentIds),
        includeSensitive,
        actorId: access.decoded.uid,
        actorName: access.actorName,
      });
    } else if (action === "approve" || action === "request_changes") {
      if (typeof body.documentId !== "string") return error("Documento não informado.");
      result = await reviewSignatureDocument({
        onboardingId: id,
        documentId: body.documentId,
        approved: action === "approve",
        actorId: access.decoded.uid,
        actorName: access.actorName,
      });
    } else if (action === "send") {
      result = await sendSignatureDocuments({
        onboardingId: id,
        documentIds: stringArray(body.documentIds),
        actorId: access.decoded.uid,
        actorName: access.actorName,
      });
    } else if (action === "reconcile") {
      result = await reconcileSignatureDocuments({ onboardingId: id });
    } else {
      return error("Ação inválida.");
    }
    return NextResponse.json(serializeHrValue(result));
  } catch (cause) {
    return error(cause instanceof Error ? cause.message : "Falha no fluxo documental.", 400);
  }
}
