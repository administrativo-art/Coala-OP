import type { ClosingCheck, ClosingFlow, ClosingItem } from "./types";

/** O que a DRE da unidade tem no mês: CMV congelado e receita/caixa comprovados. Valores ficam na tela da DRE. */
export type DreFlowUnitInput = {
  key: string;
  label: string;
  /** `null`: o CMV do mês não foi lido. Nunca vira congelado. */
  cmv: { status: "open" | "closed"; complete: boolean; sourceChanged: boolean } | null;
  revenueProven: boolean;
  /** Diferenças de caixa comprovadas em todos os dias e sem valor provisório. */
  cashProven: boolean;
  cashCoveredDays: number;
  cashTotalDays: number;
};

/** `null` quando não foi possível ler as fontes da DRE. */
export type DreInput = { monthOver: boolean; units: DreFlowUnitInput[]; expenseIssueCount: number } | null;

export type DreFlowInput = { dre: DreInput; canViewItems: boolean; originHref: string };

const CHECK_CMV = "dre.cmv";
const CHECK_SOURCES = "dre.sources";
const CHECK_EXPENSES = "dre.expenses";

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;
const cmvFrozen = (unit: DreFlowUnitInput) => unit.cmv?.status === "closed" && unit.cmv.complete && !unit.cmv.sourceChanged;
const sourcesProven = (unit: DreFlowUnitInput) => unit.revenueProven && unit.cashProven;

/**
 * DRE do mês, em três conferências que só valem depois que o mês terminou (o CMV só congela com o mês fechado):
 * 1. CMV congelado: todas as unidades com receita têm o CMV por composição fechado, completo e sem venda alterada depois.
 * 2. Receita e caixa comprovados: receita integral do PDV e diferenças de caixa comprovadas em todos os dias, sem provisório.
 * 3. Despesas íntegras: nenhuma inconsistência contábil nas despesas que entram na DRE.
 * É o mesmo critério do “Conferir fontes” da DRE. Fonte não lida nunca vira conferida nem zero. O snapshot e o relatório
 * do fechamento ainda não existem; o fluxo só confere as fontes.
 */
export function evaluateDreFlow(input: DreFlowInput): ClosingFlow {
  const { dre } = input;
  const unavailable = (id: string, name: string): ClosingCheck => ({ id, name, state: "unavailable", done: null, total: null, note: "Não foi possível ler as fontes da DRE agora. Tente de novo." });
  const names = { cmv: "CMV congelado nas unidades", sources: "Receita e caixa comprovados", expenses: "Despesas íntegras na DRE" };
  const items: ClosingItem[] = [];
  let checks: ClosingCheck[];
  if (!dre) {
    checks = [unavailable(CHECK_CMV, names.cmv), unavailable(CHECK_SOURCES, names.sources), unavailable(CHECK_EXPENSES, names.expenses)];
  } else if (!dre.monthOver) {
    const note = "Confere depois que o mês terminar.";
    checks = [CHECK_CMV, CHECK_SOURCES, CHECK_EXPENSES].map((id, index) => ({ id, name: [names.cmv, names.sources, names.expenses][index], state: "pending" as const, done: null, total: null, note }));
  } else {
    for (const unit of dre.units) {
      const cmv = unit.cmv;
      if (!cmv || cmv.status !== "closed") {
        items.push({ id: `dre:${unit.key}:cmv-open`, checkId: CHECK_CMV, kind: "dre_cmv_open", tone: "warn", title: unit.label,
          detail: "O CMV por composição ainda não foi congelado neste mês.", dueDate: null, amountCents: null, href: "" });
      } else if (!cmv.complete) {
        items.push({ id: `dre:${unit.key}:cmv-incomplete`, checkId: CHECK_CMV, kind: "dre_cmv_incomplete", tone: "warn", title: unit.label,
          detail: "O CMV congelado está incompleto: confira os relatórios de vendas, as fichas e os custos. Custo ausente não é zero.", dueDate: null, amountCents: null, href: "" });
      } else if (cmv.sourceChanged) {
        items.push({ id: `dre:${unit.key}:cmv-changed`, checkId: CHECK_CMV, kind: "dre_cmv_changed", tone: "warn", title: unit.label,
          detail: "As vendas mudaram depois do congelamento. Reabra o CMV, confira e feche de novo.", dueDate: null, amountCents: null, href: "" });
      }
      if (!sourcesProven(unit)) {
        items.push({ id: `dre:${unit.key}:sources`, checkId: CHECK_SOURCES, kind: "dre_sources_unproven", tone: "warn", title: unit.label,
          detail: !unit.revenueProven
            ? "A receita do mês não está comprovada pelos fechamentos de caixa."
            : `Diferenças de caixa comprovadas em ${unit.cashCoveredDays} de ${unit.cashTotalDays} dias, ou ainda provisórias.`,
          dueDate: null, amountCents: null, href: "" });
      }
    }
    if (dre.expenseIssueCount > 0) {
      items.push({ id: "dre:expenses", checkId: CHECK_EXPENSES, kind: "dre_expense_integrity", tone: "warn", title: "Despesas da DRE",
        detail: `${plural(dre.expenseIssueCount, "inconsistência contábil impede", "inconsistências contábeis impedem")} considerar a DRE fechada.`,
        dueDate: null, amountCents: null, href: "" });
    }
    const total = dre.units.length;
    const empty = total === 0;
    const frozen = dre.units.filter(cmvFrozen).length;
    const proven = dre.units.filter(sourcesProven).length;
    const emptyNote = { note: "Nenhuma unidade com receita lida neste mês." };
    checks = [
      { id: CHECK_CMV, name: names.cmv, state: !empty && frozen === total ? "ok" : "pending", done: frozen, total, ...(empty ? emptyNote : {}) },
      { id: CHECK_SOURCES, name: names.sources, state: !empty && proven === total ? "ok" : "pending", done: proven, total, ...(empty ? emptyNote : {}) },
      { id: CHECK_EXPENSES, name: names.expenses, state: dre.expenseIssueCount === 0 ? "ok" : "pending", done: null, total: null,
        ...(dre.expenseIssueCount > 0 ? { note: plural(dre.expenseIssueCount, "inconsistência", "inconsistências") } : {}) },
    ];
  }
  const withHref = items.map((item) => ({ ...item, href: input.originHref }));
  const state = checks.some((check) => check.state === "pending") ? "pending"
    : checks.some((check) => check.state === "unavailable") ? "unavailable" : "ok";
  return {
    key: "dre", name: "DRE", state, checks,
    items: input.canViewItems ? withHref : [], itemsHidden: !input.canViewItems && withHref.length > 0,
    readyFrom: null, originHref: input.originHref,
  };
}

export function dreFlowUnavailable(originHref: string): ClosingFlow {
  return evaluateDreFlow({ dre: null, canViewItems: false, originHref });
}
