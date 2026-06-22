import { NextRequest, NextResponse } from "next/server";

import { requireUser } from "@/lib/auth-server";
import { dbAdmin } from "@/lib/firebase-admin";
import { assertTaskPermission, assertTasksModuleEnabled } from "@/features/tasks/lib/server-access";
import { ensureTaskProjectStatuses, listTaskSubprojects } from "@/features/tasks/lib/server";
import { logAction } from "@/lib/log-action";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function slugify(value: string) {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "subprojeto";
}

export async function GET(request: NextRequest) {
  try {
    const context = await requireUser(request);
    await assertTasksModuleEnabled(context.workspace_id);
    assertTaskPermission(context.permissions, context.isDefaultAdmin, null, "view");

    const { searchParams } = new URL(request.url);
    const projectIds = searchParams.getAll("projectId").map((value) => value.trim()).filter(Boolean);
    const subprojects = await listTaskSubprojects(projectIds);
    return NextResponse.json({ subprojects });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao listar subprojetos." },
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
      !body.name.trim()
    ) {
      return NextResponse.json({ error: "Projeto e nome do subprojeto são obrigatórios." }, { status: 400 });
    }

    const projectSnap = await dbAdmin.collection("task_projects").doc(body.project_id).get();
    if (!projectSnap.exists) {
      return NextResponse.json({ error: "Projeto não encontrado." }, { status: 404 });
    }

    const now = new Date().toISOString();
    const slug = typeof body.slug === "string" && body.slug.trim()
      ? slugify(body.slug)
      : slugify(body.name.trim());
    const ref = dbAdmin.collection("task_subprojects").doc(`${body.project_id}__${slug}`);
    const payload = {
      workspace_id: context.workspace_id,
      project_id: body.project_id,
      name: body.name.trim(),
      description: typeof body.description === "string" ? body.description.trim() : "",
      slug,
      order: typeof body.order === "number" ? body.order : 0,
      created_at: now,
      updated_at: now,
      created_by: {
        user_id: context.userDoc.id,
        username: context.userDoc.username,
      },
    };
    await ref.set(payload, { merge: true });
    await ensureTaskProjectStatuses(body.project_id, ref.id);
    const statusesSnap = await dbAdmin
      .collection("task_statuses")
      .where("subproject_id", "==", ref.id)
      .get();
    const statuses = statusesSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));

    await logAction({
      workspace_id: context.workspace_id,
      user_id: context.userDoc.id,
      username: context.userDoc.username,
      module: "tasks",
      action: "subproject_created",
      metadata: { project_id: body.project_id, subproject_id: ref.id, name: payload.name },
    });

    return NextResponse.json({ subproject: { id: ref.id, ...payload }, statuses }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao criar subprojeto." },
      { status: 400 }
    );
  }
}
