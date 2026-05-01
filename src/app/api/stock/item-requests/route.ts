import { NextRequest, NextResponse } from "next/server";

import { requireUser } from "@/lib/auth-server";
import { dbAdmin } from "@/lib/firebase-admin";
import { createManualTask } from "@/features/tasks/lib/server";
import { type ItemAdditionRequest } from "@/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function canReadRequests(context: Awaited<ReturnType<typeof requireUser>>) {
  return (
    context.isDefaultAdmin ||
    context.permissions.itemRequests.approve ||
    !!context.permissions?.stock?.stockCount?.perform
  );
}

function canCreateRequests(context: Awaited<ReturnType<typeof requireUser>>) {
  return (
    context.isDefaultAdmin ||
    context.permissions.itemRequests.add ||
    !!context.permissions?.stock?.stockCount?.perform
  );
}

export async function GET(request: NextRequest) {
  try {
    const context = await requireUser(request);
    if (!canReadRequests(context)) {
      return NextResponse.json(
        { error: "Sem permissão para visualizar solicitações." },
        { status: 403 }
      );
    }

    const snap = await dbAdmin.collection("itemAdditionRequests").get();
    const requests = snap.docs
      .map((doc) => ({ id: doc.id, ...(doc.data() as Omit<ItemAdditionRequest, "id">) }))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));

    return NextResponse.json({ requests });
  } catch (error) {
    console.error("[ITEM REQUESTS GET] Erro ao carregar solicitações", error);

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Falha ao carregar solicitações.",
      },
      { status: 400 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const context = await requireUser(request);
    if (!canCreateRequests(context)) {
      return NextResponse.json(
        { error: "Sem permissão para criar solicitações." },
        { status: 403 }
      );
    }

    const body = (await request.json().catch(() => null)) as
      | Record<string, unknown>
      | null;
    if (
      !body ||
      typeof body.kioskId !== "string" ||
      !body.kioskId ||
      typeof body.productName !== "string" ||
      !body.productName.trim()
    ) {
      return NextResponse.json(
        { error: "Quiosque e nome do produto são obrigatórios." },
        { status: 400 }
      );
    }

    const kioskSnap = await dbAdmin.collection("kiosks").doc(body.kioskId).get();
    if (!kioskSnap.exists) {
      return NextResponse.json(
        { error: "Quiosque não encontrado." },
        { status: 404 }
      );
    }

    const requestRef = dbAdmin.collection("itemAdditionRequests").doc();
    const now = new Date().toISOString();
    const kioskData = kioskSnap.data() ?? {};
    const kioskName =
      typeof kioskData.name === "string" ? kioskData.name : "Quiosque";

    const task = await createManualTask({
      context,
      input: {
        title: `Nova solicitação de cadastro: ${body.productName.trim()}`,
        description: `Solicitado por ${context.userDoc.username} para o quiosque ${kioskName}.`,
        assigneeType: "profile",
        assigneeId:
          typeof body.assigneeProfileId === "string" && body.assigneeProfileId
            ? body.assigneeProfileId
            : "admin",
        requiresApproval: false,
        origin: {
          kind: "legacy",
          type: "item_addition_request",
          id: requestRef.id,
        },
      },
    });

    const payload: Omit<ItemAdditionRequest, "id"> = {
      kioskId: body.kioskId,
      kioskName,
      requestedBy: {
        userId: context.userDoc.id,
        username: context.userDoc.username,
      },
      productName: body.productName.trim(),
      ...(typeof body.brand === "string" ? { brand: body.brand.trim() } : {}),
      ...(typeof body.lote === "string" ? { lote: body.lote.trim() } : {}),
      ...(typeof body.barcode === "string" ? { barcode: body.barcode.trim() } : {}),
      ...(typeof body.expiryDate === "string" ? { expiryDate: body.expiryDate } : {}),
      ...(typeof body.notes === "string" ? { notes: body.notes.trim() } : {}),
      status: "pending",
      createdAt: now,
      taskId: task.id,
    };

    await requestRef.set(payload);
    return NextResponse.json(
      { request: { id: requestRef.id, ...payload } },
      { status: 201 }
    );
  } catch (error) {
    console.error("[ITEM REQUESTS POST] Erro ao criar solicitação", error);

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Falha ao criar solicitação.",
      },
      { status: 400 }
    );
  }
}
