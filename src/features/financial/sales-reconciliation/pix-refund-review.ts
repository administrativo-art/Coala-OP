import type { PixRefundCheck } from "@/lib/integrations/stone/pix-refunds";
import type { DailySalesScope } from "./daily-review";
import type { SalesMatchFact, SuggestedSalesReconciliationCase } from "./types";

type ReviewFacts = {
  scope: DailySalesScope;
  cases: SuggestedSalesReconciliationCase[];
  pdvFacts: SalesMatchFact[];
  stoneSales: SalesMatchFact[];
};

export type ReadPixRefundChecks = (input: {
  scope: DailySalesScope;
  through: string;
  e2eIds: readonly string[];
  saleSourceHash: string | null;
}) => Promise<ReadonlyMap<string, PixRefundCheck>>;

function refundCandidates(result: ReviewFacts) {
  const pdvById = new Map(result.pdvFacts.map(fact => [fact.id, fact]));
  const stoneById = new Map(result.stoneSales.map(fact => [fact.id, fact]));
  const candidates = new Map<string, string>();
  for (const row of result.cases) {
    if (row.channel !== "pix" || (row.kind !== "status_mismatch" && !row.pixRefundCheck)
      || row.pdvFactIds.length !== 1 || row.stoneSaleIds.length !== 1
      || row.differenceAmountCents !== 0 || row.pdvGrossAmountCents <= 0
      || !["provider_transaction_id", "provider_event_id"].includes(row.matchBasis)) continue;
    const pdv = pdvById.get(row.pdvFactIds[0]);
    const stone = stoneById.get(row.stoneSaleIds[0]);
    const e2eId = stone?.identifiers.providerTransactionId;
    if ((pdv?.status !== "cancelled" && pdv?.status !== "partial_cancellation")
      || stone?.status !== "approved" || !e2eId || !/^[A-Za-z0-9_-]{1,160}$/.test(e2eId)) continue;
    candidates.set(row.deterministicKey, e2eId);
  }
  return candidates;
}

export function hasPixRefundCandidates(input: ReviewFacts) {
  return refundCandidates(input).size > 0;
}

export async function checkSalesPixRefunds(result: ReviewFacts, read: ReadPixRefundChecks, input: {
  through: string;
  saleSourceHash: string | null;
}) {
  const candidates = refundCandidates(result);
  if (!candidates.size) return result.cases;
  const checks = await read({ ...input, scope: result.scope, e2eIds: [...new Set(candidates.values())] });
  return result.cases.map(row => {
    const e2eId = candidates.get(row.deterministicKey);
    if (!e2eId) return row;
    const observed = checks.get(e2eId) ?? { state: "incomplete" as const, events: [], complete: false, checkedThrough: input.through };
    // A gap cannot disprove previously recorded event evidence. Only current,
    // complete coverage can remove an event after a source correction.
    const previousEvents = row.pixRefundCheck?.events ?? [];
    const pixRefundCheck = observed.state === "incomplete" && previousEvents.length
      ? { ...observed, state: "events_found" as const,
        events: previousEvents.map(event => ({ ...event, state: "unverified" as const })) }
      : observed;
    const clear = pixRefundCheck.state === "clear" && pixRefundCheck.complete && pixRefundCheck.events.length === 0;
    return {
      ...row,
      pixRefundCheck,
      kind: clear ? "matched" as const : "status_mismatch" as const,
      reviewStatus: clear ? "auto_checked" as const : "attention_required" as const,
    };
  });
}
