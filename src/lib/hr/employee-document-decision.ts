/**
 * Fase 10 — Motor de regras determinístico.
 *
 * Centraliza a decisão de arquivamento. Recebe o resultado da IA, do match, da
 * duplicidade e das permissões, e devolve UMA ação. A IA nunca decide arquivar.
 *
 * Módulo puro (sem Firestore/Next), testável isoladamente.
 */

import type { EmployeeMatchStatus } from "@/lib/hr/employee-document-match";
import type { VersionResolution } from "@/lib/hr/employee-document-distribution";

export type DocumentAction =
  | "READY_TO_FILE"
  | "CONFIRMATION_REQUIRED"
  | "REVIEW_REQUIRED"
  | "EMPLOYEE_MISMATCH"
  | "EXACT_DUPLICATE"
  | "POSSIBLE_DUPLICATE"
  | "REQUEST_NEW_FILE"
  | "BLOCKED";

export interface DocumentDecisionInput {
  userHasPermission: boolean;
  fileSafe: boolean;
  duplicateResolution: VersionResolution;
  employeeMatchStatus: EmployeeMatchStatus;
  multipleDocumentsDetected: boolean;
  legibility: "GOOD" | "PARTIAL" | "POOR";
  documentTypeCode: string;
  missingCriticalFields: string[];
  documentTypeConfidence: number;
  confirmationThreshold: number;
}

export interface DocumentDecision {
  action: DocumentAction;
  reason: string;
  /** Situação de UI simplificada. */
  status: "ready" | "review" | "blocked" | "duplicate";
}

function uiStatus(action: DocumentAction): DocumentDecision["status"] {
  switch (action) {
    case "READY_TO_FILE":
      return "ready";
    case "EXACT_DUPLICATE":
      return "duplicate";
    case "BLOCKED":
    case "EMPLOYEE_MISMATCH":
    case "REQUEST_NEW_FILE":
      return "blocked";
    default:
      return "review";
  }
}

/** Aplica as regras na ordem de prioridade e devolve a ação. */
export function decideDocumentAction(input: DocumentDecisionInput): DocumentDecision {
  const decide = (action: DocumentAction, reason: string): DocumentDecision => ({ action, reason, status: uiStatus(action) });

  if (!input.userHasPermission) return decide("BLOCKED", "PERMISSION_DENIED");
  if (!input.fileSafe) return decide("BLOCKED", "UNSAFE_FILE");
  if (input.duplicateResolution === "EXACT_DUPLICATE") return decide("EXACT_DUPLICATE", "EXACT_FILE");
  if (input.employeeMatchStatus === "MISMATCH") return decide("EMPLOYEE_MISMATCH", "EMPLOYEE_MISMATCH");
  if (input.multipleDocumentsDetected) return decide("REVIEW_REQUIRED", "MULTIPLE_DOCUMENTS");
  if (input.legibility === "POOR") return decide("REQUEST_NEW_FILE", "UNREADABLE");
  if (input.documentTypeCode === "UNKNOWN_DOCUMENT") return decide("REVIEW_REQUIRED", "UNKNOWN_TYPE");
  if (input.employeeMatchStatus === "UNKNOWN") return decide("REVIEW_REQUIRED", "UNKNOWN_EMPLOYEE");
  if (input.employeeMatchStatus === "POSSIBLE_MATCH") return decide("CONFIRMATION_REQUIRED", "POSSIBLE_EMPLOYEE");
  if (input.duplicateResolution === "POSSIBLE_DUPLICATE") return decide("POSSIBLE_DUPLICATE", "POSSIBLE_DUPLICATE");
  if (input.missingCriticalFields.length > 0) return decide("CONFIRMATION_REQUIRED", "MISSING_CRITICAL_FIELDS");
  if (input.documentTypeConfidence < input.confirmationThreshold) return decide("REVIEW_REQUIRED", "LOW_CONFIDENCE");

  return decide("READY_TO_FILE", "VALIDATED");
}
