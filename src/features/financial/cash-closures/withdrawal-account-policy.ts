export const WITHDRAWAL_EXPENSE_DRE_POSITIONS = new Set([
  "impostos_deducoes",
  "custos_variaveis",
  "pessoal",
  "despesas_operacionais",
  "ocupacao",
  "despesas_financeiras",
  "despesa_nao_operacional",
  "impostos_resultado",
]);

/** Compras pagas pela sangria que entram no estoque e só chegam à DRE pelo CMV. */
export const WITHDRAWAL_STOCK_ACCOUNT_PARENT_IDS = new Set(["estoque_compras_insumos_v2"]);

export type WithdrawalAccountPolicyInput = {
  active?: boolean;
  isGroup?: boolean;
  is_dre_account?: boolean;
  dre_position?: string | null;
  parentId?: string | null;
};

export function isWithdrawalClassifiableAccount(account: WithdrawalAccountPolicyInput) {
  if (account.active === false || account.isGroup === true) return false;
  if (account.is_dre_account === false) {
    return WITHDRAWAL_STOCK_ACCOUNT_PARENT_IDS.has(account.parentId ?? "");
  }
  return WITHDRAWAL_EXPENSE_DRE_POSITIONS.has(account.dre_position ?? "");
}
