import { NextRequest, NextResponse } from "next/server";

import { requireUser } from "@/lib/auth-server";
import { dbAdmin } from "@/lib/firebase-admin";
import { WORKSPACE_ID } from "@/lib/workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SETTINGS_DOC_ID = "barcode-labels";
const DEFAULT_GENERATED_UNTIL = 1000;

type ProductionRange = {
  from: number;
  to: number;
  createdAt?: string;
  createdBy?: string;
  createdByName?: string;
};

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

function canManageLabels(context: Awaited<ReturnType<typeof requireUser>>) {
  return context.isDefaultAdmin || context.permissions.assets?.printLabels === true;
}

function normalizeProductionRanges(value: unknown): ProductionRange[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => ({
      from: Math.floor(Number(entry?.from)),
      to: Math.floor(Number(entry?.to)),
      createdAt: typeof entry?.createdAt === "string" ? entry.createdAt : undefined,
      createdBy: typeof entry?.createdBy === "string" ? entry.createdBy : undefined,
      createdByName: typeof entry?.createdByName === "string" ? entry.createdByName : undefined,
    }))
    .filter((entry) => Number.isFinite(entry.from) && Number.isFinite(entry.to) && entry.from >= 1 && entry.to >= entry.from)
    .sort((left, right) => left.from - right.from || left.to - right.to);
}

function mergeProductionRanges(ranges: ProductionRange[]): ProductionRange[] {
  const sorted = normalizeProductionRanges(ranges);
  const merged: ProductionRange[] = [];
  sorted.forEach((range) => {
    const last = merged[merged.length - 1];
    if (!last || range.from > last.to + 1) {
      merged.push(range);
      return;
    }
    last.to = Math.max(last.to, range.to);
  });
  return merged;
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
    productionRanges: normalizeProductionRanges(data.workspaceId === WORKSPACE_ID ? data.productionRanges : []),
  });
}

export async function POST(request: NextRequest) {
  const context = await requireUser(request).catch(() => null);
  if (!context) return jsonError("Não autenticado.", 401);
  if (!canManageLabels(context)) {
    return jsonError("Sem permissão para gerar etiquetas de patrimônio.", 403);
  }

  const body = await request.json().catch(() => ({}));
  const action = String(body.action ?? "generate");
  const incrementBy = Math.max(1, Math.min(1000, Math.floor(Number(body.incrementBy ?? 100) || 100)));
  const now = new Date().toISOString();
  const ref = dbAdmin.collection("assetSettings").doc(SETTINGS_DOC_ID);

  if (action === "mark-production") {
    const from = Math.floor(Number(body.from));
    const to = Math.floor(Number(body.to));
    if (!Number.isFinite(from) || !Number.isFinite(to) || from < 1 || to < from) {
      return jsonError("Informe um intervalo válido para produção física.");
    }

    let result: { generatedUntil: number; productionRanges: ProductionRange[] };
    try {
      result = await dbAdmin.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const currentData = snap.data() ?? {};
        const generatedUntil = Math.max(
          DEFAULT_GENERATED_UNTIL,
          currentData.workspaceId === WORKSPACE_ID
            ? Number(currentData.generatedUntil ?? DEFAULT_GENERATED_UNTIL) || DEFAULT_GENERATED_UNTIL
            : DEFAULT_GENERATED_UNTIL
        );

        if (to > generatedUntil) {
          throw new Error(`O intervalo solicitado vai até ${to}, mas só existem etiquetas geradas até ${generatedUntil}.`);
        }

        const productionRanges = mergeProductionRanges([
          ...normalizeProductionRanges(currentData.workspaceId === WORKSPACE_ID ? currentData.productionRanges : []),
          {
            from,
            to,
            createdAt: now,
            createdBy: context.userDoc.id,
            createdByName: context.userDoc.username,
          },
        ]);

        tx.set(ref, {
          workspaceId: WORKSPACE_ID,
          generatedUntil,
          productionRanges,
          updatedAt: now,
          updatedBy: context.userDoc.id,
          updatedByName: context.userDoc.username,
        }, { merge: true });

        return { generatedUntil, productionRanges };
      });
    } catch (error) {
      return jsonError(error instanceof Error ? error.message : "Falha ao marcar etiquetas para produção física.");
    }

    return NextResponse.json({
      generatedUntil: result.generatedUntil,
      defaultGeneratedUntil: DEFAULT_GENERATED_UNTIL,
      productionRanges: result.productionRanges,
    });
  }

  const result = await dbAdmin.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const currentData = snap.data() ?? {};
    const current = currentData.workspaceId === WORKSPACE_ID
      ? Number(currentData.generatedUntil ?? DEFAULT_GENERATED_UNTIL) || DEFAULT_GENERATED_UNTIL
      : DEFAULT_GENERATED_UNTIL;
    const next = Math.max(DEFAULT_GENERATED_UNTIL, current) + incrementBy;
    const productionRanges = normalizeProductionRanges(currentData.workspaceId === WORKSPACE_ID ? currentData.productionRanges : []);
    tx.set(ref, {
      workspaceId: WORKSPACE_ID,
      generatedUntil: next,
      productionRanges,
      updatedAt: now,
      updatedBy: context.userDoc.id,
      updatedByName: context.userDoc.username,
    }, { merge: true });
    return { generatedUntil: next, productionRanges };
  });

  return NextResponse.json({
    generatedUntil: result.generatedUntil,
    incrementBy,
    defaultGeneratedUntil: DEFAULT_GENERATED_UNTIL,
    productionRanges: result.productionRanges,
  });
}
