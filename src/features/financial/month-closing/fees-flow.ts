import type { ClosingCheck, ClosingFlow, ClosingItem } from "./types";

/** Resultado da aba Taxas de um vínculo Stone (unidade × StoneCode) na competência. */
export type FeesUnitInput = {
  key: string;
  label: string;
  /** Tela de origem desta unidade, já no mês. */
  href: string;
  /** A conferência Stone do mês foi salva. */
  ready: boolean;
  /** Foi salva depois do fim do mês (com o mês inteiro publicado pela Stone). */
  complete: boolean;
  exceptionCount: number;
  changeCount: number;
  chargeCount: number;
};

export type FeesFlowInput = { units: FeesUnitInput[]; canViewItems: boolean; originHref: string };

const CHECK_READY = "fees.ready";
const CHECK_EXCEPTIONS = "fees.exceptions";
const CHECK_CHANGES = "fees.changes";
const CHECK_CHARGES = "fees.charges";

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/**
 * Taxas = aba Taxas sem pendência em todos os vínculos Stone, com a conferência do mês completa.
 * Sem a conferência salva as contagens são desconhecidas: contam como pendentes, nunca como zero.
 */
export function evaluateFeesFlow(input: FeesFlowInput): ClosingFlow {
  const units = input.units;
  const trusted = (unit: FeesUnitInput) => unit.ready && unit.complete;
  const items: ClosingItem[] = [];
  for (const unit of units) {
    if (!unit.ready || !unit.complete) {
      items.push({
        id: `fees:${unit.key}:not-ready`, checkId: CHECK_READY, kind: "fees_not_ready", tone: "warn", title: unit.label,
        detail: unit.ready ? "A conferência foi salva antes de o mês fechar. Refaça com o arquivo completo da Stone." : "A conferência Stone do mês ainda não foi salva.",
        dueDate: null, amountCents: null, href: unit.href,
      });
    }
    const rows: Array<[number, ClosingItem["kind"], string, string]> = [
      [unit.exceptionCount, "fees_exception", CHECK_EXCEPTIONS, plural(unit.exceptionCount, "venda com taxa fora do esperado", "vendas com taxa fora do esperado")],
      [unit.changeCount, "fees_rate_change", CHECK_CHANGES, plural(unit.changeCount, "mudança de taxa a decidir", "mudanças de taxa a decidir")],
      [unit.chargeCount, "fees_charge", CHECK_CHARGES, plural(unit.chargeCount, "outra cobrança a conferir", "outras cobranças a conferir")],
    ];
    if (!unit.ready) continue;
    for (const [count, kind, checkId, detail] of rows) {
      if (count <= 0) continue;
      items.push({ id: `fees:${unit.key}:${kind}`, checkId, kind, tone: "warn", title: unit.label, detail, dueDate: null, amountCents: null, href: unit.href });
    }
  }
  const count = (select: (unit: FeesUnitInput) => number): Pick<ClosingCheck, "state" | "done" | "total"> => {
    const done = units.filter((unit) => trusted(unit) && select(unit) === 0).length;
    return { state: units.length > 0 && done === units.length ? "ok" : "pending", done, total: units.length };
  };
  const readyDone = units.filter(trusted).length;
  const checks: ClosingCheck[] = units.length === 0
    ? [{ id: CHECK_READY, name: "Conferência Stone do mês", state: "unavailable", done: null, total: null, note: "Nenhum vínculo Stone vigente nesta competência." }]
    : [
      { id: CHECK_READY, name: "Conferência Stone do mês", state: readyDone === units.length ? "ok" : "pending", done: readyDone, total: units.length },
      { id: CHECK_EXCEPTIONS, name: "Vendas a corrigir", ...count((unit) => unit.exceptionCount) },
      { id: CHECK_CHANGES, name: "Mudanças de taxa", ...count((unit) => unit.changeCount) },
      { id: CHECK_CHARGES, name: "Outras cobranças", ...count((unit) => unit.chargeCount) },
    ];
  const state = checks.some((check) => check.state === "unavailable") ? "unavailable"
    : checks.some((check) => check.state === "pending") ? "pending" : "ok";
  return {
    key: "fees", name: "Taxas", state, checks,
    items: input.canViewItems ? items : [], itemsHidden: !input.canViewItems && items.length > 0,
    readyFrom: null, originHref: input.originHref,
  };
}

export function feesFlowUnavailable(originHref: string): ClosingFlow {
  return {
    key: "fees", name: "Taxas", state: "unavailable", itemsHidden: false, items: [], readyFrom: null, originHref,
    checks: [{ id: CHECK_READY, name: "Conferência Stone do mês", state: "unavailable", done: null, total: null, note: "Não foi possível ler as taxas agora. Tente de novo." }],
  };
}
