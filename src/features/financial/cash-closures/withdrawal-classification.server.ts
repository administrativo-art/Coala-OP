import "server-only";
import { randomUUID } from "node:crypto";
import { FieldPath, FieldValue, Timestamp, type Transaction } from "firebase-admin/firestore";
import type { ServerUserContext } from "@/lib/auth-server";
import { financialDbAdmin as db } from "@/lib/firebase-financial-admin";
import { WORKSPACE_ID } from "@/lib/workspace";
import { financialExpenseAccountingFields } from "../lib/expense-accounting-contract";
import { sourceSettlementSummary } from "../lib/source-settlement";
import { FINANCIAL_COLLECTIONS } from "../lib/constants";
import { canUseCashClosure } from "./access.server";
import { canEditCashClosure } from "./state-machine";
import type { CashClosure, CashClosureLine, CashClosureOperator } from "./types";
import {
  MAX_WITHDRAWALS, assertEligibleWithdrawalExpense, assertWithdrawalSourceIntegrity,
  changeReturnIsProven, preLinkedChangeCents, sourceExpenseGuard, withdrawalClassificationSchema, withdrawalDocumentIdSchema,
  withdrawalFailure, withdrawalSources,
  type WithdrawalClassification, type WithdrawalSource,
} from "./withdrawal-classification";

const COLLECTION = FINANCIAL_COLLECTIONS.sourceSettlements;
export const LOCAL_PURCHASE_WITHDRAWAL_LINKS = "localPurchaseWithdrawalLinks";
const EXPENSE_POSITIONS = new Set(["impostos_deducoes", "custos_variaveis", "pessoal", "despesas_operacionais", "ocupacao", "despesas_financeiras", "despesa_nao_operacional", "impostos_resultado"]);
const MUTATED_FIELDS = ["workspaceId", "installments", "status", "paidAt", "paymentState", "settlementSummary", "plannedPaymentMethodType", "plannedPaymentMethodLabel", "sourceSettlement"];
type Raw = Record<string, any>;
const closureRef = (id: string) => db.collection("cashClosures").doc(id);
const claimRef = (id: string) => db.collection(COLLECTION).doc(id);
const value = <T>(doc: FirebaseFirestore.DocumentSnapshot) => ({ ...doc.data(), id: doc.id }) as T;

/**
 * `app-pre-link` é a conciliação automática: o operador escolheu a sangria no aplicativo e o
 * sistema só confirma esse vínculo. Não exige permissão financeira de quem dispara, mas também
 * não permite criar despesa, desvincular nem ligar qualquer outra despesa.
 */
export type WithdrawalAuthorization = "user" | "app-pre-link";

export function assertWithdrawalAccess(context: ServerUserContext, closure: CashClosure, action: "view" | "create" | "link" | "unlink", authorization: WithdrawalAuthorization = "user") {
  if (closure.workspaceId !== context.workspace_id) withdrawalFailure("WORKSPACE", "Fechamento fora do workspace.", "AUTHORIZATION");
  if (authorization === "app-pre-link") {
    if (action !== "link") withdrawalFailure("FORBIDDEN", "A conciliação automática só confirma o vínculo feito no aplicativo.", "AUTHORIZATION");
    return;
  }
  if (!canUseCashClosure(context, action === "view" ? "view" : "edit", closure.kioskId)) {
    withdrawalFailure("FORBIDDEN", "Sem permissão para classificar sangrias nesta unidade.", "AUTHORIZATION");
  }
  const expenses = context.permissions.financial?.expenses;
  if (!context.isDefaultAdmin && (!expenses?.view || action !== "view" &&
    (!expenses.pay || (action === "create" ? !expenses.create : !expenses.edit)))) {
    withdrawalFailure("EXPENSE_FORBIDDEN", "A operação exige acesso a despesas e permissão de criar/editar e registrar pagamento, conforme a ação.", "AUTHORIZATION");
  }
}

function assertCatalogWorkspace(data: Raw, workspaceId: string) {
  // Legacy catalogs are single-tenant and belong only to the configured workspace.
  if ((data.workspaceId ?? WORKSPACE_ID) !== workspaceId) withdrawalFailure("CATALOG_SCOPE", "Cadastro fora do workspace.", "AUTHORIZATION");
}

export async function readClassificationCatalog(transaction: Transaction, source: Pick<WithdrawalSource, "workspaceId" | "unitId">, accountId: string, centerId: string) {
  if (!withdrawalDocumentIdSchema.safeParse(accountId).success || !withdrawalDocumentIdSchema.safeParse(centerId).success) {
    withdrawalFailure("CATALOG_INVALID", "Selecione conta e centro de resultado válidos.", "VALIDATION");
  }
  const [accountSnap, childSnap, centerSnap] = await Promise.all([
    transaction.get(db.collection("accounts").doc(accountId)),
    transaction.get(db.collection("accounts").where("parentId", "==", accountId).limit(1)),
    transaction.get(db.collection("resultCenters").doc(centerId)),
  ]);
  const account = accountSnap.data();
  const center = centerSnap.data();
  if (!account || account.active === false || account.isGroup === true || !childSnap.empty || account.is_dre_account === false) {
    withdrawalFailure("ACCOUNT_INVALID", "Selecione uma conta-folha ativa de despesa da DRE.", "VALIDATION");
  }
  assertCatalogWorkspace(account, source.workspaceId);
  if (!center || center.active === false || !Array.isArray(center.unitIds) || center.unitIds.length !== 1 || center.unitIds[0] !== source.unitId) {
    withdrawalFailure("CENTER_INVALID", "Selecione um centro de resultado ativo e exclusivo da unidade da sangria.", "VALIDATION");
  }
  assertCatalogWorkspace(center, source.workspaceId);
  if (!EXPENSE_POSITIONS.has(account.dre_position)) {
    withdrawalFailure("ACCOUNT_DRE_POSITION", "A conta deve estar classificada em uma linha de despesa da DRE.", "VALIDATION");
  }
  return { accountPlanId: accountId, accountPlanName: String(account.name || accountId),
    resultCenterId: centerId, resultCenterName: String(center.name || centerId) };
}

/** Reject evidence owned by another settlement process, including pending requests. */
export async function assertNoOtherSettlement(transaction: Transaction, expenseId: string, expense: Raw) {
  const obligationId = String(expense.obligationId || `obl_${expenseId}`);
  if (!withdrawalDocumentIdSchema.safeParse(obligationId).success) withdrawalFailure("EXPENSE_INELIGIBLE", "Obrigação inválida.");
  const checks = await Promise.all([
    transaction.get(db.collection("financialObligations").doc(obligationId)),
    transaction.get(db.collection("payments").where("expenseId", "==", expenseId).limit(1)),
    transaction.get(db.collection("payments").where("obligationId", "==", obligationId).limit(1)),
    transaction.get(db.collection("obligationPaymentLinks").where("expenseId", "==", expenseId).limit(1)),
    transaction.get(db.collection("paymentAdjustments").where("obligationId", "==", obligationId).limit(1)),
    transaction.get(db.collection("transactions").where("expenseId", "==", expenseId).limit(1)),
    transaction.get(db.collection("bankPaymentRequests").where("expenseId", "==", expenseId).limit(1)),
  ]);
  if (checks.some(snapshot => "exists" in snapshot ? snapshot.exists : !snapshot.empty)) {
    withdrawalFailure("OTHER_SETTLEMENT", "A despesa possui obrigação, pagamento, transação ou solicitação em outro fluxo. Resolva esse vínculo antes de usar a sangria.");
  }
}

async function assertLocalPurchaseCandidate(transaction: Transaction, expenseId: string, expense: Raw, source: WithdrawalSource, changeReturnedCents: number) {
  if (expense.originModule !== "local_purchase") return null;
  const localPurchaseId = expense.localPurchaseId;
  if (typeof localPurchaseId !== "string" || localPurchaseId !== expenseId || !withdrawalDocumentIdSchema.safeParse(localPurchaseId).success) {
    withdrawalFailure("LOCAL_PURCHASE_INVALID", "A compra local não possui uma identidade financeira válida.");
  }
  const snapshot = await transaction.get(db.collection("localPurchases").doc(localPurchaseId));
  const purchase = snapshot.data();
  if (!snapshot.exists || purchase?.workspaceId !== source.workspaceId || purchase?.unitId !== source.unitId
    || purchase?.status !== "awaiting_cash_withdrawal" || purchase?.fundingSource !== "cash_withdrawal"
    || purchase?.withdrawalPreLink && purchase.withdrawalPreLink.sourceId !== source.sourceId
    || !purchase?.withdrawalPreLink && purchase?.purchaseDate !== source.settledOn
    || purchase?.totalCents !== source.amountCents - changeReturnedCents) {
    withdrawalFailure("LOCAL_PURCHASE_STALE", "A compra local não está mais disponível para esta sangria.");
  }
  return snapshot.ref;
}

function assertOpenOperator(closure: CashClosure, operators: CashClosureOperator[], operatorId: string) {
  if (!canEditCashClosure(closure.status) || operators.some(operator => operator.operatorId === operatorId && operator.status === "approved")) {
    withdrawalFailure("REOPEN_REQUIRED", "Reabra a contagem deste operador antes de alterar a classificação da sangria.");
  }
}

async function loadTransactionClosure(transaction: Transaction, id: string, context: ServerUserContext, action: "view" | "create" | "link" | "unlink", authorization: WithdrawalAuthorization = "user") {
  const ref = closureRef(id);
  const header = await transaction.get(ref);
  if (!header.exists) withdrawalFailure("NOT_FOUND", "Fechamento não encontrado.", "NOT_FOUND");
  assertWithdrawalAccess(context, value<CashClosure>(header), action, authorization);
  const [lines, operators, classifications] = await Promise.all([
    transaction.get(ref.collection("lines").limit(351)),
    transaction.get(ref.collection("cashClosureOperators").limit(51)),
    transaction.get(ref.collection("withdrawals").limit(MAX_WITHDRAWALS + 1)),
  ]);
  if (lines.size > 350 || operators.size > 50 || classifications.size > MAX_WITHDRAWALS) {
    withdrawalFailure("LIMIT", "Fechamento acima do limite operacional de classificação.");
  }
  return { closure: value<CashClosure>(header), lines: lines.docs.map(row => value<CashClosureLine>(row)),
    operators: operators.docs.map(row => value<CashClosureOperator>(row)),
    classifications: classifications.docs.map(row => row.data() as WithdrawalClassification) };
}

function publicClassification(row: WithdrawalClassification) {
  return { sourceId: row.source.sourceId, fingerprint: row.source.fingerprint, expenseId: row.expenseId,
    operatorId: row.source.operatorId, amountCents: row.source.amountCents,
    accountPlanId: row.accountPlanId, accountPlanName: row.accountPlanName,
    resultCenterId: row.resultCenterId, resultCenterName: row.resultCenterName,
    description: row.description, active: row.active, createdExpense: row.createdExpense,
    changeReturnedCents: row.changeReturnedCents ?? 0,
    revision: row.revision, updatedAt: row.updatedAt };
}

/** Purchases the operator attached to a sangria in the app; a suggestion until the closure links it. */
async function listWithdrawalPreLinks(sources: WithdrawalSource[]) {
  if (!sources.length) return [];
  const snapshots = await db.getAll(...sources.map(source => db.collection(LOCAL_PURCHASE_WITHDRAWAL_LINKS).doc(source.sourceId)));
  return snapshots.flatMap(snapshot => {
    const source = sources.find(row => row.sourceId === snapshot.id);
    if (!snapshot.exists || !source || snapshot.get("workspaceId") !== source.workspaceId || snapshot.get("unitId") !== source.unitId) return [];
    const totalCents = Number(snapshot.get("totalCents"));
    return [{ sourceId: snapshot.id, expenseId: String(snapshot.get("purchaseId")),
      supplierName: String(snapshot.get("supplierName") || "Compra local"),
      resultCenterId: String(snapshot.get("resultCenterId") || ""),
      totalCents, changeCents: source.amountCents - totalCents }];
  });
}

export async function listWithdrawalClassifications(id: string, context: ServerUserContext) {
  if (!withdrawalDocumentIdSchema.safeParse(id).success) withdrawalFailure("ID_INVALID", "Fechamento inválido.", "VALIDATION");
  // Read-only transaction provides a coherent view without a GET write.
  const listed = await db.runTransaction(async transaction => {
    const current = await loadTransactionClosure(transaction, id, context, "view");
    const result = withdrawalSources(current.closure, current.lines);
    return { closureId: id, sources: result.sources, issues: result.issues,
      classifications: current.classifications.map(publicClassification),
      limits: { withdrawals: MAX_WITHDRAWALS, candidatesPerPage: 25 },
    };
  }, { readOnly: true });
  return { ...listed, preLinks: await listWithdrawalPreLinks(listed.sources) };
}

export async function listWithdrawalExpenseCandidates(id: string, sourceId: string, centerId: string, cursor: string | undefined, context: ServerUserContext) {
  const current = await listWithdrawalClassifications(id, context);
  const source = current.sources.find(row => row.sourceId === sourceId);
  if (!source || !withdrawalDocumentIdSchema.safeParse(centerId).success || cursor && !withdrawalDocumentIdSchema.safeParse(cursor).success) {
    withdrawalFailure("CANDIDATE_QUERY_INVALID", "Selecione uma sangria e um centro válidos.", "VALIDATION");
  }
  const center = await db.collection("resultCenters").doc(centerId).get();
  if (!center.exists || center.data()?.active === false || center.data()?.unitIds?.length !== 1 || center.data()?.unitIds?.[0] !== source.unitId) {
    withdrawalFailure("CENTER_INVALID", "Centro fora da unidade.", "VALIDATION");
  }
  assertCatalogWorkspace(center.data()!, source.workspaceId);
  let query = db.collection("expenses")
    .where("competenceMonth", "==", source.competenceMonth).where("resultCenterId", "==", centerId)
    .where("status", "==", "pending").orderBy(FieldPath.documentId()).limit(26);
  if (source.workspaceId !== WORKSPACE_ID) query = query.where("workspaceId", "==", source.workspaceId);
  if (cursor) query = query.startAfter(cursor);
  const snapshot = await query.get();
  const page = snapshot.docs.slice(0, 25);
  const candidates = page.flatMap(doc => {
    const expense = doc.data();
    try { assertEligibleWithdrawalExpense(expense, source, WORKSPACE_ID); }
    catch (error) {
      if (error instanceof Error && error.name === "AppError") return [];
      throw error;
    }
    return [{ id: doc.id, description: String(expense.description || "Despesa"), amountCents: source.amountCents,
      localPurchase: expense.originModule === "local_purchase",
      competenceMonth: source.competenceMonth, accountPlanId: String(expense.accountPlan || expense.accountId || ""), resultCenterId: centerId }];
  });
  return { candidates, nextCursor: snapshot.size > 25 ? page.at(-1)!.id : null };
}

export async function classifyCashWithdrawal(id: string, raw: unknown, context: ServerUserContext, authorization: WithdrawalAuthorization = "user") {
  const parsed = withdrawalClassificationSchema.safeParse(raw);
  if (!withdrawalDocumentIdSchema.safeParse(id).success || !parsed.success) {
    withdrawalFailure("INPUT_INVALID", "Dados de classificação inválidos.", "VALIDATION");
  }
  const input = parsed.data;
  return db.runTransaction(async transaction => {
    const current = await loadTransactionClosure(transaction, id, context, input.action, authorization);
    const { closure } = current;
    const reference = closureRef(id).collection("withdrawals").doc(input.sourceId);
    const previous = current.classifications.find(row => row.source.sourceId === input.sourceId);
    const claimSnapshot = await transaction.get(claimRef(input.sourceId));
    const claim = claimSnapshot.data() as WithdrawalClassification | undefined;
    if (claim?.active && claim.source.closureId !== id) withdrawalFailure("CLAIM_CONFLICT", "A sangria já está vinculada em outro fechamento. Desfaça o vínculo anterior antes de classificar a origem corrigida.");
    const now = new Date().toISOString();
    const audit = db.collection("cashClosureAuditLogs").doc(randomUUID());
    const writeAudit = (action: string, expenseId: string) => transaction.set(audit, {
      id: audit.id, workspaceId: closure.workspaceId, closureId: id, action,
      sourceId: input.sourceId, expenseId, userId: context.decoded.uid,
      userName: context.userDoc.username || "Usuário", createdAt: now, reason: input.reason ?? null,
    });
    if (input.action === "unlink") {
      if (previous && !previous.active && claim?.source.closureId === id && !claim.active) {
        return { classification: publicClassification(previous), idempotent: true };
      }
      if (!previous?.active || !claim?.active) withdrawalFailure("NOT_LINKED", "Esta sangria não possui vínculo ativo.");
      assertOpenOperator(closure, current.operators, previous.source.operatorId);
      if (claim.expenseGuard !== previous.expenseGuard || claim.expenseId !== previous.expenseId) withdrawalFailure("CLAIM_CONFLICT", "O vínculo foi alterado; atualize a consulta.");
      const expenseRef = db.collection("expenses").doc(previous.expenseId);
      const snapshot = await transaction.get(expenseRef);
      if (!snapshot.exists || sourceExpenseGuard(snapshot.data()!) !== previous.expenseGuard) {
        withdrawalFailure("EXPENSE_CHANGED", "A despesa foi alterada por outro processo. Não é seguro desfazer automaticamente.");
      }
      await assertNoOtherSettlement(transaction, previous.expenseId, snapshot.data()!);
      const localPurchaseRef = snapshot.get("originModule") === "local_purchase"
        ? db.collection("localPurchases").doc(String(snapshot.get("localPurchaseId")))
        : null;
      if (localPurchaseRef && !(await transaction.get(localPurchaseRef)).exists) {
        withdrawalFailure("LOCAL_PURCHASE_STALE", "A compra local vinculada não foi encontrada.");
      }
      const inactive = { ...previous, active: false, updatedAt: now, updatedBy: context.decoded.uid };
      if (previous.createdExpense) {
        // Keep the protected origin and audit. A correction creates a new revision.
        transaction.update(expenseRef, { status: "cancelled", updatedAt: Timestamp.now(),
          sourceSettlementReversal: { reason: input.reason, reversedAt: now, reversedBy: context.decoded.uid } });
      } else {
        const restore: Raw = { ...previous.previousFields, updatedAt: Timestamp.now() };
        for (const key of previous.previousMissingFields) restore[key] = FieldValue.delete();
        transaction.update(expenseRef, restore);
        if (localPurchaseRef) {
          transaction.update(localPurchaseRef, {
            status: "awaiting_cash_withdrawal",
            withdrawalSettlement: FieldValue.delete(),
            updatedAt: now,
          });
        }
      }
      transaction.set(reference, inactive);
      transaction.set(claimRef(input.sourceId), inactive);
      transaction.update(closureRef(id), { withdrawalRevision: FieldValue.increment(1), updatedAt: now });
      writeAudit("withdrawal_unlinked", previous.expenseId);
      return { classification: publicClassification(inactive), idempotent: false };
    }

    const result = withdrawalSources(closure, current.lines);
    assertWithdrawalSourceIntegrity(result);
    const source = result.sources.find(row => row.sourceId === input.sourceId);
    if (!source || !source.identityVerified) withdrawalFailure("IDENTITY_UNVERIFIED", "A sangria precisa de um identificador confirmado pelo PDV. Sincronize novamente; se o PDV não o fornecer, corrija a origem.");
    if (source.fingerprint !== input.fingerprint) withdrawalFailure("SOURCE_CHANGED", "A sangria mudou desde a consulta. Atualize antes de classificar.");
    if (previous?.active || claim?.active) {
      const same = previous?.active && claim?.active && previous.source.fingerprint === source.fingerprint
        && previous.expenseGuard === claim.expenseGuard && previous.expenseId === claim.expenseId
        && (input.action === "link" ? !previous.createdExpense && previous.expenseId === input.existingExpenseId
          : previous.createdExpense && previous.accountPlanId === input.accountPlanId && previous.resultCenterId === input.resultCenterId && previous.description === input.description);
      if (!same) withdrawalFailure("UNLINK_FIRST", "Desvincule com uma justificativa antes de corrigir a classificação ou a origem desta sangria.");
      const expense = await transaction.get(db.collection("expenses").doc(previous!.expenseId));
      if (!expense.exists || sourceExpenseGuard(expense.data()!) !== previous!.expenseGuard) withdrawalFailure("EXPENSE_CHANGED", "A despesa vinculada foi alterada; confira o vínculo.");
      return { classification: publicClassification(previous!), idempotent: true };
    }
    assertOpenOperator(closure, current.operators, source.operatorId);
    if ((previous || claim) && !input.reason) withdrawalFailure("REASON_REQUIRED", "Informe o motivo para refazer esta classificação.", "VALIDATION");
    if (!previous && current.classifications.length >= MAX_WITHDRAWALS) withdrawalFailure("LIMIT", "Limite de sangrias por fechamento atingido.");
    const revision = Math.max(previous?.revision ?? 0, claim?.revision ?? 0) + 1;
    const expenseId = input.action === "link" ? input.existingExpenseId : `cash_withdrawal_${source.sourceId}_${revision}`;
    const expenseRef = db.collection("expenses").doc(expenseId);
    const expenseSnapshot = await transaction.get(expenseRef);
    const oldExpense = expenseSnapshot.data() ?? {};
    const changeReturnedCents = input.action === "link" ? preLinkedChangeCents(oldExpense, source) : 0;
    if (input.action === "link") {
      if (!expenseSnapshot.exists) withdrawalFailure("EXPENSE_NOT_FOUND", "Despesa não encontrada.", "NOT_FOUND");
      if (authorization === "app-pre-link" && oldExpense.localPurchaseWithdrawalSourceId !== source.sourceId) {
        withdrawalFailure("FORBIDDEN", "A conciliação automática só confirma o vínculo feito no aplicativo.", "AUTHORIZATION");
      }
      const acceptedWithSameChange = current.classifications.filter(row => row.active && row.source.sourceId !== source.sourceId
        && (row.changeReturnedCents ?? 0) === changeReturnedCents).length;
      if (changeReturnedCents > 0 && !changeReturnIsProven(current.lines, closure.date, changeReturnedCents, acceptedWithSameChange)) {
        withdrawalFailure("CHANGE_NOT_RETURNED", `A nota é menor que a sangria: falta no PDV, neste dia, um suprimento de ${(changeReturnedCents / 100).toFixed(2).replace(".", ",")} devolvendo o troco ao caixa.`);
      }
      assertEligibleWithdrawalExpense(oldExpense, source, WORKSPACE_ID, changeReturnedCents);
      await assertNoOtherSettlement(transaction, expenseId, oldExpense);
      await assertLocalPurchaseCandidate(transaction, expenseId, oldExpense, source, changeReturnedCents);
    } else if (expenseSnapshot.exists) withdrawalFailure("EXPENSE_COLLISION", "Já existe um registro para esta revisão; confira o vínculo.");
    const catalog = await readClassificationCatalog(transaction, source,
      input.action === "create" ? input.accountPlanId : String(oldExpense.accountPlan || oldExpense.accountId || ""),
      input.action === "create" ? input.resultCenterId : String(oldExpense.resultCenterId || ""));
    const date = Timestamp.fromDate(new Date(`${source.settledOn}T12:00:00.000Z`));
    const patch: Raw = { workspaceId: source.workspaceId, status: "paid", paidAt: date, paymentState: "paid",
      plannedPaymentMethodType: "cash", plannedPaymentMethodLabel: "Dinheiro — sangria do PDV",
      // The expense is what was actually spent; returned change is cash that went back to the till.
      settlementSummary: sourceSettlementSummary(source.amountCents - changeReturnedCents), sourceSettlement: source };
    if (oldExpense.installments?.length === 1) {
      patch.installments = [{ ...oldExpense.installments[0], status: "paid", paidAt: date }];
    }
    const expense: Raw = input.action === "link" ? { ...oldExpense, ...patch, updatedAt: Timestamp.now() } : {
      ...patch, workspaceId: source.workspaceId, kioskId: source.unitId,
      description: input.description, totalValue: source.amountCents / 100,
      competenceDate: date, dueDate: date, ...financialExpenseAccountingFields({ competenceMonth: source.competenceMonth }),
      accountPlan: catalog.accountPlanId, accountId: catalog.accountPlanId, accountPlanName: catalog.accountPlanName,
      resultCenter: catalog.resultCenterName, resultCenterId: catalog.resultCenterId, resultCenterName: catalog.resultCenterName,
      referenceResultCenterId: catalog.resultCenterId, referenceResultCenterName: catalog.resultCenterName,
      paymentMethod: "single", isApportioned: false, hasAccountAllocations: false, hasPersonAllocations: false,
      originModule: "cash_closure", supplier: "", createdBy: context.decoded.uid, createdAt: Timestamp.now(), updatedAt: Timestamp.now(),
    };
    const classification: WithdrawalClassification = { source, expenseId, ...catalog,
      description: String(expense.description), createdExpense: input.action === "create", changeReturnedCents, active: true, revision,
      updatedAt: now, updatedBy: context.decoded.uid, expenseGuard: sourceExpenseGuard(expense),
      previousFields: Object.fromEntries(MUTATED_FIELDS.filter(key => key in oldExpense).map(key => [key, oldExpense[key]])),
      previousMissingFields: MUTATED_FIELDS.filter(key => !(key in oldExpense)) };
    transaction.set(expenseRef, expense);
    if (input.action === "link" && oldExpense.originModule === "local_purchase"
      && typeof oldExpense.localPurchaseId === "string"
      && withdrawalDocumentIdSchema.safeParse(oldExpense.localPurchaseId).success) {
      transaction.update(db.collection("localPurchases").doc(oldExpense.localPurchaseId), {
        status: "reconciled",
        withdrawalSettlement: {
          sourceId: source.sourceId,
          closureId: source.closureId,
          expenseId,
          settledOn: source.settledOn,
          amountCents: source.amountCents - changeReturnedCents,
          changeReturnedCents,
        },
        updatedAt: now,
      });
    }
    transaction.set(reference, classification);
    transaction.set(claimRef(source.sourceId), classification);
    transaction.update(closureRef(id), { withdrawalRevision: FieldValue.increment(1), updatedAt: now });
    writeAudit(input.action === "create" ? "withdrawal_expense_created"
      : authorization === "app-pre-link" ? "withdrawal_expense_linked_by_app" : "withdrawal_expense_linked", expenseId);
    return { classification: publicClassification(classification), idempotent: false };
  });
}

/** Called BEFORE all writes in every finalization path, legacy included. */
export async function assertWithdrawalsClassified(transaction: Transaction, closure: CashClosure, lines: CashClosureLine[], operatorId?: string) {
  const result = withdrawalSources(closure, lines);
  assertWithdrawalSourceIntegrity(result);
  const snapshot = await transaction.get(closureRef(closure.id).collection("withdrawals").limit(MAX_WITHDRAWALS + 1));
  if (snapshot.size > MAX_WITHDRAWALS) withdrawalFailure("LIMIT", "Limite operacional de sangrias excedido.");
  const active = snapshot.docs.map(doc => doc.data() as WithdrawalClassification).filter(row => row.active && (!operatorId || row.source.operatorId === operatorId));
  const sources = result.sources.filter(row => !operatorId || row.operatorId === operatorId);
  if (active.some(row => !sources.some(source => source.sourceId === row.source.sourceId))) {
    withdrawalFailure("ORPHAN_CLASSIFICATION", "Há uma despesa de sangria removida ou alterada na origem. Desvincule-a com justificativa antes de finalizar.");
  }
  for (const source of sources) {
    const classification = active.find(row => row.source.sourceId === source.sourceId);
    if (!source.identityVerified || !classification || classification.source.fingerprint !== source.fingerprint) {
      withdrawalFailure("CLASSIFICATION_REQUIRED", "Classifique todas as sangrias deste operador com os dados atuais do PDV antes de finalizar.");
    }
    const [claim, expense] = await Promise.all([
      transaction.get(claimRef(source.sourceId)), transaction.get(db.collection("expenses").doc(classification.expenseId)),
    ]);
    if (!claim.data()?.active || claim.data()?.source?.fingerprint !== source.fingerprint
      || claim.data()?.source?.closureId !== closure.id || claim.data()?.expenseId !== classification.expenseId
      || !expense.exists || expense.data()?.status !== "paid" || expense.data()?.workspaceId !== closure.workspaceId
      || sourceExpenseGuard(expense.data()!) !== classification.expenseGuard) {
      withdrawalFailure("CLASSIFICATION_STALE", "O vínculo financeiro de uma sangria mudou. Confira a classificação antes de finalizar.");
    }
    await readClassificationCatalog(transaction, source, classification.accountPlanId, classification.resultCenterId);
  }
}

/**
 * Conciliação automática: transforma em vínculo definitivo cada pré-vínculo feito no aplicativo
 * que o fechamento do dia já consegue comprovar. O que não passar (operador já aprovado, troco sem
 * suprimento, sangria alterada) fica como está, para o financeiro resolver no painel.
 */
export async function autoLinkAppPreLinks(closureId: string, context: ServerUserContext) {
  if (!withdrawalDocumentIdSchema.safeParse(closureId).success) return { linked: [] as string[], pending: [] as string[] };
  const header = await closureRef(closureId).get();
  if (!header.exists || header.get("workspaceId") !== context.workspace_id) return { linked: [], pending: [] };
  const [lines, classifications] = await Promise.all([
    closureRef(closureId).collection("lines").limit(351).get(),
    closureRef(closureId).collection("withdrawals").limit(MAX_WITHDRAWALS + 1).get(),
  ]);
  const { sources } = withdrawalSources(value<CashClosure>(header), lines.docs.map(row => value<CashClosureLine>(row)));
  const active = new Set(classifications.docs.filter(row => row.get("active") === true).map(row => row.id));
  const open = sources.filter(source => source.identityVerified && !active.has(source.sourceId));
  const preLinks = await listWithdrawalPreLinks(open);
  const linked: string[] = [];
  const pending: string[] = [];
  for (const preLink of preLinks) {
    const source = open.find(row => row.sourceId === preLink.sourceId)!;
    await classifyCashWithdrawal(closureId, { action: "link", sourceId: source.sourceId, fingerprint: source.fingerprint, existingExpenseId: preLink.expenseId }, context, "app-pre-link")
      .then(() => linked.push(preLink.expenseId))
      .catch((error) => {
        if (!(error instanceof Error) || error.name !== "AppError") throw error;
        pending.push(preLink.expenseId);
      });
  }
  return { linked, pending };
}
