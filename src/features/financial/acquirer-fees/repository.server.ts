import "server-only";
import { randomUUID } from "node:crypto";
import { FieldPath, FieldValue, Timestamp, type Transaction } from "firebase-admin/firestore";
import { financialDbAdmin as db } from "@/lib/firebase-financial-admin";
import { WORKSPACE_ID } from "@/lib/workspace";
import { AppError } from "@/lib/observability/app-error";
import { financialExpenseAccountingFields, financialExpenseCompetenceMonth } from "../lib/expense-accounting-contract";
import { sourceSettlementSummary } from "../lib/source-settlement";
import { FINANCIAL_COLLECTIONS } from "../lib/constants";
import { sourceExpenseGuard } from "../cash-closures/withdrawal-classification";
import { assertNoOtherSettlement, readClassificationCatalog } from "../cash-closures/withdrawal-classification.server";
import { resolveFinancialAgentMapping } from "../agent/mapping";
import { feeHash, MAX_FEE_MEMBERS } from "./evidence";
import { feeActionSchema, feeRequestSchema, FEE_LABELS, type FeeBatch, type FeeRequest, type FeePreview, type FeeRecordView } from "./contracts";
import { assertFeeAdmin, queryFeeEvidence, type FeeContext, type FeeDependencies, type FeeEvidence } from "./source.server";

type Raw = Record<string, any>;
type RecordData = { id: string; workspaceId: string; unitId: string; stoneCode: string; referenceDate: string; source: "pix" | "cards";
  batch: FeeBatch; active: boolean; expenseId: string; createdExpense: boolean; revision: number;
  expenseGuard: string; previousFields: Raw; previousMissing: string[] };
const records = db.collection(FINANCIAL_COLLECTIONS.acquirerFeeBatches);
const claims = db.collection(FINANCIAL_COLLECTIONS.sourceSettlements);
const MUTATED = ["workspaceId", "competenceDate", "status", "paidAt", "paymentState", "settlementSummary", "sourceSettlement", "cashEffectIncludedInNetReceivable", "installments"];
function fail(code: string, safeMessage: string): never { throw new AppError({ code: `ACQUIRER_FEE_${code}`, kind: "CONFLICT", safeMessage }); }
const view = (row: RecordData): FeeRecordView => ({ id: row.id, expenseId: row.expenseId, active: row.active, revision: row.revision,
  fingerprint: row.batch.fingerprint, kind: row.batch.kind, amountCents: row.batch.amountCents,
  competenceDate: row.batch.competenceDate, settledOn: row.batch.settledOn, createdExpense: row.createdExpense });
function assertRecordScope(row: RecordData, request: FeeRequest, context: FeeContext) {
  if (row.workspaceId !== context.workspace_id || row.unitId !== request.kioskId || row.stoneCode !== request.stoneCode || row.referenceDate !== request.referenceDate || row.source !== request.source) fail("SCOPE", "Registro fora do escopo selecionado.");
}
export function assertFeeExpenseEligible(expense: Raw, batch: FeeBatch, workspaceId: string, unitId: string) {
  if ((expense.workspaceId ?? WORKSPACE_ID) !== workspaceId || expense.kioskId && expense.kioskId !== unitId
    || expense.unitId && expense.unitId !== unitId || financialExpenseCompetenceMonth(expense) !== batch.competenceDate.slice(0, 7)
    || Math.round(Number(expense.totalValue) * 100) !== batch.amountCents) fail("EXPENSE_SCOPE", "Despesa deve ter o mesmo valor, competência, workspace e centro da unidade.");
  if (expense.status !== "pending" || expense.sourceSettlement || expense.budgetMigration || expense.provisionType === "forecast"
    || expense.paidAt || expense.paymentState && expense.paymentState !== "open" || expense.settlementSummary
    || expense.linkedBankTransactionId || expense.bankTransactionId || expense.paymentRequestId || expense.paymentId
    || expense.cardStatementId || expense.latestCardStatementObligationId || expense.importedFrom === "card_statement"
    || expense.reconciledProvisionId || expense.financialInboxMessageId || expense.paymentMethod !== "single"
    || expense.plannedBankAccountId || expense.plannedPaymentMethodType || expense.originModule && expense.originModule !== "manual"
    || expense.hasAccountAllocations || expense.hasPersonAllocations || expense.isApportioned
    || expense.accountAllocations?.length || expense.personAllocations?.length || expense.apportionments?.length || (expense.installments?.length ?? 0) > 1) {
    fail("EXPENSE_INELIGIBLE", "Use uma despesa avulsa em aberto, sem pagamento, cartão, previsão, rateio ou origem vinculada.");
  }
  const installment = expense.installments?.[0];
  if (installment && (installment.status !== "pending" || installment.number !== 1 || Math.round(installment.value * 100) !== batch.amountCents
    || installment.paidAt || installment.paymentRequestId || installment.paymentId || installment.financialInboxMessageId
    || installment.linkedBankTransactionId || installment.settlementSummary
    || sourceExpenseGuard({ dueDate: installment.dueDate }) !== sourceExpenseGuard({ dueDate: expense.dueDate }))) fail("INSTALLMENT_INVALID", "Parcela única incompatível ou já vinculada a pagamento.");
}
async function validateStoredMapping(tx: Transaction, evidence: FeeEvidence, batch: FeeBatch, context: FeeContext) {
  const query = db.collection("stoneMerchantMappings").where("workspaceId", "==", context.workspace_id)
    .where("stoneCodes", "array-contains", evidence.request.stoneCode).limit(101);
  const snapshot = await tx.get(query);
  const docs = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id }));
  for (const referenceDate of new Set([evidence.request.referenceDate, batch.competenceDate, batch.settledOn])) {
    const mapping = resolveFinancialAgentMapping(docs, { ...evidence.request, referenceDate, intent: "review_anticipations", prioritizeWithAi: false }, context.workspace_id);
    if (feeHash(mapping) !== feeHash(evidence.mapping)) fail("MAPPING_CHANGED", "Vínculo alterado durante a confirmação. Refaça a prévia.");
  }
  const account = await tx.get(db.collection("bankAccounts").doc(evidence.mapping.accountId));
  if (account.data()?.workspaceId !== context.workspace_id) fail("MAPPING_CHANGED", "Conta do vínculo fora do workspace.");
  if (evidence.pixSource) {
    const head = await tx.get(db.collection("stonePixConciliationFiles").doc(evidence.pixSource.fileId));
    if (head.data()?.workspaceId !== context.workspace_id || head.data()?.referenceDate !== evidence.request.referenceDate
      || head.data()?.status !== "processed" || head.data()?.sourceHash !== evidence.pixSource.sourceHash) fail("SOURCE_CHANGED", "Arquivo Pix mudou. Refaça a prévia.");
  }
}
async function storedRecords(request: FeeRequest, context: FeeContext) {
  const snapshot = await records.where("workspaceId", "==", context.workspace_id).where("unitId", "==", request.kioskId)
    .where("stoneCode", "==", request.stoneCode).where("referenceDate", "==", request.referenceDate).where("source", "==", request.source).limit(101).get();
  if (snapshot.size > 100) fail("HISTORY_LIMIT", "Histórico do dia excede 100 grupos; revisão administrativa necessária.");
  return snapshot.docs.map(doc => view(doc.data() as RecordData));
}
export async function listFeeRecords(raw: unknown, context: FeeContext) {
  assertFeeAdmin(context);
  const parsed = feeRequestSchema.safeParse(raw);
  if (!parsed.success) fail("INPUT", "Consulta inválida.");
  return { records: await storedRecords(parsed.data, context) };
}
export async function listFeeCandidates(raw: unknown, centerId: string, cursor: string | undefined, context: FeeContext) {
  assertFeeAdmin(context);
  const parsed = feeRequestSchema.safeParse(raw);
  if (!parsed.success || !/^[^/]{1,180}$/.test(centerId) || cursor && !/^[^/]{1,180}$/.test(cursor)) fail("INPUT", "Consulta inválida.");
  const request = parsed.data;
  const center = await db.collection("resultCenters").doc(centerId).get();
  if ((center.data()?.workspaceId ?? WORKSPACE_ID) !== context.workspace_id || center.data()?.unitIds?.length !== 1
    || center.data()?.unitIds?.[0] !== request.kioskId || center.data()?.active === false) fail("CENTER", "Centro fora da unidade/workspace.");
  // The UI submits the exact existing ID; this list is advisory, transaction revalidates.
  let query = db.collection("expenses").where("competenceMonth", "==", request.referenceDate.slice(0, 7))
    .where("resultCenterId", "==", centerId).where("status", "==", "pending").orderBy(FieldPath.documentId()).limit(26);
  if (context.workspace_id !== WORKSPACE_ID) query = query.where("workspaceId", "==", context.workspace_id);
  if (cursor) query = query.startAfter(cursor);
  const rows = await query.get();
  return { candidates: rows.docs.slice(0, 25).filter(doc => (doc.data().workspaceId ?? WORKSPACE_ID) === context.workspace_id)
    .map(doc => ({ id: doc.id, description: String(doc.data().description ?? "Despesa"), totalValue: Number(doc.data().totalValue) })), nextCursor: rows.size > 25 ? rows.docs[24].id : null };
}

export async function executeFeeAction(raw: unknown, context: FeeContext, deps: FeeDependencies): Promise<FeePreview | { record: FeeRecordView; idempotent: boolean }> {
  assertFeeAdmin(context);
  const parsed = feeActionSchema.safeParse(raw);
  if (!parsed.success) throw new AppError({ code: "ACQUIRER_FEE_INPUT_INVALID", kind: "VALIDATION", safeMessage: "Dados da operação inválidos." });
  const input = parsed.data;
  if (input.action === "cancel") return db.runTransaction(async tx => {
    const ref = records.doc(input.batchId), snapshot = await tx.get(ref);
    if (!snapshot.exists) fail("NOT_FOUND", "Registro não encontrado.");
    const current = snapshot.data() as RecordData;
    assertRecordScope(current, input.request, context);
    if (!current.active) return { record: view(current), idempotent: true };
    if (current.batch.members.length > MAX_FEE_MEMBERS) fail("MEMBER_LIMIT", "Lote fora do limite de correção.");
    const expenseRef = db.collection("expenses").doc(current.expenseId);
    const expense = await tx.get(expenseRef);
    const memberClaims = await Promise.all(current.batch.members.map(member => tx.get(claims.doc(member.id))));
    if (!expense.exists || sourceExpenseGuard(expense.data()!) !== current.expenseGuard
      || memberClaims.some(claim => !claim.data()?.active || claim.data()?.batchId !== current.id || claim.data()?.revision !== current.revision)) fail("CHANGED", "O registro foi alterado por outro fluxo. Não é seguro estornar automaticamente.");
    await assertNoOtherSettlement(tx, current.expenseId, expense.data()!);
    const at = Timestamp.now();
    if (current.createdExpense) tx.update(expenseRef, { status: "cancelled", updatedAt: at, sourceSettlementReversal: { reason: input.reason, reversedAt: at, reversedBy: context.decoded.uid } });
    else {
      const restore: Raw = { ...current.previousFields, updatedAt: at };
      for (const key of current.previousMissing) restore[key] = FieldValue.delete();
      tx.update(expenseRef, restore);
    }
    for (const claim of memberClaims) tx.update(claim.ref, { active: false, updatedAt: at });
    tx.update(ref, { active: false, updatedAt: at });
    tx.create(ref.collection("events").doc(randomUUID()), { type: "cancelled", reason: input.reason, expenseId: current.expenseId, revision: current.revision, actorId: context.decoded.uid, at });
    return { record: view({ ...current, active: false }), idempotent: false };
  });
  const evidence = await queryFeeEvidence(input.request, context, deps);
  if (input.action === "preview") return { request: evidence.request, batches: evidence.batches, pending: evidence.pending, records: await storedRecords(input.request, context) };
  const batch = evidence.batches.find(row => row.id === input.batchId);
  if (!batch || batch.fingerprint !== input.fingerprint) fail("STALE_PREVIEW", "A fonte mudou ou não é mais elegível. Atualize a prévia; nada foi gravado.");
  return db.runTransaction(async tx => {
    await validateStoredMapping(tx, evidence, batch, context);
    const ref = records.doc(batch.id), previousSnap = await tx.get(ref);
    const previous = previousSnap.data() as RecordData | undefined;
    if (previous) assertRecordScope(previous, input.request, context);
    const memberClaims = await Promise.all(batch.members.map(member => tx.get(claims.doc(member.id))));
    const active = memberClaims.filter(claim => claim.data()?.active);
    if (previous?.active) {
      if (previous.batch.fingerprint !== batch.fingerprint || active.length !== batch.members.length
        || active.some(claim => claim.data()?.batchId !== batch.id || claim.data()?.revision !== previous.revision)) fail("SOURCE_CHANGED", "Registro existente difere da origem. Estorne com motivo antes de refazer.");
      const expense = await tx.get(db.collection("expenses").doc(previous.expenseId));
      const sameSelection = input.action === "link" ? !previous.createdExpense && previous.expenseId === input.existingExpenseId
        : previous.createdExpense && expense.data()?.accountId === input.accountPlanId && expense.data()?.resultCenterId === input.resultCenterId;
      if (!sameSelection || !expense.exists || sourceExpenseGuard(expense.data()!) !== previous.expenseGuard) fail("CHANGED", "Classificação existente diferente; estorne antes de alterar.");
      return { record: view(previous), idempotent: true };
    }
    if (active.length) fail("OVERLAP", "Há parcelas já registradas em outro grupo. Estorne o grupo anterior antes de reclassificar a fonte reprocessada.");
    if ((previous || memberClaims.some(claim => claim.exists)) && !input.reason) fail("REASON", "Informe o motivo para reclassificar evidências com histórico.");
    const revision = (previous?.revision ?? 0) + 1;
    const expenseId = input.action === "link" ? input.existingExpenseId : `acquirer_fee_${batch.id}_${revision}`;
    const expenseRef = db.collection("expenses").doc(expenseId), expenseSnap = await tx.get(expenseRef);
    const original = expenseSnap.data() ?? {};
    if (input.action === "link") {
      if (!expenseSnap.exists) fail("EXPENSE_MISSING", "Despesa não encontrada.");
      assertFeeExpenseEligible(original, batch, context.workspace_id, input.request.kioskId);
      await assertNoOtherSettlement(tx, expenseId, original);
    } else if (expenseSnap.exists) fail("COLLISION", "Registro de revisão já existe; confira o histórico.");
    const catalog = await readClassificationCatalog(tx, { workspaceId: context.workspace_id, unitId: input.request.kioskId },
      input.action === "create" ? input.accountPlanId : String(original.accountPlan || original.accountId || ""),
      input.action === "create" ? input.resultCenterId : String(original.resultCenterId || ""));
    if (input.action === "create") {
      // Bounded by month + unit center. No claim of semantic automatic deduplication:
      // equal-amount manual candidates block creation and require explicit linking/review.
      let query = db.collection("expenses").where("competenceMonth", "==", batch.competenceDate.slice(0, 7))
        .where("resultCenterId", "==", catalog.resultCenterId).where("totalValue", "==", batch.amountCents / 100).limit(26);
      if (context.workspace_id !== WORKSPACE_ID) query = query.where("workspaceId", "==", context.workspace_id);
      const candidates = await tx.get(query);
      if (candidates.size > 25 || candidates.docs.some(doc => (doc.data().workspaceId ?? WORKSPACE_ID) === context.workspace_id
        && doc.data().status !== "cancelled" && !doc.data().sourceSettlement)) fail("MANUAL_CANDIDATE", "Há despesa manual do mesmo valor, competência e centro. Confira e vincule o ID existente; não foi criada outra despesa.");
    }
    const at = Timestamp.now(), date = Timestamp.fromDate(new Date(`${batch.competenceDate}T12:00:00Z`)), paidAt = Timestamp.fromDate(new Date(`${batch.settledOn}T12:00:00Z`));
    const patch: Raw = { workspaceId: context.workspace_id, competenceDate: date, status: "paid", paidAt, paymentState: "paid", cashEffectIncludedInNetReceivable: true,
      settlementSummary: sourceSettlementSummary(batch.amountCents), sourceSettlement: { version: 1, kind: "acquirer_fee", sourceId: batch.id,
        fingerprint: batch.fingerprint, amountCents: batch.amountCents, competenceMonth: batch.competenceDate.slice(0, 7), settledOn: batch.settledOn,
        workspaceId: context.workspace_id, unitId: input.request.kioskId }, updatedAt: at };
    if (original.installments?.length === 1) patch.installments = [{ ...original.installments[0], status: "paid", paidAt }];
    const expense: Raw = input.action === "link" ? { ...original, ...patch } : { ...patch, description: `${FEE_LABELS[batch.kind]} — Stone ${input.request.stoneCode} — ${batch.competenceDate}`,
      kioskId: input.request.kioskId, totalValue: batch.amountCents / 100, competenceDate: date, dueDate: paidAt,
      ...financialExpenseAccountingFields({ competenceMonth: batch.competenceDate.slice(0, 7) }), accountPlan: catalog.accountPlanId, accountId: catalog.accountPlanId,
      accountPlanName: catalog.accountPlanName, resultCenterId: catalog.resultCenterId, resultCenter: catalog.resultCenterName, resultCenterName: catalog.resultCenterName,
      referenceResultCenterId: catalog.resultCenterId, referenceResultCenterName: catalog.resultCenterName,
      paymentMethod: "single", isApportioned: false, hasAccountAllocations: false, hasPersonAllocations: false, originModule: "acquirer_fee", createdAt: at, createdBy: context.decoded.uid };
    const record: RecordData = { id: batch.id, batch, workspaceId: context.workspace_id, unitId: input.request.kioskId, stoneCode: input.request.stoneCode,
      referenceDate: input.request.referenceDate, source: input.request.source, active: true, expenseId, createdExpense: input.action === "create", revision,
      expenseGuard: sourceExpenseGuard(expense), previousFields: Object.fromEntries(MUTATED.filter(key => key in original).map(key => [key, original[key]])), previousMissing: MUTATED.filter(key => !(key in original)) };
    tx.set(expenseRef, expense);
    tx.set(ref, { ...record, updatedAt: at });
    for (const member of batch.members) tx.set(claims.doc(member.id), { kind: "acquirer_fee", batchId: batch.id, revision, active: true, workspaceId: context.workspace_id, unitId: input.request.kioskId, fingerprint: feeHash(member), updatedAt: at });
    tx.create(ref.collection("events").doc(randomUUID()), { type: input.action, revision, expenseId, actorId: context.decoded.uid, at, reason: input.reason ?? null,
      evidence: batch, paymentFileId: evidence.paymentFileId, originalFileIds: evidence.originalFileIds, pixSource: evidence.pixSource });
    return { record: view(record), idempotent: false };
  });
}
