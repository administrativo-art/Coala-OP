import type {
  FinancialInboxMessage,
  FinancialInboxRetentionClass,
} from "./types";

export const FINANCIAL_INBOX_RETENTION_POLICY_VERSION = 1;
export const FINANCIAL_INBOX_ARCHIVE_AFTER_MONTHS = 6;

function addUtcMonths(value: Date, months: number) {
  const year = value.getUTCFullYear();
  const month = value.getUTCMonth() + months;
  const targetYear = year + Math.floor(month / 12);
  const targetMonth = ((month % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  return new Date(Date.UTC(
    targetYear,
    targetMonth,
    Math.min(value.getUTCDate(), lastDay),
    value.getUTCHours(),
    value.getUTCMinutes(),
    value.getUTCSeconds(),
    value.getUTCMilliseconds(),
  ));
}

function retentionClassFor(message: FinancialInboxMessage): FinancialInboxRetentionClass {
  if (message.classification.marketingLikely || !message.classification.financeLikely) return "non_financial";
  if (["fgts", "inss_darf", "tax"].includes(message.classification.documentType)) return "tax_or_payroll";
  return "financial_standard";
}

function retentionYears(retentionClass: FinancialInboxRetentionClass) {
  if (retentionClass === "non_financial") return 1;
  if (retentionClass === "tax_or_payroll") return 10;
  return 6;
}

export function financialInboxRetentionCutoff(now: Date) {
  return addUtcMonths(now, -FINANCIAL_INBOX_ARCHIVE_AFTER_MONTHS);
}

export function financialInboxRetentionPlan(message: FinancialInboxMessage, now: Date) {
  if (!["ignored", "reconciled"].includes(message.status)) return null;
  const anchor = new Date(message.updatedAt);
  if (Number.isNaN(anchor.getTime()) || anchor > financialInboxRetentionCutoff(now)) return null;
  const retentionClass = retentionClassFor(message);
  return {
    archivedFromStatus: message.status as "ignored" | "reconciled",
    retentionClass,
    anchorAt: anchor.toISOString(),
    purgeEligibleAt: addUtcMonths(anchor, retentionYears(retentionClass) * 12).toISOString(),
  };
}
