import { NextRequest, NextResponse } from "next/server";

import { requireUser } from "@/lib/auth-server";
import { dbAdmin } from "@/lib/firebase-admin";
import { assertTaskPermission, assertTasksModuleEnabled } from "@/features/tasks/lib/server-access";
import { listTaskStatuses } from "@/features/tasks/lib/server";
import { logAction } from "@/lib/log-action";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const context = await requireUser(request);
    await assertTasksModuleEnabled(context.workspace_id);
    assertTaskPermission(context.permissions, context.isDefaultAdmin, null, "view");
    const { searchParams } = new URL(request.url);
    const projectIds = searchParams.getAll("projectId").map((value) => value.trim()).filter(Boolean);
    const statuses = await listTaskStatuses(projectIds);
    return NextResponse.json({ statuses });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao listar status." },
      { status: 403 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const context = await requireUser(request);
    await assertTasksModuleEnabled(context.workspace_id);
    assertTaskPermission(context.permissions, context.isDefaultAdmin, null, "manage");

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (
      !body ||
      typeof body.project_id !== "string" ||
      !body.project_id ||
      typeof body.name !== "string" ||
      !body.name.trim() ||
      typeof body.slug !== "string" ||
      !body.slug.trim()
    ) {
      return NextResponse.json({ error: "Projeto, nome e slug são obrigatórios." }, { status: 400 });
    }

    const ref = dbAdmin.collection("task_statuses").doc();
    const payload = {
      project_id: body.project_id,
      name: body.name.trim(),
      slug: body.slug.trim(),
      category: typeof body.category === "string" ? body.category : "active",
      is_initial: body.is_initial === true,
      is_terminal: body.is_terminal === true,
      order: typeof body.order === "number" ? body.order : 0,
      color: typeof body.color === "string" ? body.color : null,
    };
    await ref.set(payload);

    await logAction({
      workspace_id: context.workspace_id,
      user_id: context.userDoc.id,
      username: context.userDoc.username,
      module: "tasks",
      action: "status_created",
      metadata: { status_id: ref.id, project_id: payload.project_id, slug: payload.slug },
    });

    return NextResponse.json({ status: { id: ref.id, ...payload } }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao criar status." },
      { status: 400 }
    );
  }
}
