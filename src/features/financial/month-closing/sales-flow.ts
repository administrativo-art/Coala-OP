import type { SalesReviewMonth } from "@/features/financial/sales-reconciliation/review-calendar";

import type { ClosingCheck, ClosingFlow, ClosingItem, ClosingItemKind } from "./types";

/** Um vínculo Stone (unidade × StoneCode) com o calendário da revisão PDV × Stone do mês. */
export type SalesUnitInput = {
  key: string;
  label: string;
  /** Tela de origem desta unidade, já no mês. */
  href: string;
  month: SalesReviewMonth;
};

export type SalesFlowInput = {
  units: SalesUnitInput[];
  canViewItems: boolean;
  /** Tela de origem do fluxo, já no mês. */
  originHref: string;
};

export const SALES_CHECK_REVIEW = "sales.review";

const STATES: Array<{ state: keyof SalesReviewMonth["counts"]; kind: ClosingItemKind; title: (n: number) => string }> = [
  { state: "attention_required", kind: "sales_attention", title: (n) => `${n} ${n === 1 ? "dia requer" : "dias requerem"} atenção` },
  { state: "awaiting_source", kind: "sales_awaiting_source", title: (n) => `${n} ${n === 1 ? "dia aguarda" : "dias aguardam"} fonte` },
  { state: "reopened", kind: "sales_reopened", title: (n) => `${n} ${n === 1 ? "dia reaberto" : "dias reabertos"} por informação tardia` },
  { state: "not_reviewed", kind: "sales_not_reviewed", title: (n) => `${n} ${n === 1 ? "dia sem verificação" : "dias sem verificação"}` },
  { state: "not_available", kind: "sales_not_published", title: (n) => `${n} ${n === 1 ? "dia ainda não publicado" : "dias ainda não publicados"} pela Stone` },
];

function dayList(days: number[]) {
  const labels = days.map((day) => String(day).padStart(2, "0"));
  const shown = labels.slice(0, 6);
  const rest = labels.length - shown.length;
  const head = shown.length > 1 ? `${shown.slice(0, -1).join(", ")} e ${shown.at(-1)}` : shown[0];
  return `${days.length === 1 ? "Dia" : "Dias"} ${head}${rest > 0 ? ` e mais ${rest}` : ""}`;
}

/**
 * Vendas = revisão PDV × Stone (cartão e Pix) de todos os dias de cada vínculo Stone da competência.
 * Conferido só quando todo dia elegível está fechado e nenhum dia ficou sem publicação da Stone.
 * Sem vínculo vigente a fonte não existe: nunca vira conferido.
 */
export function evaluateSalesFlow(input: SalesFlowInput): ClosingFlow {
  const units = input.units.filter((unit) => unit.month.eligibleCount + unit.month.counts.not_available > 0);
  let done = 0;
  let total = 0;
  const items: ClosingItem[] = [];
  for (const unit of units) {
    const counts = unit.month.counts;
    done += counts.closed;
    total += unit.month.eligibleCount + counts.not_available;
    for (const entry of STATES) {
      const count = counts[entry.state];
      if (count <= 0) continue;
      const days = unit.month.days.filter((day) => day.state === entry.state).map((day) => day.day);
      items.push({
        id: `sales:${unit.key}:${entry.state}`,
        checkId: SALES_CHECK_REVIEW,
        kind: entry.kind,
        tone: entry.kind === "sales_not_published" ? "info" : "warn",
        title: `${unit.label} · ${entry.title(count)}`,
        detail: dayList(days),
        dueDate: null,
        amountCents: null,
        href: unit.href,
      });
    }
  }
  const check: ClosingCheck = total === 0
    ? { id: SALES_CHECK_REVIEW, name: "PDV × Stone (cartão e Pix)", state: "unavailable", done: null, total: null, note: "Nenhum vínculo Stone vigente nesta competência." }
    : { id: SALES_CHECK_REVIEW, name: "PDV × Stone (cartão e Pix)", state: done === total ? "ok" : "pending", done, total };
  return {
    key: "sales",
    name: "Vendas",
    state: check.state,
    checks: [check],
    items: input.canViewItems ? items : [],
    itemsHidden: !input.canViewItems && items.length > 0,
    readyFrom: null,
    originHref: input.originHref,
  };
}

/** Fonte ilegível agora: o fluxo fica indisponível, nunca conferido nem zerado. */
export function salesFlowUnavailable(originHref: string): ClosingFlow {
  return {
    key: "sales", name: "Vendas", state: "unavailable", itemsHidden: false, items: [], readyFrom: null, originHref,
    checks: [{ id: SALES_CHECK_REVIEW, name: "PDV × Stone (cartão e Pix)", state: "unavailable", done: null, total: null, note: "Não foi possível ler a revisão agora. Tente de novo." }],
  };
}
