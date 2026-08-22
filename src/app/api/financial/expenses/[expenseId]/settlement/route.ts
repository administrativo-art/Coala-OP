import { NextRequest, NextResponse } from "next/server";
import { Timestamp } from "firebase-admin/firestore";

import { requireUser } from "@/lib/auth-server";
import { financialDbAdmin } from "@/lib/firebase-financial-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ expenseId: string }> };

function dateValue(value: unknown) {
  if (value instanceof Timestamp) return value.toDate().toISOString();
  if (value && typeof (value as { toDate?: unknown }).toDate === "function") {
    return (value as { toDate: () => Date }).toDate().toISOString();
  }
  return typeof value === "string" ? value : null;
}

function documentRows(snapshot: FirebaseFirestore.QuerySnapshot) {
  return snapshot.docs.map((document) => {
    const data = document.data();
    return {
      id: document.id,
      ...data,
      paidAt: dateValue(data.paidAt),
      confirmedAt: dateValue(data.confirmedAt),
      classifiedAt: dateValue(data.classifiedAt),
      occurredAt: dateValue(data.occurredAt),
      createdAt: dateValue(data.createdAt),
      updatedAt: dateValue(data.updatedAt),
    };
  });
}

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const actor = await requireUser(request);
    if (
      !actor.isDefaultAdmin &&
      (!actor.permissions.financial?.view || !(
        actor.permissions.financial?.expenses?.view ||
        actor.permissions.financial?.reconciliation?.view
      ))
    ) {
      return NextResponse.json({ error: "Sem permissão para consultar a despesa." }, { status: 403 });
    }

    const { expenseId } = await context.params;
    const expenseSnapshot = await financialDbAdmin.collection("expenses").doc(expenseId).get();
    if (!expenseSnapshot.exists) {
      return NextResponse.json({ error: "Despesa não encontrada." }, { status: 404 });
    }
    const expense = expenseSnapshot.data() ?? {};
    const obligationId = typeof expense.obligationId === "string" && expense.obligationId
      ? expense.obligationId
      : typeof expense.latestCardStatementObligationId === "string"
        ? expense.latestCardStatementObligationId
        : "";
    if (!obligationId) {
      return NextResponse.json({
        obligation: null,
        summary: expense.settlementSummary ?? null,
        payments: [],
        links: [],
        adjustments: [],
        events: [],
      }, { headers: { "Cache-Control": "private, no-store" } });
    }

    const obligationRef = financialDbAdmin.collection("financialObligations").doc(obligationId);
    const [obligationSnapshot, paymentsSnapshot, linksSnapshot, adjustmentsSnapshot, eventsSnapshot, chargeAccountsSnapshot] = await Promise.all([
      obligationRef.get(),
      financialDbAdmin.collection("payments").where("obligationId", "==", obligationId).limit(100).get(),
      financialDbAdmin.collection("obligationPaymentLinks").where("obligationId", "==", obligationId).limit(100).get(),
      financialDbAdmin.collection("paymentAdjustments").where("obligationId", "==", obligationId).limit(100).get(),
      obligationRef.collection("events").orderBy("occurredAt", "desc").limit(100).get(),
      financialDbAdmin.collection("accounts").where("dre_position", "==", "despesas_financeiras").limit(100).get(),
    ]);

    return NextResponse.json({
      obligation: obligationSnapshot.exists ? { id: obligationSnapshot.id, ...obligationSnapshot.data() } : null,
      summary: expense.settlementScope === "CARD_LINE"
        ? expense.settlementSummary ?? null
        : obligationSnapshot.data()?.summary ?? expense.settlementSummary ?? null,
      payments: documentRows(paymentsSnapshot),
      links: documentRows(linksSnapshot),
      adjustments: documentRows(adjustmentsSnapshot),
      events: documentRows(eventsSnapshot),
      chargeAccountPlans: chargeAccountsSnapshot.docs
        .map((document): Record<string, any> => ({ id: document.id, ...document.data() }))
        .filter((account) => account.active !== false && account.isGroup !== true)
        .map((account) => ({ id: account.id, name: String(account.name || account.id) })),
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Falha ao consultar a liquidação.",
    }, { status: 400 });
  }
}
