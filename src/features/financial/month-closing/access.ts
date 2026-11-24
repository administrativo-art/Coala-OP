import { AppError } from "@/lib/observability/app-error";

type Actor = {
  isDefaultAdmin: boolean;
  permissions: {
    financial?: {
      view?: boolean;
      expenses?: { view?: boolean };
      monthClosings?: { view?: boolean };
    };
  };
};

/**
 * O fechamento é da empresa inteira, não de uma unidade: exige `financial.view` e a permissão própria
 * `financial.monthClosings.view`. Perfis salvos antes dela não a têm e ficam sem acesso.
 */
export function canViewMonthClosing(actor: Actor) {
  if (actor.isDefaultAdmin) return true;
  const financial = actor.permissions.financial;
  return financial?.view === true && financial.monthClosings?.view === true;
}

/** Os itens trazem fornecedor, descrição e valor: só para quem também vê despesas. */
export function canViewMonthClosingExpenseItems(actor: Actor) {
  if (actor.isDefaultAdmin) return true;
  return canViewMonthClosing(actor) && actor.permissions.financial?.expenses?.view === true;
}

/** Vendas e Taxas têm telas de origem só do administrador padrão: os itens seguem a mesma regra. */
export function canViewMonthClosingStoneItems(actor: Actor) {
  return actor.isDefaultAdmin;
}

export function assertMonthClosingAccess(actor: Actor) {
  if (!canViewMonthClosing(actor)) {
    throw new AppError({ code: "MONTH_CLOSING_FORBIDDEN", kind: "AUTHORIZATION" });
  }
}
