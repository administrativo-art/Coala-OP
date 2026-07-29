import { createHash } from "node:crypto";

export type TransportVoucherDecisionMode = "requested" | "waived";
export type TransportVoucherDocumentKind =
  | "transport_voucher_request"
  | "transport_voucher_waiver";

export type TransportVoucherDecision = {
  decisionId: string;
  employeeId: string;
  mode: TransportVoucherDecisionMode;
  documentKind: TransportVoucherDocumentKind;
  decisionVersion: number;
  effectiveDate: string;
  dailyValue: number | null;
  reason: string | null;
  status: "current" | "superseded";
  protocol: string;
  idempotencyKey: string;
  supersedesDecisionId: string | null;
  supersededByDecisionId: string | null;
  generatedDocumentId: string | null;
  createdAt: string;
  createdBy: string;
};

export function transportVoucherDecisionMode(active: boolean): TransportVoucherDecisionMode {
  return active ? "requested" : "waived";
}

export function transportVoucherDocumentKind(
  mode: TransportVoucherDecisionMode,
): TransportVoucherDocumentKind {
  return mode === "requested"
    ? "transport_voucher_request"
    : "transport_voucher_waiver";
}

export function transportVoucherDecisionKey(input: {
  employeeId: string;
  decisionVersion: number;
  effectiveDate: string;
  mode: TransportVoucherDecisionMode;
}) {
  return `vtd_${createHash("sha256")
    .update(JSON.stringify([
      input.employeeId,
      input.decisionVersion,
      input.effectiveDate,
      input.mode,
    ]))
    .digest("hex")}`;
}

export function normalizeTransportVoucherEffectiveDate(value: unknown, fallback: string) {
  const candidate = typeof value === "string" ? value.trim().slice(0, 10) : "";
  return /^\d{4}-\d{2}-\d{2}$/.test(candidate) ? candidate : fallback.slice(0, 10);
}
