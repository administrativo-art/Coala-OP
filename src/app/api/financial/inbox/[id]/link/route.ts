import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { linkInboxChargeToExistingExpense, linkSuggestedInboxCharge } from "@/features/financial/inbox/workflow.server";
import { requireUser } from "@/lib/auth-server";

export const runtime = "nodejs";
const schema = z.object({ expenseId: z.string().trim().min(1).max(180).optional() });

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireUser(request);
    if (!actor.isDefaultAdmin && (
      !actor.permissions.financial?.view
      || !actor.permissions.financial?.inbox?.view
      || !actor.permissions.financial?.inbox?.link
      || !actor.permissions.financial?.expenses?.create
      || !actor.permissions.financial?.expenses?.edit
    )) {
      return NextResponse.json({ error: "Sem permissão para vincular cobrança e provisionamento." }, { status: 403 });
    }
    const { id } = await context.params;
    const raw = await request.text();
    const input = schema.parse(raw ? JSON.parse(raw) : {});
    const paymentActor = {
      uid: actor.decoded.uid,
      email: actor.decoded.email,
      name: actor.userDoc.username ?? null,
    };
    const result = input.expenseId
      ? await linkInboxChargeToExistingExpense(id, input.expenseId, paymentActor, actor.workspace_id)
      : await linkSuggestedInboxCharge(id, paymentActor, actor.workspace_id);
    return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Falha ao vincular a cobrança." }, { status: 400 });
  }
}
