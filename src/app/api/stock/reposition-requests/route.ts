import { NextRequest, NextResponse } from "next/server";

import { requireUser } from "@/lib/auth-server";
import { dbAdmin } from "@/lib/firebase-admin";
import { type RepositionRequest } from "@/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function canUseReposition(context: Awaited<ReturnType<typeof requireUser>>) {
  return context.isDefaultAdmin || !!context.permissions?.stock?.analysis?.restock;
}

export async function GET(request: NextRequest) {
  try {
    const context = await requireUser(request);
    if (!canUseReposition(context)) {
      return NextResponse.json(
        { error: "Sem permissão para visualizar solicitações de reposição." },
        { status: 403 }
      );
    }

    const snap = await dbAdmin.collection("repositionRequests").get();
    const requests = snap.docs
      .map((doc) => ({ id: doc.id, ...(doc.data() as Omit<RepositionRequest, "id">) }))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));

    return NextResponse.json({ requests });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Falha ao carregar solicitações de reposição.",
      },
      { status: 400 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const context = await requireUser(request);
    if (!canUseReposition(context)) {
      return NextResponse.json(
        { error: "Sem permissão para solicitar reposição." },
        { status: 403 }
      );
    }

    const body = (await request.json().catch(() => null)) as
      | Partial<RepositionRequest>
      | null;
    if (
      !body ||
      typeof body.kioskId !== "string" ||
      typeof body.kioskName !== "string" ||
      !Array.isArray(body.items) ||
      body.items.length === 0
    ) {
      return NextResponse.json(
        { error: "Payload inválido para solicitação de reposição." },
        { status: 400 }
      );
    }

    const now = new Date().toISOString();
    const ref = dbAdmin.collection("repositionRequests").doc();
    const payload: RepositionRequest = {
      id: ref.id,
      status: "Pendente",
      kioskId: body.kioskId,
      kioskName: body.kioskName,
      items: body.items,
      notes: body.notes ?? "",
      requestedBy: {
        userId: context.userDoc.id,
        username: context.userDoc.username,
      },
      createdAt: now,
      updatedAt: now,
    };

    await ref.set(payload);

    return NextResponse.json({ request: payload }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Falha ao criar solicitação de reposição.",
      },
      { status: 400 }
    );
  }
}
