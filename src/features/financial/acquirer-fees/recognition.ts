import { AppError } from "@/lib/observability/app-error";
import { feeHash, feeTotalCents, feeUnits, MAX_FEE_MEMBERS } from "./evidence";
import type { FeeKind } from "./contracts";
import type { FeeRecognitionBatch, FeeRecognitionComponent, FeeRecognitionPolicy, FeeRecognitionRecord, FeeRateContract } from "./recognition-contracts";
const fail = (code: string, message: string): never => { throw new AppError({ code: `FEE_RECOGNITION_${code}`, kind: "CONFLICT", safeMessage: message }); };
export const feeComponentIdentity = (workspace: string, stoneCode: string, transactionId: string, installment: number, kind: FeeKind) => feeHash(["acquirer_fee", workspace, stoneCode, transactionId, installment, kind]);
export function assertFeePeriodOpen(policy: FeeRecognitionPolicy, period: string) {
  if (!policy.enabled) fail("POLICY_DISABLED", "Apuração de taxas não habilitada neste vínculo.");
  if (policy.closedPeriods.includes(period) || policy.closedThroughMonth && period <= policy.closedThroughMonth) fail("CLOSED_PERIOD", "Competência bloqueada. Reabra a apuração autorizada antes de revisar taxas.");
}
export function contractFeeCents(grossDecimal: string, contract: FeeRateContract) {
  const numerator = feeUnits(grossDecimal) * BigInt(contract.rateBasisPoints); const divisor = BigInt(10000) * BigInt(10000000000);
  const cents = (numerator + (contract.rounding === "round" ? divisor / BigInt(2) : BigInt(0))) / divisor + BigInt(contract.fixedCents);
  if (cents > BigInt(Number.MAX_SAFE_INTEGER)) fail("AMOUNT", "Taxa fora do limite."); return Number(cents);
}
export function selectRateContract(policy: FeeRecognitionPolicy, sale: { date: string; source: "cards" | "pix"; brandCode: string | null; accountTypeCode: string | null; installmentCount: number }) {
  const found = policy.contracts.filter(c => c.source === sale.source && c.validFrom <= sale.date && (!c.validThrough || c.validThrough >= sale.date)
    && (c.brandCode === null || c.brandCode === sale.brandCode) && (c.accountTypeCode === null || c.accountTypeCode === sale.accountTypeCode)
    && c.minInstallments <= sale.installmentCount && c.maxInstallments >= sale.installmentCount);
  if (found.length > 1) fail("AMBIGUOUS_CONTRACT", "Mais de um contrato vigente. Revise a configuração, sem escolher uma taxa automaticamente.");
  return found[0] ?? null;
}
export function buildRecognitionBatches(workspace: string, unit: string, merchant: string, components: FeeRecognitionComponent[]) {
  if (components.length > 500 || new Set(components.map(c => c.id)).size !== components.length) fail("SOURCE_LIMIT", "Fonte duplicada ou acima de 500 componentes. Nenhuma taxa foi lançada.");
  const groups = new Map<string, FeeRecognitionComponent[]>();
  for (const row of components) { const key = JSON.stringify([row.kind, row.soldOn, row.dueOn]); groups.set(key, [...(groups.get(key) ?? []), row]); }
  const batches: FeeRecognitionBatch[] = [];
  for (const rows of groups.values()) {
    rows.sort((a, b) => a.id.localeCompare(b.id));
    for (let offset = 0; offset < rows.length; offset += MAX_FEE_MEMBERS) { const members = rows.slice(offset, offset + MAX_FEE_MEMBERS);
      const id = feeHash([workspace, unit, merchant, members.map(m => m.id)]);
      batches.push({ id, fingerprint: feeHash(members), kind: members[0].kind, soldOn: members[0].soldOn, dueOn: members[0].dueOn,
        amountCents: feeTotalCents(members.map(m => m.feeDecimal)), grossCents: feeTotalCents(members.map(m => m.grossDecimal)), expectedNetCents: feeTotalCents(members.map(m => m.expectedNetDecimal)),
        measurement: members.some(m => m.measurement === "estimated") ? "estimated" : "assessed", members });
    }
  }
  return batches.sort((a, b) => a.soldOn.localeCompare(b.soldOn) || a.id.localeCompare(b.id));
}
export function recognitionTransition(input: { previous: FeeRecognitionRecord | null; batch: FeeRecognitionBatch; expectedRevision: number; action: "recognize_sale" | "revise_sale"; reason?: string; policy: FeeRecognitionPolicy }) {
  assertFeePeriodOpen(input.policy, input.batch.soldOn.slice(0, 7)); const previous = input.previous;
  if (previous?.active && previous.batch.fingerprint === input.batch.fingerprint && previous.policyVersion === input.policy.version) return { idempotent: true, revision: previous.revision, deltaCents: 0 };
  if ((previous?.revision ?? 0) !== input.expectedRevision) fail("REVISION", "A apuração mudou. Atualize a prévia antes de confirmar.");
  if (previous && (input.action !== "revise_sale" || !input.reason)) fail("REVIEW_REQUIRED", "A origem mudou. Revise com motivo, sem criar outra despesa.");
  if (previous && previous.batch.members.map(m => m.id).sort().join() !== input.batch.members.map(m => m.id).sort().join()) fail("MEMBERS_CHANGED", "Componentes mudaram. Reverter a origem anterior requer revisão explícita.");
  return { idempotent: false, revision: (previous?.revision ?? 0) + 1, deltaCents: input.batch.amountCents - (previous?.active ? previous.batch.amountCents : 0) };
}
export function recognitionExpenseFields(batch: FeeRecognitionBatch, receivedIds: string[]) {
  const received = batch.members.filter(m => receivedIds.includes(m.id) && !!m.settledOn && m.paidNetDecimal !== null); const fullyReceived = received.length === batch.members.length;
  const state = fullyReceived ? "received" : received.length ? "partially_received" : batch.measurement;
  return { state, status: fullyReceived ? "paid" : "provisioned", paymentState: fullyReceived ? "paid" : "open",
    estimated: batch.measurement === "estimated", expectedNetCents: batch.expectedNetCents, expectedDate: batch.dueOn,
    paidOn: fullyReceived ? [...received].map(m => m.settledOn).filter((d): d is string => !!d).sort().at(-1) ?? null : null } as const;
}
