import { NextRequest, NextResponse } from "next/server";
import { Timestamp } from "firebase-admin/firestore";

import { adjustmentClassificationSchema } from "@/features/financial/obligations/schemas";
import { requireUser } from "@/lib/auth-server";
import { financialDbAdmin } from "@/lib/firebase-financial-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ expenseId: string; adjustmentId: string }> };

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const actor = await requireUser(request);
    if (!actor.isDefaultAdmin && !actor.permissions.financial?.reconciliation?.classifyAdjustments) {
      return NextResponse.json({ error: "Sem permissão para classificar ajustes." }, { status: 403 });
    }
    const { expenseId, adjustmentId } = await context.params;
    const input = adjustmentClassificationSchema.parse(await request.json());
    const expenseRef = financialDbAdmin.collection("expenses").doc(expenseId);
    const adjustmentRef = financialDbAdmin.collection("paymentAdjustments").doc(adjustmentId);

    const result = await financialDbAdmin.runTransaction(async (transaction) => {
      const [expenseSnapshot, adjustmentSnapshot, accountSnapshot] = await Promise.all([
        transaction.get(expenseRef),
        transaction.get(adjustmentRef),
        input.accountPlanId
          ? transaction.get(financialDbAdmin.collection("accounts").doc(input.accountPlanId))
          : Promise.resolve(null),
      ]);
      if (!expenseSnapshot.exists) throw new Error("Despesa não encontrada.");
      if (!adjustmentSnapshot.exists) throw new Error("Ajuste não encontrado.");
      const expense = expenseSnapshot.data() ?? {};
      const adjustment = adjustmentSnapshot.data() ?? {};
      if (
        adjustment.expenseId !== expenseId &&
        (!expense.obligationId || adjustment.obligationId !== expense.obligationId)
      ) {
        throw new Error("O ajuste não pertence a esta obrigação.");
      }
      const allowedTypes = adjustment.effect === "CASH_CHARGE"
        ? ["INTEREST", "FINE", "OTHER"]
        : adjustment.effect === "SETTLEMENT_CREDIT"
          ? ["DISCOUNT", "ABATEMENT", "OTHER"]
          : [String(adjustment.type || "OTHER"), "OTHER"];
      if (!allowedTypes.includes(input.type)) {
        throw new Error("A natureza escolhida altera o efeito financeiro do ajuste. Corrija a conciliação do pagamento.");
      }
      const account = accountSnapshot?.data() ?? null;
      if (input.accountPlanId && (
        !accountSnapshot?.exists || account?.active === false || account?.isGroup === true
      )) {
        throw new Error("O plano de contas selecionado é inválido.");
      }

      const now = Timestamp.now();
      const classifiedBy = {
        uid: actor.decoded.uid,
        name: actor.userDoc.username || null,
        email: actor.decoded.email || null,
      };
      const patch = {
        type: input.type,
        reason: input.reason,
        responsibility: input.responsibility,
        responsibleArea: input.responsibleArea || null,
        responsibleName: input.responsibleName || null,
        accountPlanId: input.accountPlanId || null,
        accountPlanName: account?.name || input.accountPlanName || null,
        accountingStatus: input.accountPlanId ? "READY" : "PENDING_CLASSIFICATION",
        status: "CLASSIFIED",
        classifiedBy,
        classifiedAt: now,
        updatedAt: now,
      };
      transaction.set(adjustmentRef, patch, { merge: true });
      if (adjustment.chargeExpenseId) {
        transaction.set(financialDbAdmin.collection("expenses").doc(String(adjustment.chargeExpenseId)), {
          ...(input.accountPlanId ? {
            accountPlan: input.accountPlanId,
            accountId: input.accountPlanId,
            accountPlanId: input.accountPlanId,
            accountPlanName: account?.name || input.accountPlanName || null,
          } : {}),
          notes: input.reason,
          adjustmentResponsibility: input.responsibility,
          adjustmentResponsibleArea: input.responsibleArea || null,
          adjustmentResponsibleName: input.responsibleName || null,
          updatedAt: now,
        }, { merge: true });
      }
      if (adjustment.obligationId) {
        transaction.set(
          financialDbAdmin.collection("financialObligations").doc(String(adjustment.obligationId)).collection("events").doc(`adjustment_${adjustmentId}_${now.toMillis()}`),
          {
            type: "PAYMENT_ADJUSTMENT_CLASSIFIED",
            obligationId: adjustment.obligationId,
            expenseId,
            adjustmentId,
            previous: {
              type: adjustment.type || null,
              reason: adjustment.reason || null,
              responsibility: adjustment.responsibility || null,
              accountPlanId: adjustment.accountPlanId || null,
            },
            next: patch,
            actor: classifiedBy,
            occurredAt: now,
          },
        );
      }
      return { id: adjustmentId, ...patch, classifiedAt: now.toDate().toISOString() };
    });
    return NextResponse.json({ adjustment: result }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha ao classificar o ajuste.";
    return NextResponse.json({ error: message }, { status: message.includes("não encontrad") ? 404 : 400 });
  }
}
