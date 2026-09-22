import { createHash, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";

import Papa from "papaparse";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DOCUMENT_PATTERN = /^\d{11,14}$/;

export type StonePixWebhookPayload =
  | { type: "validation_notification" }
  | {
      type: "pix";
      url: string;
      document: string;
      referenceDate: string;
    };

export type StonePixTransaction = {
  rowId: string;
  transactionId: string | null;
  amountCents: number;
  status: string | null;
  paymentMethod: string | null;
  pixType: string | null;
  createdAt: string | null;
  paidAmountCents: number;
  canceledAmountCents: number;
  feeAmountCents: number;
  terminalType: string | null;
  terminalSerialNumber: string | null;
  operation: string | null;
  providerDateTime: string | null;
  operationAmountCents: number;
};

export type StonePixSummary = {
  transactionCount: number;
  grossAmountCents: number;
  paidAmountCents: number;
  canceledAmountCents: number;
  feeAmountCents: number;
  netAmountCents: number;
  statuses: Record<string, number>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeDocument(value: unknown): string {
  return typeof value === "string" ? value.replace(/\D/g, "") : "";
}

function asLimitedString(value: unknown, maxLength = 256): string | null {
  if (value === null || value === undefined) return null;
  const normalized = String(value).trim();
  return normalized ? normalized.slice(0, maxLength) : null;
}

export function verifyStoneWebhookSecret(
  providedSecret: string | null | undefined,
  expectedSecret: string | null | undefined,
): boolean {
  const provided = providedSecret?.trim();
  const expected = expectedSecret?.trim();
  if (!provided || !expected) return false;

  const providedDigest = createHash("sha256").update(provided).digest();
  const expectedDigest = createHash("sha256").update(expected).digest();
  return timingSafeEqual(providedDigest, expectedDigest);
}

export function parseStonePixWebhookPayload(payload: unknown): StonePixWebhookPayload {
  if (!isRecord(payload)) throw new Error("invalid_payload");
  if (payload.type === "validation_notification") {
    return { type: "validation_notification" };
  }
  if (payload.type !== "pix") throw new Error("unsupported_notification_type");

  const document = normalizeDocument(payload.document);
  const referenceDate = asLimitedString(payload.referenceDate, 10);
  const url = asLimitedString(payload.url, 4096);
  if (!DOCUMENT_PATTERN.test(document)) throw new Error("invalid_document");
  if (!referenceDate || !DATE_PATTERN.test(referenceDate)) throw new Error("invalid_reference_date");
  if (!url) throw new Error("missing_download_url");

  const parsedDate = new Date(`${referenceDate}T00:00:00.000Z`);
  if (Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== referenceDate) {
    throw new Error("invalid_reference_date");
  }

  return { type: "pix", url, document, referenceDate };
}

export function assertSafeStoneDownloadUrl(rawUrl: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error("invalid_download_url");
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
    throw new Error("unsafe_download_url");
  }

  const hostname = parsed.hostname.toLowerCase().replace(/\.$/, "");
  if (
    !hostname
    || hostname === "localhost"
    || hostname.endsWith(".localhost")
    || hostname.endsWith(".local")
    || hostname.endsWith(".internal")
    || isIP(hostname) !== 0
    || !hostname.includes(".")
  ) {
    throw new Error("unsafe_download_url");
  }
  return parsed;
}

export function parseStoneMoneyToCents(value: unknown): number {
  if (typeof value === "number") {
    return Number.isFinite(value) ? Math.round(value * 100) : 0;
  }
  if (typeof value !== "string") return 0;

  let normalized = value.trim().replace(/\s/g, "").replace(/^R\$/i, "");
  if (!normalized) return 0;
  if (normalized.includes(",")) {
    normalized = normalized.replace(/\./g, "").replace(",", ".");
  } else {
    normalized = normalized.replace(/(?<=\d)\.(?=\d{3}(?:\D|$))/g, "");
  }
  const amount = Number(normalized);
  return Number.isFinite(amount) ? Math.round(amount * 100) : 0;
}

function normalizeRow(row: Record<string, unknown>, index: number): StonePixTransaction {
  const transactionId = asLimitedString(row.id, 160);
  const createdAt = asLimitedString(row.created_at, 80);
  const operation = asLimitedString(row.pix_transaction__detail__operation, 80);
  const rowId = createHash("sha256")
    .update(`${transactionId ?? "row"}|${createdAt ?? ""}|${operation ?? ""}|${index}`)
    .digest("hex");

  return {
    rowId,
    transactionId,
    amountCents: parseStoneMoneyToCents(row.amount),
    status: asLimitedString(row.status, 80)?.toLowerCase() ?? null,
    paymentMethod: asLimitedString(row.payment_method, 80)?.toLowerCase() ?? null,
    pixType: asLimitedString(row.pix_transaction__type, 80)?.toLowerCase() ?? null,
    createdAt,
    paidAmountCents: parseStoneMoneyToCents(row.pix_transaction__paid_amount),
    canceledAmountCents: parseStoneMoneyToCents(row.pix_transaction__canceled_amount),
    feeAmountCents: parseStoneMoneyToCents(row.pix_transaction__fee_amount),
    terminalType: asLimitedString(row.pix_transaction__terminal__type, 100),
    terminalSerialNumber: asLimitedString(row.pix_transaction__terminal__serial_number, 160),
    operation,
    providerDateTime: asLimitedString(row.pix_transaction__detail__provider_datetime, 80),
    operationAmountCents: parseStoneMoneyToCents(row.pix_transaction__detail__operation_amount),
  };
}

export function summarizeStonePixTransactions(
  transactions: StonePixTransaction[],
): StonePixSummary {
  const statuses: Record<string, number> = {};
  let grossAmountCents = 0;
  let paidAmountCents = 0;
  let canceledAmountCents = 0;
  let feeAmountCents = 0;

  for (const transaction of transactions) {
    grossAmountCents += transaction.amountCents;
    paidAmountCents += transaction.paidAmountCents;
    canceledAmountCents += transaction.canceledAmountCents;
    feeAmountCents += transaction.feeAmountCents;
    const status = transaction.status ?? "unknown";
    statuses[status] = (statuses[status] ?? 0) + 1;
  }

  return {
    transactionCount: transactions.length,
    grossAmountCents,
    paidAmountCents,
    canceledAmountCents,
    feeAmountCents,
    netAmountCents: paidAmountCents - canceledAmountCents - feeAmountCents,
    statuses,
  };
}

export function parseStonePixCsv(csv: string): {
  transactions: StonePixTransaction[];
  summary: StonePixSummary;
} {
  const result = Papa.parse<Record<string, unknown>>(csv, {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (header) => header.replace(/^\uFEFF/, "").trim(),
  });
  if (result.errors.length > 0) throw new Error("invalid_csv");

  const transactions = result.data
    .filter((row) => Object.values(row).some((value) => String(value ?? "").trim()))
    .map(normalizeRow);
  return { transactions, summary: summarizeStonePixTransactions(transactions) };
}

export function stonePixFileId(document: string, referenceDate: string): string {
  return createHash("sha256").update(`${document}:${referenceDate}`).digest("hex");
}
