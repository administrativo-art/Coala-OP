import { Timestamp } from "firebase-admin/firestore";

import { financialDbAdmin } from "../src/lib/firebase-financial-admin";

const APPLY = process.argv.includes("--apply");
const STATEMENT_HISTORY_PREFLIGHT_LIMIT = 241;
const statementIdIndex = process.argv.indexOf("--statement-id");
const statementId = statementIdIndex >= 0 ? String(process.argv[statementIdIndex + 1] || "") : "";
if (!statementId) throw new Error("Informe --statement-id.");

type RawRecord = Record<string, any>;
const asRecord = (value: unknown): RawRecord => value && typeof value === "object" && !Array.isArray(value) ? value as RawRecord : {};
const money = (value: unknown) => Math.round((Number(value) || 0) * 100) / 100;

const statementRef = financialDbAdmin.collection("cardStatements").doc(statementId);
const statementSnapshot = await statementRef.get();
if (!statementSnapshot.exists) throw new Error("Fatura não encontrada.");
const statement = statementSnapshot.data() ?? {};
if (!/^\d{4}-\d{2}$/.test(String(statement.monthKey || ""))) throw new Error("A competência da fatura é inválida.");
if (!statement.dueDate?.toDate?.() || !statement.closingDate?.toDate?.()) {
  throw new Error("A fatura não possui vencimento e fechamento históricos válidos.");
}
const allocations = (Array.isArray(statement.allocations) ? statement.allocations : []).map(asRecord);
const allocationTotal = money(allocations.reduce((total, allocation) => total + Number(allocation.amount || 0), 0));
const officialTotal = money(statement.officialTotal);
if (allocations.length === 0) throw new Error("A fatura não possui alocações oficiais.");
if (Math.abs(allocationTotal - officialTotal) > 0.05) throw new Error("As alocações não correspondem ao total oficial.");

const lineIds = allocations.map((allocation) => String(allocation.lineId || "")).filter(Boolean);
if (new Set(lineIds).size !== lineIds.length) throw new Error("A fatura possui lineId duplicado.");
const fingerprints = allocations.map((allocation) => String(allocation.importFingerprint || "")).filter(Boolean);
if (new Set(fingerprints).size !== fingerprints.length) throw new Error("A fatura possui fingerprint duplicado.");

const expenseIds = [...new Set(allocations.map((allocation) => String(allocation.expenseId || "")).filter(Boolean))];
const expenseSnapshots = await financialDbAdmin.getAll(...expenseIds.map((id) => financialDbAdmin.collection("expenses").doc(id)));
const missingExpenses = expenseSnapshots.filter((snapshot) => !snapshot.exists).map((snapshot) => snapshot.id);
if (missingExpenses.length > 0) throw new Error(`Há ${missingExpenses.length} despesa(s) inexistente(s) nas alocações.`);

const accountSnapshot = await financialDbAdmin.collection("bankAccounts").doc(String(statement.accountId || "")).get();
const paymentMethod = (Array.isArray(accountSnapshot.get("paymentMethods")) ? accountSnapshot.get("paymentMethods") : [])
  .find((method: RawRecord) => method.id === statement.paymentMethodId) ?? null;
if (!paymentMethod) throw new Error("O cartão da fatura não foi encontrado na conta bancária configurada.");
const otherStatements = await financialDbAdmin.collection("cardStatements")
  .where("accountId", "==", statement.accountId)
  .where("paymentMethodId", "==", statement.paymentMethodId)
  .limit(STATEMENT_HISTORY_PREFLIGHT_LIMIT)
  .get();
if (otherStatements.size >= STATEMENT_HISTORY_PREFLIGHT_LIMIT) {
  throw new Error("O histórico do cartão excedeu o limite seguro desta migração.");
}
const duplicatedAcrossStatements: Array<{ lineId: string; statementId: string }> = [];
const currentLineIds = new Set(lineIds);
const currentFingerprints = new Set(fingerprints);
otherStatements.docs.forEach((document) => {
  if (document.id === statementId) return;
  (Array.isArray(document.get("allocations")) ? document.get("allocations") : []).map(asRecord).forEach((allocation: RawRecord) => {
    if (currentLineIds.has(String(allocation.lineId || ""))) {
      duplicatedAcrossStatements.push({ lineId: String(allocation.lineId), statementId: document.id });
    }
    if (currentFingerprints.has(String(allocation.importFingerprint || ""))) {
      duplicatedAcrossStatements.push({ lineId: `fingerprint:${String(allocation.importFingerprint)}`, statementId: document.id });
    }
  });
});
if (duplicatedAcrossStatements.length > 0) throw new Error("Há parcelas vinculadas simultaneamente a mais de uma fatura.");

const allocationsByExpense = new Map<string, RawRecord[]>();
allocations.forEach((allocation) => {
  const expenseId = String(allocation.expenseId || "");
  allocationsByExpense.set(expenseId, [...(allocationsByExpense.get(expenseId) || []), allocation]);
});
const plan = expenseSnapshots.map((snapshot) => {
  const expense = snapshot.data() ?? {};
  const expenseAllocations = allocationsByExpense.get(snapshot.id) || [];
  const installments = Array.isArray(expense.installments) ? expense.installments.map(asRecord) : [];
  const installmentNumbers = expenseAllocations
    .map((allocation) => Number(allocation.installmentNumber) || null)
    .filter((value): value is number => Boolean(value));
  const patchedInstallments = installments.map((installment, index) => {
    const number = Number(installment.number) || index + 1;
    const allocation = expenseAllocations.find((candidate) => Number(candidate.installmentNumber) === number);
    if (!allocation) {
      if (
        installment.cardStatementRevisionStatus === "projected"
        && !installment.cardStatementImportFingerprint
      ) {
        const {
          competenceDate: _competenceDate,
          cardStatementId: _cardStatementId,
          cardStatementKey: _cardStatementKey,
          cardStatementMonthKey: _cardStatementMonthKey,
          cardStatementImportFingerprint: _cardStatementImportFingerprint,
          cardStatementRevisionStatus: _cardStatementRevisionStatus,
          ...projectedInstallment
        } = installment;
        return projectedInstallment;
      }
      return installment;
    }
    return {
      ...installment,
      dueDate: statement.dueDate,
      competenceDate: Timestamp.fromDate(new Date(`${statement.monthKey}-01T12:00:00-03:00`)),
      cardStatementId: statementId,
      cardStatementKey: statement.key,
      cardStatementMonthKey: statement.monthKey,
      cardStatementImportFingerprint: allocation.importFingerprint || installment.cardStatementImportFingerprint || null,
      cardReconciliationStatus: installment.cardReconciliationStatus || expense.cardReconciliationStatus || "pending",
      cardStatementRevisionStatus: "active",
    };
  });
  return {
    id: snapshot.id,
    description: expense.description,
    installmentNumbers,
    patch: {
      cardStatementId: statementId,
      cardStatementKey: statement.key,
      cardStatementMonthKey: statement.monthKey,
      ...(patchedInstallments.length > 0 ? { installments: patchedInstallments } : {}),
      cardStatementHistoryReconciledAt: Timestamp.now(),
      cardStatementHistoryReconciledBy: "migration:reconcile-card-statement-history",
      updatedAt: Timestamp.now(),
    },
  };
});

console.log(JSON.stringify({
  mode: APPLY ? "apply" : "dry-run",
  statement: {
    id: statementId,
    key: statement.key,
    monthKey: statement.monthKey,
    closingDate: statement.closingDate?.toDate?.().toISOString?.() || null,
    dueDate: statement.dueDate?.toDate?.().toISOString?.() || null,
    officialTotal,
    allocationCount: allocations.length,
    allocationTotal,
  },
  cardConfiguration: paymentMethod ? {
    accountId: statement.accountId,
    paymentMethodId: statement.paymentMethodId,
    closingDay: paymentMethod.closingDay,
    dueDay: paymentMethod.dueDay,
  } : null,
  expenseCount: plan.length,
  installmentAssignments: plan.filter((item) => item.installmentNumbers.length > 0)
    .map(({ id, description, installmentNumbers }) => ({ id, description, installmentNumbers })),
}, null, 2));

if (!APPLY) process.exit(0);

await financialDbAdmin.runTransaction(async (transaction) => {
  const [freshStatement, ...freshExpenses] = await Promise.all([
    transaction.get(statementRef),
    ...plan.map((item) => transaction.get(financialDbAdmin.collection("expenses").doc(item.id))),
  ]);
  if (!freshStatement.exists || money(freshStatement.get("officialTotal")) !== officialTotal) {
    throw new Error("A fatura mudou depois do preflight.");
  }
  if (freshExpenses.some((snapshot) => !snapshot.exists)) throw new Error("Uma despesa mudou depois do preflight.");
  plan.forEach((item) => transaction.set(
    financialDbAdmin.collection("expenses").doc(item.id),
    item.patch,
    { merge: true },
  ));
  transaction.set(statementRef, {
    allocationIntegrityStatus: "verified",
    allocationIntegrityCount: allocations.length,
    allocationIntegrityTotal: allocationTotal,
    allocationIntegrityVerifiedAt: Timestamp.now(),
    allocationIntegrityVerifiedBy: "migration:reconcile-card-statement-history",
    updatedAt: Timestamp.now(),
  }, { merge: true });
});

const verifiedStatement = await statementRef.get();
const verifiedAllocations = (Array.isArray(verifiedStatement.get("allocations")) ? verifiedStatement.get("allocations") : []).map(asRecord);
const verifiedTotal = money(verifiedAllocations.reduce((total: number, allocation: RawRecord) => total + Number(allocation.amount || 0), 0));
if (verifiedAllocations.length !== allocations.length || verifiedTotal !== officialTotal) {
  throw new Error("A verificação pós-escrita da fatura falhou.");
}
console.log(JSON.stringify({ applied: plan.length, allocationCount: verifiedAllocations.length, officialTotal, allocationTotal: verifiedTotal }, null, 2));
