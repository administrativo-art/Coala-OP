import { getStorage } from "firebase-admin/storage";
import { NextRequest, NextResponse } from "next/server";

import {
  addCompanySignerToAdmissionBundle,
  createAdmissionParticipantSignatureLink,
  generateSelectedSignatureDocuments,
  listSignatureWorkflow,
  prepareAdmissionSignaturePlacement,
  ParticipantActionUserError,
  previewAdmissionBundle,
  reconcileSignatureDocuments,
  replaceAdmissionParticipantEmail,
  resendAdmissionParticipantSignature,
  reviewSignaturePackage,
  saveAdmissionSignaturePlacement,
  selectSignatureTemplates,
  sendSignatureDocuments,
} from "@/features/hr/documents/signature-workflow.server";
import { admissionSignatureParticipantActionSchema } from "@/features/hr/documents/admission-signature-actions";
import { assertFormalizationAccess, serializeHrValue } from "@/features/hr/lib/server-access";
import { hasFormalizationPermission, type FormalizationAction } from "@/lib/hr-formalization-permissions";
import { adminApp } from "@/lib/firebase-admin";
import { firebaseClientConfig } from "@/lib/firebase-client-config";
import { hrDbAdmin } from "@/lib/firebase-rh-admin";
import { reportSystemError } from "@/lib/observability";

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
    const access = await assertFormalizationAccess(request, "signatures.view");
    const { id } = await context.params;
    const documentId = request.nextUrl.searchParams.get("documentId");
    const download = request.nextUrl.searchParams.get("download");
    const packageFile = request.nextUrl.searchParams.get("package");
    if (packageFile) {
      if (!["draft", "generated", "signed"].includes(packageFile)) {
        return error("Formato de pacote inválido.");
      }
      const signatureRequest = await hrDbAdmin
        .collection("hrSignatureRequests")
        .doc(`signature_bundle_${id}`)
        .get();
      if (!signatureRequest.exists || signatureRequest.get("onboardingId") !== id) {
        return error("Pacote de assinatura não encontrado.", 404);
      }
      const signed = packageFile === "signed";
      const path = signed
        ? signatureRequest.get("signedStoragePath")
        : signatureRequest.get("storagePath");
      if (typeof path !== "string" || !path.trim()) {
        return error(signed ? "Pacote assinado ainda não disponível." : "Pacote ainda não disponível.", 404);
      }
      const [buffer] = await getStorage(adminApp)
        .bucket(firebaseClientConfig.storageBucket)
        .file(path)
        .download();
      const fileName = String(
        signed
          ? `${signatureRequest.get("documentName") ?? "Kit admissional"} assinado.pdf`
          : `${signatureRequest.get("documentName") ?? "Kit admissional"}.pdf`,
      ).replace(/[\r\n"]/g, "");
      return new NextResponse(new Uint8Array(buffer), {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(fileName)}`,
          "Cache-Control": "private, no-store",
        },
      });
    }
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
    const includeSensitive = hasFormalizationPermission(
      access.permissions,
      "sensitiveData.view",
      access.isDefaultAdmin,
    );
    return NextResponse.json(serializeHrValue(await listSignatureWorkflow(id, { includeSensitive })));
  } catch (cause) {
    return error(cause instanceof Error ? cause.message : "Falha ao carregar documentos.", 403);
  }
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  let participantActionRequested = false;
  try {
    const { id } = await context.params;
    const body = record(await request.json().catch(() => null));
    const action = typeof body.action === "string" ? body.action : "";
    participantActionRequested = [
      "resend_participant",
      "create_signature_link",
      "replace_participant_email",
    ].includes(action);
    const requiredAction: FormalizationAction = [
      "prepare_positions",
      "save_positions",
      "send",
      "add_company_signer",
      "resend_participant",
      "create_signature_link",
      "replace_participant_email",
    ].includes(action)
      ? "signatures.send"
      : action === "reconcile"
        ? "signatures.view"
      : action === "approve" || action === "request_changes"
        ? "documents.review"
        : "documents.generate";
    const access = await assertFormalizationAccess(request, requiredAction);
    if (action === "preview_bundle") {
      const preview = await previewAdmissionBundle({
        onboardingId: id,
        actorId: access.decoded.uid,
        actorName: access.actorName,
      });
      const fileName = preview.fileName.replace(/[\r\n"]/g, "");
      return new NextResponse(new Uint8Array(preview.buffer), {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(fileName)}`,
          "Cache-Control": "private, no-store",
        },
      });
    }
    const includeSensitive = hasFormalizationPermission(access.permissions, "sensitiveData.view", access.isDefaultAdmin);
    const participantAction = [
      "resend_participant",
      "create_signature_link",
      "replace_participant_email",
    ].includes(action)
      ? admissionSignatureParticipantActionSchema.safeParse(body)
      : null;
    if (participantAction && !participantAction.success) {
      return error("Os dados da ação sobre o signatário são inválidos.");
    }
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
        includeSensitive,
        actorId: access.decoded.uid,
        actorName: access.actorName,
      });
    } else if (action === "approve" || action === "request_changes") {
      result = await reviewSignaturePackage({
        onboardingId: id,
        approved: action === "approve",
        actorId: access.decoded.uid,
        actorName: access.actorName,
      });
    } else if (action === "prepare_positions") {
      result = await prepareAdmissionSignaturePlacement({
        onboardingId: id,
        actorId: access.decoded.uid,
        actorName: access.actorName,
      });
    } else if (action === "save_positions") {
      result = await saveAdmissionSignaturePlacement({
        onboardingId: id,
        layout: body.layout,
        actorId: access.decoded.uid,
        actorName: access.actorName,
      });
    } else if (action === "send") {
      if (typeof body.expectedPackageHash !== "string") {
        return error("A versão do pacote não foi informada corretamente.");
      }
      result = await sendSignatureDocuments({
        onboardingId: id,
        expectedPackageHash: body.expectedPackageHash,
        actorId: access.decoded.uid,
        actorName: access.actorName,
      });
    } else if (action === "add_company_signer") {
      result = await addCompanySignerToAdmissionBundle({
        onboardingId: id,
        actorId: access.decoded.uid,
        actorName: access.actorName,
      });
    } else if (action === "reconcile") {
      result = await reconcileSignatureDocuments({ onboardingId: id, includeSensitive });
    } else if (participantAction?.success && participantAction.data.action === "resend_participant") {
      result = await resendAdmissionParticipantSignature({
        onboardingId: id,
        providerSignatureId: participantAction.data.providerSignatureId,
        actionRequestId: participantAction.data.actionRequestId,
        actorId: access.decoded.uid,
        actorName: access.actorName,
        includeSensitive,
      });
    } else if (participantAction?.success && participantAction.data.action === "create_signature_link") {
      result = await createAdmissionParticipantSignatureLink({
        onboardingId: id,
        providerSignatureId: participantAction.data.providerSignatureId,
        actionRequestId: participantAction.data.actionRequestId,
        actorId: access.decoded.uid,
        actorName: access.actorName,
        includeSensitive,
      });
    } else if (participantAction?.success && participantAction.data.action === "replace_participant_email") {
      result = await replaceAdmissionParticipantEmail({
        onboardingId: id,
        providerSignatureId: participantAction.data.providerSignatureId,
        actionRequestId: participantAction.data.actionRequestId,
        email: participantAction.data.email,
        actorId: access.decoded.uid,
        actorName: access.actorName,
        includeSensitive,
      });
    } else {
      return error("Ação inválida.");
    }
    return NextResponse.json(serializeHrValue(result));
  } catch (cause) {
    if (participantActionRequested) {
      if (cause instanceof ParticipantActionUserError) return error(cause.message, 400);
      const eventId = reportSystemError({
        error: cause,
        source: "api",
        operation: "admission-signature-participant-action",
        routeOrJob: "/api/hr/onboarding/[id]/signature-documents",
        code: "ADMISSION_SIGNATURE_PARTICIPANT_ACTION_FAILED",
        metadata: { onboardingId: (await context.params).id },
      }).eventId;
      return error(`Não foi possível concluir a ação sobre o signatário. Referência: ${eventId}.`, 500);
    }
    return error(cause instanceof Error ? cause.message : "Falha no fluxo documental.", 400);
  }
}
