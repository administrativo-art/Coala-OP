/**
 * Contrato do fechamento financeiro mensal (somente leitura nesta etapa).
 * Plano: docs/planos/plano-fechamento-financeiro-mensal.md. Nenhuma escrita acontece aqui:
 * o tratamento de cada pendência é feito na tela de origem (Despesas, faturas, extrato).
 */

export type ClosingTone = "ok" | "warn" | "danger" | "neutral" | "info";

/** `unavailable`: a fonte ainda não está conectada ao fechamento. Nunca equivale a conferido. */
export type ClosingCheckState = "ok" | "pending" | "unavailable";

export type ClosingFlowKey = "expenses" | "sales" | "receipts" | "fees" | "dre";

/** `not_connected`: o fluxo inteiro ainda não foi construído (etapas seguintes do plano). */
export type ClosingFlowState = "ok" | "pending" | "unavailable" | "not_connected";

export type ClosingItemKind =
  | "forecast_without_actual"
  | "draft"
  | "overdue"
  | "awaiting_due_date"
  | "no_due_date"
  | "payment_without_document"
  | "paid_without_bank_link"
  | "payment_reported_only"
  | "payment_divergent"
  | "card_statement_missing"
  | "card_statement_open"
  | "card_statement_awaiting_payment"
  | "card_statement_overdue"
  | "sales_attention"
  | "sales_awaiting_source"
  | "sales_reopened"
  | "sales_not_reviewed"
  | "sales_not_published"
  | "fees_not_ready"
  | "fees_exception"
  | "fees_rate_change"
  | "fees_charge";

export type ClosingCheck = {
  id: string;
  name: string;
  state: ClosingCheckState;
  /** Itens conferidos e total considerado; `null` quando a fonte não está conectada. */
  done: number | null;
  total: number | null;
  /** Explica o estado quando não é evidente (ex.: fonte não conectada). */
  note?: string;
};

export type ClosingItem = {
  /** Estável por origem (ex.: `expense:ID`, `card-statement:ID`). */
  id: string;
  checkId: string;
  kind: ClosingItemKind;
  tone: ClosingTone;
  title: string;
  detail: string;
  /** Data ISO `AAAA-MM-DD` de vencimento quando existir. */
  dueDate: string | null;
  amountCents: number | null;
  /** Rota da tela de origem, já com o filtro que leva ao item. Nunca uma URL externa. */
  href: string;
};

export type ClosingFlow = {
  key: ClosingFlowKey;
  name: string;
  state: ClosingFlowState;
  checks: ClosingCheck[];
  items: ClosingItem[];
  /** Verdadeiro quando o usuário não pode ver os itens (sem permissão de despesas). */
  itemsHidden: boolean;
  /** Maior data de vencimento entre os itens com prazo; `null` se não houver. */
  readyFrom: string | null;
  /** Tela de origem já no mês, para fluxos sem tela própria (Vendas e Taxas). */
  originHref?: string;
};

/** Totais dos títulos reais da competência, sem as compras de cartão (que seguem pela fatura) nem as previsões. */
export type ExpensesTotals = {
  titleCount: number;
  titlesCents: number;
  /** Pagos e conferidos (vinculados ao extrato ou pagos em dinheiro). */
  settledCents: number;
  /** Saldo em aberto que ainda não venceu. */
  openCents: number;
  /** Saldo em aberto já vencido. */
  overdueCents: number;
};

export type MonthClosingPayload = {
  month: string;
  /** Data de hoje no fuso do negócio, `AAAA-MM-DD`. */
  today: string;
  flows: ClosingFlow[];
  expenseTotals: ExpensesTotals | null;
  /** Documentos de despesas lidos; permite à tela avisar de leitura incompleta. */
  limits: { expensesRead: number; expensesLimit: number };
};
