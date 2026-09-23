import { z } from "zod";
import { MAX_SALE_CENTS, MAX_SALES_REVIEW_FACTS, reviewDate, reviewTimestamp } from "./validation";
import type { SalesMatchFact } from "./types";
import type { DailySalesScope } from "./daily-review";
import { closureDateFromIso } from "../cash-closures/date";

const id = z.string().regex(/^[A-Za-z0-9_-]{1,160}$/);
const cents = z.number().int().min(0).max(MAX_SALE_CENTS).nullable();
const rowSchema = z.object({
  rowId: z.string().regex(/^[a-f0-9]{64}$/), sourceHash: z.string().regex(/^[a-f0-9]{64}$/),
  status: z.string().nullable(), paymentMethod: z.string().nullable(),
  merchantIdentity: z.object({ version: z.literal(1), status: z.enum(["identified", "missing", "invalid", "terminal_conflict"]),
    stoneCode: z.string().regex(/^[1-9]\d{0,19}$/).nullable(), terminalSerialNumber: id.nullable() }),
  reviewEvidence: z.object({ version: z.literal(1), eventId: id.nullable(), e2eId: id.nullable(), refundId: id.nullable(),
    createdAtUtc: reviewTimestamp.nullable(), providerDateTimeUtc: reviewTimestamp.nullable(),
    eventKind: z.enum(["payment", "cancellation", "unknown"]),
    amounts: z.object({ gross: cents, paid: cents, canceled: cents, fee: cents, operation: cents }),
    issues: z.array(z.string().max(80)).max(20), candidateForReview: z.boolean() }),
});
const headSchema = z.object({ workspaceId: z.string(), document: z.string().regex(/^(?:\d{11}|\d{14})$/),
  referenceDate: reviewDate, status: z.literal("processed"), sourceHash: z.string().regex(/^[a-f0-9]{64}$/),
  summary: z.object({ transactionCount: z.number().int().min(0).max(MAX_SALES_REVIEW_FACTS) }) });
export type PixSourceResult = { status: "available" | "not_configured" | "unavailable" | "pending";
  facts: SalesMatchFact[]; excludedCount: number; fileId: string | null };

/** Validate a single consistent, complete snapshot before filtering by StoneCode. */
export function reviewPixSnapshot(input: { head: unknown; rows: unknown[]; document: string;
  fileId: string; scope: DailySalesScope }): PixSourceResult {
  const pending: PixSourceResult = { status: "pending", facts: [], excludedCount: 0, fileId: input.fileId };
  const head = headSchema.safeParse(input.head);
  const rows = z.array(rowSchema).max(MAX_SALES_REVIEW_FACTS).safeParse(input.rows);
  if (!head.success || !rows.success || head.data.workspaceId !== input.scope.workspaceId
    || head.data.document !== input.document || head.data.referenceDate !== input.scope.referenceDate
    || head.data.summary.transactionCount !== rows.data.length
    || rows.data.some(row => row.sourceHash !== head.data.sourceHash)
    || new Set(rows.data.map(row => row.rowId)).size !== rows.data.length) return pending;
  const events = new Map<string, number>(); const e2es = new Map<string, number>();
  for (const row of rows.data) {
    const e = row.reviewEvidence;
    if (e.eventId) events.set(e.eventId, (events.get(e.eventId) ?? 0) + 1);
    if (e.e2eId) e2es.set(e.e2eId, (e2es.get(e.e2eId) ?? 0) + 1);
  }
  const facts: SalesMatchFact[] = []; let excludedCount = 0;
  for (const row of rows.data) {
    const identity = row.merchantIdentity; const e = row.reviewEvidence; const a = e.amounts;
    if (identity.stoneCode && identity.stoneCode !== input.scope.stoneCode) continue;
    if (identity.status !== "identified" || identity.stoneCode !== input.scope.stoneCode
      || !identity.terminalSerialNumber || !e.candidateForReview || e.issues.length
      || !e.eventId || !e.e2eId || events.get(e.eventId) !== 1 || e2es.get(e.e2eId) !== 1
      || !e.createdAtUtc || !e.providerDateTimeUtc || e.refundId !== null
      || e.eventKind !== "payment" || row.status !== "paid" || row.paymentMethod !== "pix"
      || a.gross === null || a.gross <= 0 || a.paid !== a.gross || a.operation !== a.gross
      || a.canceled !== 0 || a.fee === null || a.fee > a.gross
      || closureDateFromIso(e.createdAtUtc) !== input.scope.referenceDate) { excludedCount += 1; continue; }
    facts.push({ id: `pix:${row.rowId}`, source: "stone", workspaceId: input.scope.workspaceId,
      kioskId: input.scope.kioskId, businessDate: input.scope.referenceDate, soldAt: e.createdAtUtc,
      channel: "pix", grossAmountCents: a.gross, status: "approved",
      identifiers: { providerTransactionId: e.e2eId, terminalId: identity.terminalSerialNumber } });
  }
  return { status: "available", facts, excludedCount, fileId: input.fileId };
}
