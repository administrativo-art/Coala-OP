import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { FieldValue, Timestamp } from "firebase-admin/firestore";

import { calculateFinancialObligationSummary, moneyToCents } from "@/features/financial/obligations/calculations";
import { requireUser } from "@/lib/auth-server";
import { financialDbAdmin } from "@/lib/firebase-financial-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ statementId: string }> };
type RawRecord = Record<string, any>;

function safeKey(value: string) {
  return createHash("sha256").update(value).digest("hex").slice(0, 32);
}

function asTimestamp(value: unknown) {
  if (value instanceof Timestamp) return value;
  if (value && typeof (value as { toDate?: unknown }).toDate === "function") {
    return Timestamp.fromDate((value as { toDate: () => Date }).toDate());
  }
  const parsed = value ? new Date(value as string) : null;
  return parsed && !Number.isNaN(parsed.getTime()) ? Timestamp.fromDate(parsed) : null;
}

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const actor = await requireUser(request);
    if (!actor.isDefaultAdmin && !actor.permissions.financial?.cardStatements?.reconcile) {
      return NextResponse.json({ error: "Sem permissão para conciliar a fatura." }, { status: 403 });
    }
    const { statementId } = await context.params;
    const body = await request.json();
    const transactionId = typeof body.transactionId === "string" ? body.transactionId : "";
    if (!transactionId) return NextResponse.json({ error: "Transação bancária não informada." }, { status: 400 });

    const statementRef = financialDbAdmin.collection("cardStatements").doc(statementId);
    const bankTransactionRef = financialDbAdmin.collection("transactions").doc(transactionId);
    const result = await financialDbAdmin.runTransaction(async (transaction) => {
      const [statementSnapshot, bankTransactionSnapshot] = await Promise.all([
        transaction.get(statementRef),
        transaction.get(bankTransactionRef),
      ]);
      if (!statementSnapshot.exists) throw new Error("Fatura não encontrada.");
      if (!bankTransactionSnapshot.exists) throw new Error("Transação bancária não encontrada.");
      const statement = statementSnapshot.data() ?? {};
      const bankTransaction = bankTransactionSnapshot.data() ?? {};
      if (statement.status === "paid") {
        if (statement.linkedBankTransactionId !== transactionId) throw new Error("A fatura já foi conciliada com outra transação.");
        return { idempotent: true, obligationId: statement.obligationId || null };
      }
      if (statement.status !== "closed") throw new Error("Feche a fatura antes de conciliar o pagamento.");
      if (bankTransaction.reversed === true || bankTransaction.auditStatus === "reversed") throw new Error("A transação bancária está estornada.");
      if (bankTransaction.direction !== "out") throw new Error("A transação selecionada não é uma saída bancária.");
      const officialTotalCents = moneyToCents(statement.officialTotal);
      const bankAmountCents = moneyToCents(Math.abs(Number(bankTransaction.amount) || 0));
      if (officialTotalCents <= 0) throw new Error("O total oficial da fatura é inválido.");
      if (Math.abs(officialTotalCents - bankAmountCents) > 5) {
        throw new Error("O pagamento difere do total oficial. Classifique juros, multa, desconto ou abatimento antes da conciliação.");
      }
      const allocations = Array.isArray(statement.allocations) ? statement.allocations as RawRecord[] : [];
      if (allocations.length === 0) throw new Error("A fatura não possui despesas alocadas.");
      const allocatedCents = allocations.reduce((total, allocation) => total + moneyToCents(allocation.amount), 0);
      if (Math.abs(allocatedCents - officialTotalCents) > 5) throw new Error("As despesas da fatura não correspondem ao total oficial.");

      const expenseIds = [...new Set(allocations.map((allocation) => String(allocation.expenseId || "")).filter(Boolean))];
      const expenseSnapshots = await Promise.all(
        expenseIds.map((expenseId) => transaction.get(financialDbAdmin.collection("expenses").doc(expenseId))),
      );
      if (expenseSnapshots.some((snapshot) => !snapshot.exists)) throw new Error("Uma das despesas da fatura não foi encontrada.");

      const obligationId = String(statement.obligationId || `obl_card_${safeKey(statementId)}`);
      const linkId = `link_card_${safeKey(`${statementId}:${transactionId}`)}`;
      const paymentId = `card_${safeKey(`${statementId}:${transactionId}`)}`;
      const paidAt = asTimestamp(bankTransaction.date) || Timestamp.now();
      const now = Timestamp.now();
      const forecastAmountCents = moneyToCents(
        Number(statement.provisionedTotal) > 0 ? statement.provisionedTotal : statement.projectedTotal,
      );
      const summary = calculateFinancialObligationSummary({
        forecastAmountCents: forecastAmountCents > 0 ? forecastAmountCents : null,
        actualAmountCents: officialTotalCents,
        paymentAllocations: [{
          id: linkId,
          paymentId,
          bankTransactionId: transactionId,
          expenseId: null,
          principalAmountCents: officialTotalCents,
          cashAmountCents: bankAmountCents,
          status: "MATCHED",
        }],
      });
      const actorPayload = { uid: actor.decoded.uid, name: actor.userDoc.username || null, email: actor.decoded.email || null };

      transaction.set(financialDbAdmin.collection("financialObligations").doc(obligationId), {
        id: obligationId,
        obligationType: "CARD_STATEMENT",
        sourceType: "CARD_STATEMENT",
        sourceId: statementId,
        competenceKey: statement.monthKey || null,
        status: summary.obligationStatus,
        reconciliationStatus: summary.reconciliationStatus,
        summary,
        updatedAt: now,
        createdAt: now,
        createdBy: actorPayload,
      }, { merge: true });
      transaction.set(financialDbAdmin.collection("obligationPaymentLinks").doc(linkId), {
        id: linkId,
        obligationId,
        paymentId,
        bankTransactionId: transactionId,
        expenseId: null,
        principalAmountCents: officialTotalCents,
        cashAmountCents: bankAmountCents,
        status: "MATCHED",
        origin: "CARD_STATEMENT",
        confidence: 1,
        confirmedAt: now,
        confirmedBy: actorPayload,
        createdAt: now,
        updatedAt: now,
      }, { merge: true });
      transaction.set(financialDbAdmin.collection("payments").doc(paymentId), {
        obligationId,
        linkId,
        cardStatementId: statementId,
        bankTransactionId: transactionId,
        description: `Pagamento da fatura ${statement.key || statementId}`,
        paidAt,
        baseValue: officialTotalCents / 100,
        principalAmountCents: officialTotalCents,
        totalPaid: bankAmountCents / 100,
        cashAmountCents: bankAmountCents,
        splits: [],
        evidenceSource: "BANK_STATEMENT",
        status: "MATCHED",
        reconciliationStatus: summary.reconciliationStatus,
        settlementSummary: summary,
        confirmedAt: now,
        confirmedBy: actorPayload,
        createdAt: now,
        updatedAt: now,
      }, { merge: true });
      transaction.set(statementRef, {
        status: "paid",
        obligationId,
        settlementSummary: summary,
        linkedBankTransactionId: transactionId,
        linkedBankTransactionIds: FieldValue.arrayUnion(transactionId),
        settlements: FieldValue.arrayUnion({
          transactionId,
          amount: bankAmountCents / 100,
          paidAt: paidAt.toDate().toISOString().slice(0, 10),
        }),
        paidAt,
        paidBy: actor.decoded.uid,
        updatedAt: now,
      }, { merge: true });

      for (const expenseSnapshot of expenseSnapshots) {
        const expense = expenseSnapshot.data() ?? {};
        const expenseAllocations = allocations.filter((allocation) => allocation.expenseId === expenseSnapshot.id);
        const installmentNumbers = new Set(
          expenseAllocations
            .map((allocation) => Number(allocation.installmentNumber))
            .filter((number) => Number.isFinite(number) && number > 0),
        );
        const installments = Array.isArray(expense.installments) ? expense.installments as RawRecord[] : [];
        if (installmentNumbers.size === 0 && installments.length === 1) {
          installmentNumbers.add(Number(installments[0]?.number) || 1);
        }
        const nextInstallments = installments.map((installment, index) => installmentNumbers.has(Number(installment.number) || index + 1)
          ? { ...installment, status: "paid", paidAt, cardReconciliationStatus: "reconciled", cardStatementKey: statement.key || null, linkedBankTransactionId: transactionId }
          : installment);
        const paidPrincipalCents = nextInstallments.length > 0
          ? nextInstallments.filter((installment) => ["paid", "cancelled"].includes(String(installment.status))).reduce((total, installment) => total + (installment.status === "paid" ? moneyToCents(installment.value) : 0), 0)
          : expenseAllocations.reduce((total, allocation) => total + moneyToCents(allocation.amount), 0);
        const expenseActualCents = moneyToCents(expense.totalValue);
        const fullyPaid = nextInstallments.length === 0 || nextInstallments.every((installment) => ["paid", "cancelled"].includes(String(installment.status)));
        const lineSummary = calculateFinancialObligationSummary({
          forecastAmountCents: expense.provisionedValue == null ? null : moneyToCents(expense.provisionedValue),
          actualAmountCents: expenseActualCents,
          paymentAllocations: paidPrincipalCents > 0 ? [{
            bankTransactionId: transactionId,
            expenseId: expenseSnapshot.id,
            principalAmountCents: paidPrincipalCents,
            cashAmountCents: paidPrincipalCents,
            status: "MATCHED",
          }] : [],
        });
        transaction.set(expenseSnapshot.ref, {
          ...(nextInstallments.length > 0 ? { installments: nextInstallments } : {}),
          ...(fullyPaid ? { status: "paid", paidAt } : { status: "partially_paid" }),
          paymentState: fullyPaid ? "paid" : "partially_paid",
          settlementScope: "CARD_LINE",
          latestCardStatementObligationId: obligationId,
          cardStatementObligationIds: FieldValue.arrayUnion(obligationId),
          settlementSummary: lineSummary,
          paidByCardStatement: true,
          cardStatementKey: statement.key || null,
          cardStatementId: statementId,
          linkedBankTransactionId: transactionId,
          linkedBankTransactionIds: FieldValue.arrayUnion(transactionId),
          updatedAt: now,
        }, { merge: true });
      }
      transaction.set(bankTransactionRef, {
        cardStatementId: statementId,
        obligationId,
        obligationPaymentLinkId: linkId,
        obligationPaymentId: paymentId,
        awaitingCardStatementReconciliation: false,
        updatedAt: now,
      }, { merge: true });
      transaction.set(financialDbAdmin.collection("financialObligations").doc(obligationId).collection("events").doc(`card_${safeKey(transactionId)}`), {
        type: "CARD_STATEMENT_PAYMENT_MATCHED",
        obligationId,
        cardStatementId: statementId,
        bankTransactionId: transactionId,
        paymentId,
        linkId,
        actor: actorPayload,
        occurredAt: now,
      }, { merge: true });
      return { idempotent: false, obligationId, summary };
    });

    return NextResponse.json(result, { status: result.idempotent ? 200 : 201, headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha ao conciliar a fatura.";
    return NextResponse.json({ error: message }, { status: message.includes("não encontrad") ? 404 : 400 });
  }
}
