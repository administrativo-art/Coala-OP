import { feeHash } from "../acquirer-fees/evidence";
export type RateScope = { workspaceId: string; mappingId: string; kioskId: string; stoneCode: string };
export type ConfirmedRateReference = { decisionId: string; revision: number; groupKey: string; rate: number; since: string; actorId: string; actorNamespace: "main.users"; decidedAt: string; fingerprint: string };
export type RateDecisionRecord = Record<string, unknown> & { id: string };
const civil = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T12:00:00Z`)) && new Date(`${value}T12:00:00Z`).toISOString().slice(0,10) === value;
/** Legacy without scope is eligible only with an independently proven unique historical mapping. */
export function confirmedRateReferences(records: RateDecisionRecord[], scope: RateScope, legacyScopeProven: (record: RateDecisionRecord) => boolean = () => false) {
  const found = new Map<string, ConfirmedRateReference>(); let unresolved = 0;
  for (const r of records) {
    if (r.workspaceId !== scope.workspaceId || r.stoneCode !== scope.stoneCode || !["confirmed", "new_rate"].includes(String(r.decision)) || r.kind === "sale_fee") continue;
    if ((r.mappingId != null && r.mappingId !== scope.mappingId) || (r.kioskId != null && r.kioskId !== scope.kioskId)) continue;
    if ((!r.mappingId || !r.kioskId) && !legacyScopeProven(r)) { unresolved++; continue; }
    if (typeof r.groupKey !== "string" || typeof r.rate !== "number" || !Number.isFinite(r.rate) || r.rate < 0 || r.rate > 1 || !civil(r.since) || typeof r.actorId !== "string" || !r.actorId || r.actorNamespace !== "main.users" || typeof r.decidedAt !== "string" || !Number.isFinite(Date.parse(r.decidedAt)) || !Number.isInteger(r.revision) || Number(r.revision) < 1) { unresolved++; continue; }
    const value = { decisionId: String(r.decisionId ?? r.id), revision: Number(r.revision), groupKey: r.groupKey, rate: r.rate, since: r.since, actorId: r.actorId, actorNamespace: "main.users" as const, decidedAt: r.decidedAt, fingerprint: feeHash(r) };
    found.set(`${value.decisionId}:${value.revision}`, value);
  }
  return { references: [...found.values()].sort((a,b)=>a.since.localeCompare(b.since)||a.decidedAt.localeCompare(b.decidedAt)||a.decisionId.localeCompare(b.decisionId)), unresolved };
}
export function referenceOnDate(references: ConfirmedRateReference[], groupKey: string, date: string) {
  const candidates = references.filter(r=>r.groupKey===groupKey && r.since<=date).sort((a,b)=>b.since.localeCompare(a.since)||b.decidedAt.localeCompare(a.decidedAt)||b.revision-a.revision);
  if (!candidates.length) return null;
  // Equal effective and approval instants with distinct rates are ambiguous; do not pick by document order.
  if (candidates.some(r=>r.since===candidates[0].since && r.decidedAt===candidates[0].decidedAt && r.rate!==candidates[0].rate)) return null;
  return candidates[0];
}

/** Persist only provenance pointer/version; the author remains in the already registered decision/event source. */
export function rateReferenceEvidence(reference: ConfirmedRateReference) {
  const {decisionId,revision,groupKey,rate,since,decidedAt,fingerprint}=reference;
  return {decisionId,revision,groupKey,rate,since,decidedAt,fingerprint};
}
