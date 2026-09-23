import type {
  SalesMatchFact,
  SalesReconciliationMatchBasis,
  SuggestedSalesReconciliationCase,
} from "./types";

import { validateMatchInput } from "./validation";

const DEFAULT_TIME_WINDOW_MS = 5 * 60 * 1_000;

function timestampMillis(raw: string) {
  const hasOffset = /[Zz]$|[+-]\d{2}:?\d{2}$/.test(raw);
  const instant = new Date(hasOffset ? raw : `${raw.replace(" ", "T")}-03:00`);
  return Number.isNaN(instant.getTime()) ? null : instant.getTime();
}

function normalizedId(value: string | null | undefined) {
  return value?.trim() || null;
}

function scopedKey(fact: SalesMatchFact, value: string | null) {
  return value
    ? JSON.stringify([fact.workspaceId, fact.businessDate, fact.channel, value])
    : null;
}

function providerKey(fact: SalesMatchFact) {
  return scopedKey(fact, normalizedId(fact.identifiers.providerTransactionId));
}

function authorizationKey(fact: SalesMatchFact) {
  const nsu = normalizedId(fact.identifiers.nsu);
  const authorization = normalizedId(fact.identifiers.authorizationCode);
  const terminal = normalizedId(fact.identifiers.terminalId);
  return nsu && authorization && terminal
    ? scopedKey(fact, JSON.stringify([nsu, authorization, terminal]))
    : null;
}

function merchantOrderKey(fact: SalesMatchFact) {
  return scopedKey(
    fact,
    normalizedId(fact.identifiers.merchantOrderId),
  );
}

function total(facts: SalesMatchFact[]) {
  return facts.reduce((sum, fact) => sum + fact.grossAmountCents, 0);
}

function sameStatuses(pdv: SalesMatchFact[], stone: SalesMatchFact[]) {
  return [...new Set(pdv.map((fact) => fact.status))].sort().join(",")
    === [...new Set(stone.map((fact) => fact.status))].sort().join(",");
}

function deterministicKey(pdv: SalesMatchFact[], stone: SalesMatchFact[]) {
  return JSON.stringify([pdv.map((fact) => fact.id).sort(), stone.map((fact) => fact.id).sort()]);
}

function buildCase(
  pdv: SalesMatchFact[],
  stone: SalesMatchFact[],
  basis: SalesReconciliationMatchBasis,
  confidence: SuggestedSalesReconciliationCase["confidence"],
  forceAmbiguous = false,
): SuggestedSalesReconciliationCase {
  const all = [...pdv, ...stone];
  const workspaceId = all[0]?.workspaceId ?? "";
  const businessDate = all.map((fact) => fact.businessDate).sort()[0] ?? "";
  const kioskIds = [...new Set(all.map((fact) => fact.kioskId).filter((value): value is string => Boolean(value)))];
  const pdvGrossAmountCents = total(pdv);
  const stoneGrossAmountCents = total(stone);
  const hasUnmappedUnit = all.some((fact) => !fact.kioskId);
  let kind: SuggestedSalesReconciliationCase["kind"];
  if (forceAmbiguous) kind = "ambiguous";
  else if (hasUnmappedUnit) kind = "unit_unmapped";
  else if (pdv.length === 0) kind = "stone_only";
  else if (stone.length === 0) kind = "pdv_only";
  else if (kioskIds.length !== 1) kind = "unit_mismatch";
  else if (pdvGrossAmountCents !== stoneGrossAmountCents) kind = "amount_mismatch";
  else if (all.some(fact => fact.status === "pending")) kind = "ambiguous";
  else if (!sameStatuses(pdv, stone)) kind = "status_mismatch";
  else kind = "matched";

  return {
    deterministicKey: deterministicKey(pdv, stone),
    workspaceId,
    kioskId: kioskIds.length === 1 ? kioskIds[0] : null,
    kioskIds: kioskIds.sort(),
    period: businessDate.slice(0, 7),
    businessDate,
    channel: all[0]?.channel ?? "pix",
    pdvFactIds: pdv.map((fact) => fact.id).sort(),
    stoneSaleIds: stone.map((fact) => fact.id).sort(),
    pdvGrossAmountCents,
    stoneGrossAmountCents,
    differenceAmountCents: stoneGrossAmountCents - pdvGrossAmountCents,
    kind,
    matchBasis: basis,
    confidence,
    reviewStatus: "pending_review",
  };
}

function identifiersConflict(left: SalesMatchFact, right: SalesMatchFact) {
  return (["providerTransactionId", "nsu", "authorizationCode", "terminalId", "merchantOrderId"] as const)
    .some(key => {
      const a = normalizedId(left.identifiers[key]);
      const b = normalizedId(right.identifiers[key]);
      return a !== null && b !== null && a !== b;
    });
}

function candidateEdge(left: SalesMatchFact, right: SalesMatchFact, windowMs: number) {
  if (identifiersConflict(left, right)) return false;
  if (left.workspaceId !== right.workspaceId) return false;
  if (!left.kioskId || left.kioskId !== right.kioskId) return false;
  if (left.businessDate !== right.businessDate || left.channel !== right.channel) return false;
  const leftTime = timestampMillis(left.soldAt);
  const rightTime = timestampMillis(right.soldAt);
  return leftTime !== null && rightTime !== null && Math.abs(leftTime - rightTime) <= windowMs;
}

export function suggestSalesReconciliationCases(input: {
  pdvFacts: SalesMatchFact[];
  stoneSales: SalesMatchFact[];
  timeWindowMs?: number;
}) {
  validateMatchInput(input);
  const timeWindowMs = input.timeWindowMs ?? DEFAULT_TIME_WINDOW_MS;
  const pdvById = new Map(input.pdvFacts.map((fact) => [fact.id, fact]));
  const stoneById = new Map(input.stoneSales.map((fact) => [fact.id, fact]));
  const unmatchedPdv = new Set(pdvById.keys());
  const unmatchedStone = new Set(stoneById.keys());
  const cases: SuggestedSalesReconciliationCase[] = [];

  function matchByKey(
    basis: SalesReconciliationMatchBasis,
    keyOf: (fact: SalesMatchFact) => string | null,
  ) {
    const pdvGroups = new Map<string, SalesMatchFact[]>();
    const stoneGroups = new Map<string, SalesMatchFact[]>();
    for (const id of unmatchedPdv) {
      const fact = pdvById.get(id)!;
      const key = keyOf(fact);
      if (key) pdvGroups.set(key, [...(pdvGroups.get(key) ?? []), fact]);
    }
    for (const id of unmatchedStone) {
      const fact = stoneById.get(id)!;
      const key = keyOf(fact);
      if (key) stoneGroups.set(key, [...(stoneGroups.get(key) ?? []), fact]);
    }
    for (const key of [...pdvGroups.keys()].sort()) {
      const pdv = pdvGroups.get(key) ?? [];
      const stone = stoneGroups.get(key) ?? [];
      if (pdv.length === 0 || stone.length === 0) continue;
      const ambiguous = pdv.length !== 1 || stone.length !== 1 || identifiersConflict(pdv[0], stone[0]);
      cases.push(buildCase(pdv, stone, basis, ambiguous ? "none" : "high", ambiguous));
      pdv.forEach((fact) => unmatchedPdv.delete(fact.id));
      stone.forEach((fact) => unmatchedStone.delete(fact.id));
    }
  }

  matchByKey("provider_transaction_id", providerKey);
  matchByKey("nsu_authorization_terminal", authorizationKey);
  matchByKey("merchant_order", merchantOrderKey);

  let matchedUnique = true;
  while (matchedUnique) {
    matchedUnique = false;
    const pdvCandidates = new Map<string, string[]>();
    const stoneCandidates = new Map<string, string[]>();
    for (const pdvId of unmatchedPdv) {
      const pdv = pdvById.get(pdvId)!;
      for (const stoneId of unmatchedStone) {
        const stone = stoneById.get(stoneId)!;
        if (pdv.grossAmountCents !== stone.grossAmountCents || !candidateEdge(pdv, stone, timeWindowMs)) continue;
        pdvCandidates.set(pdvId, [...(pdvCandidates.get(pdvId) ?? []), stoneId]);
        stoneCandidates.set(stoneId, [...(stoneCandidates.get(stoneId) ?? []), pdvId]);
      }
    }
    for (const pdvId of [...unmatchedPdv].sort()) {
      const candidateIds = pdvCandidates.get(pdvId) ?? [];
      if (candidateIds.length !== 1) continue;
      const stoneId = candidateIds[0];
      if ((stoneCandidates.get(stoneId) ?? []).length !== 1) continue;
      cases.push(buildCase([pdvById.get(pdvId)!], [stoneById.get(stoneId)!], "unique_amount_time", "medium"));
      unmatchedPdv.delete(pdvId);
      unmatchedStone.delete(stoneId);
      matchedUnique = true;
    }
  }

  const visitedPdv = new Set<string>();
  const visitedStone = new Set<string>();
  for (const startPdvId of [...unmatchedPdv].sort()) {
    if (visitedPdv.has(startPdvId)) continue;
    const componentPdv = new Set<string>();
    const componentStone = new Set<string>();
    const queue: Array<{ source: "pdv" | "stone"; id: string }> = [{ source: "pdv", id: startPdvId }];
    const queuedPdv = new Set([startPdvId]);
    const queuedStone = new Set<string>();
    for (let cursor = 0; cursor < queue.length; cursor++) {
      const current = queue[cursor];
      if (current.source === "pdv") {
        if (componentPdv.has(current.id)) continue;
        componentPdv.add(current.id);
        const pdv = pdvById.get(current.id)!;
        for (const stoneId of unmatchedStone) {
          if (!queuedStone.has(stoneId) && candidateEdge(pdv, stoneById.get(stoneId)!, timeWindowMs)) {
            queuedStone.add(stoneId);
            queue.push({ source: "stone", id: stoneId });
          }
        }
      } else {
        if (componentStone.has(current.id)) continue;
        componentStone.add(current.id);
        const stone = stoneById.get(current.id)!;
        for (const pdvId of unmatchedPdv) {
          if (!queuedPdv.has(pdvId) && candidateEdge(pdvById.get(pdvId)!, stone, timeWindowMs)) {
            queuedPdv.add(pdvId);
            queue.push({ source: "pdv", id: pdvId });
          }
        }
      }
    }
    if (componentStone.size === 0) continue;
    componentPdv.forEach((id) => visitedPdv.add(id));
    componentStone.forEach((id) => visitedStone.add(id));
    const pdv = [...componentPdv].map((id) => pdvById.get(id)!);
    const stone = [...componentStone].map((id) => stoneById.get(id)!);
    const unambiguousGroup = (pdv.length === 1 || stone.length === 1) && total(pdv) === total(stone);
    cases.push(buildCase(pdv, stone, "candidate_group", unambiguousGroup ? "medium" : "none", !unambiguousGroup && (pdv.length > 1 || stone.length > 1)));
    componentPdv.forEach((id) => unmatchedPdv.delete(id));
    componentStone.forEach((id) => unmatchedStone.delete(id));
  }

  for (const pdvId of [...unmatchedPdv].sort()) {
    cases.push(buildCase([pdvById.get(pdvId)!], [], "unmatched", "none"));
  }
  for (const stoneId of [...unmatchedStone].sort()) {
    cases.push(buildCase([], [stoneById.get(stoneId)!], "unmatched", "none"));
  }

  return cases.sort((left, right) => (
    left.businessDate.localeCompare(right.businessDate)
    || (left.kioskId ?? "").localeCompare(right.kioskId ?? "")
    || left.channel.localeCompare(right.channel)
    || left.deterministicKey.localeCompare(right.deterministicKey)
  ));
}
