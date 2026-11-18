import { readConfirmedRateReferences } from "../receipts-reconciliation/confirmed-rate-reference.server";
import { rateReferenceEvidence, referenceOnDate } from "../receipts-reconciliation/confirmed-rate-reference";
import "server-only";
import { randomUUID, createHash } from "node:crypto";
import { Timestamp, FieldValue } from "firebase-admin/firestore";
import { financialDbAdmin as db } from "@/lib/firebase-financial-admin";
import { WORKSPACE_ID } from "@/lib/workspace";
import { AppError } from "@/lib/observability/app-error";
import { compareStonePayments } from "@/lib/integrations/stone/anticipation-review";
import { parseStoneAgendaXml } from "@/lib/integrations/stone/agenda-parser";
import { readClassificationCatalog, assertNoOtherSettlement } from "../cash-closures/withdrawal-classification.server";
import { sourceExpenseGuard } from "../cash-closures/withdrawal-classification";
import { financialExpenseAccountingFields } from "../lib/expense-accounting-contract";
import { sourceSettlementSummary } from "../lib/source-settlement";
import { readDailySalesReviewSnapshot } from "../sales-reconciliation/review-state.server";
import { assertNoManualFeeCandidate } from "./manual-candidate.server";
import { recognitionMapping } from "./recognition-mapping.server";
import { feeHash, feeUnits, feeTotalCents } from "./evidence";
import { assertFeeAdmin, feeDependencies, queryFeeEvidence, type FeeContext } from "./source.server";
import { collectSaleRecognition } from "./recognition-source";
import { assertFeePeriodOpen, buildRecognitionBatches, feeComponentIdentity, recognitionExpenseFields, recognitionTransition } from "./recognition";
import { feeRecognitionActionSchema, feeRecognitionPolicySchema, type FeeRecognitionPolicy, type FeeRecognitionRecord, type FeeRecognitionPreview } from "./recognition-contracts";
import type { FeeRequest } from "./contracts";
const OWNED_EXPENSE_FIELDS = ["totalValue", "competenceMonth", "accountingContractVersion", "competenceDate", "dueDate", "accountPlan", "accountId", "accountPlanName", "resultCenterId", "resultCenter", "resultCenterName", "status", "paidAt", "paymentState", "paymentMethod", "cashEffectIncludedInNetReceivable", "sourceSettlement", "settlementSummary", "isApportioned", "hasAccountAllocations", "hasPersonAllocations", "originModule"];
const records = db.collection("financialAcquirerFeeBatches"), claims = db.collection("financialSourceSettlements");
function fail(code: string, message: string): never { throw new AppError({ code: `FEE_RECOGNITION_${code}`, kind: "CONFLICT", safeMessage: message }); }
export type RecognitionDependencies = ReturnType<typeof feeDependencies> & { readReview: typeof readDailySalesReviewSnapshot };
export const recognitionDependencies = (signal?: AbortSignal): RecognitionDependencies => ({ ...feeDependencies(signal), readReview: readDailySalesReviewSnapshot });
export async function readFeeRecognitionPolicy(request: FeeRequest, context: FeeContext) {
  const { mapping, document: doc } = await recognitionMapping(request, context);
  const parsed = feeRecognitionPolicySchema.safeParse(doc.get("feeRecognitionPolicy"));
  return { mapping, policy: parsed.success ? parsed.data : null };
}
export async function previewSaleFees(request: FeeRequest, context: FeeContext, deps = recognitionDependencies()): Promise<FeeRecognitionPreview> {
  assertFeeAdmin(context); const { policy } = await readFeeRecognitionPolicy(request, context);
  const identity = { workspaceId: context.workspace_id, kioskId: request.kioskId, mappingId: request.mappingId, stoneCode: request.stoneCode, referenceDate: request.referenceDate };
  const [review, file, pix, existing, centers, referenceSource] = await Promise.all([
    deps.readReview(identity), request.source === "cards" ? deps.readStone(request).then(xml => parseStoneAgendaXml(xml, request)) : null,
    request.source === "pix" ? deps.readPix(identity) : null,
    records.where("workspaceId", "==", context.workspace_id).where("unitId", "==", request.kioskId).where("stoneCode", "==", request.stoneCode).where("referenceDate", "==", request.referenceDate).where("source", "==", request.source).limit(101).get(),
    db.collection("resultCenters").where("unitIds", "array-contains", request.kioskId).limit(26).get(),
    readConfirmedRateReferences(identity),
  ]);
  if (existing.size > 100 || centers.size > 25) fail("LIMIT", "Volume acima do limite da prévia. Nenhuma escrita realizada.");
  let currentReview = review;
  if (review) { const head = await db.collection("dailySalesReviews").doc(review.review.id).get();
    if (head.get("status") !== "closed" || head.get("revision") !== review.review.revision || head.get("workspaceId") !== context.workspace_id || head.get("kioskId") !== request.kioskId) currentReview = null;
  }
  const evidence = collectSaleRecognition({ request, workspaceId: context.workspace_id, file, pix, review: currentReview, policy, references: referenceSource.references });
  if (referenceSource.unresolved) evidence.pending.push("Há referências legadas sem escopo/vigência comprovados; confira a aba Taxas.");
  if (!policy?.enabled) evidence.pending.push("Configure somente a classificação contábil e a autorização de apuração; os percentuais confirmados da aba Taxas são reutilizados.");
  const legacyId = createHash("sha256").update(`${context.workspace_id}:${request.stoneCode}:${request.referenceDate.slice(0, 7)}`).digest("hex");
  const legacy = await db.collection("stoneFeeMonthExpenses").doc(legacyId).get();
  if (legacy.get("active")) evidence.pending.push("Há lançamento mensal legado ativo. Revise o histórico antes de reconhecer componentes, sem migrar automaticamente.");
  return { request, batches: evidence.batches, pending: evidence.pending, policy, referenceFingerprint:feeHash(referenceSource),
    records: existing.docs.filter(d => d.get("schemaVersion") === 2).map(d => d.data() as FeeRecognitionRecord),
    centers: centers.docs.filter(d => (d.get("workspaceId") ?? WORKSPACE_ID) === context.workspace_id && d.get("active") !== false && d.get("unitIds")?.length === 1)
      .map(d => ({ id: d.id, name: String(d.get("name") || d.id) })),
    sourceStatus: currentReview?.review.status === "closed" ? "Vendas conciliadas; conferir taxa por componente" : "Conciliação PDV pendente" };
}
async function validateTransactionScope(tx: FirebaseFirestore.Transaction, request: FeeRequest, context: FeeContext, policy: FeeRecognitionPolicy, batch?: import("./recognition-contracts").FeeRecognitionBatch, expectedReferences?: string) {
  const { document: mappingDoc } = await recognitionMapping(request, context, tx);
  if (feeHash(feeRecognitionPolicySchema.parse(mappingDoc.get("feeRecognitionPolicy"))) !== feeHash(policy)) fail("POLICY_CHANGED", "Configuração mudou; atualize a prévia.");
  if (expectedReferences) {
    const latest = await readConfirmedRateReferences({workspaceId:context.workspace_id,mappingId:request.mappingId,kioskId:request.kioskId,stoneCode:request.stoneCode},tx);
    if(feeHash(latest)!==expectedReferences) fail("REFERENCE_CHANGED","Referências confirmadas mudaram; atualize a prévia antes de reconhecer.");
    for (const member of batch?.members??[]) if (member.rateReference) { const reference=referenceOnDate(latest.references,member.rateReference.groupKey,member.soldOn); if (!reference || feeHash(rateReferenceEvidence(reference))!==feeHash(member.rateReference)) fail("REFERENCE_CHANGED","Referência confirmada mudou; atualize a prévia antes de reconhecer."); }
  }
  assertFeePeriodOpen(policy, request.referenceDate.slice(0, 7));
  const legacyId = createHash("sha256").update(`${context.workspace_id}:${request.stoneCode}:${request.referenceDate.slice(0, 7)}`).digest("hex");
  const legacy = await tx.get(db.collection("stoneFeeMonthExpenses").doc(legacyId)); if (legacy.get("active")) fail("LEGACY_ACTIVE", "Lançamento mensal legado ativo; revisão necessária antes de reconhecer novamente.");
}
export async function executeSaleFeeAction(raw: unknown, context: FeeContext, deps = recognitionDependencies()) {
  assertFeeAdmin(context); const parsed = feeRecognitionActionSchema.safeParse(raw); if (!parsed.success) fail("INPUT", "Pedido de apuração inválido.");
  const input = parsed.data; if (input.action === "preview_sales") return previewSaleFees(input.request, context, deps);
  if (input.action === "candidates_sale") {
    const preview = await previewSaleFees(input.request, context, deps), batch = preview.batches.find(b => b.id === input.batchId && b.fingerprint === input.fingerprint);
    if (!batch || !preview.policy || !preview.centers.some(c => c.id === input.resultCenterId)) fail("CANDIDATES_SCOPE", "Prévia/centro fora do escopo.");
    const found = await db.collection("expenses").where("competenceMonth", "==", batch.soldOn.slice(0, 7)).where("resultCenterId", "==", input.resultCenterId).where("totalValue", "==", batch.amountCents / 100).limit(26).get();
    if (found.size > 25) fail("LIMIT", "Mais de25 candidatos; refine a revisão manual.");
    return { candidates: found.docs.filter(d => (d.get("workspaceId") ?? WORKSPACE_ID) === context.workspace_id && d.get("status") === "pending" && !d.get("sourceSettlement") && !d.get("hasAccountAllocations") && !d.get("hasPersonAllocations") && !d.get("isApportioned") && !d.get("installments")?.length && (d.get("accountId") ?? d.get("accountPlan")) === preview.policy!.variableAccountId).map(d => ({ id: d.id, fingerprint: sourceExpenseGuard(d.data()) })) };
  }
  if (input.action === "settle_sales") return settleSaleFees(input.request, input.paymentDate, input.reason, context, deps);
  const { policy } = await readFeeRecognitionPolicy(input.request, context); if (!policy) fail("POLICY_MISSING", "Configure as contas e a política de apuração; nenhuma tarifa é presumida.");
  if (input.action === "reverse_sale") return db.runTransaction(async tx => {
    await validateTransactionScope(tx, input.request, context, policy); const ref = records.doc(input.batchId), snap = await tx.get(ref); const previous = snap.data() as FeeRecognitionRecord | undefined;
    if (!previous || previous.schemaVersion !== 2 || previous.workspaceId !== context.workspace_id || previous.unitId !== input.request.kioskId || previous.stoneCode !== input.request.stoneCode || previous.source !== input.request.source || previous.referenceDate !== input.request.referenceDate) fail("SCOPE", "Apuração fora do escopo.");
    if (previous.revision !== input.expectedRevision) fail("REVISION", "Apuração mudou; atualize o histórico."); if (!previous.active) return { record: previous, idempotent: true };
    const expense = previous.expenseId ? await tx.get(db.collection("expenses").doc(previous.expenseId)) : null;
    const links = await Promise.all(previous.batch.members.map(m => tx.get(claims.doc(m.id))));
    if (expense && (!expense.exists || sourceExpenseGuard(expense.data()!) !== previous.expenseGuard) || links.some(d => d.get("batchId") !== previous.id || d.get("revision") !== previous.revision)) fail("CHANGED", "A origem foi alterada por outro fluxo.");
    assertFeePeriodOpen(policy, previous.batch.soldOn.slice(0, 7));
    if (expense) { assertFeePeriodOpen(policy, String(expense.get("competenceMonth") ?? previous.batch.soldOn.slice(0, 7))); await assertNoOtherSettlement(tx, expense.id, expense.data()!); }
    let reversedExpense: Record<string, unknown> | null = expense?.data() ?? null;
    const at = new Date().toISOString(); if (expense) {
      if (previous.createdExpense === false) { const restore: Record<string, unknown> = { ...previous.previousFields, updatedAt: at }; reversedExpense = { ...expense.data(), ...previous.previousFields, updatedAt: at }; for (const key of previous.previousMissing ?? []) { restore[key] = FieldValue.delete(); delete reversedExpense[key]; } tx.update(expense.ref, restore); }
      else { const patch = { status: "cancelled", updatedAt: at, sourceSettlementReversal: { reason: input.reason, reversedAt: at, reversedBy: context.decoded.uid } }; reversedExpense = { ...expense.data(), ...patch }; tx.update(expense.ref, patch); }
    }
    for (const claim of links) tx.update(claim.ref, { active: false, updatedAt: at });
    const record: FeeRecognitionRecord = { ...previous, active: false, state: "cancelled", revision: previous.revision + 1, expenseGuard: reversedExpense ? sourceExpenseGuard(reversedExpense) : null, updatedAt: at };
    tx.set(ref, record); tx.create(ref.collection("events").doc(randomUUID()), { type: "reversed", actorId: context.decoded.uid, at, reason: input.reason, deltaCents: -previous.batch.amountCents });
    return { record, idempotent: false };
  });
  const preview = await previewSaleFees(input.request, context, deps); const batch = preview.batches.find(b => b.id === input.batchId);
  if (!batch || batch.fingerprint !== input.fingerprint) fail("STALE_PREVIEW", "Fonte mudou ou não é elegível. Atualize a prévia.");
  return db.runTransaction(async tx => {
    await validateTransactionScope(tx, input.request, context, policy, batch, preview.referenceFingerprint); const ref = records.doc(batch.id), current = await tx.get(ref);
    const previous = current.exists ? current.data() as FeeRecognitionRecord : null;
    if (previous && (previous.schemaVersion !== 2 || previous.workspaceId !== context.workspace_id || previous.unitId !== input.request.kioskId || previous.stoneCode !== input.request.stoneCode)) fail("LEGACY_REVIEW", "Registro legado ou de outro escopo exige revisão.");
    if (previous?.active && previous.receivedComponentIds.length && previous.batch.fingerprint !== batch.fingerprint) fail("SETTLED_REVISION", "Há parcelas liquidadas. Revise pelo arquivo de pagamentos ou reverta explicitamente, sem substituir evidência por previsão.");
    const transition = recognitionTransition({ previous, batch, expectedRevision: input.expectedRevision, action: input.action === "link_sale" ? "recognize_sale" : input.action, reason: input.reason, policy });
    const links = await Promise.all(batch.members.map(m => tx.get(claims.doc(m.id))));
    if (links.some(d => d.get("active") && (d.get("batchId") !== batch.id || !previous || d.get("revision") !== previous.revision || d.get("workspaceId") !== context.workspace_id || d.get("unitId") !== input.request.kioskId))) fail("OVERLAP", "Componente já reconhecido em outro grupo/legado. Não foi duplicado.");
    for (const m of batch.members) { const review = await tx.get(db.collection("dailySalesReviews").doc(m.reviewId));
      if (review.get("workspaceId") !== context.workspace_id || review.get("kioskId") !== input.request.kioskId || review.get("status") !== "closed" || review.get("revision") !== m.reviewRevision || review.get("sourceFingerprint") !== m.reviewFingerprint) fail("REVIEW_CHANGED", "Conciliação mudou; não foi reconhecida a taxa.");
      if (input.request.source === "pix") { const pix = await tx.get(db.collection("stonePixConciliationFiles").doc(m.sourceFileId)); if (pix.get("workspaceId") !== context.workspace_id || pix.get("sourceHash") !== m.sourceHash) fail("SOURCE_CHANGED", "Arquivo PIX mudou."); }
    }
    const accountId = batch.kind === "anticipation" ? policy.financialAccountId : policy.variableAccountId;
    const catalog = await readClassificationCatalog(tx, { workspaceId: context.workspace_id, unitId: input.request.kioskId }, accountId, input.resultCenterId);
    const account = await tx.get(db.collection("accounts").doc(accountId)); if (account.get("dre_position") !== (batch.kind === "anticipation" ? "despesas_financeiras" : "custos_variaveis") || account.get("is_dre_account") === false) fail("ACCOUNT_POSITION", "Conta da tarifa deve estar na posição DRE configurada; legado não foi recategorizado.");
    if (input.action === "link_sale" && (previous || !input.expenseId || !input.expenseFingerprint || batch.amountCents <= 0)) fail("LINK_INPUT", "Vincule uma despesa manual pelo ID e impressão atuais, sem apuração anterior.");
    const expenseId = previous?.expenseId ?? (input.action === "link_sale" ? input.expenseId! : batch.amountCents > 0 ? `acquirer_fee_${batch.id}_recognized` : null);
    const expenseSnap = expenseId ? await tx.get(db.collection("expenses").doc(expenseId)) : null;
    if (previous?.expenseId && (!expenseSnap?.exists || sourceExpenseGuard(expenseSnap.data()!) !== previous.expenseGuard)) fail("EXPENSE_CHANGED", "Despesa foi alterada; revisão manual necessária.");
    if (input.action === "link_sale") {
      const manual = expenseSnap?.data();
      if (!manual || sourceExpenseGuard(manual) !== input.expenseFingerprint || (manual.workspaceId ?? WORKSPACE_ID) !== context.workspace_id || manual.status !== "pending" || manual.sourceSettlement || manual.budgetMigration || manual.hasAccountAllocations || manual.hasPersonAllocations || manual.isApportioned || manual.installments?.length || manual.competenceMonth !== batch.soldOn.slice(0, 7) || Math.round(Number(manual.totalValue) * 100) !== batch.amountCents || (manual.accountId ?? manual.accountPlan) !== accountId || manual.resultCenterId !== catalog.resultCenterId) fail("LINK_CHANGED", "A despesa manual não corresponde à prévia/classificação ou foi alterada. Nenhum vínculo criado.");
    }
    if (!previous && input.action !== "link_sale" && expenseSnap?.exists) fail("COLLISION", "Já existe despesa com este ID.");
    if (expenseSnap?.exists) await assertNoOtherSettlement(tx, expenseSnap.id, expenseSnap.data()!);
    if (transition.idempotent) return { record: previous!, idempotent: true };
    if (!expenseSnap?.exists && batch.amountCents > 0) await assertNoManualFeeCandidate(tx, { workspaceId: context.workspace_id, month: batch.soldOn.slice(0, 7), resultCenterId: catalog.resultCenterId, amountCents: batch.amountCents });
    const at = new Date().toISOString(), received = batch.members.filter(m => !!m.settledOn).map(m => m.id), state = recognitionExpenseFields(batch, received);
    const source = { version: 1, kind: "acquirer_fee", sourceId: batch.id, fingerprint: batch.fingerprint, amountCents: batch.amountCents, competenceMonth: batch.soldOn.slice(0, 7), settledOn: state.paidOn,
      phase: state.state === "received" ? "settled" : state.state === "partially_received" ? "partial" : "receivable", expectedOn: batch.dueOn, estimated: batch.measurement === "estimated", sourceIncomplete: preview.pending.length > 0, workspaceId: context.workspace_id, unitId: input.request.kioskId };
    const expense = { ...(expenseSnap?.data() ?? {}), workspaceId: context.workspace_id, kioskId: input.request.kioskId, description: expenseSnap?.get("description") ?? `Taxa ${batch.kind === "pix" ? "PIX" : "de cartão"} · venda ${batch.soldOn}`, totalValue: batch.amountCents / 100,
      ...financialExpenseAccountingFields({ competenceMonth: batch.soldOn.slice(0, 7) }), competenceDate: Timestamp.fromDate(new Date(`${batch.soldOn}T12:00:00Z`)), dueDate: Timestamp.fromDate(new Date(`${batch.dueOn}T12:00:00Z`)),
      accountPlan: accountId, accountId, accountPlanName: catalog.accountPlanName, resultCenterId: catalog.resultCenterId, resultCenter: catalog.resultCenterName, resultCenterName: catalog.resultCenterName,
      status: batch.amountCents === 0 ? "cancelled" : state.status, paidAt: state.paidOn ? Timestamp.fromDate(new Date(`${state.paidOn}T12:00:00Z`)) : null,
      paymentState: state.paymentState, paymentMethod: "single", cashEffectIncludedInNetReceivable: true, sourceSettlement: source,
      ...(state.paidOn ? { settlementSummary: sourceSettlementSummary(batch.amountCents) } : {}), isApportioned: false, hasAccountAllocations: false, hasPersonAllocations: false, originModule: "acquirer_fee", createdAt: expenseSnap?.get("createdAt") ?? at, createdBy: expenseSnap?.get("createdBy") ?? context.decoded.uid, updatedAt: at };
    delete (expense as Record<string, unknown>).sourceSettlementReversal;
    if (!state.paidOn) delete (expense as Record<string, unknown>).settlementSummary;
    const record: FeeRecognitionRecord = { schemaVersion: 2, id: batch.id, workspaceId: context.workspace_id, unitId: input.request.kioskId, stoneCode: input.request.stoneCode, referenceDate: input.request.referenceDate, source: input.request.source,
      active: true, revision: transition.revision, batch, expenseId, createdExpense: previous?.createdExpense ?? input.action !== "link_sale",
      ...(input.action === "link_sale" ? { previousFields: Object.fromEntries(OWNED_EXPENSE_FIELDS.filter(k => Object.hasOwn(expenseSnap!.data()!, k)).map(k => [k, expenseSnap!.get(k)])), previousMissing: OWNED_EXPENSE_FIELDS.filter(k => !Object.hasOwn(expenseSnap!.data()!, k)) } : previous?.createdExpense === false ? { previousFields: previous.previousFields!, previousMissing: previous.previousMissing! } : {}), accountPlanId: accountId, resultCenterId: catalog.resultCenterId, resultCenterName: catalog.resultCenterName, policyVersion: policy.version,
      state: state.state, receivedComponentIds: received, expenseGuard: expenseId ? sourceExpenseGuard(expense) : null, updatedAt: at };
    if (expenseId) tx.set(db.collection("expenses").doc(expenseId), expense);
    tx.set(ref, record); for (const m of batch.members) tx.set(claims.doc(m.id), { kind: "acquirer_fee", batchId: batch.id, revision: record.revision, active: true, workspaceId: context.workspace_id, unitId: input.request.kioskId, fingerprint: feeHash(m), updatedAt: at });
    tx.create(ref.collection("events").doc(randomUUID()), { type: previous ? "revised" : "recognized", revision: record.revision, actorId: context.decoded.uid, at, reason: input.reason ?? null, deltaCents: transition.deltaCents, evidence: batch, expenseId });
    return { record, idempotent: false };
  });
}
async function settleSaleFees(request: FeeRequest, paymentDate: string, reason: string | undefined, context: FeeContext, deps: RecognitionDependencies) {
  // Implemented below with source-confirmed payment components; never a blind status toggle.
  return settleRecognitionFromPayments(request, paymentDate, reason, context, deps);
}
async function settleRecognitionFromPayments(request: FeeRequest, paymentDate: string, reason: string | undefined, context: FeeContext, deps: RecognitionDependencies) {
  const { policy } = await readFeeRecognitionPolicy(request, context); if (!policy) fail("POLICY_MISSING", "Configuração de taxas ausente.");
  assertFeePeriodOpen(policy, paymentDate.slice(0, 7));
  const evidence = await queryFeeEvidence({ ...request, referenceDate: paymentDate }, context, deps);
  if (!evidence.paymentFile || request.source !== "cards") fail("PAYMENT_SOURCE", "Liquidação posterior exige arquivo de pagamentos de cartão. PIX confirmado é quitado pelo evento próprio.");
  const compared = compareStonePayments(evidence.paymentFile, evidence.originalFiles);
  const pending = [...evidence.pending]; const updated: FeeRecognitionRecord[] = [];
  const history = await records.where("workspaceId", "==", context.workspace_id).where("unitId", "==", request.kioskId).where("stoneCode", "==", request.stoneCode).where("referenceDate", "==", request.referenceDate).where("source", "==", request.source).limit(101).get();
  if (history.size > 100) fail("LIMIT", "Histórico excede limite por venda.");
  for (const document of history.docs.filter(d => d.get("schemaVersion") === 2 && d.get("active") && d.get("batch.kind") !== "anticipation")) {
    const seed = document.data() as FeeRecognitionRecord;
    const paid = seed.batch.members.flatMap(member => {
      const rows = compared.rows.filter(row => row.transactionId === member.transactionId && row.installment === member.installment);
      if (rows.length !== 1) return []; const row = rows[0];
      if (row.status === "needs_review" || !row.paymentId || row.paymentDate !== paymentDate || row.saleDate !== member.soldOn) { pending.push("Parcela paga sem origem/data inequívoca."); return []; }
      try {
        const gross = feeUnits(row.gross), net = feeUnits(row.paidNet), advance = row.anticipationFee === null ? BigInt(0) : feeUnits(row.anticipationFee);
        if (gross !== feeUnits(member.grossDecimal) || net > gross || advance > BigInt(0) && !row.providerAnticipationConfirmed) { pending.push("Pagamento/antecipação não comprovados."); return []; }
        const actualFee = row.mdr ?? (net === feeUnits(member.expectedNetDecimal) && advance === BigInt(0) ? member.feeDecimal : null);
        if (actualFee === null || feeUnits(actualFee) + advance !== gross - net) { pending.push("Diferença de liquidação sem descontos segregados; nenhuma taxa inventada."); return []; }
        return [{ memberId: member.id, feeDecimal: actualFee, paidNetDecimal: row.paidNet, anticipationDecimal: row.anticipationFee, settledOn: paymentDate, paymentId: row.paymentId }];
      } catch { pending.push("Valores inválidos no pagamento."); return []; }
    });
    if (!paid.length) continue;
    const next = await db.runTransaction(async tx => {
      await validateTransactionScope(tx, request, context, policy); const snap = await tx.get(document.ref); const previous = snap.data() as FeeRecognitionRecord;
      if (!previous?.active || previous.revision !== seed.revision || previous.batch.fingerprint !== seed.batch.fingerprint) fail("REVISION", "Apuração mudou durante liquidação. Atualize antes de repetir.");
      let oldExpense = previous.expenseId ? await tx.get(db.collection("expenses").doc(previous.expenseId)) : null;
      if (oldExpense && (!oldExpense.exists || sourceExpenseGuard(oldExpense.data()!) !== previous.expenseGuard)) fail("EXPENSE_CHANGED", "Despesa alterada por outro fluxo.");
      const linkDocs = await Promise.all(previous.batch.members.map(m => tx.get(claims.doc(m.id))));
      if (linkDocs.some(d => !d.get("active") || d.get("batchId") !== previous.id || d.get("revision") !== previous.revision)) fail("CLAIM_CHANGED", "Origem alterada durante a liquidação.");
      for (const member of previous.batch.members) { const review = await tx.get(db.collection("dailySalesReviews").doc(member.reviewId));
        if (review.get("status") !== "closed" || review.get("sourceFingerprint") !== member.reviewFingerprint || review.get("revision") !== member.reviewRevision) fail("REVIEW_CHANGED", "Conciliação da venda foi reaberta; revisão necessária."); }
      if (oldExpense) await assertNoOtherSettlement(tx, oldExpense.id, oldExpense.data()!);
      const members = previous.batch.members.map(member => { const fact = paid.find(p => p.memberId === member.id); return fact ? { ...member, feeDecimal: fact.feeDecimal, measurement: "assessed" as const, settledOn: fact.settledOn, paidNetDecimal: fact.paidNetDecimal, anticipationDecimal: fact.anticipationDecimal } : member; });
      const batch = { ...previous.batch, members, fingerprint: feeHash(members), amountCents: feeTotalCents(members.map(m => m.feeDecimal)), measurement: members.some(m => m.measurement === "estimated") ? "estimated" as const : "assessed" as const };
      const received = members.filter(m => m.settledOn).map(m => m.id); const fields = recognitionExpenseFields(batch, received);
      if (batch.fingerprint === previous.batch.fingerprint && fields.state === previous.state) return previous;
      const delta = batch.amountCents - previous.batch.amountCents; if (delta && !reason) fail("DELTA_REASON", "Confirme a diferença apurada com motivo antes de ajustar a taxa.");
      let createdBase: Record<string, unknown> | null = null;
      if (batch.amountCents > 0 && !oldExpense) {
        oldExpense = await tx.get(db.collection("expenses").doc(`acquirer_fee_${previous.id}_recognized`));
        if (oldExpense.exists) fail("COLLISION", "Há despesa sem o vínculo esperado.");
        const catalog = await readClassificationCatalog(tx, { workspaceId: context.workspace_id, unitId: request.kioskId }, policy.variableAccountId, previous.resultCenterId);
        const account = await tx.get(db.collection("accounts").doc(policy.variableAccountId));
        if (account.get("dre_position") !== "custos_variaveis" || account.get("is_dre_account") === false) fail("ACCOUNT_POSITION", "MDR deve estar em custos variáveis.");
        await assertNoManualFeeCandidate(tx, { workspaceId: context.workspace_id, month: previous.batch.soldOn.slice(0, 7), resultCenterId: previous.resultCenterId, amountCents: batch.amountCents });
        createdBase = { workspaceId: context.workspace_id, kioskId: request.kioskId, description: `Taxa de cartão · venda ${previous.batch.soldOn}`,
          ...financialExpenseAccountingFields({ competenceMonth: previous.batch.soldOn.slice(0, 7) }), competenceDate: Timestamp.fromDate(new Date(`${previous.batch.soldOn}T12:00:00Z`)), dueDate: Timestamp.fromDate(new Date(`${previous.batch.dueOn}T12:00:00Z`)),
          accountPlan: policy.variableAccountId, accountId: policy.variableAccountId, accountPlanName: catalog.accountPlanName, resultCenterId: catalog.resultCenterId, resultCenter: catalog.resultCenterName, resultCenterName: catalog.resultCenterName,
          paymentMethod: "single", cashEffectIncludedInNetReceivable: true, isApportioned: false, hasAccountAllocations: false, hasPersonAllocations: false, originModule: "acquirer_fee", createdAt: new Date().toISOString(), createdBy: context.decoded.uid };
      }
      const at = new Date().toISOString(); const source = oldExpense?.get("sourceSettlement") ?? { version: 1, kind: "acquirer_fee", sourceId: previous.id, competenceMonth: previous.batch.soldOn.slice(0, 7), expectedOn: previous.batch.dueOn, sourceIncomplete: false, workspaceId: context.workspace_id, unitId: request.kioskId };
      const expense = oldExpense ? { ...(createdBase ?? oldExpense.data()), totalValue: batch.amountCents / 100, status: batch.amountCents === 0 ? "cancelled" : fields.status,
        paymentState: fields.paymentState, paidAt: fields.paidOn ? Timestamp.fromDate(new Date(`${fields.paidOn}T12:00:00Z`)) : null,
        sourceSettlement: { ...source, fingerprint: batch.fingerprint, amountCents: batch.amountCents, phase: fields.state === "received" ? "settled" : "partial", settledOn: fields.paidOn, estimated: batch.measurement === "estimated" },
        ...(fields.paidOn ? { settlementSummary: sourceSettlementSummary(batch.amountCents) } : {}), updatedAt: at } : null;
      const record: FeeRecognitionRecord = { ...previous, expenseId: oldExpense?.id ?? previous.expenseId, accountPlanId: createdBase ? policy.variableAccountId : previous.accountPlanId, batch, receivedComponentIds: received, state: fields.state, revision: previous.revision + 1, expenseGuard: expense ? sourceExpenseGuard(expense) : null, updatedAt: at };
      if (oldExpense && expense) tx.set(oldExpense.ref, expense);
      tx.set(document.ref, record); for (const member of members) tx.set(claims.doc(member.id), { kind: "acquirer_fee", batchId: previous.id, revision: record.revision, active: true, workspaceId: context.workspace_id, unitId: request.kioskId, fingerprint: feeHash(member), updatedAt: at });
      tx.create(document.ref.collection("events").doc(randomUUID()), { type: "source_receipt", actorId: context.decoded.uid, at, reason: reason ?? null, deltaCents: delta, paymentFileId: evidence.paymentFileId, originalFileIds: evidence.originalFileIds, payments: paid });
      return record;
    });
    updated.push(next);
    const anticipation = await recognizeConfirmedAnticipation(next, paid, request, paymentDate, reason, context, policy, evidence);
    updated.push(...anticipation);
  }
  return { updated, pending: [...new Set(pending)] };
}

/** Separate financial component, sourced only from segregated, confirmed anticipation. */
async function recognizeConfirmedAnticipation(parent: FeeRecognitionRecord,
  paid: Array<{ memberId: string; anticipationDecimal: string | null; paidNetDecimal: string; settledOn: string; paymentId: string }>,
  request: FeeRequest, paymentDate: string, reason: string | undefined, context: FeeContext, policy: FeeRecognitionPolicy,
  evidence: Awaited<ReturnType<typeof queryFeeEvidence>>) {
  const components = parent.batch.members.flatMap(member => {
    const fact = paid.find(p => p.memberId === member.id);
    if (fact?.anticipationDecimal == null) return [];
    return [{ ...member, id: feeComponentIdentity(context.workspace_id, request.stoneCode, member.transactionId, member.installment, "anticipation"),
      kind: "anticipation" as const, soldOn: paymentDate, dueOn: paymentDate, feeDecimal: fact.anticipationDecimal,
      measurement: "assessed" as const, basis: "provider_fee" as const, sourceFileId: evidence.paymentFileId!,
      sourceHash: feeHash(evidence.paymentFile), settledOn: paymentDate, paidNetDecimal: fact.paidNetDecimal, contractId: null, contractVersion: null }];
  });
  const results: FeeRecognitionRecord[] = [];
  for (const batch of buildRecognitionBatches(context.workspace_id, request.kioskId, request.stoneCode, components)) {
    const record = await db.runTransaction(async tx => {
      await validateTransactionScope(tx, request, context, policy); assertFeePeriodOpen(policy, paymentDate.slice(0, 7));
      const parentSnap = await tx.get(records.doc(parent.id));
      if (parentSnap.get("revision") !== parent.revision || !parentSnap.get("active")) fail("PARENT_CHANGED", "Recebimento mudou antes da apuração financeira.");
      const ref = records.doc(batch.id), previousSnap = await tx.get(ref), previous = previousSnap.exists ? previousSnap.data() as FeeRecognitionRecord : null;
      if (previous && (previous.schemaVersion !== 2 || previous.workspaceId !== context.workspace_id || previous.unitId !== request.kioskId || previous.batch.kind !== "anticipation")) fail("SCOPE", "Origem financeira fora do escopo.");
      if (!previous && batch.amountCents === 0) return null;
      const expenseId = previous?.expenseId ?? `acquirer_fee_${batch.id}_recognized`, expenseSnap = await tx.get(db.collection("expenses").doc(expenseId));
      const links = await Promise.all(batch.members.map(m => tx.get(claims.doc(m.id))));
      if (links.some(d => d.get("active") && d.get("batchId") !== batch.id)) fail("OVERLAP", "Antecipação já vinculada em outro grupo; não duplicada.");
      if (previous && (!expenseSnap.exists || sourceExpenseGuard(expenseSnap.data()!) !== previous.expenseGuard)) fail("EXPENSE_CHANGED", "Despesa financeira alterada; revisão necessária.");
      if (!previous && expenseSnap.exists) fail("COLLISION", "Despesa financeira já existe sem vínculo esperado.");
      if (previous && previous.batch.fingerprint === batch.fingerprint && (previous.active || batch.amountCents === 0)) return previous;
      if (previous && !reason) fail("DELTA_REASON", "Informe motivo para ajustar a antecipação comprovada.");
      if (expenseSnap.exists) await assertNoOtherSettlement(tx, expenseId, expenseSnap.data()!);
      const catalog = await readClassificationCatalog(tx, { workspaceId: context.workspace_id, unitId: request.kioskId }, policy.financialAccountId, parent.resultCenterId);
      const account = await tx.get(db.collection("accounts").doc(policy.financialAccountId));
      if (account.get("dre_position") !== "despesas_financeiras" || account.get("is_dre_account") === false) fail("ACCOUNT_POSITION", "Antecipação exige conta financeira ativa.");
      if (!previous) await assertNoManualFeeCandidate(tx, { workspaceId: context.workspace_id, month: paymentDate.slice(0, 7), resultCenterId: parent.resultCenterId, amountCents: batch.amountCents });
      const at = new Date().toISOString();
      const expense = { workspaceId: context.workspace_id, kioskId: request.kioskId, description: `Antecipação comprovada · ${paymentDate}`, totalValue: batch.amountCents / 100,
        ...financialExpenseAccountingFields({ competenceMonth: paymentDate.slice(0, 7) }), competenceDate: Timestamp.fromDate(new Date(`${paymentDate}T12:00:00Z`)), dueDate: Timestamp.fromDate(new Date(`${paymentDate}T12:00:00Z`)),
        accountPlan: policy.financialAccountId, accountId: policy.financialAccountId, accountPlanName: catalog.accountPlanName,
        resultCenterId: catalog.resultCenterId, resultCenter: catalog.resultCenterName, resultCenterName: catalog.resultCenterName,
        status: batch.amountCents === 0 ? "cancelled" : "paid", paidAt: batch.amountCents === 0 ? null : Timestamp.fromDate(new Date(`${paymentDate}T12:00:00Z`)), paymentState: batch.amountCents === 0 ? "open" : "paid", paymentMethod: "single", cashEffectIncludedInNetReceivable: true,
        sourceSettlement: { version: 1, kind: "acquirer_fee", sourceId: batch.id, fingerprint: batch.fingerprint, amountCents: batch.amountCents, competenceMonth: paymentDate.slice(0, 7), settledOn: paymentDate, phase: "settled", expectedOn: paymentDate, estimated: false, sourceIncomplete: false, workspaceId: context.workspace_id, unitId: request.kioskId },
        settlementSummary: sourceSettlementSummary(batch.amountCents), isApportioned: false, hasAccountAllocations: false, hasPersonAllocations: false, originModule: "acquirer_fee", createdAt: expenseSnap.get("createdAt") ?? at, createdBy: expenseSnap.get("createdBy") ?? context.decoded.uid, updatedAt: at };
      const next: FeeRecognitionRecord = { schemaVersion: 2, id: batch.id, workspaceId: context.workspace_id, unitId: request.kioskId, stoneCode: request.stoneCode, referenceDate: request.referenceDate, source: request.source,
        active: batch.amountCents > 0, revision: (previous?.revision ?? 0) + 1, batch, expenseId, accountPlanId: policy.financialAccountId, resultCenterId: catalog.resultCenterId, resultCenterName: catalog.resultCenterName, policyVersion: policy.version,
        state: batch.amountCents === 0 ? "cancelled" : "received", receivedComponentIds: batch.members.map(m => m.id), expenseGuard: sourceExpenseGuard(expense), updatedAt: at };
      tx.set(expenseSnap.ref, expense); tx.set(ref, next);
      for (const member of batch.members) tx.set(claims.doc(member.id), { kind: "acquirer_fee", batchId: batch.id, revision: next.revision, active: batch.amountCents > 0, workspaceId: context.workspace_id, unitId: request.kioskId, fingerprint: feeHash(member), updatedAt: at });
      tx.create(ref.collection("events").doc(randomUUID()), { type: "confirmed_anticipation", parentId: parent.id, actorId: context.decoded.uid, actorNamespace: "main.users", at, reason: reason ?? null, deltaCents: batch.amountCents - (previous?.active ? previous.batch.amountCents : 0), paymentFileId: evidence.paymentFileId, sourceHash: feeHash(evidence.paymentFile), payments: paid });
      return next;
    });
    if (record) results.push(record);
  }
  return results;
}
