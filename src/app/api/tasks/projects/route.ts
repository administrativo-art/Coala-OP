import { NextRequest, NextResponse } from "next/server";

import { requireUser } from "@/lib/auth-server";
import { dbAdmin } from "@/lib/firebase-admin";
import { assertTaskPermission, assertTasksModuleEnabled } from "@/features/tasks/lib/server-access";
import { listTaskProjects } from "@/features/tasks/lib/server";
import { logAction } from "@/lib/log-action";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const context = await requireUser(request);
    await assertTasksModuleEnabled(context.workspace_id);
    assertTaskPermission(context.permissions, context.isDefaultAdmin, null, "view");

    const projects = await listTaskProjects(context.workspace_id);
    return NextResponse.json({ projects });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao listar projetos." },
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
    if (!body || typeof body.name !== "string" || !body.name.trim()) {
      return NextResponse.json({ error: "Nome do projeto é obrigatório." }, { status: 400 });
    }

    const now = new Date().toISOString();
    const ref = dbAdmin.collection("task_projects").doc();
    const payload = {
      workspace_id: context.workspace_id,
      name: body.name.trim(),
      description: typeof body.description === "string" ? body.description.trim() : "",
      members: Array.isArray(body.members) ? body.members : [],
      created_at: now,
      updated_at: now,
      created_by: {
        user_id: context.userDoc.id,
        username: context.userDoc.username,
      },
    };
    await ref.set(payload);

    await logAction({
      workspace_id: context.workspace_id,
      user_id: context.userDoc.id,
      username: context.userDoc.username,
      module: "tasks",
      action: "project_created",
      metadata: { project_id: ref.id, name: payload.name },
    });

    return NextResponse.json({ project: { id: ref.id, ...payload } }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao criar projeto." },
      { status: 400 }
    );
  }
}
