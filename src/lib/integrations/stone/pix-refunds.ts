import { createHash } from "node:crypto";
import type { StonePixTransaction } from "./pix-conciliation";

const MAX_MONTH_BYTES = 400 * 1024;
const MAX_REFUND_ROWS_PER_DAY = 1000;
const MAX_WINDOW_DAYS = 366;
const DAY_MS = 86_400_000;

export const pixRefundKey = (value: string) => "e" + createHash("sha256").update(value).digest("hex");
export const pixRefundMonthId = (workspaceId: string, document: string, month: string) =>
  pixRefundKey(JSON.stringify([workspaceId, document, month]));

export type PixRefundEvent = {
  stoneCode: string | null;
  referenceDate: string;
  eventId: string | null;
  refundId: string | null;
  occurredAt: string | null;
  amountCents: number | null;
  state: "confirmed" | "unverified";
};

export type PixRefundDay = {
  sourceHash: string;
  complete: boolean;
  events: Record<string, PixRefundEvent[]>;
};

export type PixRefundMonth = {
  days: Record<string, { sourceHash: string; complete: boolean }>;
  events: Record<string, PixRefundEvent[]>;
};

export type PixRefundCheck = {
  state: "clear" | "incomplete" | "events_found";
  checkedThrough: string;
  complete: boolean;
  events: PixRefundEvent[];
};

export type PixRefundSourceRow = Pick<StonePixTransaction, "status" | "paymentMethod" | "merchantIdentity"> & {
  reviewEvidence: Omit<StonePixTransaction["reviewEvidence"], "issues"> & { issues: string[] };
};

export function projectPixRefundDay(referenceDate: string, sourceHash: string, rows: PixRefundSourceRow[]): PixRefundDay {
  const events: PixRefundDay["events"] = {};
  let complete = true;
  let projectedCount = 0;
  for (const row of rows) {
    const evidence = row.reviewEvidence;
    const normalPayment = evidence.eventKind === "payment" && row.status === "paid"
      && row.paymentMethod === "pix" && evidence.amounts.canceled === 0 && evidence.refundId === null
      && !!evidence.eventId && !!evidence.e2eId && !!evidence.createdAtUtc && !!evidence.providerDateTimeUtc
      && evidence.issues.length === 0;
    if (normalPayment) continue;
    if (!evidence.e2eId) {
      complete = false;
      continue;
    }
    if (++projectedCount > MAX_REFUND_ROWS_PER_DAY) return { sourceHash, complete: false, events: {} };
    const stoneCode = row.merchantIdentity.status === "identified" ? row.merchantIdentity.stoneCode : null;
    const amountCents = evidence.amounts.operation;
    const confirmed = evidence.eventKind === "cancellation" && row.status === "canceled"
      && row.paymentMethod === "pix" && !!stoneCode && !!evidence.eventId && !!evidence.refundId
      && !!evidence.providerDateTimeUtc && amountCents !== null && amountCents > 0
      && !evidence.issues.some(issue => ["invalid_identifiers", "invalid_timestamp", "invalid_amount", "unsupported_event"].includes(issue));
    const key = pixRefundKey(evidence.e2eId);
    (events[key] ??= []).push({
      stoneCode, referenceDate, eventId: evidence.eventId, refundId: evidence.refundId,
      occurredAt: evidence.providerDateTimeUtc, amountCents, state: confirmed ? "confirmed" : "unverified",
    });
  }
  return { sourceHash, complete, events };
}

export function updatePixRefundMonth(current: PixRefundMonth | undefined, referenceDate: string, day?: PixRefundDay): PixRefundMonth {
  const dayKey = "d" + referenceDate.slice(-2);
  const days = { ...current?.days };
  delete days[dayKey];
  if (!day) return { days, events: current?.events ?? {} };
  // Keep old evidence during failed or unproven replacements. It can only keep a
  // case pending. A complete authoritative replacement can remove it.
  const events = Object.fromEntries(Object.entries(current?.events ?? {}).map(([key, rows]) =>
    [key, day.complete ? rows.filter(row => row.referenceDate !== referenceDate) : rows]));
  for (const [key, rows] of Object.entries(day.events)) {
    const combined = [...(events[key] ?? []), ...rows];
    events[key] = [...new Map(combined.map(row => [JSON.stringify(row), row])).values()];
  }
  const next = {
    days: { ...days, [dayKey]: { sourceHash: day.sourceHash, complete: day.complete } },
    events: Object.fromEntries(Object.entries(events).filter(([, rows]) => rows.length)),
  };
  return Buffer.byteLength(JSON.stringify(next)) > MAX_MONTH_BYTES
    ? { days, events: current?.events ?? {} } : next;
}

export function pixRefundDates(from: string, through: string): string[] | null {
  const first = Date.parse(from + "T00:00:00Z");
  const last = Date.parse(through + "T00:00:00Z");
  const count = (last - first) / DAY_MS + 1;
  if (!Number.isInteger(count) || count < 1 || count > MAX_WINDOW_DAYS) return null;
  return Array.from({ length: count }, (_, index) => new Date(first + index * DAY_MS).toISOString().slice(0, 10));
}

export function evaluatePixRefundCheck(input: {
  dates: string[] | null;
  through: string;
  months: ReadonlyMap<string, PixRefundMonth>;
  e2eId: string;
  stoneCode: string;
  saleSourceHash: string | null;
}): PixRefundCheck {
  const { dates, through, months, e2eId, stoneCode, saleSourceHash } = input;
  const key = pixRefundKey(e2eId);
  const range = new Set(dates);
  const events = new Map<string, PixRefundEvent>();
  for (const month of months.values()) {
    for (const row of month.events?.[key] ?? []) {
      if (!range.has(row.referenceDate) || (row.stoneCode !== null && row.stoneCode !== stoneCode)) continue;
      // Identical republications count once. Conflicting records for one refund
      // remain visible as unverified rather than being summed or suppressed.
      const id = row.refundId ?? row.eventId;
      const dedupKey = id ? JSON.stringify([row.stoneCode, id]) : JSON.stringify(row);
      const currentDay = month.days?.["d" + row.referenceDate.slice(-2)];
      const event = currentDay?.complete ? row : { ...row, state: "unverified" as const };
      const prior = events.get(dedupKey);
      if (!prior) events.set(dedupKey, event);
      else if (prior.amountCents !== row.amountCents || prior.occurredAt !== row.occurredAt || prior.state !== event.state) {
        events.set(dedupKey, { ...prior, amountCents: null, state: "unverified" });
      }
    }
  }
  const rows = [...events.values()].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  const complete = !!saleSourceHash && !!dates?.every((date, index) => {
    const day = months.get(date.slice(0, 7))?.days?.["d" + date.slice(-2)];
    return day?.complete && (index > 0 || day.sourceHash === saleSourceHash);
  });
  return { state: rows.length ? "events_found" : complete ? "clear" : "incomplete", checkedThrough: through, complete, events: rows };
}
