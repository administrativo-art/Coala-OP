/** Lógica pura das telas de Configurações → Financeiro (testada em tests/unit/financeiro-settings-redesign.test.ts). */

export function normalizeFinanceText(value: string | null | undefined) {
  return (value ?? "").normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().trim();
}

/** Busca por trechos sem acento nem caixa; sem termo, tudo corresponde. */
export function matchesFinanceQuery(query: string, ...fields: Array<string | null | undefined>) {
  const term = normalizeFinanceText(query);
  if (!term) return true;
  return fields.some((field) => normalizeFinanceText(field).includes(term));
}

export const ALIAS_MATCH_LABELS: Record<string, string> = {
  contains: "Contém",
  startsWith: "Começa com",
  endsWith: "Termina com",
  exact: "Exato",
};

export type PlanNode<T extends { id: string; parentId?: string | null; order?: number }> = T & { children: Array<PlanNode<T>> };

/** Monta a árvore pelo `parentId`; item cujo pai não existe vira raiz. */
export function buildPlanTree<T extends { id: string; parentId?: string | null; order?: number }>(items: T[]): Array<PlanNode<T>> {
  const ids = new Set(items.map((item) => item.id));
  const byOrder = (a: T, b: T) => (a.order ?? 0) - (b.order ?? 0);
  const build = (parentId: string | null): Array<PlanNode<T>> =>
    items
      .filter((item) => (parentId === null ? !item.parentId || !ids.has(item.parentId) : item.parentId === parentId))
      .sort(byOrder)
      .map((item) => ({ ...item, children: build(item.id) }));
  return build(null);
}

export function collectDescendantIds<T extends { id: string; parentId?: string | null }>(items: T[], rootId: string) {
  const result = new Set<string>();
  const visit = (id: string) => {
    items.filter((item) => item.parentId === id).forEach((child) => {
      if (result.has(child.id)) return;
      result.add(child.id);
      visit(child.id);
    });
  };
  visit(rootId);
  return result;
}

export type FlatPlanRow<T extends { id: string }> = { item: PlanNode<T>; number: string; depth: number; rootIndex: number };

/**
 * Linhas visíveis do plano: numeração hierárquica (1, 1.1…), respeita o recolhimento
 * e, com busca ativa, mostra apenas os itens que correspondem, sem hierarquia.
 */
export function flattenPlan<T extends { id: string; parentId?: string | null; order?: number }>(
  tree: Array<PlanNode<T>>,
  expanded: ReadonlySet<string>,
  matches: ((item: T) => boolean) | null
): Array<FlatPlanRow<T>> {
  const rows: Array<FlatPlanRow<T>> = [];
  const visit = (nodes: Array<PlanNode<T>>, prefix: string, depth: number, rootIndex: number | null) => {
    nodes.forEach((node, index) => {
      const number = prefix ? `${prefix}.${index + 1}` : String(index + 1);
      const root = rootIndex ?? index;
      if (matches) {
        if (matches(node)) rows.push({ item: node, number, depth: 0, rootIndex: root });
        visit(node.children, number, depth + 1, root);
        return;
      }
      rows.push({ item: node, number, depth, rootIndex: root });
      if (node.children.length > 0 && expanded.has(node.id)) visit(node.children, number, depth + 1, root);
    });
  };
  visit(tree, "", 0, null);
  return rows;
}

export const DRE_POSITIONS = [
  { value: "impostos_deducoes", label: "Impostos e deduções" },
  { value: "custos_variaveis", label: "Custos variáveis" },
  { value: "pessoal", label: "Pessoal" },
  { value: "despesas_operacionais", label: "Despesas operacionais" },
  { value: "ocupacao", label: "Ocupação" },
  { value: "despesas_financeiras", label: "Despesas financeiras" },
  { value: "receita_financeira", label: "Receita financeira" },
  { value: "receita_nao_operacional", label: "Receita não operacional" },
  { value: "despesa_nao_operacional", label: "Despesa não operacional" },
  { value: "impostos_resultado", label: "IR / CSLL" },
] as const;

export function dreLabel(position: string | null | undefined) {
  return DRE_POSITIONS.find((item) => item.value === position)?.label ?? null;
}

/** Resumo de classificação do plano: DRE, patrimonial e sem classificação. */
export function summarizePlan(items: Array<{ dre_position?: string | null; is_dre_account?: boolean }>) {
  let dre = 0;
  let patrimonial = 0;
  let unclassified = 0;
  items.forEach((item) => {
    if (item.is_dre_account === false) patrimonial += 1;
    else if (item.dre_position) dre += 1;
    else unclassified += 1;
  });
  return { total: items.length, dre, patrimonial, unclassified };
}

export const PAYMENT_TYPE_LABELS: Record<string, string> = {
  debit_card: "Cartão de débito",
  credit_card: "Cartão de crédito",
  pix: "PIX",
  transfer: "Transferência",
  cash: "Dinheiro",
};

/** Texto de fechamento/vencimento da fatura; vazio fora do cartão de crédito. */
export function describeCardCycle(method: { type?: string; closingDay?: number | null; dueDay?: number | null }) {
  if (method.type !== "credit_card") return "";
  const parts = [method.closingDay ? `Fecha dia ${method.closingDay}` : "", method.dueDay ? `Vence dia ${method.dueDay}` : ""];
  return parts.filter(Boolean).join(" · ");
}

export function bankAccountSummary(accounts: Array<{ active?: boolean; paymentMethods?: unknown[] }>) {
  const active = accounts.filter((account) => account.active !== false).length;
  const methods = accounts.reduce((sum, account) => sum + (account.paymentMethods?.length ?? 0), 0);
  return { total: accounts.length, active, inactive: accounts.length - active, methods };
}

const REFERENCE_COMPETENCE = /^\d{4}-(0[1-9]|1[0-2])$/;
export function isCompetenceMonth(value: string) {
  return REFERENCE_COMPETENCE.test(value);
}

/** Consumo do orçamento em 0–100 para a barra; valores inválidos viram 0. */
export function usagePercent(usageRatio: number | null | undefined) {
  if (typeof usageRatio !== "number" || !Number.isFinite(usageRatio)) return 0;
  return Math.min(Math.max(usageRatio, 0), 1) * 100;
}

export function summarizeBudgets(budgets: Array<{ active: boolean; budgetedAmountCents: number; consumedAmountCents: number; balanceAmountCents: number }>) {
  const active = budgets.filter((budget) => budget.active);
  return {
    count: budgets.length,
    activeCount: active.length,
    budgetedCents: active.reduce((sum, budget) => sum + budget.budgetedAmountCents, 0),
    consumedCents: active.reduce((sum, budget) => sum + budget.consumedAmountCents, 0),
    balanceCents: active.reduce((sum, budget) => sum + budget.balanceAmountCents, 0),
  };
}

export function budgetRuleModeLabel(rule: { mode: string; averageMonths?: number | null }) {
  if (rule.mode === "fixed") return "Valor fixo";
  if (rule.mode === "expense_previous") return "Último mês fechado";
  if (rule.mode === "consumption_price") return "Consumo e preço dos insumos";
  return `Média de ${rule.averageMonths ?? 0} meses`;
}
