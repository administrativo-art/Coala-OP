import { NextRequest, NextResponse } from "next/server";

import { requireUser } from "@/lib/auth-server";
import { dbAdmin } from "@/lib/firebase-admin";
import { WORKSPACE_ID } from "@/lib/workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SETTINGS_DOC_ID = "barcode-labels";
const DEFAULT_GENERATED_UNTIL = 1000;

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

function canManageLabels(context: Awaited<ReturnType<typeof requireUser>>) {
  return context.isDefaultAdmin || context.permissions.assets?.printLabels === true;
}

export async function GET(request: NextRequest) {
  const context = await requireUser(request).catch(() => null);
  if (!context) return jsonError("Não autenticado.", 401);
  if (!context.permissions.assets?.view) {
    return jsonError("Sem permissão para visualizar etiquetas de patrimônio.", 403);
  }

  const ref = dbAdmin.collection("assetSettings").doc(SETTINGS_DOC_ID);
  const snap = await ref.get();
  const data = snap.data() ?? {};
  const generatedUntil = Math.max(
    DEFAULT_GENERATED_UNTIL,
    Number(data.workspaceId === WORKSPACE_ID ? data.generatedUntil : 0) || 0
  );

  return NextResponse.json({
    generatedUntil,
    defaultGeneratedUntil: DEFAULT_GENERATED_UNTIL,
  });
}

export async function POST(request: NextRequest) {
  const context = await requireUser(request).catch(() => null);
  if (!context) return jsonError("Não autenticado.", 401);
  if (!canManageLabels(context)) {
    return jsonError("Sem permissão para gerar etiquetas de patrimônio.", 403);
  }

  const body = await request.json().catch(() => ({}));
  const incrementBy = Math.max(1, Math.min(1000, Math.floor(Number(body.incrementBy ?? 100) || 100)));
  const now = new Date().toISOString();
  const ref = dbAdmin.collection("assetSettings").doc(SETTINGS_DOC_ID);

  const generatedUntil = await dbAdmin.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const currentData = snap.data() ?? {};
    const current = currentData.workspaceId === WORKSPACE_ID
      ? Number(currentData.generatedUntil ?? DEFAULT_GENERATED_UNTIL) || DEFAULT_GENERATED_UNTIL
      : DEFAULT_GENERATED_UNTIL;
    const next = Math.max(DEFAULT_GENERATED_UNTIL, current) + incrementBy;
    tx.set(ref, {
      workspaceId: WORKSPACE_ID,
      generatedUntil: next,
      updatedAt: now,
      updatedBy: context.userDoc.id,
      updatedByName: context.userDoc.username,
    }, { merge: true });
    return next;
  });

  return NextResponse.json({
    generatedUntil,
    incrementBy,
  });
}
