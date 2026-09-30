import { existsSync, readFileSync } from "node:fs";
import { applicationDefault, cert, getApps, initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore, Timestamp } from "firebase-admin/firestore";

const PROJECT_ID = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "smart-converter-752gf";
const DATABASE_ID = process.env.NEXT_PUBLIC_FIREBASE_FINANCIAL_DATABASE_ID || "coala-financeiro";
const BACKUP_ID = "fix-card-statement-competence-20260930-v1";
const APPLY = process.argv.includes("--apply");
const ROLLBACK = process.argv.includes("--rollback");

if (APPLY && ROLLBACK) throw new Error("Use apenas --apply ou --rollback.");

function credential() {
  if (process.env.FIREBASE_SERVICE_ACCOUNT) return cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT));
  const path = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
  if (path && existsSync(path)) return cert(JSON.parse(readFileSync(path, "utf8")));
  return applicationDefault();
}

const app = getApps().find((candidate) => candidate.name === "card-statement-competence-migration")
  ?? initializeApp({ credential: credential(), projectId: PROJECT_ID }, "card-statement-competence-migration");
const db = getFirestore(app, DATABASE_ID);
const backupRef = db.collection("system_migration_backups").doc(BACKUP_ID);

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function positiveDay(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 31 ? parsed : fallback;
}

function dateKey(value) {
  const date = value instanceof Timestamp
    ? value.toDate()
    : value && typeof value.toDate === "function"
      ? value.toDate()
      : value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Belem",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function shiftMonth(monthKey, offset) {
  const match = /^(\d{4})-(\d{2})$/.exec(monthKey);
  if (!match) throw new Error(`Mês inválido: ${monthKey}.`);
  const value = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1 + offset, 1));
  return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, "0")}`;
}

function statementDocumentId(key) {
  return key.replaceAll(":", "__").replace(/[^a-zA-Z0-9_-]/g, "_");
}

function hasLockedEvidence(value) {
  return Boolean(
    text(value?.cardStatementImportFingerprint)
      || value?.cardReconciliationStatus === "reconciled"
      || value?.cardStatementRevisionStatus === "removed"
      || value?.cardStatementAuditDisposition === "waived_before_dre_start",
  );
}

function migratedIdentity(value, expense, card, officialStatementKeys) {
  const monthKey = text(value?.cardStatementMonthKey) || text(value?.cardStatementKey).split(":").at(-1) || "";
  const due = dateKey(value?.dueDate);
  if (!/^\d{4}-\d{2}$/.test(monthKey) || !due) return null;
  const dueMonth = due.slice(0, 7);
  if (dueMonth !== monthKey) return null;
  const currentKey = text(value?.cardStatementKey)
    || `${expense.plannedBankAccountId}:${expense.plannedPaymentMethodId}:${monthKey}`;
  if (officialStatementKeys.has(currentKey) || officialStatementKeys.has(text(value?.cardStatementId))) return null;
  if (hasLockedEvidence(value) || hasLockedEvidence(expense)) return null;

  const offset = positiveDay(card.dueDay, 5) <= positiveDay(card.closingDay, 25) ? -2 : -1;
  const competenceMonth = shiftMonth(dueMonth, offset);
  const key = `${expense.plannedBankAccountId}:${expense.plannedPaymentMethodId}:${competenceMonth}`;
  return {
    ...value,
    cardStatementId: statementDocumentId(key),
    cardStatementKey: key,
    cardStatementMonthKey: competenceMonth,
  };
}

async function context() {
  const [expenseSnapshot, statementSnapshot, accountSnapshot] = await Promise.all([
    db.collection("expenses").get(),
    db.collection("cardStatements").get(),
    db.collection("bankAccounts").get(),
  ]);
  const cards = new Map(accountSnapshot.docs.flatMap((accountDocument) => {
    const account = accountDocument.data();
    return (Array.isArray(account.paymentMethods) ? account.paymentMethods : [])
      .filter((method) => method.type === "credit_card")
      .map((method) => [`${accountDocument.id}:${method.id}`, method]);
  }));
  const officialStatementKeys = new Set(statementSnapshot.docs.flatMap((statementDocument) => {
    const statement = statementDocument.data();
    const hasComposition = Array.isArray(statement.allocations) && statement.allocations.length > 0;
    return hasComposition ? [statementDocument.id, text(statement.key)].filter(Boolean) : [];
  }));
  const changes = [];

  expenseSnapshot.docs.forEach((document) => {
    const expense = document.data();
    if (expense.plannedPaymentMethodType !== "credit_card") return;
    const card = cards.get(`${expense.plannedBankAccountId}:${expense.plannedPaymentMethodId}`);
    if (!card) return;
    const installments = Array.isArray(expense.installments) ? expense.installments : [];
    const nextInstallments = installments.map((installment) => (
      migratedIdentity(installment, expense, card, officialStatementKeys) ?? installment
    ));
    const changedInstallments = nextInstallments.some((installment, index) => (
      text(installment.cardStatementKey) !== text(installments[index]?.cardStatementKey)
    ));
    const topLevel = migratedIdentity(expense, expense, card, officialStatementKeys);
    const firstInstallment = nextInstallments[0];
    const patch = {
      ...(changedInstallments ? { installments: nextInstallments } : {}),
      ...(topLevel ? {
        cardStatementId: topLevel.cardStatementId,
        cardStatementKey: topLevel.cardStatementKey,
        cardStatementMonthKey: topLevel.cardStatementMonthKey,
      } : changedInstallments && firstInstallment ? {
        cardStatementId: firstInstallment.cardStatementId,
        cardStatementKey: firstInstallment.cardStatementKey,
        cardStatementMonthKey: firstInstallment.cardStatementMonthKey,
      } : {}),
    };
    if (Object.keys(patch).length === 0) return;
    changes.push({
      ref: document.ref,
      before: expense,
      patch,
      summary: {
        description: expense.description || null,
        previousMonth: text(expense.cardStatementMonthKey),
        nextMonth: text(patch.cardStatementMonthKey),
        installmentMonths: nextInstallments.map((installment) => text(installment.cardStatementMonthKey)),
      },
    });
  });
  return { changes, expenseCount: expenseSnapshot.size, statementCount: statementSnapshot.size };
}

async function restore() {
  const backup = await backupRef.get();
  if (!backup.exists) throw new Error(`Backup ${BACKUP_ID} não encontrado.`);
  const documents = await backupRef.collection("documents").get();
  const batch = db.batch();
  documents.docs.forEach((document) => {
    const record = document.data();
    batch.set(db.doc(record.path), record.data, { merge: false });
  });
  await batch.commit();
  await backupRef.set({ status: "rolled_back", rolledBackAt: FieldValue.serverTimestamp() }, { merge: true });
  console.log(JSON.stringify({ mode: "rollback", restored: documents.size, backup: BACKUP_ID }, null, 2));
}

if (ROLLBACK) {
  await restore();
  process.exit(0);
}

const result = await context();
console.log(JSON.stringify({
  mode: APPLY ? "apply" : "dry-run",
  expensesRead: result.expenseCount,
  statementsRead: result.statementCount,
  documentsToUpdate: result.changes.length,
  changes: result.changes.map((change) => change.summary),
}, null, 2));

if (!APPLY) {
  console.log("Dry-run concluído. Nenhum dado foi alterado. Rode novamente com --apply para aplicar.");
  process.exit(0);
}

if ((await backupRef.get()).exists) throw new Error(`Backup ${BACKUP_ID} já existe; aplicação duplicada bloqueada.`);
const backupBatch = db.batch();
backupBatch.create(backupRef, {
  status: "prepared",
  reason: "Corrige identidades de fatura criadas com mês de vencimento no lugar da competência.",
  recordCount: result.changes.length,
  createdAt: FieldValue.serverTimestamp(),
});
result.changes.forEach((change) => {
  backupBatch.create(backupRef.collection("documents").doc(change.ref.id), {
    path: change.ref.path,
    data: change.before,
  });
});
await backupBatch.commit();

try {
  const updateBatch = db.batch();
  result.changes.forEach((change) => updateBatch.update(change.ref, {
    ...change.patch,
    cardStatementCompetenceMigratedAt: FieldValue.serverTimestamp(),
    cardStatementCompetenceMigratedBy: `migration:${BACKUP_ID}`,
  }));
  await updateBatch.commit();
  const verification = await context();
  if (verification.changes.length > 0) {
    throw new Error(`${verification.changes.length} documento(s) ainda exigem correção.`);
  }
  await backupRef.set({ status: "applied", appliedAt: FieldValue.serverTimestamp() }, { merge: true });
  console.log(JSON.stringify({ mode: "apply", updated: result.changes.length, verified: true, backup: BACKUP_ID }, null, 2));
} catch (error) {
  await restore();
  throw new Error(`Migração falhou e foi revertida: ${error instanceof Error ? error.message : String(error)}`);
}
