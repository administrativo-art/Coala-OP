import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
  buildCardStatementImportFingerprint,
  cardStatementCreditTotal,
  type CardStatementExcludedEntry,
  type CardStatementImportLine,
  type CardStatementPreviousImportLine,
  type CardStatementRevisionLine,
} from "@/features/financial/lib/card-statement-import";
import { cardStatementImportId } from "@/features/financial/card-statement-import-versioning.server";
import {
  identifyCardStatementFinancialCharge,
  resolveCardStatementFinancialCharge,
} from "@/features/financial/lib/expense-description-catalog";
import {
  canRegisterCardStatementAsHistorical,
  cardStatementAllocationIntegrity,
} from "@/features/financial/lib/card-invoices";
import { FINANCIAL_DRE_START_MONTH_KEY } from "@/features/financial/lib/constants";
import { requireUser } from "@/lib/auth-server";
import { financialDbAdmin } from "@/lib/firebase-financial-admin";
import { reportSystemError } from "@/lib/observability";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const CARD_STATEMENT_HISTORY_PREFLIGHT_LIMIT = 241;

const lineSchema = z.object({
  id: z.string().min(1).max(300),
  sourceReference: z.string().min(1).max(300),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  description: z.string().trim().min(1).max(500),
  supplier: z.string().trim().max(500),
  amount: z.number().positive().max(100_000_000),
  installmentNumber: z.number().int().positive().nullable(),
  installmentTotal: z.number().int().positive().nullable(),
  confidence: z.enum(["high", "medium", "low"]),
  reviewNotes: z.array(z.string().max(300)).max(8),
  fingerprint: z.string().min(1).max(200),
  resolution: z.discriminatedUnion("mode", [
    z.object({ mode: z.literal("create") }),
    z.object({
      mode: z.literal("existing"),
      expenseId: z.string().min(1).max(300),
      candidateLineId: z.string().min(1).max(500),
      installmentNumber: z.number().int().positive().nullable(),
    }),
  ]),
});

const requestSchema = z.object({
  importId: z.string().min(1).max(100),
  fileSha256: z.string().regex(/^[a-f0-9]{64}$/),
  revisionAction: z.enum(["none", "reopen"]),
  registrationMode: z.enum(["standard", "historical_before_dre"]).default("standard"),
  accountId: z.string().min(1).max(300),
  accountName: z.string().max(500),
  paymentMethodId: z.string().min(1).max(300),
  paymentMethodLabel: z.string().max(500),
  monthKey: z.string().regex(/^\d{4}-\d{2}$/),
  statementKey: z.string().min(1).max(900),
  fileName: z.string().min(1).max(300),
  officialTotal: z.number().positive().nullable(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  closingDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  analysis: z.object({
    status: z.enum(["ready", "review_required", "blocked"]),
    summary: z.string().max(800),
    detectedFormat: z.string().max(200).nullable(),
    excludedCount: z.number().int().min(0),
    promptVersion: z.string().max(100),
    schemaVersion: z.string().max(100).nullable(),
  }),
  lines: z.array(lineSchema).max(200),
});

function errorResponse(error: string, status: number, eventId?: string) {
  return NextResponse.json({ error, ...(eventId ? { eventId } : {}) }, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function asNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function timestamp(isoDate: string) {
  return Timestamp.fromDate(new Date(`${isoDate}T12:00:00-03:00`));
}

type ClassificationOption = { id: string; name: string };
type FinancialChargeDefaults = {
  accountPlansByName: Map<string, ClassificationOption>;
  resultCenter: ClassificationOption | null;
};
type FinancialChargeIdentity = NonNullable<ReturnType<typeof resolveCardStatementFinancialCharge>>;

async function loadFinancialChargeDefaults(
  lines: Array<{ description: string }>,
  bankAccountId: string,
): Promise<FinancialChargeDefaults | null> {
  const requiredPlanNames = [...new Set(lines.flatMap((line) => {
    const kind = identifyCardStatementFinancialCharge(line.description);
    if (!kind) return [];
    return [kind === "card_iof" ? "IOF | tarifas bancárias" : "Juros e multas"];
  }))];
  if (!requiredPlanNames.length) return null;

  const [bankAccountSnapshot, ...accountSnapshots] = await Promise.all([
    financialDbAdmin.collection("bankAccounts").doc(bankAccountId).get(),
    ...requiredPlanNames.map((name) => financialDbAdmin.collection("accounts").where("name", "==", name).limit(2).get()),
  ]);
  const accountPlansByName = new Map<string, ClassificationOption>();
  accountSnapshots.forEach((snapshot, index) => {
    const candidates = snapshot.docs.filter((document) => {
      const data = document.data() ?? {};
      return data.active !== false && data.isGroup !== true;
    });
    if (candidates.length !== 1) return;
    accountPlansByName.set(requiredPlanNames[index]!, {
      id: candidates[0]!.id,
      name: String(candidates[0]!.data().name || requiredPlanNames[index]),
    });
  });

  const resultCenterId = String(bankAccountSnapshot.data()?.resultCenterId || "");
  const resultCenterSnapshot = resultCenterId
    ? await financialDbAdmin.collection("resultCenters").doc(resultCenterId).get()
    : null;
  const resultCenter = resultCenterSnapshot?.exists
    ? { id: resultCenterSnapshot.id, name: String(resultCenterSnapshot.data()?.name || resultCenterSnapshot.id) }
    : null;
  return { accountPlansByName, resultCenter };
}

function automaticFinancialChargeFields(
  identity: FinancialChargeIdentity | null,
  defaults: FinancialChargeDefaults | null,
) {
  if (!identity || !defaults) return {};
  const accountPlan = defaults.accountPlansByName.get(identity.accountPlanName) ?? null;
  return {
    ...(accountPlan ? {
      accountPlan: accountPlan.id,
      accountId: accountPlan.id,
      accountPlanId: accountPlan.id,
      accountPlanName: accountPlan.name,
    } : {}),
    ...(defaults.resultCenter ? {
      resultCenter: defaults.resultCenter.id,
      resultCenterId: defaults.resultCenter.id,
      resultCenterName: defaults.resultCenter.name,
    } : {}),
    cardStatementAutoClassificationRule: "financial-charge-v1",
  };
}

function statementDocumentId(key: string) {
  return key.replaceAll(":", "__").replace(/[^a-zA-Z0-9_-]/g, "_");
}

function existingFingerprints(expense: Record<string, unknown>) {
  return new Set([
    typeof expense.cardStatementImportFingerprint === "string" ? expense.cardStatementImportFingerprint : "",
    ...(Array.isArray(expense.cardStatementImportFingerprints)
      ? expense.cardStatementImportFingerprints.filter((entry): entry is string => typeof entry === "string")
      : []),
  ].filter(Boolean));
}

function inheritedExpenseFields(expense: Record<string, unknown>) {
  const fields = [
    "accountPlan", "accountId", "accountPlanId", "accountPlanName",
    "resultCenter", "resultCenterId", "resultCenterName", "isApportioned", "apportionments",
    "hasAccountAllocations", "accountAllocations", "hasPersonAllocations", "personAllocations",
    "provisionSeriesKey", "provisionCompetence", "provisionScope", "provisionSource",
  ];
  return Object.fromEntries(fields.filter((field) => expense[field] !== undefined).map((field) => [field, expense[field]]));
}

function importedStatementAllocation(
  line: z.infer<typeof lineSchema>,
  expenseId: string,
  monthKey: string,
  expense: Record<string, unknown> = {},
  identity: FinancialChargeIdentity | null = null,
) {
  const installmentNumber = line.resolution.mode === "existing"
    ? line.resolution.installmentNumber
    : line.installmentNumber;
  return {
    lineId: installmentNumber ? `${expenseId}:installment:${installmentNumber}` : expenseId,
    expenseId,
    installmentNumber: installmentNumber ?? null,
    description: identity?.description || line.description,
    supplier: identity?.supplier || line.supplier,
    amount: line.amount,
    competenceDate: `${monthKey}-01`,
    accountPlanId: String(expense.accountPlanId || expense.accountId || expense.accountPlan || ""),
    accountPlanName: String(expense.accountPlanName || ""),
    resultCenterId: String(expense.resultCenterId || expense.resultCenter || ""),
    resultCenterName: String(expense.resultCenterName || ""),
    accountAllocations: Array.isArray(expense.accountAllocations) ? expense.accountAllocations : [],
    apportionments: Array.isArray(expense.apportionments) ? expense.apportionments : [],
    importFingerprint: line.fingerprint,
    sourceReference: line.sourceReference,
  };
}

function appliedImportLine(
  line: z.infer<typeof lineSchema>,
  allocation: ReturnType<typeof importedStatementAllocation>,
) {
  return {
    fingerprint: line.fingerprint,
    sourceReference: line.sourceReference,
    date: line.date,
    description: line.description,
    supplier: line.supplier,
    amount: line.amount,
    installmentNumber: allocation.installmentNumber,
    installmentTotal: line.installmentTotal,
    expenseId: allocation.expenseId,
    lineId: allocation.lineId,
  };
}

export async function POST(request: NextRequest) {
  try {
    const actor = await requireUser(request);
    const canImport = actor.isDefaultAdmin || (
      actor.permissions.financial?.view === true &&
      actor.permissions.financial?.cardStatements?.view === true &&
      actor.permissions.financial?.cardStatements?.import === true
    );
    if (!canImport) return errorResponse("Sem permissão para importar faturas.", 403);

    const parsed = requestSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return errorResponse("Revise os itens e vínculos da fatura.", 400);
    const input = parsed.data;
    const historicalRegistration = input.registrationMode === "historical_before_dre";
    const canClose = actor.isDefaultAdmin || actor.permissions.financial?.cardStatements?.close === true;
    if (input.statementKey !== `${input.accountId}:${input.paymentMethodId}:${input.monthKey}`) {
      return errorResponse("A fatura, o cartão e a competência não correspondem à prévia.", 409);
    }
    if (historicalRegistration && !canRegisterCardStatementAsHistorical(input.monthKey, FINANCIAL_DRE_START_MONTH_KEY)) {
      return errorResponse("Somente competências anteriores ao início da DRE podem ser registradas como histórico.", 409);
    }
    if (historicalRegistration && !canClose) {
      return errorResponse("Sem permissão para dispensar a auditoria e fechar esta fatura histórica.", 403);
    }
    if (input.analysis.status === "blocked") {
      return errorResponse("A análise bloqueada não pode ser importada.", 409);
    }

    const normalizedLines = input.lines.map((line) => {
      const fingerprint = buildCardStatementImportFingerprint(line, {
        accountId: input.accountId,
        paymentMethodId: input.paymentMethodId,
        monthKey: input.monthKey,
      });
      if (fingerprint !== line.fingerprint) throw new Error("FINGERPRINT_MISMATCH");
      return { ...line, amount: Number(line.amount.toFixed(2)) };
    });
    const fingerprints = new Set<string>();
    const linkKeys = new Set<string>();
    for (const line of normalizedLines) {
      if (fingerprints.has(line.fingerprint)) throw new Error("DUPLICATE_LINE");
      fingerprints.add(line.fingerprint);
      if (line.resolution.mode === "existing") {
        const linkKey = `${line.resolution.expenseId}:${line.resolution.installmentNumber ?? 0}`;
        if (linkKeys.has(linkKey)) throw new Error("DUPLICATE_LINK");
        linkKeys.add(linkKey);
      }
    }
    const financialChargeDefaults = await loadFinancialChargeDefaults(normalizedLines, input.accountId);

    const statementId = statementDocumentId(input.statementKey);
    const statementRef = financialDbAdmin.collection("cardStatements").doc(statementId);
    const importRef = statementRef.collection("imports").doc(input.importId);
    const result = await financialDbAdmin.runTransaction(async (transaction) => {
      const [statementSnapshot, importSnapshot] = await Promise.all([
        transaction.get(statementRef),
        transaction.get(importRef),
      ]);
      if (!importSnapshot.exists) throw new Error("IMPORT_PREVIEW_NOT_FOUND");
      const statementData = statementSnapshot.data() ?? {};
      const importData = importSnapshot.data() ?? {};
      if (
        importData.statementKey !== input.statementKey ||
        importData.fileSha256 !== input.fileSha256 ||
        importData.accountId !== input.accountId ||
        importData.paymentMethodId !== input.paymentMethodId ||
        importData.monthKey !== input.monthKey
      ) throw new Error("IMPORT_PREVIEW_MISMATCH");
      const previousImportId = String(importData.previousImportId || importData.diff?.previousImportId || "") || null;
      const activeImportId = String(statementData.activeImportId || "") || null;
      const expectedImportId = activeImportId && statementData.activeImportFileSha256 === input.fileSha256
        ? activeImportId
        : cardStatementImportId(input.statementKey, input.fileSha256, activeImportId);
      if (input.importId !== expectedImportId) throw new Error("IMPORT_PREVIEW_MISMATCH");
      if (previousImportId !== activeImportId && importData.status !== "applied") throw new Error("STALE_IMPORT_PREVIEW");

      const storedLines = (Array.isArray(importData.preview?.transactions)
        ? importData.preview.transactions.map(asRecord)
        : []) as unknown as CardStatementImportLine[];
      const storedByFingerprint = new Map(storedLines.map((line) => [String(line.fingerprint || ""), line]));
      const canonicalFileName = String(importData.fileName || input.fileName);
      const canonicalAnalysis = asRecord(importData.preview?.analysis);
      const canonicalExcludedEntries = (Array.isArray(importData.preview?.excludedEntries)
        ? importData.preview.excludedEntries.map(asRecord)
        : []) as unknown as CardStatementExcludedEntry[];
      const canonicalCredits = canonicalExcludedEntries.filter((entry) =>
        (entry.kind === "credit" || entry.kind === "refund") && asNumber(entry.amount) > 0
      );
      const canonicalCreditTotal = cardStatementCreditTotal(canonicalCredits);
      const canonicalOfficialTotal = asNumber(importData.preview?.officialTotal) || input.officialTotal;
      const canonicalDueDate = String(importData.preview?.dueDate || input.dueDate);
      const canonicalClosingDate = String(importData.preview?.closingDate || input.closingDate);
      if (canonicalAnalysis.status === "blocked") throw new Error("BLOCKED_ANALYSIS");
      const canonicalLines = normalizedLines.map((line) => {
        const stored = storedByFingerprint.get(line.fingerprint);
        if (!stored) throw new Error("IMPORT_PREVIEW_MISMATCH");
        return { ...line, ...stored, resolution: line.resolution } as z.infer<typeof lineSchema>;
      });
      if (canonicalLines.length === 0 && !(Number(importData.diff?.summary?.removed) > 0)) {
        throw new Error("EMPTY_IMPORT");
      }
      if (
        historicalRegistration
        && (activeImportId || statementData.status === "closed" || statementData.status === "paid" || canonicalLines.length !== storedLines.length)
      ) {
        throw new Error("HISTORICAL_REGISTRATION_REQUIRES_COMPLETE_FIRST_VERSION");
      }

      const revisionLines = (Array.isArray(importData.diff?.lines)
        ? importData.diff.lines.map(asRecord)
        : []) as unknown as CardStatementRevisionLine[];
      const revisionByFingerprint = new Map(revisionLines.map((line) => [String(line.fingerprint || ""), line]));
      const removedLines = (Array.isArray(importData.diff?.removed)
        ? importData.diff.removed.map(asRecord)
        : []) as unknown as CardStatementPreviousImportLine[];
      if (canonicalLines.length * 2 + removedLines.length > 450) throw new Error("REVISION_TOO_LARGE");
      const hasRevisionChanges = Boolean(importData.diff?.hasChanges);
      const canReopen = actor.isDefaultAdmin || actor.permissions.financial?.cardStatements?.close === true;
      if (statementData.status === "paid" && hasRevisionChanges) throw new Error("PAID_STATEMENT_REVISION");
      if (statementData.status === "closed" && hasRevisionChanges) {
        if (input.revisionAction !== "reopen") throw new Error("REOPEN_REQUIRED");
        if (!canReopen) throw new Error("REOPEN_FORBIDDEN");
      }
      const effectiveLinkKeys = new Set<string>();
      for (const line of canonicalLines) {
        const revision = revisionByFingerprint.get(line.fingerprint);
        const expenseId = revision?.status === "changed" && revision.previousExpenseId
          ? revision.previousExpenseId
          : line.resolution.mode === "existing" ? line.resolution.expenseId : null;
        const installmentNumber = revision?.status === "changed"
          ? revision.previousInstallmentNumber ?? null
          : line.resolution.mode === "existing" ? line.resolution.installmentNumber : null;
        if (!expenseId) continue;
        const key = `${expenseId}:${installmentNumber ?? 0}`;
        if (effectiveLinkKeys.has(key)) throw new Error("DUPLICATE_LINK");
        effectiveLinkKeys.add(key);
      }

      const previousLines = (Array.isArray(importData.previousLines)
        ? importData.previousLines.map(asRecord)
        : []) as unknown as CardStatementPreviousImportLine[];
      const linkedIds = [...new Set(canonicalLines.flatMap((line) => {
        const revision = revisionByFingerprint.get(line.fingerprint);
        if (revision?.status === "changed" && revision.previousExpenseId) return [String(revision.previousExpenseId)];
        return line.resolution.mode === "existing" ? [line.resolution.expenseId] : [];
      }))];
      const [relevantSnapshot, cardStatementsSnapshot, ...linkedSnapshots] = await Promise.all([
        transaction.get(financialDbAdmin.collection("expenses").where("cardStatementKey", "==", input.statementKey).limit(500)),
        transaction.get(financialDbAdmin.collection("cardStatements")
          .where("accountId", "==", input.accountId)
          .where("paymentMethodId", "==", input.paymentMethodId)
          .limit(CARD_STATEMENT_HISTORY_PREFLIGHT_LIMIT)),
        ...linkedIds.map((id) => transaction.get(financialDbAdmin.collection("expenses").doc(id))),
      ]);
      if (cardStatementsSnapshot.size >= CARD_STATEMENT_HISTORY_PREFLIGHT_LIMIT) {
        throw new Error("CARD_STATEMENT_HISTORY_PREFLIGHT_LIMIT_REACHED");
      }
      const relevantById = new Map(relevantSnapshot.docs.map((snapshot) => [snapshot.id, snapshot.data() ?? {}]));
      const linkedById = new Map(linkedSnapshots.filter((snapshot) => snapshot.exists).map((snapshot) => [snapshot.id, snapshot.data() ?? {}]));
      const expenseById = new Map([...relevantById, ...linkedById]);
      const historicalByFingerprint = new Map<string, { id: string; data: Record<string, unknown> }>();
      relevantSnapshot.docs.forEach((document) => existingFingerprints(document.data()).forEach((fingerprint) => {
        historicalByFingerprint.set(fingerprint, { id: document.id, data: document.data() ?? {} });
      }));
      const activeFingerprints = new Set(previousLines.map((line) => String(line.fingerprint || "")).filter(Boolean));
      const activeAppliedByFingerprint = new Map(previousLines.map((line) => [String(line.fingerprint || ""), line]));
      const allocationByLineId = new Map(
        (Array.isArray(statementData.allocations) ? statementData.allocations : [])
          .map(asRecord)
          .filter((allocation) => typeof allocation.lineId === "string")
          .map((allocation) => [String(allocation.lineId), allocation]),
      );
      const otherStatementLines = new Map<string, string>();
      const otherStatementFingerprints = new Map<string, string>();
      cardStatementsSnapshot.docs.forEach((document) => {
        const other = document.data() ?? {};
        if (document.id === statementId) return;
        (Array.isArray(other.allocations) ? other.allocations : []).map(asRecord).forEach((allocation) => {
          const lineId = String(allocation.lineId || "");
          const fingerprint = String(allocation.importFingerprint || "");
          if (lineId) otherStatementLines.set(lineId, String(other.key || document.id));
          if (fingerprint) otherStatementFingerprints.set(fingerprint, String(other.key || document.id));
        });
      });
      canonicalLines.forEach((originalLine) => {
        const revision = revisionByFingerprint.get(originalLine.fingerprint) ?? null;
        const effectiveResolution = revision?.status === "changed" && revision.previousExpenseId
          ? {
              mode: "existing" as const,
              expenseId: String(revision.previousExpenseId),
              installmentNumber: asNumber(revision.previousInstallmentNumber) || null,
            }
          : originalLine.resolution;
        const existingExpense = effectiveResolution.mode === "existing"
          ? linkedById.get(effectiveResolution.expenseId) ?? relevantById.get(effectiveResolution.expenseId)
          : null;
        const expenseId = effectiveResolution.mode === "existing"
          ? existingExpense?.provisionType === "forecast" && existingExpense.status === "provisioned"
            ? `card_actual_${originalLine.fingerprint.replace(/[^a-zA-Z0-9_-]/g, "_")}`
            : effectiveResolution.expenseId
          : historicalByFingerprint.get(originalLine.fingerprint)?.id
            || `card_exp_${originalLine.fingerprint.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
        const installmentNumber = effectiveResolution.mode === "existing"
          ? effectiveResolution.installmentNumber
          : originalLine.installmentNumber;
        const lineId = installmentNumber ? `${expenseId}:installment:${installmentNumber}` : expenseId;
        if (otherStatementLines.has(lineId)) throw new Error("CARD_STATEMENT_LINE_ALREADY_ASSIGNED");
        if (otherStatementFingerprints.has(originalLine.fingerprint)) {
          throw new Error("CARD_STATEMENT_FINGERPRINT_ALREADY_ASSIGNED");
        }
      });
      const now = Timestamp.now();
      let created = 0;
      let linked = 0;
      let replacedForecasts = 0;
      let skipped = 0;

      for (const removed of removedLines) {
        const fingerprint = String(removed.fingerprint || "");
        activeAppliedByFingerprint.delete(fingerprint);
        const lineId = String(removed.lineId || "");
        if (lineId) allocationByLineId.delete(lineId);
        const expenseId = String(removed.expenseId || "");
        const expense = expenseById.get(expenseId);
        if (!expenseId || !expense) continue;
        if (expense.status === "paid") throw new Error("PAID_LINE_REVISION");
        const installmentNumber = asNumber(removed.installmentNumber) || null;
        const installments = Array.isArray(expense.installments) ? expense.installments.map(asRecord) : [];
        const nextInstallments = installmentNumber
          ? installments.map((installment, index) => (asNumber(installment.number) || index + 1) === installmentNumber
            ? { ...installment, cardStatementRevisionStatus: "removed", cardStatementRemovedInImportId: input.importId }
            : installment)
          : installments;
        transaction.set(financialDbAdmin.collection("expenses").doc(expenseId), {
          ...(installmentNumber ? { installments: nextInstallments } : { cardStatementRevisionStatus: "removed" }),
          cardStatementRemovedInImportId: input.importId,
          cardStatementRemovedAt: now,
          cardStatementRemovedBy: actor.decoded.uid,
          updatedAt: now,
        }, { merge: true });
      }

      for (const originalLine of canonicalLines) {
        const revision = revisionByFingerprint.get(originalLine.fingerprint) ?? null;
        if (revision?.status === "unchanged" && activeFingerprints.has(originalLine.fingerprint)) {
          skipped += 1;
          continue;
        }
        const effectiveResolution = revision?.status === "changed" && revision.previousExpenseId
          ? {
              mode: "existing" as const,
              expenseId: String(revision.previousExpenseId),
              candidateLineId: String(revision.previousLineId || revision.previousExpenseId),
              installmentNumber: asNumber(revision.previousInstallmentNumber) || null,
            }
          : originalLine.resolution;
        const line = { ...originalLine, resolution: effectiveResolution };
        const financialChargeIdentity = resolveCardStatementFinancialCharge({
          rawDescription: line.description,
          competence: input.monthKey,
          financialInstitution: input.accountName || line.supplier || "Instituição financeira",
        });
        const financialChargeFields = automaticFinancialChargeFields(financialChargeIdentity, financialChargeDefaults);
        const chargeDate = timestamp(line.date);
        const competenceDate = timestamp(`${input.monthKey}-01`);
        const dueDate = timestamp(canonicalDueDate);
        const importFields = {
          cardChargeDate: chargeDate,
          originalCardChargeDate: line.date,
          plannedPaymentMethodType: "credit_card",
          plannedBankAccountId: input.accountId,
          plannedBankAccountName: input.accountName,
          plannedPaymentMethodId: input.paymentMethodId,
          plannedPaymentMethodLabel: input.paymentMethodLabel,
          cardReconciliationStatus: historicalRegistration ? "not_required" : "pending",
          cardStatementAuditDisposition: historicalRegistration ? "waived_before_dre_start" : null,
          cardStatementAuditWaivedAt: historicalRegistration ? now : null,
          cardStatementAuditWaivedBy: historicalRegistration ? actor.decoded.uid : null,
          dreStartMonthKey: historicalRegistration ? FINANCIAL_DRE_START_MONTH_KEY : null,
          cardStatementRevisionStatus: "active",
          cardStatementId: statementId,
          cardStatementKey: input.statementKey,
          cardStatementMonthKey: input.monthKey,
          cardStatementImportFingerprint: line.fingerprint,
          cardStatementImportFingerprints: FieldValue.arrayUnion(line.fingerprint),
          cardStatementPreviousFingerprint: revision?.previousFingerprint || null,
          cardStatementImportId: input.importId,
          cardStatementImportFileName: canonicalFileName,
          cardStatementImportSourceReference: line.sourceReference,
          cardStatementImportConfidence: line.confidence,
          cardStatementImportReviewNotes: line.reviewNotes,
          cardStatementImportPromptVersion: String(canonicalAnalysis.promptVersion || input.analysis.promptVersion),
          cardStatementImportSchemaVersion: canonicalAnalysis.schemaVersion ?? input.analysis.schemaVersion,
          cardStatementImportAnalyzedBy: "financial_copilot",
          rawBankDescription: line.description,
          importedFrom: "card_statement",
          sourceType: "card_statement_import",
          updatedAt: now,
          updatedBy: actor.decoded.uid,
        };
        let allocation: ReturnType<typeof importedStatementAllocation>;

        if (effectiveResolution.mode === "existing") {
          const expense = linkedById.get(effectiveResolution.expenseId) ?? relevantById.get(effectiveResolution.expenseId);
          if (!expense) throw new Error("EXPENSE_NOT_FOUND");
          if (expense.status === "cancelled" || expense.status === "draft" || expense.status === "paid") {
            throw new Error("EXPENSE_NOT_LINKABLE");
          }
          const expenseRef = financialDbAdmin.collection("expenses").doc(effectiveResolution.expenseId);
          const isForecast = expense.provisionType === "forecast" && expense.status === "provisioned";
          if (isForecast) {
            const actualRef = financialDbAdmin.collection("expenses").doc(`card_actual_${line.fingerprint.replace(/[^a-zA-Z0-9_-]/g, "_")}`);
            transaction.set(actualRef, {
              ...inheritedExpenseFields(expense),
              description: financialChargeIdentity?.description || line.description || String(expense.description || "Despesa do cartão"),
              supplier: financialChargeIdentity?.supplier || line.supplier || String(expense.supplier || ""),
              notes: historicalRegistration
                ? `Histórico anterior à DRE, sem conferência contábil. Fatura ${input.paymentMethodLabel} · ${input.monthKey}. Arquivo: ${canonicalFileName}.`
                : `Importado da fatura ${input.paymentMethodLabel} · ${input.monthKey}. Arquivo: ${canonicalFileName}.`,
              totalValue: line.amount,
              competenceDate,
              dueDate,
              paymentMethod: "single",
              installmentNumber: line.installmentNumber,
              installmentTotal: line.installmentTotal,
              status: "pending",
              provisionType: "actual",
              reconciledProvisionId: expenseRef.id,
              provisionedValue: asNumber(expense.totalValue),
              provisionVariance: Number((line.amount - asNumber(expense.totalValue)).toFixed(2)),
              provisionReconciliationStatus: "reconciled",
              provisionReconciledAt: now,
              provisionReconciledBy: actor.decoded.uid,
              ...importFields,
              createdAt: now,
              createdBy: actor.decoded.uid,
            }, { merge: true });
            allocation = importedStatementAllocation(line, actualRef.id, input.monthKey, expense, financialChargeIdentity);
            transaction.set(expenseRef, {
              status: "reconciled",
              replacedByExpenseId: actualRef.id,
              actualValue: line.amount,
              provisionVariance: Number((line.amount - asNumber(expense.totalValue)).toFixed(2)),
              provisionReconciliationStatus: "reconciled",
              provisionReconciledAt: now,
              provisionReconciledBy: actor.decoded.uid,
              updatedAt: now,
            }, { merge: true });
            replacedForecasts += 1;
          } else {
            const installments = Array.isArray(expense.installments) ? expense.installments.map(asRecord) : [];
            const targetNumber = effectiveResolution.installmentNumber;
            const nextInstallments = targetNumber
              ? installments.map((installment, index) => (asNumber(installment.number) || index + 1) === targetNumber
                ? {
                    ...installment,
                    value: line.amount,
                    dueDate,
                    competenceDate,
                    cardReconciliationStatus: historicalRegistration ? "not_required" : "pending",
                    cardStatementAuditDisposition: historicalRegistration ? "waived_before_dre_start" : null,
                    dreStartMonthKey: historicalRegistration ? FINANCIAL_DRE_START_MONTH_KEY : null,
                    cardStatementRevisionStatus: "active",
                    cardStatementId: statementId,
                    cardStatementKey: input.statementKey,
                    cardStatementMonthKey: input.monthKey,
                    cardStatementImportFingerprint: line.fingerprint,
                  }
                : installment)
              : installments;
            const previousLineValue = targetNumber
              ? asNumber(installments.find((installment, index) => (asNumber(installment.number) || index + 1) === targetNumber)?.value)
              : asNumber(expense.totalValue);
            const totalValue = targetNumber && installments.length > 0
              ? Number((asNumber(expense.totalValue) - previousLineValue + line.amount).toFixed(2))
              : line.amount;
            transaction.set(expenseRef, {
              ...importFields,
              cardStatementRegisteredValue: previousLineValue,
              cardStatementVariance: Number((line.amount - previousLineValue).toFixed(2)),
              totalValue,
              competenceDate,
              dueDate,
              ...(nextInstallments.length > 0 ? { installments: nextInstallments } : {}),
            }, { merge: true });
            allocation = importedStatementAllocation(line, expenseRef.id, input.monthKey, expense, financialChargeIdentity);
            linked += 1;
          }
        } else {
          const historical = historicalByFingerprint.get(line.fingerprint);
          const expenseRef = financialDbAdmin.collection("expenses").doc(historical?.id || `card_exp_${line.fingerprint.replace(/[^a-zA-Z0-9_-]/g, "_")}`);
          if (historical) {
            if (historical.data.status === "paid") throw new Error("EXPENSE_NOT_LINKABLE");
            transaction.set(expenseRef, {
              ...importFields,
              totalValue: line.amount,
              competenceDate,
              dueDate,
              installmentNumber: line.installmentNumber,
              installmentTotal: line.installmentTotal,
              cardStatementRemovedInImportId: null,
              cardStatementRemovedAt: null,
            }, { merge: true });
            allocation = importedStatementAllocation(line, expenseRef.id, input.monthKey, historical.data, financialChargeIdentity);
            linked += 1;
          } else {
            transaction.set(expenseRef, {
              description: financialChargeIdentity?.description || line.description,
              supplier: financialChargeIdentity?.supplier || line.supplier,
              notes: historicalRegistration
                ? `Histórico anterior à DRE, sem conferência contábil. Fatura ${input.paymentMethodLabel} · ${input.monthKey}. Arquivo: ${canonicalFileName}.`
                : `Importado da fatura ${input.paymentMethodLabel} · ${input.monthKey}. Arquivo: ${canonicalFileName}.`,
              totalValue: line.amount,
              competenceDate,
              dueDate,
              paymentMethod: "single",
              installmentNumber: line.installmentNumber,
              installmentTotal: line.installmentTotal,
              accountPlan: "",
              accountId: "",
              accountPlanId: "",
              accountPlanName: "",
              resultCenter: null,
              resultCenterId: "",
              resultCenterName: "",
              isApportioned: false,
              apportionments: [],
              hasAccountAllocations: false,
              accountAllocations: [],
              hasPersonAllocations: false,
              personAllocations: [],
              ...financialChargeFields,
              status: "pending",
              ...importFields,
              createdAt: now,
              createdBy: actor.decoded.uid,
            }, { merge: true });
            allocation = importedStatementAllocation(line, expenseRef.id, input.monthKey, financialChargeFields, financialChargeIdentity);
            created += 1;
          }
        }

        if (revision?.previousFingerprint) activeAppliedByFingerprint.delete(String(revision.previousFingerprint));
        activeAppliedByFingerprint.set(line.fingerprint, appliedImportLine(line, allocation));
        if (revision?.previousLineId && revision.previousLineId !== allocation.lineId) {
          allocationByLineId.delete(String(revision.previousLineId));
        }
        allocationByLineId.set(allocation.lineId, allocation);
      }

      const selectedFingerprints = new Set(canonicalLines.map((line) => line.fingerprint));
      const excludedFingerprints = revisionLines
        .filter((line) => line.status !== "unchanged" && !selectedFingerprints.has(String(line.fingerprint || "")))
        .map((line) => String(line.fingerprint || ""));
      const includedTotal = Number(storedLines.reduce((total, line) => total + asNumber(line.amount), 0).toFixed(2));
      const nextAllocations = [...allocationByLineId.values()];
      const allocationIntegrity = cardStatementAllocationIntegrity(
        nextAllocations as Array<{ lineId: string; amount: number; importFingerprint?: string }>,
        canonicalOfficialTotal || 0,
        canonicalCreditTotal,
      );
      if (allocationIntegrity.duplicateLineIds.length || allocationIntegrity.duplicateFingerprints.length) {
        throw new Error("CARD_STATEMENT_DUPLICATE_ALLOCATION");
      }
      if (canonicalOfficialTotal && Math.abs(allocationIntegrity.difference) > 0.05) {
        throw new Error("CARD_STATEMENT_ALLOCATION_TOTAL_MISMATCH");
      }
      const nextStatus = historicalRegistration
        ? "closed"
        : statementData.status === "closed" && hasRevisionChanges ? "open" : statementData.status === "paid" ? "paid" : "open";
      transaction.set(statementRef, {
        key: input.statementKey,
        monthKey: input.monthKey,
        accountId: input.accountId,
        accountName: input.accountName,
        paymentMethodId: input.paymentMethodId,
        paymentMethodLabel: input.paymentMethodLabel,
        closingDate: timestamp(canonicalClosingDate),
        dueDate: timestamp(canonicalDueDate),
        ...(canonicalOfficialTotal ? { officialTotal: canonicalOfficialTotal } : {}),
        status: nextStatus,
        registrationMode: input.registrationMode,
        auditDisposition: historicalRegistration ? "waived_before_dre_start" : null,
        dreStartMonthKey: historicalRegistration ? FINANCIAL_DRE_START_MONTH_KEY : null,
        ...(historicalRegistration ? {
          auditWaivedAt: now,
          auditWaivedBy: actor.decoded.uid,
          auditWaivedLineCount: nextAllocations.length,
          closedAt: now,
          closedBy: actor.decoded.uid,
        } : {}),
        allocations: nextAllocations,
        grossChargesTotal: allocationIntegrity.grossAllocatedTotal,
        creditTotal: canonicalCreditTotal,
        credits: canonicalCredits,
        activeImportId: input.importId,
        activeImportVersion: asNumber(importData.version),
        activeImportFileSha256: input.fileSha256,
        lastImportFileName: canonicalFileName,
        lastImportAnalysis: {
          source: "financial_copilot",
          status: canonicalAnalysis.status || input.analysis.status,
          summary: canonicalAnalysis.summary || input.analysis.summary,
          detectedFormat: canonicalAnalysis.detectedFormat ?? input.analysis.detectedFormat,
          includedCount: storedLines.length,
          appliedCount: activeAppliedByFingerprint.size,
          includedTotal,
          grossIncludedTotal: includedTotal,
          creditTotal: canonicalCreditTotal,
          netIncludedTotal: Number((includedTotal - canonicalCreditTotal).toFixed(2)),
          excludedCount: asNumber(canonicalAnalysis.excludedCount),
          promptVersion: canonicalAnalysis.promptVersion || input.analysis.promptVersion,
          schemaVersion: canonicalAnalysis.schemaVersion ?? input.analysis.schemaVersion,
        },
        ...(statementData.status === "closed" && hasRevisionChanges ? {
          reopenedAt: now,
          reopenedBy: actor.decoded.uid,
          reopenReason: "Nova versão da fatura importada",
        } : {}),
        lastImportedAt: now,
        lastImportedBy: actor.decoded.uid,
        updatedAt: now,
        updatedBy: actor.decoded.uid,
        ...(!statementSnapshot.exists ? { createdAt: now, createdBy: actor.decoded.uid } : {}),
      }, { merge: true });
      transaction.set(importRef, {
        status: excludedFingerprints.length ? "applied_with_exclusions" : "applied",
        registrationMode: input.registrationMode,
        appliedLines: [...activeAppliedByFingerprint.values()],
        excludedFingerprints,
        appliedAt: now,
        appliedBy: actor.decoded.uid,
        result: { created, linked, replacedForecasts, skipped, removed: removedLines.length },
        updatedAt: now,
      }, { merge: true });
      if (activeImportId && activeImportId !== input.importId) {
        transaction.set(statementRef.collection("imports").doc(activeImportId), {
          status: "superseded",
          supersededByImportId: input.importId,
          supersededAt: now,
          updatedAt: now,
        }, { merge: true });
      }
      transaction.set(statementRef.collection("events").doc(`import_${input.importId}`), {
        type: "CARD_STATEMENT_VERSION_APPLIED",
        importId: input.importId,
        version: asNumber(importData.version),
        previousImportId: activeImportId,
        result: { created, linked, replacedForecasts, skipped, removed: removedLines.length },
        reopened: statementData.status === "closed" && hasRevisionChanges,
        registrationMode: input.registrationMode,
        dreStartMonthKey: historicalRegistration ? FINANCIAL_DRE_START_MONTH_KEY : null,
        actorId: actor.decoded.uid,
        occurredAt: now,
      }, { merge: true });
      return {
        created,
        linked,
        replacedForecasts,
        skipped,
        removed: removedLines.length,
        reopened: statementData.status === "closed" && hasRevisionChanges,
        historical: historicalRegistration,
      };
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message === "FINGERPRINT_MISMATCH" || message === "DUPLICATE_LINE" || message === "DUPLICATE_LINK") {
      return errorResponse("Os vínculos enviados não correspondem à prévia da fatura.", 409);
    }
    if (message === "CARD_STATEMENT_LINE_ALREADY_ASSIGNED" || message === "CARD_STATEMENT_FINGERPRINT_ALREADY_ASSIGNED") {
      return errorResponse("Uma cobrança ou parcela já pertence a outra fatura ativa.", 409);
    }
    if (message === "CARD_STATEMENT_ALLOCATION_TOTAL_MISMATCH") {
      return errorResponse("A soma das alocações não corresponde ao total oficial da fatura.", 409);
    }
    if (message === "CARD_STATEMENT_DUPLICATE_ALLOCATION") {
      return errorResponse("A fatura possui cobranças ou fingerprints duplicados.", 409);
    }
    if (message === "CARD_STATEMENT_HISTORY_PREFLIGHT_LIMIT_REACHED") {
      return errorResponse("O histórico do cartão excedeu o limite seguro de conferência. A importação foi bloqueada.", 409);
    }
    if (message === "EXPENSE_NOT_FOUND") return errorResponse("Uma despesa vinculada não foi encontrada.", 409);
    if (message === "EXPENSE_NOT_LINKABLE") return errorResponse("Uma despesa vinculada já foi paga, cancelada ou está em rascunho.", 409);
    if (message === "IMPORT_PREVIEW_NOT_FOUND" || message === "IMPORT_PREVIEW_MISMATCH") return errorResponse("A prévia versionada não foi encontrada ou não corresponde ao arquivo analisado.", 409);
    if (message === "STALE_IMPORT_PREVIEW") return errorResponse("A fatura mudou depois desta análise. Gere uma nova prévia antes de importar.", 409);
    if (message === "EMPTY_IMPORT") return errorResponse("Selecione ao menos um item ou uma alteração da nova versão.", 409);
    if (message === "HISTORICAL_REGISTRATION_REQUIRES_COMPLETE_FIRST_VERSION") {
      return errorResponse("O registro histórico exige a primeira versão completa da fatura.", 409);
    }
    if (message === "BLOCKED_ANALYSIS") return errorResponse("A análise bloqueada não pode ser importada.", 409);
    if (message === "REVISION_TOO_LARGE") return errorResponse("A revisão possui alterações demais para uma aplicação atômica. Divida o tratamento em uma fatura menor.", 409);
    if (message === "PAID_STATEMENT_REVISION" || message === "PAID_LINE_REVISION") return errorResponse("Uma fatura já paga não pode ser alterada. A nova versão ficou registrada para tratamento como ajuste.", 409);
    if (message === "REOPEN_REQUIRED") return errorResponse("Reabra a fatura fechada para aplicar esta nova versão.", 409);
    if (message === "REOPEN_FORBIDDEN") return errorResponse("Seu perfil não pode reabrir uma fatura fechada.", 403);
    const reference = reportSystemError({
      error,
      source: "api-financial",
      operation: "apply-card-statement-import",
      routeOrJob: "/api/financial/card-statements/import",
    });
    return errorResponse("Não foi possível registrar os itens da fatura.", 500, reference.eventId);
  }
}
