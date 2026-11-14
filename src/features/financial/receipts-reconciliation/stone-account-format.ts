import type { StatusPillVariant } from "@/components/ui/status-pill";
import type { AuditCheckResult, ReceiptDay, ReceiptParcel, ReceiptParcelStatus } from "./stone-account";

export const centsLabel = (cents: number | null | undefined) => cents === null || cents === undefined ? "—"
  : (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
export const rateLabel = (value: number | null | undefined) => value === null || value === undefined ? "—"
  : `${(value * 100).toFixed(2).replace(".", ",")}%`;
export const dayLabel = (value: string | null | undefined) => value ? `${value.slice(8, 10)}/${value.slice(5, 7)}` : "—";
export const fullDateLabel = (value: string | null | undefined) => value ? `${value.slice(8, 10)}/${value.slice(5, 7)}/${value.slice(0, 4)}` : "—";
export function weekdayLabel(value: string) {
  return ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"][new Date(`${value}T12:00:00Z`).getUTCDay()];
}
/** Data e hora local do arquivo Stone (AAAAMMDDhhmmss). */
export function stoneLocalDateTimeLabel(value: string | null | undefined) {
  if (!value || !/^\d{14}/.test(value)) return value ?? "—";
  return `${value.slice(6, 8)}/${value.slice(4, 6)}/${value.slice(0, 4)} ${value.slice(8, 10)}:${value.slice(10, 12)}:${value.slice(12, 14)}`;
}

export const parcelStatusView: Record<ReceiptParcelStatus, { label: string; variant: StatusPillVariant }> = {
  paid: { label: "Pago no dia", variant: "ok" },
  paid_early: { label: "Antecipado", variant: "info" },
  paid_late: { label: "Pago com atraso", variant: "warn" },
  unpaid: { label: "Não pago", variant: "danger" },
  to_receive: { label: "A receber", variant: "neutral" },
  missing_file: { label: "Sem arquivo Stone", variant: "warn" },
  chargeback: { label: "Chargeback", variant: "danger" },
  review: { label: "Conferir", variant: "warn" },
};

export const dayReasonLabel: Record<ReceiptDay["reasons"][number]["kind"], string> = {
  early: "antecipação",
  late_in: "atrasados de outros dias",
  paid_later: "pagos depois",
  paid_before: "antecipados antes",
  unpaid: "não pagos",
  chargeback: "chargeback",
  review: "a conferir",
  adjustment: "ajuste no valor pago",
  no_expected: "pagos sem previsão identificada",
  unexplained: "sem explicação",
};

export const checkView: Record<AuditCheckResult, { symbol: string; className: string; label: string }> = {
  ok: { symbol: "✓", className: "bg-ds-ok-bg text-ds-ok", label: "confere" },
  bad: { symbol: "✕", className: "bg-ds-danger-bg text-ds-danger", label: "divergente" },
  warn: { symbol: "!", className: "bg-ds-warn-bg text-ds-warn", label: "conferir" },
  wait: { symbol: "◷", className: "bg-ds-info-bg text-ds-info", label: "em andamento" },
};

export function parcelTitle(parcel: ReceiptParcel) {
  if (parcel.source === "pix") return "Pix";
  const modality = parcel.modality === "debit" ? "débito" : parcel.modality === "credit" ? "crédito à vista"
    : parcel.modality === "installment" ? "crédito parcelado" : "outro produto";
  return `${parcel.brand ?? "Cartão"} ${modality}${parcel.installmentCount > 1 ? ` ${parcel.installment}/${parcel.installmentCount}` : ""}`;
}
