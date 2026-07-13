import { NextRequest, NextResponse } from "next/server";

import { requireUser } from "@/lib/auth-server";
import { dbAdmin } from "@/lib/firebase-admin";
import { UNIFORM_STOCK_ID, UNIFORM_STOCK_NAME } from "@/lib/uniform";
import { pruneUndefined } from "@/lib/utils";
import { WORKSPACE_ID } from "@/lib/workspace";
import type { LotEntry, Product, UniformAssignment, UniformCondition, UniformEvent, UniformStockStatus } from "@/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function canView(context: Awaited<ReturnType<typeof requireUser>>) {
  return context.isDefaultAdmin ||
    context.permissions.stock.uniforms?.view === true ||
    context.permissions.dp.collaborators.view === true;
}

function canAdjust(context: Awaited<ReturnType<typeof requireUser>>) {
  return context.isDefaultAdmin ||
    context.permissions.stock.uniforms?.manageEvaluation === true ||
    context.permissions.stock.inventoryControl?.editLot === true;
}

function getUniformCareInstructions(
  primary?: Product["uniformCareInstructions"],
  fallback?: Product["uniformCareInstructions"],
) {
  const hasSteps = (primary ?? []).some((section) =>
    (section.etapas ?? []).some((step) => String(step.text ?? "").trim()),
  );
  return hasSteps ? primary : fallback;
}

export async function GET(request: NextRequest) {
  try {
    const context = await requireUser(request);
    if (!canView(context)) {
      return NextResponse.json(
        { error: "Sem permissão para visualizar uniformes." },
        { status: 403 },
      );
    }

    const collaboratorUserId = request.nextUrl.searchParams.get("collaboratorUserId")?.trim();
    const canViewInventory = context.isDefaultAdmin ||
      context.permissions.stock.uniforms?.view === true ||
      context.permissions.stock.uniforms?.deliver === true;

    const [lotsSnap, assignmentsSnap, eventsSnap] = await Promise.all([
      canViewInventory
        ? dbAdmin.collection("lots").where("kioskId", "==", UNIFORM_STOCK_ID).get()
        : Promise.resolve(null),
      dbAdmin.collection("uniformAssignments").where("workspaceId", "==", WORKSPACE_ID).get(),
      dbAdmin.collection("uniformEvents").where("workspaceId", "==", WORKSPACE_ID).get(),
    ]);

    const assignments = assignmentsSnap.docs
      .map((doc) => ({ id: doc.id, ...doc.data() } as UniformAssignment))
      .filter((entry) => !collaboratorUserId || entry.collaboratorUserId === collaboratorUserId)
      .sort((left, right) => right.deliveredAt.localeCompare(left.deliveredAt));

    const events = eventsSnap.docs
      .map((doc) => ({ id: doc.id, ...doc.data() } as UniformEvent))
      .filter((entry) => !collaboratorUserId || entry.collaboratorUserId === collaboratorUserId)
      .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt))
      .slice(0, collaboratorUserId ? 100 : 500);

    const rawLots = lotsSnap
      ? lotsSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() } as LotEntry))
      : [];
    const productIds = Array.from(new Set([
      ...rawLots.map((lot) => lot.productId),
      ...assignments.map((assignment) => assignment.productId),
      ...events.map((event) => event.productId),
    ].filter(Boolean)));
    const productSnaps = await Promise.all(
      productIds.map((productId) => dbAdmin.collection("products").doc(productId).get()),
    );
    const productMap = new Map(
      productSnaps
        .filter((doc) => doc.exists)
        .map((doc) => [doc.id, { id: doc.id, ...doc.data() } as Product]),
    );
    const lots = rawLots.map((lot) => {
      const product = productMap.get(lot.productId);
      return {
        ...lot,
        productName: lot.productName || product?.baseName || lot.productId,
        apparelType: lot.apparelType ?? product?.apparelType,
        apparelSize: lot.apparelSize ?? product?.apparelSize,
        apparelColor: lot.apparelColor ?? product?.apparelColor,
        uniformCareInstructions: getUniformCareInstructions(lot.uniformCareInstructions, product?.uniformCareInstructions),
        imageUrl: lot.imageUrl ?? product?.imageUrl,
      };
    });
    const enrichedAssignments = assignments.map((assignment) => {
      const product = productMap.get(assignment.productId);
      return {
        ...assignment,
        apparelType: assignment.apparelType ?? product?.apparelType,
        apparelSize: assignment.apparelSize ?? product?.apparelSize,
        apparelColor: assignment.apparelColor ?? product?.apparelColor,
        uniformCareInstructions: getUniformCareInstructions(assignment.uniformCareInstructions, product?.uniformCareInstructions),
        imageUrl: assignment.imageUrl ?? product?.imageUrl,
      };
    });
    const enrichedEvents = events.map((event) => {
      const product = productMap.get(event.productId);
      return {
        ...event,
        apparelType: event.apparelType ?? product?.apparelType,
        apparelSize: event.apparelSize ?? product?.apparelSize,
        apparelColor: event.apparelColor ?? product?.apparelColor,
        uniformCareInstructions: getUniformCareInstructions(event.uniformCareInstructions, product?.uniformCareInstructions),
        imageUrl: event.imageUrl ?? product?.imageUrl,
      };
    });

    return NextResponse.json(
      {
        lots,
        assignments: enrichedAssignments,
        events: enrichedEvents,
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao carregar uniformes." },
      { status: 400 },
    );
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const context = await requireUser(request);
    if (!canAdjust(context)) {
      return NextResponse.json(
        { error: "Sem permissão para ajustar estoque de uniformes." },
        { status: 403 },
      );
    }

    const body = await request.json().catch(() => ({}));
    const lotId = String(body.lotId ?? "").trim();
    const quantity = Number(body.quantity);
    const condition = String(body.condition ?? "").trim() as UniformCondition;
    const uniformStockStatus = String(body.uniformStockStatus ?? "").trim() as UniformStockStatus;
    const notes = String(body.notes ?? "").trim() || undefined;

    if (!lotId) {
      return NextResponse.json({ error: "Lote obrigatório." }, { status: 400 });
    }
    if (!Number.isInteger(quantity) || quantity < 0) {
      return NextResponse.json({ error: "Informe uma quantidade inteira maior ou igual a zero." }, { status: 400 });
    }
    if (!["novo", "usado"].includes(condition)) {
      return NextResponse.json({ error: "Condição inválida." }, { status: 400 });
    }
    if (!["disponivel", "em_avaliacao"].includes(uniformStockStatus)) {
      return NextResponse.json({ error: "Status inválido." }, { status: 400 });
    }

    const lotRef = dbAdmin.collection("lots").doc(lotId);
    const movementRef = dbAdmin.collection("movementHistory").doc();
    const now = new Date().toISOString();

    const lot = await dbAdmin.runTransaction(async (tx) => {
      const lotSnap = await tx.get(lotRef);
      if (!lotSnap.exists) throw new Error("Lote de uniforme não encontrado.");

      const current = { id: lotSnap.id, ...lotSnap.data() } as LotEntry;
      if (current.kioskId !== UNIFORM_STOCK_ID) {
        throw new Error("Este lote não pertence ao estoque próprio de uniformes.");
      }

      const previousQuantity = Number(current.quantity ?? 0);
      const quantityDiff = quantity - previousQuantity;
      const updates: Partial<LotEntry> = {
        quantity,
        condition,
        uniformStockStatus,
        updatedAt: now,
      };

      tx.update(lotRef, pruneUndefined(updates));

      if (quantityDiff !== 0) {
        tx.set(movementRef, pruneUndefined({
          lotId,
          productId: current.productId,
          productName: current.productName,
          lotNumber: current.lotNumber,
          type: quantityDiff > 0 ? "ENTRADA_CORRECAO" : "SAIDA_CORRECAO",
          quantityChange: Math.abs(quantityDiff),
          ...(quantityDiff > 0
            ? { toKioskId: UNIFORM_STOCK_ID, toKioskName: UNIFORM_STOCK_NAME }
            : { fromKioskId: UNIFORM_STOCK_ID, fromKioskName: UNIFORM_STOCK_NAME }),
          userId: context.userDoc.id,
          username: context.userDoc.username,
          timestamp: now,
          sourceType: "uniform_stock_adjustment",
          sourceId: lotId,
          itemClass: "uniform",
          notes: notes || `Ajuste manual de uniforme: ${previousQuantity} -> ${quantity}.`,
        }));
      }

      return { ...current, ...updates };
    });

    return NextResponse.json({ lot }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao ajustar estoque de uniformes." },
      { status: 400 },
    );
  }
}
