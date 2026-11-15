import { stoneBrandName } from "@/lib/integrations/stone/stone-codes";
import { cardModality, resolveCardFee, stoneDecimalCents, type FeeSource, type ReceiptModality } from "../receipts-reconciliation/stone-account";
import type { StonePortfolioRow } from "./portfolio-projection";
import { walletTypeLabels } from "./wallet-position-labels";

/**
 * Tela "A receber": parcelas abertas da carteira Stone sincronizada, por mês e semana de vencimento,
 * e a posição de direitos (2.4) por natureza. A Stone informa a natureza só em total por arranjo,
 * nunca por parcela ou mês; por isso os cartões abrem o detalhe e não filtram a tabela.
 */

export type ReceivableItem = {
  id: string;
  transactionId: string;
  installment: number;
  installmentCount: number | null;
  saleDate: string | null;
  dueDate: string;
  grossCents: number;
  netCents: number;
  feeCents: number | null;
  feeSource: FeeSource | null;
  feeRate: number | null;
  brand: string | null;
  modality: ReceiptModality | null;
  status: "open" | "review";
  reason: string | null;
};

export function receivableItems(rows: StonePortfolioRow[]): ReceivableItem[] {
  return rows.flatMap(row => {
    if (row.status === "paid" || !row.dueDate) return [];
    const gross = stoneDecimalCents(row.gross);
    const net = stoneDecimalCents(row.net);
    if (gross === null || net === null) return [];
    const known = row.brandCode !== undefined;
    return [{
      id: `${row.transactionId}:${row.installment}`,
      transactionId: row.transactionId,
      installment: row.installment,
      installmentCount: row.installmentCount ?? null,
      saleDate: row.saleDate,
      dueDate: row.dueDate,
      grossCents: gross,
      netCents: net,
      // Carteira antiga (sem os campos da captura): taxa e cartão ficam desconhecidos até a próxima sincronização.
      ...(known ? resolveCardFee({ mdr: row.mdr ?? null, gross: row.gross, net: row.net }) : { feeCents: null, feeSource: null, feeRate: null }),
      brand: known ? stoneBrandName(row.brandCode) : null,
      modality: known ? cardModality({ accountTypeCode: row.accountTypeCode ?? null, installmentCount: row.installmentCount ?? null }) : null,
      status: row.status,
      reason: row.reason,
    }];
  }).sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.id.localeCompare(b.id));
}

export const receivableMonth = (date: string) => date.slice(0, 7);

export function receivableMonths(items: ReceivableItem[]) {
  return [...new Set(items.map(item => receivableMonth(item.dueDate)))].sort();
}

const mondayOf = (date: string) => {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() - (value.getUTCDay() + 6) % 7);
  return value.toISOString().slice(0, 10);
};

export type ReceivableTotals = { count: number; grossCents: number; feeCents: number; netCents: number; feeUnknown: number; feeToVerify: number };
export function receivableTotals(items: ReceivableItem[]): ReceivableTotals {
  return {
    count: items.length,
    grossCents: items.reduce((sum, item) => sum + item.grossCents, 0),
    feeCents: items.reduce((sum, item) => sum + (item.feeCents ?? 0), 0),
    netCents: items.reduce((sum, item) => sum + item.netCents, 0),
    feeUnknown: items.filter(item => item.feeCents === null).length,
    feeToVerify: items.filter(item => item.feeSource === "derived").length,
  };
}

export type ReceivableWeek = { from: string; first: string; last: string; items: ReceivableItem[]; totals: ReceivableTotals };
/** Semanas de segunda a domingo; `first`/`last` são os vencimentos reais dentro do recorte. */
export function receivableWeeks(items: ReceivableItem[]): ReceivableWeek[] {
  const groups = new Map<string, ReceivableItem[]>();
  for (const item of items) {
    const key = mondayOf(item.dueDate);
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([from, list]) => ({
    from, first: list[0].dueDate, last: list[list.length - 1].dueDate, items: list, totals: receivableTotals(list),
  }));
}

export type RightsRow = { walletTypeId: string; walletNatureId: string; nature: "regular" | "warranty" | "ownership_assignment" | "stone_anticipation" | "unknown"; category: string; amount: string };
export type NatureKey = "regular" | "stone_anticipation" | "warranty" | "ownership_assignment" | "unknown";
export const NATURE_ORDER: NatureKey[] = ["regular", "stone_anticipation", "warranty", "ownership_assignment", "unknown"];
export const natureLabel: Record<NatureKey, string> = {
  regular: "Livre", stone_anticipation: "Já antecipado", warranty: "Em garantia", ownership_assignment: "Cedido", unknown: "Não reconhecido",
};

export type NatureTotal = { key: NatureKey; cents: number; rows: Array<{ label: string; category: string; cents: number }> };
/** Totais da posição Stone por natureza, com o detalhe por arranjo (bandeira e produto) para o painel. */
export function rightsByNature(rows: RightsRow[]): NatureTotal[] {
  return NATURE_ORDER.map(key => {
    const list = rows.filter(row => row.nature === key).flatMap(row => {
      const cents = stoneDecimalCents(row.amount);
      return cents === null ? [] : [{ label: walletTypeLabels[row.walletTypeId] ?? `Arranjo ${row.walletTypeId}`, category: row.category, cents }];
    }).sort((a, b) => b.cents - a.cents);
    return { key, cents: list.reduce((sum, row) => sum + row.cents, 0), rows: list };
  }).filter(total => total.key !== "unknown" || total.rows.length > 0);
}
