import type {
  PersistedSalesReconciliationCase,
  SalesReconciliationDecision,
  SalesReconciliationReviewStatus,
} from "./types";

type DecisionCase = Pick<
  PersistedSalesReconciliationCase,
  "kind" | "kioskId" | "kioskIds" | "pdvGrossAmountCents" | "stoneGrossAmountCents"
>;

export function reviewStatusForDecision(
  decision: Pick<SalesReconciliationDecision, "action">,
): SalesReconciliationReviewStatus {
  return decision.action === "ignore" ? "ignored" : "resolved";
}

function chosenAmount(entry: DecisionCase) {
  return entry.pdvGrossAmountCents > 0
    ? entry.pdvGrossAmountCents
    : entry.stoneGrossAmountCents;
}

function chosenKiosk(entry: DecisionCase, decision?: SalesReconciliationDecision | null) {
  return decision?.targetKioskId ?? entry.kioskId ?? (entry.kioskIds.length === 1 ? entry.kioskIds[0] : null);
}

export function revenueContributionByKiosk(input: {
  entry: DecisionCase;
  reviewStatus: SalesReconciliationReviewStatus;
  decision?: SalesReconciliationDecision | null;
}) {
  const result = new Map<string, number>();
  const { entry, reviewStatus, decision } = input;
  if (reviewStatus === "pending_review" || reviewStatus === "ignored") return result;

  if (reviewStatus === "matched_auto") {
    const kioskId = chosenKiosk(entry);
    if (entry.kind === "matched" && kioskId) result.set(kioskId, entry.pdvGrossAmountCents);
    return result;
  }

  if (
    decision?.classification === "invalid_pdv_payment"
    || decision?.classification === "cancelled_or_refunded"
  ) {
    return result;
  }

  const kioskId = chosenKiosk(entry, decision);
  if (!kioskId) return result;
  const amount = decision?.classification === "stone_only_sale"
    ? entry.stoneGrossAmountCents
    : chosenAmount(entry);
  result.set(kioskId, amount);
  return result;
}

export function revenueContributionDelta(input: {
  entry: DecisionCase;
  previousReviewStatus: SalesReconciliationReviewStatus;
  previousDecision?: SalesReconciliationDecision | null;
  nextReviewStatus: SalesReconciliationReviewStatus;
  nextDecision: SalesReconciliationDecision;
}) {
  const previous = revenueContributionByKiosk({
    entry: input.entry,
    reviewStatus: input.previousReviewStatus,
    decision: input.previousDecision,
  });
  const next = revenueContributionByKiosk({
    entry: input.entry,
    reviewStatus: input.nextReviewStatus,
    decision: input.nextDecision,
  });
  return new Map([...new Set([...previous.keys(), ...next.keys()])].map((kioskId) => [
    kioskId,
    (next.get(kioskId) ?? 0) - (previous.get(kioskId) ?? 0),
  ]));
}
