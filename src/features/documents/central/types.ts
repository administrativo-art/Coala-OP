export type CentralDocumentSource =
  | "employee_upload"
  | "onboarding"
  | "generated"
  | "financial"
  | "absence"
  | "company"
  | "vacation"
  | "termination";

export type CentralWorkTab = "classify" | "preparation" | "flows" | "signatures";

export type CentralDocumentRef = {
  source: CentralDocumentSource;
  sourceId: string;
};

export type CentralProcessRef = {
  source: "onboarding" | "financial" | "absence" | "generated" | "vacation" | "termination";
  processId: string;
  stage: string | null;
};

export type CentralDocumentDimensions = {
  classification: "not_applicable" | "pending" | "suggested" | "confirmed" | "failed";
  preparation: "not_applicable" | "pending" | "ready" | "failed" | "completed";
  signature: "not_applicable" | "not_sent" | "pending" | "partially_signed" | "failed" | "completed";
  archiving: "not_applicable" | "pending" | "filed" | "failed";
  publication: "not_applicable" | "private" | "published" | "pending";
};

export type CentralWorkItem = {
  id: string;
  source: CentralDocumentSource;
  tab: CentralWorkTab;
  documentRef: CentralDocumentRef | null;
  processRef: CentralProcessRef | null;
  title: string;
  subject: string | null;
  status: string;
  statusLabel: string;
  detail: string | null;
  updatedAt: string | null;
  href: string;
  actionLabel: string;
  missingFields: string[];
  dimensions: CentralDocumentDimensions;
  metadata: {
    originalName?: string | null;
    displayName?: string | null;
    documentType?: string | null;
    provider?: string | null;
    analysisMethod?: "rule" | "ocr" | "ai" | "unknown" | null;
    requirementCount?: number;
    completedRequirementCount?: number;
    attachmentCount?: number;
  };
};

export type CentralWorkPage = {
  continuations: Array<{ source: CentralDocumentSource; cursor: string; stage?: "classify" | "link" | "pay" | "bank" }>;
  items: CentralWorkItem[];
  warnings: string[];
  sources: Array<{ source: CentralDocumentSource; available: boolean; partial: boolean; message?: string }>;
  pageInfo: { hasMore: boolean; limit: number; nextCursor?: string };
};

export type CentralHistoryEntry = {
  documentRef?: CentralDocumentRef;
  id: string;
  source: CentralDocumentSource;
  recordKind: "event" | "current_snapshot";
  occurredAt: string | null;
  eventLabel: string;
  title: string;
  subject: string | null;
  originalName: string | null;
  appliedName: string | null;
  destination: string | null;
  statusLabel: string | null;
  actorName: string | null;
  analysisMethod: "rule" | "ocr" | "ai" | "unknown" | null;
  href: string;
  detail: string | null;
};

export type CentralHistoryPage = {
  continuations: Array<{ source: CentralDocumentSource; cursor: string }>;
  entries: CentralHistoryEntry[];
  warnings: string[];
  pageInfo: { hasMore: boolean; limit: number };
};

export function centralRefKey(ref: CentralDocumentRef) {
  return `${ref.source}:${ref.sourceId}`;
}

export function emptyDimensions(): CentralDocumentDimensions {
  return {
    classification: "not_applicable",
    preparation: "not_applicable",
    signature: "not_applicable",
    archiving: "not_applicable",
    publication: "not_applicable",
  };
}
