import type { BankPaymentRequest } from "./types";

export type PaymentTimelineStep = {
  title: string;
  meta: string;
  state: "done" | "pending" | "fail";
};

const FAILED_STATUSES = new Set(["failed", "rejected", "approval_expired", "cancelled"]);

const FINANCIAL_TIME_ZONE = "America/Belem";

export function formatFinancialDateTime(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: FINANCIAL_TIME_ZONE,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date).replace(",", "");
}

function financialDateKey(value: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: FINANCIAL_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(value);
}

function dateKeySerial(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return Date.UTC(year, month - 1, day) / 86_400_000;
}

export function financialDaysUntil(value: string | null | undefined, now = new Date()) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  return dateKeySerial(value) - dateKeySerial(financialDateKey(now));
}

export function isWithinPastFinancialDays(
  value: string | null | undefined,
  days: number,
  now = new Date(),
) {
  if (!value) return false;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  const distance = dateKeySerial(financialDateKey(now)) - dateKeySerial(financialDateKey(date));
  return distance >= 0 && distance <= days;
}

export function formatFinancialDate(value?: string | null) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-");
  return `${day}/${month}/${year}`;
}

function scheduledFor(item: BankPaymentRequest) {
  return item.barcodeSnapshot?.scheduledFor ?? item.scheduledFor ?? null;
}

export function buildPaymentTimeline(
  item: BankPaymentRequest,
  sourceDescription: string,
): PaymentTimelineStep[] {
  const failed = FAILED_STATUSES.has(item.status);
  const scheduledDate = formatFinancialDate(scheduledFor(item));
  const approvalMeta = item.bankApprovalObservedAt
    ? `Identificada em ${formatFinancialDateTime(item.bankApprovalObservedAt)}`
    : item.status === "awaiting_bank_approval"
      ? "Aguardando aprovação no aplicativo ou Internet Banking"
      : failed
        ? "Não confirmada pelo Banco Inter"
        : "Confirmação ainda sem horário registrado";
  const schedulingMeta = item.bankSchedulingObservedAt
    ? `Identificado em ${formatFinancialDateTime(item.bankSchedulingObservedAt)}${scheduledDate ? ` · para ${scheduledDate}` : ""}`
    : scheduledDate
      ? `Programado para ${scheduledDate}`
      : "—";
  const liquidationMeta = item.bankLiquidationObservedAt
    ? `Identificada em ${formatFinancialDateTime(item.bankLiquidationObservedAt)}`
    : item.paidAt
      ? formatFinancialDateTime(item.paidAt)
      : scheduledDate
        ? `Aguardando a data programada (${scheduledDate})`
        : "—";
  const statementStatus = item.statementReconciliationStatus;
  const statementRequired = item.paymentRail === "barcode"
    || Boolean(statementStatus && statementStatus !== "not_expected");

  return [
    {
      title: "Solicitação criada",
      meta: `${sourceDescription} · ${formatFinancialDateTime(item.createdAt)}`,
      state: "done",
    },
    {
      title: "Autorização financeira",
      meta: item.authorizedAt ? formatFinancialDateTime(item.authorizedAt) : "Pendente — depende de você",
      state: item.authorizedAt ? "done" : "pending",
    },
    {
      title: "Enviado ao Banco Inter",
      meta: item.submittedAt ? formatFinancialDateTime(item.submittedAt) : failed ? "Falhou no envio" : "—",
      state: item.submittedAt ? "done" : failed ? "fail" : "pending",
    },
    {
      title: "Autorização bancária identificada",
      meta: approvalMeta,
      state: item.bankApprovalObservedAt ? "done" : failed ? "fail" : "pending",
    },
    ...(scheduledDate ? [{
      title: "Pagamento agendado",
      meta: schedulingMeta,
      state: item.bankSchedulingObservedAt
        ? "done" as const
        : failed
          ? "fail" as const
          : "pending" as const,
    }] : []),
    {
      title: "Pagamento liquidado",
      meta: liquidationMeta,
      state: item.bankLiquidationObservedAt || item.paidAt ? "done" : "pending",
    },
    ...(statementRequired ? [{
      title: "Conciliado no extrato",
      meta:
        statementStatus === "matched"
          ? "Correspondência exata"
          : statementStatus === "divergent"
            ? "Divergência de valor"
            : "—",
      state: statementStatus === "matched"
        ? "done" as const
        : statementStatus === "divergent"
          ? "fail" as const
          : "pending" as const,
    }] : []),
  ];
}
