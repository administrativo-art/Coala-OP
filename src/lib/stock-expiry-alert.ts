import type { StockAuditItem } from "@/types";

export type StockExpiryAlertLevel = "expired" | "today" | "urgent" | "warning" | "ok" | "none" | "invalid";

export type StockExpiryAlert = {
  level: StockExpiryAlertLevel;
  label: string;
  detail: string;
  daysUntilExpiry: number | null;
  attention: boolean;
};

const DAY_MS = 24 * 60 * 60 * 1000;

function pluralDays(days: number) {
  return `${days} ${days === 1 ? "dia" : "dias"}`;
}

function parseLocalDate(value?: string | null) {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (match) {
    const [, year, month, day] = match;
    return new Date(Number(year), Number(month) - 1, Number(day));
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
}

export function formatStockExpiryDate(value?: string | null) {
  const date = parseLocalDate(value);
  if (!date) return value ? "Data inválida" : "N/A";
  return date.toLocaleDateString("pt-BR");
}

export function getStockExpiryAlert(
  expiryDate?: string | null,
  urgentThreshold = 7,
  alertThreshold = 30,
): StockExpiryAlert {
  if (!expiryDate) {
    return {
      level: "none",
      label: "Validade indefinida",
      detail: "Sem data de validade cadastrada.",
      daysUntilExpiry: null,
      attention: false,
    };
  }

  const expiry = parseLocalDate(expiryDate);
  if (!expiry) {
    return {
      level: "invalid",
      label: "Validade inválida",
      detail: "A data cadastrada não pôde ser interpretada.",
      daysUntilExpiry: null,
      attention: true,
    };
  }

  const today = new Date();
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const daysUntilExpiry = Math.round((expiry.getTime() - todayStart.getTime()) / DAY_MS);
  const formatted = formatStockExpiryDate(expiryDate);

  if (daysUntilExpiry < 0) {
    return {
      level: "expired",
      label: `Vencido há ${pluralDays(Math.abs(daysUntilExpiry))}`,
      detail: `Venceu em ${formatted}.`,
      daysUntilExpiry,
      attention: true,
    };
  }

  if (daysUntilExpiry === 0) {
    return {
      level: "today",
      label: "Vence hoje",
      detail: `Validade ${formatted}.`,
      daysUntilExpiry,
      attention: true,
    };
  }

  if (daysUntilExpiry <= urgentThreshold) {
    return {
      level: "urgent",
      label: `Vence em ${pluralDays(daysUntilExpiry)}`,
      detail: `Validade ${formatted}.`,
      daysUntilExpiry,
      attention: true,
    };
  }

  if (daysUntilExpiry <= alertThreshold) {
    return {
      level: "warning",
      label: `Atenção: ${pluralDays(daysUntilExpiry)}`,
      detail: `Validade ${formatted}.`,
      daysUntilExpiry,
      attention: true,
    };
  }

  return {
    level: "ok",
    label: "Validade OK",
    detail: `Validade ${formatted}.`,
    daysUntilExpiry,
    attention: false,
  };
}

export function getStockExpirySummary(items: Pick<StockAuditItem, "expiryDate">[]) {
  return items.reduce(
    (summary, item) => {
      const alert = getStockExpiryAlert(item.expiryDate);
      summary.total += 1;
      summary[alert.level] += 1;
      if (alert.attention) summary.attention += 1;
      return summary;
    },
    {
      total: 0,
      attention: 0,
      expired: 0,
      today: 0,
      urgent: 0,
      warning: 0,
      ok: 0,
      none: 0,
      invalid: 0,
    } as Record<StockExpiryAlertLevel | "total" | "attention", number>,
  );
}
