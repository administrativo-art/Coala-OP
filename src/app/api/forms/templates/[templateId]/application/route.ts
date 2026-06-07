import { NextRequest, NextResponse } from "next/server";

import { formApplicationSchema } from "@/features/forms/lib/schemas";
import {
  getActiveFormAssignment,
  getFormTemplateById,
  listFormAssignments,
} from "@/features/forms/lib/server";
import { assertFormPermission } from "@/features/forms/lib/server-access";
import { requireUser } from "@/lib/auth-server";
import { checklistDbAdmin } from "@/lib/firebase-checklist-admin";
import { logAction } from "@/lib/log-action";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ templateId: string }> }
) {
  try {
    const user = await requireUser(request);
    const { templateId } = await context.params;
    const template = await getFormTemplateById(templateId);

    if (!template) {
      return NextResponse.json({ error: "Formulário não encontrado." }, { status: 404 });
    }

    assertFormPermission(
      user.permissions,
      user.isDefaultAdmin,
      template.form_project_id,
      "view"
    );

    const [activeAssignment, assignments] = await Promise.all([
      getActiveFormAssignment({
        workspaceId: user.workspace_id,
        formTemplateId: templateId,
      }),
      listFormAssignments({
        workspaceId: user.workspace_id,
        formTemplateId: templateId,
      }),
    ]);

    return NextResponse.json({
      active_assignment: activeAssignment,
      assignments,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao carregar aplicação." },
      { status: 403 }
    );
  }
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ templateId: string }> }
) {
  try {
    const user = await requireUser(request);
    const { templateId } = await context.params;
    const template = await getFormTemplateById(templateId);

    if (!template) {
      return NextResponse.json({ error: "Formulário não encontrado." }, { status: 404 });
    }

    assertFormPermission(
      user.permissions,
      user.isDefaultAdmin,
      template.form_project_id,
      "manage"
    );

    const parsed = formApplicationSchema.parse(await request.json());
    const now = new Date();
    const activeAssignments = await listFormAssignments({
      workspaceId: user.workspace_id,
      formTemplateId: templateId,
      status: "active",
    });

    const batch = checklistDbAdmin.batch();
    const activeAssignmentIds = activeAssignments.map((assignment) => assignment.id);
    for (const assignment of activeAssignments) {
      const assignmentRef = checklistDbAdmin.collection("form_assignments").doc(assignment.id);
      batch.update(assignmentRef, {
        status: "inactive",
        ends_at: now.toISOString(),
        ended_at: now.toISOString(),
        ended_by: {
          user_id: user.userDoc.id,
          username: user.userDoc.username,
        },
        ended_reason: "replaced_by_new_application",
        pending_policy: parsed.pending_policy,
        updated_at: now,
        updated_by: {
          user_id: user.userDoc.id,
          username: user.userDoc.username,
        },
      });
    }

    if (parsed.pending_policy === "cancel") {
      const pendingSnap = await checklistDbAdmin
        .collection("form_executions")
        .where("template_id", "==", templateId)
        .where("status", "==", "pending")
        .get();

      pendingSnap.docs
        .filter((doc) => {
          const assignmentId = doc.data()?.assignment_id;
          return !assignmentId || activeAssignmentIds.includes(String(assignmentId));
        })
        .forEach((doc) => {
          batch.update(doc.ref, {
            status: "canceled",
            canceled_by_user_id: user.userDoc.id,
            canceled_at: now.toISOString(),
            updated_at: now,
            cancellation_reason: "application_replaced",
          });
        });
    }

    const assignmentRef = checklistDbAdmin.collection("form_assignments").doc();
    const assignment = {
      workspace_id: user.workspace_id,
      form_project_id: template.form_project_id,
      form_template_id: templateId,
      application_mode: parsed.application_mode,
      status: "active",
      starts_at: now.toISOString(),
      ends_at: null,
      occurrence_type: parsed.occurrence_type,
      unit_ids: parsed.unit_ids,
      unit_names: parsed.unit_names,
      shift_definition_ids:
        parsed.application_mode === "schedule" ? parsed.shift_definition_ids : [],
      shift_definition_names:
        parsed.application_mode === "schedule" ? parsed.shift_definition_names : [],
      job_role_ids: parsed.job_role_ids,
      job_role_names: parsed.job_role_names,
      job_function_ids: parsed.job_function_ids,
      job_function_names: parsed.job_function_names,
      due_rule: parsed.due_rule,
      pending_policy: parsed.pending_policy,
      created_at: now,
      updated_at: now,
      created_by: {
        user_id: user.userDoc.id,
        username: user.userDoc.username,
      },
      updated_by: {
        user_id: user.userDoc.id,
        username: user.userDoc.username,
      },
    };

    batch.set(assignmentRef, assignment);
    batch.update(checklistDbAdmin.collection("form_templates").doc(templateId), {
      application_mode: parsed.application_mode,
              active_assignment_id: assignmentRef.id,
      occurrence_type: parsed.occurrence_type,
      unit_ids: parsed.unit_ids,
      unit_names: parsed.unit_names,
      shift_definition_ids:
        parsed.application_mode === "schedule" ? parsed.shift_definition_ids : [],
      shift_definition_names:
        parsed.application_mode === "schedule" ? parsed.shift_definition_names : [],
      job_role_ids: parsed.job_role_ids,
      job_role_names: parsed.job_role_names,
      job_function_ids: parsed.job_function_ids,
      job_function_names: parsed.job_function_names,
      due_rule: parsed.due_rule,
      updated_at: now,
      updated_by: {
        user_id: user.userDoc.id,
        username: user.userDoc.username,
      },
    });

    await batch.commit();
    await logAction({
      workspace_id: user.workspace_id,
      user_id: user.userDoc.id,
      username: user.userDoc.username,
      module: "forms",
      action: "template_application_updated",
      metadata: {
        template_id: templateId,
        assignment_id: assignmentRef.id,
        application_mode: parsed.application_mode,
        unit_count: parsed.unit_ids.length,
        shift_count: parsed.shift_definition_ids.length,
        pending_policy: parsed.pending_policy,
      },
    });

    return NextResponse.json({
      assignment: {
        id: assignmentRef.id,
        ...assignment,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao atualizar aplicação." },
      { status: 400 }
    );
  }
}
