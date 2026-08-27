import type { CashClosureStatus } from "./types";

const TRANSITIONS: Record<CashClosureStatus, readonly CashClosureStatus[]> = {
  not_synced: ["draft", "sync_error"],
  sync_error: ["draft"],
  draft: ["pending_review", "sync_error"],
  pending_review: ["approved", "reopened"],
  approved: ["reopened"],
  reopened: ["pending_review", "approved", "sync_error"],
};

export function canTransitionCashClosure(from: CashClosureStatus, to: CashClosureStatus) {
  return TRANSITIONS[from].includes(to);
}

export function assertCashClosureTransition(from: CashClosureStatus, to: CashClosureStatus) {
  if (!canTransitionCashClosure(from, to)) {
    throw new Error(`Fechamento em ${from} não pode avançar para ${to}.`);
  }
}

export function canEditCashClosure(status: CashClosureStatus) {
  return status === "draft" || status === "reopened";
}
