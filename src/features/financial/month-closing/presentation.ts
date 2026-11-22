import { formatDateBr } from "./month";
import type { ClosingCheckState, ClosingFlow, ClosingItem, ClosingItemKind, ClosingTone } from "./types";

export type PillTone = ClosingTone;

export function flowStatus(flow: ClosingFlow): { label: string; tone: PillTone } {
  if (flow.state === "ok") return { label: "Conferido", tone: "ok" };
  if (flow.state === "pending") {
    return { label: flow.readyFrom ? `Pendente até ${formatDateBr(flow.readyFrom).slice(0, 5)}` : "Pendente", tone: "warn" };
  }
  if (flow.state === "unavailable") return { label: "Fonte não conectada", tone: "neutral" };
  return { label: "Ainda não conectado", tone: "neutral" };
}

export function checkTone(state: ClosingCheckState): PillTone {
  return state === "ok" ? "ok" : state === "pending" ? "warn" : "neutral";
}

export function checkCount(check: { done: number | null; total: number | null; state: ClosingCheckState }) {
  if (check.done == null || check.total == null) return "—";
  return `${check.done}/${check.total}`;
}

const KIND_LABEL: Record<ClosingItemKind, string> = {
  forecast_without_actual: "Previsão",
  draft: "Rascunho",
  overdue: "Vencido",
  awaiting_due_date: "Aguarda data",
  no_due_date: "Sem vencimento",
  payment_without_document: "Falta documento",
  paid_without_bank_link: "Sem vínculo no extrato",
  payment_reported_only: "Só informado",
  payment_divergent: "Divergente",
  card_statement_missing: "Fatura não importada",
  card_statement_open: "Fatura aberta",
  card_statement_awaiting_payment: "Aguarda pagamento",
  card_statement_overdue: "Fatura vencida",
  sales_attention: "Requer atenção",
  sales_awaiting_source: "Aguardando fonte",
  sales_reopened: "Reaberto",
  sales_not_reviewed: "Não verificado",
  sales_not_published: "Aguarda a Stone",
  fees_not_ready: "Conferência pendente",
  fees_exception: "Taxa a corrigir",
  fees_rate_change: "Mudança de taxa",
  fees_charge: "Outra cobrança",
  card_pix_not_ready: "Conferência pendente",
  card_pix_unpaid: "Não recebida",
  card_pix_late: "Paga com atraso",
  card_pix_chargeback: "Estorno",
  card_pix_review: "Em revisão",
  card_pix_missing_file: "Sem arquivo da Stone",
  card_pix_awaiting: "Dentro do prazo",
  cash_closing_open: "Caixa não aprovado",
  cash_deposit_unpaid: "Depósito pendente",
};

export function itemLabel(item: ClosingItem) {
  return KIND_LABEL[item.kind];
}

/** Itens que só a pessoa pode resolver (sem data a esperar) × os que se resolvem quando o prazo chega. */
export function dependsOnYou(item: ClosingItem) {
  return item.kind !== "awaiting_due_date" && item.kind !== "card_statement_awaiting_payment" && item.kind !== "sales_not_published" && item.kind !== "card_pix_awaiting";
}

export function nextDueDate(items: ClosingItem[], today: string) {
  return items
    .filter((entry) => !dependsOnYou(entry) && entry.dueDate && entry.dueDate >= today)
    .reduce<string | null>((first, entry) => (!first || (entry.dueDate as string) < first ? entry.dueDate : first), null);
}
