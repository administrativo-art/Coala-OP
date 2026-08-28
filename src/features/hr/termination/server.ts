import "server-only";

import { createHash, randomBytes, randomUUID } from "node:crypto";
import { renderToBuffer } from "react-pdf-renderer-server";
import type { DocumentSnapshot } from "firebase-admin/firestore";
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
import { deletePdvLegalUser } from "@/lib/integrations/pdv-legal-admin";
import {
  buildProcessProjection,
  calculateMaterialDeadline,
  calculateNoticeDates,
  createEmployeeResignationSteps,
  createEmployerDismissalSteps,
  createInitialTerminationSteps,
  createPjTerminationSteps,
  patchStep,
  recalculateTermination,
} from "./core";
import { buildEmployerDismissalNotice, buildTerminationRequestConfirmation } from "./request-document.server";
import {
  renderTerminationAccountantCorrectionEmail,
  renderTerminationAccountantEmail,
  renderTerminationEmployeeCompletionEmail,
  renderTerminationInternalReservationsEmail,
  renderTerminationLetterCorrectionEmail,
} from "./emails";
import type {
  CltTerminationProcess,
  PjTerminationAgreement,
  PjTerminationContractSnapshot,
  TerminationEmployerSnapshot,
  TerminationDocument,
  TerminationEvent,
} from "./types";
import type { ManagedTerminationCreateInput, PjTerminationAgreementGenerateInput } from "./schemas";
import { terminationReasonsForRelationship } from "@/lib/hr/employment-relationship";
import { recalculateEmploymentEndRetention } from "@/features/hr/documents/document-retention.server";
import { createPaymentRequest, refreshPaymentRequest } from "@/features/financial/payment-requests/service.server";
import { getPaymentRequest } from "@/features/financial/payment-requests/repository.server";
import { cancelFutureEmployeeForecasts } from "@/features/financial/employee-provisions/termination.server";
import { resolveCompanyProcessContact } from "@/lib/company/company-process-contact.server";
import { CnpjValidator } from "@/lib/company/cnpj-validator";
import { resolveDocumentLegalEntitySnapshot } from "@/features/hr/documents/legal-entity-snapshot.server";
import { resolveCompanyDocumentSignatory } from "@/features/hr/documents/company-document-signatory.server";
import { PjTerminationAgreementPdf } from "./pj-termination-agreement-pdf";

const COLLECTION = "terminationProcesses";
const PROJECTION_COLLECTION = "processProjections";
const ALLOWED_LETTER_TYPES = new Set(["application/pdf", "image/jpeg", "image/png"]);
const MAX_LETTER_BYTES = 12 * 1024 * 1024;

function asString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
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

function formatBrMoney(value: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
}

function belemDateOnly(value = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/Belem", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(value);
  const part = (type: "year" | "month" | "day") => parts.find((entry) => entry.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
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

function isGuidedEmployerDismissal(process: CltTerminationProcess) {
  return process.processType === "clt_hr_termination"
    && process.terminationReason === "Dispensa sem justa causa"
    && Boolean(process.dismissalCommunication)
    && process.steps.some((step) => step.id === "termination_payment");
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
  let process = recalculateTermination({ id: snapshot.id, ...(serialize(snapshot.data()) as Omit<CltTerminationProcess, "id">) } as CltTerminationProcess);
  if (!usableEmployerSnapshot(process.employer) && !["completed", "cancelled"].includes(process.status)) {
    const userSnapshot = await dbAdmin.collection("users").doc(process.employeeId).get();
    if (userSnapshot.exists) {
      const user = { id: userSnapshot.id, ...(userSnapshot.data() as Omit<ServerUserContext["userDoc"], "id">) };
      const employer = await resolveTerminationEmployer({ user }).catch(() => null);
      if (employer) {
        process = recalculateTermination({ ...process, employer });
        await Promise.all([
          snapshot.ref.set({ employer }, { merge: true }),
          persistCollaboratorEmployer(process.employeeId, employer),
          syncTerminationProjection(process),
        ]).catch(() => undefined);
      }
    }
  }
  if (process.processType === "pj_contract_termination" && !process.pjContractSnapshot && !["completed", "cancelled"].includes(process.status) && usableEmployerSnapshot(process.employer)) {
    const userSnapshot = await dbAdmin.collection("users").doc(process.employeeId).get();
    if (userSnapshot.exists) {
      const user = { id: userSnapshot.id, ...(userSnapshot.data() as Omit<ServerUserContext["userDoc"], "id">) };
      const pjContractSnapshot = await resolvePjTerminationContractSnapshot({ user, employer: process.employer, capturedAt: new Date().toISOString() }).catch(() => null);
      if (pjContractSnapshot) {
        process = recalculateTermination({
          ...process,
          pjContractSnapshot,
          pjAgreement: process.pjAgreement ?? { status: "not_generated", version: 0, documentId: null, settlement: null, witnesses: null },
        });
        await Promise.all([
          snapshot.ref.set({ pjContractSnapshot, pjAgreement: process.pjAgreement, steps: process.steps }, { merge: true }),
          syncTerminationProjection(process),
        ]).catch(() => undefined);
      }
    }
  }
  return process;
}

export async function assertTerminationVisible(context: ServerUserContext, process: CltTerminationProcess) {
  if (process.employeeId !== context.userDoc.id && !canViewAll(context)) {
    throw new Error("Sem permissão para visualizar este desligamento.");
  }
}

export function terminationForViewer(context: ServerUserContext, process: CltTerminationProcess) {
  if (canViewAll(context) || process.employeeId !== context.userDoc.id) return process;
  if (process.processType === "pj_contract_termination") {
    return {
      ...process,
      terminationNotes: null,
      terminationInternalReason: null,
      documents: process.documents.filter((document) => document.visibility === "employee"),
      operational: process.operational ? { ...process.operational, notes: null } : process.operational,
      pjAgreement: process.pjAgreement ? { ...process.pjAgreement, witnesses: null } : process.pjAgreement,
    };
  }
  if (process.processType !== "clt_hr_termination") return process;
  return {
    ...process,
    terminationNotes: null,
    terminationInternalReason: null,
    operational: process.operational ? { ...process.operational, notes: null } : process.operational,
  };
}

export async function listTerminations(context: ServerUserContext, scope: "all" | "mine" = "all") {
  if (scope === "mine" || !canViewAll(context)) {
    const snapshot = await hrDbAdmin.collection(COLLECTION).where("employeeId", "==", context.userDoc.id).get();
    const processes = snapshot.docs
      .map((doc) => recalculateTermination({ id: doc.id, ...(serialize(doc.data()) as Omit<CltTerminationProcess, "id">) } as CltTerminationProcess))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const reconciled = await Promise.all(processes.map((process) => reconcileTerminationProviderState(process).catch(() => process)));
    return reconciled.map((process) => terminationForViewer(context, process));
  }
  const snapshot = await hrDbAdmin.collection(COLLECTION).orderBy("createdAt", "desc").get();
  const processes = snapshot.docs.map((doc) => recalculateTermination({ id: doc.id, ...(serialize(doc.data()) as Omit<CltTerminationProcess, "id">) } as CltTerminationProcess));
  const reconciled = await Promise.all(processes.map((process) => reconcileTerminationProviderState(process).catch(() => process)));
  return reconciled.map((process) => terminationForViewer(context, process));
}

export async function reconcileTerminationProviderState(process: CltTerminationProcess) {
  if (process.request.identityStatus === "pending_signature" && process.request.providerDocumentId) {
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

function usableEmployerSnapshot(value: CltTerminationProcess["employer"]): value is TerminationEmployerSnapshot {
  return Boolean(
    value
    && value.legalName?.trim()
    && CnpjValidator.validate(value.cnpj ?? "").valid,
  );
}

type EmployerSource = {
  unitId: string | null;
  legalName: string | null;
  cnpj: string | null;
  address: string | null;
};

async function employerSourceFromUnit(unitId: string, fallback: Partial<EmployerSource> = {}): Promise<EmployerSource> {
  const snapshot = await dbAdmin.collection("dp_units").doc(unitId).get();
  if (!snapshot.exists && !fallback.cnpj) throw new Error("O CNPJ empregador selecionado não foi encontrado.");
  return {
    unitId,
    legalName: asString(snapshot.get("legalName")) ?? asString(snapshot.get("name")) ?? fallback.legalName ?? null,
    cnpj: asString(snapshot.get("cnpj")) ?? fallback.cnpj ?? null,
    address: asString(snapshot.get("address")) ?? fallback.address ?? null,
  };
}

async function storedEmployerSource(user: ServerUserContext["userDoc"]): Promise<EmployerSource | null> {
  if (CnpjValidator.validate(asString(user.employerCnpj) ?? "").valid) {
    return {
      unitId: asString(user.employerUnitId),
      legalName: asString(user.employerUnitName),
      cnpj: asString(user.employerCnpj),
      address: asString(user.employerAddress),
    };
  }
  if (asString(user.employerUnitId)) {
    const source = await employerSourceFromUnit(asString(user.employerUnitId)!).catch(() => null);
    if (source && CnpjValidator.validate(source.cnpj ?? "").valid) return source;
  }
  const onboardingId = asString((user as ServerUserContext["userDoc"] & { onboardingId?: string | null }).onboardingId);
  if (onboardingId) {
    const onboarding = await hrDbAdmin.collection("onboardingProcesses").doc(onboardingId).get();
    if (onboarding.exists) {
      const onboardingSource: EmployerSource = {
        unitId: asString(onboarding.get("employerUnitId")),
        legalName: asString(onboarding.get("employerUnitName")),
        cnpj: asString(onboarding.get("employerCnpj")),
        address: asString(onboarding.get("employerAddress")),
      };
      if (CnpjValidator.validate(onboardingSource.cnpj ?? "").valid) {
        return onboardingSource;
      }
    }
  }

  const employee = await hrDbAdmin.collection("employees").doc(user.id).get();
  const employerField = await employee.ref.collection("field_values").doc("employee.employer_cnpj").get();
  const employeeCnpj = asString(employee.get("employer_cnpj")) ?? asString(employerField.get("value_text"));
  if (!CnpjValidator.validate(employeeCnpj ?? "").valid) return null;
  const cleanCnpj = CnpjValidator.clean(employeeCnpj!);
  const unitMatch = await dbAdmin.collection("dp_units").where("cnpj", "==", cleanCnpj).limit(1).get();
  const unit = unitMatch.docs[0] ?? null;
  return {
    unitId: asString(employee.get("employer_unit_id")) ?? unit?.id ?? null,
    legalName: asString(employee.get("employer_unit_name")) ?? asString(unit?.get("legalName")) ?? asString(unit?.get("name")),
    cnpj: cleanCnpj,
    address: asString(employee.get("employer_address")) ?? asString(unit?.get("address")),
  };
}

async function resolveTerminationEmployer(params: {
  user: ServerUserContext["userDoc"];
  employerUnitId?: string | null;
}): Promise<TerminationEmployerSnapshot> {
  const explicitUnitId = asString(params.employerUnitId);
  const source = explicitUnitId
    ? await employerSourceFromUnit(explicitUnitId)
    : await storedEmployerSource(params.user);
  if (!source) {
    throw new Error("Defina o CNPJ empregador no cadastro do colaborador antes de iniciar a rescisão.");
  }
  const validation = CnpjValidator.validate(source.cnpj ?? "");
  if (!validation.valid) throw new Error("O CNPJ empregador está ausente ou inválido. Revise o cadastro da empresa.");
  const legalEntity = await resolveDocumentLegalEntitySnapshot({
    cnpj: validation.clean,
    fallbackName: source.legalName,
    fallbackAddress: source.address,
  });
  const legalName = asString(legalEntity.legalName) ?? source.legalName;
  if (!legalName) throw new Error("A razão social da empregadora precisa estar cadastrada.");
  return {
    unitId: source.unitId,
    entityId: legalEntity.entityId,
    legalName,
    tradeName: asString(legalEntity.tradeName),
    cnpj: validation.clean,
    address: asString(legalEntity.address) ?? source.address ?? "",
    capturedAt: new Date().toISOString(),
  };
}

async function persistCollaboratorEmployer(employeeId: string, employer: TerminationEmployerSnapshot) {
  await Promise.all([
    dbAdmin.collection("users").doc(employeeId).set({
      employerUnitId: employer.unitId,
      employerUnitName: employer.legalName,
      employerCnpj: employer.cnpj,
      employerAddress: employer.address,
      updatedAt: new Date().toISOString(),
    }, { merge: true }),
    hrDbAdmin.collection("employees").doc(employeeId).set({
      employer_unit_id: employer.unitId,
      employer_unit_name: employer.legalName,
      employer_cnpj: employer.cnpj,
      employer_address: employer.address,
      updated_at: new Date().toISOString(),
    }, { merge: true }),
    hrDbAdmin.collection("employees").doc(employeeId).collection("field_values").doc("employee.employer_cnpj").set({
      field_key: "employee.employer_cnpj",
      value_text: employer.cnpj,
      source: "termination_employer_confirmation",
      updated_at: new Date().toISOString(),
    }, { merge: true }),
  ]);
}

function requireTerminationEmployer(process: CltTerminationProcess) {
  if (!usableEmployerSnapshot(process.employer)) {
    throw new Error("A rescisão não possui um CNPJ empregador válido. Revise o vínculo antes de continuar.");
  }
  return process.employer;
}

function requireText(value: unknown, message: string) {
  const normalized = asString(value);
  if (!normalized) throw new Error(message);
  return normalized;
}

async function findSignedPjOnboarding(user: ServerUserContext["userDoc"]) {
  const candidates = new Map<string, DocumentSnapshot>();
  const onboardingId = asString((user as ServerUserContext["userDoc"] & { onboardingId?: string | null }).onboardingId);
  if (onboardingId) {
    const direct = await hrDbAdmin.collection("onboardingProcesses").doc(onboardingId).get();
    if (direct.exists) candidates.set(direct.id, direct);
  }
  const [byCollaborator, byEmployee] = await Promise.all([
    hrDbAdmin.collection("onboardingProcesses").where("collaboratorUserId", "==", user.id).limit(20).get(),
    hrDbAdmin.collection("onboardingProcesses").where("employeeId", "==", user.id).limit(20).get(),
  ]);
  [...byCollaborator.docs, ...byEmployee.docs].forEach((document) => candidates.set(document.id, document));
  return [...candidates.values()]
    .filter((document) => {
      const data = document.data() ?? {};
      const contract = asRecord(asRecord(data.pjWorkflow).contract);
      return data.employmentRelationshipType === "pj"
        && contract.status === "signed"
        && Boolean(asString(contract.signedStoragePath));
    })
    .sort((left, right) => String(right.get("updatedAt") ?? "").localeCompare(String(left.get("updatedAt") ?? "")))[0] ?? null;
}

async function resolvePjTerminationContractSnapshot(params: {
  user: ServerUserContext["userDoc"];
  employer: TerminationEmployerSnapshot;
  capturedAt: string;
}): Promise<PjTerminationContractSnapshot> {
  const onboarding = await findSignedPjOnboarding(params.user);
  if (!onboarding) {
    throw new Error("O contrato PJ original precisa estar assinado e vinculado ao cadastro antes do encerramento.");
  }
  const process = onboarding.data() ?? {};
  const workflow = asRecord(process.pjWorkflow);
  const provider = asRecord(workflow.provider);
  const terms = asRecord(workflow.terms);
  const contract = asRecord(workflow.contract);
  const answers = asRecord(process.publicFormAnswers);
  const contractorRepresentative = asRecord(contract.contractorRepresentative);
  const sourceEmployerCnpj = CnpjValidator.clean(asString(process.employerCnpj) ?? params.employer.cnpj);
  if (!CnpjValidator.validate(sourceEmployerCnpj).valid || sourceEmployerCnpj !== CnpjValidator.clean(params.employer.cnpj)) {
    throw new Error("O CNPJ selecionado não corresponde à contratante do contrato PJ original.");
  }
  const providerCnpj = CnpjValidator.clean(asString(provider.cnpj) ?? "");
  if (!CnpjValidator.validate(providerCnpj).valid) throw new Error("O CNPJ da prestadora no contrato original está ausente ou inválido.");
  const signedStoragePath = requireText(contract.signedStoragePath, "O arquivo assinado do contrato PJ não foi encontrado.");
  const [signedContractBuffer] = await getStorage(adminApp).bucket(firebaseClientConfig.storageBucket).file(signedStoragePath).download();
  const providerEntity = await resolveDocumentLegalEntitySnapshot({
    cnpj: providerCnpj,
    fallbackName: asString(provider.legalName),
    fallbackAddress: asString(answers.companyAddress),
  }).catch(() => null);
  const contractorCpf = String(contractorRepresentative.cpf ?? "").replace(/\D/g, "");
  const providerCpf = String(answers.representativeCpf ?? "").replace(/\D/g, "");
  if (contractorCpf.length !== 11 || providerCpf.length !== 11) {
    throw new Error("Os CPFs dos representantes do contrato PJ original precisam estar completos.");
  }
  const generatedAt = requireText(contract.generatedAt ?? contract.signedAt ?? terms.contractStartDate, "A data do contrato PJ original não foi encontrada.");
  const signedAt = requireText(contract.signedAt ?? contract.generatedAt, "A data da assinatura do contrato PJ original não foi encontrada.");
  const monthlyValue = Number(terms.monthlyValue);
  if (!Number.isFinite(monthlyValue) || monthlyValue <= 0) throw new Error("O valor mensal do contrato PJ original está inválido.");
  return {
    onboardingId: onboarding.id,
    contractor: {
      entityId: params.employer.entityId,
      legalName: requireText(process.employerUnitName ?? params.employer.legalName, "A razão social da contratante está ausente."),
      tradeName: params.employer.tradeName,
      cnpj: sourceEmployerCnpj,
      email: requireText(contractorRepresentative.email, "O e-mail do representante da contratante está ausente."),
      address: requireText(process.employerAddress ?? params.employer.address, "O endereço da contratante está ausente."),
      representative: {
        name: requireText(contractorRepresentative.name, "O representante da contratante está ausente."),
        email: requireText(contractorRepresentative.email, "O e-mail do representante da contratante está ausente."),
        role: requireText(contractorRepresentative.role, "O cargo do representante da contratante está ausente."),
        qualification: requireText(contractorRepresentative.qualification, "A qualificação do representante da contratante está ausente."),
        cpf: contractorCpf,
        professionalId: asString(contractorRepresentative.professionalId),
      },
    },
    provider: {
      entityId: providerEntity?.entityId ?? null,
      legalName: requireText(provider.legalName, "A razão social da prestadora está ausente."),
      tradeName: asString(provider.tradeName),
      cnpj: providerCnpj,
      email: requireText(provider.email, "O e-mail da prestadora está ausente."),
      address: requireText(answers.companyAddress, "O endereço da prestadora está ausente."),
      representative: {
        name: requireText(answers.representativeName, "O representante da prestadora está ausente."),
        email: requireText(provider.email, "O e-mail da prestadora está ausente."),
        role: null,
        qualification: requireText(answers.representativeQualification, "A qualificação do representante da prestadora está ausente."),
        cpf: providerCpf,
        professionalId: null,
      },
    },
    sourceContract: {
      contractDate: generatedAt.slice(0, 10),
      contractStartDate: requireText(terms.contractStartDate, "A data inicial do contrato PJ está ausente.").slice(0, 10),
      termType: terms.termType === "fixed" ? "fixed" : "indefinite",
      contractEndDate: asString(terms.contractEndDate)?.slice(0, 10) ?? null,
      monthlyValue: Number(monthlyValue.toFixed(2)),
      version: Math.max(1, Number(contract.version ?? 1)),
      signedStoragePath,
      signedHashSha256: createHash("sha256").update(signedContractBuffer).digest("hex"),
      signedAt,
      signatureCity: requireText(contract.signatureCity, "A cidade de assinatura do contrato PJ está ausente."),
      forumCity: requireText(contract.forumCity, "O foro do contrato PJ está ausente."),
    },
    capturedAt: params.capturedAt,
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

async function closeFutureFinancialProvisions(
  context: ServerUserContext,
  process: CltTerminationProcess,
  terminationDate: string,
  now: string,
): Promise<NonNullable<CltTerminationProcess["financialProvisionClosure"]>> {
  try {
    const result = await cancelFutureEmployeeForecasts({
      employeeId: process.employeeId,
      terminationDate,
      terminationProcessId: process.id,
      actorId: context.userDoc.id,
    });
    return {
      status: "completed",
      cancelledCount: result.cancelledCount,
      cancelledExpenseIds: result.cancelledExpenseIds,
      attemptedAt: now,
      completedAt: now,
      error: null,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha desconhecida ao cancelar previsões futuras.";
    await createHrTask(
      context,
      process,
      `Revisar provisões futuras — ${process.employeeName}`,
      `O desligamento foi concluído, mas as provisões futuras de salário e vale-transporte não puderam ser canceladas automaticamente. Erro: ${message}`,
      "financial-provisions-cancellation",
    ).catch(() => undefined);
    return {
      status: "failed",
      cancelledCount: 0,
      cancelledExpenseIds: [],
      attemptedAt: now,
      completedAt: null,
      error: message,
    };
  }
}

export async function createManagedTermination(params: {
  context: ServerUserContext;
  input: ManagedTerminationCreateInput;
}) {
  assertTerminationManager(params.context);
  const targetSnapshot = await dbAdmin.collection("users").doc(params.input.employeeId).get();
  if (!targetSnapshot.exists) throw new Error("Colaborador não encontrado.");
  const target = {
    id: targetSnapshot.id,
    ...(targetSnapshot.data() as Omit<ServerUserContext["userDoc"], "id">),
  };
  if (target.isActive === false) throw new Error("O colaborador já está inativo.");
  const relationship = target.employmentRelationshipType;
  if (relationship !== "clt" && relationship !== "pj") {
    throw new Error(
      relationship === "internship"
        ? "O fluxo específico de desligamento de estágio ainda não está disponível."
        : "Defina o tipo de vínculo antes de iniciar o desligamento.",
    );
  }
  const allowedReasons = terminationReasonsForRelationship(relationship);
  if (!allowedReasons.some((reason) => reason === params.input.terminationReason)) {
    throw new Error("Motivo de encerramento incompatível com o tipo de vínculo.");
  }
  if (relationship === "pj" && params.input.terminationReason !== "Encerramento por acordo entre as partes") {
    throw new Error("O fluxo documental PJ disponível gera distrato por mútuo acordo. Para encerramento unilateral, use a notificação contratual específica.");
  }

  const existingSnapshot = await hrDbAdmin
    .collection(COLLECTION)
    .where("employeeId", "==", target.id)
    .get();
  const existing = existingSnapshot.docs
    .map((document) => ({
      id: document.id,
      ...(serialize(document.data()) as Omit<CltTerminationProcess, "id">),
    }))
    .find((process) => !["completed", "cancelled"].includes(process.status));
  if (existing) return { process: recalculateTermination(existing), reused: true };

  const now = new Date().toISOString();
  const today = now.slice(0, 10);
  const processId = randomUUID();
  const protocol = processProtocol(new Date(now));
  const unit = await loadUnit(target);
  const employer = await resolveTerminationEmployer({ user: target, employerUnitId: params.input.employerUnitId });
  await persistCollaboratorEmployer(target.id, employer);
  const accountantContact = relationship === "clt" ? await resolveCompanyProcessContact("termination", employer) : null;
  const identity = await loadExpectedIdentity(target.id).catch(() => null);
  const pjContractSnapshot = relationship === "pj"
    ? await resolvePjTerminationContractSnapshot({ user: target, employer, capturedAt: now })
    : null;
  const legalPaymentDueDate = relationship === "clt"
    ? calculateMaterialDeadline(params.input.terminationDate)
    : params.input.terminationDate;
  const guidedEmployerDismissal = relationship === "clt" && params.input.terminationReason === "Dispensa sem justa causa";
  if (guidedEmployerDismissal && new Date(params.input.communicationAt!).getTime() > Date.now() + 5 * 60_000) {
    throw new Error("A comunicação presencial precisa ter ocorrido antes da abertura do processo.");
  }
  let steps = relationship === "pj"
    ? createPjTerminationSteps(now, params.input.terminationDate, params.context.userDoc.id)
    : guidedEmployerDismissal
      ? createEmployerDismissalSteps(now, params.input.terminationDate, legalPaymentDueDate)
      : createInitialTerminationSteps(now);
  if (!guidedEmployerDismissal && relationship === "clt") {
    steps = patchStep(steps, "request_validation_notice", {
      status: "completed",
      completedAt: now,
      completedBy: params.context.userDoc.id,
      note: "Desligamento iniciado e validado pelo RH.",
    });
    steps = patchStep(steps, "uniform_return", { status: "in_progress", startedAt: now, dueAt: params.input.terminationDate });
    steps = patchStep(steps, "aso", {
      status: "pending", dueAt: legalPaymentDueDate, note: "Aguardando a devolução dos uniformes.",
    });
    steps = patchStep(steps, "accountant", {
      status: "blocked",
      startedAt: null,
      dueAt: legalPaymentDueDate,
      blockedReason: "Aguardando conclusão e aprovação do ASO demissional.",
    });
    for (const stepId of ["document_audit", "signatures", "legal_obligations"] as const) steps = patchStep(steps, stepId, { dueAt: legalPaymentDueDate });
    steps = patchStep(steps, "legal_obligations", { status: "in_progress", startedAt: now });
    steps = patchStep(steps, "access_revocation", {
      status: today >= params.input.terminationDate ? "in_progress" : "blocked",
      dueAt: params.input.terminationDate,
      startedAt: today >= params.input.terminationDate ? now : null,
      blockedReason: today >= params.input.terminationDate ? null : `Aguardando o término do contrato em ${params.input.terminationDate}.`,
    });
  }

  const process = recalculateTermination({
    id: processId,
    processType: relationship === "clt" ? "clt_hr_termination" : "pj_contract_termination",
    employeeId: target.id,
    employeeName: target.username,
    employeeEmail: target.email,
    employeeCpfMasked: maskCpf(identity?.cpf),
    employeePhoneMasked: target.phone ? maskPhone(target.phone) : null,
    employmentRelationshipType: relationship,
    terminationReason: params.input.terminationReason,
    terminationCause: params.input.terminationCause ?? null,
    terminationNotes: params.input.terminationNotes ?? null,
    terminationInternalReason: params.input.terminationInternalReason ?? null,
    dismissalCommunication: guidedEmployerDismissal ? {
      channel: "in_person",
      occurredAt: params.input.communicationAt!,
      location: params.input.communicationLocation!,
      responsibleId: params.context.userDoc.id,
      responsibleName: getUserDisplayName(params.context.userDoc, params.context.userDoc.id),
      participants: params.input.communicationParticipants ?? [],
      confirmedAt: now,
      confirmedBy: params.context.userDoc.id,
      officialNoticeStatus: "preparing",
      officialNoticeError: null,
      refusal: null,
    } : null,
    unitId: unit.id,
    unitName: unit.name,
    employer,
    pjContractSnapshot,
    pjAgreement: relationship === "pj" ? { status: "not_generated", version: 0, documentId: null, settlement: null, witnesses: null } : null,
    jobRoleName: target.jobRoleName ?? null,
    status: "active",
    health: "on_track",
    progress: 0,
    currentSummary: relationship === "pj" ? "Encerramento PJ iniciado" : "Desligamento iniciado pelo RH",
    source: "hr_manual",
    request: {
      noticePreference: "request_waiver",
      desiredLastDay: params.input.terminationDate,
      notes: params.input.terminationNotes ?? null,
      submittedAt: now,
      protocol,
      identityStatus: "manual_verified",
    },
    hrValidation: {
      status: "confirmed",
      at: now,
      by: params.context.userDoc.id,
      byName: getUserDisplayName(params.context.userDoc, params.context.userDoc.id),
      notes: `Iniciado pelo RH: ${params.input.terminationReason}.`,
    },
    notice: {
      decision: guidedEmployerDismissal ? params.input.noticeType! : "hr_defined",
      communicationDate: guidedEmployerDismissal ? params.input.communicationAt!.slice(0, 10) : today,
      noticeStartDate: guidedEmployerDismissal && params.input.noticeType === "worked" ? calculateNoticeDates(params.input.communicationAt!.slice(0, 10)).noticeStartDate : null,
      contractEndDate: params.input.terminationDate,
      legalPaymentDueDate,
      notes: params.input.terminationNotes ?? null,
      decidedAt: now,
      decidedBy: params.context.userDoc.id,
    },
    accountant: relationship === "clt" ? {
      status: relationship === "clt" ? "not_started" : "ready_to_send",
      recipientEmail: accountantContact?.email ?? null,
    } : null,
    payment: guidedEmployerDismissal ? { status: "not_started", dueAt: legalPaymentDueDate } : null,
    employeeCompletion: guidedEmployerDismissal ? { status: "not_started" } : null,
    internalClosure: guidedEmployerDismissal ? { status: "pending" } : null,
    operational: {
      uniformsReturned: false,
      assetsReturned: false,
      scheduleRemoved: false,
      accessRevoked: false,
      benefitsClosed: false,
    },
    accessRevocation: {
      pdv: target.registrationIdPdv
        ? { status: "pending", externalId: target.registrationIdPdv }
        : { status: "not_applicable" },
      bizneo: target.registrationIdBizneo
        ? { status: "pending", externalId: target.registrationIdBizneo }
        : { status: "not_applicable" },
      healthPlan: relationship === "clt" ? { status: "pending" } : { status: "not_applicable" },
      coalaOne: { status: "scheduled" },
    },
    documents: [],
    steps,
    nextDueAt: null,
    lastActivityAt: now,
    createdAt: now,
    updatedAt: now,
  } satisfies CltTerminationProcess);

  const lockRef = hrDbAdmin.collection("terminationActiveByEmployee").doc(target.id);
  const transactionResult = await hrDbAdmin.runTransaction(async (transaction) => {
    const lockSnapshot = await transaction.get(lockRef);
    const lockedProcessId = asString(lockSnapshot.get("processId"));
    if (lockedProcessId) {
      const lockedRef = hrDbAdmin.collection(COLLECTION).doc(lockedProcessId);
      const lockedSnapshot = await transaction.get(lockedRef);
      if (lockedSnapshot.exists && !["completed", "cancelled"].includes(String(lockedSnapshot.get("status")))) {
        return {
          process: recalculateTermination({
            id: lockedSnapshot.id,
            ...(serialize(lockedSnapshot.data()) as Omit<CltTerminationProcess, "id">),
          }),
          reused: true,
        };
      }
    }
    transaction.set(hrDbAdmin.collection(COLLECTION).doc(process.id), process);
    transaction.set(lockRef, { processId: process.id, updatedAt: now });
    return { process, reused: false };
  });
  if (transactionResult.reused) return transactionResult;

  let startedProcess: CltTerminationProcess = process;
  if (guidedEmployerDismissal) {
    await createTerminationAsoShadow(process);
    startedProcess = await sendEmployerDismissalNotice({ context: params.context, process }).catch(async (error) => {
      const failedAt = new Date().toISOString();
      const message = error instanceof Error ? error.message : "Não foi possível gerar o comunicado oficial.";
      return saveTermination({
        ...process,
        dismissalCommunication: { ...process.dismissalCommunication!, officialNoticeStatus: "failed", officialNoticeError: message },
        steps: patchStep(process.steps, "request_validation_notice", { status: "blocked", blockedReason: message, note: "A comunicação presencial foi registrada, mas o envio do comunicado precisa ser refeito." }),
        lastActivityAt: failedAt,
        updatedAt: failedAt,
      });
    });
  }

  await Promise.all([
    syncTerminationProjection(startedProcess),
    appendTerminationEvent(startedProcess.id, {
      type: "HR_TERMINATION_CREATED",
      at: now,
      ...eventActor(params.context),
      message: `${relationship === "pj" ? "Encerramento contratual PJ" : "Desligamento"} iniciado pelo RH. Motivo: ${params.input.terminationReason}. Término previsto em ${params.input.terminationDate}.`,
      data: {
        terminationReason: params.input.terminationReason,
        terminationCause: params.input.terminationCause ?? null,
        terminationDate: params.input.terminationDate,
        employerUnitId: employer.unitId,
        employerEntityId: employer.entityId,
        employerCnpj: employer.cnpj,
        providerCnpj: pjContractSnapshot?.provider.cnpj ?? null,
        sourceContractHashSha256: pjContractSnapshot?.sourceContract.signedHashSha256 ?? null,
      },
    }),
    createHrTask(
      params.context,
      startedProcess,
      `Conduzir desligamento — ${startedProcess.employeeName}`,
      `Processo iniciado pelo RH. Término previsto em ${params.input.terminationDate}.`,
      "hr-managed-start",
      params.input.terminationDate,
    ).catch(() => null),
  ]);
  return { process: startedProcess, reused: false };
}

export async function createEmployeeResignationRequest(params: {
  context: ServerUserContext;
  file: File;
  noticePreference: "work" | "request_waiver";
  handwrittenLetterConfirmed: boolean;
  desiredLastDay?: string | null;
  notes?: string | null;
  appBaseUrl: string;
}) {
  const user = params.context.userDoc;
  if (user.employmentRelationshipType !== "clt" || user.isActive === false) {
    throw new Error("O pedido digital está disponível somente para vínculo CLT ativo.");
  }
  if (!params.handwrittenLetterConfirmed) {
    throw new Error("Confirme que a carta foi escrita à mão, datada e assinada.");
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
  const employer = await resolveTerminationEmployer({ user });
  await persistCollaboratorEmployer(user.id, employer);
  const accountantContact = await resolveCompanyProcessContact("termination", employer);
  const nowDate = new Date();
  const now = nowDate.toISOString();
  const processId = randomUUID();
  const protocol = processProtocol(nowDate);
  const originalBuffer = Buffer.from(await params.file.arrayBuffer());
  const originalHash = createHash("sha256").update(originalBuffer).digest("hex");
  const extension = params.file.type === "application/pdf" ? "pdf" : params.file.type === "image/png" ? "png" : "jpg";
  const letterStoragePath = `hr/termination/${processId}/request/original.${extension}`;
  const bucket = getStorage(adminApp).bucket(firebaseClientConfig.storageBucket);
  await bucket.file(letterStoragePath).save(originalBuffer, {
    resumable: false,
    metadata: { contentType: params.file.type, cacheControl: "private, no-store" },
  });

  const documents: TerminationDocument[] = [
    {
      id: randomUUID(), type: "resignation_letter", label: "Carta de pedido de demissão", fileName: safeFileName(params.file.name || `carta.${extension}`),
      mimeType: params.file.type, storagePath: letterStoragePath, contentHash: originalHash, visibility: "employee", auditStatus: "pending",
      version: 1, isCurrent: true, uploadedAt: now, uploadedBy: user.id,
    },
  ];
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
    employer,
    jobRoleName: user.jobRoleName ?? null,
    status: "hr_review",
    health: "on_track",
    progress: 0,
    currentSummary: "Conferência da carta",
    source: "employee_self_service",
    request: {
      noticePreference: params.noticePreference,
      desiredLastDay: params.desiredLastDay ?? null,
      notes: params.notes ?? null,
      submittedAt: now,
      protocol,
      handwrittenLetterConfirmedAt: now,
      identityStatus: "not_requested",
      letterVersion: 1,
    },
    accountant: { status: "not_started", recipientEmail: accountantContact?.email ?? null },
    payment: { status: "not_started" },
    employeeCompletion: { status: "not_started" },
    internalClosure: { status: "pending" },
    operational: { uniformsReturned: false, assetsReturned: false, scheduleRemoved: false, accessRevoked: false, benefitsClosed: false },
    accessRevocation: {
      pdv: { status: user.registrationIdPdv ? "pending" : "not_applicable", externalId: user.registrationIdPdv ?? null },
      bizneo: { status: user.registrationIdBizneo ? "pending" : "not_applicable", externalId: user.registrationIdBizneo ?? null },
      healthPlan: { status: "pending" },
      coalaOne: { status: "scheduled" },
    },
    documents,
    steps: createEmployeeResignationSteps(now),
    nextDueAt: null,
    lastActivityAt: now,
    createdAt: now,
    updatedAt: now,
  });

  await Promise.all([
    hrDbAdmin.collection(COLLECTION).doc(processId).set(process),
    appendTerminationEvent(processId, {
      type: "REQUEST_CREATED",
      at: now,
      actorId: user.id,
      actorName: getUserDisplayName(user, user.id),
      message: "Carta manuscrita enviada e encaminhada para conferência do RH.",
      data: { protocol, originalHash, letterVersion: 1, handwrittenLetterConfirmedAt: now, employerUnitId: employer.unitId, employerEntityId: employer.entityId, employerCnpj: employer.cnpj },
    }),
  ]);
  await createTerminationAsoShadow(process);
  const taskContext = await requireSystemTaskContext(user.id);
  if (taskContext) {
    await createHrTask(taskContext, process, `Conferir carta de demissão — ${process.employeeName}`, "Confira a carta manuscrita antes de solicitar a assinatura eletrônica.", "letter-review").catch(() => null);
  }
  await syncTerminationProjection(process);
  return { process, signatureUrl: null };
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
      documents = documents.map((document) => ["request_confirmation", "dismissal_notice"].includes(document.type) && document.isCurrent !== false ? {
        ...document,
        storagePath,
        contentHash: createHash("sha256").update(buffer).digest("hex"),
        auditStatus: "approved",
      } : document);
    }
  }
  const guidedFlow = process.steps.some((step) => step.id === "request_received");
  const employerDismissal = process.processType === "clt_hr_termination"
    && process.terminationReason === "Dispensa sem justa causa"
    && Boolean(process.dismissalCommunication);
  let steps = process.steps;
  if (guidedFlow) {
    steps = patchStep(steps, "identity_signature", { status: "completed", completedAt: now, completedBy: "system:autentique", note: "Identidade confirmada por SMS e pedido formalizado eletronicamente." });
    steps = patchStep(steps, "notice_decision", { status: "in_progress", startedAt: now, note: "Aguardando definição do aviso-prévio e das datas pelo RH." });
  } else if (employerDismissal) {
    steps = patchStep(steps, "request_validation_notice", { status: "completed", completedAt: now, completedBy: "system:autentique", blockedReason: null, note: "Comunicado oficial assinado pela empresa e pela colaboradora." });
    steps = patchStep(steps, "accountant", { status: "in_progress", startedAt: now, blockedReason: null, note: "Comunicado formalizado. Envio à contabilidade liberado." });
  } else {
    steps = patchStep(steps, "request_validation_notice", { status: "in_progress", startedAt: process.createdAt });
  }
  const updated = await saveTermination({
    ...process,
    status: guidedFlow || employerDismissal ? "active" : "hr_review",
    request: { ...process.request, identityStatus: "verified", formalizedAt: now },
    dismissalCommunication: employerDismissal ? { ...process.dismissalCommunication!, officialNoticeStatus: "signed", officialNoticeError: null } : process.dismissalCommunication,
    accountant: employerDismissal ? { ...(process.accountant ?? { status: "not_started" }), status: "ready_to_send" } : process.accountant,
    documents,
    steps,
    lastActivityAt: now,
    updatedAt: now,
  });
  await Promise.all([
    appendTerminationEvent(process.id, { type: employerDismissal ? "DISMISSAL_NOTICE_SIGNED" : "IDENTITY_VERIFIED", at: now, actorId: "system:autentique", actorName: "Autentique", message: employerDismissal ? "Comunicado oficial de dispensa assinado e arquivado." : "Identidade confirmada por assinatura eletrônica com validação por SMS." }),
    hrDbAdmin.collection("hrNotifications").doc(`termination_hr_review_${process.id}`).set({
      type: "termination_hr_review", status: "pending", terminationId: process.id, employeeId: process.employeeId,
      title: employerDismissal ? "Comunicado de dispensa assinado" : guidedFlow ? "Pedido formalizado — defina o aviso" : "Pedido de demissão aguardando validação",
      message: employerDismissal ? `O comunicado de ${process.employeeName} foi assinado. O envio à contabilidade está liberado.` : guidedFlow ? `${process.employeeName} concluiu a assinatura. Defina agora o aviso-prévio e as datas.` : `${process.employeeName} concluiu a assinatura do pedido.`,
      channels: ["in_app"], recipient: { strategy: "hr_pool" }, createdAt: now, updatedAt: now,
    }, { merge: true }),
  ]);
  const context = await requireSystemTaskContext(process.employeeId);
  if (context) await createHrTask(
    context,
    updated,
    employerDismissal ? `Enviar desligamento à contabilidade — ${process.employeeName}` : guidedFlow ? `Definir aviso e datas — ${process.employeeName}` : `Validar pedido de demissão — ${process.employeeName}`,
    employerDismissal ? "O comunicado oficial foi assinado. Confira os dados e envie o portal seguro à contabilidade." : guidedFlow ? "A carta foi aprovada e o pedido foi assinado. Confirme a data efetiva da comunicação e a decisão sobre o aviso-prévio." : "Confira a carta, a identidade e a manifestação do colaborador.",
    employerDismissal ? "accountant-send" : guidedFlow ? "notice-decision" : "hr-validation",
  ).catch(() => null);
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
  const employer = requireTerminationEmployer(process);
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
    employerUnitId: employer.unitId,
    employerUnitName: employer.legalName,
    employerLegalName: employer.legalName,
    employerCnpj: employer.cnpj,
    employerAddress: employer.address,
    publicFormAnswers: { fullName: process.employeeName, cpf: identity?.cpf ?? null },
    asoWorkflow: { status: "ready_to_generate", examType: "dismissal", updatedAt: now },
    documents: [],
    createdAt: now,
    updatedAt: now,
  });
}

async function sendEmployerDismissalNotice(params: { context: ServerUserContext; process: CltTerminationProcess }) {
  const { process } = params;
  if (!process.dismissalCommunication || process.terminationReason !== "Dispensa sem justa causa") {
    throw new Error("A comunicação presencial da dispensa sem justa causa não foi registrada.");
  }
  if (process.dismissalCommunication.officialNoticeStatus === "signed") return process;
  const now = new Date().toISOString();
  const employer = requireTerminationEmployer(process);
  const companySignatory = await resolveCompanyDocumentSignatory({ entityId: employer.entityId, cnpj: employer.cnpj });
  if (!companySignatory) throw new Error(`Defina o signatário documental da empresa ${employer.legalName} antes de enviar o comunicado.`);
  const identity = await loadExpectedIdentity(process.employeeId).catch(() => null);
  const cpf = String(identity?.cpf ?? "").replace(/\D/g, "");
  const noticeType = process.notice?.decision === "worked" ? "worked" : "indemnified";
  const buffer = await buildEmployerDismissalNotice({
    protocol: process.request.protocol,
    employeeName: process.employeeName,
    cpfMasked: process.employeeCpfMasked ?? maskCpf(cpf),
    companyName: employer.legalName,
    companyCnpj: CnpjValidator.format(employer.cnpj),
    companyAddress: employer.address,
    communicationAt: process.dismissalCommunication.occurredAt,
    communicationLocation: process.dismissalCommunication.location,
    responsibleName: process.dismissalCommunication.responsibleName,
    participants: process.dismissalCommunication.participants,
    noticeType,
    contractEndDate: process.notice?.contractEndDate ?? process.request.desiredLastDay ?? now.slice(0, 10),
  });
  const hash = createHash("sha256").update(buffer).digest("hex");
  const documentId = randomUUID();
  const storagePath = `hr/termination/${process.id}/request/dismissal-notice-${documentId}.pdf`;
  const bucket = getStorage(adminApp).bucket(firebaseClientConfig.storageBucket);
  await bucket.file(storagePath).save(buffer, { resumable: false, metadata: { contentType: "application/pdf", cacheControl: "private, no-store" } });
  let provider;
  try {
    provider = await createAutentiqueDocument({
      buffer,
      fileName: `comunicado-dispensa-${safeFileName(process.request.protocol)}.pdf`,
      documentName: `Comunicado de dispensa — ${process.employeeName}`,
      message: "Confira e assine o comunicado oficial do seu desligamento.",
      signers: [
        { email: companySignatory.email, name: companySignatory.name, action: "SIGN" },
        { email: process.employeeEmail, name: process.employeeName, action: "SIGN", ...(cpf.length === 11 ? { cpf } : {}) },
      ],
    });
  } catch (error) {
    await bucket.file(storagePath).delete({ ignoreNotFound: true });
    throw error;
  }
  const signatureRequestRef = hrDbAdmin.collection("hrSignatureRequests").doc();
  const documents = process.documents
    .map((document) => document.type === "dismissal_notice" && document.isCurrent !== false ? { ...document, isCurrent: false } : document)
    .concat({
      id: documentId,
      type: "dismissal_notice" as const,
      label: "Comunicado de dispensa sem justa causa",
      fileName: `comunicado-dispensa-${process.request.protocol}.pdf`,
      mimeType: "application/pdf",
      storagePath,
      contentHash: hash,
      visibility: "employee" as const,
      auditStatus: "pending" as const,
      signatureMode: "both" as const,
      signatureRequired: true,
      selectedForEmployee: true,
      version: process.documents.filter((document) => document.type === "dismissal_notice").length + 1,
      isCurrent: true,
      uploadedAt: now,
      uploadedBy: params.context.userDoc.id,
    });
  const steps = patchStep(process.steps, "request_validation_notice", {
    status: "waiting_external",
    startedAt: process.steps.find((step) => step.id === "request_validation_notice")?.startedAt ?? now,
    blockedReason: null,
    note: "Comunicação presencial registrada. Aguardando assinatura do comunicado oficial.",
  });
  const updated = await saveTermination({
    ...process,
    status: "active",
    request: { ...process.request, identityStatus: "pending_signature", signatureRequestId: signatureRequestRef.id, providerDocumentId: provider.document.id },
    dismissalCommunication: { ...process.dismissalCommunication, officialNoticeStatus: "pending_signature", officialNoticeError: null },
    documents,
    steps,
    lastActivityAt: now,
    updatedAt: now,
  });
  await Promise.all([
    signatureRequestRef.set({
      terminationId: process.id,
      terminationDocumentId: documentId,
      purpose: "employer_dismissal_notice",
      employeeId: process.employeeId,
      status: "sent",
      provider: "autentique",
      providerDocumentId: provider.document.id,
      signerEmail: process.employeeEmail,
      employerEntityId: employer.entityId,
      employerCnpj: employer.cnpj,
      companySignatoryUserId: companySignatory.userId,
      companySignatoryEmail: companySignatory.email,
      documentStoragePath: storagePath,
      documentHash: hash,
      sandbox: provider.sandbox,
      createdAt: now,
      updatedAt: now,
    }),
    appendTerminationEvent(process.id, { type: "DISMISSAL_NOTICE_SENT", at: now, ...eventActor(params.context), message: "Comunicado oficial de dispensa enviado para assinatura da empresa e da colaboradora." }),
  ]);
  return updated;
}

export async function retryEmployerDismissalNotice(params: { context: ServerUserContext; id: string }) {
  const process = await requireManagedProcess(params.context, params.id);
  return sendEmployerDismissalNotice({ context: params.context, process });
}

export async function formalizeEmployerDismissalNoticeRefusal(params: {
  context: ServerUserContext;
  id: string;
  witnessNames: string[];
  notes: string;
}) {
  const process = await requireManagedProcess(params.context, params.id);
  if (!process.dismissalCommunication || process.terminationReason !== "Dispensa sem justa causa") throw new Error("Este registro se aplica à dispensa sem justa causa.");
  if (["signed", "refusal_formalized"].includes(process.dismissalCommunication.officialNoticeStatus)) throw new Error("O comunicado já foi formalizado.");
  const witnessNames = params.witnessNames.map((name) => name.trim()).filter(Boolean);
  if (witnessNames.length < 2) throw new Error("Informe pelo menos duas testemunhas da recusa.");
  if (params.notes.trim().length < 3) throw new Error("Descreva a recusa da assinatura.");
  const now = new Date().toISOString();
  const actor = eventActor(params.context);
  let steps = patchStep(process.steps, "request_validation_notice", { status: "completed", completedAt: now, completedBy: params.context.userDoc.id, blockedReason: null, note: "Recusa de assinatura formalizada com testemunhas." });
  steps = patchStep(steps, "accountant", { status: "in_progress", startedAt: now, blockedReason: null, note: "Comunicação formalizada por registro de recusa. Envio à contabilidade liberado." });
  const documents = process.documents.map((document) => document.type === "dismissal_notice" && document.isCurrent !== false ? { ...document, auditStatus: "waived" as const, reviewNotes: "Assinatura recusada; recusa formalizada com testemunhas." } : document);
  const updated = await saveTermination({
    ...process,
    status: "active",
    request: { ...process.request, identityStatus: "manual_verified", formalizedAt: now },
    dismissalCommunication: {
      ...process.dismissalCommunication,
      officialNoticeStatus: "refusal_formalized",
      officialNoticeError: null,
      refusal: { recordedAt: now, recordedBy: params.context.userDoc.id, recordedByName: actor.actorName, witnessNames, notes: params.notes.trim() },
    },
    accountant: { ...(process.accountant ?? { status: "not_started" }), status: "ready_to_send" },
    documents,
    steps,
    lastActivityAt: now,
    updatedAt: now,
  });
  await appendTerminationEvent(process.id, { type: "DISMISSAL_NOTICE_REFUSAL_FORMALIZED", at: now, ...actor, message: "Recusa da assinatura do comunicado formalizada com duas testemunhas.", data: { witnessNames, notes: params.notes.trim() } });
  return updated;
}

export async function reviewTerminationLetter(params: {
  context: ServerUserContext;
  id: string;
  decision: "approved" | "correction_requested" | "exception_review";
  notes?: string | null;
  appBaseUrl: string;
}) {
  const process = await requireManagedProcess(params.context, params.id);
  if (process.processType !== "clt_employee_resignation") throw new Error("Esta ação se aplica somente ao pedido de demissão do colaborador.");
  if (process.request.identityStatus !== "not_requested") throw new Error("A carta desta versão já foi formalizada.");
  const letter = process.documents.find((document) => document.type === "resignation_letter" && document.isCurrent !== false);
  if (!letter) throw new Error("A carta manuscrita atual não foi encontrada.");
  const now = new Date().toISOString();
  const actor = eventActor(params.context);
  const notes = params.notes?.trim() || null;

  if (params.decision !== "approved") {
    if (!notes || notes.length < 3) throw new Error("Informe a orientação ou o motivo da análise excepcional.");
    const documents = process.documents.map((document) => document.id === letter.id ? {
      ...document,
      auditStatus: params.decision === "correction_requested" ? "correction_required" as const : "pending" as const,
      correctionReason: notes,
      reviewedAt: now,
      reviewedBy: params.context.userDoc.id,
    } : document);
    const steps = patchStep(process.steps, "letter_review", params.decision === "correction_requested" ? {
      status: "waiting_external",
      note: notes,
      blockedReason: null,
    } : {
      status: "blocked",
      blockedReason: notes,
      note: notes,
    });
    let communication: { id?: string } | null = null;
    if (params.decision === "correction_requested") {
      communication = await sendEmail({
        from: EMAIL_SENDERS.formalization,
        to: process.employeeEmail,
        subject: `Correção da carta de demissão — ${process.request.protocol}`,
        html: renderTerminationLetterCorrectionEmail({ employeeName: process.employeeName, protocol: process.request.protocol, reason: notes, requestUrl: `${params.appBaseUrl.replace(/\/$/, "")}/dashboard/resignation` }),
        text: `Olá, ${process.employeeName}. O RH solicitou uma correção na carta do pedido de demissão: ${notes}`,
        tags: [{ name: "category", value: "termination_letter_correction" }, { name: "termination_id", value: process.id.slice(0, 256) }],
      });
      await hrDbAdmin.collection("emailCommunications").doc(`termination_letter_${process.id}_${process.request.letterVersion ?? 1}`).set({
        terminationId: process.id,
        category: "termination_letter_correction",
        recipient: process.employeeEmail,
        providerId: communication.id ?? null,
        status: "accepted",
        acceptedAt: now,
        createdAt: now,
        updatedAt: now,
      });
    }
    const updated = await saveTermination({
      ...process,
      status: "hr_review",
      hrValidation: { status: params.decision, at: now, by: params.context.userDoc.id, byName: actor.actorName, notes },
      documents,
      steps,
      lastActivityAt: now,
      updatedAt: now,
    });
    await appendTerminationEvent(process.id, {
      type: params.decision === "correction_requested" ? "LETTER_CORRECTION_REQUESTED" : "LETTER_EXCEPTION_REVIEW",
      at: now,
      ...actor,
      message: params.decision === "correction_requested" ? "RH solicitou uma nova versão da carta manuscrita." : "Carta encaminhada para análise excepcional.",
      data: { notes, letterVersion: process.request.letterVersion ?? 1, providerId: communication?.id ?? null },
    });
    return updated;
  }

  const employeeSnapshot = await dbAdmin.collection("users").doc(process.employeeId).get();
  const phone = normalizePhone(employeeSnapshot.get("phone"));
  if (!phone || !employeeSnapshot.get("phoneVerifiedAt")) throw new Error("O celular do colaborador precisa estar verificado antes da formalização.");
  const identity = await loadExpectedIdentity(process.employeeId);
  const cpf = String(identity?.cpf ?? "").replace(/\D/g, "");
  if (cpf.length !== 11) throw new Error("O CPF do colaborador precisa estar validado.");
  const bucket = getStorage(adminApp).bucket(firebaseClientConfig.storageBucket);
  const [letterBuffer] = await bucket.file(letter.storagePath).download();
  const confirmation = await buildTerminationRequestConfirmation({
    protocol: process.request.protocol,
    employeeName: process.employeeName,
    cpfMasked: maskCpf(cpf),
    companyName: requireTerminationEmployer(process).legalName,
    companyCnpj: CnpjValidator.format(requireTerminationEmployer(process).cnpj),
    companyAddress: requireTerminationEmployer(process).address,
    submittedAt: now,
    noticePreference: process.request.noticePreference,
    desiredLastDay: process.request.desiredLastDay,
    originalHash: letter.contentHash,
    originalMimeType: letter.mimeType,
    originalBuffer: letterBuffer,
  });
  const confirmationHash = createHash("sha256").update(confirmation).digest("hex");
  const confirmationStoragePath = `hr/termination/${process.id}/request/confirmation-v${process.request.letterVersion ?? 1}.pdf`;
  await bucket.file(confirmationStoragePath).save(confirmation, { resumable: false, metadata: { contentType: "application/pdf", cacheControl: "private, no-store" } });
  let provider;
  try {
    provider = await createAutentiqueDocument({
      buffer: confirmation,
      fileName: `comprovante-${safeFileName(process.request.protocol)}.pdf`,
      documentName: `Pedido de demissão — ${process.employeeName}`,
      message: "Confirme sua identidade por SMS, confira a carta aprovada pelo RH e assine o pedido de demissão.",
      signers: [{ email: process.employeeEmail, name: process.employeeName, action: "SIGN", cpf, requireSmsVerificationPhone: phone }],
    });
  } catch (error) {
    await bucket.file(confirmationStoragePath).delete({ ignoreNotFound: true });
    throw error;
  }
  const signatureRequestRef = hrDbAdmin.collection("hrSignatureRequests").doc();
  const confirmationDocument: TerminationDocument = {
    id: randomUUID(),
    type: "request_confirmation",
    label: "Comprovante eletrônico do pedido",
    fileName: `comprovante-${process.request.protocol}.pdf`,
    mimeType: "application/pdf",
    storagePath: confirmationStoragePath,
    contentHash: confirmationHash,
    visibility: "employee",
    auditStatus: "pending",
    signatureRequired: true,
    version: process.request.letterVersion ?? 1,
    isCurrent: true,
    uploadedAt: now,
    uploadedBy: params.context.userDoc.id,
  };
  let steps = patchStep(process.steps, "letter_review", { status: "completed", completedAt: now, completedBy: params.context.userDoc.id, note: notes ?? "Carta manuscrita aprovada pelo RH.", blockedReason: null });
  steps = patchStep(steps, "identity_signature", { status: "waiting_external", startedAt: now, note: "Aguardando assinatura eletrônica com confirmação por SMS." });
  const documents = process.documents.map((document) => document.id === letter.id ? {
    ...document,
    auditStatus: "approved" as const,
    correctionReason: null,
    reviewedAt: now,
    reviewedBy: params.context.userDoc.id,
  } : document).filter((document) => document.type !== "request_confirmation" || document.isCurrent === false);
  documents.push(confirmationDocument);
  const updated = await saveTermination({
    ...process,
    status: "identity_pending",
    hrValidation: { status: "confirmed", at: now, by: params.context.userDoc.id, byName: actor.actorName, notes },
    request: {
      ...process.request,
      identityStatus: "pending_signature",
      letterApprovedAt: now,
      letterApprovedBy: params.context.userDoc.id,
      signatureRequestId: signatureRequestRef.id,
      providerDocumentId: provider.document.id,
    },
    documents,
    steps,
    lastActivityAt: now,
    updatedAt: now,
  });
  await Promise.all([
    signatureRequestRef.set({
      terminationId: process.id,
      purpose: "termination_request_identity",
      employeeId: process.employeeId,
      status: "sent",
      provider: "autentique",
      providerDocumentId: provider.document.id,
      signerEmail: process.employeeEmail,
      signerPhoneMasked: maskPhone(phone),
      documentStoragePath: confirmationStoragePath,
      documentHash: confirmationHash,
      sandbox: provider.sandbox,
      createdAt: now,
      updatedAt: now,
    }),
    appendTerminationEvent(process.id, { type: "LETTER_APPROVED_SIGNATURE_SENT", at: now, ...actor, message: "Carta aprovada e comprovante encaminhado ao colaborador para assinatura com confirmação por SMS.", data: { letterVersion: process.request.letterVersion ?? 1, signatureRequestId: signatureRequestRef.id } }),
  ]);
  return updated;
}

export async function replaceTerminationLetter(params: {
  context: ServerUserContext;
  id: string;
  file: File;
  handwrittenLetterConfirmed: boolean;
}) {
  const process = await getTermination(params.id);
  if (!process || process.employeeId !== params.context.userDoc.id) throw new Error("Pedido de demissão não encontrado.");
  if (process.hrValidation?.status !== "correction_requested") throw new Error("O RH não solicitou uma nova versão da carta.");
  if (!params.handwrittenLetterConfirmed) throw new Error("Confirme que a nova carta foi escrita à mão, datada e assinada.");
  if (!ALLOWED_LETTER_TYPES.has(params.file.type) || params.file.size <= 0 || params.file.size > MAX_LETTER_BYTES) throw new Error("Envie a carta em PDF, JPG ou PNG, com no máximo 12 MB.");
  const version = (process.request.letterVersion ?? 1) + 1;
  const extension = params.file.type === "application/pdf" ? "pdf" : params.file.type === "image/png" ? "png" : "jpg";
  const buffer = Buffer.from(await params.file.arrayBuffer());
  const contentHash = createHash("sha256").update(buffer).digest("hex");
  const storagePath = `hr/termination/${process.id}/request/letter-v${version}.${extension}`;
  await getStorage(adminApp).bucket(firebaseClientConfig.storageBucket).file(storagePath).save(buffer, { resumable: false, metadata: { contentType: params.file.type, cacheControl: "private, no-store" } });
  const previous = process.documents.find((document) => document.type === "resignation_letter" && document.isCurrent !== false);
  const now = new Date().toISOString();
  const documents = process.documents.map((document) => document.type === "resignation_letter" && document.isCurrent !== false ? { ...document, isCurrent: false } : document);
  documents.push({
    id: randomUUID(), type: "resignation_letter", label: `Carta de pedido de demissão — versão ${version}`,
    fileName: safeFileName(params.file.name || `carta-v${version}.${extension}`), mimeType: params.file.type, storagePath, contentHash,
    visibility: "employee", auditStatus: "pending", version, isCurrent: true, supersedesId: previous?.id ?? null,
    uploadedAt: now, uploadedBy: process.employeeId,
  });
  const steps = patchStep(process.steps, "letter_review", { status: "in_progress", startedAt: process.steps.find((step) => step.id === "letter_review")?.startedAt ?? now, note: `Nova versão ${version} recebida para conferência.`, blockedReason: null, completedAt: null, completedBy: null });
  const updated = await saveTermination({
    ...process,
    status: "hr_review",
    hrValidation: null,
    request: { ...process.request, letterVersion: version, identityStatus: "not_requested", signatureRequestId: null, providerDocumentId: null, letterApprovedAt: null, letterApprovedBy: null },
    documents,
    steps,
    lastActivityAt: now,
    updatedAt: now,
  });
  await appendTerminationEvent(process.id, { type: "LETTER_REPLACED", at: now, actorId: process.employeeId, actorName: process.employeeName, message: `Colaborador enviou a versão ${version} da carta manuscrita.`, data: { version, contentHash, supersedesId: previous?.id ?? null } });
  const taskContext = await requireSystemTaskContext(process.employeeId);
  if (taskContext) await createHrTask(taskContext, updated, `Revisar nova carta — ${process.employeeName}`, `A versão ${version} foi enviada após a devolutiva do RH.`, `letter-review-v${version}`).catch(() => null);
  return updated;
}

export async function validateTerminationRequest(params: { context: ServerUserContext; id: string; notes?: string | null }) {
  const process = await requireManagedProcess(params.context, params.id);
  if (process.steps.some((step) => step.id === "request_received")) {
    throw new Error("Use a conferência da carta para conduzir este pedido de demissão.");
  }
  if (!["verified", "manual_verified"].includes(process.request.identityStatus)) {
    throw new Error("A confirmação de identidade ainda não foi concluída.");
  }
  const now = new Date().toISOString();
  let steps = patchStep(process.steps, "request_validation_notice", { status: "in_progress", startedAt: process.createdAt, note: "Identidade confirmada e manifestação validada pelo RH. Aguardando definição do aviso-prévio." });
  steps = patchStep(steps, "aso", { status: "pending", note: "Aguardando a devolução dos uniformes." });
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
  await appendTerminationEvent(process.id, { type: "HR_VALIDATED", at: now, ...eventActor(params.context), message: "RH validou o pedido. A devolução dos uniformes antecede o ASO demissional." });
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
  if (process.steps.some((step) => step.id === "request_received") && !["verified", "manual_verified"].includes(process.request.identityStatus)) {
    throw new Error("Aguarde a assinatura eletrônica e a confirmação da identidade antes de definir o aviso-prévio.");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(params.communicationDate)) throw new Error("Confirme a data efetiva da comunicação.");
  const communicationDate = params.communicationDate;
  const calculated = params.decision === "worked" ? calculateNoticeDates(communicationDate) : null;
  const contractEndDate = params.contractEndDate || calculated?.contractEndDate || communicationDate;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(contractEndDate) || contractEndDate < communicationDate) throw new Error("A data de término não pode ser anterior à comunicação.");
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
  const guidedFlow = process.steps.some((step) => step.id === "request_received");
  let steps = guidedFlow
    ? patchStep(process.steps, "notice_decision", { status: "completed", completedAt: now, completedBy: params.context.userDoc.id, note: "Aviso-prévio e datas oficiais confirmados." })
    : patchStep(process.steps, "request_validation_notice", { status: "completed", completedAt: now, completedBy: params.context.userDoc.id, note: "Pedido, identidade, validação e aviso-prévio concluídos." });
  steps = patchStep(steps, "uniform_return", { dueAt: contractEndDate });
  steps = patchStep(steps, "aso", { dueAt: legalPaymentDueDate });
  for (const id of ["accountant", "signatures"] as const) steps = patchStep(steps, id, { dueAt: legalPaymentDueDate });
  if (guidedFlow) {
    steps = patchStep(steps, "accountant", { status: "in_progress", startedAt: now, blockedReason: null, note: "Aviso e datas definidos. Prepare o envio à contabilidade." });
    steps = patchStep(steps, "termination_payment", { dueAt: legalPaymentDueDate });
  } else {
    for (const id of ["document_audit", "legal_obligations"] as const) steps = patchStep(steps, id, { dueAt: legalPaymentDueDate });
    steps = patchStep(steps, "legal_obligations", { status: "in_progress", startedAt: now });
  }
  steps = patchStep(steps, "access_revocation", {
    status: "blocked",
    dueAt: contractEndDate,
    blockedReason: `Aguardando o término do contrato em ${contractEndDate}.`,
  });
  const updated = await saveTermination({
    ...process,
    notice: { decision: params.decision, communicationDate, noticeStartDate: params.decision === "worked" ? calculated?.noticeStartDate ?? null : null, contractEndDate, legalPaymentDueDate, notes: params.notes ?? null, decidedAt: now, decidedBy: params.context.userDoc.id },
    steps,
    lastActivityAt: now,
    updatedAt: now,
  });
  await Promise.all([
    createHrTask(params.context, updated, `Cumprir prazo rescisório — ${process.employeeName}`, `Pagamento e documentos até ${legalPaymentDueDate}.`, "legal-deadline", legalPaymentDueDate).catch(() => null),
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
  if (["request_validation_notice", "request_received", "letter_review", "employee_request", "identity_signature", "hr_validation", "notice_decision", "uniform_return", "aso", "accountant", "document_audit", "signatures", "termination_payment", "employee_delivery", "closure"].includes(params.stepId)) {
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

export async function syncTerminationUniformReturn(params: {
  context: ServerUserContext;
  id: string;
}) {
  const process = await requireManagedProcess(params.context, params.id);
  const requestStep = process.steps.find((step) => step.id === "request_validation_notice");
  const guidedFlow = process.steps.some((step) => step.id === "request_received");
  if (!guidedFlow && requestStep?.status !== "completed") {
    throw new Error("Conclua a abertura, validação e definição do término antes de validar os uniformes.");
  }
  const assignments = await dbAdmin
    .collection("uniformAssignments")
    .where("workspaceId", "==", WORKSPACE_ID)
    .get();
  const pendingAssignments = assignments.docs
    .filter((document) => document.get("collaboratorUserId") === process.employeeId)
    .map((document) => Number(document.get("quantityInPossession") ?? 0))
    .filter((quantity) => quantity > 0);
  const pendingPieces = pendingAssignments.reduce((total, quantity) => total + quantity, 0);
  const now = new Date().toISOString();
  const current = process.steps.find((step) => step.id === "uniform_return");
  const completed = pendingPieces === 0;
  const steps = patchStep(process.steps, "uniform_return", completed ? {
    status: "completed",
    startedAt: current?.startedAt ?? now,
    completedAt: now,
    completedBy: params.context.userDoc.id,
    note: "Nenhuma peça permanece em posse do colaborador.",
  } : {
    status: "in_progress",
    startedAt: current?.startedAt ?? now,
    completedAt: null,
    completedBy: null,
    note: `${pendingPieces} peça(s) ainda em posse do colaborador.`,
  });
  const updated = await saveTermination({
    ...process,
    operational: {
      ...(process.operational ?? {
        assetsReturned: false,
        scheduleRemoved: false,
        accessRevoked: false,
        benefitsClosed: false,
      }),
      uniformsReturned: completed,
    },
    steps,
    lastActivityAt: now,
    updatedAt: now,
  });
  if (current?.status !== steps.find((step) => step.id === "uniform_return")?.status || current?.note !== steps.find((step) => step.id === "uniform_return")?.note) {
    await appendTerminationEvent(process.id, {
      type: completed ? "UNIFORMS_RETURNED" : "UNIFORMS_RETURN_PENDING",
      at: now,
      ...eventActor(params.context),
      message: completed
        ? "Devolução de uniformes validada sem peças pendentes."
        : `Devolução de uniformes pendente: ${pendingPieces} peça(s) ainda em posse.`,
      data: { pendingPieces },
    });
  }
  if (process.employmentRelationshipType === "clt") await createTerminationAsoShadow(updated);
  return { process: updated, pendingPieces };
}

export async function revokeTerminationAccess(params: {
  context: ServerUserContext;
  id: string;
  target: "pdv" | "bizneo" | "healthPlan";
}) {
  if (!["pdv", "bizneo", "healthPlan"].includes(params.target)) throw new Error("Sistema de acesso inválido.");
  const process = await requireManagedProcess(params.context, params.id);
  if ((process.processType === "clt_employee_resignation" || isGuidedEmployerDismissal(process)) && process.employeeCompletion?.status !== "completed") {
    throw new Error("Conclua primeiro a entrega final ao colaborador.");
  }
  if (!process.notice) throw new Error("Defina o término do contrato antes de bloquear acessos.");
  const today = belemDateOnly();
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
    const storedAccesses = Array.isArray(user.pdvAccesses)
      ? user.pdvAccesses.filter((entry): entry is Record<string, unknown> => Boolean(entry && typeof entry === "object" && !Array.isArray(entry)))
      : [];
    const externalIds = Array.from(new Set([
      ...storedAccesses
        .filter((entry) => entry.status !== "inactive")
        .map((entry) => asString(entry.externalUserId))
        .filter((value): value is string => Boolean(value)),
      asString(user.registrationIdPdv),
    ].filter((value): value is string => Boolean(value))));
    if (externalIds.length === 0) {
      accessRevocation.pdv = { status: "not_applicable", externalId: null, completedAt: now, completedBy: params.context.userDoc.id };
    } else {
      const removedIds: string[] = [];
      const failures: string[] = [];
      for (const externalId of externalIds) {
        try {
          await deletePdvLegalUser(externalId);
          removedIds.push(externalId);
        } catch (error) {
          failures.push(`${externalId}: ${error instanceof Error ? error.message : "falha ao remover"}`);
        }
      }
      const nextPdvAccesses = storedAccesses.map((entry) => removedIds.includes(asString(entry.externalUserId) ?? "")
        ? { ...entry, status: "inactive", updatedAt: now }
        : entry);
      await userSnap.ref.set({
        pdvAccesses: nextPdvAccesses,
        ...(failures.length === 0 ? {
          registrationIdPdv: null,
          pdvAccessProfileId: null,
          pdvAccessProfileName: null,
          pdvAccessFilialId: null,
          pdvAccessFilialName: null,
        } : {}),
        updatedAt: now,
      }, { merge: true });
      const externalId = externalIds.join(",");
      if (failures.length === 0) {
        accessRevocation.pdv = { status: "completed", externalId, completedAt: now, completedBy: params.context.userDoc.id, error: null };
      } else {
        const error = `Não foi possível remover todos os acessos do PDV: ${failures.join(" | ")}`;
        accessRevocation.pdv = { status: "failed", externalId, error };
        await saveTermination({ ...process, accessRevocation, lastActivityAt: now, updatedAt: now });
        throw new Error(error);
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

export async function completeTerminationOperations(params: {
  context: ServerUserContext;
  id: string;
  scheduleRemoved: boolean;
  benefitsClosed: boolean;
  assetsReturned: boolean;
  notes?: string | null;
}) {
  const process = await requireManagedProcess(params.context, params.id);
  if (process.employeeCompletion?.status !== "completed") throw new Error("Conclua primeiro a entrega final ao colaborador.");
  const accessDone = process.steps.find((step) => step.id === "access_revocation")?.status === "completed";
  if (!accessDone) throw new Error("Conclua o bloqueio dos acessos antes do encerramento operacional.");
  if (!params.scheduleRemoved || !params.benefitsClosed) throw new Error("Confirme a retirada das escalas e o encerramento dos benefícios aplicáveis.");
  const now = new Date().toISOString();
  const steps = patchStep(process.steps, "operational", { status: "completed", completedAt: now, completedBy: params.context.userDoc.id, note: params.notes?.trim() || "Rotinas internas concluídas." });
  const updated = await saveTermination({
    ...process,
    operational: { ...(process.operational ?? { uniformsReturned: false, accessRevoked: false }), scheduleRemoved: true, benefitsClosed: true, assetsReturned: params.assetsReturned, notes: params.notes?.trim() || null },
    steps,
    status: "closing_review",
    lastActivityAt: now,
    updatedAt: now,
  });
  await appendTerminationEvent(process.id, { type: "INTERNAL_OPERATIONS_COMPLETED", at: now, ...eventActor(params.context), message: "Acessos, escalas, benefícios e rotinas internas foram conferidos." });
  return updated;
}

export async function sendTerminationEmployeePackage(params: { context: ServerUserContext; id: string; appBaseUrl: string; recipientEmail?: string | null }) {
  const process = await requireManagedProcess(params.context, params.id);
  const signaturesDone = ["completed", "waived"].includes(process.steps.find((step) => step.id === "signatures")?.status ?? "");
  const paymentDone = ["paid", "not_applicable"].includes(process.payment?.status ?? "");
  if (!signaturesDone || !paymentDone) throw new Error("Conclua as assinaturas e o pagamento antes da entrega final.");
  const recipient = (params.recipientEmail?.trim() || process.employeeEmail).toLowerCase();
  if (!recipient.includes("@")) throw new Error("Informe um e-mail válido do colaborador.");
  const token = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const expiresAt = new Date(Date.now() + 90 * 86_400_000).toISOString();
  const url = `${params.appBaseUrl}/desligamento/documentos/${token}`;
  const now = new Date().toISOString();
  const emailResult = await sendEmail({
    from: EMAIL_SENDERS.formalization,
    to: recipient,
    subject: `Documentos finais do desligamento — ${process.request.protocol}`,
    html: renderTerminationEmployeeCompletionEmail({ employeeName: process.employeeName, protocol: process.request.protocol, documentsUrl: url }),
    text: `Olá, ${process.employeeName}. Seus documentos finais estão disponíveis em: ${url}`,
    tags: [{ name: "category", value: "termination_employee_completion" }, { name: "termination_id", value: process.id.slice(0, 256) }],
  });
  const communication = { providerId: emailResult.id ?? null, status: "accepted", deliveredAt: null, openedAt: null, clickedAt: null, lastError: null };
  await hrDbAdmin.collection("emailCommunications").doc(`termination_employee_completion_${process.id}`).set({ terminationId: process.id, category: "termination_employee_completion", recipient, providerId: emailResult.id ?? null, status: "accepted", acceptedAt: now, createdAt: now, updatedAt: now });
  let steps = patchStep(process.steps, "employee_delivery", { status: "completed", completedAt: now, completedBy: params.context.userDoc.id, note: "Pacote final enviado ao e-mail do colaborador." });
  if (steps.find((step) => step.id === "access_revocation")?.status === "pending") {
    steps = patchStep(steps, "access_revocation", { status: process.notice && new Date().toISOString().slice(0, 10) >= process.notice.contractEndDate ? "in_progress" : "blocked", startedAt: process.notice && new Date().toISOString().slice(0, 10) >= process.notice.contractEndDate ? now : null, blockedReason: process.notice && new Date().toISOString().slice(0, 10) < process.notice.contractEndDate ? `Aguardando o término do contrato em ${process.notice.contractEndDate}.` : null });
  }
  const updated = await saveTermination({
    ...process,
    status: "employee_completed",
    employeeCompletion: { status: "completed", tokenHash, tokenExpiresAt: expiresAt, recipientEmail: recipient, sentAt: now, completedAt: now, communication },
    steps,
    lastActivityAt: now,
    updatedAt: now,
  });
  await appendTerminationEvent(process.id, { type: "EMPLOYEE_COMPLETION_SENT", at: now, ...eventActor(params.context), message: `Pacote final disponibilizado ao colaborador em ${recipient}.`, data: { providerId: emailResult.id ?? null } });
  return updated;
}

export async function getTerminationByEmployeeDeliveryToken(token: string) {
  const hash = createHash("sha256").update(token).digest("hex");
  const snapshot = await hrDbAdmin.collection(COLLECTION).where("employeeCompletion.tokenHash", "==", hash).limit(1).get();
  const process = snapshot.docs[0] ? await getTermination(snapshot.docs[0].id) : null;
  if (!process || !process.employeeCompletion?.tokenExpiresAt || process.employeeCompletion.tokenExpiresAt < new Date().toISOString()) throw new Error("Link inválido ou expirado.");
  return process;
}

export async function completeEmployeeResignation(params: {
  context: ServerUserContext;
  id: string;
  reservations?: Array<{ type: "uniforms_not_returned" | "aso_no_show"; note: string }>;
  recipientEmail?: string | null;
}) {
  const process = await requireManagedProcess(params.context, params.id);
  if (process.processType !== "clt_employee_resignation" && !isGuidedEmployerDismissal(process)) throw new Error("Este fechamento se aplica aos fluxos guiados de desligamento CLT.");
  if (!process.notice) throw new Error("Defina o aviso-prévio e a data de término.");
  const blocking = process.steps.filter((step) => step.required && !["closure"].includes(step.id) && !["completed", "waived"].includes(step.status));
  if (blocking.length) throw new Error(`Ainda existem etapas obrigatórias: ${blocking.map((step) => step.label).join(", ")}.`);
  const assignments = await dbAdmin.collection("uniformAssignments").where("workspaceId", "==", WORKSPACE_ID).get();
  const pendingPieces = assignments.docs.filter((document) => document.get("collaboratorUserId") === process.employeeId).reduce((total, document) => total + Math.max(0, Number(document.get("quantityInPossession") ?? 0)), 0);
  const asoCompleted = ["completed", "waived"].includes(process.steps.find((step) => step.id === "aso")?.status ?? "");
  const requested = params.reservations ?? [];
  const uniformReservation = requested.find((reservation) => reservation.type === "uniforms_not_returned");
  const asoReservation = requested.find((reservation) => reservation.type === "aso_no_show");
  if (pendingPieces > 0 && (!uniformReservation || uniformReservation.note.trim().length < 3)) throw new Error("Registre a ressalva dos uniformes não devolvidos.");
  if (!asoCompleted) {
    const shadow = await hrDbAdmin.collection("onboardingProcesses").doc(process.id).get();
    const workflow = (shadow.get("asoWorkflow") ?? {}) as Record<string, any>;
    const appointmentAt = asString(workflow.appointmentAt);
    if (!appointmentAt || new Date(appointmentAt).getTime() > Date.now()) throw new Error("O ASO pendente só pode ser encerrado como não comparecimento após um agendamento vencido.");
    if (!asoReservation || asoReservation.note.trim().length < 3) throw new Error("Registre a ressalva do não comparecimento ao ASO.");
  }
  const now = new Date().toISOString();
  const reservations: NonNullable<CltTerminationProcess["internalClosure"]>["reservations"] = [];
  if (pendingPieces > 0 && uniformReservation) reservations.push({ type: "uniforms_not_returned", note: uniformReservation.note.trim(), pendingPieces, recordedAt: now, recordedBy: params.context.userDoc.id });
  if (!asoCompleted && asoReservation) {
    const shadow = await hrDbAdmin.collection("onboardingProcesses").doc(process.id).get();
    reservations.push({ type: "aso_no_show", note: asoReservation.note.trim(), appointmentAt: asString((shadow.get("asoWorkflow") as Record<string, unknown> | undefined)?.appointmentAt), recordedAt: now, recordedBy: params.context.userDoc.id });
  }
  let communication: NonNullable<CltTerminationProcess["internalClosure"]>["communication"] = null;
  if (reservations.length) {
    const recipient = (params.recipientEmail?.trim() || process.employeeCompletion?.recipientEmail || process.employeeEmail).toLowerCase();
    if (!recipient.includes("@")) throw new Error("Informe um e-mail válido para comunicar as ressalvas.");
    const labels = reservations.map((reservation) => reservation.type === "uniforms_not_returned" ? `${reservation.pendingPieces} peça(s) de uniforme permanecem registradas em posse.` : `Não comparecimento ao ASO agendado${reservation.appointmentAt ? ` para ${new Date(reservation.appointmentAt).toLocaleString("pt-BR")}` : ""}.`);
    const emailResult = await sendEmail({
      from: EMAIL_SENDERS.formalization,
      to: recipient,
      subject: `Pendências do encerramento — ${process.request.protocol}`,
      html: renderTerminationInternalReservationsEmail({ employeeName: process.employeeName, protocol: process.request.protocol, reservations: labels }),
      text: `Olá, ${process.employeeName}. O RH registrou as seguintes ocorrências no encerramento interno:\n${labels.join("\n")}`,
      tags: [{ name: "category", value: "termination_internal_reservations" }, { name: "termination_id", value: process.id.slice(0, 256) }],
    });
    communication = { recipientEmail: recipient, providerId: emailResult.id ?? null, status: "accepted", sentAt: now };
    await hrDbAdmin.collection("emailCommunications").doc(`termination_internal_reservations_${process.id}`).set({ terminationId: process.id, category: "termination_internal_reservations", recipient, providerId: emailResult.id ?? null, status: "accepted", acceptedAt: now, createdAt: now, updatedAt: now });
  }
  let steps = patchStep(process.steps, "closure", { status: "completed", startedAt: now, completedAt: now, completedBy: params.context.userDoc.id, note: reservations.length ? "Processo finalizado com ressalvas internas." : "Processo finalizado sem pendências." });
  if (uniformReservation) steps = patchStep(steps, "uniform_return", { status: "waived", completedAt: now, completedBy: params.context.userDoc.id, note: uniformReservation.note.trim() });
  else if (pendingPieces === 0 && !["completed", "waived"].includes(steps.find((step) => step.id === "uniform_return")?.status ?? "")) steps = patchStep(steps, "uniform_return", { status: "completed", completedAt: now, completedBy: params.context.userDoc.id, note: "Nenhuma peça permanece em posse do colaborador." });
  if (asoReservation) steps = patchStep(steps, "aso", { status: "waived", completedAt: now, completedBy: params.context.userDoc.id, note: asoReservation.note.trim() });
  await Promise.all([
    authAdmin.updateUser(process.employeeId, { disabled: true }),
    dbAdmin.collection("users").doc(process.employeeId).set({ isActive: false, employmentStatus: "terminated", inactivationType: "contract_termination", terminationDate: process.notice.contractEndDate, terminationReason: process.terminationReason ?? (process.processType === "clt_employee_resignation" ? "Pedido de demissão" : null), terminationCause: process.terminationCause ?? null, terminationNotes: process.terminationNotes ?? null, terminationInternalReason: process.terminationInternalReason ?? null, terminationRelationshipType: process.employmentRelationshipType, terminationProcessId: process.id, terminationEmployerUnitId: process.employer?.unitId ?? null, terminationEmployerName: process.employer?.legalName ?? null, terminationEmployerCnpj: process.employer?.cnpj ?? null, terminationEmployerEntityId: process.employer?.entityId ?? null, updatedAt: now }, { merge: true }),
  ]);
  const financialProvisionClosure = await closeFutureFinancialProvisions(params.context, process, process.notice.contractEndDate, now);
  const updated = await saveTermination({
    ...process,
    status: "completed",
    steps,
    internalClosure: { status: reservations.length ? "completed_with_reservations" : "completed", reservations, communication, completedAt: now, completedBy: params.context.userDoc.id },
    financialProvisionClosure,
    accessRevocation: { ...(process.accessRevocation ?? { pdv: { status: "not_applicable" }, bizneo: { status: "not_applicable" }, healthPlan: { status: "not_applicable" } }), coalaOne: { status: "completed", completedAt: now } },
    completedAt: now,
    lastActivityAt: now,
    updatedAt: now,
  });
  await hrDbAdmin.collection("terminationActiveByEmployee").doc(process.employeeId).delete().catch(() => undefined);
  await recalculateEmploymentEndRetention({ employeeId: process.employeeId, employmentEndedAt: process.notice.contractEndDate, actorId: params.context.userDoc.id });
  await appendTerminationEvent(process.id, {
    type: financialProvisionClosure.status === "completed" ? "FINANCIAL_PROVISIONS_CLOSED" : "FINANCIAL_PROVISIONS_CLOSURE_FAILED",
    at: now,
    ...eventActor(params.context),
    message: financialProvisionClosure.status === "completed"
      ? `${financialProvisionClosure.cancelledCount} provisão(ões) futura(s) de salário e vale-transporte cancelada(s).`
      : "O cancelamento automático das provisões futuras falhou e gerou uma tarefa de revisão.",
    data: { cancelledExpenseIds: financialProvisionClosure.cancelledExpenseIds, error: financialProvisionClosure.error ?? null },
  });
  await appendTerminationEvent(process.id, { type: reservations.length ? "COMPLETED_WITH_RESERVATIONS" : "COMPLETED", at: now, ...eventActor(params.context), message: reservations.length ? "Desligamento finalizado com ressalvas de ASO e/ou uniformes." : "Desligamento concluído sem pendências." });
  return updated;
}

export async function completeTermination(params: { context: ServerUserContext; id: string }) {
  const process = await requireManagedProcess(params.context, params.id);
  if (process.processType === "clt_employee_resignation" && process.steps.some((step) => step.id === "request_received")) {
    throw new Error("Use a finalização total do pedido de demissão para registrar ASO, uniformes e eventuais ressalvas.");
  }
  if (isGuidedEmployerDismissal(process)) {
    throw new Error("Use a finalização total guiada para registrar ASO, uniformes e eventuais ressalvas.");
  }
  if (process.processType === "pj_contract_termination" && process.pjAgreement?.status !== "signed") {
    throw new Error("O distrato precisa estar assinado pelas duas partes e pelas testemunhas antes do fechamento.");
  }
  if (!process.notice) throw new Error("Defina o aviso-prévio e a data de término.");
  const incomplete = process.steps.filter((step) => step.required && step.id !== "closure" && !["completed", "waived"].includes(step.status));
  if (incomplete.length) throw new Error(`Ainda existem etapas obrigatórias: ${incomplete.map((step) => step.label).join(", ")}.`);
  const now = new Date().toISOString();
  const steps = patchStep(process.steps, "closure", { status: "completed", startedAt: now, completedAt: now, completedBy: params.context.userDoc.id });
  await Promise.all([
    authAdmin.updateUser(process.employeeId, { disabled: true }),
    dbAdmin.collection("users").doc(process.employeeId).set({
      isActive: false,
      employmentStatus: "terminated",
      inactivationType: "contract_termination",
      terminationDate: process.notice.contractEndDate,
      terminationReason: process.terminationReason ?? null,
      terminationCause: process.terminationCause ?? null,
      terminationNotes: process.terminationNotes ?? null,
      terminationInternalReason: process.terminationInternalReason ?? null,
      terminationRelationshipType: process.employmentRelationshipType,
      terminationProcessId: process.id,
      terminationEmployerUnitId: process.employer?.unitId ?? null,
      terminationEmployerName: process.employer?.legalName ?? null,
      terminationEmployerCnpj: process.employer?.cnpj ?? null,
      terminationEmployerEntityId: process.employer?.entityId ?? null,
      updatedAt: now,
    }, { merge: true }),
  ]);
  const financialProvisionClosure = await closeFutureFinancialProvisions(params.context, process, process.notice.contractEndDate, now);
  const updated = await saveTermination({
    ...process,
    status: "completed",
    steps,
    financialProvisionClosure,
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
  await hrDbAdmin.collection("terminationActiveByEmployee").doc(process.employeeId).delete().catch(() => undefined);
  await recalculateEmploymentEndRetention({
    employeeId: process.employeeId,
    employmentEndedAt: process.notice.contractEndDate,
    actorId: params.context.userDoc.id,
  });
  await appendTerminationEvent(process.id, {
    type: financialProvisionClosure.status === "completed" ? "FINANCIAL_PROVISIONS_CLOSED" : "FINANCIAL_PROVISIONS_CLOSURE_FAILED",
    at: now,
    ...eventActor(params.context),
    message: financialProvisionClosure.status === "completed"
      ? `${financialProvisionClosure.cancelledCount} provisão(ões) futura(s) de salário e vale-transporte cancelada(s).`
      : "O cancelamento automático das provisões futuras falhou e gerou uma tarefa de revisão.",
    data: { cancelledExpenseIds: financialProvisionClosure.cancelledExpenseIds, error: financialProvisionClosure.error ?? null },
  });
  await appendTerminationEvent(process.id, { type: "COMPLETED", at: now, ...eventActor(params.context), message: "Desligamento concluído e cadastro do colaborador inativado." });
  return updated;
}

export async function sendTerminationToAccountant(params: { context: ServerUserContext; id: string; recipientEmail: string; appBaseUrl: string }) {
  const process = await requireManagedProcess(params.context, params.id);
  if (!process.notice) throw new Error("Defina o aviso-prévio antes do envio à contabilidade.");
  const employer = requireTerminationEmployer(process);
  const configuredContact = await resolveCompanyProcessContact("termination", employer);
  const recipient = params.recipientEmail.trim().toLowerCase() || configuredContact?.email || "";
  if (!recipient.includes("@")) throw new Error("Informe um e-mail válido da contabilidade.");
  const token = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const expiresAt = new Date(Date.now() + 30 * 86_400_000).toISOString();
  const url = `${params.appBaseUrl}/desligamento/contabilidade/${token}`;
  const now = new Date().toISOString();
  const summary = `Empresa: ${employer.legalName}\nCNPJ: ${CnpjValidator.format(employer.cnpj)}\nColaborador: ${process.employeeName}\nProtocolo: ${process.request.protocol}\nTérmino do contrato: ${process.notice.contractEndDate}\nPrazo legal: ${process.notice.legalPaymentDueDate}\nAviso: ${process.notice.decision}`;
  const accountantAttachments = [] as Array<{ filename: string; content: string; contentType: string }>;
  const sourceDocuments = process.documents.filter((document) => document.isCurrent !== false && ["resignation_letter", "request_confirmation", "dismissal_notice"].includes(document.type));
  const bucket = getStorage(adminApp).bucket(firebaseClientConfig.storageBucket);
  for (const document of sourceDocuments) {
    const [buffer] = await bucket.file(document.storagePath).download();
    accountantAttachments.push({ filename: document.fileName, content: buffer.toString("base64"), contentType: document.mimeType });
  }
  const noticeLabel = process.notice.decision === "worked"
    ? "Cumprido — 30 dias"
    : process.notice.decision === "indemnified"
      ? "Indenizado"
    : process.notice.decision === "waived_no_discount"
      ? "Dispensado sem desconto"
      : process.notice.decision === "waived_with_discount"
        ? "Dispensado com desconto"
    : process.notice.decision === "exception_review"
      ? "Exceção em análise"
      : "Definido pelo RH";
  const emailResult = await sendEmail({
    from: EMAIL_SENDERS.formalization,
    to: recipient,
    subject: `Desligamento CLT — ${process.employeeName}`,
    html: renderTerminationAccountantEmail({
      employeeName: process.employeeName,
      protocol: process.request.protocol,
      companyName: employer.legalName,
      companyCnpj: CnpjValidator.format(employer.cnpj),
      contractEndDate: process.notice.contractEndDate,
      legalPaymentDueDate: process.notice.legalPaymentDueDate,
      noticeLabel,
      documentsUrl: url,
    }),
    text: `${summary}\n\nEnviar documentos: ${url}`,
    attachments: accountantAttachments,
    tags: [{ name: "category", value: "termination_accountant" }, { name: "termination_id", value: process.id.slice(0, 256) }],
  });
  await hrDbAdmin.collection("emailCommunications").doc(`termination_accountant_${process.id}_${Date.now()}`).set({
    terminationId: process.id,
    category: "termination_accountant",
    recipient,
    providerId: emailResult.id ?? null,
    status: "accepted",
    acceptedAt: now,
    createdAt: now,
    updatedAt: now,
  });
  const steps = patchStep(process.steps, "accountant", { status: "waiting_external", startedAt: process.steps.find((step) => step.id === "accountant")?.startedAt ?? now });
  const updated = await saveTermination({ ...process, accountant: { ...(process.accountant ?? { status: "not_started" }), status: "sent", tokenHash, tokenExpiresAt: expiresAt, sentAt: now, recipientEmail: recipient }, steps, lastActivityAt: now, updatedAt: now });
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

export async function uploadAccountantDocuments(params: {
  token: string;
  files: Array<{ file: File; kind: "trct" | "calculation_statement" | "other" }>;
  grossAmount?: number | null;
  discountAmount?: number | null;
  netAmount?: number | null;
  noPaymentDue?: boolean;
  paymentDueDate?: string | null;
}) {
  const process = await getTerminationByAccountantToken(params.token);
  if (process.accountant?.status === "approved") throw new Error("Os documentos deste desligamento já foram aprovados pelo RH.");
  if (!params.files.length) throw new Error("Anexe ao menos um documento.");
  if (params.files.length > 20) throw new Error("Envie no máximo 20 arquivos por vez.");
  const currentDocuments = process.documents.filter((document) => document.type === "accountant_document" && document.isCurrent !== false);
  const submittedKinds = new Set(params.files.map((item) => item.kind));
  const availableKinds = new Set([...currentDocuments.filter((document) => document.auditStatus === "approved").map((document) => document.documentKind), ...submittedKinds]);
  if (!availableKinds.has("trct") || !availableKinds.has("calculation_statement")) throw new Error("Envie o TRCT e o demonstrativo do cálculo rescisório.");
  const noPaymentDue = params.noPaymentDue === true;
  const grossAmount = Number(params.grossAmount ?? 0);
  const discountAmount = Number(params.discountAmount ?? 0);
  const netAmount = Number(params.netAmount ?? 0);
  if (!noPaymentDue && (!Number.isFinite(netAmount) || netAmount <= 0)) throw new Error("Informe o valor líquido da rescisão.");
  if (![grossAmount, discountAmount, netAmount].every((value) => Number.isFinite(value) && value >= 0)) throw new Error("Os valores da rescisão são inválidos.");
  if (params.paymentDueDate && !/^\d{4}-\d{2}-\d{2}$/.test(params.paymentDueDate)) throw new Error("Informe o prazo de pagamento no formato correto.");
  const bucket = getStorage(adminApp).bucket(firebaseClientConfig.storageBucket);
  const now = new Date().toISOString();
  const newDocuments: TerminationDocument[] = [];
  let documents = process.documents;
  for (const { file, kind } of params.files) {
    if (file.size <= 0 || file.size > 20 * 1024 * 1024) throw new Error("Cada arquivo deve ter no máximo 20 MB.");
    const buffer = Buffer.from(await file.arrayBuffer());
    const id = randomUUID();
    const storagePath = `hr/termination/${process.id}/accountant/${id}-${safeFileName(file.name)}`;
    await bucket.file(storagePath).save(buffer, { resumable: false, metadata: { contentType: file.type || "application/octet-stream", cacheControl: "private, no-store" } });
    const previous = documents.filter((document) => document.type === "accountant_document" && document.documentKind === kind && document.isCurrent !== false).sort((a, b) => (b.version ?? 1) - (a.version ?? 1))[0];
    documents = documents.map((document) => document.id === previous?.id ? { ...document, isCurrent: false } : document);
    newDocuments.push({
      id,
      type: "accountant_document",
      label: kind === "trct" ? "TRCT" : kind === "calculation_statement" ? "Demonstrativo do cálculo rescisório" : file.name,
      documentKind: kind,
      version: (previous?.version ?? 0) + 1,
      isCurrent: true,
      supersedesId: previous?.id ?? null,
      fileName: safeFileName(file.name),
      mimeType: file.type || "application/octet-stream",
      storagePath,
      contentHash: createHash("sha256").update(buffer).digest("hex"),
      visibility: "internal",
      auditStatus: "pending",
      signatureMode: kind === "trct" ? "both" : "delivery_only",
      uploadedAt: now,
      uploadedBy: "external:accountant",
    });
  }
  documents = [...documents, ...newDocuments];
  let steps = patchStep(process.steps, "accountant", { status: "in_progress", note: "Documentos recebidos. Aguardando conferência do RH.", blockedReason: null });
  if (steps.some((step) => step.id === "document_audit")) steps = patchStep(steps, "document_audit", { status: "in_progress", startedAt: now });
  const updated = await saveTermination({
    ...process,
    accountant: {
      ...(process.accountant ?? { status: "not_started" }),
      status: "documents_received",
      completedAt: now,
      submissionVersion: (process.accountant?.submissionVersion ?? 0) + 1,
      correctionMessage: null,
      grossAmount: Number(grossAmount.toFixed(2)),
      discountAmount: Number(discountAmount.toFixed(2)),
      netAmount: noPaymentDue ? 0 : Number(netAmount.toFixed(2)),
      noPaymentDue,
      paymentDueDate: params.paymentDueDate ?? process.notice?.legalPaymentDueDate ?? null,
    },
    documents,
    steps,
    lastActivityAt: now,
    updatedAt: now,
  });
  await appendTerminationEvent(process.id, { type: "ACCOUNTANT_DOCUMENTS_RECEIVED", at: now, actorId: "external:accountant", actorName: "Contabilidade", message: `${newDocuments.length} documento(s) recebido(s) para auditoria.` });
  await hrDbAdmin.collection("hrNotifications").doc(`termination_accountant_received_${process.id}_${updated.accountant?.submissionVersion ?? 1}`).set({
    type: "termination_accountant_received", status: "pending", terminationId: process.id, employeeId: process.employeeId,
    title: "Documentos rescisórios recebidos", message: `A contabilidade enviou documentos de ${process.employeeName} para conferência.`,
    channels: ["in_app"], recipient: { strategy: "hr_pool" }, createdAt: now, updatedAt: now,
  });
  return updated;
}

async function createTerminationPaymentControl(process: CltTerminationProcess, context: ServerUserContext) {
  const amount = Number(process.accountant?.netAmount ?? 0);
  const dueAt = process.accountant?.paymentDueDate ?? process.notice?.legalPaymentDueDate ?? null;
  if (process.accountant?.noPaymentDue || amount <= 0) {
    return saveTermination({
      ...process,
      payment: { status: "not_applicable", amount: 0, dueAt },
      steps: patchStep(process.steps, "termination_payment", { status: "waived", startedAt: new Date().toISOString(), completedAt: new Date().toISOString(), completedBy: context.userDoc.id, note: "Contabilidade informou que não há valor líquido a pagar." }),
    });
  }
  try {
    const employer = requireTerminationEmployer(process);
    const payment = await createPaymentRequest({
      sourceType: "termination",
      sourceId: process.id,
      beneficiaryReference: { sourceType: "employee", sourceId: process.employeeId },
      legalEntitySnapshot: { entityId: employer.entityId, legalName: employer.legalName, cnpj: employer.cnpj },
      amount,
      description: `Rescisão CLT — ${process.employeeName} — ${CnpjValidator.format(employer.cnpj)}`,
    }, { uid: context.userDoc.id, email: context.userDoc.email, name: getUserDisplayName(context.userDoc, context.userDoc.id) });
    const now = new Date().toISOString();
    const updated = await saveTermination({
      ...process,
      payment: {
        status: payment.status,
        requestId: payment.id,
        amount: payment.amount,
        dueAt,
        maskedDestination: payment.beneficiarySnapshot.maskedPaymentDestination,
        createdAt: payment.createdAt,
      },
      steps: patchStep(process.steps, "termination_payment", { status: "waiting_external", startedAt: now, dueAt, note: "Solicitação criada. Aguardando autorização do financeiro." }),
      lastActivityAt: now,
      updatedAt: now,
    });
    await hrDbAdmin.collection("hrNotifications").doc(`termination_payment_${process.id}`).set({
      type: "termination_payment_authorization", status: "pending", terminationId: process.id, employeeId: process.employeeId,
      title: `Pagamento rescisório — ${process.employeeName}`,
      message: `Autorize o pagamento de ${payment.amount.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })} até ${dueAt ?? "o prazo informado"}.`,
      channels: ["in_app"], recipient: { strategy: "financial_pool" }, createdAt: now, updatedAt: now,
    });
    return updated;
  } catch (error) {
    const now = new Date().toISOString();
    const message = error instanceof Error ? error.message : "Não foi possível criar o pagamento.";
    return saveTermination({
      ...process,
      payment: { status: "configuration_required", amount, dueAt, lastError: message },
      steps: patchStep(process.steps, "termination_payment", { status: "blocked", startedAt: now, dueAt, blockedReason: message, note: message }),
      lastActivityAt: now,
      updatedAt: now,
    });
  }
}

export async function prepareTerminationPayment(params: { context: ServerUserContext; id: string }) {
  const process = await requireManagedProcess(params.context, params.id);
  if (process.accountant?.status !== "approved") throw new Error("Aprove os documentos e os valores antes de preparar o pagamento.");
  if (process.payment?.requestId) return syncTerminationPayment(params);
  const updated = await createTerminationPaymentControl(process, params.context);
  await appendTerminationEvent(process.id, {
    type: "TERMINATION_PAYMENT_RETRIED",
    at: new Date().toISOString(),
    ...eventActor(params.context),
    message: updated.payment?.requestId ? "Solicitação de pagamento preparada para o financeiro." : "Nova tentativa de preparação do pagamento registrada.",
  });
  return updated;
}

export async function syncTerminationPayment(params: { context: ServerUserContext; id: string }) {
  const process = await requireManagedProcess(params.context, params.id);
  const requestId = process.payment?.requestId;
  if (!requestId) throw new Error("A solicitação de pagamento ainda não foi criada.");
  let payment = await getPaymentRequest(requestId);
  if (payment.sourceType !== "termination") throw new Error("A solicitação bancária não pertence a esta rescisão.");
  if (["awaiting_bank_approval", "processing", "rejected", "approval_expired", "failed"].includes(payment.status) && payment.interRequestId) {
    payment = await refreshPaymentRequest(requestId, { uid: params.context.userDoc.id, email: params.context.userDoc.email, name: getUserDisplayName(params.context.userDoc, params.context.userDoc.id) });
    if (payment.sourceType !== "termination") throw new Error("A solicitação bancária não pertence a esta rescisão.");
  }
  const now = new Date().toISOString();
  const updated = await saveTermination({
    ...process,
    payment: {
      ...process.payment!,
      status: payment.status,
      amount: payment.amount,
      maskedDestination: payment.beneficiarySnapshot.maskedPaymentDestination,
      paidAt: payment.paidAt ?? null,
      proofStoragePath: payment.proofStoragePath ?? null,
      lastError: payment.lastError?.safeMessage ?? null,
    },
    lastActivityAt: now,
    updatedAt: now,
  });
  await appendTerminationEvent(process.id, { type: "TERMINATION_PAYMENT_SYNCED", at: now, ...eventActor(params.context), message: `Pagamento atualizado: ${payment.status}.`, data: { paymentRequestId: requestId, status: payment.status } });
  return updated;
}

export async function auditTerminationDocuments(params: {
  context: ServerUserContext;
  id: string;
  reviews: Array<{ id: string; decision: "approved" | "correction_required"; reason?: string | null; selectedForEmployee?: boolean; signatureMode?: TerminationDocument["signatureMode"] }>;
  appBaseUrl: string;
}) {
  const process = await requireManagedProcess(params.context, params.id);
  const accountantDocs = process.documents.filter((document) => document.type === "accountant_document" && document.isCurrent !== false);
  if (!accountantDocs.length) throw new Error("Ainda não há documentos da contabilidade para auditar.");
  const now = new Date().toISOString();
  const reviewById = new Map(params.reviews.map((review) => [review.id, review]));
  for (const document of accountantDocs) {
    const review = reviewById.get(document.id);
    if (!review) throw new Error(`Revise o documento ${document.label}.`);
    if (review.decision === "correction_required" && (!review.reason || review.reason.trim().length < 3)) throw new Error(`Informe o motivo da correção de ${document.label}.`);
  }
  const documents = process.documents.map((document) => document.type === "accountant_document" ? {
    ...document,
    ...(document.isCurrent === false || !reviewById.has(document.id) ? {} : {
      auditStatus: reviewById.get(document.id)!.decision,
      reviewNotes: reviewById.get(document.id)!.reason?.trim() || null,
      correctionReason: reviewById.get(document.id)!.decision === "correction_required" ? reviewById.get(document.id)!.reason?.trim() || null : null,
      selectedForEmployee: reviewById.get(document.id)!.decision === "approved" && reviewById.get(document.id)!.selectedForEmployee !== false,
      signatureMode: reviewById.get(document.id)!.signatureMode ?? document.signatureMode ?? (document.documentKind === "trct" ? "both" : "delivery_only"),
      visibility: reviewById.get(document.id)!.decision === "approved"
        && reviewById.get(document.id)!.selectedForEmployee !== false
        && reviewById.get(document.id)!.signatureMode !== "internal_only"
        ? "employee" as const
        : "internal" as const,
      reviewedAt: now,
      reviewedBy: params.context.userDoc.id,
    }),
  } : document);
  const corrections = accountantDocs.filter((document) => reviewById.get(document.id)?.decision === "correction_required");
  if (corrections.length) {
    const reason = corrections.map((document) => `${document.label}: ${reviewById.get(document.id)?.reason?.trim()}`).join("\n");
    const token = randomBytes(32).toString("base64url");
    const tokenHash = createHash("sha256").update(token).digest("hex");
    const expiresAt = new Date(Date.now() + 30 * 86_400_000).toISOString();
    const documentsUrl = `${params.appBaseUrl}/desligamento/contabilidade/${token}`;
    const recipient = process.accountant?.recipientEmail;
    if (!recipient) throw new Error("O e-mail da contabilidade não está registrado.");
    const result = await sendEmail({
      from: EMAIL_SENDERS.formalization,
      to: recipient,
      subject: `Correção da rescisão — ${process.employeeName}`,
      html: renderTerminationAccountantCorrectionEmail({ employeeName: process.employeeName, protocol: process.request.protocol, reason, documentsUrl }),
      text: `Correções solicitadas para ${process.employeeName}:\n${reason}\n\nEnviar novas versões: ${documentsUrl}`,
      tags: [{ name: "category", value: "termination_accountant_correction" }, { name: "termination_id", value: process.id.slice(0, 256) }],
    });
    await hrDbAdmin.collection("emailCommunications").doc(`termination_accountant_correction_${process.id}_${Date.now()}`).set({ terminationId: process.id, category: "termination_accountant_correction", recipient, providerId: result.id ?? null, status: "accepted", acceptedAt: now, createdAt: now, updatedAt: now });
    const steps = patchStep(process.steps, "accountant", { status: "waiting_external", note: reason });
    const updated = await saveTermination({
      ...process,
      documents,
      accountant: { ...process.accountant!, status: "correction_requested", tokenHash, tokenExpiresAt: expiresAt, correctionRound: (process.accountant?.correctionRound ?? 0) + 1, correctionMessage: reason, correctionRequestedAt: now, correctionRequestedBy: params.context.userDoc.id },
      steps,
      lastActivityAt: now,
      updatedAt: now,
    });
    await appendTerminationEvent(process.id, { type: "ACCOUNTANT_CORRECTION_REQUESTED", at: now, ...eventActor(params.context), message: `${corrections.length} documento(s) devolvido(s) para correção.`, data: { documentIds: corrections.map((document) => document.id), reason } });
    return updated;
  }

  let steps = patchStep(process.steps, "accountant", { status: "completed", completedAt: now, completedBy: params.context.userDoc.id, note: "Documentos e valores aprovados pelo RH." });
  if (steps.some((step) => step.id === "document_audit")) steps = patchStep(steps, "document_audit", { status: "completed", completedAt: now, completedBy: params.context.userDoc.id });
  const signatureDocuments = documents.filter((document) => document.type === "accountant_document" && document.isCurrent !== false && document.auditStatus === "approved" && document.selectedForEmployee && !["delivery_only", "internal_only"].includes(document.signatureMode ?? ""));
  steps = patchStep(steps, "signatures", signatureDocuments.length ? { status: "in_progress", startedAt: now, note: "Documentos aprovados e prontos para assinatura." } : { status: "waived", startedAt: now, completedAt: now, completedBy: params.context.userDoc.id, note: "Nenhum documento exige assinatura." });
  let updated = await saveTermination({
    ...process,
    documents,
    accountant: { ...process.accountant!, status: "approved", approvedAt: now, approvedBy: params.context.userDoc.id, correctionMessage: null },
    steps,
    lastActivityAt: now,
    updatedAt: now,
  });
  updated = await createTerminationPaymentControl(updated, params.context);
  await appendTerminationEvent(process.id, { type: "ACCOUNTANT_DOCUMENTS_APPROVED", at: now, ...eventActor(params.context), message: `${accountantDocs.length} documento(s) e o valor líquido foram aprovados. O pagamento paralelo foi preparado.` });
  return updated;
}

function requirePjTermination(process: CltTerminationProcess) {
  if (process.processType !== "pj_contract_termination" || !process.pjContractSnapshot) {
    throw new Error("Este processo não possui um contrato PJ de origem congelado.");
  }
  return process.pjContractSnapshot;
}

export async function generatePjTerminationAgreement(params: {
  context: ServerUserContext;
  id: string;
  input: PjTerminationAgreementGenerateInput;
}) {
  const process = await requireManagedProcess(params.context, params.id);
  const contract = requirePjTermination(process);
  if (process.terminationReason !== "Encerramento por acordo entre as partes") {
    throw new Error("Este modelo de distrato só pode ser usado no encerramento por acordo entre as partes.");
  }
  if (["sent", "signed"].includes(process.pjAgreement?.status ?? "")) {
    throw new Error("O distrato já foi enviado para assinatura e não pode ser substituído.");
  }
  const terminationDate = process.notice?.contractEndDate;
  if (!terminationDate) throw new Error("A data do encerramento não foi definida.");
  const today = belemDateOnly();
  if (params.input.invoiceDate > params.input.paymentDate) throw new Error("A nota fiscal não pode ser posterior ao pagamento confirmado.");
  if (params.input.paymentDate > today) throw new Error("O pagamento só pode ser confirmado depois de realizado.");
  const signerKeys = [
    contract.contractor.representative.email,
    contract.provider.representative.email,
    ...params.input.witnesses.map((witness) => witness.email),
  ].map((value) => value.trim().toLowerCase());
  if (new Set(signerKeys).size !== signerKeys.length) throw new Error("Cada signatário precisa ter um e-mail diferente.");
  const witnessCpfs = params.input.witnesses.map((witness) => witness.cpf);
  if (new Set(witnessCpfs).size !== witnessCpfs.length) throw new Error("Informe duas testemunhas diferentes.");
  const grossValue = Number(((contract.sourceContract.monthlyValue / 30) * params.input.daysWorked).toFixed(2));
  const prorataFormulaText = `${formatBrMoney(contract.sourceContract.monthlyValue)} ÷ 30 × ${params.input.daysWorked} = ${formatBrMoney(grossValue)}`;
  const settlement: NonNullable<PjTerminationAgreement["settlement"]> = {
    terminationDate,
    daysWorked: params.input.daysWorked,
    prorataFormulaText,
    grossValue,
    invoiceNumber: params.input.invoiceNumber,
    invoiceDate: params.input.invoiceDate,
    paymentConfirmed: true,
    paymentDate: params.input.paymentDate,
    signatureCity: params.input.signatureCity,
    forumCity: params.input.forumCity,
    signatureDate: today,
  };
  const pdf = PjTerminationAgreementPdf({
    data: {
      contract,
      ...settlement,
      witnesses: params.input.witnesses,
    },
  }) as Parameters<typeof renderToBuffer>[0];
  const buffer = Buffer.from(await renderToBuffer(pdf));
  const now = new Date().toISOString();
  const version = (process.pjAgreement?.version ?? 0) + 1;
  const documentId = randomUUID();
  const storagePath = `hr/termination/${process.id}/pj-agreement/v${version}/distrato.pdf`;
  const contentHash = createHash("sha256").update(buffer).digest("hex");
  await getStorage(adminApp).bucket(firebaseClientConfig.storageBucket).file(storagePath).save(buffer, {
    resumable: false,
    metadata: {
      contentType: "application/pdf",
      cacheControl: "private, no-store",
      metadata: {
        terminationId: process.id,
        version: String(version),
        contentHash,
        sourceContractHash: contract.sourceContract.signedHashSha256,
      },
    },
  });
  const documents = [
    ...process.documents.map((document) => document.type === "pj_termination_agreement" && document.isCurrent !== false
      ? { ...document, isCurrent: false }
      : document),
    {
      id: documentId,
      type: "pj_termination_agreement" as const,
      label: "Distrato de contrato de prestação de serviços",
      fileName: `distrato-${safeFileName(contract.provider.legalName)}-v${version}.pdf`,
      mimeType: "application/pdf",
      storagePath,
      contentHash,
      visibility: "internal" as const,
      auditStatus: "pending" as const,
      version,
      isCurrent: true,
      supersedesId: process.pjAgreement?.documentId ?? null,
      signatureMode: "both" as const,
      signatureRequired: true,
      selectedForEmployee: true,
      uploadedAt: now,
      uploadedBy: params.context.userDoc.id,
    },
  ];
  let steps = patchStep(process.steps, "document_audit", {
    status: "in_progress",
    startedAt: process.steps.find((step) => step.id === "document_audit")?.startedAt ?? now,
    completedAt: null,
    completedBy: null,
    note: `Distrato v${version} gerado. Aguardando revisão do RH.`,
  });
  steps = patchStep(steps, "signatures", { status: "pending", startedAt: null, completedAt: null, completedBy: null, note: null });
  steps = patchStep(steps, "legal_obligations", {
    status: "completed",
    completedAt: now,
    completedBy: params.context.userDoc.id,
    note: `NF ${params.input.invoiceNumber} e pagamento de ${formatBrMoney(grossValue)} confirmados antes da geração.`,
  });
  const updated = await saveTermination({
    ...process,
    documents,
    steps,
    pjAgreement: {
      status: "review_pending",
      version,
      documentId,
      settlement,
      witnesses: params.input.witnesses,
      generatedAt: now,
      generatedBy: params.context.userDoc.id,
      approvedAt: null,
      approvedBy: null,
      sentAt: null,
      signedAt: null,
      signatureRequestId: null,
      providerDocumentId: null,
      lastError: null,
    },
    lastActivityAt: now,
    updatedAt: now,
  });
  await appendTerminationEvent(process.id, {
    type: "PJ_TERMINATION_AGREEMENT_GENERATED",
    at: now,
    ...eventActor(params.context),
    message: `Distrato v${version} gerado com as partes e o contrato de origem congelados.`,
    data: { documentId, version, contentHash, sourceContractHash: contract.sourceContract.signedHashSha256, grossValue },
  });
  return updated;
}

export async function approvePjTerminationAgreement(params: { context: ServerUserContext; id: string }) {
  const process = await requireManagedProcess(params.context, params.id);
  requirePjTermination(process);
  const agreement = process.pjAgreement;
  if (!agreement?.documentId || agreement.status !== "review_pending") throw new Error("Gere uma versão do distrato antes da aprovação.");
  const current = process.documents.find((document) => document.id === agreement.documentId && document.isCurrent !== false);
  if (!current) throw new Error("O arquivo atual do distrato não foi encontrado.");
  const now = new Date().toISOString();
  const documents = process.documents.map((document) => document.id === current.id
    ? { ...document, auditStatus: "approved" as const, reviewedAt: now, reviewedBy: params.context.userDoc.id }
    : document);
  let steps = patchStep(process.steps, "document_audit", { status: "completed", completedAt: now, completedBy: params.context.userDoc.id, note: `Distrato v${agreement.version} aprovado.` });
  steps = patchStep(steps, "signatures", { status: "in_progress", startedAt: now, note: "Distrato aprovado e pronto para envio às quatro assinaturas." });
  const updated = await saveTermination({
    ...process,
    documents,
    steps,
    pjAgreement: { ...agreement, status: "approved", approvedAt: now, approvedBy: params.context.userDoc.id, lastError: null },
    lastActivityAt: now,
    updatedAt: now,
  });
  await appendTerminationEvent(process.id, { type: "PJ_TERMINATION_AGREEMENT_APPROVED", at: now, ...eventActor(params.context), message: `Distrato v${agreement.version} aprovado pelo RH.` });
  return updated;
}

export async function sendPjTerminationAgreementForSignature(params: { context: ServerUserContext; id: string }) {
  const process = await requireManagedProcess(params.context, params.id);
  const contract = requirePjTermination(process);
  const agreement = process.pjAgreement;
  if (!agreement?.documentId || agreement.status !== "approved" || !agreement.witnesses) {
    throw new Error("Aprove o distrato antes de solicitar as assinaturas.");
  }
  const document = process.documents.find((item) => item.id === agreement.documentId && item.isCurrent !== false && item.auditStatus === "approved");
  if (!document) throw new Error("O distrato aprovado não foi encontrado.");
  const existing = await hrDbAdmin.collection("hrSignatureRequests").where("terminationId", "==", process.id).where("terminationDocumentId", "==", document.id).limit(10).get();
  if (existing.docs.some((request) => !["failed", "cancelled", "expired", "rejected"].includes(String(request.get("status"))))) {
    throw new Error("Este distrato já possui uma solicitação de assinatura.");
  }
  const [buffer] = await getStorage(adminApp).bucket(firebaseClientConfig.storageBucket).file(document.storagePath).download();
  const now = new Date().toISOString();
  const requestRef = hrDbAdmin.collection("hrSignatureRequests").doc();
  await requestRef.set({
    source: "pj_termination_agreement",
    terminationId: process.id,
    terminationDocumentId: document.id,
    purpose: "termination_final_document",
    status: "sending",
    documentStoragePath: document.storagePath,
    sourceContractHashSha256: contract.sourceContract.signedHashSha256,
    contractorCnpj: contract.contractor.cnpj,
    providerCnpj: contract.provider.cnpj,
    createdAt: now,
    updatedAt: now,
    createdBy: params.context.userDoc.id,
  });
  try {
    const provider = await createAutentiqueDocument({
      buffer,
      fileName: document.fileName,
      documentName: `Distrato de prestação de serviços - ${contract.provider.legalName}`,
      message: "Confira o distrato e realize a assinatura eletrônica.",
      signers: [
        { name: contract.contractor.representative.name, email: contract.contractor.representative.email, cpf: contract.contractor.representative.cpf, action: "SIGN" },
        { name: contract.provider.representative.name, email: contract.provider.representative.email, cpf: contract.provider.representative.cpf, action: "SIGN" },
        ...agreement.witnesses.map((witness) => ({ name: witness.name, email: witness.email, cpf: witness.cpf, action: "SIGN_AS_A_WITNESS" as const })),
      ],
    });
    await requestRef.set({ status: "sent", provider: "autentique", sandbox: provider.sandbox, providerDocumentId: provider.document.id, providerSignatures: provider.document.signatures, sentAt: now, updatedAt: now }, { merge: true });
    const steps = patchStep(process.steps, "signatures", { status: "waiting_external", startedAt: process.steps.find((step) => step.id === "signatures")?.startedAt ?? now, note: "Aguardando contratante, contratada e duas testemunhas." });
    const updated = await saveTermination({
      ...process,
      steps,
      pjAgreement: { ...agreement, status: "sent", sentAt: now, signatureRequestId: requestRef.id, providerDocumentId: provider.document.id, lastError: null },
      lastActivityAt: now,
      updatedAt: now,
    });
    await appendTerminationEvent(process.id, { type: "PJ_TERMINATION_AGREEMENT_SENT", at: now, ...eventActor(params.context), message: "Distrato enviado para assinatura da contratante, contratada e duas testemunhas." });
    return updated;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha ao enviar o distrato para assinatura.";
    await requestRef.set({ status: "failed", error: message, updatedAt: new Date().toISOString() }, { merge: true });
    await saveTermination({ ...process, pjAgreement: { ...agreement, status: "approved", lastError: message }, lastActivityAt: now, updatedAt: now });
    throw error;
  }
}

export async function sendTerminationDocumentsForSignature(params: { context: ServerUserContext; id: string }) {
  const process = await requireManagedProcess(params.context, params.id);
  if (process.accountant?.status !== "approved") throw new Error("Aprove os documentos da contabilidade antes de solicitar assinaturas.");
  const selected = process.documents.filter((document) => document.isCurrent !== false && document.selectedForEmployee && document.auditStatus === "approved" && ["employee", "company", "both"].includes(document.signatureMode ?? ""));
  if (!selected.length) throw new Error("Selecione documentos aprovados para assinatura.");
  const employer = requireTerminationEmployer(process);
  const companySignatureRequired = selected.some((document) => ["company", "both"].includes(document.signatureMode ?? ""));
  const companySignatory = companySignatureRequired
    ? await resolveCompanyDocumentSignatory({ entityId: employer.entityId, cnpj: employer.cnpj })
    : null;
  if (companySignatureRequired && !companySignatory) {
    throw new Error(`Defina o signatário documental da empresa ${employer.legalName} antes de solicitar as assinaturas.`);
  }
  const employeeSnapshot = await dbAdmin.collection("users").doc(process.employeeId).get();
  const phone = normalizePhone(employeeSnapshot.get("phone"));
  if (selected.some((document) => ["employee", "both"].includes(document.signatureMode ?? "")) && !phone) throw new Error("O colaborador precisa ter celular vinculado para assinar.");
  const identity = await loadExpectedIdentity(process.employeeId);
  const cpf = String(identity?.cpf ?? "").replace(/\D/g, "");
  const bucket = getStorage(adminApp).bucket(firebaseClientConfig.storageBucket);
  const now = new Date().toISOString();
  for (const document of selected) {
    const existing = await hrDbAdmin.collection("hrSignatureRequests").where("terminationId", "==", process.id).where("terminationDocumentId", "==", document.id).limit(1).get();
    if (!existing.empty) continue;
    const [buffer] = await bucket.file(document.storagePath).download();
    const signatureMode = document.signatureMode ?? "both";
    const signers = [] as Array<{ email: string; name: string; action: "SIGN"; cpf?: string; requireSmsVerificationPhone?: string }>;
    if (signatureMode === "employee" || signatureMode === "both") signers.push({ email: process.employeeEmail, name: process.employeeName, action: "SIGN", cpf: cpf.length === 11 ? cpf : undefined, requireSmsVerificationPhone: phone ?? undefined });
    if ((signatureMode === "company" || signatureMode === "both") && companySignatory) signers.push({ email: companySignatory.email, name: companySignatory.name, action: "SIGN" });
    const provider = await createAutentiqueDocument({
      buffer,
      fileName: document.fileName,
      documentName: `${document.label} — ${process.employeeName}`,
      message: "Confira e assine os documentos do seu desligamento.",
      signers,
    });
    await hrDbAdmin.collection("hrSignatureRequests").add({ terminationId: process.id, terminationDocumentId: document.id, purpose: "termination_final_document", status: "sent", provider: "autentique", providerDocumentId: provider.document.id, documentStoragePath: document.storagePath, signatureMode, employerEntityId: employer.entityId, employerCnpj: employer.cnpj, companySignatoryUserId: companySignatory?.userId ?? null, companySignatoryEmail: companySignatory?.email ?? null, createdAt: now, updatedAt: now });
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
  const pjAgreement = process.pjAgreement?.documentId === params.documentId
    ? { ...process.pjAgreement, status: "signed" as const, signedAt: params.signedAt, lastError: null }
    : process.pjAgreement;
  const updated = await saveTermination({ ...process, documents, steps, pjAgreement, lastActivityAt: params.signedAt, updatedAt: params.signedAt });
  await appendTerminationEvent(process.id, { type: "FINAL_DOCUMENT_SIGNED", at: params.signedAt, actorId: "system:autentique", actorName: "Autentique", message: "Documento final assinado e arquivado no dossiê." });
  return updated;
}
