import { NextRequest, NextResponse } from "next/server";

import { requireUser } from "@/lib/auth-server";
import { assertTasksModuleEnabled } from "@/features/tasks/lib/server-access";
import {
  ensureDefaultTaskProject,
  ensureTaskFromOrigin,
  updateTaskDocument,
} from "@/features/tasks/lib/server";
import { type Task } from "@/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function mapReceiptStatusToTaskStatus(status: string): Task["status"] {
  if (status === "awaiting_delivery") return "pending";
  if (status === "in_conference" || status === "awaiting_stock" || status === "in_stock_entry" || status === "partially_stocked") return "in_progress";
  if (status === "stocked" || status === "stocked_with_divergence") return "completed";
  if (status === "cancelled") return "rejected";
  return "pending";
}

export async function POST(request: NextRequest) {
  try {
    const context = await requireUser(request);
    const flags = await assertTasksModuleEnabled(context.workspace_id);
    if (!flags.tasks_from_purchase_receipt_enabled || flags.kill_tasks_from_purchase_receipt) {
      return NextResponse.json(
        { error: "Integração de recebimento com tarefas desativada." },
        { status: 409 }
      );
    }

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (
      !body ||
      typeof body.receiptId !== "string" ||
      typeof body.purchaseOrderId !== "string" ||
      typeof body.supplierId !== "string" ||
      typeof body.status !== "string" ||
      typeof body.receiptMode !== "string"
    ) {
      return NextResponse.json({ error: "Payload inválido para sincronização." }, { status: 400 });
    }

    if (body.receiptMode !== "future_delivery") {
      return NextResponse.json({ skipped: true, reason: "receipt_mode_not_supported" });
    }

    const defaultProjectId = await ensureDefaultTaskProject(context);
    const ensured = await ensureTaskFromOrigin({
      workspaceId: context.workspace_id,
      actor: {
        user_id: context.userDoc.id,
        username: context.userDoc.username,
      },
      trigger: {
        id: "purchase_receipt_followup",
        title_template: `Recebimento pendente ${body.receiptId}`,
        description_template:
          typeof body.notes === "string" && body.notes.trim()
            ? body.notes.trim()
            : "Acompanhar o recebimento e sua conclusão.",
        task_project_id: defaultProjectId,
        assignee_type: "user",
        assignee_id: context.userDoc.id,
        requires_approval: false,
      },
      origin: {
        kind: "purchase_receipt",
        receipt_id: body.receiptId,
        purchase_order_id: body.purchaseOrderId,
      },
      title: `Recebimento ${body.receiptId.slice(-6)} - ${body.status}`,
      description:
        typeof body.supplierName === "string" && body.supplierName.trim()
          ? `Fornecedor: ${body.supplierName.trim()}`
          : "Acompanhar o recebimento de compra futura.",
      dueDate: typeof body.expectedDate === "string" ? body.expectedDate : undefined,
    });

    const desiredStatus = mapReceiptStatusToTaskStatus(body.status);
    const task =
      ensured.task.status === desiredStatus
        ? ensured.task
        : await updateTaskDocument({
            context,
            taskId: ensured.task.id,
            allowOriginStatusChange: true,
            updates: {
              status: desiredStatus,
              description:
                typeof body.supplierName === "string" && body.supplierName.trim()
                  ? `Fornecedor: ${body.supplierName.trim()}`
                  : ensured.task.description,
            },
          });

    return NextResponse.json({ task, created: ensured.created });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Falha ao sincronizar recebimento com tarefas.",
      },
      { status: 400 }
    );
  }
}
