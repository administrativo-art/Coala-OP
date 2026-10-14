import "server-only";

import { getStorage } from "firebase-admin/storage";
import { FieldValue, Timestamp } from "firebase-admin/firestore";

import { generateDocumentFromTemplate } from "@/features/hr/documents/generate-document.server";
import { sendGeneratedDocumentForStandaloneSignature } from "@/features/hr/documents/signature-workflow.server";
import { recordTransportVoucherDecision } from "@/features/hr/lib/transport-voucher-decision.server";
import { syncTransportVoucherProjection } from "@/features/hr/lib/collaborator-data-contract.server";
import { getTransportVoucherStatus } from "@/features/hr/lib/transport-voucher";
import { assertEmployeeUnitAccess, loadVisibleEmployeeIds } from "@/features/hr/lib/employee-document-access-server";
import type { HrAccess } from "@/features/hr/lib/server-access";
import {
  assertTransportVoucherActionAvailable,
  calculatePayslipPaymentDate,
  calculateTransportVoucherEffect,
  formatBrazilianRequestText,
  normalizeApprovedDailyValue,
  normalizeRequestDetails,
  normalizeTransportVoucherRequestAction,
  todayInBelem,
} from "@/features/hr/requests/core";
import type { CollaboratorRequest, CollaboratorRequestSignature } from "@/features/hr/requests/types";
import { adminApp, dbAdmin } from "@/lib/firebase-admin";
import { firebaseClientConfig } from "@/lib/firebase-client-config";
import { hrDbAdmin } from "@/lib/firebase-rh-admin";
import { getUserDisplayName } from "@/lib/user-display";
import type { ServerUserContext } from "@/lib/auth-server";

export type RequestAccess = ServerUserContext | HrAccess;

function text(value: unknown, max = 1_500) {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null;
}

function iso(value: unknown) {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && typeof (value as { toDate?: unknown }).toDate === "function") {
    return (value as { toDate: () => Date }).toDate().toISOString();
  }
  return "";
}

function stringList(value: unknown) {
  return Array.isArray(value)
    ? Array.from(new Set(value.filter((item): item is string => typeof item === "string" && Boolean(item.trim())).map((item) => item.trim())))
    : [];
}

export function canViewCollaboratorRequests(access: RequestAccess) {
  return access.isDefaultAdmin || access.permissions.dp?.requests?.view === true;
}

export function canReviewCollaboratorRequests(access: RequestAccess) {
  return access.isDefaultAdmin || access.permissions.dp?.requests?.review === true;
}

export function serializeCollaboratorRequest(id: string, value: Record<string, unknown>): CollaboratorRequest {
  const snapshot = value.currentSnapshot && typeof value.currentSnapshot === "object"
    ? value.currentSnapshot as Record<string, unknown>
    : {};
  const review = value.review && typeof value.review === "object"
    ? value.review as Record<string, unknown>
    : null;
  const createdAt = iso(value.createdAt);
  const requestDate = typeof value.requestDate === "string" && value.requestDate
    ? value.requestDate
    : createdAt.slice(0, 10);
  let calculatedEffect;
  try {
    calculatedEffect = calculateTransportVoucherEffect(requestDate);
  } catch {
    calculatedEffect = calculateTransportVoucherEffect(todayInBelem());
  }
  return {
    id,
    type: "transport_voucher",
    employeeId: String(value.employeeId ?? ""),
    employeeName: String(value.employeeName ?? "Colaborador"),
    requesterId: String(value.requesterId ?? ""),
    requesterName: String(value.requesterName ?? "Colaborador"),
    unitId: text(value.unitId, 180),
    unitIds: stringList(value.unitIds),
    action: normalizeTransportVoucherRequestAction(value.action),
    requestDate,
    cutoffDay: typeof value.cutoffDay === "number" ? value.cutoffDay : calculatedEffect.cutoffDay,
    requestedAfterCutoff: typeof value.requestedAfterCutoff === "boolean" ? value.requestedAfterCutoff : calculatedEffect.requestedAfterCutoff,
    processingCompetence: typeof value.processingCompetence === "string" && value.processingCompetence
      ? value.processingCompetence
      : String(value.effectiveDate ?? calculatedEffect.effectiveDate).slice(0, 7),
    effectiveDate: String(value.effectiveDate ?? calculatedEffect.effectiveDate),
    payslipPaymentDate: typeof value.payslipPaymentDate === "string" && value.payslipPaymentDate
      ? value.payslipPaymentDate
      : calculatedEffect.payslipPaymentDate,
    details: String(value.details ?? ""),
    status: ["pending", "approved", "rejected", "cancelled"].includes(String(value.status))
      ? value.status as CollaboratorRequest["status"]
      : "pending",
    currentSnapshot: {
      active: snapshot.active === true,
      dailyValue: typeof snapshot.dailyValue === "number" ? snapshot.dailyValue : null,
    },
    review: review ? {
      reviewerId: String(review.reviewerId ?? ""),
      reviewerName: String(review.reviewerName ?? "RH"),
      reviewedAt: iso(review.reviewedAt),
      notes: text(review.notes),
      approvedDailyValue: typeof review.approvedDailyValue === "number" ? review.approvedDailyValue : null,
    } : null,
    decisionId: text(value.decisionId, 250),
    generatedDocumentId: text(value.generatedDocumentId, 250),
    documentStatus: ["not_applicable", "pending", "generated", "failed"].includes(String(value.documentStatus))
      ? value.documentStatus as CollaboratorRequest["documentStatus"]
      : "pending",
    documentError: text(value.documentError),
    trail: Array.isArray(value.trail) ? value.trail.flatMap((entry) => {
      if (!entry || typeof entry !== "object") return [];
      const item = entry as Record<string, unknown>;
      const type = String(item.type ?? "");
      if (!["submitted", "effective_date_scheduled", "approved", "rejected", "cancelled", "benefit_updated", "decision_recorded", "term_generated", "term_failed", "signature_sent"].includes(type)) return [];
      return [{
        type: type as CollaboratorRequest["trail"][number]["type"],
        label: String(item.label ?? "Atualização"),
        at: iso(item.at),
        actorId: String(item.actorId ?? ""),
        actorName: String(item.actorName ?? "Sistema"),
        details: text(item.details),
      }];
    }).sort((left, right) => left.at.localeCompare(right.at)) : [],
    cancelledAt: value.cancelledAt ? iso(value.cancelledAt) : null,
    createdAt,
    updatedAt: iso(value.updatedAt),
  };
}

export async function listOwnCollaboratorRequests(access: RequestAccess) {
  const snapshot = await dbAdmin.collection("collaboratorRequests")
    .where("employeeId", "==", access.decoded.uid)
    .limit(100)
    .get();
  return snapshot.docs
    .map((document) => serializeCollaboratorRequest(document.id, document.data()))
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export async function listReviewableCollaboratorRequests(access: HrAccess) {
  if (!canViewCollaboratorRequests(access)) throw new Error("Sem permissão para visualizar solicitações.");
  const [visibleEmployeeIds, snapshot] = await Promise.all([
    loadVisibleEmployeeIds(access),
    dbAdmin.collection("collaboratorRequests").limit(300).get(),
  ]);
  return snapshot.docs
    .filter((document) => visibleEmployeeIds.has(String(document.get("employeeId") ?? "")))
    .map((document) => serializeCollaboratorRequest(document.id, document.data()))
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export async function createTransportVoucherRequest(access: RequestAccess, input: Record<string, unknown>) {
  const action = normalizeTransportVoucherRequestAction(input.action);
  const details = normalizeRequestDetails(input.details);
  const employeeId = access.decoded.uid;
  const userRef = dbAdmin.collection("users").doc(employeeId);
  const pendingQuery = dbAdmin.collection("collaboratorRequests")
    .where("employeeId", "==", employeeId)
    .limit(30);
  const [userSnapshot, requestsSnapshot] = await Promise.all([userRef.get(), pendingQuery.get()]);
  if (!userSnapshot.exists) throw new Error("Cadastro do colaborador não encontrado.");
  if (requestsSnapshot.docs.some((document) => document.get("status") === "pending")) {
    throw new Error("Já existe uma solicitação de vale-transporte aguardando análise.");
  }
  const user = userSnapshot.data() ?? {};
  const active = user.needsTransportVoucher === true;
  const wasConfigured = Array.isArray(user.transportVoucherHistory) && user.transportVoucherHistory.length > 0;
  assertTransportVoucherActionAvailable(action, active, wasConfigured);
  const now = Timestamp.now();
  const effect = calculateTransportVoucherEffect(todayInBelem(now.toDate()));
  const requestRef = dbAdmin.collection("collaboratorRequests").doc();
  await requestRef.create({
    type: "transport_voucher",
    employeeId,
    employeeName: getUserDisplayName(access.userDoc, employeeId),
    requesterId: employeeId,
    requesterName: getUserDisplayName(access.userDoc, employeeId),
    unitId: text(user.unitId, 180),
    unitIds: stringList(user.unitIds),
    action,
    requestDate: effect.requestDate,
    cutoffDay: effect.cutoffDay,
    requestedAfterCutoff: effect.requestedAfterCutoff,
    processingCompetence: effect.processingCompetence,
    effectiveDate: effect.effectiveDate,
    payslipPaymentDate: effect.payslipPaymentDate,
    details,
    status: "pending",
    currentSnapshot: {
      active,
      dailyValue: typeof user.transportVoucherValue === "number" ? user.transportVoucherValue : null,
    },
    review: null,
    decisionId: null,
    generatedDocumentId: null,
    documentStatus: "pending",
    documentError: null,
    trail: [
      {
        type: "submitted",
        label: "Solicitação enviada",
        at: now,
        actorId: employeeId,
        actorName: getUserDisplayName(access.userDoc, employeeId),
        details,
      },
      {
        type: "effective_date_scheduled",
        label: "Início de vigência calculado",
        at: now,
        actorId: "system:transport-voucher-policy",
        actorName: "Coala One",
        details: `Corte no dia ${effect.cutoffDay}; vigência em ${effect.effectiveDate}, competência ${effect.processingCompetence}; contracheque pago em ${effect.payslipPaymentDate}.`,
      },
    ],
    cancelledAt: null,
    createdAt: now,
    updatedAt: now,
  });
  const created = await requestRef.get();
  return serializeCollaboratorRequest(created.id, created.data() ?? {});
}

async function loadRequestForAction(access: RequestAccess, requestId: string) {
  const requestRef = dbAdmin.collection("collaboratorRequests").doc(requestId);
  const snapshot = await requestRef.get();
  if (!snapshot.exists) throw new Error("Solicitação não encontrada.");
  const employeeId = String(snapshot.get("employeeId") ?? "");
  const owner = employeeId === access.decoded.uid;
  if (!owner) {
    if (!canViewCollaboratorRequests(access)) throw new Error("Sem permissão para acessar esta solicitação.");
    await assertEmployeeUnitAccess(access, employeeId);
  }
  return { requestRef, snapshot, employeeId, owner };
}

export async function assertCollaboratorRequestAccess(access: RequestAccess, requestId: string) {
  const loaded = await loadRequestForAction(access, requestId);
  return {
    requestId,
    employeeId: loaded.employeeId,
    owner: loaded.owner,
  };
}

export async function cancelCollaboratorRequest(access: RequestAccess, requestId: string) {
  const loaded = await loadRequestForAction(access, requestId);
  if (!loaded.owner) throw new Error("Somente o titular pode cancelar esta solicitação.");
  await dbAdmin.runTransaction(async (transaction) => {
    const latest = await transaction.get(loaded.requestRef);
    if (latest.get("status") !== "pending") throw new Error("Somente solicitações pendentes podem ser canceladas.");
    transaction.update(loaded.requestRef, {
      status: "cancelled",
      cancelledAt: Timestamp.now(),
      trail: FieldValue.arrayUnion({
        type: "cancelled",
        label: "Solicitação cancelada",
        at: Timestamp.now(),
        actorId: access.decoded.uid,
        actorName: getUserDisplayName(access.userDoc, access.decoded.uid),
        details: null,
      }),
      updatedAt: Timestamp.now(),
    });
  });
}

export async function rejectCollaboratorRequest(access: HrAccess, requestId: string, notesValue: unknown) {
  if (!canReviewCollaboratorRequests(access)) throw new Error("Sem permissão para analisar solicitações.");
  const notes = text(notesValue);
  if (!notes || notes.length < 5) throw new Error("Informe o motivo da rejeição.");
  const loaded = await loadRequestForAction(access, requestId);
  const now = Timestamp.now();
  await dbAdmin.runTransaction(async (transaction) => {
    const latest = await transaction.get(loaded.requestRef);
    if (latest.get("status") !== "pending") throw new Error("Esta solicitação já foi analisada.");
    transaction.update(loaded.requestRef, {
      status: "rejected",
      review: {
        reviewerId: access.decoded.uid,
        reviewerName: access.actorName,
        reviewedAt: now,
        notes,
        approvedDailyValue: null,
      },
      documentStatus: "not_applicable",
      trail: FieldValue.arrayUnion({
        type: "rejected",
        label: "Solicitação rejeitada",
        at: now,
        actorId: access.decoded.uid,
        actorName: access.actorName,
        details: notes,
      }),
      updatedAt: now,
    });
  });
}

async function generateRequestDocument(access: HrAccess, requestId: string) {
  const loaded = await loadRequestForAction(access, requestId);
  const latest = await loaded.requestRef.get();
  if (latest.get("status") !== "approved") throw new Error("O termo só pode ser gerado após a aprovação.");
  const action = normalizeTransportVoucherRequestAction(latest.get("action"));
  const templateId = action === "suspend"
    ? "system-admission-transportation-voucher-waiver"
    : action === "reactivate"
      ? "system-post-admission-transportation-voucher-reactivation"
      : "system-admission-transportation-voucher-request";
  const scheduledValues = {
    transport_voucher_cutoff_day: String(latest.get("cutoffDay") ?? 20),
    transport_voucher_effective_date: formatBrazilianRequestText(String(latest.get("effectiveDate") ?? "")),
    transport_voucher_processing_competence: formatBrazilianRequestText(String(latest.get("processingCompetence") ?? "")),
    transport_voucher_payslip_payment_date: formatBrazilianRequestText(String(latest.get("payslipPaymentDate") ?? "")),
  };
  const generated = await generateDocumentFromTemplate({
    templateId,
    employeeId: loaded.employeeId,
    includeSensitive: true,
    manualValues: action === "suspend" || action === "reactivate"
      ? scheduledValues
      : { transport_voucher_decision_text: "opto" },
    lifecycle: "final",
    revisionKey: `collaborator-request:${requestId}`,
    actorId: access.decoded.uid,
    actorName: access.actorName,
  });
  await loaded.requestRef.set({
    generatedDocumentId: generated.id,
    documentStatus: "generated",
    documentError: null,
    trail: FieldValue.arrayUnion({
      type: "term_generated",
      label: "Termo gerado",
      at: Timestamp.now(),
      actorId: access.decoded.uid,
      actorName: access.actorName,
      details: generated.fileName,
    }),
    updatedAt: Timestamp.now(),
  }, { merge: true });
  return generated.id;
}

export async function retryCollaboratorRequestDocument(access: HrAccess, requestId: string) {
  if (!canReviewCollaboratorRequests(access)) throw new Error("Sem permissão para gerar o termo.");
  try {
    return await generateRequestDocument(access, requestId);
  } catch (cause) {
    const loaded = await loadRequestForAction(access, requestId);
    await loaded.requestRef.set({
      documentStatus: "failed",
      documentError: cause instanceof Error ? cause.message : "Falha ao gerar o termo.",
      trail: FieldValue.arrayUnion({
        type: "term_failed",
        label: "Geração do termo pendente",
        at: Timestamp.now(),
        actorId: access.decoded.uid,
        actorName: access.actorName,
        details: cause instanceof Error ? cause.message : "Falha ao gerar o termo.",
      }),
      updatedAt: Timestamp.now(),
    }, { merge: true });
    throw cause;
  }
}

export async function approveCollaboratorRequest(
  access: HrAccess,
  requestId: string,
  input: { approvedDailyValue?: unknown; notes?: unknown },
) {
  if (!canReviewCollaboratorRequests(access)) throw new Error("Sem permissão para analisar solicitações.");
  const loaded = await loadRequestForAction(access, requestId);
  const userRef = dbAdmin.collection("users").doc(loaded.employeeId);
  const now = Timestamp.now();
  const approvedAt = now.toDate().toISOString();
  const action = normalizeTransportVoucherRequestAction(loaded.snapshot.get("action"));
  const effectiveDate = String(loaded.snapshot.get("effectiveDate") ?? "");
  const payslipPaymentDate = String(
    loaded.snapshot.get("payslipPaymentDate")
      ?? calculatePayslipPaymentDate(effectiveDate.slice(0, 7)),
  );
  const reason = String(loaded.snapshot.get("details") ?? "");
  const approvedValue = normalizeApprovedDailyValue(input.approvedDailyValue, action !== "suspend");
  let entity: unknown = "CS";

  await dbAdmin.runTransaction(async (transaction) => {
    const [latestRequest, userSnapshot] = await Promise.all([
      transaction.get(loaded.requestRef),
      transaction.get(userRef),
    ]);
    if (latestRequest.get("status") !== "pending") throw new Error("Esta solicitação já foi analisada.");
    if (!userSnapshot.exists) throw new Error("Cadastro do colaborador não encontrado.");
    const latestAction = normalizeTransportVoucherRequestAction(latestRequest.get("action"));
    if (latestAction !== action) throw new Error("A solicitação foi alterada durante a análise. Reabra o painel.");
    const user = userSnapshot.data() ?? {};
    const active = user.needsTransportVoucher === true;
    const wasConfigured = Array.isArray(user.transportVoucherHistory) && user.transportVoucherHistory.length > 0;
    assertTransportVoucherActionAvailable(action, active, wasConfigured);
    entity = user.unitId ?? (Array.isArray(user.unitIds) ? user.unitIds[0] : null) ?? "CS";
    const nextActive = action !== "suspend";
    const fromStatus = getTransportVoucherStatus(active, Array.isArray(user.transportVoucherHistory) ? user.transportVoucherHistory : undefined);
    const history = Array.isArray(user.transportVoucherHistory) ? [...user.transportVoucherHistory] : [];
    history.push({
      id: `vt-request-${requestId}`,
      fromStatus,
      toStatus: nextActive ? "active" : "suspended",
      effectiveDate,
      reason,
      ...(nextActive && approvedValue !== null ? { value: approvedValue } : {}),
      changedAt: approvedAt,
      changedBy: { userId: access.decoded.uid, username: access.actorName },
    });
    transaction.set(userRef, {
      needsTransportVoucher: nextActive,
      ...(nextActive ? { transportVoucherValue: approvedValue } : { transportVoucherValue: null }),
      transportVoucherHistory: history,
    }, { merge: true });
    transaction.update(loaded.requestRef, {
      status: "approved",
      review: {
        reviewerId: access.decoded.uid,
        reviewerName: access.actorName,
        reviewedAt: now,
        notes: text(input.notes),
        approvedDailyValue: approvedValue,
      },
      documentStatus: "pending",
      documentError: null,
      trail: FieldValue.arrayUnion(
        {
          type: "approved",
          label: "Solicitação aprovada",
          at: now,
          actorId: access.decoded.uid,
          actorName: access.actorName,
          details: text(input.notes),
        },
        {
          type: "benefit_updated",
          label: "Benefício atualizado",
          at: now,
          actorId: access.decoded.uid,
          actorName: access.actorName,
          details: `Vigência em ${effectiveDate}; reflexo no contracheque pago em ${payslipPaymentDate}.`,
        },
      ),
      updatedAt: now,
    });
  });

  const warnings: string[] = [];
  const nextActive = action !== "suspend";
  try {
    const decision = await recordTransportVoucherDecision({
      employeeId: loaded.employeeId,
      active: nextActive,
      dailyValue: approvedValue,
      effectiveDate,
      reason,
      entity,
      actorId: access.decoded.uid,
      now: approvedAt,
    });
    await loaded.requestRef.set({
      decisionId: decision.decisionId,
      trail: FieldValue.arrayUnion({
        type: "decision_recorded",
        label: "Decisão versionada",
        at: Timestamp.now(),
        actorId: access.decoded.uid,
        actorName: access.actorName,
        details: decision.protocol,
      }),
      updatedAt: Timestamp.now(),
    }, { merge: true });
  } catch (cause) {
    warnings.push(cause instanceof Error ? cause.message : "Falha ao registrar a decisão documental.");
  }
  try {
    await syncTransportVoucherProjection({
      userId: loaded.employeeId,
      active: nextActive,
      valueReais: approvedValue,
      actorId: access.decoded.uid,
      source: "collaborator_request_v1",
    });
  } catch (cause) {
    warnings.push(cause instanceof Error ? cause.message : "Falha ao atualizar a projeção do perfil.");
  }
  try {
    await generateRequestDocument(access, requestId);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "Falha ao gerar o termo.";
    warnings.push(message);
    await loaded.requestRef.set({
      documentStatus: "failed",
      documentError: message,
      trail: FieldValue.arrayUnion({
        type: "term_failed",
        label: "Geração do termo pendente",
        at: Timestamp.now(),
        actorId: access.decoded.uid,
        actorName: access.actorName,
        details: message,
      }),
      updatedAt: Timestamp.now(),
    }, { merge: true });
  }
  const result = await loaded.requestRef.get();
  return { request: serializeCollaboratorRequest(result.id, result.data() ?? {}), warnings };
}

export async function loadRequestDocument(access: RequestAccess, requestId: string, wantsPdf: boolean) {
  const loaded = await loadRequestForAction(access, requestId);
  const documentId = text(loaded.snapshot.get("generatedDocumentId"), 250);
  if (!documentId) throw new Error("O termo ainda não foi gerado.");
  const document = await dbAdmin.collection("generatedDocuments").doc(documentId).get();
  if (!document.exists) throw new Error("Documento gerado não encontrado.");
  const storagePath = wantsPdf ? document.get("pdfStoragePath") : document.get("storagePath");
  if (typeof storagePath !== "string" || !storagePath) {
    throw new Error(wantsPdf ? "PDF indisponível para este termo." : "Arquivo indisponível.");
  }
  const [buffer] = await getStorage(adminApp)
    .bucket(firebaseClientConfig.storageBucket)
    .file(storagePath)
    .download();
  const originalName = String(document.get("originalName") ?? "termo-vale-transporte.docx");
  return {
    buffer,
    fileName: wantsPdf ? originalName.replace(/\.docx$/i, ".pdf") : originalName,
    contentType: wantsPdf ? "application/pdf" : "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  };
}

function signatureAccessFromRecords(
  generated: FirebaseFirestore.DocumentSnapshot,
  signatureRequest: FirebaseFirestore.DocumentSnapshot | null,
  ownerEmail: string | null,
): CollaboratorRequestSignature {
  const signers = signatureRequest && Array.isArray(signatureRequest.get("providerSignatures"))
    ? signatureRequest.get("providerSignatures") as Array<Record<string, unknown>>
    : [];
  const normalizedEmail = ownerEmail?.trim().toLocaleLowerCase("pt-BR") ?? null;
  const signer = signers.find((entry) => String(entry.email ?? "").trim().toLocaleLowerCase("pt-BR") === normalizedEmail)
    ?? (signers.length === 1 ? signers[0] : null);
  const link = signer?.link && typeof signer.link === "object"
    ? text((signer.link as Record<string, unknown>).short_link, 1_000)
    : null;
  const signed = signer?.signed && typeof signer.signed === "object"
    ? iso((signer.signed as Record<string, unknown>).created_at)
    : null;
  return {
    status: text(generated.get("signatureStatus"), 80) ?? text(signatureRequest?.get("status"), 80),
    requestId: text(generated.get("signatureRequestId"), 250),
    signingUrl: link,
    sentAt: generated.get("signatureSentAt") ? iso(generated.get("signatureSentAt")) : null,
    signedAt: signed || (generated.get("signedAt") ? iso(generated.get("signedAt")) : null),
  };
}

export async function loadCollaboratorRequestSignature(access: RequestAccess, requestId: string) {
  const loaded = await loadRequestForAction(access, requestId);
  const generatedDocumentId = text(loaded.snapshot.get("generatedDocumentId"), 250);
  if (!generatedDocumentId) return { status: null, requestId: null, signingUrl: null, sentAt: null, signedAt: null } satisfies CollaboratorRequestSignature;
  const generated = await dbAdmin.collection("generatedDocuments").doc(generatedDocumentId).get();
  if (!generated.exists) throw new Error("Termo gerado não encontrado.");
  const signatureRequestId = text(generated.get("signatureRequestId"), 250);
  const signatureRequest = signatureRequestId
    ? await hrDbAdmin.collection("hrSignatureRequests").doc(signatureRequestId).get()
    : null;
  const employee = await dbAdmin.collection("users").doc(loaded.employeeId).get();
  return signatureAccessFromRecords(generated, signatureRequest, text(employee.get("email"), 320));
}

export async function sendCollaboratorRequestForSignature(access: RequestAccess, requestId: string) {
  const loaded = await loadRequestForAction(access, requestId);
  if (!loaded.owner && !canReviewCollaboratorRequests(access)) throw new Error("Sem permissão para enviar este termo para assinatura.");
  if (loaded.snapshot.get("status") !== "approved") throw new Error("A solicitação precisa estar aprovada.");
  const generatedDocumentId = text(loaded.snapshot.get("generatedDocumentId"), 250);
  if (!generatedDocumentId) throw new Error("O termo ainda não foi gerado.");
  const actorName = "actorName" in access
    ? access.actorName
    : getUserDisplayName(access.userDoc, access.decoded.uid);
  const result = await sendGeneratedDocumentForStandaloneSignature({
    generatedDocumentId,
    actorId: access.decoded.uid,
    actorName,
  });
  if (!result.reused) {
    await loaded.requestRef.set({
      trail: FieldValue.arrayUnion({
        type: "signature_sent",
        label: "Termo enviado para assinatura",
        at: Timestamp.now(),
        actorId: access.decoded.uid,
        actorName,
        details: "Acesso individual disponibilizado ao colaborador.",
      }),
      updatedAt: Timestamp.now(),
    }, { merge: true });
  }
  return loadCollaboratorRequestSignature(access, requestId);
}
