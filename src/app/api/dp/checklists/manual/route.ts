import { NextRequest, NextResponse } from "next/server";

import {
  buildChecklistExecutionItems,
  buildChecklistExecutionSections,
  buildManualChecklistExecutionId,
} from "@/features/dp-checklists/lib/core";
import { checklistManualExecutionSchema } from "@/features/dp-checklists/lib/schemas";
import { assertDPChecklistAccess } from "@/features/dp-checklists/lib/server-access";
import {
  appendChecklistAudit,
  checklistDbAdmin,
  loadChecklistActor,
  loadChecklistReferenceData,
  normalizeChecklistExecutionForApi,
  normalizeChecklistTemplateForApi,
} from "@/features/dp-checklists/lib/server";
import type { User } from "@/types";
import { dbAdmin } from "@/lib/firebase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BLANK_MANUAL_TEMPLATE_META: Record<string, { templateId: string; name: string }> = {
  routine: {
    templateId: "manual-blank-routine",
    name: "Rotina manual",
  },
  audit: {
    templateId: "manual-blank-audit",
    name: "Auditoria manual",
  },
  incident: {
    templateId: "manual-blank-incident",
    name: "Ocorrência manual",
  },
  receiving: {
    templateId: "manual-blank-receiving",
    name: "Recebimento manual",
  },
  maintenance: {
    templateId: "manual-blank-maintenance",
    name: "Manutenção manual",
  },
  one_time: {
    templateId: "manual-blank-one-time",
    name: "Evento único manual",
  },
} as const;

function getTodayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

async function loadUser(userId: string) {
  const snap = await dbAdmin.collection("users").doc(userId).get();
  if (!snap.exists) {
    return null;
  }

  return {
    id: snap.id,
    ...(snap.data() as Omit<User, "id">),
  } as User;
}

export async function POST(request: NextRequest) {
  try {
    const access = await assertDPChecklistAccess(request, "operate");
    const actor = await loadChecklistActor(access.decoded.uid);
    const rawBody = await request.json();
    const parsed = checklistManualExecutionSchema.parse(rawBody);

    const [templateSnap, actorUser, references] = await Promise.all([
      parsed.templateId
        ? checklistDbAdmin.collection("checklistTemplates").doc(parsed.templateId).get()
        : Promise.resolve(null),
      loadUser(actor.userId),
      loadChecklistReferenceData(),
    ]);

    const template =
      templateSnap && "exists" in templateSnap && templateSnap.exists
        ? normalizeChecklistTemplateForApi(templateSnap.id, templateSnap.data() ?? {})
        : null;

    if (parsed.templateId && !template) {
      return NextResponse.json({ error: "Template não encontrado." }, { status: 404 });
    }

    const manualType = template?.templateType ?? parsed.templateType;

    if (!manualType) {
      return NextResponse.json(
        { error: "Informe um tipo manual válido." },
        { status: 400 }
      );
    }

    if (template && manualType !== template.templateType) {
      return NextResponse.json(
        { error: "O tipo informado não corresponde ao template selecionado." },
        { status: 400 }
      );
    }

    if (manualType === "incident" && !parsed.incidentContext) {
      return NextResponse.json(
        { error: "Informe o contexto da ocorrência." },
        { status: 400 }
      );
    }

    if (manualType === "receiving" && (!parsed.supplierName || !parsed.invoiceNumber)) {
      return NextResponse.json(
        { error: "Informe fornecedor e número da nota fiscal." },
        { status: 400 }
      );
    }

    if (manualType === "one_time" && !parsed.scheduledDate) {
      return NextResponse.json(
        { error: "Informe a data agendada para o checklist pontual." },
        { status: 400 }
      );
    }

    if (manualType === "one_time" && !access.canManageTemplates) {
      return NextResponse.json(
        { error: "Sem permissão para criar checklists pontuais." },
        { status: 403 }
      );
    }

    if (manualType === "receiving" && template) {
      const actorFunctions = new Set(actorUser?.jobFunctionIds ?? []);
      const allowedFunctions = template.jobFunctionIds ?? [];
      const hasCompatibleFunction =
        allowedFunctions.length === 0 ||
        allowedFunctions.some((functionId) => actorFunctions.has(functionId));

      if (!hasCompatibleFunction) {
        return NextResponse.json(
          {
            error:
              "Você não possui uma função compatível para registrar esse checklist de recebimento.",
          },
          { status: 403 }
        );
      }
    }

    const assignedUserId =
      parsed.assignedUserId && parsed.assignedUserId !== actor.userId
        ? access.canManageTemplates
          ? parsed.assignedUserId
          : actor.userId
        : actor.userId;
    const assignedUser = await loadUser(assignedUserId);
    if (!assignedUser) {
      return NextResponse.json(
        { error: "Usuário responsável não encontrado." },
        { status: 404 }
      );
    }

    const collaboratorIds = (parsed.collaboratorUserIds ?? []).filter(
      (id) => id && id !== assignedUserId
    );
    const collaboratorUsers = await Promise.all(
      collaboratorIds.map((id) => loadUser(id))
    );
    const collaboratorUserIds: string[] = [];
    const collaboratorUsernames: string[] = [];
    collaboratorUsers.forEach((user, index) => {
      if (!user) return;
      collaboratorUserIds.push(collaboratorIds[index]);
      collaboratorUsernames.push(
        typeof user.username === "string" && user.username.trim()
          ? user.username
          : collaboratorIds[index]
      );
    });

    const checklistDate =
      manualType === "one_time"
        ? parsed.scheduledDate!
        : parsed.date || getTodayIsoDate();

    const unitId =
      parsed.unitId ||
      (template?.unitIds?.length === 1 ? template.unitIds[0] : undefined) ||
      (assignedUser.unitIds?.length === 1 ? assignedUser.unitIds[0] : undefined);

    if (!unitId) {
      return NextResponse.json(
        { error: "Informe a unidade do checklist manual." },
        { status: 400 }
      );
    }

    const blankMeta = BLANK_MANUAL_TEMPLATE_META[manualType] ?? {
      templateId: `manual-blank-${manualType}`,
      name: `Checklist manual — ${manualType}`,
    };
    const templateId = template?.id ?? blankMeta.templateId;
    const templateName = template?.name ?? blankMeta.name;
    const templateVersion = template?.version ?? 1;
    const templateSections = template?.sections ?? parsed.sections ?? [];

    const executionId = buildManualChecklistExecutionId({
      date: checklistDate,
      templateId,
      userId: assignedUserId,
    });

    const executionData = {
      checklistDate,
      templateId,
      templateName,
      templateType: manualType,
      templateVersion,
      occurrenceType: "manual",
      scheduleId: "manual",
      shiftId: executionId,
      unitId,
      unitName: references.unitNameById.get(unitId) ?? unitId,
      shiftDefinitionId: null,
      shiftDefinitionName: null,
      assignedUserId,
      assignedUsername:
        typeof assignedUser.username === "string" && assignedUser.username.trim()
          ? assignedUser.username
          : assignedUserId,
      collaboratorUserIds,
      collaboratorUsernames,
      createdByUserId: actor.userId,
      createdByUsername: actor.username,
      sections: buildChecklistExecutionSections(templateSections),
      shiftStartTime: "",
      shiftEndTime: "",
      shiftEndDate: checklistDate,
      status: "pending",
      score: null,
      items: buildChecklistExecutionItems(templateSections),
      incidentContext:
        manualType === "incident" ? parsed.incidentContext ?? null : null,
      supplierName:
        manualType === "receiving" ? parsed.supplierName ?? null : null,
      invoiceNumber:
        manualType === "receiving" ? parsed.invoiceNumber ?? null : null,
      scheduledDate:
        manualType === "one_time" ? parsed.scheduledDate ?? null : null,
      claimedByUserId: null,
      claimedByUsername: null,
      claimedAt: null,
      completedByUserId: null,
      completedByUsername: null,
      completedAt: null,
      reviewedBy: null,
      reviewNotes: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    await checklistDbAdmin
      .collection("checklistExecutions")
      .doc(executionId)
      .set(executionData);

    await appendChecklistAudit("manual_execution_created", {
      actorUserId: actor.userId,
      actorUsername: actor.username,
      executionId,
      templateId,
      templateName,
      templateType: manualType,
      checklistDate,
      assignedUserId,
      unitId,
    });

    return NextResponse.json({
      execution: normalizeChecklistExecutionForApi(executionId, executionData),
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Erro ao criar checklist manual.";

    return NextResponse.json({ error: message }, { status: 400 });
  }
}
