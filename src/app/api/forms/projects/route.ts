import { NextRequest, NextResponse } from "next/server";

import { listFormProjects, serializeFormValue } from "@/features/forms/lib/server";
import { formProjectSchema } from "@/features/forms/lib/schemas";
import { assertFormPermission } from "@/features/forms/lib/server-access";
import { requireUser } from "@/lib/auth-server";
import { checklistDbAdmin } from "@/lib/firebase-checklist-admin";
import { logAction } from "@/lib/log-action";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const user = await requireUser(request);
    const projects = await listFormProjects(user.workspace_id);
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
    const user = await requireUser(request);
    assertFormPermission(user.permissions, user.isDefaultAdmin, null, "manage");

    const parsed = formProjectSchema.parse(await request.json());
    const now = new Date();
    const ref = checklistDbAdmin.collection("form_projects").doc();
    const project = {
      workspace_id: user.workspace_id,
      name: parsed.name,
      description: parsed.description ?? null,
      color: parsed.color ?? null,
      icon: parsed.icon ?? null,
      is_active: parsed.is_active,
      members: parsed.members,
      created_at: now,
      updated_at: now,
      created_by: {
        user_id: user.userDoc.id,
        username: user.userDoc.username,
      },
    };

    await ref.set(project);
    await logAction({
      workspace_id: user.workspace_id,
      user_id: user.userDoc.id,
      username: user.userDoc.username,
      module: "forms",
      action: "project_created",
      metadata: {
        project_id: ref.id,
        name: parsed.name,
      },
    });

    return NextResponse.json(
      {
        project: {
          id: ref.id,
          ...((serializeFormValue(project) as Record<string, unknown>) ?? {}),
        },
      },
      { status: 201 }
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao criar projeto." },
      { status: 400 }
    );
  }
}
