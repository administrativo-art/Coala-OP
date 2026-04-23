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
import { countTemplateItems } from "@/features/dp-checklists/lib/core";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const access = await assertDPChecklistAccess(request, "manage");
    const actor = await loadChecklistActor(access.decoded.uid);
    const rawBody = await request.json();
    const parsed = checklistTemplateSchema.parse(rawBody);
    const { unitNameById, shiftDefinitionNameById } =
      await loadChecklistReferenceData();

    const now = new Date();
    const templateRef = checklistDbAdmin.collection("checklistTemplates").doc();
    const templateData = {
      name: parsed.name,
      description: parsed.description || null,
      category: parsed.category || null,
      unitIds: parsed.unitIds,
      unitNames: parsed.unitIds.map((id) => unitNameById.get(id) ?? id),
      shiftDefinitionIds: parsed.shiftDefinitionIds,
      shiftDefinitionNames: parsed.shiftDefinitionIds.map(
        (id) => shiftDefinitionNameById.get(id) ?? id
      ),
      isActive: parsed.isActive,
      sections: parsed.sections.map((section, sIdx) => ({
        id: section.id,
        title: section.title,
        order: sIdx,
        items: section.items.map((item, iIdx) => ({
          id: item.id,
          order: iIdx,
          title: item.title,
          description: item.description || null,
          type: item.type,
          required: item.required,
          weight: item.weight,
          config: item.config ?? null,
        })),
      })),
      createdAt: now,
      updatedAt: now,
      createdBy: { userId: actor.userId, username: actor.username },
      updatedBy: { userId: actor.userId, username: actor.username },
    };

    await templateRef.set(templateData);

    const itemCount = parsed.sections.reduce(
      (sum, section) => sum + section.items.length,
      0
    );

    await appendChecklistAudit("template_created", {
      actorUserId: actor.userId,
      actorUsername: actor.username,
      templateId: templateRef.id,
      templateName: parsed.name,
      unitIds: parsed.unitIds,
      shiftDefinitionIds: parsed.shiftDefinitionIds,
      sectionCount: parsed.sections.length,
      itemCount,
    });

    return NextResponse.json({
      template: normalizeChecklistTemplateForApi(templateRef.id, templateData),
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Erro ao criar o template de checklist.";

    return NextResponse.json({ error: message }, { status: 400 });
  }
}
