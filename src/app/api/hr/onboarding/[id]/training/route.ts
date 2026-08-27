import { NextRequest, NextResponse } from "next/server";

import { assertFormalizationAccess, serializeHrValue } from "@/features/hr/lib/server-access";
import { hrDbAdmin } from "@/lib/firebase-rh-admin";
import type { OnboardingTrainingItem } from "@/types";

export const runtime = "nodejs";
function error(message: string, status = 400) { return NextResponse.json({ error: message }, { status }); }
function text(value: unknown) { return typeof value === "string" && value.trim() ? value.trim() : null; }

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const access = await assertFormalizationAccess(request, "onboarding.manage").catch(() => null); if (!access) return error("Sem permissão.", 403);
  const { id } = await context.params; const reference = hrDbAdmin.collection("onboardingProcesses").doc(id); const document = await reference.get();
  if (!document.exists) return error("Integração não encontrada.", 404);
  const body = await request.json().catch(() => ({})); const action = text(body.action); const now = new Date().toISOString();
  const items = (document.get("trainingItems") as OnboardingTrainingItem[] | undefined) ?? [];
  let next: OnboardingTrainingItem[];
  if (action === "add") {
    const label = text(body.label); if (!label) return error("Informe o nome do treinamento.");
    const item: OnboardingTrainingItem = { id: `training_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`, label, detail: text(body.detail), status: "pending", order: items.length, createdAt: now };
    next = [...items, item];
  } else if (action === "set_status") {
    const itemId = text(body.itemId); if (!itemId) return error("Treinamento não informado.");
    const status = body.status === "done" ? "done" : body.status === "current" ? "current" : "pending";
    next = items.map(item => item.id === itemId ? { ...item, status, completedAt: status === "done" ? now : null } : item);
  } else if (action === "remove") {
    const itemId = text(body.itemId); if (!itemId) return error("Treinamento não informado.");
    next = items.filter(item => item.id !== itemId).map((item, index) => ({ ...item, order: index }));
  } else {
    return error("Ação inválida.");
  }
  await reference.update({ trainingItems: next, updatedAt: now });
  return NextResponse.json({ trainingItems: serializeHrValue(next) });
}
