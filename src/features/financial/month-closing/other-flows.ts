import type { ClosingFlow, ClosingFlowKey } from "./types";

/**
 * Fluxos cujo cálculo ainda não existe no fechamento. Aparecem com o nome das conferências previstas no plano,
 * sem números: fonte ausente nunca vira "conferido" nem zero.
 */
const PLANNED: Array<{ key: Exclude<ClosingFlowKey, "expenses">; name: string; checks: string[] }> = [
  { key: "sales", name: "Vendas", checks: ["Caixa fechado", "PDV × Stone (cartão)", "Pix"] },
  { key: "fees", name: "Taxas", checks: ["Vendas a corrigir", "Mudanças de taxa", "Lançamento no mês"] },
  { key: "dre", name: "DRE", checks: ["CMV congelado", "Fontes conferidas"] },
];

export function notConnectedFlows(only?: ClosingFlowKey[]): ClosingFlow[] {
  return PLANNED.filter((flow) => !only || only.includes(flow.key)).map((flow) => ({
    key: flow.key,
    name: flow.name,
    state: "not_connected",
    checks: flow.checks.map((name, index) => ({
      id: `${flow.key}.${index + 1}`, name, state: "unavailable", done: null, total: null,
      note: "Ainda não conectado ao fechamento.",
    })),
    items: [],
    itemsHidden: false,
    readyFrom: null,
  }));
}
