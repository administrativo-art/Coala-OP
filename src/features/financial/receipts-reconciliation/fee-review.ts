import { z } from "zod";
import { receiptGroupKey, receiptModalityLabel, usualRate, type ReceiptParcel } from "./stone-account";

/**
 * Conferência de taxas (aba Taxas, layout E1). Referência = "taxa atual" de cada grupo pela
 * recorrência, confirmada pelo operador; não é o contrato. Parâmetros aprovados em 2026-11-14.
 */
export const FEE_WINDOW_DAYS = 60;
export const FEE_MIN_SALES = 5;
/** Tolerância por parcela: arredondamento do MDR. */
export const FEE_TOLERANCE_CENTS = 1;
export const CHANGE_MIN_SALES = 5;
export const CHANGE_MIN_DAYS = 3;

export type FeeDecisionKind = "sale_fee" | "rate_change" | "group_rate" | "other_charge";
export type FeeDecisionValue = "accepted" | "contested" | "new_rate" | "confirmed";
export type FeeDecision = {
  kind: FeeDecisionKind; itemKey: string; decision: FeeDecisionValue; fingerprint: string;
  groupKey: string | null; rate: number | null; since: string | null;
  actorId: string; decidedAt: string; note: string | null;
};

export const feeDecisionInputSchema = z.object({
  kioskId: z.string().trim().min(1).max(180),
  stoneCode: z.string().regex(/^\d{1,20}$/),
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
  kind: z.enum(["sale_fee", "rate_change", "group_rate", "other_charge"]),
  itemKey: z.string().min(1).max(200),
  decision: z.enum(["accepted", "contested", "new_rate", "confirmed"]),
  fingerprint: z.string().regex(/^[a-z0-9:._-]{1,300}$/i),
  note: z.string().trim().max(500).nullable().optional(),
}).strict().superRefine((value, context) => {
  const allowed: Record<string, string[]> = {
    sale_fee: ["accepted", "contested", "new_rate"], rate_change: ["new_rate", "contested"],
    group_rate: ["confirmed"], other_charge: ["accepted", "contested"],
  };
  if (!allowed[value.kind].includes(value.decision)) context.addIssue({ code: z.ZodIssueCode.custom, path: ["decision"], message: "Decisão incompatível com o item." });
});
export type FeeDecisionInput = z.infer<typeof feeDecisionInputSchema>;

const addDays = (date: string, days: number) => { const d = new Date(`${date}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); };
const round4 = (value: number) => Math.round(value * 10_000) / 10_000;
const groupLabel = (parcel: ReceiptParcel) => parcel.modality === "pix" ? "Pix"
  : `${parcel.brand ?? "Sem bandeira no arquivo"} · ${receiptModalityLabel(parcel.modality)}${parcel.modality === "installment" ? ` ${parcel.installmentCount}x` : ""}`;

type Sale = { saleId: string; groupKey: string; label: string; date: string; grossCents: number; feeCents: number; parcels: ReceiptParcel[]; derived: boolean };

/** Vendas (não parcelas) com taxa conhecida, agrupadas; a taxa da venda é Σ taxa ÷ Σ bruto. */
export function feeSales(parcels: ReceiptParcel[]): Sale[] {
  const map = new Map<string, Sale>();
  for (const parcel of parcels) {
    if (!parcel.saleDate || parcel.feeCents === null || parcel.grossCents <= 0) continue;
    const key = `${parcel.source}:${parcel.saleId}`;
    const sale = map.get(key) ?? { saleId: parcel.saleId, groupKey: receiptGroupKey(parcel), label: groupLabel(parcel), date: parcel.saleDate, grossCents: 0, feeCents: 0, parcels: [], derived: false };
    if (sale.parcels.some(item => item.id === parcel.id)) continue;
    sale.grossCents += parcel.grossCents; sale.feeCents += parcel.feeCents; sale.parcels.push(parcel);
    sale.derived ||= parcel.feeSource === "derived";
    map.set(key, sale);
  }
  return [...map.values()].sort((a, b) => a.date.localeCompare(b.date) || a.saleId.localeCompare(b.saleId));
}

export type FeeReference = { rate: number; since: string; status: "confirmed" | "suggested" };
export type FeeGroup = { key: string; label: string; saleCount: number; suggestedRate: number | null; reference: FeeReference | null };

/** Referência vigente por grupo: a última decisão "confirmed"/"new_rate" do grupo. */
export function confirmedReferences(decisions: FeeDecision[]) {
  const map = new Map<string, FeeReference>();
  const ordered = decisions.filter(item => item.groupKey && item.rate !== null && (item.decision === "confirmed" || item.decision === "new_rate") && item.kind !== "sale_fee")
    .sort((a, b) => a.decidedAt.localeCompare(b.decidedAt));
  for (const item of ordered) map.set(item.groupKey!, { rate: item.rate!, since: item.since ?? item.decidedAt.slice(0, 10), status: "confirmed" });
  return map;
}

export function feeGroups(sales: Sale[], references: Map<string, FeeReference>, latest: string): FeeGroup[] {
  const from = addDays(latest, -FEE_WINDOW_DAYS);
  const keys = [...new Set(sales.map(sale => sale.groupKey))];
  return keys.map(key => {
    const window = sales.filter(sale => sale.groupKey === key && sale.date >= from && !sale.derived);
    const suggested = window.length >= FEE_MIN_SALES ? usualRate(window.map(sale => sale.feeCents / sale.grossCents)) : null;
    const confirmed = references.get(key) ?? null;
    return {
      key, label: sales.find(sale => sale.groupKey === key)!.label, saleCount: window.length, suggestedRate: suggested,
      reference: confirmed ?? (suggested !== null ? { rate: suggested, since: from, status: "suggested" as const } : null),
    };
  }).sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));
}

/** Taxa esperada por parcela, arredondada em centavos, como a Stone calcula o MDR. */
const expectedFee = (sale: Sale, rate: number) => sale.parcels.reduce((sum, parcel) => sum + Math.round(parcel.grossCents * rate), 0);
const withinTolerance = (sale: Sale, rate: number) => Math.abs(sale.feeCents - expectedFee(sale, rate)) <= FEE_TOLERANCE_CENTS * sale.parcels.length;

export type RateChange = { key: string; groupKey: string; label: string; from: number; to: number; since: string; saleCount: number; impactCents: number; fingerprint: string; reopened: boolean };
export type FeeException = { key: string; saleId: string; groupKey: string; label: string; date: string; grossCents: number; chargedCents: number; expectedCents: number; differenceCents: number; reason: "above" | "below" | "derived"; fingerprint: string; reopened: boolean };

/**
 * Mudança de taxa: as vendas mais recentes do grupo repetem uma taxa nova por ≥5 vendas ou ≥3 dias.
 * Vira uma pergunta ("é a nova taxa?") em vez de dezenas de exceções.
 */
export function detectRateChanges(sales: Sale[], groups: FeeGroup[]): RateChange[] {
  const changes: RateChange[] = [];
  for (const group of groups) {
    if (!group.reference) continue;
    const list = sales.filter(sale => sale.groupKey === group.key && !sale.derived && sale.date >= group.reference!.since);
    const streak: Sale[] = [];
    for (let index = list.length - 1; index >= 0; index--) {
      const sale = list[index];
      if (withinTolerance(sale, group.reference.rate)) break;
      const rate = round4(sale.feeCents / sale.grossCents);
      if (streak.length && Math.abs(round4(streak[0].feeCents / streak[0].grossCents) - rate) > 0.00005) break;
      streak.unshift(sale);
    }
    const days = new Set(streak.map(sale => sale.date)).size;
    if (streak.length >= CHANGE_MIN_SALES || (streak.length > 1 && days >= CHANGE_MIN_DAYS)) {
      const to = round4(streak[0].feeCents / streak[0].grossCents);
      changes.push({
        key: `${group.key}:${to}`, groupKey: group.key, label: group.label, from: group.reference.rate, to,
        since: streak[0].date, saleCount: streak.length,
        impactCents: streak.reduce((sum, sale) => sum + sale.feeCents - expectedFee(sale, group.reference!.rate), 0),
        fingerprint: `rate:${to}:${streak[0].date}`, reopened: false,
      });
    }
  }
  return changes;
}

export function feeExceptions(sales: Sale[], groups: FeeGroup[], changes: RateChange[], month: string): FeeException[] {
  const inChange = new Set(changes.flatMap(change => sales.filter(sale => sale.groupKey === change.groupKey && sale.date >= change.since
    && Math.abs(round4(sale.feeCents / sale.grossCents) - change.to) <= 0.00005).map(sale => sale.saleId)));
  const byKey = new Map(groups.map(group => [group.key, group]));
  return sales.flatMap(sale => {
    if (!sale.date.startsWith(month) || inChange.has(sale.saleId)) return [];
    const group = byKey.get(sale.groupKey);
    if (!group?.reference || withinTolerance(sale, group.reference.rate)) return [];
    const expected = expectedFee(sale, group.reference.rate);
    const difference = sale.feeCents - expected;
    return [{
      key: `${sale.groupKey}:${sale.saleId}`, saleId: sale.saleId, groupKey: sale.groupKey, label: sale.label, date: sale.date,
      grossCents: sale.grossCents, chargedCents: sale.feeCents, expectedCents: expected, differenceCents: difference,
      reason: sale.derived ? "derived" as const : difference > 0 ? "above" as const : "below" as const,
      fingerprint: `sale:${sale.grossCents}:${sale.feeCents}:${group.reference.rate}`, reopened: false,
    }];
  });
}

/** Item decidido sai da fila; se a evidência mudou depois da decisão, volta como "reaberto". */
export function applyDecisions<T extends { key: string; fingerprint: string; reopened: boolean }>(items: T[], kind: FeeDecisionKind, decisions: FeeDecision[]) {
  const latest = new Map<string, FeeDecision>();
  for (const item of decisions.filter(entry => entry.kind === kind).sort((a, b) => a.decidedAt.localeCompare(b.decidedAt))) latest.set(item.itemKey, item);
  return items.flatMap(item => {
    const decision = latest.get(item.key);
    if (!decision) return [item];
    return decision.fingerprint === item.fingerprint ? [] : [{ ...item, reopened: true }];
  });
}

export type OtherCharge = { key: string; saleId: string; label: string; date: string; amountCents: number; kind: "chargeback"; fingerprint: string; reopened: boolean };
export function otherCharges(parcels: ReceiptParcel[], month: string): OtherCharge[] {
  return parcels.filter(parcel => parcel.status === "chargeback" && (parcel.paidDate ?? parcel.expectedDate ?? "").startsWith(month)).map(parcel => ({
    key: parcel.id, saleId: parcel.saleId, label: groupLabel(parcel), date: parcel.paidDate ?? parcel.expectedDate ?? "",
    amountCents: parcel.expectedNetCents - (parcel.paidNetCents ?? 0), kind: "chargeback" as const,
    fingerprint: `cb:${parcel.expectedNetCents}:${parcel.paidNetCents ?? "null"}`, reopened: false,
  }));
}

/** Histórico: taxa mais frequente de cada grupo, por mês (meses em ordem crescente). */
export function feeHistory(salesByMonth: Array<{ month: string; sales: Sale[] }>) {
  const groups = new Map<string, string>();
  salesByMonth.forEach(entry => entry.sales.forEach(sale => groups.set(sale.groupKey, sale.label)));
  return [...groups.entries()].map(([key, label]) => ({
    key, label,
    months: salesByMonth.map(entry => {
      const list = entry.sales.filter(sale => sale.groupKey === key && sale.date.startsWith(entry.month) && !sale.derived);
      return { month: entry.month, rate: list.length ? usualRate(list.map(sale => sale.feeCents / sale.grossCents)) : null, sales: list.length };
    }),
  })).sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));
}
