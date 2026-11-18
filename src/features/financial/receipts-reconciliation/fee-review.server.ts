import { readReceivablePeriodMapping } from "../receivables/mapping.server";
import { assertRateScopeAt, readConfirmedRateReferences } from "./confirmed-rate-reference.server";
import { referenceOnDate } from "./confirmed-rate-reference";
import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { financialDbAdmin } from "@/lib/firebase-financial-admin";
import { AppError } from "@/lib/observability/app-error";
import { latestPublishedDate } from "../receivables/period-review";
import { stoneReceiptFingerprint, readStoneReceiptSnapshot } from "./stone-account-snapshot.server";
import {
  applyDecisions, detectRateChanges, feeExceptions, feeGroups, feeHistory, feeSales, otherCharges,
  type FeeDecision, type FeeDecisionInput,
} from "./fee-review";

/**
 * Taxas: monta a visão a partir das conferências mensais salvas (até 6 meses) e grava as decisões
 * do operador em `stoneReceiptDecisions` (uma por item) e o histórico em `stoneReceiptDecisionEvents`. O dado da Stone nunca é alterado.
 */
const HISTORY_MONTHS = 6;
const MAX_DECISIONS = 2_000;
type Scope = { workspaceId: string; mappingId: string; kioskId: string; stoneCode: string };

const decisionSchema = z.object({
  workspaceId: z.string(), stoneCode: z.string(), mappingId: z.string(),
  kind: z.enum(["sale_fee", "rate_change", "group_rate", "other_charge"]), itemKey: z.string(),
  decision: z.enum(["accepted", "contested", "new_rate", "confirmed"]), fingerprint: z.string(),
  groupKey: z.string().nullable(), rate: z.number().nullable(), since: z.string().nullable(),
  actorId: z.string(), actorNamespace: z.literal("main.users"), decidedAt: z.string(), note: z.string().nullable(), revision: z.number().int().positive(),
}).passthrough();

const monthsBack = (month: string, count: number) => {
  const [year, value] = month.split("-").map(Number);
  return [...Array(count)].map((_, index) => {
    const date = new Date(Date.UTC(year, value - 1 - (count - 1 - index), 1));
    return date.toISOString().slice(0, 7);
  });
};

async function readDecisions(scope: Scope): Promise<FeeDecision[]> {
  const snapshot = await financialDbAdmin.collection("stoneReceiptDecisions")
    .where("workspaceId", "==", scope.workspaceId).where("stoneCode", "==", scope.stoneCode)
    .limit(MAX_DECISIONS + 1).get();
  if (snapshot.size > MAX_DECISIONS) throw new AppError({ code: "STONE_FEE_DECISION_LIMIT", kind: "EXPECTED_BUSINESS", safeMessage: "Há decisões demais para este StoneCode." });
  return snapshot.docs.flatMap(document => {
    const parsed = decisionSchema.safeParse(document.data());
    return parsed.success && parsed.data.mappingId===scope.mappingId && document.get("kioskId")===scope.kioskId ? [{ kind: parsed.data.kind, itemKey: parsed.data.itemKey, decision: parsed.data.decision, fingerprint: parsed.data.fingerprint,
      groupKey: parsed.data.groupKey, rate: parsed.data.rate, since: parsed.data.since, actorId: parsed.data.actorId, decidedAt: parsed.data.decidedAt, note: parsed.data.note }] : [];
  });
}

export async function buildFeeReview(scope: Scope, month: string, now = new Date()) {
  const latest = latestPublishedDate(now);
  const months = monthsBack(month, HISTORY_MONTHS);
  const saved = await Promise.all(months.map(value => readStoneReceiptSnapshot({ ...scope, month: value })));
  const ready = saved.flatMap((entry, index) => entry.status === "ready" ? [{ month: months[index], result: entry.result }] : []);
  const current = ready.find(entry => entry.month === month) ?? null;
  const decisions = await readDecisions(scope);
  const allSales = feeSales(ready.flatMap(entry => entry.result.parcels));
  const referenceSource = await readConfirmedRateReferences(scope);
  const referenceAt = month < latest.slice(0,7) ? `${month}-${new Date(Number(month.slice(0,4)),Number(month.slice(5,7)),0).getDate()}` : latest;
  const references = new Map([...new Set(referenceSource.references.map(r=>r.groupKey))].flatMap(key=>{const ref=referenceOnDate(referenceSource.references,key,referenceAt);return ref?[[key,{rate:ref.rate,since:ref.since,status:"confirmed" as const}] as const]:[];}));
  const anchor = month < latest.slice(0, 7) ? ready.find(entry => entry.month === month)?.result.period.through ?? latest : latest;
  const groups = feeGroups(allSales, references, anchor);
  const rawChanges = detectRateChanges(allSales, groups);
  const effectiveDecisions=decisions.filter(decision=>decision.kind!=="rate_change" || decision.decision!=="new_rate" || !decision.since || !rawChanges.some(change=>change.key===decision.itemKey && decision.since!>change.since));
  const changes = applyDecisions(rawChanges, "rate_change", effectiveDecisions);
  const exceptions = applyDecisions(feeExceptions(allSales, groups, rawChanges, month, (groupKey,date)=>{const r=referenceOnDate(referenceSource.references,groupKey,date);return r?{rate:r.rate,since:r.since,status:"confirmed"}:null;}), "sale_fee", decisions);
  const charges = applyDecisions(current ? otherCharges(current.result.parcels, month) : [], "other_charge", decisions);
  const monthParcels = current?.result.parcels.filter(parcel => parcel.saleDate?.startsWith(month)) ?? [];
  const totals = {
    cardFeeCents: monthParcels.filter(p => p.source === "card").reduce((sum, p) => sum + (p.feeCents ?? 0), 0),
    pixFeeCents: monthParcels.filter(p => p.source === "pix").reduce((sum, p) => sum + (p.feeCents ?? 0), 0),
    anticipationCents: (current?.result.parcels ?? []).filter(p => p.paidDate?.startsWith(month)).reduce((sum, p) => sum + Math.max(0, p.anticipationCents ?? 0), 0),
    grossCents: monthParcels.reduce((sum, p) => sum + p.grossCents, 0),
  };
  return {
    referenceSource,
    snapshotVersions: saved.map((entry,index)=>({month:months[index],fingerprint:entry.status==="ready"?stoneReceiptFingerprint(entry.result):null})),
    month, ready: Boolean(current), savedAt: current?.result.collectedAt ?? null,
    groups, changes, exceptions, charges,
    history: feeHistory(ready.map(entry => ({ month: entry.month, sales: allSales }))),
    historyMonths: ready.map(entry => entry.month),
    totals,
    overchargeCents: exceptions.filter(item => item.differenceCents > 0).reduce((sum, item) => sum + item.differenceCents, 0)
      + changes.filter(item => item.impactCents > 0).reduce((sum, item) => sum + item.impactCents, 0),
    pendingCount: exceptions.length + changes.length + charges.length,
    recentDecisions: decisions.sort((a, b) => b.decidedAt.localeCompare(a.decidedAt)).slice(0, 20)
      .map(item => ({ kind: item.kind, itemKey: item.itemKey, decision: item.decision, decidedAt: item.decidedAt, note: item.note })),
    parameters: { windowDays: 60, minSales: 5, toleranceCentsPerParcel: 1, changeMinSales: 5, changeMinDays: 3 },
  };
}
export type FeeReviewView = Awaited<ReturnType<typeof buildFeeReview>>;

const decisionId = (scope: Scope, kind: string, itemKey: string) =>
  createHash("sha256").update(`${scope.workspaceId}:${scope.stoneCode}:${kind}:${itemKey}`).digest("hex");

/**
 * Grava a decisão só se o item ainda existir com a mesma evidência (o cliente não define taxa,
 * grupo nem data). Decisão e evento ficam na mesma transação; reabertura não apaga o histórico.
 */
export async function saveFeeDecision(scope: Scope, input: FeeDecisionInput, actorId: string, now = new Date()) {
  if (["confirmed","new_rate"].includes(input.decision)) {
    const mapping = await readReceivablePeriodMapping({kioskId:scope.kioskId,stoneCode:scope.stoneCode,from:input.effectiveFrom!,through:input.effectiveFrom!},scope.workspaceId);
    if (mapping.id!==scope.mappingId) throw new AppError({code:"STONE_FEE_EFFECTIVE_SCOPE",kind:"CONFLICT",safeMessage:"A data de início pertence a outro vínculo. Nenhuma taxa confirmada."});
  }
  const view = await buildFeeReview(scope, input.month, now);
  const items: Array<{ key: string; fingerprint: string; groupKey: string | null; rate: number | null; since: string | null }> =
    input.kind === "sale_fee" ? view.exceptions.map(item => ({ key: item.key, fingerprint: item.fingerprint, groupKey: item.groupKey, rate: input.decision === "new_rate" ? item.chargedCents / item.grossCents : null, since: input.decision === "new_rate" ? item.date : null }))
      : input.kind === "rate_change" ? view.changes.map(item => ({ key: item.key, fingerprint: item.fingerprint, groupKey: item.groupKey, rate: input.decision === "new_rate" ? item.to : null, since: input.decision === "new_rate" ? item.since : null }))
        : input.kind === "other_charge" ? view.charges.map(item => ({ key: item.key, fingerprint: item.fingerprint, groupKey: null, rate: null, since: null }))
          : view.groups.filter(group => group.reference?.status === "suggested").map(group => ({ key: group.key, fingerprint: `group:${group.reference!.rate}`, groupKey: group.key, rate: group.reference!.rate, since: group.reference!.since }));
  const item = items.find(entry => entry.key === input.itemKey);
  if (!item || item.fingerprint !== input.fingerprint) {
    throw new AppError({ code: "STONE_FEE_ITEM_CHANGED", kind: "CONFLICT", safeMessage: "O item mudou ou já foi tratado. Recarregue a tela." });
  }
  const ref = financialDbAdmin.collection("stoneReceiptDecisions").doc(["confirmed", "new_rate"].includes(input.decision) ? randomUUID() : decisionId(scope, input.kind, input.itemKey));
  const at = now.toISOString();
  return financialDbAdmin.runTransaction(async transaction => {
    if (["confirmed","new_rate"].includes(input.decision)) await assertRateScopeAt(scope,input.effectiveFrom!,transaction);
    const latestReferences=await readConfirmedRateReferences(scope,transaction);
    if (createHash("sha256").update(JSON.stringify(latestReferences)).digest("hex")!==createHash("sha256").update(JSON.stringify(view.referenceSource)).digest("hex")) throw new AppError({code:"STONE_FEE_REFERENCE_CHANGED",kind:"CONFLICT",safeMessage:"Referência mudou. Recarregue antes de confirmar a vigência."});
    const snapshotHeads=await Promise.all(view.snapshotVersions.map(source=>transaction.get(financialDbAdmin.collection("stoneReceiptMonthSnapshots").doc(createHash("sha256").update(`${scope.workspaceId}:${scope.stoneCode}:${source.month}`).digest("hex")))));
    snapshotHeads.forEach((head,index)=>{const fingerprint=head.get("workspaceId")===scope.workspaceId && head.get("mappingId")===scope.mappingId && head.get("kioskId")===scope.kioskId ? head.get("fingerprint")??null : null;if(fingerprint!==view.snapshotVersions[index].fingerprint) throw new AppError({code:"STONE_FEE_SOURCE_CHANGED",kind:"CONFLICT",safeMessage:"Conferência das vendas mudou. Recarregue antes de confirmar."});});
    const current = await transaction.get(ref);
    const revision = (current.exists ? Number(current.get("revision")) || 0 : 0) + 1;
    const record = {
      workspaceId: scope.workspaceId, stoneCode: scope.stoneCode, mappingId: scope.mappingId, kioskId: scope.kioskId,
      kind: input.kind, itemKey: input.itemKey, decision: input.decision, fingerprint: input.fingerprint,
      groupKey: item.groupKey, rate: item.rate, since: ["confirmed", "new_rate"].includes(input.decision) ? input.effectiveFrom! : item.since,
      actorId, actorNamespace: "main.users" as const, decidedAt: at, note: input.note ?? null, revision, month: input.month,
    };
    transaction.set(ref, record);
    // Histórico em coleção de topo (não subcoleção): consulta por ator direta, sem collection group.
    transaction.create(financialDbAdmin.collection("stoneReceiptDecisionEvents").doc(randomUUID()), { ...record, decisionId: ref.id, previousRevision: revision - 1 });
    return { saved: true as const, revision };
  });
}
