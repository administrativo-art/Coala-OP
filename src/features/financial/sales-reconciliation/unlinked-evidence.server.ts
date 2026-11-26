import "server-only";
import { createHash } from "node:crypto";
import type { DailySalesResult } from "./query";

export function unlinkedCaseCandidate(result: Pick<DailySalesResult, "scope" | "cases" | "pix" | "stoneSales" | "pdvFacts">, caseKey: string) {
  const rows = result.cases.filter(row => row.deterministicKey === caseKey);
  const row = rows[0];
  if (rows.length !== 1 || row.kind !== "stone_only" || row.channel !== "pix" || row.matchBasis !== "unmatched"
    || row.pdvFactIds.length !== 0 || row.pdvGrossAmountCents !== 0 || row.stoneSaleIds.length !== 1
    || row.stoneGrossAmountCents <= 0 || row.differenceAmountCents !== row.stoneGrossAmountCents
    || result.pix.status !== "available" || result.pix.coverage !== "complete" || !result.pix.fileId) return null;

  const facts = result.stoneSales.filter(fact => fact.id === row.stoneSaleIds[0]);
  const fact = facts[0];
  if (facts.length !== 1 || fact.source !== "stone" || fact.channel !== "pix" || fact.status !== "approved"
    || fact.workspaceId !== result.scope.workspaceId || fact.kioskId !== result.scope.kioskId
    || fact.businessDate !== result.scope.referenceDate || fact.grossAmountCents !== row.stoneGrossAmountCents) return null;
  const { providerTransactionId: e2eId, providerEventId } = fact.identifiers;
  if (!e2eId || !providerEventId || !/^[A-Za-z0-9_-]{1,160}$/.test(e2eId)
    || result.stoneSales.filter(other => other.identifiers.providerTransactionId === e2eId).length !== 1
    || result.pdvFacts.some(other => Object.values(other.identifiers).some(id => id === e2eId || id === providerEventId))) return null;
  const evidenceKey = createHash("sha256").update(JSON.stringify([
    result.scope.workspaceId, result.scope.kioskId, result.scope.stoneCode, result.scope.referenceDate,
    result.pix.fileId, caseKey, fact.id, fact.soldAt, fact.grossAmountCents, e2eId, providerEventId,
    fact.identifiers.terminalId ?? null,
  ])).digest("hex");
  return { e2eId, evidenceKey };
}
