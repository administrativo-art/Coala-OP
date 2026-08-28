export type TerminationProcessStatus =
  | "identity_pending"
  | "hr_review"
  | "active"
  | "employee_completed"
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
  | "request_validation_notice"
  | "request_received"
  | "letter_review"
  | "employee_request"
  | "identity_signature"
  | "hr_validation"
  | "notice_decision"
  | "uniform_return"
  | "aso"
  | "accountant"
  | "document_audit"
  | "signatures"
  | "termination_payment"
  | "employee_delivery"
  | "legal_obligations"
  | "access_revocation"
  | "operational"
  | "closure";

export type TerminationStep = {
  id: TerminationStepId;
  label: string;
  lane: "request" | "notice" | "aso" | "accountant" | "documents" | "payment" | "delivery" | "operational" | "closure";
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
  | "indemnified"
  | "waived_no_discount"
  | "waived_with_discount"
  | "exception_review"
  | "hr_defined";

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
    | "dismissal_notice"
    | "pj_termination_agreement"
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
  documentKind?: "trct" | "calculation_statement" | "other" | null;
  version?: number;
  isCurrent?: boolean;
  supersedesId?: string | null;
  reviewNotes?: string | null;
  correctionReason?: string | null;
  reviewedAt?: string | null;
  reviewedBy?: string | null;
  signatureMode?: "employee" | "company" | "both" | "delivery_only" | "internal_only";
  signatureRequired?: boolean;
  selectedForEmployee?: boolean;
  uploadedAt: string;
  uploadedBy: string;
};

export type TerminationEmployerSnapshot = {
  unitId: string | null;
  entityId: string | null;
  legalName: string;
  tradeName: string | null;
  cnpj: string;
  address: string;
  capturedAt: string;
};

export type PjTerminationPartySnapshot = {
  entityId: string | null;
  legalName: string;
  tradeName: string | null;
  cnpj: string;
  email: string;
  address: string;
  representative: {
    name: string;
    email: string;
    role: string | null;
    qualification: string;
    cpf: string;
    professionalId: string | null;
  };
};

export type PjTerminationContractSnapshot = {
  onboardingId: string;
  contractor: PjTerminationPartySnapshot;
  provider: PjTerminationPartySnapshot;
  sourceContract: {
    contractDate: string;
    contractStartDate: string;
    termType: "fixed" | "indefinite";
    contractEndDate: string | null;
    monthlyValue: number;
    version: number;
    signedStoragePath: string;
    signedHashSha256: string;
    signedAt: string;
    signatureCity: string;
    forumCity: string;
  };
  capturedAt: string;
};

export type PjTerminationWitness = {
  name: string;
  email: string;
  cpf: string;
};

export type PjTerminationAgreement = {
  status: "not_generated" | "review_pending" | "approved" | "sent" | "signed" | "correction_required" | "failed";
  version: number;
  documentId: string | null;
  settlement: {
    terminationDate: string;
    daysWorked: number;
    prorataFormulaText: string;
    grossValue: number;
    invoiceNumber: string;
    invoiceDate: string;
    paymentConfirmed: true;
    paymentDate: string;
    signatureCity: string;
    forumCity: string;
    signatureDate: string;
  } | null;
  witnesses: [PjTerminationWitness, PjTerminationWitness] | null;
  generatedAt?: string | null;
  generatedBy?: string | null;
  approvedAt?: string | null;
  approvedBy?: string | null;
  sentAt?: string | null;
  signedAt?: string | null;
  signatureRequestId?: string | null;
  providerDocumentId?: string | null;
  lastError?: string | null;
};

export type CltTerminationProcess = {
  id: string;
  processType: "clt_employee_resignation" | "clt_hr_termination" | "pj_contract_termination";
  employeeId: string;
  employeeName: string;
  employeeEmail: string;
  employeeCpfMasked?: string | null;
  employeePhoneMasked?: string | null;
  employmentRelationshipType: "clt" | "pj";
  terminationReason?: string | null;
  terminationCause?: string | null;
  terminationNotes?: string | null;
  terminationInternalReason?: string | null;
  dismissalCommunication?: {
    channel: "in_person";
    occurredAt: string;
    location: string;
    responsibleId: string;
    responsibleName: string;
    participants: string[];
    confirmedAt: string;
    confirmedBy: string;
    officialNoticeStatus: "preparing" | "pending_signature" | "signed" | "refusal_formalized" | "failed";
    officialNoticeError?: string | null;
    refusal?: {
      recordedAt: string;
      recordedBy: string;
      recordedByName: string;
      witnessNames: string[];
      notes: string;
    } | null;
  } | null;
  unitId?: string | null;
  unitName?: string | null;
  /** Retrato imutável da empregadora no momento da abertura da rescisão. */
  employer?: TerminationEmployerSnapshot | null;
  /** Partes e contrato assinado copiados na abertura do encerramento PJ. */
  pjContractSnapshot?: PjTerminationContractSnapshot | null;
  pjAgreement?: PjTerminationAgreement | null;
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
    handwrittenLetterConfirmedAt?: string | null;
    identityStatus: "not_requested" | "pending_signature" | "verified" | "manual_verified" | "contested";
    letterVersion?: number;
    letterApprovedAt?: string | null;
    letterApprovedBy?: string | null;
    formalizedAt?: string | null;
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
    submissionVersion?: number;
    correctionRound?: number;
    correctionMessage?: string | null;
    correctionRequestedAt?: string | null;
    correctionRequestedBy?: string | null;
    grossAmount?: number | null;
    discountAmount?: number | null;
    netAmount?: number | null;
    noPaymentDue?: boolean;
    paymentDueDate?: string | null;
    approvedAt?: string | null;
    approvedBy?: string | null;
  } | null;
  payment?: {
    status:
      | "not_started"
      | "configuration_required"
      | "draft"
      | "awaiting_financial_authorization"
      | "ready_to_submit"
      | "submitting"
      | "awaiting_bank_approval"
      | "processing"
      | "paid"
      | "rejected"
      | "approval_expired"
      | "failed"
      | "cancelled"
      | "not_applicable";
    requestId?: string | null;
    amount?: number | null;
    dueAt?: string | null;
    maskedDestination?: string | null;
    paidAt?: string | null;
    proofStoragePath?: string | null;
    lastError?: string | null;
    createdAt?: string | null;
  } | null;
  employeeCompletion?: {
    status: "not_started" | "ready" | "sent" | "completed";
    tokenHash?: string | null;
    tokenExpiresAt?: string | null;
    recipientEmail?: string | null;
    sentAt?: string | null;
    completedAt?: string | null;
    communication?: {
      providerId?: string | null;
      status?: string | null;
      deliveredAt?: string | null;
      openedAt?: string | null;
      clickedAt?: string | null;
      lastError?: string | null;
    } | null;
  } | null;
  internalClosure?: {
    status: "pending" | "completed" | "completed_with_reservations";
    reservations?: Array<{
      type: "uniforms_not_returned" | "aso_no_show";
      note: string;
      recordedAt: string;
      recordedBy: string;
      pendingPieces?: number | null;
      appointmentAt?: string | null;
    }>;
    communication?: {
      recipientEmail?: string | null;
      providerId?: string | null;
      status?: string | null;
      sentAt?: string | null;
      deliveredAt?: string | null;
      openedAt?: string | null;
      clickedAt?: string | null;
      lastError?: string | null;
    } | null;
    completedAt?: string | null;
    completedBy?: string | null;
  } | null;
  financialProvisionClosure?: {
    status: "completed" | "failed";
    cancelledCount: number;
    cancelledExpenseIds: string[];
    completedAt?: string | null;
    attemptedAt: string;
    error?: string | null;
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
  type: CltTerminationProcess["processType"];
  title: string;
  subjectId: string;
  subjectName: string;
  employerEntityId?: string | null;
  employerName?: string | null;
  employerCnpj?: string | null;
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
