export type CollaboratorRequestType = "transport_voucher";
export type TransportVoucherRequestAction = "activate" | "change" | "suspend" | "reactivate";
export type CollaboratorRequestStatus = "pending" | "approved" | "rejected" | "cancelled";
export type RequestDocumentStatus = "not_applicable" | "pending" | "generated" | "failed";
export type CollaboratorRequestEvent = {
  type: "submitted" | "effective_date_scheduled" | "approved" | "rejected" | "cancelled" | "benefit_updated" | "decision_recorded" | "term_generated" | "term_failed" | "signature_sent";
  label: string;
  at: string;
  actorId: string;
  actorName: string;
  details: string | null;
};

export type CollaboratorRequestSignature = {
  status: string | null;
  requestId: string | null;
  signingUrl: string | null;
  sentAt: string | null;
  signedAt: string | null;
};

export type CollaboratorRequest = {
  id: string;
  type: CollaboratorRequestType;
  employeeId: string;
  employeeName: string;
  requesterId: string;
  requesterName: string;
  unitId: string | null;
  unitIds: string[];
  action: TransportVoucherRequestAction;
  requestDate: string;
  cutoffDay: number;
  requestedAfterCutoff: boolean;
  processingCompetence: string;
  effectiveDate: string;
  payslipPaymentDate: string;
  details: string;
  status: CollaboratorRequestStatus;
  currentSnapshot: {
    active: boolean;
    dailyValue: number | null;
  };
  review: null | {
    reviewerId: string;
    reviewerName: string;
    reviewedAt: string;
    notes: string | null;
    approvedDailyValue: number | null;
  };
  decisionId: string | null;
  generatedDocumentId: string | null;
  documentStatus: RequestDocumentStatus;
  documentError: string | null;
  trail: CollaboratorRequestEvent[];
  cancelledAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export const TRANSPORT_VOUCHER_ACTION_LABELS: Record<TransportVoucherRequestAction, string> = {
  activate: "Adesão",
  change: "Alteração",
  suspend: "Suspensão",
  reactivate: "Reativação",
};

export const COLLABORATOR_REQUEST_STATUS_LABELS: Record<CollaboratorRequestStatus, string> = {
  pending: "Aguardando análise",
  approved: "Aprovada",
  rejected: "Rejeitada",
  cancelled: "Cancelada",
};
