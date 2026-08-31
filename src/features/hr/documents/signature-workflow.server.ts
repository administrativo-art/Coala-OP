import "server-only";

import { createHash } from "node:crypto";
import { Timestamp } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { PDFDocument } from "pdf-lib";

import { admissionClosingComponentsSummary } from "@/features/hr/documents/admission-closing-term";
import {
  admissionSignaturePackageTemplateIds,
  compareAdmissionSignatureOrder,
  isCompleteAdmissionSignaturePackage,
} from "@/features/hr/documents/admission-signature-order";
import {
  admissionSignatureLayoutSchema,
  autentiquePositionsForParty,
  defaultAdmissionSignatureLayout,
  normalizeAdmissionSignatureLayout,
  type AdmissionSignatureLayout,
  type AdmissionSignatureLayoutSigner,
  type AdmissionSignatureParticipant,
  type AdmissionSignatureParty,
} from "@/features/hr/documents/admission-signature-layout";
import { admissionBundleSignerPositions } from "@/features/hr/documents/admission-signature-positions";
import { resolveCompanyDocumentSignatory } from "@/features/hr/documents/company-document-signatory.server";
import type { DocumentPackageManifest } from "@/features/hr/documents/document-package-manifest";
import { composeDocumentPackage } from "@/features/hr/documents/document-pdf-composer.server";
import { generateDocumentFromTemplate } from "@/features/hr/documents/generate-document.server";
import {
  allocateDocumentProtocol,
  allocateIdempotentDocumentProtocol,
} from "@/features/hr/documents/document-protocol.server";
import { documentProtocolEntityFromSnapshot } from "@/features/hr/documents/document-protocol";
import {
  buildSignatureDocumentName,
  buildSignatureFileName,
} from "@/features/hr/documents/signature-document-name";
import {
  isSelectableAdmissionSignatureTemplate,
  SYSTEM_DOCUMENT_TEMPLATES,
  systemDocumentTemplateById,
} from "@/features/hr/documents/system-template-catalog";
import {
  effectiveSystemDocumentTemplates,
  systemTemplateWorkflowStatus,
} from "@/features/hr/documents/document-template-workflow.server";
import {
  addAutentiqueSigner,
  createAutentiqueDocument,
  getAutentiqueDocumentSignatures,
  getAutentiqueDocumentStatus,
  type AutentiqueCreatedDocument,
} from "@/lib/autentique.server";
import { adminApp, dbAdmin } from "@/lib/firebase-admin";
import { firebaseClientConfig } from "@/lib/firebase-client-config";
import { hrDbAdmin } from "@/lib/firebase-rh-admin";
import { getDocumentTypeConfig } from "@/lib/hr/employee-document-catalog";
import { resolveDocumentDestination } from "@/lib/hr/employee-document-distribution";
import { employeeCodeFrom, hashBuffer, loadExpectedIdentity } from "@/lib/hr/employee-document-identity";

const WORKFLOW_COLLECTION = "hrSignatureDocuments";
const REQUEST_COLLECTION = "hrSignatureRequests";
const SIGNED_COMPLETE_STATUSES = new Set([
  "signed",
  "signed_archived_pending_employee",
  "archived",
]);
const MAX_SIGNED_BYTES = 30 * 1024 * 1024;

type RecordValue = Record<string, unknown>;

function record(value: unknown): RecordValue {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as RecordValue)
    : {};
}

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function workflowId(onboardingId: string, templateId: string) {
  return createHash("sha256")
    .update(`signature-workflow:${onboardingId}:${templateId}`)
    .digest("hex")
    .slice(0, 40);
}

function employeeDocumentId(workflowDocumentId: string) {
  return createHash("sha256")
    .update(`signed-signature:${workflowDocumentId}`)
    .digest("hex")
    .slice(0, 32);
}

function generatedSignatureEmployeeDocumentId(generatedDocumentId: string) {
  return createHash("sha256")
    .update(`signed-generated-document:${generatedDocumentId}`)
    .digest("hex")
    .slice(0, 32);
}

function processEmployeeId(process: RecordValue) {
  return text(process.employeeId) ?? text(process.collaboratorUserId);
}

function transportVoucherAnswer(process: RecordValue) {
  return record(process.publicFormAnswers).wantsTransportVoucher;
}

function assertCompleteAdmissionPackage(
  process: RecordValue,
  templates: Array<{ templateId: unknown }>,
) {
  const templateIds = templates
    .map((template) => text(template.templateId))
    .filter((templateId): templateId is string => Boolean(templateId));
  if (!isCompleteAdmissionSignaturePackage(
    templateIds,
    transportVoucherAnswer(process),
  )) {
    throw new Error(
      "O kit admissional é indivisível. Gere, revise e envie todos os documentos aplicáveis em uma única operação.",
    );
  }
}

function nextLegacyStage(process: RecordValue, completedStage: string) {
  const stages = Array.isArray(process.stages)
    ? process.stages.map(record).sort((a, b) => Number(a.order ?? 0) - Number(b.order ?? 0))
    : [];
  const index = stages.findIndex((stage) => stage.id === completedStage);
  return index >= 0 ? text(stages[index + 1]?.id) : null;
}

function onboardingStatusForStage(stage: string | null) {
  if (stage === "formalization_validation") return "ready_to_create_user";
  if (stage === "integration" || stage === "probation") return "active";
  if (stage === "done") return "completed";
  return "contract_pending";
}

function maskedDocument(value: unknown) {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (digits.length === 11) return `***.${digits.slice(3, 6)}.${digits.slice(6, 9)}-**`;
  if (digits.length === 14) return `${digits.slice(0, 2)}.***.***/****-${digits.slice(-2)}`;
  return "";
}

function compareWorkflowDocuments(
  left: FirebaseFirestore.QueryDocumentSnapshot,
  right: FirebaseFirestore.QueryDocumentSnapshot,
) {
  return compareAdmissionSignatureOrder(
    {
      id: left.id,
      templateId: left.get("templateId"),
      templateName: left.get("templateName"),
      order: left.get("order"),
    },
    {
      id: right.id,
      templateId: right.get("templateId"),
      templateName: right.get("templateName"),
      order: right.get("order"),
    },
  );
}

function admissionSignatureRequestId(onboardingId: string) {
  return `signature_bundle_${onboardingId}`;
}

function admissionSourceFingerprint(
  targets: FirebaseFirestore.QueryDocumentSnapshot[],
) {
  return createHash("sha256")
    .update(JSON.stringify(targets.map((target) => ({
      id: target.id,
      generatedDocumentId: text(target.get("generatedDocumentId")),
      generatedPdfStoragePath: text(target.get("generatedPdfStoragePath")),
      templateVersion: Number(target.get("templateVersion") ?? 1),
    }))))
    .digest("hex");
}

function normalizedStoredSigners(value: unknown): AdmissionSignatureLayoutSigner[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item, index) => {
    const signer = record(item);
    const party = signer.party === "employee" || signer.party === "company"
      ? signer.party
      : index === 0
        ? "employee"
        : index === 1
          ? "company"
          : null;
    const name = text(signer.name);
    const email = text(signer.email)?.toLowerCase();
    return party && name && email ? [{ party, name, email }] : [];
  });
}

function providerParticipantStatus(
  signature: AutentiqueCreatedDocument["signatures"][number],
): AdmissionSignatureParticipant["status"] {
  if (signature.signed?.created_at) return "signed";
  if (signature.rejected?.created_at) return "rejected";
  if (signature.viewed?.created_at) return "viewed";
  if (signature.email_events?.refused) return "delivery_failed";
  return "sent";
}

function participantsFromProvider(params: {
  signatures: AutentiqueCreatedDocument["signatures"];
  signers: AdmissionSignatureLayoutSigner[];
  invitedAt: string;
  current?: unknown;
}) {
  const current = record(params.current);
  const participants: Record<string, AdmissionSignatureParticipant> = {};
  for (const signature of params.signatures) {
    const providerSignatureId = text(signature.public_id);
    const email = text(signature.email ?? signature.user?.email)?.toLowerCase();
    const signer = params.signers.find((candidate) => candidate.email === email);
    if (!providerSignatureId || !signer) continue;
    const previous = record(current[providerSignatureId]);
    const networkEvent = signature.signed ?? signature.rejected ?? signature.viewed;
    participants[providerSignatureId] = {
      party: signer.party,
      name: text(signature.name ?? signature.user?.name) ?? signer.name,
      email: email ?? signer.email,
      providerSignatureId,
      status: providerParticipantStatus(signature),
      invitedAt: text(previous.invitedAt) ?? params.invitedAt,
      emailSentAt: signature.email_events?.sent ?? text(previous.emailSentAt) ?? null,
      emailDeliveredAt: signature.email_events?.delivered ?? text(previous.emailDeliveredAt) ?? null,
      emailOpenedAt: signature.email_events?.opened ?? text(previous.emailOpenedAt) ?? null,
      viewedAt: signature.viewed?.created_at ?? text(previous.viewedAt) ?? null,
      signedAt: signature.signed?.created_at ?? text(previous.signedAt) ?? null,
      rejectedAt: signature.rejected?.created_at ?? text(previous.rejectedAt) ?? null,
      lastIp: networkEvent?.ip ?? text(previous.lastIp) ?? null,
      lastPort: networkEvent?.port
        ?? (typeof previous.lastPort === "number" ? previous.lastPort : null),
    };
  }
  return participants;
}

async function sendAdmissionBundle(params: {
  onboardingId: string;
  process: RecordValue;
  targets: FirebaseFirestore.QueryDocumentSnapshot[];
  expectedPackageHash: string;
  actorId: string;
  actorName: string;
  bucket: ReturnType<ReturnType<typeof getStorage>["bucket"]>;
}) {
  const requestRef = hrDbAdmin
    .collection(REQUEST_COLLECTION)
    .doc(admissionSignatureRequestId(params.onboardingId));
  const existing = await requestRef.get();
  const existingProviderDocumentId = text(existing.get("providerDocumentId"));
  if (existingProviderDocumentId) {
    const recoveredAt = new Date().toISOString();
    const batch = hrDbAdmin.batch();
    params.targets.forEach((target) => batch.set(target.ref, {
      status: text(existing.get("status")) ?? "sent",
      signatureRequestId: requestRef.id,
      packageId: existing.get("packageId") ?? null,
      packageProtocol: existing.get("protocol") ?? null,
      providerDocumentId: existingProviderDocumentId,
      providerSignatures: existing.get("providerSignatures") ?? [],
      emailStatus: "sent",
      sentAt: existing.get("sentAt") ?? existing.get("updatedAt") ?? recoveredAt,
      sandbox: existing.get("sandbox") ?? true,
      updatedAt: recoveredAt,
    }, { merge: true }));
    await batch.commit();
    return;
  }
  if (!existing.exists) {
    throw new Error("Configure as assinaturas e rubricas antes de enviar o pacote.");
  }
  const packageHash = text(existing.get("packageHash"));
  const storagePath = text(existing.get("storagePath"));
  const protocol = text(existing.get("protocol"));
  const packageId = text(existing.get("packageId"));
  if (!packageHash || !storagePath || !protocol || !packageId) {
    throw new Error("A preparação congelada do pacote está incompleta. Prepare o posicionamento novamente.");
  }
  if (!/^[a-f0-9]{64}$/i.test(params.expectedPackageHash)) {
    throw new Error("A versão do pacote não foi informada corretamente.");
  }
  if (params.expectedPackageHash !== packageHash) {
    throw new Error("O pacote mudou desde que o editor foi aberto. Reabra o posicionamento antes de enviar.");
  }
  if (text(existing.get("sourceFingerprint")) !== admissionSourceFingerprint(params.targets)) {
    throw new Error("Os documentos do pacote mudaram. Prepare o posicionamento novamente.");
  }
  if (!text(existing.get("placementConfiguredAt"))) {
    throw new Error("Confirme o posicionamento das assinaturas e rubricas antes do envio.");
  }
  const layout = normalizeAdmissionSignatureLayout(existing.get("placementLayout"));
  if (layout.packageHash !== packageHash) {
    throw new Error("O posicionamento não pertence ao PDF congelado para este envio.");
  }
  const storedSigners = normalizedStoredSigners(existing.get("signers"));
  if (storedSigners.length !== 2) {
    throw new Error("Os dois signatários do pacote precisam estar definidos antes do envio.");
  }
  const [buffer] = await params.bucket.file(storagePath).download();
  if (hashBuffer(buffer) !== packageHash) {
    throw new Error("O PDF congelado foi alterado depois do posicionamento. Prepare o pacote novamente.");
  }
  const signers = storedSigners.map((signer) => ({
    email: signer.email,
    name: signer.name,
    action: "SIGN" as const,
    positions: autentiquePositionsForParty(layout, signer.party),
  }));
  const now = new Date().toISOString();
  const sendAttemptId = createHash("sha256")
    .update(`${params.onboardingId}:${params.actorId}:${now}`)
    .digest("hex")
    .slice(0, 32);
  const claimed = await hrDbAdmin.runTransaction(async (transaction) => {
    const current = await transaction.get(requestRef);
    if (current.get("providerDocumentId")) return false;
    const sendingStartedAt = text(current.get("sendingStartedAt"));
    const activeSend = current.get("status") === "sending"
      && sendingStartedAt
      && Date.now() - new Date(sendingStartedAt).getTime() < 5 * 60_000;
    if (activeSend) {
      throw new Error("Este pacote já está sendo enviado. Aguarde a conclusão antes de tentar novamente.");
    }
    transaction.set(requestRef, {
      status: "sending",
      sendAttemptId,
      sendingStartedAt: now,
      error: null,
      updatedAt: now,
    }, { merge: true });
    return true;
  });
  if (!claimed) return;
  try {
    const created = await createAutentiqueDocument({
      buffer,
      fileName: `kit-admissional-${protocol}.pdf`,
      documentName: `Kit admissional ${protocol}`,
      message: "Confira o kit admissional completo e realize a assinatura eletrônica.",
      signers,
    });
    const sentAt = new Date().toISOString();
    const participants = participantsFromProvider({
      signatures: created.document.signatures,
      signers: storedSigners,
      invitedAt: sentAt,
    });
    await requestRef.set({
      status: "sent",
      sandbox: created.sandbox,
      providerDocumentId: created.document.id,
      providerCreatedAt: created.document.created_at,
      providerSignatures: created.document.signatures,
      participants,
      providerSignaturesCount: created.document.signatures.length,
      providerSignedCount: 0,
      sentAt,
      sentBy: params.actorId,
      sentByName: params.actorName,
      updatedAt: sentAt,
    }, { merge: true });
    const batch = hrDbAdmin.batch();
    params.targets.forEach((target) => batch.set(target.ref, {
      status: "sent",
      signatureRequestId: requestRef.id,
      packageId,
      packageProtocol: protocol,
      providerDocumentId: created.document.id,
      providerSignatures: created.document.signatures,
      emailStatus: "sent",
      sentAt,
      sentBy: params.actorId,
      sentByName: params.actorName,
      sandbox: created.sandbox,
      updatedAt: sentAt,
    }, { merge: true }));
    await batch.commit();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha ao enviar pacote ao Autentique.";
    const failedAt = new Date().toISOString();
    const batch = hrDbAdmin.batch();
    batch.set(requestRef, { status: "failed", error: message, updatedAt: failedAt }, { merge: true });
    params.targets.forEach((target) => batch.set(target.ref, {
      status: "send_failed",
      lastError: message,
      updatedAt: failedAt,
    }, { merge: true }));
    await batch.commit();
    throw error;
  }
}

async function prepareAdmissionBundle(params: {
  onboardingId: string;
  process: RecordValue;
  targets: FirebaseFirestore.QueryDocumentSnapshot[];
  actorId: string;
  actorName: string;
  bucket: ReturnType<ReturnType<typeof getStorage>["bucket"]>;
}) {
  const loaded = [];
  for (const target of params.targets) {
    const storagePath = text(target.get("generatedPdfStoragePath"));
    if (!storagePath) throw new Error(`O PDF oficial de ${target.get("templateName")} não foi gerado.`);
    const [buffer] = await params.bucket.file(storagePath).download();
    const pdf = await PDFDocument.load(buffer);
    const generatedId = text(target.get("generatedDocumentId"));
    const generated = generatedId
      ? await dbAdmin.collection("generatedDocuments").doc(generatedId).get()
      : null;
    loaded.push({
      target,
      buffer,
      pageCount: pdf.getPageCount(),
      sourceDocxHash: generated?.get("docxContentHash") ?? null,
      legalEntitySnapshot: generated?.get("legalEntitySnapshot") ?? null,
    });
  }
  let cursor = 1;
  const summary = admissionClosingComponentsSummary(loaded.map((item) => {
    const startPage = cursor;
    const endPage = startPage + item.pageCount - 1;
    cursor = endPage + 1;
    return {
      title: text(item.target.get("templateName")) ?? "Documento",
      startPage,
      endPage,
    };
  }));
  const closing = await generateDocumentFromTemplate({
    templateId: "system-admission-bundle-closing-term",
    employeeId: processEmployeeId(params.process),
    onboardingId: params.onboardingId,
    includeSensitive: true,
    manualValues: { bundle_components_summary: summary },
    lifecycle: "final",
    actorId: params.actorId,
    actorName: params.actorName,
  });
  if (!closing.pdfStoragePath) {
    throw new Error("O PDF do termo de encerramento não foi gerado.");
  }
  const [closingPdf] = await params.bucket.file(closing.pdfStoragePath).download();
  const packageId = createHash("sha256")
    .update(JSON.stringify([
      params.onboardingId,
      ...loaded.map((item) => [item.target.id, item.target.get("generatedDocumentId")]),
      closing.id,
    ]))
    .digest("hex");
  const legalEntity = record(loaded[0]?.legalEntitySnapshot);
  const components = [
    ...loaded.map((item) => ({
      componentId: item.target.id,
      title: text(item.target.get("templateName")) ?? "Documento",
      buffer: item.buffer,
      templateId: text(item.target.get("templateId")),
      templateVersion: Number(item.target.get("templateVersion") ?? 1),
      sourceDocxHash: text(item.sourceDocxHash),
      signatureScope: "bundle" as const,
    })),
    {
      componentId: `closing_${closing.id}`,
      title: "Termo de Encerramento, Ciência e Assinatura",
      buffer: closingPdf,
      templateId: "system-admission-bundle-closing-term",
      templateVersion: Number(closing.templateVersion ?? 2),
      sourceDocxHash: createHash("sha256").update(closing.buffer).digest("hex"),
      signatureScope: "bundle" as const,
    },
  ];
  const employeeCpf = record(params.process.publicFormAnswers).cpf;
  return {
    packageId,
    legalEntity,
    composition: {
      packageId,
      packageType: "admission" as const,
      title: `Kit admissional - ${text(params.process.candidateName) ?? "Colaborador"}`,
      parties: [
        {
          partyType: "employee" as const,
          role: "contracted" as const,
          ref: processEmployeeId(params.process),
          snapshot: {
            name: text(params.process.candidateName) ?? "Colaborador",
            documentMasked: maskedDocument(employeeCpf),
          },
        },
        {
          partyType: "company" as const,
          role: "contractor" as const,
          ref: text(legalEntity.entityId),
          snapshot: {
            name: text(legalEntity.legalName) ?? "Empresa",
            documentMasked: maskedDocument(legalEntity.cnpj),
          },
        },
      ],
      components,
      letterheadVersion: "coala-letterhead-v2",
    },
  };
}

async function admissionSignatureTargets(onboardingId: string, process: RecordValue) {
  const snapshot = await hrDbAdmin
    .collection(WORKFLOW_COLLECTION)
    .where("onboardingId", "==", onboardingId)
    .limit(30)
    .get();
  const selectedDocuments = snapshot.docs.filter(
    (document) => document.get("selected") === true,
  );
  assertCompleteAdmissionPackage(
    process,
    selectedDocuments.map((document) => ({ templateId: document.get("templateId") })),
  );
  const targets = selectedDocuments
    .filter((document) => document.get("signatureScope") !== "independent")
    .sort(compareWorkflowDocuments);
  if (!targets.length || targets.length !== selectedDocuments.length) {
    throw new Error("O kit admissional precisa formar um único pacote para assinatura.");
  }
  if (targets.some((document) => document.get("status") !== "ready_to_send")) {
    throw new Error("Revise o pacote completo antes de configurar as assinaturas.");
  }
  return targets;
}

export async function prepareAdmissionSignaturePlacement(params: {
  onboardingId: string;
  actorId: string;
  actorName: string;
}) {
  const process = await loadProcess(params.onboardingId);
  if (process.data.currentStage !== "signature_preparation") {
    throw new Error("O posicionamento só pode ser preparado antes do envio do kit.");
  }
  const recipient = text(process.data.candidateEmail)?.toLowerCase();
  if (!recipient || !/^\S+@\S+\.\S+$/.test(recipient)) {
    throw new Error("O titular não possui um e-mail válido.");
  }
  const targets = await admissionSignatureTargets(params.onboardingId, process.data);
  const sourceFingerprint = admissionSourceFingerprint(targets);
  const requestRef = hrDbAdmin
    .collection(REQUEST_COLLECTION)
    .doc(admissionSignatureRequestId(params.onboardingId));
  const existing = await requestRef.get();
  if (existing.get("providerDocumentId")) {
    throw new Error("O kit já foi enviado e não aceita um novo posicionamento.");
  }
  if (
    existing.exists
    && text(existing.get("sourceFingerprint")) === sourceFingerprint
    && text(existing.get("storagePath"))
    && text(existing.get("packageHash"))
    && existing.get("placementLayout")
  ) {
    return listSignatureWorkflow(params.onboardingId);
  }

  const bucket = getStorage(adminApp).bucket(firebaseClientConfig.storageBucket);
  const prepared = await prepareAdmissionBundle({
    onboardingId: params.onboardingId,
    process: process.data,
    targets,
    actorId: params.actorId,
    actorName: params.actorName,
    bucket,
  });
  const companySignatory = await resolveCompanyDocumentSignatory({
    entityId: prepared.legalEntity.entityId,
    cnpj: prepared.legalEntity.cnpj,
  });
  if (!companySignatory) {
    throw new Error(
      `Defina o signatário documental da empresa ${text(prepared.legalEntity.legalName) ?? "empregadora"} antes do envio.`,
    );
  }
  if (companySignatory.email.toLowerCase() === recipient) {
    throw new Error("O signatário da empresa precisa ser diferente do titular do kit.");
  }
  const protocol = await allocateIdempotentDocumentProtocol({
    entity: prepared.legalEntity.legalName ?? prepared.legalEntity.cnpj ?? "CS",
    type: "ADM",
    actorId: params.actorId,
    reservationKey: `admission:${params.onboardingId}:${sourceFingerprint}`,
  });
  const composed = await composeDocumentPackage({
    ...prepared.composition,
    protocol,
  });
  const packagePath = `signature-packages/${params.onboardingId}/${prepared.packageId}/pre-signature.pdf`;
  const manifestPath = `signature-packages/${params.onboardingId}/${prepared.packageId}/manifest.json`;
  await Promise.all([
    bucket.file(packagePath).save(composed.buffer, {
      resumable: false,
      metadata: { contentType: "application/pdf", cacheControl: "private, no-store" },
    }),
    bucket.file(manifestPath).save(Buffer.from(JSON.stringify(composed.manifest, null, 2)), {
      resumable: false,
      metadata: { contentType: "application/json", cacheControl: "private, no-store" },
    }),
  ]);
  const signers: AdmissionSignatureLayoutSigner[] = [
    {
      party: "employee",
      name: text(process.data.candidateName) ?? "Colaborador",
      email: recipient,
    },
    {
      party: "company",
      name: companySignatory.name,
      email: companySignatory.email.toLowerCase(),
    },
  ];
  const now = new Date().toISOString();
  await requestRef.set({
    type: "onboarding_document_package_signature",
    status: "placement_pending",
    provider: "autentique",
    onboardingId: params.onboardingId,
    employeeId: processEmployeeId(process.data),
    workflowDocumentIds: targets.map((target) => target.id),
    sourceFingerprint,
    packageId: prepared.packageId,
    protocol,
    storagePath: packagePath,
    manifestPath,
    manifest: composed.manifest,
    manifestHash: composed.manifestHash,
    preSignatureHash: composed.packageHash,
    packageHash: composed.packageHash,
    documentName: `Kit admissional ${protocol}`,
    signers,
    placementLayout: defaultAdmissionSignatureLayout({
      packageHash: composed.packageHash,
      pageCount: composed.pageCount,
    }),
    preparedAt: now,
    preparedBy: params.actorId,
    preparedByName: params.actorName,
    updatedAt: now,
  });
  return listSignatureWorkflow(params.onboardingId);
}

export async function saveAdmissionSignaturePlacement(params: {
  onboardingId: string;
  layout: unknown;
  actorId: string;
  actorName: string;
}) {
  const layout = normalizeAdmissionSignatureLayout(params.layout);
  const requestRef = hrDbAdmin
    .collection(REQUEST_COLLECTION)
    .doc(admissionSignatureRequestId(params.onboardingId));
  await hrDbAdmin.runTransaction(async (transaction) => {
    const request = await transaction.get(requestRef);
    if (!request.exists || request.get("onboardingId") !== params.onboardingId) {
      throw new Error("Prepare o pacote antes de salvar o posicionamento.");
    }
    if (request.get("providerDocumentId")) {
      throw new Error("O pacote já foi enviado e não aceita alteração de posições.");
    }
    const packageHash = text(request.get("packageHash"));
    const manifest = record(request.get("manifest"));
    if (
      !packageHash
      || layout.packageHash !== packageHash
      || layout.pageCount !== Number(manifest.totalPages ?? 0)
    ) {
      throw new Error("O posicionamento não corresponde ao PDF congelado para este envio.");
    }
    const now = new Date().toISOString();
    transaction.set(requestRef, {
      status: "placement_ready",
      placementLayout: layout,
      placementConfiguredAt: now,
      placementConfiguredBy: params.actorId,
      placementConfiguredByName: params.actorName,
      updatedAt: now,
    }, { merge: true });
  });
  return listSignatureWorkflow(params.onboardingId);
}

function admissionSignaturePackageState(
  request: FirebaseFirestore.DocumentSnapshot | null,
  includeSensitive: boolean,
) {
  if (!request?.exists) return null;
  const packageHash = text(request.get("packageHash"));
  const manifest = record(request.get("manifest"));
  const signers = normalizedStoredSigners(request.get("signers"));
  const storedParticipants = record(request.get("participants"));
  const providerSignatures = Array.isArray(request.get("providerSignatures"))
    ? request.get("providerSignatures") as AutentiqueCreatedDocument["signatures"]
    : [];
  const participantsById = Object.keys(storedParticipants).length
    ? storedParticipants
    : participantsFromProvider({
        signatures: providerSignatures,
        signers,
        invitedAt: text(request.get("sentAt")) ?? text(request.get("requestedAt")) ?? "",
      });
  const participants = Object.values(participantsById).flatMap((value) => {
    const participant = record(value);
    const providerSignatureId = text(participant.providerSignatureId);
    const email = text(participant.email)?.toLowerCase();
    const signer = signers.find((candidate) => candidate.email === email);
    const party: AdmissionSignatureParty | null = participant.party === "employee" || participant.party === "company"
      ? participant.party
      : signer?.party ?? null;
    const name = text(participant.name) ?? signer?.name;
    if (!providerSignatureId || !email || !party || !name) return [];
    return [{
      party,
      name,
      email,
      providerSignatureId,
      status: ["sent", "viewed", "signed", "rejected", "delivery_failed"].includes(String(participant.status))
        ? participant.status as AdmissionSignatureParticipant["status"]
        : "sent",
      invitedAt: text(participant.invitedAt),
      emailSentAt: text(participant.emailSentAt),
      emailDeliveredAt: text(participant.emailDeliveredAt),
      emailOpenedAt: text(participant.emailOpenedAt),
      viewedAt: text(participant.viewedAt),
      signedAt: text(participant.signedAt),
      rejectedAt: text(participant.rejectedAt),
      ...(includeSensitive ? {
        lastIp: text(participant.lastIp),
        lastPort: typeof participant.lastPort === "number" ? participant.lastPort : null,
      } : {}),
    }];
  }).sort((left, right) => (
    left.party === right.party ? 0 : left.party === "employee" ? -1 : 1
  ));
  const parsedLayout = admissionSignatureLayoutSchema.safeParse(request.get("placementLayout"));
  return {
    status: text(request.get("status")) ?? "unknown",
    sandbox: request.get("sandbox") === true,
    packageHash,
    pageCount: Number(manifest.totalPages ?? 0) || null,
    placementReady: Boolean(text(request.get("placementConfiguredAt"))),
    layout: parsedLayout.success ? parsedLayout.data : null,
    signers,
    participants,
  };
}

export async function listSignatureWorkflow(
  onboardingId: string,
  options: { includeSensitive?: boolean } = {},
) {
  const process = await loadProcess(onboardingId);
  const [workflowSnapshot, effectiveSystemTemplates, signatureRequest] = await Promise.all([
    hrDbAdmin
      .collection(WORKFLOW_COLLECTION)
      .where("onboardingId", "==", onboardingId)
      .limit(30)
      .get(),
    effectiveSystemDocumentTemplates(SYSTEM_DOCUMENT_TEMPLATES),
    hrDbAdmin
      .collection(REQUEST_COLLECTION)
      .doc(admissionSignatureRequestId(onboardingId))
      .get(),
  ]);
  const packageTemplateIds = new Set<string>(
    admissionSignaturePackageTemplateIds(transportVoucherAnswer(process.data)),
  );
  const systemTemplates = effectiveSystemTemplates
    .filter(isSelectableAdmissionSignatureTemplate)
    .filter((template) => packageTemplateIds.has(template.id))
    .map((template) => ({
      id: template.id,
      name: template.name,
      category: template.category,
      version: template.version,
      documentTypeCode: "ADMISSION_DOCUMENT",
      variables: template.variables,
      signatureScope: template.signatureScope,
    }));
  systemTemplates.sort(compareAdmissionSignatureOrder);
  const documents: Array<{ id: string } & RecordValue> = workflowSnapshot.docs
    .map((document): { id: string } & RecordValue => ({ id: document.id, ...record(document.data()) }))
    .sort(compareAdmissionSignatureOrder);
  return {
    templates: systemTemplates,
    documents,
    packageTemplateIds: systemTemplates.map((template) => template.id),
    signaturePackage: admissionSignaturePackageState(
      signatureRequest,
      options.includeSensitive === true,
    ),
  };
}

export async function selectSignatureTemplates(params: {
  onboardingId: string;
  templateIds: string[];
  actorId: string;
  actorName: string;
}) {
  const process = await loadProcess(params.onboardingId);
  if (process.data.currentStage !== "signature_preparation") {
    throw new Error("Os modelos só podem ser selecionados na etapa de preparação da assinatura.");
  }
  const uniqueIds = Array.from(new Set(params.templateIds.filter(Boolean)));
  assertCompleteAdmissionPackage(
    process.data,
    uniqueIds.map((templateId) => ({ templateId })),
  );
  const templateDocs = await Promise.all(uniqueIds.map(async (id) => {
    const system = systemDocumentTemplateById(id);
    const systemStatus = system ? await systemTemplateWorkflowStatus(system) : null;
    if (systemStatus === "published" && system?.sourceFormat === "docx") {
      return {
        id,
        version: system.version,
        name: system.name,
        category: system.category,
        documentTypeCode: "ADMISSION_DOCUMENT",
        signatureScope: system.signatureScope,
      };
    }
    return null;
  }));
  const templates = templateDocs
    .filter((template): template is NonNullable<typeof template> => Boolean(template))
    .sort(compareAdmissionSignatureOrder);
  if (templates.length !== uniqueIds.length) {
    throw new Error("Um dos modelos selecionados não está publicado.");
  }

  const existing = await hrDbAdmin
    .collection(WORKFLOW_COLLECTION)
    .where("onboardingId", "==", params.onboardingId)
    .limit(30)
    .get();
  const selected = new Set(uniqueIds);
  const existingByTemplate = new Map(
    existing.docs.map((document) => [String(document.get("templateId")), document])
  );
  const batch = hrDbAdmin.batch();
  const now = new Date().toISOString();
  existing.docs.forEach((document) => {
    if (selected.has(String(document.get("templateId")))) return;
    if (["sent", "viewed", "partially_signed", "signed", "archived"].includes(String(document.get("status")))) {
      return;
    }
    batch.set(document.ref, { selected: false, updatedAt: now }, { merge: true });
  });
  templates.forEach((template, index) => {
    const id = workflowId(params.onboardingId, template.id);
    const current = existingByTemplate.get(template.id);
    batch.set(
      hrDbAdmin.collection(WORKFLOW_COLLECTION).doc(id),
      {
        onboardingId: params.onboardingId,
        templateId: template.id,
        templateVersion: template.version,
        templateName: template.name,
        category: template.category,
        documentTypeCode: template.documentTypeCode,
        signatureScope: template.signatureScope,
        selected: true,
        required: true,
        order: index,
        status: current?.get("status") ?? "selected",
        selectedAt: now,
        selectedBy: params.actorId,
        selectedByName: params.actorName,
        updatedAt: now,
      },
      { merge: true }
    );
  });
  await batch.commit();
  return listSignatureWorkflow(params.onboardingId);
}

async function loadProcess(onboardingId: string) {
  const snapshot = await hrDbAdmin.collection("onboardingProcesses").doc(onboardingId).get();
  if (!snapshot.exists) throw new Error("Integração não encontrada.");
  return { ref: snapshot.ref, data: record(snapshot.data()) };
}

export async function previewAdmissionBundle(params: {
  onboardingId: string;
  actorId: string;
  actorName: string;
}) {
  const process = await loadProcess(params.onboardingId);
  if (process.data.currentStage !== "signature_preparation") {
    throw new Error("O pacote completo só pode ser visualizado durante a preparação da assinatura.");
  }
  const snapshot = await hrDbAdmin
    .collection(WORKFLOW_COLLECTION)
    .where("onboardingId", "==", params.onboardingId)
    .limit(30)
    .get();
  const selectedDocuments = snapshot.docs.filter(
    (document) => document.get("selected") === true,
  );
  assertCompleteAdmissionPackage(
    process.data,
    selectedDocuments.map((document) => ({ templateId: document.get("templateId") })),
  );
  const targets = selectedDocuments
    .filter((document) => document.get("signatureScope") !== "independent")
    .sort(compareWorkflowDocuments);
  if (!targets.length) {
    throw new Error("Selecione e gere ao menos um documento do pacote admissional.");
  }
  const unavailable = targets.find(
    (document) => !text(document.get("generatedPdfStoragePath")),
  );
  if (unavailable) {
    throw new Error(`Gere ${unavailable.get("templateName") ?? "todos os documentos"} antes de visualizar o pacote completo.`);
  }
  const prepared = await prepareAdmissionBundle({
    onboardingId: params.onboardingId,
    process: process.data,
    targets,
    actorId: params.actorId,
    actorName: params.actorName,
    bucket: getStorage(adminApp).bucket(firebaseClientConfig.storageBucket),
  });
  const composed = await composeDocumentPackage({
    ...prepared.composition,
    protocol: "ADM-PRÉVIA",
  });
  return {
    buffer: composed.buffer,
    fileName: `kit-admissional-${text(process.data.candidateName) ?? "colaborador"}.pdf`,
    pageCount: composed.pageCount,
    componentCount: composed.manifest.components.length,
  };
}

export async function generateSelectedSignatureDocuments(params: {
  onboardingId: string;
  includeSensitive: boolean;
  actorId: string;
  actorName: string;
}) {
  const process = await loadProcess(params.onboardingId);
  if (process.data.currentStage !== "signature_preparation") {
    throw new Error("Os documentos só podem ser gerados na etapa de preparação da assinatura.");
  }
  const snapshot = await hrDbAdmin
    .collection(WORKFLOW_COLLECTION)
    .where("onboardingId", "==", params.onboardingId)
    .limit(30)
    .get();
  const selectedDocuments = snapshot.docs.filter(
    (document) => document.get("selected") === true,
  );
  assertCompleteAdmissionPackage(
    process.data,
    selectedDocuments.map((document) => ({ templateId: document.get("templateId") })),
  );
  const targets = selectedDocuments
    .filter((document) =>
      !["sent", "viewed", "partially_signed", "signed", "archived"].includes(String(document.get("status")))
    )
    .sort(compareWorkflowDocuments);
  if (!targets.length) throw new Error("O pacote admissional não possui documentos disponíveis para geração.");

  for (const target of targets) {
    try {
      const templateId = String(target.get("templateId"));
      const generated = await generateDocumentFromTemplate({
        templateId,
        employeeId: processEmployeeId(process.data),
        onboardingId: params.onboardingId,
        includeSensitive: params.includeSensitive,
        lifecycle: "draft",
        actorId: params.actorId,
        actorName: params.actorName,
      });
      const documentName = buildSignatureDocumentName({
        documentType: target.get("templateName"),
        holderName: process.data.candidateName,
      });
      await target.ref.set(
        {
          status: generated.missingRequired.length || !generated.pdfStoragePath ? "generation_blocked" : "review_pending",
          documentName,
          generatedDocumentId: generated.id,
          generatedStoragePath: generated.storagePath,
          generatedPdfStoragePath: generated.pdfStoragePath,
          generatedFileName: buildSignatureFileName(documentName),
          missingRequired: generated.missingRequired,
          generatedAt: new Date().toISOString(),
          generatedBy: params.actorId,
          generatedByName: params.actorName,
          reviewStatus: "pending",
          lastError: generated.missingRequired.length
            ? `Variáveis obrigatórias ausentes: ${generated.missingRequired.join(", ")}`
            : !generated.pdfStoragePath
              ? "O conversor PDF não está disponível. O documento não pode seguir para assinatura."
              : null,
          updatedAt: new Date().toISOString(),
        },
        { merge: true }
      );
    } catch (error) {
      await target.ref.set(
        {
          status: "generation_failed",
          lastError: error instanceof Error ? error.message : "Falha ao gerar documento.",
          updatedAt: new Date().toISOString(),
        },
        { merge: true }
      );
    }
  }
  return listSignatureWorkflow(params.onboardingId);
}

export async function reviewSignaturePackage(params: {
  onboardingId: string;
  approved: boolean;
  actorId: string;
  actorName: string;
}) {
  const process = await loadProcess(params.onboardingId);
  if (process.data.currentStage !== "signature_preparation") {
    throw new Error("A revisão só pode ser feita na etapa de preparação da assinatura.");
  }
  const snapshot = await hrDbAdmin
    .collection(WORKFLOW_COLLECTION)
    .where("onboardingId", "==", params.onboardingId)
    .limit(30)
    .get();
  const targets = snapshot.docs
    .filter((document) => document.get("selected") === true)
    .sort(compareWorkflowDocuments);
  assertCompleteAdmissionPackage(
    process.data,
    targets.map((document) => ({ templateId: document.get("templateId") })),
  );
  const alreadySent = targets.find((document) =>
    [
      "sent",
      "viewed",
      "partially_signed",
      "signed",
      "signed_archived_pending_employee",
      "archived",
    ].includes(String(document.get("status")))
  );
  if (alreadySent) {
    throw new Error("O pacote já foi enviado e não pode voltar para revisão.");
  }
  const notGenerated = targets.find((document) => !document.get("generatedDocumentId"));
  if (notGenerated) {
    throw new Error("Gere o pacote completo antes da revisão.");
  }
  if (params.approved) {
    const incomplete = targets.find((document) => {
      const missing = Array.isArray(document.get("missingRequired"))
        ? document.get("missingRequired")
        : [];
      return missing.length > 0 || !document.get("generatedPdfStoragePath");
    });
    if (incomplete) {
      throw new Error(
        `O componente ${incomplete.get("templateName") ?? "do pacote"} ainda possui dados ou PDF pendentes.`,
      );
    }
  }
  const now = new Date().toISOString();
  if (params.approved) {
    for (const target of targets) {
      const generatedDocumentId = text(target.get("generatedDocumentId"));
      if (!generatedDocumentId) continue;
      const generatedRef = dbAdmin.collection("generatedDocuments").doc(generatedDocumentId);
      const generated = await generatedRef.get();
      if (generated.exists && generated.get("status") !== "final") {
        const protocol = typeof generated.get("protocol") === "string"
          ? generated.get("protocol")
          : await allocateDocumentProtocol({
            entity: documentProtocolEntityFromSnapshot(
              generated.get("legalEntitySnapshot"),
              generated.get("legalEntityId") ?? "CS",
            ),
            type: "DOC",
            actorId: params.actorId,
          });
        await generatedRef.set({
          status: "final",
          protocol,
          finalizedAt: Timestamp.now(),
          finalizedBy: params.actorId,
          finalizedByName: params.actorName,
        }, { merge: true });
      }
    }
  }
  const batch = hrDbAdmin.batch();
  targets.forEach((target) => batch.set(target.ref, {
      status: params.approved ? "ready_to_send" : "review_pending",
      reviewStatus: params.approved ? "approved" : "changes_requested",
      reviewedAt: now,
      reviewedBy: params.actorId,
      reviewedByName: params.actorName,
      updatedAt: now,
    }, { merge: true }));
  await batch.commit();
  return listSignatureWorkflow(params.onboardingId);
}

export async function sendSignatureDocuments(params: {
  onboardingId: string;
  expectedPackageHash: string;
  actorId: string;
  actorName: string;
}) {
  const process = await loadProcess(params.onboardingId);
  if (process.data.currentStage !== "signature_preparation") {
    throw new Error("O envio só pode ser feito após a preparação e revisão dos documentos.");
  }
  const recipient = text(process.data.candidateEmail)?.toLowerCase();
  if (!recipient || !/^\S+@\S+\.\S+$/.test(recipient)) {
    throw new Error("O titular não possui um e-mail válido.");
  }
  const snapshot = await hrDbAdmin
    .collection(WORKFLOW_COLLECTION)
    .where("onboardingId", "==", params.onboardingId)
    .limit(30)
    .get();
  const selectedDocuments = snapshot.docs.filter(
    (document) => document.get("selected") === true,
  );
  assertCompleteAdmissionPackage(
    process.data,
    selectedDocuments.map((document) => ({ templateId: document.get("templateId") })),
  );
  const targets = selectedDocuments
    .filter((document) => document.get("status") === "ready_to_send")
    .sort(compareWorkflowDocuments);
  if (targets.length !== selectedDocuments.length) {
    throw new Error("Revise o pacote completo antes de enviar para assinatura.");
  }
  const bucket = getStorage(adminApp).bucket(firebaseClientConfig.storageBucket);
  const bundleTargets = targets.filter((target) => target.get("signatureScope") !== "independent");
  const standaloneTargets = targets.filter((target) => target.get("signatureScope") === "independent");
  if (bundleTargets.length) {
    await sendAdmissionBundle({
      onboardingId: params.onboardingId,
      process: process.data,
      targets: bundleTargets,
      expectedPackageHash: params.expectedPackageHash,
      actorId: params.actorId,
      actorName: params.actorName,
      bucket,
    });
  }

  for (const target of standaloneTargets) {
    const requestRef = hrDbAdmin.collection(REQUEST_COLLECTION).doc(`signature_${target.id}`);
    const existing = await requestRef.get();
    if (existing.get("providerDocumentId")) continue;
    const generatedStoragePath = text(target.get("generatedPdfStoragePath"));
    if (!generatedStoragePath) throw new Error(`O PDF oficial de ${target.get("templateName")} não foi gerado.`);
    const [buffer] = await bucket.file(generatedStoragePath).download();
    const preSignatureHash = hashBuffer(buffer);
    const documentName = text(target.get("documentName")) ?? buildSignatureDocumentName({
      documentType: target.get("templateName"),
      holderName: process.data.candidateName,
    });
    const now = new Date().toISOString();
    await requestRef.set({
      type: "onboarding_document_signature",
      status: "sending",
      provider: "autentique",
      onboardingId: params.onboardingId,
      employeeId: processEmployeeId(process.data),
      workflowDocumentId: target.id,
      templateId: target.get("templateId"),
      generatedDocumentId: target.get("generatedDocumentId"),
      storagePath: generatedStoragePath,
      preSignatureHash,
      packageHash: preSignatureHash,
      documentName,
      documentTypeCode: target.get("documentTypeCode") ?? "UNKNOWN_DOCUMENT",
      signers: [{ email: recipient, action: "SIGN" }],
      requestedAt: now,
      requestedBy: params.actorId,
      requestedByName: params.actorName,
      updatedAt: now,
    });
    try {
      const created = await createAutentiqueDocument({
        buffer,
        fileName: buildSignatureFileName(documentName, "pdf"),
        documentName,
        message: "Confira o documento e realize a assinatura eletrônica.",
        signers: [{ email: recipient, action: "SIGN" }],
      });
      await requestRef.set({
        status: "sent",
        sandbox: created.sandbox,
        providerDocumentId: created.document.id,
        preSignatureHash,
        providerCreatedAt: created.document.created_at,
        providerSignatures: created.document.signatures,
        updatedAt: new Date().toISOString(),
      }, { merge: true });
      await target.ref.set({
        status: "sent",
        signatureRequestId: requestRef.id,
        providerDocumentId: created.document.id,
        providerSignatures: created.document.signatures,
        emailStatus: "sent",
        sentAt: new Date().toISOString(),
        sentBy: params.actorId,
        sentByName: params.actorName,
        sandbox: created.sandbox,
        updatedAt: new Date().toISOString(),
      }, { merge: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Falha ao enviar ao Autentique.";
      await requestRef.set({ status: "failed", error: message, updatedAt: new Date().toISOString() }, { merge: true });
      await target.ref.set({ status: "send_failed", lastError: message, updatedAt: new Date().toISOString() }, { merge: true });
      throw error;
    }
  }

  if (process.data.currentStage === "signature_preparation") {
    const hasSignatureStage = Array.isArray(process.data.stages) && process.data.stages
      .map(record)
      .some((stage) => stage.id === "signature");
    if (hasSignatureStage) {
      const stageStartedAt = new Date().toISOString();
      await process.ref.set({ currentStage: "signature", currentStageStartedAt: stageStartedAt, status: "contract_pending", updatedAt: stageStartedAt }, { merge: true });
    }
  }
  return listSignatureWorkflow(params.onboardingId);
}

export async function addCompanySignerToAdmissionBundle(params: {
  onboardingId: string;
  actorId: string;
  actorName: string;
}) {
  const process = await loadProcess(params.onboardingId);
  const requestRef = hrDbAdmin
    .collection(REQUEST_COLLECTION)
    .doc(`signature_bundle_${params.onboardingId}`);
  const [request, workflow] = await Promise.all([
    requestRef.get(),
    hrDbAdmin
      .collection(WORKFLOW_COLLECTION)
      .where("onboardingId", "==", params.onboardingId)
      .limit(30)
      .get(),
  ]);
  if (!request.exists || !text(request.get("providerDocumentId"))) {
    throw new Error("O kit ainda não foi enviado ao Autentique.");
  }
  const targets = workflow.docs.filter((document) => document.get("selected") === true);
  assertCompleteAdmissionPackage(
    process.data,
    targets.map((document) => ({ templateId: document.get("templateId") })),
  );
  const generatedDocumentId = text(targets[0]?.get("generatedDocumentId"));
  const generated = generatedDocumentId
    ? await dbAdmin.collection("generatedDocuments").doc(generatedDocumentId).get()
    : null;
  const legalEntity = record(generated?.get("legalEntitySnapshot"));
  const companySignatory = await resolveCompanyDocumentSignatory({
    entityId: legalEntity.entityId,
    cnpj: legalEntity.cnpj ?? process.data.employerCnpj,
  });
  if (!companySignatory) {
    throw new Error("Defina o signatário documental da empresa antes de incluí-lo no kit.");
  }
  const recipient = text(process.data.candidateEmail)?.toLowerCase();
  if (recipient === companySignatory.email) {
    throw new Error("O signatário da empresa precisa ser diferente do titular do kit.");
  }
  const providerDocumentId = text(request.get("providerDocumentId"))!;
  let provider = await getAutentiqueDocumentSignatures(providerDocumentId);
  if (provider.signedUrl) {
    throw new Error("O kit já foi concluído e não aceita outro signatário.");
  }
  const email = companySignatory.email.toLowerCase();
  const alreadyPresent = provider.signatures.some((signature) =>
    text(signature.email)?.toLowerCase() === email && signature.action?.name === "SIGN"
  );
  const manifest = request.get("manifest") as DocumentPackageManifest | undefined;
  const signer = {
    email,
    name: companySignatory.name,
    action: "SIGN" as const,
    ...(manifest ? { positions: admissionBundleSignerPositions(manifest, "company") } : {}),
  };
  const startedAt = new Date().toISOString();
  if (!alreadyPresent) {
    await requestRef.set({
      signatoryAddition: {
        status: "adding",
        email,
        name: companySignatory.name,
        requestedAt: startedAt,
        requestedBy: params.actorId,
        requestedByName: params.actorName,
      },
      updatedAt: startedAt,
    }, { merge: true });
    try {
      await addAutentiqueSigner({ documentId: providerDocumentId, signer });
      provider = await getAutentiqueDocumentSignatures(providerDocumentId);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Falha ao incluir o signatário da empresa.";
      await requestRef.set({
        signatoryAddition: {
          status: "failed",
          email,
          name: companySignatory.name,
          requestedAt: startedAt,
          failedAt: new Date().toISOString(),
          requestedBy: params.actorId,
          requestedByName: params.actorName,
          error: message,
        },
        updatedAt: new Date().toISOString(),
      }, { merge: true });
      throw cause;
    }
  }
  const confirmed = provider.signatures.some((signature) =>
    text(signature.email)?.toLowerCase() === email && signature.action?.name === "SIGN"
  );
  if (!confirmed) throw new Error("O Autentique não confirmou o signatário da empresa.");
  const currentSigners = Array.isArray(request.get("signers"))
    ? request.get("signers") as Array<Record<string, unknown>>
    : [];
  const signers = [
    ...currentSigners.filter((current) => text(current.email)?.toLowerCase() !== email),
    { ...signer, party: "company" as const },
  ];
  const completedAt = new Date().toISOString();
  const participants = participantsFromProvider({
    signatures: provider.signatures,
    signers: normalizedStoredSigners(signers),
    invitedAt: text(request.get("sentAt"))
      ?? text(request.get("requestedAt"))
      ?? completedAt,
    current: request.get("participants"),
  });
  const batch = hrDbAdmin.batch();
  batch.set(requestRef, {
    signers,
    providerSignatures: provider.signatures,
    participants,
    companySignatoryUserId: companySignatory.userId,
    companySignatoryName: companySignatory.name,
    companySignatoryEmail: email,
    signatoryAddition: {
      status: "completed",
      email,
      name: companySignatory.name,
      requestedAt: startedAt,
      completedAt,
      requestedBy: params.actorId,
      requestedByName: params.actorName,
    },
    updatedAt: completedAt,
  }, { merge: true });
  targets.forEach((target) => batch.set(target.ref, {
    providerSignatures: provider.signatures,
    companySignatoryName: companySignatory.name,
    companySignatoryEmail: email,
    updatedAt: completedAt,
  }, { merge: true }));
  await batch.commit();
  return listSignatureWorkflow(params.onboardingId);
}

export async function sendGeneratedDocumentForStandaloneSignature(params: {
  generatedDocumentId: string;
  actorId: string;
  actorName: string;
  recipient?: string | null;
}) {
  const generatedRef = dbAdmin.collection("generatedDocuments").doc(params.generatedDocumentId);
  const generated = await generatedRef.get();
  if (!generated.exists) throw new Error("Documento gerado não encontrado.");
  if (!["approved", "final"].includes(String(generated.get("status")))) {
    throw new Error("Aprove ou finalize o documento antes de enviá-lo para assinatura.");
  }
  if (generated.get("postAdmissionSignatureScope") !== "independent"
    && generated.get("signatureScope") !== "independent") {
    throw new Error("Este modelo não permite assinatura individual fora do fluxo de origem.");
  }
  const employeeId = text(generated.get("employeeId"));
  const employee = employeeId
    ? await dbAdmin.collection("users").doc(employeeId).get()
    : null;
  const generatedParties = await Promise.all((Array.isArray(generated.get("parties"))
    ? generated.get("parties") as unknown[]
    : [])
    .map(record)
    .map(async (party) => {
      const snapshot = record(party.snapshot);
      const partyType = String(party.partyType ?? "external_person");
      const companySignatory = ["company", "external_company"].includes(partyType)
        ? await resolveCompanyDocumentSignatory({
            entityId: party.ref,
          })
        : null;
      return {
        partyType,
        role: String(party.role ?? "recipient"),
        ref: text(party.ref),
        name: text(snapshot.name) ?? "Parte",
        documentMasked: text(snapshot.documentMasked) ?? "",
        signatureName: companySignatory?.name
          ?? text(snapshot.signatureName)
          ?? text(snapshot.name)
          ?? "Signatário",
        email: companySignatory?.email
          ?? text(snapshot.signatureEmail)?.toLowerCase()
          ?? null,
      };
    }));
  const explicitRecipient = text(params.recipient)?.toLowerCase();
  const fallbackEmployeeEmail = text(
    employee?.get("documentSignatureEmail")
    ?? employee?.get("email")
  )?.toLowerCase();
  const fallbackEmployeeName = text(
    employee?.get("documentSignatureName")
    ?? generated.get("employeeName")
    ?? employee?.get("username")
  ) ?? "Colaborador";
  const signerCandidates = explicitRecipient
    ? [{ email: explicitRecipient, name: fallbackEmployeeName }]
    : generatedParties.length
      ? generatedParties.map((party) => ({
          email: party.email,
          name: party.signatureName,
        }))
      : [{ email: fallbackEmployeeEmail, name: fallbackEmployeeName }];
  if (
    !signerCandidates.length
    || signerCandidates.some((candidate) =>
      !candidate.email || !/^\S+@\S+\.\S+$/.test(candidate.email)
    )
  ) {
    throw new Error("Informe um e-mail válido para cada signatário antes do envio.");
  }
  const signers = Array.from(new Map(
    signerCandidates.map((candidate) => [
      candidate.email!,
      {
        email: candidate.email!,
        name: candidate.name,
        action: "SIGN" as const,
      },
    ]),
  ).values());
  const sourcePath = text(generated.get("pdfStoragePath"));
  if (!sourcePath) throw new Error("O PDF oficial ainda não foi gerado.");
  const requestRef = hrDbAdmin.collection(REQUEST_COLLECTION)
    .doc(`signature_generated_${params.generatedDocumentId}`);
  const existing = await requestRef.get();
  if (existing.get("providerDocumentId")) {
    return { requestId: requestRef.id, status: existing.get("status"), reused: true };
  }

  const bucket = getStorage(adminApp).bucket(firebaseClientConfig.storageBucket);
  const [source] = await bucket.file(sourcePath).download();
  const protocol = text(generated.get("protocol")) ?? await allocateIdempotentDocumentProtocol({
    entity: documentProtocolEntityFromSnapshot(
      generated.get("legalEntitySnapshot"),
      generated.get("legalEntityId") ?? "CS",
    ),
    type: String(generated.get("templateId")).includes("receipt")
      ? "REC"
      : String(generated.get("templateId")).includes("transportation-voucher-waiver")
        ? "VTN"
        : "VT",
    actorId: params.actorId,
    reservationKey: `standalone:${params.generatedDocumentId}`,
  });
  const packageId = createHash("sha256")
    .update(`standalone:${params.generatedDocumentId}:${generated.get("docxContentHash") ?? ""}`)
    .digest("hex");
  const composed = await composeDocumentPackage({
    packageId,
    packageType: String(generated.get("templateId")).includes("receipt")
      ? "receipt"
      : "generic",
    protocol,
    title: text(generated.get("templateName")) ?? "Documento",
    parties: generatedParties.length
      ? generatedParties.map((party) => ({
          partyType: (
            ["employee", "company", "external_person", "external_company"].includes(party.partyType)
              ? party.partyType
              : "external_person"
          ) as "employee" | "company" | "external_person" | "external_company",
          role: (
            ["issuer", "recipient", "payer", "payee", "contractor", "contracted", "witness"].includes(party.role)
              ? party.role
              : "recipient"
          ) as "issuer" | "recipient" | "payer" | "payee" | "contractor" | "contracted" | "witness",
          ref: party.ref,
          snapshot: {
            name: party.name,
            documentMasked: party.documentMasked,
          },
        }))
      : [{
          partyType: "employee" as const,
          role: "recipient" as const,
          ref: employeeId,
          snapshot: {
            name: text(generated.get("employeeName"))
              ?? text(employee?.get("username"))
              ?? "Colaborador",
            documentMasked: "",
          },
        }],
    components: [{
      componentId: params.generatedDocumentId,
      title: text(generated.get("templateName")) ?? "Documento",
      buffer: source,
      templateId: text(generated.get("templateId")),
      templateVersion: Number(generated.get("templateVersion") ?? 1),
      sourceDocxHash: text(generated.get("docxContentHash")),
      signatureScope: "standalone",
    }],
    letterheadVersion: "coala-letterhead-v2",
  });
  const preSignaturePath = `signature-documents/${params.generatedDocumentId}/${packageId}/pre-signature.pdf`;
  const manifestPath = `signature-documents/${params.generatedDocumentId}/${packageId}/manifest.json`;
  await Promise.all([
    bucket.file(preSignaturePath).save(composed.buffer, {
      resumable: false,
      metadata: { contentType: "application/pdf", cacheControl: "private, no-store" },
    }),
    bucket.file(manifestPath).save(Buffer.from(JSON.stringify(composed.manifest, null, 2)), {
      resumable: false,
      metadata: { contentType: "application/json", cacheControl: "private, no-store" },
    }),
  ]);
  const now = new Date().toISOString();
  const documentName = `${text(generated.get("templateName")) ?? "Documento"} ${protocol}`;
  await requestRef.set({
    type: "generated_document_standalone_signature",
    status: "sending",
    provider: "autentique",
    generatedDocumentId: params.generatedDocumentId,
    employeeId: employeeId ?? null,
    templateId: generated.get("templateId") ?? null,
    documentTypeCode: generated.get("documentTypeCode") ?? "UNKNOWN_DOCUMENT",
    storagePath: preSignaturePath,
    manifestPath,
    manifest: composed.manifest,
    manifestHash: composed.manifestHash,
    packageId,
    protocol,
    preSignatureHash: composed.packageHash,
    packageHash: composed.packageHash,
    documentName,
    signers,
    requestedAt: now,
    requestedBy: params.actorId,
    requestedByName: params.actorName,
    updatedAt: now,
  });
  try {
    const created = await createAutentiqueDocument({
      buffer: composed.buffer,
      fileName: buildSignatureFileName(documentName, "pdf"),
      documentName,
      message: "Confira o documento e realize a assinatura eletrônica.",
      signers,
    });
    const sentAt = new Date().toISOString();
    await Promise.all([
      requestRef.set({
        status: "sent",
        sandbox: created.sandbox,
        providerDocumentId: created.document.id,
        providerCreatedAt: created.document.created_at,
        providerSignatures: created.document.signatures,
        updatedAt: sentAt,
      }, { merge: true }),
      generatedRef.set({
        status: "final",
        protocol,
        signatureStatus: "sent",
        signatureRequestId: requestRef.id,
        providerDocumentId: created.document.id,
        preSignatureHash: composed.packageHash,
        signatureSentAt: sentAt,
        signatureSentBy: params.actorId,
      }, { merge: true }),
    ]);
    return { requestId: requestRef.id, status: "sent", reused: false };
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "Falha ao enviar para assinatura.";
    await requestRef.set({ status: "failed", error: message, updatedAt: new Date().toISOString() }, { merge: true });
    throw cause;
  }
}

export async function reconcileGeneratedDocumentStandaloneSignature(
  generatedDocumentId: string,
) {
  const generatedRef = dbAdmin.collection("generatedDocuments").doc(generatedDocumentId);
  const generated = await generatedRef.get();
  if (!generated.exists) throw new Error("Documento gerado não encontrado.");
  const signatureRequestId = text(generated.get("signatureRequestId"));
  const providerDocumentId = text(generated.get("providerDocumentId"));
  if (!signatureRequestId || !providerDocumentId) {
    throw new Error("O documento ainda não possui solicitação de assinatura.");
  }
  const provider = await getAutentiqueDocumentStatus(providerDocumentId);
  const now = new Date().toISOString();
  if (provider.completed && provider.signedUrl) {
    await archiveAutentiqueSignedDocument({
      signatureRequestId,
      signedUrl: provider.signedUrl,
      signedAt: now,
      confirmedByEventId: `polling:${now}`,
    });
    return { status: "signed", reconciledAt: now };
  }
  const status = provider.signedCount > 0 ? "partially_signed" : "sent";
  await Promise.all([
    generatedRef.set({
      signatureStatus: status,
      providerSignaturesCount: provider.signaturesCount,
      providerSignedCount: provider.signedCount,
      signatureReconciledAt: now,
    }, { merge: true }),
    hrDbAdmin.collection(REQUEST_COLLECTION).doc(signatureRequestId).set({
      status,
      providerSignaturesCount: provider.signaturesCount,
      providerSignedCount: provider.signedCount,
      reconciledAt: now,
      updatedAt: now,
    }, { merge: true }),
  ]);
  return { status, reconciledAt: now };
}

export async function reconcileSignatureDocuments(params: {
  onboardingId: string;
  includeSensitive?: boolean;
}) {
  await loadProcess(params.onboardingId);
  const snapshot = await hrDbAdmin
    .collection(WORKFLOW_COLLECTION)
    .where("onboardingId", "==", params.onboardingId)
    .limit(30)
    .get();
  const targets = snapshot.docs.filter((document) => {
    const status = String(document.get("status") ?? "");
    return Boolean(text(document.get("providerDocumentId")))
      && !["archived", "signed_archived_pending_employee", "rejected", "expired", "cancelled"].includes(status);
  });
  const requests = new Map<string, {
    providerDocumentId: string;
    signatureRequestId: string;
    targets: FirebaseFirestore.QueryDocumentSnapshot[];
  }>();
  for (const target of targets) {
    const providerDocumentId = text(target.get("providerDocumentId"));
    const signatureRequestId = text(target.get("signatureRequestId"));
    if (!providerDocumentId || !signatureRequestId) continue;
    const key = `${signatureRequestId}:${providerDocumentId}`;
    const current = requests.get(key);
    if (current) current.targets.push(target);
    else requests.set(key, { providerDocumentId, signatureRequestId, targets: [target] });
  }
  const errors: Array<{ documentId: string; message: string }> = [];

  for (const request of requests.values()) {
    try {
      const requestRef = hrDbAdmin
        .collection(REQUEST_COLLECTION)
        .doc(request.signatureRequestId);
      const [provider, requestSnapshot] = await Promise.all([
        getAutentiqueDocumentSignatures(request.providerDocumentId),
        requestRef.get(),
      ]);
      const now = new Date().toISOString();
      const participants = participantsFromProvider({
        signatures: provider.signatures,
        signers: normalizedStoredSigners(requestSnapshot.get("signers")),
        invitedAt: text(requestSnapshot.get("sentAt"))
          ?? text(requestSnapshot.get("requestedAt"))
          ?? now,
        current: requestSnapshot.get("participants"),
      });
      if (provider.completed && provider.signedUrl) {
        await requestRef.set({
          providerSignatures: provider.signatures,
          providerSignaturesCount: provider.signaturesCount,
          providerSignedCount: provider.signedCount,
          participants,
          reconciledAt: now,
          updatedAt: now,
        }, { merge: true });
        await archiveAutentiqueSignedDocument({
          signatureRequestId: request.signatureRequestId,
          signedUrl: provider.signedUrl,
          signedAt: now,
          confirmedByEventId: `reconcile:${now}`,
        });
        continue;
      }
      const status = provider.signedCount > 0 ? "partially_signed" : "sent";
      const providerState = {
        status,
        providerSignaturesCount: provider.signaturesCount,
        providerSignedCount: provider.signedCount,
        providerSignatures: provider.signatures,
        participants,
        reconciledAt: now,
        updatedAt: now,
      };
      const batch = hrDbAdmin.batch();
      request.targets.forEach((target) => batch.set(target.ref, {
        status,
        providerSignaturesCount: provider.signaturesCount,
        providerSignedCount: provider.signedCount,
        providerSignatures: provider.signatures,
        reconciledAt: now,
        updatedAt: now,
      }, { merge: true }));
      batch.set(requestRef, providerState, { merge: true });
      await batch.commit();
    } catch (cause) {
      errors.push({
        documentId: request.targets[0]?.id ?? request.signatureRequestId,
        message: cause instanceof Error ? cause.message : "Falha ao reconciliar assinatura.",
      });
    }
  }

  return {
    ...(await listSignatureWorkflow(params.onboardingId, {
      includeSensitive: params.includeSensitive,
    })),
    reconciliation: {
      checked: requests.size,
      failed: errors.length,
      errors,
    },
  };
}

function allowedSignedUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && (
      url.hostname === "painel.autentique.com.br" ||
      url.hostname === "api.autentique.com.br" ||
      url.hostname === "storage.googleapis.com"
    );
  } catch {
    return false;
  }
}

async function downloadSignedPdf(url: string) {
  if (!allowedSignedUrl(url)) throw new Error("URL do documento assinado não autorizada.");
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000), cache: "no-store" });
  if (!response.ok) throw new Error(`Falha ao baixar PDF assinado (HTTP ${response.status}).`);
  const length = Number(response.headers.get("content-length") ?? 0);
  if (length > MAX_SIGNED_BYTES) throw new Error("PDF assinado excede 30 MB.");
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.byteLength > MAX_SIGNED_BYTES || buffer.subarray(0, 4).toString() !== "%PDF") {
    throw new Error("O arquivo assinado recebido não é um PDF válido.");
  }
  return buffer;
}

async function createEmployeeSignedDocument(params: {
  workflowDocumentId: string;
  workflow: RecordValue;
  process: RecordValue;
  employeeId: string;
  signedBuffer: Buffer;
  signedStoragePath: string;
}) {
  const documentId = employeeDocumentId(params.workflowDocumentId);
  const reference = hrDbAdmin.collection("employeeDocuments").doc(documentId);
  if ((await reference.get()).exists) return documentId;
  const config = getDocumentTypeConfig(text(params.workflow.documentTypeCode) ?? "UNKNOWN_DOCUMENT");
  const identity = await loadExpectedIdentity(params.employeeId);
  const employeeCode = employeeCodeFrom(identity, params.employeeId);
  const fields = {
    employeeName: text(params.process.candidateName),
    admissionDate: text(params.process.expectedAdmissionDate),
    startDate: text(params.process.expectedAdmissionDate),
  };
  const destination = resolveDocumentDestination({ config, employeeCode, fields, version: 1 });
  const now = Timestamp.now();
  await reference.set({
    employeeId: params.employeeId,
    candidateId: text(params.process.candidateId),
    category: config.category,
    documentType: text(params.workflow.templateName) ?? config.label,
    documentTypeCode: config.code,
    accessLevel: config.defaultAccessLevel,
    accessPolicyId: config.accessPolicyId,
    status: "validated",
    signatureRequired: true,
    signatureStatus: "signed",
    folderCode: destination.folderCode,
    caseId: destination.caseId,
    subcaseId: destination.subcaseId,
    destinationTrail: destination.pathSegments,
    displayName: text(params.workflow.documentName) ?? destination.displayName,
    storedName: buildSignatureFileName(text(params.workflow.documentName) ?? "Documento assinado", "pdf"),
    originalName: buildSignatureFileName(text(params.workflow.documentName) ?? "Documento assinado", "pdf"),
    mimeType: "application/pdf",
    size: params.signedBuffer.byteLength,
    contentHash: hashBuffer(params.signedBuffer),
    hashAlgorithm: "sha256",
    logicalKey: `${params.employeeId}:${config.code}:signature:${params.workflowDocumentId}`,
    version: 1,
    versionResolution: "NEW_DOCUMENT",
    storagePath: params.signedStoragePath,
    storageSubfolder: params.signedStoragePath.split("/versions/")[0],
    source: "autentique_signature",
    sourceOnboardingId: params.workflow.onboardingId,
    signatureRequestId: params.workflow.signatureRequestId,
    providerDocumentId: params.workflow.providerDocumentId,
    signedAt: params.workflow.signedAt ?? now,
    validatedBy: "system:autentique",
    validatedByName: "Autentique",
    validatedAt: now,
    uploadedAt: now,
    updatedAt: now,
    accessCount: 0,
    deletedAt: null,
  });
  await reference.collection("audit").add({
    action: "SIGNED_DOCUMENT_ARCHIVED",
    actorId: "system:autentique",
    actorName: "Autentique",
    onboardingId: params.workflow.onboardingId,
    workflowDocumentId: params.workflowDocumentId,
    at: now,
  });
  return documentId;
}

export async function advanceOnboardingAfterSignatures(onboardingId: string) {
  const process = await loadProcess(onboardingId);
  const documents = await hrDbAdmin.collection(WORKFLOW_COLLECTION)
    .where("onboardingId", "==", onboardingId)
    .limit(30)
    .get();
  const selected = documents.docs.filter((document) => document.get("selected") === true);
  if (!selected.length || !selected.every((document) => SIGNED_COMPLETE_STATUSES.has(String(document.get("status"))))) {
    return false;
  }
  const currentStage = text(process.data.currentStage);
  if (currentStage !== "signature" && currentStage !== "signature_preparation") return false;
  const nextStage = nextLegacyStage(process.data, "signature") ?? nextLegacyStage(process.data, currentStage);
  const stageStartedAt = new Date().toISOString();
  await process.ref.set({
    currentStage: nextStage ?? currentStage,
    ...(nextStage && nextStage !== currentStage ? { currentStageStartedAt: stageStartedAt } : {}),
    status: onboardingStatusForStage(nextStage),
    signatureWorkflow: {
      status: "completed",
      total: selected.length,
      completedAt: new Date().toISOString(),
    },
    updatedAt: stageStartedAt,
  }, { merge: true });
  return true;
}

export async function archiveAutentiqueSignedDocument(params: {
  signatureRequestId: string;
  signedUrl: string;
  signedAt?: string | null;
  confirmedByEventId?: string | null;
}) {
  const requestRef = hrDbAdmin.collection(REQUEST_COLLECTION).doc(params.signatureRequestId);
  const request = await requestRef.get();
  if (!request.exists) throw new Error("Solicitação de assinatura não encontrada.");
  if (Array.isArray(request.get("archivedDocumentIds"))) {
    return (request.get("archivedDocumentIds") as string[])[0] ?? null;
  }
  if (request.get("archivedDocumentId")) return request.get("archivedDocumentId") as string;
  const workflowDocumentIds: string[] = Array.isArray(request.get("workflowDocumentIds"))
    ? request.get("workflowDocumentIds").filter((value: unknown): value is string => typeof value === "string" && !!value)
    : [];
  const singleWorkflowId = text(request.get("workflowDocumentId"));
  if (singleWorkflowId && !workflowDocumentIds.includes(singleWorkflowId)) {
    workflowDocumentIds.push(singleWorkflowId);
  }
  const onboardingId = text(request.get("onboardingId"));
  const generatedDocumentId = text(request.get("generatedDocumentId"));
  if (!workflowDocumentIds.length || !onboardingId) {
    if (!generatedDocumentId) return null;
    const generatedRef = dbAdmin.collection("generatedDocuments").doc(generatedDocumentId);
    const generated = await generatedRef.get();
    if (!generated.exists) throw new Error("Documento gerado da solicitação não encontrado.");
    const signedBuffer = await downloadSignedPdf(params.signedUrl);
    const signedHash = hashBuffer(signedBuffer);
    const bucket = getStorage(adminApp).bucket(firebaseClientConfig.storageBucket);
    const signedStoragePath = `signed-documents/generated/${generatedDocumentId}/${params.signatureRequestId}/signed.pdf`;
    await bucket.file(signedStoragePath).save(signedBuffer, {
      resumable: false,
      metadata: {
        contentType: "application/pdf",
        cacheControl: "private, max-age=0, no-store",
        metadata: { generatedDocumentId, signatureRequestId: params.signatureRequestId },
      },
    });
    const employeeId = text(request.get("employeeId")) ?? text(generated.get("employeeId"));
    let archivedDocumentId: string | null = null;
    if (employeeId) {
      const config = getDocumentTypeConfig(
        text(request.get("documentTypeCode"))
        ?? text(generated.get("documentTypeCode"))
        ?? "UNKNOWN_DOCUMENT",
      );
      const identity = await loadExpectedIdentity(employeeId);
      const destination = resolveDocumentDestination({
        config,
        employeeCode: employeeCodeFrom(identity, employeeId),
        fields: { employeeName: text(generated.get("employeeName")) },
        version: 1,
      });
      archivedDocumentId = generatedSignatureEmployeeDocumentId(generatedDocumentId);
      const employeeDocumentRef = hrDbAdmin.collection("employeeDocuments").doc(archivedDocumentId);
      if (!(await employeeDocumentRef.get()).exists) {
        const now = Timestamp.now();
        await employeeDocumentRef.set({
          employeeId,
          category: config.category,
          documentType: text(generated.get("templateName")) ?? config.label,
          documentTypeCode: config.code,
          accessLevel: config.defaultAccessLevel,
          accessPolicyId: config.accessPolicyId,
          status: "validated",
          signatureRequired: true,
          signatureStatus: "signed",
          folderCode: destination.folderCode,
          caseId: destination.caseId,
          subcaseId: destination.subcaseId,
          destinationTrail: destination.pathSegments,
          displayName: text(request.get("documentName")) ?? destination.displayName,
          storedName: buildSignatureFileName(text(request.get("documentName")) ?? "Documento assinado", "pdf"),
          originalName: buildSignatureFileName(text(request.get("documentName")) ?? "Documento assinado", "pdf"),
          mimeType: "application/pdf",
          size: signedBuffer.byteLength,
          contentHash: signedHash,
          hashAlgorithm: "sha256",
          logicalKey: `${employeeId}:${config.code}:generated:${generatedDocumentId}`,
          version: 1,
          versionResolution: "NEW_DOCUMENT",
          storagePath: signedStoragePath,
          storageSubfolder: signedStoragePath.split("/signed.pdf")[0],
          source: "autentique_signature",
          sourceGeneratedDocumentId: generatedDocumentId,
          signatureRequestId: params.signatureRequestId,
          providerDocumentId: request.get("providerDocumentId") ?? null,
          signedAt: params.signedAt ?? now,
          validatedBy: "system:autentique",
          validatedByName: "Autentique",
          validatedAt: now,
          uploadedAt: now,
          updatedAt: now,
          accessCount: 0,
          deletedAt: null,
        });
      }
    }
    const archivedAt = new Date().toISOString();
    await Promise.all([
      generatedRef.set({
        status: "final",
        signatureStatus: "signed",
        archiveStatus: "archived",
        signedAt: params.signedAt ?? archivedAt,
        signedStoragePath,
        preSignatureHash: request.get("preSignatureHash") ?? null,
        signedHash,
        providerDocumentId: request.get("providerDocumentId") ?? null,
        confirmedByEventId: params.confirmedByEventId ?? null,
        employeeDocumentId: archivedDocumentId,
        archivedAt,
      }, { merge: true }),
      requestRef.set({
        status: "signed",
        signedAt: params.signedAt ?? archivedAt,
        signedStoragePath,
        signedHash,
        confirmedByEventId: params.confirmedByEventId ?? null,
        archivedDocumentId,
        archivedAt,
        updatedAt: archivedAt,
      }, { merge: true }),
    ]);
    return archivedDocumentId;
  }
  const workflowRefs: FirebaseFirestore.DocumentReference[] = workflowDocumentIds.map(
    (id: string) => hrDbAdmin.collection(WORKFLOW_COLLECTION).doc(id),
  );
  const [workflowSnapshots, process] = await Promise.all([
    Promise.all(workflowRefs.map((reference) => reference.get())),
    loadProcess(onboardingId),
  ]);
  if (workflowSnapshots.some((snapshot) => !snapshot.exists)) {
    throw new Error("Documento do fluxo de assinatura não encontrado.");
  }
  const buffer = await downloadSignedPdf(params.signedUrl);
  const signedHash = hashBuffer(buffer);
  const bucket = getStorage(adminApp).bucket(firebaseClientConfig.storageBucket);
  // O caminho físico usa apenas identificadores técnicos; o nome legível com o
  // titular fica nos metadados e no download, evitando PII no Storage path.
  const signedStoragePath = `signed-documents/${onboardingId}/${params.signatureRequestId}/signed.pdf`;
  await bucket.file(signedStoragePath).save(buffer, {
    resumable: false,
    metadata: {
      contentType: "application/pdf",
      cacheControl: "private, max-age=0, no-store",
      metadata: {
        onboardingId,
        signatureRequestId: params.signatureRequestId,
        workflowDocumentIds: workflowDocumentIds.join(","),
      },
    },
  });
  const signedAt = params.signedAt ?? new Date().toISOString();
  const employeeId = processEmployeeId(process.data);
  const archivedDocumentIds: string[] = [];
  if (employeeId) {
    for (const workflowSnapshot of workflowSnapshots) {
      const workflow = { id: workflowSnapshot.id, ...workflowSnapshot.data() } as RecordValue;
      archivedDocumentIds.push(await createEmployeeSignedDocument({
        workflowDocumentId: workflowSnapshot.id,
        workflow: { ...workflow, signedAt },
        process: process.data,
        employeeId,
        signedBuffer: buffer,
        // Todos os documentos lógicos apontam para o mesmo pacote assinado.
        signedStoragePath,
      }));
    }
  }
  const archivedAt = new Date().toISOString();
  const workflowBatch = hrDbAdmin.batch();
  workflowRefs.forEach((workflowRef: FirebaseFirestore.DocumentReference, index: number) => workflowBatch.set(workflowRef, {
    status: employeeId ? "archived" : "signed_archived_pending_employee",
    signedAt,
    signedStoragePath,
    signedFileUrl: params.signedUrl,
    preSignatureHash: request.get("preSignatureHash") ?? request.get("packageHash") ?? null,
    signedHash,
    signatureReportHash: request.get("signatureReportHash") ?? null,
    providerDocumentId: request.get("providerDocumentId") ?? null,
    confirmedByEventId: params.confirmedByEventId ?? null,
    employeeDocumentId: archivedDocumentIds[index] ?? null,
    packageId: request.get("packageId") ?? null,
    packageProtocol: request.get("protocol") ?? null,
    archivedAt,
    updatedAt: archivedAt,
  }, { merge: true }));
  await workflowBatch.commit();
  await requestRef.set({
    status: "signed",
    signedAt,
    signedStoragePath,
    preSignatureHash: request.get("preSignatureHash") ?? request.get("packageHash") ?? null,
    signedHash,
    signatureReportHash: request.get("signatureReportHash") ?? null,
    confirmedByEventId: params.confirmedByEventId ?? null,
    archivedDocumentId: archivedDocumentIds[0] ?? null,
    archivedDocumentIds,
    archivedAt,
    updatedAt: archivedAt,
  }, { merge: true });
  await advanceOnboardingAfterSignatures(onboardingId);
  return archivedDocumentIds[0] ?? null;
}

export async function promoteSignedOnboardingDocuments(params: {
  onboardingId: string;
  employeeId: string;
}) {
  const process = await loadProcess(params.onboardingId);
  const snapshot = await hrDbAdmin.collection(WORKFLOW_COLLECTION)
    .where("onboardingId", "==", params.onboardingId)
    .limit(30)
    .get();
  const bucket = getStorage(adminApp).bucket(firebaseClientConfig.storageBucket);
  const promoted: string[] = [];
  for (const workflowDocument of snapshot.docs) {
    if (!SIGNED_COMPLETE_STATUSES.has(String(workflowDocument.get("status")))) continue;
    if (workflowDocument.get("employeeDocumentId")) {
      promoted.push(String(workflowDocument.get("employeeDocumentId")));
      continue;
    }
    const sourcePath = text(workflowDocument.get("signedStoragePath"));
    if (!sourcePath) continue;
    const [buffer] = await bucket.file(sourcePath).download();
    const permanentPath = `hr/employee-documents/${params.employeeId}/documents/${employeeDocumentId(workflowDocument.id)}/versions/01/signed.pdf`;
    await bucket.file(sourcePath).copy(bucket.file(permanentPath));
    const workflow = { id: workflowDocument.id, ...workflowDocument.data() } as RecordValue;
    const documentId = await createEmployeeSignedDocument({
      workflowDocumentId: workflowDocument.id,
      workflow,
      process: process.data,
      employeeId: params.employeeId,
      signedBuffer: buffer,
      signedStoragePath: permanentPath,
    });
    await workflowDocument.ref.set({
      status: "archived",
      employeeId: params.employeeId,
      employeeDocumentId: documentId,
      promotedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }, { merge: true });
    const requestId = text(workflowDocument.get("signatureRequestId"));
    if (requestId) await hrDbAdmin.collection(REQUEST_COLLECTION).doc(requestId).set({ archivedDocumentId: documentId }, { merge: true });
    promoted.push(documentId);
  }
  return promoted;
}
