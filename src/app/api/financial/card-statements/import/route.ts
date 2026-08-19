import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { buildCardStatementImportFingerprint } from "@/features/financial/lib/card-statement-import";
import { requireUser } from "@/lib/auth-server";
import { financialDbAdmin } from "@/lib/firebase-financial-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
  lines: z.array(lineSchema).min(1).max(200),
});

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

export async function POST(request: NextRequest) {
  try {
    const actor = await requireUser(request);
    const canImport = actor.isDefaultAdmin || (
      actor.permissions.financial?.view === true &&
      actor.permissions.financial?.cardStatements?.view === true &&
      actor.permissions.financial?.cardStatements?.import === true
    );
    if (!canImport) return NextResponse.json({ error: "Sem permissão para importar faturas." }, { status: 403 });

    const parsed = requestSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Revise os itens e vínculos da fatura." }, { status: 400 });
    const input = parsed.data;
    if (input.analysis.status === "blocked") {
      return NextResponse.json({ error: "A análise bloqueada não pode ser importada." }, { status: 409 });
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

    const linkedIds = [...new Set(normalizedLines.flatMap((line) =>
      line.resolution.mode === "existing" ? [line.resolution.expenseId] : []
    ))];
    const linkedSnapshots = linkedIds.length > 0
      ? await financialDbAdmin.getAll(...linkedIds.map((id) => financialDbAdmin.collection("expenses").doc(id)))
      : [];
    const linkedById = new Map(linkedSnapshots.filter((snapshot) => snapshot.exists).map((snapshot) => [snapshot.id, snapshot.data() ?? {}]));
    const relevantSnapshot = await financialDbAdmin.collection("expenses")
      .where("plannedBankAccountId", "==", input.accountId)
      .get();
    const alreadyImported = new Set(
      relevantSnapshot.docs.flatMap((document) => [...existingFingerprints(document.data())])
    );

    const now = Timestamp.now();
    const batch = financialDbAdmin.batch();
    let created = 0;
    let linked = 0;
    let replacedForecasts = 0;
    let skipped = 0;

    for (const line of normalizedLines) {
      if (alreadyImported.has(line.fingerprint)) {
        skipped += 1;
        continue;
      }
      const chargeDate = timestamp(line.date);
      const competenceDate = timestamp(`${input.monthKey}-01`);
      const dueDate = timestamp(input.dueDate);
      const importFields = {
        cardChargeDate: chargeDate,
        originalCardChargeDate: line.date,
        plannedPaymentMethodType: "credit_card",
        plannedBankAccountId: input.accountId,
        plannedBankAccountName: input.accountName,
        plannedPaymentMethodId: input.paymentMethodId,
        plannedPaymentMethodLabel: input.paymentMethodLabel,
        cardReconciliationStatus: "pending",
        cardStatementKey: input.statementKey,
        cardStatementMonthKey: input.monthKey,
        cardStatementImportFingerprint: line.fingerprint,
        cardStatementImportFingerprints: FieldValue.arrayUnion(line.fingerprint),
        cardStatementImportFileName: input.fileName,
        cardStatementImportSourceReference: line.sourceReference,
        cardStatementImportConfidence: line.confidence,
        cardStatementImportReviewNotes: line.reviewNotes,
        cardStatementImportPromptVersion: input.analysis.promptVersion,
        cardStatementImportSchemaVersion: input.analysis.schemaVersion,
        cardStatementImportAnalyzedBy: "financial_copilot",
        importedFrom: "card_statement",
        sourceType: "card_statement_import",
        updatedAt: now,
        updatedBy: actor.decoded.uid,
      };

      if (line.resolution.mode === "existing") {
        const expense = linkedById.get(line.resolution.expenseId);
        if (!expense) throw new Error("EXPENSE_NOT_FOUND");
        if (expense.status === "cancelled" || expense.status === "draft" || expense.status === "paid") {
          throw new Error("EXPENSE_NOT_LINKABLE");
        }
        if (existingFingerprints(expense).has(line.fingerprint)) {
          skipped += 1;
          continue;
        }
        const expenseRef = financialDbAdmin.collection("expenses").doc(line.resolution.expenseId);
        const isForecast = expense.provisionType === "forecast" && expense.status === "provisioned";
        if (isForecast) {
          const actualRef = financialDbAdmin.collection("expenses").doc(`card_actual_${line.fingerprint.replace(/[^a-zA-Z0-9_-]/g, "_")}`);
          batch.set(actualRef, {
            ...inheritedExpenseFields(expense),
            description: line.description || String(expense.description || "Despesa do cartão"),
            supplier: line.supplier || String(expense.supplier || ""),
            notes: `Importado da fatura ${input.paymentMethodLabel} · ${input.monthKey}. Arquivo: ${input.fileName}.`,
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
          batch.set(expenseRef, {
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
          const targetNumber = line.resolution.installmentNumber;
          const nextInstallments = targetNumber
            ? installments.map((installment, index) => (asNumber(installment.number) || index + 1) === targetNumber
              ? { ...installment, value: line.amount, cardReconciliationStatus: "pending", cardStatementKey: input.statementKey, cardStatementImportFingerprint: line.fingerprint }
              : installment)
            : installments;
          const previousLineValue = targetNumber
            ? asNumber(installments.find((installment, index) => (asNumber(installment.number) || index + 1) === targetNumber)?.value)
            : asNumber(expense.totalValue);
          const totalValue = targetNumber && installments.length > 0
            ? Number((asNumber(expense.totalValue) - previousLineValue + line.amount).toFixed(2))
            : line.amount;
          batch.set(expenseRef, {
            ...importFields,
            cardStatementRegisteredValue: previousLineValue,
            cardStatementVariance: Number((line.amount - previousLineValue).toFixed(2)),
            totalValue,
            competenceDate,
            dueDate,
            ...(nextInstallments.length > 0 ? { installments: nextInstallments } : {}),
          }, { merge: true });
          linked += 1;
        }
        continue;
      }

      const expenseRef = financialDbAdmin.collection("expenses").doc(`card_exp_${line.fingerprint.replace(/[^a-zA-Z0-9_-]/g, "_")}`);
      batch.set(expenseRef, {
        description: line.description,
        supplier: line.supplier,
        notes: `Importado da fatura ${input.paymentMethodLabel} · ${input.monthKey}. Arquivo: ${input.fileName}.`,
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
        status: "pending",
        ...importFields,
        createdAt: now,
        createdBy: actor.decoded.uid,
      }, { merge: true });
      created += 1;
    }

    const statementRef = financialDbAdmin.collection("cardStatements").doc(statementDocumentId(input.statementKey));
    const statementSnapshot = await statementRef.get();
    const includedTotal = Number(normalizedLines.reduce((total, line) => total + line.amount, 0).toFixed(2));
    batch.set(statementRef, {
      key: input.statementKey,
      monthKey: input.monthKey,
      accountId: input.accountId,
      accountName: input.accountName,
      paymentMethodId: input.paymentMethodId,
      paymentMethodLabel: input.paymentMethodLabel,
      closingDate: timestamp(input.closingDate),
      dueDate: timestamp(input.dueDate),
      ...(input.officialTotal ? { officialTotal: input.officialTotal } : {}),
      status: "open",
      lastImportFileName: input.fileName,
      lastImportAnalysis: {
        source: "financial_copilot",
        status: input.analysis.status,
        summary: input.analysis.summary,
        detectedFormat: input.analysis.detectedFormat,
        includedCount: normalizedLines.length,
        includedTotal,
        excludedCount: input.analysis.excludedCount,
        promptVersion: input.analysis.promptVersion,
        schemaVersion: input.analysis.schemaVersion,
      },
      lastImportedAt: now,
      lastImportedBy: actor.decoded.uid,
      updatedAt: now,
      updatedBy: actor.decoded.uid,
      ...(!statementSnapshot.exists ? { createdAt: now, createdBy: actor.decoded.uid } : {}),
    }, { merge: true });
    await batch.commit();

    return NextResponse.json({ ok: true, created, linked, replacedForecasts, skipped });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message === "FINGERPRINT_MISMATCH" || message === "DUPLICATE_LINE" || message === "DUPLICATE_LINK") {
      return NextResponse.json({ error: "Os vínculos enviados não correspondem à prévia da fatura." }, { status: 409 });
    }
    if (message === "EXPENSE_NOT_FOUND") return NextResponse.json({ error: "Uma despesa vinculada não foi encontrada." }, { status: 409 });
    if (message === "EXPENSE_NOT_LINKABLE") return NextResponse.json({ error: "Uma despesa vinculada já foi paga, cancelada ou está em rascunho." }, { status: 409 });
    console.error("[financial/card-statements/import] Falha ao importar fatura", error);
    return NextResponse.json({ error: "Não foi possível registrar os itens da fatura." }, { status: 500 });
  }
}
