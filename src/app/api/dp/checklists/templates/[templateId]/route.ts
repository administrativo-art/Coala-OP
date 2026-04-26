import { NextRequest, NextResponse } from "next/server";

import { checklistTemplateSchema } from "@/features/dp-checklists/lib/schemas";
import { assertDPChecklistAccess } from "@/features/dp-checklists/lib/server-access";
import {
  appendChecklistAudit,
  checklistDbAdmin,
  loadChecklistActor,
  loadChecklistReferenceData,
  normalizeChecklistTemplateForApi,
} from "@/features/dp-checklists/lib/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function resolveOccurrenceType(
  templateType: string,
  occurrenceType?: string
) {
  return occurrenceType ?? "manual";
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ templateId: string }> }
) {
  try {
    const access = await assertDPChecklistAccess(request, "manage");
    const actor = await loadChecklistActor(access.decoded.uid);
    const { templateId } = await context.params;

    if (!templateId) {
      return NextResponse.json(
        { error: "Template inválido." },
        { status: 400 }
      );
    }

    const templateRef = checklistDbAdmin
      .collection("checklistTemplates")
      .doc(templateId);
    const existingSnap = await templateRef.get();

    if (!existingSnap.exists) {
      return NextResponse.json(
        { error: "Template não encontrado." },
        { status: 404 }
      );
    }

    const rawBody = await request.json();
    const parsed = checklistTemplateSchema.parse(rawBody);
    const currentData = (existingSnap.data() ?? {}) as Record<string, unknown>;
    const currentVersion =
      typeof currentData.version === "number" && Number.isFinite(currentData.version)
        ? currentData.version
        : 1;
    const {
      unitNameById,
      shiftDefinitionNameById,
      roleNameById,
      functionNameById,
    } =
      await loadChecklistReferenceData();
    const occurrenceType = resolveOccurrenceType(
      parsed.templateType,
      parsed.occurrenceType
    );
    const currentHistory = Array.isArray(currentData.versionHistory)
      ? currentData.versionHistory
      : [];
    const historyEntry = {
      version: currentVersion,
      updatedBy: actor.username,
      updatedAt: new Date().toISOString(),
      changeNotes: parsed.changeNotes || undefined,
    };

    const updateData = {
      name: parsed.name,
      description: parsed.description || null,
      category: parsed.category || null,
      templateType: parsed.templateType,
      occurrenceType,
      unitIds: parsed.unitIds,
      unitNames: parsed.unitIds.map((id) => unitNameById.get(id) ?? id),
      jobRoleIds: parsed.jobRoleIds,
      jobRoleNames: parsed.jobRoleIds.map((id) => roleNameById.get(id) ?? id),
      jobFunctionIds: parsed.jobFunctionIds,
      jobFunctionNames: parsed.jobFunctionIds.map(
        (id) => functionNameById.get(id) ?? id
      ),
      shiftDefinitionIds: parsed.shiftDefinitionIds,
      shiftDefinitionNames: parsed.shiftDefinitionIds.map(
        (id) => shiftDefinitionNameById.get(id) ?? id
      ),
      isActive: parsed.isActive,
      version: currentVersion + 1,
      versionHistory: [...currentHistory, historyEntry],
      sections: parsed.sections.map((section, sIdx) => ({
        id: section.id,
        title: section.title,
        order: sIdx,
        showIf: section.showIf ?? null,
        requirePhoto: section.requirePhoto ?? false,
        requireSignature: section.requireSignature ?? false,
        items: section.items.map((item, iIdx) => ({
          id: item.id,
          order: iIdx,
          title: item.title,
          description: item.description || null,
          type: item.type,
          required: item.required,
          weight: item.weight,
          blockNext: item.blockNext,
          criticality: item.criticality,
          referenceValue: item.referenceValue ?? null,
          tolerancePercent: item.tolerancePercent ?? null,
          actionRequired: item.actionRequired ?? false,
          notifyRoleIds: item.notifyRoleIds ?? [],
          escalationMinutes: item.escalationMinutes ?? null,
          showIf: item.showIf ?? null,
          conditionalBranches: item.conditionalBranches ?? [],
          config: item.config ?? null,
        })),
      })),
      updatedAt: new Date(),
      updatedBy: { userId: actor.userId, username: actor.username },
    };

    await templateRef.update(updateData);

    const itemCount = parsed.sections.reduce(
      (sum, section) => sum + section.items.length,
      0
    );

    await appendChecklistAudit("template_updated", {
      actorUserId: actor.userId,
      actorUsername: actor.username,
      templateId,
      templateName: parsed.name,
      templateType: parsed.templateType,
      occurrenceType,
      version: currentVersion + 1,
      unitIds: parsed.unitIds,
      jobRoleIds: parsed.jobRoleIds,
      jobFunctionIds: parsed.jobFunctionIds,
      shiftDefinitionIds: parsed.shiftDefinitionIds,
      sectionCount: parsed.sections.length,
      itemCount,
    });

    return NextResponse.json({
      template: normalizeChecklistTemplateForApi(templateId, {
        ...currentData,
        ...updateData,
      }),
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Erro ao atualizar o template de checklist.";

    return NextResponse.json({ error: message }, { status: 400 });
  }
}
