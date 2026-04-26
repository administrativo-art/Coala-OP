import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { assertDPChecklistAccess } from "@/features/dp-checklists/lib/server-access";
import {
  appendChecklistAudit,
  checklistDbAdmin,
  loadChecklistActor,
  normalizeChecklistTypeForApi,
} from "@/features/dp-checklists/lib/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const checklistTypeColorSchemes = [
  "emerald",
  "indigo",
  "amber",
  "violet",
  "blue",
  "orange",
  "red",
  "gray",
] as const;

const checklistTypeUpdateSchema = z.object({
  name: z.string().trim().min(2).max(60).optional(),
  emoji: z.string().trim().min(1).max(8).optional(),
  description: z.string().trim().max(500).optional(),
  examples: z.string().trim().max(300).optional(),
  behavior: z.string().trim().max(200).optional(),
  configBanner: z.string().trim().max(200).optional(),
  isSchedulable: z.boolean().optional(),
  colorScheme: z.enum(checklistTypeColorSchemes).optional(),
  isActive: z.boolean().optional(),
});

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ typeId: string }> }
) {
  try {
    const { typeId } = await params;
    const access = await assertDPChecklistAccess(request, "manage");
    const actor = await loadChecklistActor(access.decoded.uid);
    const rawBody = await request.json();
    const parsed = checklistTypeUpdateSchema.parse(rawBody);

    const ref = checklistDbAdmin.collection("checklistTypes").doc(typeId);
    const snap = await ref.get();
    if (!snap.exists) {
      return NextResponse.json({ error: "Tipo não encontrado." }, { status: 404 });
    }

    const updates = { ...parsed, updatedAt: new Date().toISOString() };
    await ref.update(updates);

    await appendChecklistAudit("checklist_type_updated", {
      actorUserId: actor.userId,
      actorUsername: actor.username,
      typeId,
      updates: Object.keys(parsed),
    });

    const updated = { ...(snap.data() ?? {}), ...updates };
    return NextResponse.json({
      checklistType: normalizeChecklistTypeForApi(typeId, updated),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Erro ao atualizar tipo." },
      { status: 400 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ typeId: string }> }
) {
  try {
    const { typeId } = await params;
    const access = await assertDPChecklistAccess(request, "manage");
    const actor = await loadChecklistActor(access.decoded.uid);

    const ref = checklistDbAdmin.collection("checklistTypes").doc(typeId);
    const snap = await ref.get();
    if (!snap.exists) {
      return NextResponse.json({ error: "Tipo não encontrado." }, { status: 404 });
    }

    const templatesUsingType = await checklistDbAdmin
      .collection("checklistTemplates")
      .where("templateType", "==", typeId)
      .limit(1)
      .get();

    if (!templatesUsingType.empty) {
      return NextResponse.json(
        { error: "Não é possível excluir um tipo que está em uso por templates." },
        { status: 409 }
      );
    }

    await ref.delete();

    await appendChecklistAudit("checklist_type_deleted", {
      actorUserId: actor.userId,
      actorUsername: actor.username,
      typeId,
      typeName: snap.data()?.name,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Erro ao excluir tipo." },
      { status: 400 }
    );
  }
}
