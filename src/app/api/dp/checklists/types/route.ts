import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
  assertLegacyChecklistReadAllowed,
  assertLegacyChecklistWriteAllowed,
} from "@/features/dp-checklists/lib/rollout";
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

const checklistTypeSchema = z.object({
  name: z.string().trim().min(2, "Informe o nome do tipo.").max(60),
  emoji: z.string().trim().min(1, "Selecione um emoji.").max(8),
  description: z.string().trim().max(500).default(""),
  examples: z.string().trim().max(300).default(""),
  behavior: z.string().trim().max(200).default(""),
  configBanner: z.string().trim().max(200).default(""),
  isSchedulable: z.boolean().default(false),
  colorScheme: z.enum(checklistTypeColorSchemes).default("gray"),
  isActive: z.boolean().default(true),
});

export async function GET(request: NextRequest) {
  try {
    await assertLegacyChecklistReadAllowed();
    await assertDPChecklistAccess(request, "view");
    const snap = await checklistDbAdmin
      .collection("checklistTypes")
      .orderBy("name")
      .get();
    const types = snap.docs.map((doc) =>
      normalizeChecklistTypeForApi(doc.id, doc.data() ?? {})
    );
    return NextResponse.json({ checklistTypes: types });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Erro ao listar tipos." },
      { status: 403 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    await assertLegacyChecklistWriteAllowed();
    const access = await assertDPChecklistAccess(request, "manage");
    const actor = await loadChecklistActor(access.decoded.uid);
    const rawBody = await request.json();
    const parsed = checklistTypeSchema.parse(rawBody);

    const now = new Date().toISOString();
    const ref = checklistDbAdmin.collection("checklistTypes").doc();
    const data = {
      ...parsed,
      createdAt: now,
      updatedAt: now,
      createdByUserId: actor.userId,
      createdByUsername: actor.username,
    };

    await ref.set(data);

    await appendChecklistAudit("checklist_type_created", {
      actorUserId: actor.userId,
      actorUsername: actor.username,
      typeId: ref.id,
      typeName: parsed.name,
    });

    return NextResponse.json({
      checklistType: normalizeChecklistTypeForApi(ref.id, data),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Erro ao criar tipo." },
      { status: 400 }
    );
  }
}
