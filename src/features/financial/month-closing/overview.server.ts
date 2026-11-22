import { FieldPath, Filter } from "firebase-admin/firestore";

import { FINANCIAL_INSTALLMENT_PAYMENT_METHOD } from "@/features/financial/lib/expense-accounting-contract";
import {
  ExpenseReconciliationLimitError,
  readExpenseReconciliationEvidence,
} from "@/features/financial/obligations/expense-reconciliation.server";
import { financialDbAdmin } from "@/lib/firebase-financial-admin";

import { readCardPixFlow } from "./card-pix.server";
import { readCashFlow } from "./cash.server";
import { evaluateExpensesFlow, expensesForCompetence, type ClosingCardStatementInput, type ClosingExpenseInput } from "./expenses-flow";
import { todayKey } from "./month";
import { notConnectedFlows } from "./other-flows";
import { readSalesAndFeesFlows } from "./sales-fees.server";
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
 * Despesas, faturas e evidências vinculadas têm limites de leitura próprios.
 */
export async function getMonthClosingOverview(input: {
  month: string;
  workspaceId: string;
  canViewExpenseItems: boolean;
  canViewStoneItems: boolean;
  now?: Date;
}): Promise<MonthClosingPayload> {
  const [expenseDocuments, statementDocuments, stone, cardPix, cash] = await Promise.all([
    listExpenses(input.month),
    listCardStatements(input.month),
    readSalesAndFeesFlows({ workspaceId: input.workspaceId, month: input.month, canViewItems: input.canViewStoneItems, now: input.now }),
    readCardPixFlow({ workspaceId: input.workspaceId, month: input.month, canViewItems: input.canViewStoneItems, now: input.now }),
    readCashFlow({ workspaceId: input.workspaceId, month: input.month, canViewItems: input.canViewStoneItems, now: input.now }),
  ]);
  const today = todayKey(input.now);
  const expenses = expenseDocuments.map((document) => {
    const data = document.data();
    return { ...data, id: document.id, workspaceId: data.workspaceId || input.workspaceId } as ClosingExpenseInput;
  });
  const cardStatements = statementDocuments.map((document) => ({ ...document.data(), id: document.id }) as ClosingCardStatementInput);
  const candidates = expensesForCompetence({ month: input.month, expenses, cardStatements });
  const bankTransactions = await readExpenseReconciliationEvidence(candidates, input.workspaceId).catch((error) => {
    if (error instanceof ExpenseReconciliationLimitError) throw new MonthClosingLimitError("expenses");
    throw error;
  });
  const { flow, totals } = evaluateExpensesFlow({
    month: input.month,
    today,
    canViewItems: input.canViewExpenseItems,
    expenses,
    bankTransactions,
    cardStatements,
  });
  return {
    month: input.month,
    today,
    flows: [flow, stone.sales, cardPix, cash, stone.fees, ...notConnectedFlows(["dre"])],
    expenseTotals: input.canViewExpenseItems ? totals : null,
    limits: { expensesRead: expenseDocuments.length, expensesLimit: MONTH_CLOSING_MAX_EXPENSES },
  };
}
