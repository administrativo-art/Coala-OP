import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { getFinancialInboxMessage, reviewFinancialInboxMessage } from "@/features/financial/inbox/repository.server";
import { requireUser } from "@/lib/auth-server";

const reviewSchema = z.object({ status: z.enum(["pending_review", "ignored"]) });

export const runtime = "nodejs";

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireUser(request);
    if (!actor.isDefaultAdmin && (!actor.permissions.financial?.view || !actor.permissions.financial?.inbox?.view)) {
      return NextResponse.json({ error: "Sem permissão para consultar cobranças recebidas." }, { status: 403 });
    }
    const { id } = await context.params;
    const message = await getFinancialInboxMessage(id);
    if (message.workspaceId !== actor.workspace_id) {
      return NextResponse.json({ error: "Cobrança não encontrada." }, { status: 404 });
    }
    return NextResponse.json({ message }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Falha ao consultar a cobrança." }, { status: 400 });
  }
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireUser(request);
    if (!actor.isDefaultAdmin && (
      !actor.permissions.financial?.view
      || !actor.permissions.financial?.inbox?.view
      || !actor.permissions.financial?.inbox?.discard
    )) {
      return NextResponse.json({ error: "Sem permissão para revisar cobranças recebidas." }, { status: 403 });
    }
    const { id } = await context.params;
    const input = reviewSchema.parse(await request.json());
    const message = await reviewFinancialInboxMessage({
      id,
      status: input.status,
      workspaceId: actor.workspace_id,
      actorId: actor.decoded.uid,
      actorEmail: actor.decoded.email,
    });
    return NextResponse.json({ message }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Falha ao revisar a cobrança." }, { status: 400 });
  }
}
