import { existsSync, readFileSync } from "node:fs";
import { applicationDefault, cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "smart-converter-752gf";
const FINANCIAL_DATABASE = process.env.FINANCIAL_FIRESTORE_DATABASE || "coala-financeiro";
const MAIN_DATABASE = process.env.MAIN_FIRESTORE_DATABASE || "coala";
const CUTOFF_ISO = process.env.FINANCIAL_CUTOVER_DATE || "2026-08-01T00:00:00-03:00";
const cutoff = new Date(CUTOFF_ISO);

function loadCredential() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (raw) return cert(JSON.parse(raw));

  const path = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
  if (path && existsSync(path)) return cert(JSON.parse(readFileSync(path, "utf8")));

  return applicationDefault();
}

function getApp() {
  return getApps().find((item) => item.name === "financial-cutover-audit") ??
    initializeApp({ credential: loadCredential(), projectId: PROJECT_ID }, "financial-cutover-audit");
}

function asDate(value) {
  if (!value) return null;
  if (typeof value.toDate === "function") return value.toDate();
  if (value instanceof Date) return value;
  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
}

function increment(target, key) {
  const normalized = String(key ?? "(ausente)");
  target[normalized] = (target[normalized] || 0) + 1;
}

function summarizeDates(rows, fields) {
  const result = {};
  for (const field of fields) {
    let beforeCutoff = 0;
    let fromCutoff = 0;
    let missing = 0;
    let minimum = null;
    let maximum = null;

    for (const row of rows) {
      const date = asDate(row[field]);
      if (!date) {
        missing++;
        continue;
      }
      if (date < cutoff) beforeCutoff++;
      else fromCutoff++;
      if (!minimum || date < minimum) minimum = date;
      if (!maximum || date > maximum) maximum = date;
    }

    result[field] = {
      beforeCutoff,
      fromCutoff,
      missing,
      minimum: minimum?.toISOString() ?? null,
      maximum: maximum?.toISOString() ?? null,
    };
  }
  return result;
}

function sumCents(rows, field) {
  return rows.reduce((total, row) => {
    const value = Number(row[field]);
    return Number.isFinite(value) ? total + Math.round(value * 100) : total;
  }, 0);
}

function summarizeRows(rows, options = {}) {
  const statuses = {};
  const origins = {};
  for (const row of rows) {
    increment(statuses, row.status);
    if (options.originField) increment(origins, row[options.originField]);
  }

  return {
    count: rows.length,
    statuses,
    ...(options.originField ? { origins } : {}),
    dates: summarizeDates(rows, options.dateFields || []),
  };
}

async function loadCollection(db, name) {
  const snapshot = await db.collection(name).get();
  return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
}

async function summarizeSubcollections(db, name, rows) {
  const documentsWithSubcollections = [];
  let subcollectionCount = 0;
  for (const row of rows) {
    const subcollections = await db.collection(name).doc(row.id).listCollections();
    if (subcollections.length === 0) continue;
    subcollectionCount += subcollections.length;
    documentsWithSubcollections.push({ id: row.id, collections: subcollections.map((item) => item.id) });
  }
  return { subcollectionCount, documentsWithSubcollections };
}

async function main() {
  if (Number.isNaN(cutoff.getTime())) throw new Error(`Data de corte inválida: ${CUTOFF_ISO}`);

  const app = getApp();
  const financialDb = getFirestore(app, FINANCIAL_DATABASE);
  const mainDb = getFirestore(app, MAIN_DATABASE);

  const collectionRefs = await financialDb.listCollections();
  const collectionCounts = {};
  for (const ref of collectionRefs) {
    const aggregate = await ref.count().get();
    collectionCounts[ref.id] = aggregate.data().count;
  }

  const [expenses, payments, transactions, importDrafts, bankPaymentRequests, purchaseOrders, purchaseFinancials] =
    await Promise.all([
      loadCollection(financialDb, "expenses"),
      loadCollection(financialDb, "payments"),
      loadCollection(financialDb, "transactions"),
      loadCollection(financialDb, "importDrafts"),
      loadCollection(financialDb, "bankPaymentRequests"),
      loadCollection(mainDb, "purchase_orders"),
      loadCollection(mainDb, "purchase_financials"),
    ]);

  const expenseIds = new Set(expenses.map((row) => row.id));
  const linkedOrderRows = purchaseOrders.filter((row) => typeof row.linkedExpenseId === "string" && row.linkedExpenseId);
  const linkedFinancialRows = purchaseFinancials.filter((row) => typeof row.linkedExpenseId === "string" && row.linkedExpenseId);
  const expensesLinkedByOrigin = expenses.filter((row) => typeof row.purchaseOrderId === "string" && row.purchaseOrderId);

  const paidExpenses = expenses.filter((row) => row.status === "paid");
  const openExpenses = expenses.filter((row) => row.status === "pending");
  const paidBeforeCutoff = paidExpenses.filter((row) => {
    const date = asDate(row.paidAt) || asDate(row.paymentDate) || asDate(row.dueDate);
    return date && date < cutoff;
  });
  const paidDateMissing = paidExpenses.filter(
    (row) => !asDate(row.paidAt) && !asDate(row.paymentDate) && !asDate(row.dueDate),
  );
  const openDueBeforeCutoff = openExpenses.filter((row) => {
    const date = asDate(row.dueDate);
    return date && date < cutoff;
  });
  const dueFromCutoff = expenses.filter((row) => {
    const date = asDate(row.dueDate);
    return date && date >= cutoff;
  });
  const dueFromCutoffByOrigin = {};
  const dueBeforeCutoffByOrigin = {};
  for (const row of expenses) {
    const date = asDate(row.dueDate);
    if (!date) continue;
    increment(date >= cutoff ? dueFromCutoffByOrigin : dueBeforeCutoffByOrigin, row.originModule);
  }
  const [expenseSubcollections, importDraftSubcollections] = await Promise.all([
    summarizeSubcollections(financialDb, "expenses", expenses),
    summarizeSubcollections(financialDb, "importDrafts", importDrafts),
  ]);

  const report = {
    generatedAt: new Date().toISOString(),
    projectId: PROJECT_ID,
    financialDatabase: FINANCIAL_DATABASE,
    cutoff: cutoff.toISOString(),
    collectionCounts,
    expenses: {
      ...summarizeRows(expenses, {
        originField: "originModule",
        dateFields: ["createdAt", "competenceDate", "dueDate", "paidAt", "updatedAt"],
      }),
      totalValueCents: sumCents(expenses, "totalValue"),
      paidBeforeCutoff: paidBeforeCutoff.length,
      paidBeforeCutoffValueCents: sumCents(paidBeforeCutoff, "totalValue"),
      paidDateMissing: paidDateMissing.length,
      openDueBeforeCutoff: openDueBeforeCutoff.length,
      openDueBeforeCutoffValueCents: sumCents(openDueBeforeCutoff, "totalValue"),
      dueFromCutoff: dueFromCutoff.length,
      dueFromCutoffValueCents: sumCents(dueFromCutoff, "totalValue"),
      dueBeforeCutoffByOrigin,
      dueFromCutoffByOrigin,
      linkedByPurchaseOrderId: expensesLinkedByOrigin.length,
      subcollections: expenseSubcollections,
    },
    payments: summarizeRows(payments, {
      dateFields: ["createdAt", "paymentDate", "paidAt", "date", "updatedAt"],
    }),
    transactions: summarizeRows(transactions, {
      dateFields: ["createdAt", "date", "transactionDate", "competenceDate", "updatedAt"],
    }),
    importDrafts: summarizeRows(importDrafts, {
      dateFields: ["createdAt", "statementStartDate", "statementEndDate", "updatedAt"],
    }),
    importDraftSubcollections,
    bankPaymentRequests: summarizeRows(bankPaymentRequests, {
      dateFields: ["createdAt", "paidAt", "scheduledFor", "updatedAt"],
    }),
    purchasingLinks: {
      purchaseOrders: purchaseOrders.length,
      purchaseFinancials: purchaseFinancials.length,
      ordersWithLinkedExpenseId: linkedOrderRows.length,
      purchaseFinancialsWithLinkedExpenseId: linkedFinancialRows.length,
      brokenOrderLinkedExpenseIds: linkedOrderRows.filter((row) => !expenseIds.has(row.linkedExpenseId)).length,
      brokenPurchaseFinancialLinkedExpenseIds: linkedFinancialRows.filter((row) => !expenseIds.has(row.linkedExpenseId)).length,
      brokenOrders: linkedOrderRows
        .filter((row) => !expenseIds.has(row.linkedExpenseId))
        .map((row) => ({
          id: row.id,
          status: row.status ?? null,
          linkedExpenseId: row.linkedExpenseId,
          createdAt: asDate(row.createdAt)?.toISOString() ?? row.createdAt ?? null,
          paymentDueDate: asDate(row.paymentDueDate)?.toISOString() ?? row.paymentDueDate ?? null,
        })),
      activePurchaseExpensesFromCutoff: dueFromCutoff
        .filter((row) => row.originModule === "purchasing")
        .map((row) => ({
          id: row.id,
          purchaseOrderId: row.purchaseOrderId ?? null,
          status: row.status ?? null,
          dueDate: asDate(row.dueDate)?.toISOString() ?? null,
          competenceDate: asDate(row.competenceDate)?.toISOString() ?? null,
        })),
    },
  };

  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error("[financial-cutover-audit] falhou", error);
  process.exitCode = 1;
});
