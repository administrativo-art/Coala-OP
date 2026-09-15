import { closureDateFromIso } from "@/features/financial/cash-closures/date";
import { normalizeChannel } from "@/features/financial/cash-closures/channel-normalization";
import type {
  ReconciliationSaleStatus,
  ReconciliationSalesChannel,
  SalesSourceIdentifiers,
} from "./types";

function normalizedText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, " ");
}

export function normalizeReconciliationChannel(raw: string): ReconciliationSalesChannel | null {
  const canonical = raw.trim().toLowerCase();
  if (canonical === "pix" || canonical === "debit_card" || canonical === "credit_card") {
    return canonical;
  }
  const channel = normalizeChannel(raw).channel;
  return channel === "pix" || channel === "debit_card" || channel === "credit_card"
    ? channel
    : null;
}

export function normalizePdvSaleStatus(raw: string): ReconciliationSaleStatus {
  const value = normalizedText(raw);
  if (["CANCELADO", "CANCELLED", "CANCELED"].includes(value)) return "cancelled";
  if (["ESTORNADO", "DEVOLVIDO", "REFUNDED", "REFUND"].includes(value)) return "refunded";
  if (["PENDENTE", "PENDING", "PROCESSANDO"].includes(value)) return "pending";
  return "approved";
}

export function normalizeStoneSaleStatus(raw: string): ReconciliationSaleStatus {
  const value = normalizedText(raw);
  if (["APPROVED", "APROVADA", "APROVADO", "PAID", "CAPTURED", "CONFIRMED"].includes(value)) return "approved";
  if (["CANCELLED", "CANCELED", "CANCELADA", "CANCELADO", "VOIDED"].includes(value)) return "cancelled";
  if (["REFUNDED", "REFUND", "ESTORNADA", "ESTORNADO", "DEVOLVIDA"].includes(value)) return "refunded";
  if (["CHARGEBACK", "CONTESTADA", "CONTESTADO"].includes(value)) return "chargeback";
  return "pending";
}

export function reconciliationBusinessDate(soldAt: string) {
  return closureDateFromIso(soldAt);
}

export function reconciliationPeriod(soldAt: string) {
  return reconciliationBusinessDate(soldAt).slice(0, 7);
}

function cleanIdentifier(value: string | null | undefined) {
  const cleaned = value ? normalizedText(value).replace(/[^A-Z0-9]/g, "") : "";
  return cleaned || null;
}

export function normalizeSalesIdentifiers(identifiers: SalesSourceIdentifiers): SalesSourceIdentifiers {
  return {
    providerTransactionId: cleanIdentifier(identifiers.providerTransactionId),
    nsu: cleanIdentifier(identifiers.nsu),
    authorizationCode: cleanIdentifier(identifiers.authorizationCode),
    terminalId: cleanIdentifier(identifiers.terminalId),
    merchantOrderId: cleanIdentifier(identifiers.merchantOrderId),
  };
}
