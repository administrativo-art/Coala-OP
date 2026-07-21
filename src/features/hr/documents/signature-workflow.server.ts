import "server-only";

import { createHash } from "node:crypto";
import { Timestamp } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";

import { generateDocumentFromTemplate } from "@/features/hr/documents/generate-document.server";
import {
  buildSignatureDocumentName,
  buildSignatureFileName,
} from "@/features/hr/documents/signature-document-name";
import { createAutentiqueDocument } from "@/lib/autentique.server";
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

function processEmployeeId(process: RecordValue) {
  return text(process.employeeId) ?? text(process.collaboratorUserId);
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

export async function listSignatureWorkflow(onboardingId: string) {
  const [templatesSnapshot, workflowSnapshot] = await Promise.all([
    dbAdmin.collection("companyDocumentTemplates").get(),
    hrDbAdmin.collection(WORKFLOW_COLLECTION).where("onboardingId", "==", onboardingId).get(),
  ]);
  const templates = templatesSnapshot.docs
    .filter((document) => document.get("status") === "published" && !document.get("deletedAt"))
    .map((document) => ({
      id: document.id,
      name: text(document.get("name")) ?? "Modelo sem nome",
      category: text(document.get("category")) ?? "Outros",
      version: Number(document.get("version") ?? 1),
      documentTypeCode: text(document.get("documentTypeCode")) ?? "UNKNOWN_DOCUMENT",
      variables: Array.isArray(document.get("variables")) ? document.get("variables") : [],
    }))
    .sort((a, b) => `${a.category} ${a.name}`.localeCompare(`${b.category} ${b.name}`, "pt-BR"));
  const documents: Array<{ id: string } & RecordValue> = workflowSnapshot.docs
    .map((document): { id: string } & RecordValue => ({ id: document.id, ...record(document.data()) }))
    .sort((a, b) => Number(a.order ?? 0) - Number(b.order ?? 0));
  return { templates, documents };
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
  const uniqueIds = Array.from(new Set(params.templateIds.filter(Boolean))).slice(0, 30);
  const templateDocs = await Promise.all(
    uniqueIds.map((id) => dbAdmin.collection("companyDocumentTemplates").doc(id).get())
  );
  const templates = templateDocs.filter(
    (document) => document.exists && document.get("status") === "published" && !document.get("deletedAt")
  );
  if (templates.length !== uniqueIds.length) {
    throw new Error("Um dos modelos selecionados não está publicado.");
  }

  const existing = await hrDbAdmin
    .collection(WORKFLOW_COLLECTION)
    .where("onboardingId", "==", params.onboardingId)
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
        templateVersion: Number(template.get("version") ?? 1),
        templateName: text(template.get("name")) ?? "Documento",
        category: text(template.get("category")) ?? "Outros",
        documentTypeCode: text(template.get("documentTypeCode")) ?? "UNKNOWN_DOCUMENT",
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

export async function generateSelectedSignatureDocuments(params: {
  onboardingId: string;
  documentIds?: string[];
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
    .get();
  const targets = snapshot.docs.filter(
    (document) =>
      document.get("selected") === true &&
      (!params.documentIds?.length || params.documentIds.includes(document.id)) &&
      !["sent", "viewed", "partially_signed", "signed", "archived"].includes(String(document.get("status")))
  );
  if (!targets.length) throw new Error("Selecione ao menos um modelo para gerar.");

  for (const target of targets) {
    try {
      const templateId = String(target.get("templateId"));
      const generated = await generateDocumentFromTemplate({
        templateId,
        employeeId: processEmployeeId(process.data),
        onboardingId: params.onboardingId,
        includeSensitive: params.includeSensitive,
        actorId: params.actorId,
        actorName: params.actorName,
      });
      const documentName = buildSignatureDocumentName({
        documentType: target.get("templateName"),
        holderName: process.data.candidateName,
      });
      await target.ref.set(
        {
          status: generated.missingRequired.length ? "generation_blocked" : "review_pending",
          documentName,
          generatedDocumentId: generated.id,
          generatedStoragePath: generated.storagePath,
          generatedFileName: buildSignatureFileName(documentName),
          missingRequired: generated.missingRequired,
          generatedAt: new Date().toISOString(),
          generatedBy: params.actorId,
          generatedByName: params.actorName,
          reviewStatus: "pending",
          lastError: generated.missingRequired.length
            ? `Variáveis obrigatórias ausentes: ${generated.missingRequired.join(", ")}`
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

export async function reviewSignatureDocument(params: {
  onboardingId: string;
  documentId: string;
  approved: boolean;
  actorId: string;
  actorName: string;
}) {
  const process = await loadProcess(params.onboardingId);
  if (process.data.currentStage !== "signature_preparation") {
    throw new Error("A revisão só pode ser feita na etapa de preparação da assinatura.");
  }
  const reference = hrDbAdmin.collection(WORKFLOW_COLLECTION).doc(params.documentId);
  const snapshot = await reference.get();
  if (!snapshot.exists || snapshot.get("onboardingId") !== params.onboardingId) {
    throw new Error("Documento de assinatura não encontrado.");
  }
  if (!snapshot.get("generatedDocumentId")) throw new Error("Gere o documento antes da revisão.");
  const missing = Array.isArray(snapshot.get("missingRequired")) ? snapshot.get("missingRequired") : [];
  if (params.approved && missing.length) throw new Error("O documento possui variáveis obrigatórias ausentes.");
  if (["sent", "viewed", "partially_signed", "signed", "archived"].includes(String(snapshot.get("status")))) {
    throw new Error("O documento já foi enviado e não pode voltar para revisão.");
  }
  const now = new Date().toISOString();
  await reference.set(
    {
      status: params.approved ? "ready_to_send" : "review_pending",
      reviewStatus: params.approved ? "approved" : "changes_requested",
      reviewedAt: now,
      reviewedBy: params.actorId,
      reviewedByName: params.actorName,
      updatedAt: now,
    },
    { merge: true }
  );
  return listSignatureWorkflow(params.onboardingId);
}

export async function sendSignatureDocuments(params: {
  onboardingId: string;
  documentIds?: string[];
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
    .get();
  const targets = snapshot.docs.filter(
    (document) =>
      document.get("selected") === true &&
      document.get("status") === "ready_to_send" &&
      (!params.documentIds?.length || params.documentIds.includes(document.id))
  );
  if (!targets.length) throw new Error("Aprove ao menos um documento antes de enviar.");
  const bucket = getStorage(adminApp).bucket(firebaseClientConfig.storageBucket);

  for (const target of targets) {
    const requestRef = hrDbAdmin.collection(REQUEST_COLLECTION).doc(`signature_${target.id}`);
    const existing = await requestRef.get();
    if (existing.get("providerDocumentId")) continue;
    const generatedStoragePath = text(target.get("generatedStoragePath"));
    if (!generatedStoragePath) throw new Error(`Documento ${target.get("templateName")} não foi gerado.`);
    const [buffer] = await bucket.file(generatedStoragePath).download();
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
        fileName: buildSignatureFileName(documentName),
        documentName,
        message: "Confira o documento e realize a assinatura eletrônica.",
        signers: [{ email: recipient, action: "SIGN" }],
      });
      await requestRef.set({
        status: "sent",
        sandbox: created.sandbox,
        providerDocumentId: created.document.id,
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
      await process.ref.set({ currentStage: "signature", status: "contract_pending", updatedAt: new Date().toISOString() }, { merge: true });
    }
  }
  return listSignatureWorkflow(params.onboardingId);
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
    .get();
  const selected = documents.docs.filter((document) => document.get("selected") === true);
  if (!selected.length || !selected.every((document) => SIGNED_COMPLETE_STATUSES.has(String(document.get("status"))))) {
    return false;
  }
  const currentStage = text(process.data.currentStage);
  if (currentStage !== "signature" && currentStage !== "signature_preparation") return false;
  const nextStage = nextLegacyStage(process.data, "signature") ?? nextLegacyStage(process.data, currentStage);
  await process.ref.set({
    currentStage: nextStage ?? currentStage,
    status: onboardingStatusForStage(nextStage),
    signatureWorkflow: {
      status: "completed",
      total: selected.length,
      completedAt: new Date().toISOString(),
    },
    updatedAt: new Date().toISOString(),
  }, { merge: true });
  return true;
}

export async function archiveAutentiqueSignedDocument(params: {
  signatureRequestId: string;
  signedUrl: string;
  signedAt?: string | null;
}) {
  const requestRef = hrDbAdmin.collection(REQUEST_COLLECTION).doc(params.signatureRequestId);
  const request = await requestRef.get();
  if (!request.exists) throw new Error("Solicitação de assinatura não encontrada.");
  if (request.get("archivedDocumentId")) return request.get("archivedDocumentId") as string;
  const workflowDocumentId = text(request.get("workflowDocumentId"));
  const onboardingId = text(request.get("onboardingId"));
  if (!workflowDocumentId || !onboardingId) return null;
  const workflowRef = hrDbAdmin.collection(WORKFLOW_COLLECTION).doc(workflowDocumentId);
  const [workflowSnapshot, process] = await Promise.all([workflowRef.get(), loadProcess(onboardingId)]);
  if (!workflowSnapshot.exists) throw new Error("Documento do fluxo de assinatura não encontrado.");
  const workflow = { id: workflowSnapshot.id, ...workflowSnapshot.data() } as RecordValue;
  const buffer = await downloadSignedPdf(params.signedUrl);
  const bucket = getStorage(adminApp).bucket(firebaseClientConfig.storageBucket);
  // O caminho físico usa apenas identificadores técnicos; o nome legível com o
  // titular fica nos metadados e no download, evitando PII no Storage path.
  const signedStoragePath = `signed-documents/${onboardingId}/${params.signatureRequestId}/signed.pdf`;
  await bucket.file(signedStoragePath).save(buffer, {
    resumable: false,
    metadata: {
      contentType: "application/pdf",
      cacheControl: "private, max-age=0, no-store",
      metadata: { onboardingId, signatureRequestId: params.signatureRequestId, workflowDocumentId },
    },
  });
  const signedAt = params.signedAt ?? new Date().toISOString();
  const employeeId = processEmployeeId(process.data);
  let archivedDocumentId: string | null = null;
  if (employeeId) {
    const permanentPath = `hr/employee-documents/${employeeId}/documents/${employeeDocumentId(workflowDocumentId)}/versions/01/signed.pdf`;
    await bucket.file(signedStoragePath).copy(bucket.file(permanentPath));
    archivedDocumentId = await createEmployeeSignedDocument({
      workflowDocumentId,
      workflow: { ...workflow, signedAt },
      process: process.data,
      employeeId,
      signedBuffer: buffer,
      signedStoragePath: permanentPath,
    });
  }
  await workflowRef.set({
    status: archivedDocumentId ? "archived" : "signed_archived_pending_employee",
    signedAt,
    signedStoragePath,
    signedFileUrl: params.signedUrl,
    employeeDocumentId: archivedDocumentId,
    archivedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }, { merge: true });
  await requestRef.set({
    status: "signed",
    signedAt,
    signedStoragePath,
    archivedDocumentId,
    archivedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }, { merge: true });
  await advanceOnboardingAfterSignatures(onboardingId);
  return archivedDocumentId;
}

export async function promoteSignedOnboardingDocuments(params: {
  onboardingId: string;
  employeeId: string;
}) {
  const process = await loadProcess(params.onboardingId);
  const snapshot = await hrDbAdmin.collection(WORKFLOW_COLLECTION)
    .where("onboardingId", "==", params.onboardingId)
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
