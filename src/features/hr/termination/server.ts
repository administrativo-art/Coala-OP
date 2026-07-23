import "server-only";

import { createHash, randomBytes, randomUUID } from "node:crypto";
import { getStorage } from "firebase-admin/storage";
import type { NextRequest } from "next/server";

import { createManualTask } from "@/features/tasks/lib/server";
import { adminApp, authAdmin, dbAdmin } from "@/lib/firebase-admin";
import { firebaseClientConfig } from "@/lib/firebase-client-config";
import { hrDbAdmin } from "@/lib/firebase-rh-admin";
import { loadExpectedIdentity } from "@/lib/hr/employee-document-identity";
import { requireUser, type ServerUserContext } from "@/lib/auth-server";
import { createAutentiqueDocument, getAutentiqueDocumentStatus } from "@/lib/autentique.server";
import { getUserDisplayName } from "@/lib/user-display";
import { WORKSPACE_ID } from "@/lib/workspace";
import { EMAIL_SENDERS, sendEmail } from "@/lib/email/resend";
import { renderCoalaEmail } from "@/lib/email/template";
import { deletePdvLegalUser } from "@/lib/integrations/pdv-legal-admin";
import {
  buildProcessProjection,
  calculateMaterialDeadline,
  calculateNoticeDates,
  createInitialTerminationSteps,
  patchStep,
  recalculateTermination,
} from "./core";
import { buildTerminationRequestConfirmation } from "./request-document.server";
import type {
  CltTerminationProcess,
  TerminationDocument,
  TerminationEvent,
} from "./types";

const COLLECTION = "terminationProcesses";
const PROJECTION_COLLECTION = "processProjections";
const ALLOWED_LETTER_TYPES = new Set(["application/pdf", "image/jpeg", "image/png"]);
const MAX_LETTER_BYTES = 12 * 1024 * 1024;

function asString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function toIso(value: unknown) {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && typeof (value as { toDate?: () => Date }).toDate === "function") {
    return (value as { toDate: () => Date }).toDate().toISOString();
  }
  return value;
}

function serialize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(serialize);
  if (value && typeof value === "object") {
    if (typeof (value as { toDate?: () => Date }).toDate === "function") return toIso(value);
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, entry]) => [key, serialize(entry)]));
  }
  return value;
}

function normalizePhone(value: unknown) {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (digits.length === 13 && digits.startsWith("55")) return `+${digits}`;
  if (digits.length === 11) return `+55${digits}`;
  return null;
}

function maskPhone(value: string) {
  const digits = value.replace(/\D/g, "");
  return digits.length >= 4 ? `(**) *****-${digits.slice(-4)}` : "Número verificado";
}

function maskCpf(value: string | null | undefined) {
  const digits = String(value ?? "").replace(/\D/g, "");
  return digits.length === 11 ? `***.***.${digits.slice(6, 9)}-${digits.slice(9)}` : "***.***.***-**";
}

function safeFileName(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9._-]+/g, "-").slice(0, 120);
}

function processProtocol(now: Date) {
  const date = now.toISOString().slice(0, 10).replace(/-/g, "");
  return `PD-${date}-${randomBytes(3).toString("hex").toUpperCase()}`;
}

function canManage(context: ServerUserContext) {
  return context.isDefaultAdmin || context.permissions.settings.manageUsers || context.permissions.dp.collaborators.edit || context.permissions.dp.collaborators.terminate;
}

function canViewAll(context: ServerUserContext) {
  return canManage(context) || context.permissions.dp.view || (context.permissions.dp.collaborators.view && !context.permissions.dp.collaborators.ownProfileOnly);
}

export async function terminationContext(request: NextRequest) {
  return requireUser(request);
}

export function assertTerminationManager(context: ServerUserContext) {
  if (!canManage(context)) throw new Error("Sem permissão para gerenciar desligamentos.");
}

export async function getTermination(id: string) {
  const snapshot = await hrDbAdmin.collection(COLLECTION).doc(id).get();
  if (!snapshot.exists) return null;
  return recalculateTermination({ id: snapshot.id, ...(serialize(snapshot.data()) as Omit<CltTerminationProcess, "id">) } as CltTerminationProcess);
}

export async function assertTerminationVisible(context: ServerUserContext, process: CltTerminationProcess) {
  if (process.employeeId !== context.userDoc.id && !canViewAll(context)) {
    throw new Error("Sem permissão para visualizar este desligamento.");
  }
}

export async function listTerminations(context: ServerUserContext, scope: "all" | "mine" = "all") {
  if (scope === "mine" || !canViewAll(context)) {
    const snapshot = await hrDbAdmin.collection(COLLECTION).where("employeeId", "==", context.userDoc.id).get();
    const processes = snapshot.docs
      .map((doc) => recalculateTermination({ id: doc.id, ...(serialize(doc.data()) as Omit<CltTerminationProcess, "id">) } as CltTerminationProcess))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return Promise.all(processes.map((process) => reconcileTerminationProviderState(process).catch(() => process)));
  }
  const snapshot = await hrDbAdmin.collection(COLLECTION).orderBy("createdAt", "desc").get();
  const processes = snapshot.docs.map((doc) => recalculateTermination({ id: doc.id, ...(serialize(doc.data()) as Omit<CltTerminationProcess, "id">) } as CltTerminationProcess));
  return Promise.all(processes.map((process) => reconcileTerminationProviderState(process).catch(() => process)));
}

export async function reconcileTerminationProviderState(process: CltTerminationProcess) {
  if (process.status === "identity_pending" && process.request.providerDocumentId) {
    const provider = await getAutentiqueDocumentStatus(process.request.providerDocumentId);
    if (provider.completed && provider.signedUrl) return await markTerminationIdentitySigned({ terminationId: process.id, signedAt: new Date().toISOString(), signedUrl: provider.signedUrl }) ?? process;
  }
  if (["active", "closing_review"].includes(process.status)) {
    const requests = await hrDbAdmin.collection("hrSignatureRequests").where("terminationId", "==", process.id).where("purpose", "==", "termination_final_document").get();
    let current = process;
    for (const request of requests.docs) {
      if (["signed", "completed"].includes(String(request.get("status")))) continue;
      const providerDocumentId = asString(request.get("providerDocumentId"));
      const documentId = asString(request.get("terminationDocumentId"));
      if (!providerDocumentId || !documentId) continue;
      const provider = await getAutentiqueDocumentStatus(providerDocumentId);
      if (!provider.completed || !provider.signedUrl) continue;
      await request.ref.set({ status: "signed", signedAt: new Date().toISOString(), signedFileUrl: provider.signedUrl, updatedAt: new Date().toISOString() }, { merge: true });
      current = await markTerminationDocumentSigned({ terminationId: process.id, documentId, signedAt: new Date().toISOString(), signedUrl: provider.signedUrl }) ?? current;
    }
    return current;
  }
  return process;
}

export async function syncTerminationProjection(process: CltTerminationProcess) {
  const syncedAt = new Date().toISOString();
  const ref = dbAdmin.collection(PROJECTION_COLLECTION).doc(`termination:${process.id}`);
  const current = await ref.get();
  const version = Number(current.get("version") ?? 0) + 1;
  await ref.set(buildProcessProjection(process, version, syncedAt), { merge: true });
}

export async function saveTermination(process: CltTerminationProcess) {
  const recalculated = recalculateTermination(process);
  await hrDbAdmin.collection(COLLECTION).doc(process.id).set(recalculated, { merge: true });
  await syncTerminationProjection(recalculated).catch(async (error) => {
    await hrDbAdmin.collection(COLLECTION).doc(process.id).set({
      projectionSyncStatus: "failed",
      projectionSyncError: error instanceof Error ? error.message : "Falha de sincronização.",
      projectionSyncFailedAt: new Date().toISOString(),
    }, { merge: true });
  });
  return recalculated;
}

export async function appendTerminationEvent(id: string, event: Omit<TerminationEvent, "id">) {
  await hrDbAdmin.collection(COLLECTION).doc(id).collection("events").doc(randomUUID()).set(event);
}

export async function listTerminationEvents(id: string) {
  const snapshot = await hrDbAdmin.collection(COLLECTION).doc(id).collection("events").orderBy("at", "desc").limit(100).get();
  return snapshot.docs.map((doc) => ({ id: doc.id, ...(serialize(doc.data()) as Omit<TerminationEvent, "id">) }));
}

async function loadUnit(user: ServerUserContext["userDoc"]) {
  const unitId = user.unitIds?.[0] ?? user.assignedKioskIds?.[0] ?? null;
  if (!unitId) return { id: null, name: null, cnpj: null, address: null };
  const snapshot = await dbAdmin.collection("dp_units").doc(unitId).get();
  return {
    id: unitId,
    name: asString(snapshot.get("legalName")) ?? asString(snapshot.get("name")),
    cnpj: asString(snapshot.get("cnpj")),
    address: asString(snapshot.get("address")),
  };
}

async function findHrAssignee() {
  const profiles = await dbAdmin.collection("profiles").get();
  for (const profile of profiles.docs) {
    const permissions = profile.get("permissions") as Record<string, any> | undefined;
    if (permissions?.dp?.collaborators?.terminate || permissions?.dp?.collaborators?.edit || permissions?.settings?.manageUsers) {
      return profile.id;
    }
  }
  return null;
}

async function createHrTask(context: ServerUserContext, process: CltTerminationProcess, title: string, description: string, suffix: string, dueDate?: string) {
  const assigneeId = await findHrAssignee();
  if (!assigneeId) return null;
  return createManualTask({
    context,
    input: {
      title,
      description,
      assigneeType: "profile",
      assigneeId,
      priority: "high",
      dueDate,
      originLink: `/dashboard/dp/terminations/${process.id}`,
      origin: { kind: "manual", details: { processType: "termination", processId: process.id } },
      idempotencyKey: `termination-${process.id}-${suffix}`,
      visibilityScope: "project",
    },
  });
}

export async function createEmployeeResignationRequest(params: {
  context: ServerUserContext;
  file: File;
  noticePreference: "work" | "request_waiver";
  desiredLastDay?: string | null;
  notes?: string | null;
  appBaseUrl: string;
}) {
  const user = params.context.userDoc;
  if (user.employmentRelationshipType !== "clt" || user.isActive === false) {
    throw new Error("O pedido digital está disponível somente para vínculo CLT ativo.");
  }
  const phone = normalizePhone(user.phone);
  if (!phone || !user.phoneVerifiedAt) {
    throw new Error("Vincule e verifique seu celular antes de iniciar o pedido digital.");
  }
  if (!params.file || !ALLOWED_LETTER_TYPES.has(params.file.type)) {
    throw new Error("Envie a carta em PDF, JPG ou PNG.");
  }
  if (params.file.size <= 0 || params.file.size > MAX_LETTER_BYTES) {
    throw new Error("A carta deve ter no máximo 12 MB.");
  }
  const existing = await hrDbAdmin.collection(COLLECTION).where("employeeId", "==", user.id).get();
  if (existing.docs.some((doc) => !["completed", "cancelled"].includes(String(doc.get("status"))))) {
    throw new Error("Já existe um desligamento ativo para este colaborador.");
  }

  const identity = await loadExpectedIdentity(user.id);
  const cpf = String(identity?.cpf ?? "").replace(/\D/g, "");
  if (cpf.length !== 11) throw new Error("O CPF do colaborador precisa estar validado no cadastro do RH.");
  const unit = await loadUnit(user);
  const nowDate = new Date();
  const now = nowDate.toISOString();
  const processId = randomUUID();
  const protocol = processProtocol(nowDate);
  const originalBuffer = Buffer.from(await params.file.arrayBuffer());
  const originalHash = createHash("sha256").update(originalBuffer).digest("hex");
  const extension = params.file.type === "application/pdf" ? "pdf" : params.file.type === "image/png" ? "png" : "jpg";
  const letterStoragePath = `hr/termination/${processId}/request/original.${extension}`;
  const confirmationStoragePath = `hr/termination/${processId}/request/confirmation.pdf`;
  const bucket = getStorage(adminApp).bucket(firebaseClientConfig.storageBucket);
  const confirmation = await buildTerminationRequestConfirmation({
    protocol,
    employeeName: user.username,
    cpfMasked: maskCpf(cpf),
    companyName: unit.name ?? "Coala Shakes",
    submittedAt: now,
    noticePreference: params.noticePreference,
    desiredLastDay: params.desiredLastDay,
    originalHash,
    originalMimeType: params.file.type,
    originalBuffer,
  });
  const confirmationHash = createHash("sha256").update(confirmation).digest("hex");
  await Promise.all([
    bucket.file(letterStoragePath).save(originalBuffer, { resumable: false, metadata: { contentType: params.file.type, cacheControl: "private, no-store" } }),
    bucket.file(confirmationStoragePath).save(confirmation, { resumable: false, metadata: { contentType: "application/pdf", cacheControl: "private, no-store" } }),
  ]);

  let provider;
  try {
    provider = await createAutentiqueDocument({
      buffer: confirmation,
      fileName: `comprovante-${safeFileName(protocol)}.pdf`,
      documentName: `Pedido de demissão — ${user.username}`,
      message: "Confirme sua identidade por SMS, confira a carta anexada e assine o pedido de demissão.",
      signers: [{
        email: user.email,
        name: user.username,
        action: "SIGN",
        cpf,
        requireSmsVerificationPhone: phone,
      }],
    });
  } catch (error) {
    await Promise.all([
      bucket.file(letterStoragePath).delete({ ignoreNotFound: true }),
      bucket.file(confirmationStoragePath).delete({ ignoreNotFound: true }),
    ]);
    throw error;
  }

  const documents: TerminationDocument[] = [
    {
      id: randomUUID(), type: "resignation_letter", label: "Carta de pedido de demissão", fileName: safeFileName(params.file.name || `carta.${extension}`),
      mimeType: params.file.type, storagePath: letterStoragePath, contentHash: originalHash, visibility: "employee", auditStatus: "pending", uploadedAt: now, uploadedBy: user.id,
    },
    {
      id: randomUUID(), type: "request_confirmation", label: "Comprovante eletrônico do pedido", fileName: `comprovante-${protocol}.pdf`,
      mimeType: "application/pdf", storagePath: confirmationStoragePath, contentHash: confirmationHash, visibility: "employee", auditStatus: "pending", signatureRequired: true, uploadedAt: now, uploadedBy: user.id,
    },
  ];
  const signatureRequestRef = hrDbAdmin.collection("hrSignatureRequests").doc();
  const process: CltTerminationProcess = recalculateTermination({
    id: processId,
    processType: "clt_employee_resignation",
    employeeId: user.id,
    employeeName: user.username,
    employeeEmail: user.email,
    employeeCpfMasked: maskCpf(cpf),
    employeePhoneMasked: maskPhone(phone),
    employmentRelationshipType: "clt",
    unitId: unit.id,
    unitName: unit.name,
    jobRoleName: user.jobRoleName ?? null,
    status: "identity_pending",
    health: "on_track",
    progress: 0,
    currentSummary: "Confirmação de identidade",
    source: "employee_self_service",
    request: {
      noticePreference: params.noticePreference,
      desiredLastDay: params.desiredLastDay ?? null,
      notes: params.notes ?? null,
      submittedAt: now,
      protocol,
      identityStatus: "pending_signature",
      signatureRequestId: signatureRequestRef.id,
      providerDocumentId: provider.document.id,
    },
    accountant: { status: "not_started" },
    operational: { uniformsReturned: false, assetsReturned: false, scheduleRemoved: false, accessRevoked: false, benefitsClosed: false },
    accessRevocation: {
      pdv: { status: user.registrationIdPdv ? "pending" : "not_applicable", externalId: user.registrationIdPdv ?? null },
      bizneo: { status: user.registrationIdBizneo ? "pending" : "not_applicable", externalId: user.registrationIdBizneo ?? null },
      healthPlan: { status: "pending" },
      coalaOne: { status: "scheduled" },
    },
    documents,
    steps: createInitialTerminationSteps(now),
    nextDueAt: null,
    lastActivityAt: now,
    createdAt: now,
    updatedAt: now,
  });

  await Promise.all([
    hrDbAdmin.collection(COLLECTION).doc(processId).set(process),
    signatureRequestRef.set({
      terminationId: processId,
      purpose: "termination_request_identity",
      employeeId: user.id,
      status: "sent",
      provider: "autentique",
      providerDocumentId: provider.document.id,
      signerEmail: user.email,
      signerPhoneMasked: maskPhone(phone),
      documentStoragePath: confirmationStoragePath,
      documentHash: confirmationHash,
      sandbox: provider.sandbox,
      createdAt: now,
      updatedAt: now,
    }),
    appendTerminationEvent(processId, {
      type: "REQUEST_CREATED",
      at: now,
      actorId: user.id,
      actorName: getUserDisplayName(user, user.id),
      message: "Carta enviada e comprovante encaminhado para assinatura com validação por SMS.",
      data: { protocol, originalHash, signatureRequestId: signatureRequestRef.id },
    }),
  ]);
  await syncTerminationProjection(process);
  return { process, signatureUrl: provider.document.signatures[0]?.link?.short_link ?? null };
}

export async function markTerminationIdentitySigned(params: {
  terminationId: string;
  signedAt: string;
  signedUrl?: string | null;
}) {
  const process = await getTermination(params.terminationId);
  if (!process || process.request.identityStatus === "verified") return process;
  const now = params.signedAt || new Date().toISOString();
  let documents = process.documents;
  if (params.signedUrl) {
    const response = await fetch(params.signedUrl, { signal: AbortSignal.timeout(30_000), cache: "no-store" });
    if (response.ok) {
      const buffer = Buffer.from(await response.arrayBuffer());
      const storagePath = `hr/termination/${process.id}/request/signed-confirmation.pdf`;
      await getStorage(adminApp).bucket(firebaseClientConfig.storageBucket).file(storagePath).save(buffer, { resumable: false, metadata: { contentType: "application/pdf", cacheControl: "private, no-store" } });
      documents = documents.map((document) => document.type === "request_confirmation" ? {
        ...document,
        storagePath,
        contentHash: createHash("sha256").update(buffer).digest("hex"),
        auditStatus: "approved",
      } : document);
    }
  }
  const updated = await saveTermination({
    ...process,
    status: "hr_review",
    request: { ...process.request, identityStatus: "verified" },
    documents,
    steps: patchStep(process.steps, "identity_signature", { status: "completed", completedAt: now, completedBy: process.employeeId }),
    lastActivityAt: now,
    updatedAt: now,
  });
  await Promise.all([
    appendTerminationEvent(process.id, { type: "IDENTITY_VERIFIED", at: now, actorId: "system:autentique", actorName: "Autentique", message: "Identidade confirmada por assinatura eletrônica com validação por SMS." }),
    hrDbAdmin.collection("hrNotifications").doc(`termination_hr_review_${process.id}`).set({
      type: "termination_hr_review", status: "pending", terminationId: process.id, employeeId: process.employeeId,
      title: "Pedido de demissão aguardando validação", message: `${process.employeeName} concluiu a assinatura do pedido.`,
      channels: ["in_app"], recipient: { strategy: "hr_pool" }, createdAt: now, updatedAt: now,
    }, { merge: true }),
  ]);
  const context = await requireSystemTaskContext(process.employeeId);
  if (context) await createHrTask(context, updated, `Validar pedido de demissão — ${process.employeeName}`, "Confira a carta, a identidade e a manifestação do colaborador.", "hr-validation").catch(() => null);
  return updated;
}

async function requireSystemTaskContext(employeeId: string): Promise<ServerUserContext | null> {
  const user = await dbAdmin.collection("users").doc(employeeId).get();
  if (!user.exists) return null;
  const profileId = asString(user.get("profileId"));
  const profile = profileId ? await dbAdmin.collection("profiles").doc(profileId).get() : null;
  const { buildPermissionSet } = await import("@/lib/auth-server");
  return {
    decoded: { uid: employeeId } as ServerUserContext["decoded"],
    userDoc: { id: user.id, ...(user.data() as Omit<ServerUserContext["userDoc"], "id">) },
    profileId,
    permissions: buildPermissionSet(profile?.get("permissions"), profile?.get("isDefaultAdmin") === true),
    isDefaultAdmin: profile?.get("isDefaultAdmin") === true,
    workspace_id: WORKSPACE_ID,
  };
}

function eventActor(context: ServerUserContext) {
  return { actorId: context.userDoc.id, actorName: getUserDisplayName(context.userDoc, context.userDoc.id) };
}

async function requireManagedProcess(context: ServerUserContext, id: string) {
  assertTerminationManager(context);
  const process = await getTermination(id);
  if (!process) throw new Error("Desligamento não encontrado.");
  return process;
}

async function createTerminationAsoShadow(process: CltTerminationProcess) {
  const ref = hrDbAdmin.collection("onboardingProcesses").doc(process.id);
  if ((await ref.get()).exists) return;
  const identity = await loadExpectedIdentity(process.employeeId);
  const unit = process.unitId ? await dbAdmin.collection("dp_units").doc(process.unitId).get() : null;
  const now = new Date().toISOString();
  await ref.set({
    processKind: "termination_aso",
    sourceTerminationId: process.id,
    asoExamType: "dismissal",
    candidateName: process.employeeName,
    candidateEmail: process.employeeEmail,
    functionName: process.jobRoleName ?? "Colaborador(a)",
    unitId: process.unitId ?? null,
    unitName: process.unitName ?? null,
    employerLegalName: asString(unit?.get("legalName")) ?? asString(unit?.get("name")) ?? process.unitName ?? "Coala Shakes",
    employerCnpj: asString(unit?.get("cnpj")),
    employerAddress: asString(unit?.get("address")),
    publicFormAnswers: { fullName: process.employeeName, cpf: identity?.cpf ?? null },
    asoWorkflow: { status: "ready_to_generate", examType: "dismissal", updatedAt: now },
    documents: [],
    createdAt: now,
    updatedAt: now,
  });
}

export async function validateTerminationRequest(params: { context: ServerUserContext; id: string; notes?: string | null }) {
  const process = await requireManagedProcess(params.context, params.id);
  if (!["verified", "manual_verified"].includes(process.request.identityStatus)) {
    throw new Error("A confirmação de identidade ainda não foi concluída.");
  }
  const now = new Date().toISOString();
  let steps = patchStep(process.steps, "hr_validation", { status: "completed", startedAt: now, completedAt: now, completedBy: params.context.userDoc.id });
  steps = patchStep(steps, "notice_decision", { status: "in_progress", startedAt: now });
  steps = patchStep(steps, "aso", { status: "in_progress", startedAt: now, note: "Fluxo paralelo: guia, PIX, clínica, agendamento e ASO." });
  steps = patchStep(steps, "accountant", { status: "blocked", blockedReason: "Aguardando definição do aviso-prévio e conclusão do ASO." });
  const updated = await saveTermination({
    ...process,
    status: "active",
    hrValidation: { status: "confirmed", at: now, by: params.context.userDoc.id, byName: eventActor(params.context).actorName, notes: params.notes ?? null },
    accountant: process.accountant ?? { status: "not_started" },
    steps,
    lastActivityAt: now,
    updatedAt: now,
  });
  await createTerminationAsoShadow(updated);
  await createHrTask(params.context, updated, `Conduzir ASO demissional — ${process.employeeName}`, "Gere e valide a guia, solicite o PIX no Banco Inter e acompanhe clínica, agendamento e ASO.", "aso-dismissal").catch(() => null);
  await appendTerminationEvent(process.id, { type: "HR_VALIDATED", at: now, ...eventActor(params.context), message: "RH validou o pedido. Aviso e ASO foram iniciados; a contabilidade aguardará a conclusão dos dois." });
  return updated;
}

export async function decideTerminationNotice(params: {
  context: ServerUserContext;
  id: string;
  decision: "worked" | "waived_no_discount" | "waived_with_discount" | "exception_review";
  communicationDate: string;
  contractEndDate?: string | null;
  holidays?: string[];
  notes?: string | null;
}) {
  const process = await requireManagedProcess(params.context, params.id);
  if (process.hrValidation?.status !== "confirmed") throw new Error("Valide o pedido antes de definir o aviso-prévio.");
  const calculated = params.decision === "worked" ? calculateNoticeDates(params.communicationDate) : null;
  const contractEndDate = calculated?.contractEndDate ?? params.contractEndDate ?? params.communicationDate;
  let holidays = params.holidays ?? [];
  if (!holidays.length && process.unitId) {
    const unit = await dbAdmin.collection("dp_units").doc(process.unitId).get();
    const calendarId = asString(unit.get("calendarId"));
    if (calendarId) {
      const holidaySnapshot = await dbAdmin.collection("dp_calendars").doc(calendarId).collection("holidays").get();
      holidays = holidaySnapshot.docs.map((document) => {
        const value = document.get("date");
        if (typeof value === "string") return value.slice(0, 10);
        if (value && typeof value.toDate === "function") return value.toDate().toISOString().slice(0, 10);
        return "";
      }).filter(Boolean);
    }
  }
  const legalPaymentDueDate = calculateMaterialDeadline(contractEndDate, holidays);
  const now = new Date().toISOString();
  let steps = patchStep(process.steps, "notice_decision", { status: "completed", completedAt: now, completedBy: params.context.userDoc.id });
  for (const id of ["aso", "accountant", "document_audit", "signatures", "legal_obligations"] as const) steps = patchStep(steps, id, { dueAt: legalPaymentDueDate });
  steps = patchStep(steps, "access_revocation", {
    status: "blocked",
    dueAt: contractEndDate,
    blockedReason: `Aguardando o término do contrato em ${contractEndDate}.`,
  });
  steps = patchStep(steps, "legal_obligations", { status: "in_progress", startedAt: now });
  const updated = await saveTermination({
    ...process,
    notice: { decision: params.decision, communicationDate: params.communicationDate, noticeStartDate: calculated?.noticeStartDate ?? null, contractEndDate, legalPaymentDueDate, notes: params.notes ?? null, decidedAt: now, decidedBy: params.context.userDoc.id },
    steps,
    lastActivityAt: now,
    updatedAt: now,
  });
  await Promise.all([
    createHrTask(params.context, updated, `Cumprir prazo rescisório — ${process.employeeName}`, `Pagamento e obrigações até ${legalPaymentDueDate}.`, "legal-deadline", legalPaymentDueDate).catch(() => null),
    createHrTask(params.context, updated, `Receber e auditar documentos — ${process.employeeName}`, "Acompanhe a contabilidade, audite os arquivos e encaminhe os documentos selecionados para assinatura.", "documents", legalPaymentDueDate).catch(() => null),
  ]);
  await appendTerminationEvent(process.id, { type: "NOTICE_DECIDED", at: now, ...eventActor(params.context), message: `Aviso-prévio definido. Término em ${contractEndDate}; prazo material em ${legalPaymentDueDate}.` });
  return updated;
}

export async function updateTerminationStep(params: {
  context: ServerUserContext;
  id: string;
  stepId: CltTerminationProcess["steps"][number]["id"];
  status: CltTerminationProcess["steps"][number]["status"];
  note?: string | null;
}) {
  const process = await requireManagedProcess(params.context, params.id);
  if (["employee_request", "identity_signature", "hr_validation", "notice_decision", "aso", "accountant", "document_audit", "signatures", "closure"].includes(params.stepId)) {
    throw new Error("Esta etapa é atualizada automaticamente pelas ações do próprio fluxo.");
  }
  const now = new Date().toISOString();
  const terminal = ["completed", "waived", "cancelled"].includes(params.status);
  const current = process.steps.find((step) => step.id === params.stepId);
  const steps = patchStep(process.steps, params.stepId, {
    status: params.status,
    note: params.note ?? null,
    ...(params.status !== "pending" ? { startedAt: current?.startedAt ?? now } : {}),
    ...(terminal ? { completedAt: now, completedBy: params.context.userDoc.id } : { completedAt: null, completedBy: null }),
  });
  const updated = await saveTermination({ ...process, steps, lastActivityAt: now, updatedAt: now });
  await appendTerminationEvent(process.id, { type: "STEP_UPDATED", at: now, ...eventActor(params.context), message: `${current?.label ?? params.stepId}: ${params.status}.`, data: { stepId: params.stepId, status: params.status } });
  return updated;
}

export async function revokeTerminationAccess(params: {
  context: ServerUserContext;
  id: string;
  target: "pdv" | "bizneo" | "healthPlan";
}) {
  if (!["pdv", "bizneo", "healthPlan"].includes(params.target)) throw new Error("Sistema de acesso inválido.");
  const process = await requireManagedProcess(params.context, params.id);
  if (!process.notice) throw new Error("Defina o término do contrato antes de bloquear acessos.");
  const today = new Date().toISOString().slice(0, 10);
  if (today < process.notice.contractEndDate) {
    throw new Error(`Os acessos só podem ser bloqueados a partir de ${process.notice.contractEndDate}.`);
  }
  const now = new Date().toISOString();
  const userSnap = await dbAdmin.collection("users").doc(process.employeeId).get();
  const user = userSnap.data() ?? {};
  const current = process.accessRevocation ?? {
    pdv: { status: "pending" as const },
    bizneo: { status: "pending" as const },
    healthPlan: { status: "pending" as const },
    coalaOne: { status: "scheduled" as const },
  };
  const accessRevocation = structuredClone(current);

  if (params.target === "pdv") {
    const externalId = asString(accessRevocation.pdv.externalId) ?? asString(user.registrationIdPdv);
    if (!externalId) {
      accessRevocation.pdv = { status: "not_applicable", externalId: null, completedAt: now, completedBy: params.context.userDoc.id };
    } else {
      try {
        await deletePdvLegalUser(externalId);
        accessRevocation.pdv = { status: "completed", externalId, completedAt: now, completedBy: params.context.userDoc.id, error: null };
      } catch (error) {
        accessRevocation.pdv = { status: "failed", externalId, error: error instanceof Error ? error.message : "Falha ao remover acesso." };
        await saveTermination({ ...process, accessRevocation, lastActivityAt: now, updatedAt: now });
        throw error;
      }
    }
  } else {
    const externalId = params.target === "bizneo"
      ? asString(accessRevocation.bizneo.externalId) ?? asString(user.registrationIdBizneo)
      : null;
    accessRevocation[params.target] = {
      status: externalId || params.target === "healthPlan" ? "completed" : "not_applicable",
      ...(externalId ? { externalId } : {}),
      completedAt: now,
      completedBy: params.context.userDoc.id,
    } as never;
  }

  const externalDone = [accessRevocation.pdv, accessRevocation.bizneo, accessRevocation.healthPlan]
    .every((item) => ["completed", "not_applicable"].includes(item.status));
  const steps = patchStep(process.steps, "access_revocation", {
    status: externalDone ? "completed" : "in_progress",
    startedAt: process.steps.find((step) => step.id === "access_revocation")?.startedAt ?? now,
    ...(externalDone ? { completedAt: now, completedBy: params.context.userDoc.id } : {}),
  });
  const updated = await saveTermination({
    ...process,
    accessRevocation,
    operational: { ...process.operational!, accessRevoked: externalDone, benefitsClosed: accessRevocation.healthPlan.status === "completed" },
    steps,
    lastActivityAt: now,
    updatedAt: now,
  });
  const label = params.target === "pdv" ? "PDV Legal" : params.target === "bizneo" ? "Bizneo" : "plano de saúde";
  await appendTerminationEvent(process.id, {
    type: "ACCESS_REVOKED",
    at: now,
    ...eventActor(params.context),
    message: params.target === "pdv" ? `Acesso ao ${label} removido pela API.` : `Bloqueio no ${label} confirmado pelo RH.`,
    data: { target: params.target },
  });
  return updated;
}

export async function completeTermination(params: { context: ServerUserContext; id: string }) {
  const process = await requireManagedProcess(params.context, params.id);
  if (!process.notice) throw new Error("Defina o aviso-prévio e a data de término.");
  const incomplete = process.steps.filter((step) => step.required && step.id !== "closure" && !["completed", "waived"].includes(step.status));
  if (incomplete.length) throw new Error(`Ainda existem etapas obrigatórias: ${incomplete.map((step) => step.label).join(", ")}.`);
  const now = new Date().toISOString();
  const steps = patchStep(process.steps, "closure", { status: "completed", startedAt: now, completedAt: now, completedBy: params.context.userDoc.id });
  await Promise.all([
    authAdmin.updateUser(process.employeeId, { disabled: true }),
    dbAdmin.collection("users").doc(process.employeeId).set({ isActive: false, employmentStatus: "terminated", terminationDate: process.notice.contractEndDate, updatedAt: now }, { merge: true }),
  ]);
  const updated = await saveTermination({
    ...process,
    status: "completed",
    steps,
    accessRevocation: {
      ...(process.accessRevocation ?? {
        pdv: { status: "not_applicable" },
        bizneo: { status: "not_applicable" },
        healthPlan: { status: "not_applicable" },
      }),
      coalaOne: { status: "completed", completedAt: now },
    },
    completedAt: now,
    lastActivityAt: now,
    updatedAt: now,
  });
  await appendTerminationEvent(process.id, { type: "COMPLETED", at: now, ...eventActor(params.context), message: "Desligamento concluído e cadastro do colaborador inativado." });
  return updated;
}

export async function sendTerminationToAccountant(params: { context: ServerUserContext; id: string; recipientEmail: string; appBaseUrl: string }) {
  const process = await requireManagedProcess(params.context, params.id);
  if (!process.notice) throw new Error("Defina o aviso-prévio antes do envio à contabilidade.");
  if (process.steps.find((step) => step.id === "aso")?.status !== "completed") {
    throw new Error("Conclua e aprove o ASO demissional antes do envio à contabilidade.");
  }
  const recipient = params.recipientEmail.trim().toLowerCase();
  if (!recipient.includes("@")) throw new Error("Informe um e-mail válido da contabilidade.");
  const token = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const expiresAt = new Date(Date.now() + 30 * 86_400_000).toISOString();
  const url = `${params.appBaseUrl}/desligamento/contabilidade/${token}`;
  const now = new Date().toISOString();
  const summary = `Colaborador: ${process.employeeName}\nProtocolo: ${process.request.protocol}\nTérmino do contrato: ${process.notice.contractEndDate}\nPrazo legal: ${process.notice.legalPaymentDueDate}\nAviso: ${process.notice.decision}`;
  const accountantAttachments = [] as Array<{ filename: string; content: string; contentType: string }>;
  const sourceDocuments = process.documents.filter((document) => ["resignation_letter", "request_confirmation"].includes(document.type));
  const bucket = getStorage(adminApp).bucket(firebaseClientConfig.storageBucket);
  for (const document of sourceDocuments) {
    const [buffer] = await bucket.file(document.storagePath).download();
    accountantAttachments.push({ filename: document.fileName, content: buffer.toString("base64"), contentType: document.mimeType });
  }
  await sendEmail({
    from: EMAIL_SENDERS.formalization,
    to: recipient,
    subject: `Desligamento CLT — ${process.employeeName}`,
    html: renderCoalaEmail({ brandName: "Coala Shakes", title: "Processamento de desligamento", message: summary, highlightBlock: { text: "Use o link seguro para consultar o resumo e anexar os documentos rescisórios.", tone: "green", action: { label: "Enviar documentos", url } }, footer: "Link individual, auditado e com validade de 30 dias." }),
    text: `${summary}\n\nEnviar documentos: ${url}`,
    attachments: accountantAttachments,
    tags: [{ name: "category", value: "termination_accountant" }, { name: "termination_id", value: process.id.slice(0, 256) }],
  });
  const steps = patchStep(process.steps, "accountant", { status: "waiting_external", startedAt: process.steps.find((step) => step.id === "accountant")?.startedAt ?? now });
  const updated = await saveTermination({ ...process, accountant: { status: "sent", tokenHash, tokenExpiresAt: expiresAt, sentAt: now, recipientEmail: recipient }, steps, lastActivityAt: now, updatedAt: now });
  await appendTerminationEvent(process.id, { type: "ACCOUNTANT_SENT", at: now, ...eventActor(params.context), message: `Resumo e portal seguro enviados para ${recipient}.` });
  return updated;
}

export async function getTerminationByAccountantToken(token: string) {
  const hash = createHash("sha256").update(token).digest("hex");
  const snapshot = await hrDbAdmin.collection(COLLECTION).where("accountant.tokenHash", "==", hash).limit(1).get();
  const process = snapshot.docs[0] ? await getTermination(snapshot.docs[0].id) : null;
  if (!process || !process.accountant?.tokenExpiresAt || process.accountant.tokenExpiresAt < new Date().toISOString()) throw new Error("Link inválido ou expirado.");
  return process;
}

export async function uploadAccountantDocuments(params: { token: string; files: File[] }) {
  const process = await getTerminationByAccountantToken(params.token);
  if (!params.files.length) throw new Error("Anexe ao menos um documento.");
  if (params.files.length > 20) throw new Error("Envie no máximo 20 arquivos por vez.");
  const bucket = getStorage(adminApp).bucket(firebaseClientConfig.storageBucket);
  const now = new Date().toISOString();
  const newDocuments: TerminationDocument[] = [];
  for (const file of params.files) {
    if (file.size <= 0 || file.size > 20 * 1024 * 1024) throw new Error("Cada arquivo deve ter no máximo 20 MB.");
    const buffer = Buffer.from(await file.arrayBuffer());
    const id = randomUUID();
    const storagePath = `hr/termination/${process.id}/accountant/${id}-${safeFileName(file.name)}`;
    await bucket.file(storagePath).save(buffer, { resumable: false, metadata: { contentType: file.type || "application/octet-stream", cacheControl: "private, no-store" } });
    newDocuments.push({ id, type: "accountant_document", label: file.name, fileName: safeFileName(file.name), mimeType: file.type || "application/octet-stream", storagePath, contentHash: createHash("sha256").update(buffer).digest("hex"), visibility: "internal", auditStatus: "pending", uploadedAt: now, uploadedBy: "external:accountant" });
  }
  let steps = patchStep(process.steps, "accountant", { status: "completed", completedAt: now, completedBy: "external:accountant" });
  steps = patchStep(steps, "document_audit", { status: "in_progress", startedAt: now });
  const updated = await saveTermination({ ...process, accountant: { ...process.accountant!, status: "documents_received", completedAt: now }, documents: [...process.documents, ...newDocuments], steps, lastActivityAt: now, updatedAt: now });
  await appendTerminationEvent(process.id, { type: "ACCOUNTANT_DOCUMENTS_RECEIVED", at: now, actorId: "external:accountant", actorName: "Contabilidade", message: `${newDocuments.length} documento(s) recebido(s) para auditoria.` });
  return updated;
}

export async function auditTerminationDocuments(params: { context: ServerUserContext; id: string; approvedIds: string[]; selectedIds: string[] }) {
  const process = await requireManagedProcess(params.context, params.id);
  const accountantDocs = process.documents.filter((document) => document.type === "accountant_document");
  if (!accountantDocs.length) throw new Error("Ainda não há documentos da contabilidade para auditar.");
  const now = new Date().toISOString();
  const approved = new Set(params.approvedIds);
  const selected = new Set(params.selectedIds);
  const documents = process.documents.map((document) => document.type === "accountant_document" ? {
    ...document,
    auditStatus: approved.has(document.id) ? "approved" as const : "correction_required" as const,
    selectedForEmployee: approved.has(document.id) && selected.has(document.id),
  } : document);
  let steps = patchStep(process.steps, "document_audit", { status: "completed", completedAt: now, completedBy: params.context.userDoc.id });
  steps = patchStep(steps, "signatures", { status: documents.some((document) => document.selectedForEmployee) ? "in_progress" : "waived", startedAt: now, ...(!documents.some((document) => document.selectedForEmployee) ? { completedAt: now, completedBy: params.context.userDoc.id } : {}) });
  const updated = await saveTermination({ ...process, documents, steps, accountant: { ...process.accountant!, status: approved.size === accountantDocs.length ? "approved" : "correction_requested" }, lastActivityAt: now, updatedAt: now });
  await appendTerminationEvent(process.id, { type: "DOCUMENT_AUDIT_COMPLETED", at: now, ...eventActor(params.context), message: `${approved.size} documento(s) aprovado(s); ${selected.size} selecionado(s) para o colaborador.` });
  return updated;
}

export async function sendTerminationDocumentsForSignature(params: { context: ServerUserContext; id: string }) {
  const process = await requireManagedProcess(params.context, params.id);
  const selected = process.documents.filter((document) => document.selectedForEmployee && document.auditStatus === "approved");
  if (!selected.length) throw new Error("Selecione documentos aprovados para assinatura.");
  const employeeSnapshot = await dbAdmin.collection("users").doc(process.employeeId).get();
  const phone = normalizePhone(employeeSnapshot.get("phone"));
  if (!phone) throw new Error("O colaborador precisa ter celular vinculado para assinar.");
  const identity = await loadExpectedIdentity(process.employeeId);
  const cpf = String(identity?.cpf ?? "").replace(/\D/g, "");
  const bucket = getStorage(adminApp).bucket(firebaseClientConfig.storageBucket);
  const now = new Date().toISOString();
  for (const document of selected) {
    const existing = await hrDbAdmin.collection("hrSignatureRequests").where("terminationId", "==", process.id).where("terminationDocumentId", "==", document.id).limit(1).get();
    if (!existing.empty) continue;
    const [buffer] = await bucket.file(document.storagePath).download();
    const provider = await createAutentiqueDocument({
      buffer,
      fileName: document.fileName,
      documentName: `${document.label} — ${process.employeeName}`,
      message: "Confira e assine os documentos do seu desligamento.",
      signers: [
        { email: process.employeeEmail, name: process.employeeName, action: "SIGN", cpf: cpf.length === 11 ? cpf : undefined, requireSmsVerificationPhone: phone },
        { email: params.context.userDoc.email, name: getUserDisplayName(params.context.userDoc, params.context.userDoc.id), action: "SIGN" },
      ],
    });
    await hrDbAdmin.collection("hrSignatureRequests").add({ terminationId: process.id, terminationDocumentId: document.id, purpose: "termination_final_document", status: "sent", provider: "autentique", providerDocumentId: provider.document.id, documentStoragePath: document.storagePath, createdAt: now, updatedAt: now });
  }
  const steps = patchStep(process.steps, "signatures", { status: "waiting_external", startedAt: process.steps.find((step) => step.id === "signatures")?.startedAt ?? now });
  const updated = await saveTermination({ ...process, steps, lastActivityAt: now, updatedAt: now });
  await appendTerminationEvent(process.id, { type: "FINAL_SIGNATURES_SENT", at: now, ...eventActor(params.context), message: `${selected.length} documento(s) encaminhado(s) para assinatura do colaborador e do RH.` });
  return updated;
}

export async function markTerminationDocumentSigned(params: { terminationId: string; documentId: string; signedAt: string; signedUrl: string }) {
  const process = await getTermination(params.terminationId);
  if (!process) return null;
  const response = await fetch(params.signedUrl, { signal: AbortSignal.timeout(30_000), cache: "no-store" });
  if (!response.ok) throw new Error("Não foi possível baixar o documento final assinado.");
  const buffer = Buffer.from(await response.arrayBuffer());
  const storagePath = `hr/termination/${process.id}/signed/${params.documentId}.pdf`;
  await getStorage(adminApp).bucket(firebaseClientConfig.storageBucket).file(storagePath).save(buffer, { resumable: false, metadata: { contentType: "application/pdf", cacheControl: "private, no-store" } });
  const documents = process.documents.map((document) => document.id === params.documentId ? { ...document, type: "signed_document" as const, mimeType: "application/pdf", storagePath, contentHash: createHash("sha256").update(buffer).digest("hex"), visibility: "employee" as const } : document);
  const requests = await hrDbAdmin.collection("hrSignatureRequests").where("terminationId", "==", process.id).where("purpose", "==", "termination_final_document").get();
  const allSigned = requests.docs.every((document) => document.get("terminationDocumentId") === params.documentId || ["signed", "completed"].includes(String(document.get("status"))));
  const steps = allSigned ? patchStep(process.steps, "signatures", { status: "completed", completedAt: params.signedAt, completedBy: "system:autentique" }) : process.steps;
  const updated = await saveTermination({ ...process, documents, steps, lastActivityAt: params.signedAt, updatedAt: params.signedAt });
  await appendTerminationEvent(process.id, { type: "FINAL_DOCUMENT_SIGNED", at: params.signedAt, actorId: "system:autentique", actorName: "Autentique", message: "Documento final assinado e arquivado no dossiê." });
  return updated;
}
