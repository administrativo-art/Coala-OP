import { Filter } from "firebase-admin/firestore";

import { financialDbAdmin } from "@/lib/firebase-financial-admin";
import {
  expenseLinkedBankIds,
  expenseNeedsImportedBankEvidence,
  indexExpenseBankTransactions,
  type ExpenseBankTransaction,
  type ExpenseReconciliationSource,
} from "./expense-reconciliation";

const QUERY_BATCH_SIZE = 10;
const MAX_TRANSACTION_DOCUMENTS = 1500;
const TRANSACTION_FIELDS = [
  "amount", "type", "direction", "auditStatus", "reversed", "effectuationStatus", "importedFrom",
  "importSource", "workspaceId", "expenseId", "linkedExpenseId", "expenseIds", "obligationAllocations",
] as const;

export class ExpenseReconciliationLimitError extends Error {
  constructor() {
    super("Limite de evidências do extrato excedido.");
  }
}

/** Busca pontual por vínculos persistidos. Chamadores expõem somente o resultado da conciliação. */
export async function readExpenseReconciliationEvidence(expenses: ExpenseReconciliationSource[], workspaceId: string) {
  const candidates = expenses.filter((expense) => (
    (!expense.workspaceId || expense.workspaceId === workspaceId) && expenseNeedsImportedBankEvidence(expense)
  ));
  const collection = financialDbAdmin.collection("transactions");
  const linkedIds = [...new Set(candidates.flatMap(expenseLinkedBankIds))].filter((id) => !id.includes("/"));
  if (linkedIds.length > MAX_TRANSACTION_DOCUMENTS) throw new ExpenseReconciliationLimitError();
  const transactions: ExpenseBankTransaction[] = [];
  const usable = (document: FirebaseFirestore.DocumentSnapshot) => (
    document.exists && (!document.get("workspaceId") || document.get("workspaceId") === workspaceId)
  );
  for (let start = 0; start < linkedIds.length; start += 250) {
    const refs = linkedIds.slice(start, start + 250).map((id) => collection.doc(id));
    const snapshots = await financialDbAdmin.getAll(...refs, { fieldMask: [...TRANSACTION_FIELDS] });
    transactions.push(...snapshots.filter(usable).map((doc) => ({ ...doc.data(), id: doc.id })));
  }

  let readCount = linkedIds.length;
  const reverseLinkIds = candidates.filter((expense) => expense.reconciliationInstallmentNumber === undefined)
    .map((expense) => expense.id);
  for (let start = 0; start < reverseLinkIds.length; start += QUERY_BATCH_SIZE) {
    const ids = reverseLinkIds.slice(start, start + QUERY_BATCH_SIZE);
    const limit = Math.min(ids.length * 4, MAX_TRANSACTION_DOCUMENTS - readCount);
    const snapshot = await collection.where(Filter.or(
      Filter.where("expenseId", "in", ids),
      Filter.where("linkedExpenseId", "in", ids),
      Filter.where("expenseIds", "array-contains-any", ids),
    )).select(...TRANSACTION_FIELDS).limit(limit + 1).get();
    if (snapshot.size > limit) throw new ExpenseReconciliationLimitError();
    readCount += snapshot.size;
    transactions.push(...snapshot.docs.filter(usable).map((doc) => ({ ...doc.data(), id: doc.id })));
  }
  return indexExpenseBankTransactions(transactions);
}
