import { NextRequest, NextResponse } from "next/server";

import { requireUser } from "@/lib/auth-server";
import { dbAdmin } from "@/lib/firebase-admin";
import { type RepositionRequest } from "@/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ requestId: string }>;
};

function canUseReposition(context: Awaited<ReturnType<typeof requireUser>>) {
  return context.isDefaultAdmin || !!context.permissions?.stock?.analysis?.restock;
}

function cleanUndefined<T extends Record<string, unknown>>(value: T) {
  const next = { ...value };
  Object.keys(next).forEach((key) => {
    if (next[key] === undefined) delete next[key];
  });
  return next;
}

export async function PATCH(request: NextRequest, routeContext: RouteContext) {
  try {
    const context = await requireUser(request);
    if (!canUseReposition(context)) {
      return NextResponse.json(
        { error: "Sem permissão para atualizar solicitações de reposição." },
        { status: 403 }
      );
    }

    const { requestId } = await routeContext.params;
    const body = (await request.json().catch(() => null)) as
      | Partial<RepositionRequest>
      | null;
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Payload inválido." }, { status: 400 });
    }

    const ref = dbAdmin.collection("repositionRequests").doc(requestId);
    const snap = await ref.get();
    if (!snap.exists) {
      return NextResponse.json(
        { error: "Solicitação de reposição não encontrada." },
        { status: 404 }
      );
    }

    const updateData = cleanUndefined({
      ...body,
      updatedAt: new Date().toISOString(),
      reviewedBy: {
        userId: context.userDoc.id,
        username: context.userDoc.username,
      },
      reviewedAt: new Date().toISOString(),
    });

    await ref.set(updateData, { merge: true });

    return NextResponse.json({
      request: {
        id: snap.id,
        ...(snap.data() as Omit<RepositionRequest, "id">),
        ...updateData,
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Falha ao atualizar solicitação de reposição.",
      },
      { status: 400 }
    );
  }
}
