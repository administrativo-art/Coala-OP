import { financialDateKey } from "@/features/financial/lib/financial-dates";
import type { StudyExpense } from "./model";

type Row = Record<string, unknown>;
export type CardSourceRow = { id: string; data: Row };
const text = (x: unknown) => typeof x === "string" ? x : "";
const row = (x: unknown): Row => x && typeof x === "object" ? x as Row : {};
const amount = (x: unknown) => typeof x === "number" && Number.isFinite(x) && x >= 0 ? Math.round(x * 100) : null;
const cents = (x: unknown) => typeof x === "number" && Number.isSafeInteger(x) && x >= 0 ? x : null;
export const cardDate = (x: unknown) => {
  const date = typeof x === "string" && /^\d{4}-\d{2}-\d{2}$/.test(x) ? x : financialDateKey(x);
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const parsed = new Date(`${date}T12:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date ? date : null;
};
export const cardInstrumentKey = (data: Row) => text(data.plannedBankAccountId) && text(data.plannedPaymentMethodId) ? JSON.stringify([data.plannedBankAccountId, data.plannedPaymentMethodId]) : null;
export const isCardPurchase = (data: Row) => data.plannedPaymentMethodType === "credit_card";
const cycle = (data: Row, due: string) => text(data.accountId) && text(data.paymentMethodId) ? JSON.stringify([data.accountId, data.paymentMethodId, due]) : null;

/** One bank outflow per explicit card cycle. Purchase balances never become bank payables. */
export function buildCardCashForecast(input: {
  today: string; horizonEnd: string; purchases: CardSourceRow[]; statements: CardSourceRow[];
  obligations: CardSourceRow[]; complete: boolean; futureCoverageComplete?: boolean; blockedInstruments?: string[];
}) {
  const gaps: string[] = [];
  const expenses: StudyExpense[] = [];
  const statements = new Map(input.statements.map(s => [s.id, s.data]));
  const obligations = new Map(input.obligations.map(s => [s.id, s.data]));
  const byCycle = new Map<string, string[]>();
  for (const [id, data] of statements) {
    const due = cardDate(data.dueDate), key = due && cycle(data, due);
    if (key) byCycle.set(key, [...(byCycle.get(key) ?? []), id]);
  }
  let legacy = 0, unresolved = 0;
  const future = new Map<string, { due: string; total: number; label: string }>();
  const seen = new Set<string>();
  for (const purchase of input.purchases) {
    const data = purchase.data;
    if (seen.has(purchase.id) || !isCardPurchase(data)) continue;
    seen.add(purchase.id);
    if (!["pending", "partially_paid"].includes(text(data.status))) continue;
    if (!Array.isArray(data.installments) || !data.installments.length) { unresolved++; continue; }
    for (const item of data.installments) {
      const part = row(item);
      if (["paid", "cancelled", "reconciled"].includes(text(part.status)) || part.cardStatementRevisionStatus === "removed") continue;
      const due = cardDate(part.dueDate), value = amount(part.value);
      if (!due || value === null || !["pending", "provisioned"].includes(text(part.status))) { unresolved++; continue; }
      const key = cycle({ accountId: data.plannedBankAccountId, paymentMethodId: data.plannedPaymentMethodId }, due);
      if (!key) { unresolved++; continue; }
      const linked = text(part.cardStatementId);
      const matching = byCycle.get(key) ?? [];
      // A stored invoice is authoritative for its own cycle, including paid/cancelled invoices.
      if (linked) {
        const statement = statements.get(linked);
        if (!statement || cycle(statement, due) !== key) { unresolved++; continue; }
        const linkedDue = cardDate(statement.dueDate);
        if (linkedDue === due) continue;
        // A historical pointer is not proof that a later installment was paid.
        if (!linkedDue || linkedDue >= due || due <= input.today) { unresolved++; continue; }
        gaps.push("Parcela futura com referência de fatura antiga: previsão pela data registrada da parcela; conferir o vínculo da fatura.");
      }
      if (matching.length) continue;
      if (due <= input.today) { legacy++; continue; }
      if (due > input.horizonEnd || value === 0) continue;
      if (!(input.futureCoverageComplete ?? input.complete) || input.blockedInstruments?.includes(cardInstrumentKey(data) ?? "")) { unresolved++; continue; }
      const group = future.get(key) ?? { due, total: 0, label: text(data.plannedPaymentMethodLabel) || "cartão de crédito" };
      group.total += value; future.set(key, group);
    }
  }
  for (const [id, data] of statements) {
    const due = cardDate(data.dueDate), key = due && cycle(data, due);
    if (!due || !key || (byCycle.get(key)?.length ?? 0) !== 1) { unresolved++; continue; }
    const obligationId = text(data.obligationId), obligation = obligationId ? obligations.get(obligationId) : undefined;
    const summary = row(obligation?.summary ?? data.settlementSummary);
    const state = text(obligation?.status);
    if (obligationId && (!obligation || obligation.sourceId !== id || obligation.obligationType !== "CARD_STATEMENT" || !["OPEN", "PARTIALLY_PAID", "PAID", "CANCELLED"].includes(state))) { unresolved++; continue; }
    if (["paid", "cancelled"].includes(text(data.status)) || ["PAID", "CANCELLED"].includes(state)) {
      if (cents(summary.balanceAmountCents) && data.status === "paid") unresolved++;
      continue;
    }
    if (!["open", "closed"].includes(text(data.status))) { unresolved++; continue; }
    // A bank link without a consistent settled obligation cannot be interpreted as another debit.
    const balance = cents(summary.balanceAmountCents);
    if ((text(data.linkedBankTransactionId) || (Array.isArray(data.linkedBankTransactionIds) && data.linkedBankTransactionIds.length)) && balance === null) { unresolved++; continue; }
    const official = amount(data.officialTotal);
    if (balance === null && (obligationId || official === null)) { unresolved++; continue; }
    const total = balance ?? official!;
    if (!total || due > input.horizonEnd) continue;
    expenses.push({ id: `card-statement:${id}`, description: `Fatura do cartão · ${text(data.paymentMethodLabel) || "cartão de crédito"}`,
      supplier: data.status === "closed" ? "Fatura fechada" : "Fatura aberta · total informado", date: due, amountCents: total,
      provisioned: data.status !== "closed", category: null, excludeFromRecurringCoverage: true, cardStatement: true });
  }
  for (const [key, group] of future) expenses.push({ id: `card-cycle:${key}`, description: `Fatura prevista · ${group.label}`, supplier: "Parcelas futuras registradas · fatura ainda não disponível", date: group.due, amountCents: group.total, provisioned: true, category: null, excludeFromRecurringCoverage: true, cardStatement: true });
  if (legacy) gaps.push(`${legacy} parcela(s) antiga(s) de cartão sem fatura confiável: conferir conciliação em Despesas/Faturas; não somadas como saída vencida.`);
  if (unresolved) gaps.push(`${unresolved} vínculo(s)/valor(es) de cartão indisponíveis ou ambíguos: conferir faturas; saída não presumida.`);
  if (future.size) gaps.push("Faturas previstas usam apenas parcelas futuras registradas; compras ainda não lançadas não estão incluídas.");
  if (!input.complete) gaps.push("Cobertura de faturas/obrigações parcial: valores desconhecidos não são zero; confira Despesas/Faturas.");
  return { expenses, gaps: [...new Set(gaps)] };
}
