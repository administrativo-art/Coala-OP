export type TerminationProcessStatus =
  | "identity_pending"
  | "hr_review"
  | "active"
  | "closing_review"
  | "completed"
  | "cancelled";

export type TerminationHealth =
  | "on_track"
  | "attention"
  | "overdue"
  | "blocked"
  | "completed"
  | "cancelled";

export type TerminationStepStatus =
  | "pending"
  | "in_progress"
  | "waiting_external"
  | "blocked"
  | "completed"
  | "waived"
  | "cancelled";

export type TerminationStepId =
  | "employee_request"
  | "identity_signature"
  | "hr_validation"
  | "notice_decision"
  | "aso"
  | "accountant"
  | "document_audit"
  | "signatures"
  | "legal_obligations"
  | "access_revocation"
  | "operational"
  | "closure";

export type TerminationStep = {
  id: TerminationStepId;
  label: string;
  lane: "request" | "notice" | "aso" | "accountant" | "documents" | "operational" | "closure";
  owner: "employee" | "hr" | "employer" | "finance" | "accountant" | "clinic" | "manager" | "system";
  status: TerminationStepStatus;
  required: boolean;
  dueAt?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  completedBy?: string | null;
  blockedReason?: string | null;
  note?: string | null;
};

export type NoticeDecision =
  | "worked"
  | "waived_no_discount"
  | "waived_with_discount"
  | "exception_review";

export type TerminationEvent = {
  id?: string;
  type: string;
  at: string;
  actorId: string;
  actorName: string;
  message: string;
  data?: Record<string, unknown>;
};

export type TerminationDocument = {
  id: string;
  type:
    | "resignation_letter"
    | "request_confirmation"
    | "accountant_document"
    | "aso_dismissal"
    | "payment_proof"
    | "esocial_receipt"
    | "signed_document"
    | "other";
  label: string;
  fileName: string;
  mimeType: string;
  storagePath: string;
  contentHash: string;
  visibility: "internal" | "employee";
  auditStatus: "pending" | "approved" | "correction_required" | "waived";
  signatureRequired?: boolean;
  selectedForEmployee?: boolean;
  uploadedAt: string;
  uploadedBy: string;
};

export type CltTerminationProcess = {
  id: string;
  processType: "clt_employee_resignation";
  employeeId: string;
  employeeName: string;
  employeeEmail: string;
  employeeCpfMasked?: string | null;
  employeePhoneMasked?: string | null;
  employmentRelationshipType: "clt";
  unitId?: string | null;
  unitName?: string | null;
  jobRoleName?: string | null;
  status: TerminationProcessStatus;
  health: TerminationHealth;
  progress: number;
  currentSummary: string;
  source: "employee_self_service" | "hr_manual";
  request: {
    noticePreference: "work" | "request_waiver";
    desiredLastDay?: string | null;
    notes?: string | null;
    submittedAt: string;
    protocol: string;
    identityStatus: "pending_signature" | "verified" | "manual_verified" | "contested";
    signatureRequestId?: string | null;
    providerDocumentId?: string | null;
  };
  hrValidation?: {
    status: "confirmed" | "correction_requested" | "exception_review";
    at: string;
    by: string;
    byName: string;
    notes?: string | null;
  } | null;
  notice?: {
    decision: NoticeDecision;
    communicationDate: string;
    noticeStartDate?: string | null;
    contractEndDate: string;
    legalPaymentDueDate: string;
    notes?: string | null;
    decidedAt: string;
    decidedBy: string;
  } | null;
  accountant?: {
    status: "not_started" | "ready_to_send" | "sent" | "documents_received" | "correction_requested" | "approved";
    tokenHash?: string | null;
    tokenExpiresAt?: string | null;
    sentAt?: string | null;
    recipientEmail?: string | null;
    completedAt?: string | null;
  } | null;
  asoWorkflow?: Record<string, unknown> | null;
  operational?: {
    uniformsReturned: boolean;
    assetsReturned: boolean;
    scheduleRemoved: boolean;
    accessRevoked: boolean;
    benefitsClosed: boolean;
    notes?: string | null;
  };
  accessRevocation?: {
    pdv: { status: "pending" | "completed" | "not_applicable" | "failed"; externalId?: string | null; completedAt?: string | null; completedBy?: string | null; error?: string | null };
    bizneo: { status: "pending" | "completed" | "not_applicable"; externalId?: string | null; completedAt?: string | null; completedBy?: string | null };
    healthPlan: { status: "pending" | "completed" | "not_applicable"; completedAt?: string | null; completedBy?: string | null };
    coalaOne: { status: "scheduled" | "completed"; completedAt?: string | null };
  };
  documents: TerminationDocument[];
  steps: TerminationStep[];
  nextDueAt?: string | null;
  lastActivityAt: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string | null;
  cancelledAt?: string | null;
};

export type ProcessProjection = {
  id: string;
  sourceType: "termination";
  sourceDatabase: "coala-rh";
  sourceCollection: "terminationProcesses";
  sourceId: string;
  module: "dp";
  type: "clt_employee_resignation";
  title: string;
  subjectId: string;
  subjectName: string;
  status: TerminationProcessStatus;
  health: TerminationHealth;
  progress: number;
  currentSummary: string;
  nextDueAt?: string | null;
  lastActivityAt: string;
  href: string;
  version: number;
  sourceUpdatedAt: string;
  syncedAt: string;
  visibleToUserIds: string[];
  visibleToPermission: "dp.view";
};
