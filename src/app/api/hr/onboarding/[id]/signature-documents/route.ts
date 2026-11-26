import { getStorage } from "firebase-admin/storage";
import { NextResponse, type NextRequest } from "next/server";
import { ZodError } from "zod";

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
  setAdmissionFamilySalaryDecision,
  selectSignatureTemplates,
  sendSignatureDocuments,
} from "@/features/hr/documents/signature-workflow.server";
import { admissionSignatureParticipantActionSchema } from "@/features/hr/documents/admission-signature-actions";
import { AdmissionDocumentError } from "@/features/hr/documents/admission-document-error";
import { assertFormalizationAccess, serializeHrValue, type HrAccess } from "@/features/hr/lib/server-access";
import { hasFormalizationPermission, type FormalizationAction } from "@/lib/hr-formalization-permissions";
import { adminApp } from "@/lib/firebase-admin";
import { firebaseClientConfig } from "@/lib/firebase-client-config";
import { hrDbAdmin } from "@/lib/firebase-rh-admin";
import { AppError, isAppError } from "@/lib/observability/app-error";
import { createStandardSecurityEnforcer, defineSecurityEnforcer } from "@/lib/security/enforcer";
import { toRouteAccessError } from "@/lib/security/route-access.server";
import { defineSecurityContract } from "@/lib/security/route-contract";
import { secureRoute } from "@/lib/security/secure-route.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

type RouteContext = { params: Promise<{ id: string }> };
type PostInput = { action: string; body: Record<string, unknown> };

const PARTICIPANT_ACTIONS = new Set(["resend_participant", "create_signature_link", "replace_participant_email"]);
const SEND_ACTIONS = new Set(["prepare_positions", "save_positions", "send", "add_company_signer", ...PARTICIPANT_ACTIONS]);

function requiredActionFor(action: string): FormalizationAction {
  if (SEND_ACTIONS.has(action)) return "signatures.send";
  if (action === "reconcile") return "signatures.view";
  return action === "approve" || action === "request_changes" ? "documents.review" : "documents.generate";
}

function requireAccess(request: NextRequest, action: FormalizationAction) {
  return assertFormalizationAccess(request, action).catch((cause) => { throw toRouteAccessError(cause, "ADMISSION_SIGNATURE"); });
}

function reject(message: string, kind: "VALIDATION" | "NOT_FOUND" = "VALIDATION"): never {
  throw new AppError({ code: kind === "NOT_FOUND" ? "ADMISSION_SIGNATURE_NOT_FOUND" : "ADMISSION_SIGNATURE_REJECTED", kind, safeMessage: message });
}

/** Mensagem de regra do kit: status 400, como antes, e continua no monitoramento (parte aponta falha de integridade). */
function asRuleResponse(cause: unknown) {
  // Formato inválido enviado pela tela (ex.: posicionamento) continua sendo erro do pedido, sem o detalhe interno.
  if (cause instanceof ZodError) {
    return new AppError({ code: "ADMISSION_SIGNATURE_INPUT_INVALID", kind: "VALIDATION", safeMessage: "Os dados enviados para esta ação são inválidos.", cause });
  }
  return cause instanceof AdmissionDocumentError
    ? new AppError({ code: "ADMISSION_DOCUMENT_REJECTED", kind: "VALIDATION", safeMessage: cause.message, reportable: true, cause })
    : cause;
}

async function assertAdmissionAvailable(id: string) {
  const process = await hrDbAdmin.collection("onboardingProcesses").doc(id).get();
  if (process.exists && (process.get("status") === "cancelled" || process.get("documentDiscard"))) {
    throw new AppError({ code: "ADMISSION_SIGNATURE_CLOSED", kind: "CONFLICT", safeMessage: "Esta admissão foi encerrada e seus documentos estão indisponíveis." });
  }
}

const readContract = defineSecurityContract({
  schemaVersion: 1,
  id: "hr.admission-signature-documents.read",
  version: 1,
  surface: { method: "GET", path: "/api/hr/onboarding/[id]/signature-documents" },
  exposure: "authenticated",
  identity: { kind: "active-user" },
  authorization: { kind: "permission", action: "hr.formalization.signatures-view" },
  // A rota não restringe por unidade: o contrato não declara escopo que não existe.
  resourceScope: { kind: "none" },
  input: { kind: "none" },
  effects: { mode: "read", audit: "none" },
  errorExposure: "sanitized",
});

const actionContract = defineSecurityContract({
  schemaVersion: 1,
  id: "hr.admission-signature-documents.act",
  version: 1,
  surface: { method: "POST", path: "/api/hr/onboarding/[id]/signature-documents" },
  exposure: "authenticated",
  identity: { kind: "active-user" },
  authorization: { kind: "custom", strategy: "admission-signature-action-permission" },
  resourceScope: { kind: "none" },
  input: { kind: "none" },
  effects: { mode: "external", audit: "none" },
  errorExposure: "sanitized",
});

export const GET = secureRoute({
  contract: readContract,
  enforcer: createStandardSecurityEnforcer<NextRequest, RouteContext, unknown, HrAccess>(readContract, {
    authenticate: ({ request }) => requireAccess(request, "signatures.view"),
    // `assertFormalizationAccess` já confere a permissão.
    authorize: () => undefined,
  }),
}, async ({ request, routeContext, security: { actor: access } }) => {
  try {
      const { id } = await routeContext.params;
      await assertAdmissionAvailable(id);
      const documentId = request.nextUrl.searchParams.get("documentId");
      const download = request.nextUrl.searchParams.get("download");
      const packageFile = request.nextUrl.searchParams.get("package");
      if (packageFile) {
        if (!["draft", "generated", "signed"].includes(packageFile)) {
          reject("Formato de pacote inválido.");
        }
        const signatureRequest = await hrDbAdmin
          .collection("hrSignatureRequests")
          .doc(`signature_bundle_${id}`)
          .get();
        if (!signatureRequest.exists || signatureRequest.get("onboardingId") !== id) {
          reject("Pacote de assinatura não encontrado.", "NOT_FOUND");
        }
        const signed = packageFile === "signed";
        const path = signed
          ? signatureRequest.get("signedStoragePath")
          : signatureRequest.get("storagePath");
        if (typeof path !== "string" || !path.trim()) {
          reject(signed ? "Pacote assinado ainda não disponível." : "Pacote ainda não disponível.", "NOT_FOUND");
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
          reject("Formato de documento inválido.");
        }
        const document = await hrDbAdmin.collection("hrSignatureDocuments").doc(documentId).get();
        if (!document.exists || document.get("onboardingId") !== id) reject("Documento não encontrado.", "NOT_FOUND");
        const path = download === "signed"
          ? document.get("signedStoragePath")
          : download === "preview"
            ? document.get("generatedPdfStoragePath")
            : document.get("generatedStoragePath");
        if (typeof path !== "string" || !path.trim()) reject("Arquivo ainda não disponível.", "NOT_FOUND");
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
    throw asRuleResponse(cause);
  }
});

/** A permissão exigida depende da ação, por isso o corpo é lido antes de conferi-la; nada é executado antes. */
const actionEnforcer = defineSecurityEnforcer<NextRequest, RouteContext, unknown, HrAccess, PostInput, undefined>({
  id: "admission-signature-action-v1",
  guarantees: ["authenticated-user", "active-user", "authorization:admission-signature-action-permission"],
  async enforce({ request }) {
    const body = record(await request.json().catch(() => null));
    const action = typeof body.action === "string" ? body.action : "";
    const actor = await requireAccess(request, requiredActionFor(action));
    return { actor, input: { action, body }, resource: undefined };
  },
});

export const POST = secureRoute({ contract: actionContract, enforcer: actionEnforcer }, async ({ routeContext, security: { actor: access, input: { action, body } } }) => {
  const { id } = await routeContext.params;
  try {
    await assertAdmissionAvailable(id);
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
    const participantAction = PARTICIPANT_ACTIONS.has(action)
      ? admissionSignatureParticipantActionSchema.safeParse(body)
      : null;
    if (participantAction && !participantAction.success) {
      reject("Os dados da ação sobre o signatário são inválidos.");
    }
    let result;
    if (action === "set_family_salary_decision") {
      if (typeof body.grant !== "boolean") reject("Informe a decisão sobre a concessão do salário-família.");
      result = await setAdmissionFamilySalaryDecision({
        onboardingId: id,
        grant: body.grant,
        actorId: access.decoded.uid,
        actorName: access.actorName,
      });
    } else if (action === "select") {
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
        reject("A versão do pacote não foi informada corretamente.");
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
      reject("Ação inválida.");
    }
    return NextResponse.json(serializeHrValue(result));
  } catch (cause) {
    if (!PARTICIPANT_ACTIONS.has(action)) throw asRuleResponse(cause);
    if (cause instanceof ParticipantActionUserError) reject(cause.message);
    if (isAppError(cause) && cause.kind === "VALIDATION") throw cause;
    // Falha do provedor ou interna: o usuário recebe o texto fixo; o detalhe vai só para o monitoramento.
    throw new AppError({
      code: "ADMISSION_SIGNATURE_PARTICIPANT_ACTION_FAILED",
      kind: "UNEXPECTED_APPLICATION",
      safeMessage: "Não foi possível concluir a ação sobre o signatário.",
      cause,
      metadata: { onboardingId: id },
    });
  }
});
