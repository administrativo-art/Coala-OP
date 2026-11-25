import { getStorage } from "firebase-admin/storage";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
  addCompanySignerToAdmissionBundle,
  createAdmissionParticipantSignatureLink,
  generateSelectedSignatureDocuments,
  listSignatureWorkflow,
  prepareAdmissionSignaturePlacement,
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
import { signatureWorkflowAppError } from "@/features/hr/documents/signature-workflow-errors";
import { assertFormalizationAccess, serializeHrValue, type HrAccess } from "@/features/hr/lib/server-access";
import { hasFormalizationPermission, type FormalizationAction } from "@/lib/hr-formalization-permissions";
import { adminApp } from "@/lib/firebase-admin";
import { firebaseClientConfig } from "@/lib/firebase-client-config";
import { hrDbAdmin } from "@/lib/firebase-rh-admin";
import { AppError } from "@/lib/observability/app-error";
import { defineSecurityEnforcer } from "@/lib/security/enforcer";
import { defineSecurityContract } from "@/lib/security/route-contract";
import { secureRoute } from "@/lib/security/secure-route.server";
import { rethrowServerAuthenticationFailure } from "@/lib/server-authentication-failure";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Fluxo documental e de assinatura da admissão (migrado para `secureRoute` em 25/11/2026; antes era exceção
 * temporária). As permissões por ação são as mesmas de antes: ver assinaturas, gerar, revisar e enviar.
 */
const path = "/api/hr/onboarding/[id]/signature-documents" as const;
type RouteContext = { params: Promise<{ id: string }> };
type Resource = { workspaceId: string; onboardingId: string };

const idSchema = z.string().trim().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/);
const getQuerySchema = z.object({
  documentId: z.string().trim().min(1).max(200).regex(/^[A-Za-z0-9_-]+$/).optional(),
  download: z.enum(["generated", "preview", "signed"]).optional(),
  package: z.enum(["draft", "generated", "signed"]).optional(),
}).strict();
const action = <T extends string>(name: T) => z.object({ action: z.literal(name) }).strict();
const postSchema = z.discriminatedUnion("action", [
  action("generate"), action("approve"), action("request_changes"), action("prepare_positions"),
  action("add_company_signer"), action("reconcile"), action("preview_bundle"),
  z.object({ action: z.literal("set_family_salary_decision"), grant: z.boolean() }).strict(),
  z.object({ action: z.literal("select"), templateIds: z.array(z.string().trim().min(1).max(200)).max(100) }).strict(),
  z.object({ action: z.literal("save_positions"), layout: z.unknown() }).strict(),
  z.object({ action: z.literal("send"), expectedPackageHash: z.string().min(1).max(200) }).strict(),
  ...admissionSignatureParticipantActionSchema.options.map((option) => option.strict()),
]);
type PostInput = z.infer<typeof postSchema>;

/** Permissão exigida por ação (mesma tabela da rota anterior). */
function requiredAction(name: PostInput["action"]): FormalizationAction {
  if (["prepare_positions", "save_positions", "send", "add_company_signer", "resend_participant", "create_signature_link",
    "replace_participant_email"].includes(name)) return "signatures.send";
  if (name === "reconcile") return "signatures.view";
  if (name === "approve" || name === "request_changes") return "documents.review";
  return "documents.generate";
}

async function formalizationActor(request: NextRequest, needed: FormalizationAction) {
  try { return await assertFormalizationAccess(request, needed); }
  catch (cause) {
    if (cause instanceof Error && cause.message.startsWith("Sem permissão")) {
      throw new AppError({ code: "ADMISSION_SIGNATURE_FORBIDDEN", kind: "AUTHORIZATION", safeMessage: cause.message });
    }
    return rethrowServerAuthenticationFailure(cause);
  }
}

async function onboardingResource(context: RouteContext, actor: HrAccess): Promise<Resource> {
  const parsed = idSchema.safeParse((await context.params).id);
  if (!parsed.success) throw new AppError({ code: "ADMISSION_SIGNATURE_ID_INVALID", kind: "VALIDATION", safeMessage: "Processo inválido." });
  return { workspaceId: actor.workspaceId, onboardingId: parsed.data };
}

function contract(method: "GET" | "POST") {
  return defineSecurityContract({
    schemaVersion: 1, id: method === "GET" ? "hr.onboarding.signature-documents.read" : "hr.onboarding.signature-documents.action",
    version: 1, surface: { method, path }, exposure: "authenticated", identity: { kind: "active-user" },
    authorization: { kind: "custom", strategy: method === "GET" ? "hr-formalization-signatures-view" : "hr-formalization-signature-action" },
    resourceScope: { kind: "workspace" },
    input: { kind: "schema", schema: method === "GET" ? "hr.onboarding.signature-documents.query" : "hr.onboarding.signature-documents.action", unknownFields: "reject" },
    effects: method === "GET" ? { mode: "read", audit: "none" } : { mode: "external", audit: "server-authoritative" },
    errorExposure: "sanitized",
  });
}

const getEnforcer = defineSecurityEnforcer<NextRequest, RouteContext, unknown, HrAccess, z.infer<typeof getQuerySchema>, Resource>({
  id: "hr-onboarding-signature-documents-read-v1",
  guarantees: ["authenticated-user", "active-user", "authorization:hr-formalization-signatures-view", "workspace-scoped",
    "input-validated", "fields-allowlisted"],
  async enforce({ request, routeContext }) {
    const actor = await formalizationActor(request, "signatures.view");
    const parsed = getQuerySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams.entries()));
    if (!parsed.success) throw new AppError({ code: "ADMISSION_SIGNATURE_QUERY_INVALID", kind: "VALIDATION", safeMessage: "Consulta inválida." });
    return { actor, input: parsed.data, resource: await onboardingResource(routeContext, actor) };
  },
});

const postEnforcer = defineSecurityEnforcer<NextRequest, RouteContext, unknown, HrAccess, PostInput, Resource>({
  id: "hr-onboarding-signature-documents-action-v1",
  guarantees: ["authenticated-user", "active-user", "authorization:hr-formalization-signature-action", "workspace-scoped",
    "input-validated", "fields-allowlisted", "server-authoritative-audit"],
  async enforce({ request, routeContext }) {
    if (request.nextUrl.searchParams.size) throw new AppError({ code: "ADMISSION_SIGNATURE_QUERY_INVALID", kind: "VALIDATION", safeMessage: "Consulta inválida." });
    const parsed = postSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      throw new AppError({ code: "ADMISSION_SIGNATURE_ACTION_INVALID", kind: "VALIDATION", safeMessage: "Ação inválida ou dados incompletos." });
    }
    const actor = await formalizationActor(request, requiredAction(parsed.data.action));
    return { actor, input: parsed.data, resource: await onboardingResource(routeContext, actor) };
  },
});

function pdf(buffer: Uint8Array | Buffer, fileName: string, disposition: "inline" | "attachment", type = "application/pdf") {
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": type,
      "Content-Disposition": `${disposition}; filename*=UTF-8''${encodeURIComponent(fileName.replace(/[\r\n"]/g, ""))}`,
      "Cache-Control": "private, no-store",
    },
  });
}

function notFound(code: string, safeMessage: string) {
  return new AppError({ code, kind: "NOT_FOUND", safeMessage });
}

async function readStorage(storagePath: string) {
  const [buffer] = await getStorage(adminApp).bucket(firebaseClientConfig.storageBucket).file(storagePath).download();
  return buffer;
}

/** Falhas de negócio conhecidas chegam à tela; as demais viram erro inesperado com referência. */
async function guarded<T>(work: () => Promise<T>) {
  try { return await work(); }
  catch (cause) { throw signatureWorkflowAppError(cause) ?? cause; }
}

export const GET = secureRoute({ contract: contract("GET"), enforcer: getEnforcer }, async ({ security }) => guarded(async () => {
  const id = security.resource.onboardingId;
  const { documentId, download, package: packageFile } = security.input;
  if (packageFile) {
    const signatureRequest = await hrDbAdmin.collection("hrSignatureRequests").doc(`signature_bundle_${id}`).get();
    if (!signatureRequest.exists || signatureRequest.get("onboardingId") !== id) {
      throw notFound("ADMISSION_SIGNATURE_PACKAGE_NOT_FOUND", "Pacote de assinatura não encontrado.");
    }
    const signed = packageFile === "signed";
    const storagePath = signed ? signatureRequest.get("signedStoragePath") : signatureRequest.get("storagePath");
    if (typeof storagePath !== "string" || !storagePath.trim()) {
      throw notFound("ADMISSION_SIGNATURE_PACKAGE_UNAVAILABLE", signed ? "Pacote assinado ainda não disponível." : "Pacote ainda não disponível.");
    }
    const name = String(signatureRequest.get("documentName") ?? "Kit admissional");
    return pdf(await readStorage(storagePath), signed ? `${name} assinado.pdf` : `${name}.pdf`, "inline");
  }
  if (documentId && download) {
    const document = await hrDbAdmin.collection("hrSignatureDocuments").doc(documentId).get();
    if (!document.exists || document.get("onboardingId") !== id) throw notFound("ADMISSION_SIGNATURE_DOCUMENT_NOT_FOUND", "Documento não encontrado.");
    const storagePath = download === "signed" ? document.get("signedStoragePath")
      : download === "preview" ? document.get("generatedPdfStoragePath") : document.get("generatedStoragePath");
    if (typeof storagePath !== "string" || !storagePath.trim()) throw notFound("ADMISSION_SIGNATURE_FILE_UNAVAILABLE", "Arquivo ainda não disponível.");
    const buffer = await readStorage(storagePath);
    if (download === "signed") return pdf(buffer, `${document.get("documentName") ?? "Documento assinado"}.pdf`, "attachment");
    if (download === "preview") return pdf(buffer, `${document.get("documentName") ?? "Documento gerado"}.pdf`, "inline");
    return pdf(buffer, String(document.get("generatedFileName") ?? "documento.docx"), "attachment",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  }
  if (documentId || download) {
    throw new AppError({ code: "ADMISSION_SIGNATURE_QUERY_INVALID", kind: "VALIDATION", safeMessage: "Informe o documento e o formato." });
  }
  const access = security.actor;
  const includeSensitive = hasFormalizationPermission(access.permissions, "sensitiveData.view", access.isDefaultAdmin);
  return NextResponse.json(serializeHrValue(await listSignatureWorkflow(id, { includeSensitive })));
}));

export const POST = secureRoute({ contract: contract("POST"), enforcer: postEnforcer }, async ({ security }) => guarded(async () => {
  const onboardingId = security.resource.onboardingId;
  const input = security.input;
  const access = security.actor;
  const actor = { actorId: access.decoded.uid, actorName: access.actorName };
  const includeSensitive = hasFormalizationPermission(access.permissions, "sensitiveData.view", access.isDefaultAdmin);
  switch (input.action) {
    case "preview_bundle": {
      const preview = await previewAdmissionBundle({ onboardingId, ...actor });
      return pdf(preview.buffer, preview.fileName, "inline");
    }
    case "set_family_salary_decision":
      return NextResponse.json(serializeHrValue(await setAdmissionFamilySalaryDecision({ onboardingId, grant: input.grant, ...actor })));
    case "select":
      return NextResponse.json(serializeHrValue(await selectSignatureTemplates({ onboardingId, templateIds: input.templateIds, ...actor })));
    case "generate":
      return NextResponse.json(serializeHrValue(await generateSelectedSignatureDocuments({ onboardingId, includeSensitive, ...actor })));
    case "approve":
    case "request_changes":
      return NextResponse.json(serializeHrValue(await reviewSignaturePackage({ onboardingId, approved: input.action === "approve", ...actor })));
    case "prepare_positions":
      return NextResponse.json(serializeHrValue(await prepareAdmissionSignaturePlacement({ onboardingId, ...actor })));
    case "save_positions":
      return NextResponse.json(serializeHrValue(await saveAdmissionSignaturePlacement({ onboardingId, layout: input.layout, ...actor })));
    case "send":
      return NextResponse.json(serializeHrValue(await sendSignatureDocuments({ onboardingId, expectedPackageHash: input.expectedPackageHash, ...actor })));
    case "add_company_signer":
      return NextResponse.json(serializeHrValue(await addCompanySignerToAdmissionBundle({ onboardingId, ...actor })));
    case "reconcile":
      return NextResponse.json(serializeHrValue(await reconcileSignatureDocuments({ onboardingId, includeSensitive })));
    case "resend_participant":
      return NextResponse.json(serializeHrValue(await resendAdmissionParticipantSignature({ onboardingId,
        providerSignatureId: input.providerSignatureId, actionRequestId: input.actionRequestId, includeSensitive, ...actor })));
    case "create_signature_link":
      return NextResponse.json(serializeHrValue(await createAdmissionParticipantSignatureLink({ onboardingId,
        providerSignatureId: input.providerSignatureId, actionRequestId: input.actionRequestId, includeSensitive, ...actor })));
    case "replace_participant_email":
      return NextResponse.json(serializeHrValue(await replaceAdmissionParticipantEmail({ onboardingId,
        providerSignatureId: input.providerSignatureId, actionRequestId: input.actionRequestId, email: input.email, includeSensitive, ...actor })));
  }
}));
