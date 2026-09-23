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
  /** Legacy name: the CSV id identifies an event, not necessarily a sale. */
  transactionId: string | null;
  merchantIdentity: StonePixMerchantIdentity;
  reviewEvidence: StonePixReviewEvidence;
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

export type StonePixMerchantIdentity = {
  version: 1;
  status: "identified" | "missing" | "invalid" | "terminal_conflict";
  stoneCode: string | null;
  terminalSerialNumber: string | null;
};

export type StonePixReviewIssue =
  | "invalid_identifiers" | "invalid_timestamp" | "invalid_amount"
  | "unsupported_event" | "cancellation" | "inconsistent_payment"
  | "merchant_unidentified" | "duplicate_event" | "related_pix_events";

export type StonePixReviewEvidence = {
  version: 1;
  eventId: string | null;
  e2eId: string | null;
  refundId: string | null;
  createdAtUtc: string | null;
  providerDateTimeUtc: string | null;
  eventKind: "payment" | "cancellation" | "unknown";
  amounts: {
    gross: number | null; paid: number | null; canceled: number | null;
    fee: number | null; operation: number | null;
  };
  issues: StonePixReviewIssue[];
  /** Candidate only, not a matched sale, unit authorization or bank receipt. */
  candidateForReview: boolean;
};

// Same conservative arithmetic envelope as the bounded 500-row sales review.
const MAX_PIX_REVIEW_CENTS = Math.floor(Number.MAX_SAFE_INTEGER / 1000);

/** CSV values are already cents. Reject missing, fractional and unsafe values. */
export function exactStonePixCents(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value >= 0 && value <= MAX_PIX_REVIEW_CENTS ? value : null;
  }
  if (typeof value !== "string" || value.length > 40) return null;
  const text = value.trim();
  if (!/^\d{1,16}(?:[.,]0{1,12})?$/.test(text)) return null;
  const cents = Number(text.replace(",", "."));
  return Number.isSafeInteger(cents) && cents <= MAX_PIX_REVIEW_CENTS ? cents : null;
}

function pixIdentifier(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return /^[A-Za-z0-9_-]{1,160}$/.test(text) ? text : null;
}

function pixUtcTimestamp(value: unknown, allowDocumentedNaiveUtc = false): string | null {
  if (typeof value !== "string" || value.length > 40) return null;
  let text = value.trim();
  // provider_datetime in Stone's public sample omits the zone; its documented
  // semantics are UTC, not the server's local timezone.
  if (allowDocumentedNaiveUtc && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?$/.test(text)) text += "Z";
  if (!/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,6})?(?:Z|\+00:00)$/.test(text)) return null;
  const date = new Date(text);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 19) !== text.slice(0, 19)) return null;
  return text; // Keep microseconds, never silently round a source timestamp.
}

function pixReviewEvidence(
  row: Record<string, unknown>, identity: StonePixMerchantIdentity,
): StonePixReviewEvidence {
  const issues: StonePixReviewIssue[] = [];
  const eventId = pixIdentifier(row.id);
  const e2eId = pixIdentifier(row.pix_transaction__e2e_id);
  const refundId = pixIdentifier(row.pix_transaction__detail__refund_id);
  const hasRefund = row.pix_transaction__detail__refund_id !== undefined
    && row.pix_transaction__detail__refund_id !== null
    && row.pix_transaction__detail__refund_id !== "";
  if (!eventId || !e2eId || (hasRefund && !refundId)) issues.push("invalid_identifiers");
  const createdAtUtc = pixUtcTimestamp(row.created_at);
  const providerDateTimeUtc = pixUtcTimestamp(row.pix_transaction__detail__provider_datetime, true);
  if (!createdAtUtc || !providerDateTimeUtc) issues.push("invalid_timestamp");
  else {
    const sortable = (value: string) => value.slice(0, 19)
      + (value.match(/\.(\d+)/)?.[1] ?? "").padEnd(6, "0");
    if (sortable(providerDateTimeUtc) < sortable(createdAtUtc)) issues.push("invalid_timestamp");
  }
  const amounts = {
    gross: exactStonePixCents(row.amount),
    paid: exactStonePixCents(row.pix_transaction__paid_amount),
    canceled: exactStonePixCents(row.pix_transaction__canceled_amount),
    fee: exactStonePixCents(row.pix_transaction__fee_amount),
    operation: exactStonePixCents(row.pix_transaction__detail__operation_amount),
  };
  if (Object.values(amounts).some(value => value === null)) issues.push("invalid_amount");
  const eventKind = row.pix_transaction__detail__operation === "pay" ? "payment"
    : row.pix_transaction__detail__operation === "cancel" ? "cancellation" : "unknown";
  if (eventKind === "unknown" || row.payment_method !== "pix"
    || (row.status !== "paid" && row.status !== "canceled")) issues.push("unsupported_event");
  if (eventKind === "cancellation" || row.status === "canceled"
    || (amounts.canceled !== null && amounts.canceled > 0) || hasRefund) issues.push("cancellation");
  if (eventKind === "payment" && (amounts.gross === null || amounts.gross <= 0
    || amounts.paid !== amounts.gross || amounts.operation !== amounts.gross
    || amounts.canceled !== 0 || amounts.fee === null || amounts.fee > amounts.gross)) {
    issues.push("inconsistent_payment");
  }
  if (identity.status !== "identified") issues.push("merchant_unidentified");
  return { version: 1, eventId, e2eId, refundId, createdAtUtc, providerDateTimeUtc,
    eventKind, amounts, issues, candidateForReview: issues.length === 0 };
}

/** Strictly recognizes the additional_data format in Stone's public CSV example.
 * This is source evidence only: it does not resolve a unit or authorize access.
 * Never infer a StoneCode from a credential, document or terminal serial.
 */
export function parseStonePixMerchantIdentity(
  additionalData: unknown,
  terminalSerialNumber: unknown,
): StonePixMerchantIdentity {
  const pending = (status: StonePixMerchantIdentity["status"]): StonePixMerchantIdentity => ({
    version: 1, status, stoneCode: null, terminalSerialNumber: null,
  });
  if (additionalData === undefined || additionalData === null || additionalData === "") {
    return pending("missing");
  }
  if (typeof additionalData !== "string" || additionalData.length > 1024) return pending("invalid");
  const text = additionalData.trim();
  if (!text || text === "[]") return pending("missing");
  if (!text.startsWith("[") || !text.endsWith("]")) return pending("invalid");
  const entries = text.slice(1, -1).split(/\}\s*,\s*\{/);
  if (entries.length !== 2) return pending("invalid");
  const values = new Map<string, string>();
  for (let index = 0; index < entries.length; index += 1) {
    const entry = `${index ? "{" : ""}${entries[index]}${index < entries.length - 1 ? "}" : ""}`;
    const match = /^\{name=(Cliente|Terminal), value=([A-Za-z0-9-]{1,160})\}$/.exec(entry);
    if (!match || values.has(match[1])) return pending("invalid");
    values.set(match[1], match[2]);
  }
  const stoneCode = values.get("Cliente");
  const terminal = values.get("Terminal");
  if (!stoneCode || !/^[1-9]\d{0,19}$/.test(stoneCode) || !terminal) return pending("invalid");
  if (terminalSerialNumber !== undefined && terminalSerialNumber !== null && terminalSerialNumber !== "") {
    if (typeof terminalSerialNumber !== "string" || terminalSerialNumber.trim() !== terminal) {
      return pending("terminal_conflict");
    }
  }
  return { version: 1, status: "identified", stoneCode, terminalSerialNumber: terminal };
}

export type StonePixSummary = {
  transactionCount: number;
  grossAmountCents: number;
  paidAmountCents: number;
  canceledAmountCents: number;
  feeAmountCents: number;
  netAmountCents: number;
  statuses: Record<string, number>;
};

export class StonePixProcessingError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "StonePixProcessingError";
  }
}

function processingError(code: string): never {
  throw new StonePixProcessingError(code);
}

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
  if (!isRecord(payload)) return processingError("invalid_payload");
  if (payload.type === "validation_notification") {
    return { type: "validation_notification" };
  }
  if (payload.type !== "pix") return processingError("unsupported_notification_type");

  const document = normalizeDocument(payload.document);
  const referenceDate = asLimitedString(payload.referenceDate, 10);
  const url = asLimitedString(payload.url, 4096);
  if (!DOCUMENT_PATTERN.test(document)) return processingError("invalid_document");
  if (!referenceDate || !DATE_PATTERN.test(referenceDate)) return processingError("invalid_reference_date");
  if (!url) return processingError("missing_download_url");

  const parsedDate = new Date(`${referenceDate}T00:00:00.000Z`);
  if (Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== referenceDate) {
    return processingError("invalid_reference_date");
  }

  return { type: "pix", url, document, referenceDate };
}

export function assertSafeStoneDownloadUrl(rawUrl: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return processingError("invalid_download_url");
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
    return processingError("unsafe_download_url");
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
    return processingError("unsafe_download_url");
  }
  return parsed;
}

export function parseStoneAmountInCents(value: unknown): number {
  if (typeof value === "number") {
    return Number.isFinite(value) ? Math.round(value) : 0;
  }
  if (typeof value !== "string") return 0;

  const normalized = value.trim().replace(/\s/g, "").replace(",", ".");
  if (!normalized) return 0;
  const amount = Number(normalized);
  return Number.isFinite(amount) ? Math.round(amount) : 0;
}

function normalizeRow(row: Record<string, unknown>, index: number): StonePixTransaction {
  const merchantIdentity = parseStonePixMerchantIdentity(
    row.pix_transaction__additional_data, row.pix_transaction__terminal__serial_number,
  );
  const transactionId = asLimitedString(row.id, 160);
  const createdAt = asLimitedString(row.created_at, 80);
  const operation = asLimitedString(row.pix_transaction__detail__operation, 80);
  const rowId = createHash("sha256")
    .update(`${transactionId ?? "row"}|${createdAt ?? ""}|${operation ?? ""}|${index}`)
    .digest("hex");

  return {
    rowId,
    transactionId,
    merchantIdentity,
    reviewEvidence: pixReviewEvidence(row, merchantIdentity),
    amountCents: parseStoneAmountInCents(row.amount),
    status: asLimitedString(row.status, 80)?.toLowerCase() ?? null,
    paymentMethod: asLimitedString(row.payment_method, 80)?.toLowerCase() ?? null,
    pixType: asLimitedString(row.pix_transaction__type, 80)?.toLowerCase() ?? null,
    createdAt,
    paidAmountCents: parseStoneAmountInCents(row.pix_transaction__paid_amount),
    canceledAmountCents: parseStoneAmountInCents(row.pix_transaction__canceled_amount),
    feeAmountCents: parseStoneAmountInCents(row.pix_transaction__fee_amount),
    terminalType: asLimitedString(row.pix_transaction__terminal__type, 100),
    terminalSerialNumber: asLimitedString(row.pix_transaction__terminal__serial_number, 160),
    operation,
    providerDateTime: asLimitedString(row.pix_transaction__detail__provider_datetime, 80),
    operationAmountCents: parseStoneAmountInCents(row.pix_transaction__detail__operation_amount),
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
  if (result.errors.length > 0) return processingError("invalid_csv");

  const transactions = result.data
    .filter((row) => Object.values(row).some((value) => String(value ?? "").trim()))
    .map(normalizeRow);
  // A repeated E2E may represent cancellation, replay or multiple events, never
  // multiple independently confirmed sales. Block every related row in this file.
  for (const [key, issue] of [
    ["eventId", "duplicate_event"], ["e2eId", "related_pix_events"],
  ] as const) {
    const counts = new Map<string, number>();
    for (const row of transactions) {
      const id = row.reviewEvidence[key];
      if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    for (const row of transactions) {
      const id = row.reviewEvidence[key];
      if (id && (counts.get(id) ?? 0) > 1) {
        row.reviewEvidence.issues.push(issue);
        row.reviewEvidence.candidateForReview = false;
      }
    }
  }
  return { transactions, summary: summarizeStonePixTransactions(transactions) };
}

export function stonePixFileId(document: string, referenceDate: string): string {
  return createHash("sha256").update(`${document}:${referenceDate}`).digest("hex");
}
