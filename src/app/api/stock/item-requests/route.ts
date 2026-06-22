import { NextRequest, NextResponse } from "next/server";

import { requireUser } from "@/lib/auth-server";
import { dbAdmin } from "@/lib/firebase-admin";
import { createManualTask, ensureTaskProject, ensureTaskSubproject } from "@/features/tasks/lib/server";
import { type ItemAdditionRequest } from "@/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ITEM_REQUEST_ASSIGNEE_ID = "__item_request_approver__";
const ITEM_REQUEST_ORIGIN_LINK = "/dashboard/stock/item-requests";
const STOCK_TASK_PROJECT_SLUG = "stock";
const ITEM_REQUEST_SUBPROJECT_SLUG = "item-requests";

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

    const projectId = await ensureTaskProject(context, {
      slug: STOCK_TASK_PROJECT_SLUG,
      name: "Gestão de Estoque",
      description: "Projeto macro das tarefas operacionais de estoque.",
    });
    const subprojectId = await ensureTaskSubproject(context, {
      projectId,
      slug: ITEM_REQUEST_SUBPROJECT_SLUG,
      name: "Solicitações de cadastro",
      description: "Quadro de tarefas geradas por solicitações de cadastro de insumos vindas da operação.",
    });

    const task = await createManualTask({
      context,
      input: {
        title: `Nova solicitação de cadastro: ${body.productName.trim()}`,
        description: [
          `Solicitado por ${context.userDoc.username}`,
          `Unidade: ${kioskName}`,
          `Produto: ${body.productName.trim()}`,
          typeof body.brand === "string" && body.brand.trim() ? `Marca: ${body.brand.trim()}` : "",
          typeof body.lote === "string" && body.lote.trim() ? `Lote: ${body.lote.trim()}` : "",
          typeof body.notes === "string" && body.notes.trim() ? `Observações: ${body.notes.trim()}` : "",
        ].filter(Boolean).join("\n"),
        assigneeType: "role",
        assigneeId: ITEM_REQUEST_ASSIGNEE_ID,
        requiresApproval: false,
        origin: {
          kind: "legacy",
          type: "item_addition_request",
          id: requestRef.id,
        },
        projectId,
        subprojectId,
        subprojectName: "Solicitações de cadastro",
        unitId: body.kioskId,
        unitName: kioskName,
        priority: "normal",
        watcherUserIds: [context.userDoc.id],
        visibilityScope: "unit",
        originLink: ITEM_REQUEST_ORIGIN_LINK,
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
