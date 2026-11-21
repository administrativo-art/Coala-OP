import { FieldPath, Filter } from "firebase-admin/firestore";

import { FINANCIAL_INSTALLMENT_PAYMENT_METHOD } from "@/features/financial/lib/expense-accounting-contract";
import { financialDbAdmin } from "@/lib/firebase-financial-admin";

import { evaluateExpensesFlow, type ClosingCardStatementInput, type ClosingExpenseInput } from "./expenses-flow";
import { todayKey } from "./month";
import { notConnectedFlows } from "./other-flows";
import type { MonthClosingPayload } from "./types";

const EXPENSE_PAGE_SIZE = 250;
/** Mesmo teto de ordem de grandeza da DRE; acima disso a consulta é recusada em vez de truncada em silêncio. */
export const MONTH_CLOSING_MAX_EXPENSES = 1500;
const MAX_CARD_STATEMENTS = 60;

export class MonthClosingLimitError extends Error {
  constructor(readonly reason: "expenses" | "card-statements") {
    super(`Limite do fechamento mensal excedido: ${reason}.`);
    this.name = "MonthClosingLimitError";
  }
}

async function listExpenses(month: string) {
  const documents: FirebaseFirestore.QueryDocumentSnapshot[] = [];
  let cursor: string | null = null;
  while (documents.length <= MONTH_CLOSING_MAX_EXPENSES) {
    const remaining = MONTH_CLOSING_MAX_EXPENSES + 1 - documents.length;
    const pageSize = Math.min(EXPENSE_PAGE_SIZE, remaining);
    let query: FirebaseFirestore.Query = financialDbAdmin.collection("expenses")
      .where(Filter.or(
        Filter.where("competenceMonth", "==", month),
        // O lançamento pode ter parcelas no mês mesmo quando o título pertence a outra competência.
        Filter.where("paymentMethod", "==", FINANCIAL_INSTALLMENT_PAYMENT_METHOD),
      ))
      .orderBy(FieldPath.documentId())
      .limit(pageSize);
    if (cursor) query = query.startAfter(cursor);
    const snapshot = await query.get();
    documents.push(...snapshot.docs);
    if (snapshot.size < pageSize) break;
    cursor = snapshot.docs.at(-1)?.id ?? null;
    if (!cursor) break;
  }
  if (documents.length > MONTH_CLOSING_MAX_EXPENSES) throw new MonthClosingLimitError("expenses");
  return documents;
}

async function listCardStatements(month: string) {
  const snapshot = await financialDbAdmin.collection("cardStatements")
    .where("monthKey", "==", month)
    .limit(MAX_CARD_STATEMENTS + 1)
    .get();
  if (snapshot.size > MAX_CARD_STATEMENTS) throw new MonthClosingLimitError("card-statements");
  return snapshot.docs;
}

/**
 * Leitura do fechamento de uma competência. Somente leitura: não cria, corrige nem baixa nada.
 * Custo por chamada: até 1.500 leituras de despesas + até 60 de faturas (tipicamente poucas centenas).
 */
export async function getMonthClosingOverview(input: {
  month: string;
  canViewExpenseItems: boolean;
  now?: Date;
}): Promise<MonthClosingPayload> {
  const [expenseDocuments, statementDocuments] = await Promise.all([
    listExpenses(input.month),
    listCardStatements(input.month),
  ]);
  const today = todayKey(input.now);
  const { flow, totals } = evaluateExpensesFlow({
    month: input.month,
    today,
    canViewItems: input.canViewExpenseItems,
    expenses: expenseDocuments.map((document) => ({ ...document.data(), id: document.id }) as ClosingExpenseInput),
    cardStatements: statementDocuments.map((document) => ({ ...document.data(), id: document.id }) as ClosingCardStatementInput),
  });
  return {
    month: input.month,
    today,
    flows: [flow, ...notConnectedFlows()],
    expenseTotals: input.canViewExpenseItems ? totals : null,
    limits: { expensesRead: expenseDocuments.length, expensesLimit: MONTH_CLOSING_MAX_EXPENSES },
  };
}
