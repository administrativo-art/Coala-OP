import { emptyDimensions, type CentralWorkItem } from "../types";

type OnboardingDocument = Record<string, unknown>;
type OnboardingRecord = Record<string, unknown> & { id: string };

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function documents(record: OnboardingRecord) {
  return Array.isArray(record.documents)
    ? record.documents.filter((item): item is OnboardingDocument => Boolean(item) && typeof item === "object" && !Array.isArray(item))
    : [];
}

function hasFile(document: OnboardingDocument) {
  return Boolean(text(document.filePath) || text(document.fileUrl) || text(document.fileHashSha256));
}

export function onboardingClassificationItems(record: OnboardingRecord): CentralWorkItem[] {
  const candidate = text(record.candidateName) ?? text(record.providerLegalName) ?? "Pessoa em admissão";
  return documents(record).flatMap((document) => {
    const status = text(document.status) ?? "pending";
    if (!hasFile(document) || !["received", "review_required", "rejected"].includes(status)) return [];
    const documentId = text(document.id) ?? "unknown";
    const ai = document.aiAnalysis && typeof document.aiAnalysis === "object" && !Array.isArray(document.aiAnalysis)
      ? document.aiAnalysis as Record<string, unknown> : null;
    const analysisMethod = text(ai?.provider) === "openai" ? "ai" : ai ? "rule" : "unknown";
    return [{
      id: `onboarding:classify:${record.id}:${documentId}`,
      source: "onboarding" as const,
      tab: "classify" as const,
      documentRef: { source: "onboarding" as const, sourceId: `${record.id}/${documentId}` },
      processRef: { source: "onboarding" as const, processId: record.id, stage: text(record.currentStage) },
      title: text(document.label) ?? "Documento admissional",
      subject: candidate,
      status,
      statusLabel: status === "rejected" ? "Correção solicitada" : status === "review_required" ? "Revisão necessária" : "Recebido para conferência",
      detail: text(document.note),
      updatedAt: text(document.updatedAt) ?? text(document.receivedAt) ?? text(record.updatedAt),
      href: `/dashboard/hr/recruitment/integration?process=${encodeURIComponent(record.id)}&document=${encodeURIComponent(documentId)}`,
      actionLabel: "Revisar na admissão",
      missingFields: [],
      dimensions: { ...emptyDimensions(), classification: status === "rejected" ? "failed" : "pending", preparation: "pending", archiving: "pending" },
      metadata: {
        documentType: text(document.documentTypeCode),
        displayName: text(document.label),
        analysisMethod,
      },
    }];
  });
}

export function onboardingFlowItem(record: OnboardingRecord): CentralWorkItem {
  const docs = documents(record);
  const required = docs.filter((document) => document.required !== false);
  const complete = required.filter((document) => text(document.status) === "approved");
  const missing = required.filter((document) => !hasFile(document) || text(document.status) === "pending")
    .map((document) => text(document.label) ?? text(document.id) ?? "Documento");
  const candidate = text(record.candidateName) ?? text(record.providerLegalName) ?? "Pessoa em admissão";
  const status = text(record.status) ?? "collecting_documents";
  const detail = missing.length
    ? `${missing.length} documento(s) obrigatório(s) ainda não recebido(s) ou pendente(s).`
    : "Os documentos obrigatórios recebidos avançam pelas etapas próprias do processo.";
  return {
    id: `onboarding:flow:${record.id}`,
    source: "onboarding",
    tab: "flows",
    documentRef: null,
    processRef: { source: "onboarding", processId: record.id, stage: text(record.currentStage) },
    title: text(record.employmentRelationshipType) === "pj" ? "Contratação de prestador PJ" : "Admissão",
    subject: candidate,
    status,
    statusLabel: onboardingStatusLabel(status),
    detail,
    updatedAt: text(record.updatedAt) ?? text(record.createdAt),
    href: `/dashboard/hr/recruitment/integration?process=${encodeURIComponent(record.id)}`,
    actionLabel: "Abrir fluxo",
    missingFields: missing,
    dimensions: { ...emptyDimensions(), classification: missing.length ? "pending" : "confirmed", preparation: status === "completed" ? "completed" : "pending", archiving: status === "completed" ? "filed" : "pending" },
    metadata: { requirementCount: required.length, completedRequirementCount: complete.length },
  };
}

export function onboardingStatusLabel(status: string) {
  const labels: Record<string, string> = {
    pending_setup: "Configuração pendente",
    collecting_documents: "Coletando documentos",
    reviewing_documents: "Conferindo documentos",
    accountant_pending: "Aguardando contador",
    contract_pending: "Contrato pendente",
    ready_to_create_user: "Pronto para criar acesso",
    awaiting_first_access: "Aguardando primeiro acesso",
    active: "Integração ativa",
    completed: "Concluída",
    cancelled: "Cancelada",
  };
  return labels[status] ?? status;
}
