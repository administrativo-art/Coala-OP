import { NextRequest, NextResponse } from "next/server";

import { requireUser } from "@/lib/auth-server";
import { dbAdmin } from "@/lib/firebase-admin";
import {
  UNIFORM_STOCK_ID,
  UNIFORM_STOCK_NAME,
  uniformLotId,
} from "@/lib/uniform";
import { pruneUndefined } from "@/lib/utils";
import { WORKSPACE_ID } from "@/lib/workspace";
import type {
  UniformAssignment,
  UniformEvent,
  UniformReturnedCondition,
  UniformStockDisposition,
} from "@/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RETURNED_CONDITIONS: UniformReturnedCondition[] = [
  "bom_estado",
  "usado",
  "danificado",
  "inutilizavel",
];
const STOCK_DISPOSITIONS: UniformStockDisposition[] = [
  "retorna_estoque",
  "descartar",
  "reter_avaliacao",
];

function canReturn(context: Awaited<ReturnType<typeof requireUser>>) {
  return context.isDefaultAdmin || context.permissions.stock.uniforms?.return === true;
}

export async function POST(request: NextRequest) {
  try {
    const context = await requireUser(request);
    if (!canReturn(context)) {
      return NextResponse.json(
        { error: "Sem permissão para registrar devolução de uniforme." },
        { status: 403 },
      );
    }

    const body = await request.json().catch(() => ({}));
    const assignmentId = String(body.assignmentId ?? "").trim();
    const quantity = Number(body.quantity);
    const occurredAt = String(body.occurredAt ?? "").trim();
    const returnedCondition = body.returnedCondition as UniformReturnedCondition;
    const stockDisposition = body.stockDisposition as UniformStockDisposition;
    const notes = String(body.notes ?? "").trim() || undefined;

    if (
      !assignmentId ||
      !Number.isInteger(quantity) ||
      quantity <= 0 ||
      !occurredAt ||
      Number.isNaN(Date.parse(occurredAt)) ||
      !RETURNED_CONDITIONS.includes(returnedCondition) ||
      !STOCK_DISPOSITIONS.includes(stockDisposition)
    ) {
      return NextResponse.json(
        { error: "Dados inválidos para a devolução." },
        { status: 400 },
      );
    }
    if (
      stockDisposition === "retorna_estoque" &&
      (returnedCondition === "danificado" || returnedCondition === "inutilizavel")
    ) {
      return NextResponse.json(
        { error: "Peças danificadas ou inutilizáveis devem ser avaliadas ou descartadas." },
        { status: 400 },
      );
    }
    if (stockDisposition === "descartar" && !context.isDefaultAdmin && context.permissions.stock.uniforms?.dispose !== true) {
      return NextResponse.json(
        { error: "Sem permissão para descartar uniformes." },
        { status: 403 },
      );
    }
    if (stockDisposition === "reter_avaliacao" && !context.isDefaultAdmin && context.permissions.stock.uniforms?.manageEvaluation !== true) {
      return NextResponse.json(
        { error: "Sem permissão para reter uniformes para avaliação." },
        { status: 403 },
      );
    }

    const assignmentRef = dbAdmin.collection("uniformAssignments").doc(assignmentId);
    const eventRef = dbAdmin.collection("uniformEvents").doc();
    const movementRef = dbAdmin.collection("movementHistory").doc();
    const now = new Date().toISOString();

    const assignment = await dbAdmin.runTransaction(async (tx) => {
      const assignmentSnap = await tx.get(assignmentRef);
      if (!assignmentSnap.exists) throw new Error("Entrega de uniforme não encontrada.");
      const current = {
        id: assignmentSnap.id,
        ...assignmentSnap.data(),
      } as UniformAssignment;
      if (current.workspaceId !== WORKSPACE_ID) throw new Error("Entrega fora do ambiente atual.");
      if (current.quantityInPossession < quantity) {
        throw new Error(`Quantidade em posse: ${current.quantityInPossession}.`);
      }

      const shouldReenter = stockDisposition !== "descartar";
      const stockStatus = stockDisposition === "reter_avaliacao"
        ? "em_avaliacao" as const
        : "disponivel" as const;
      const returnLotRef = shouldReenter
        ? dbAdmin.collection("lots").doc(uniformLotId({
            productId: current.productId,
            condition: "usado",
            status: stockStatus,
            lotNumber: "devolucao",
          }))
        : null;
      const returnLotSnap = returnLotRef ? await tx.get(returnLotRef) : null;

      const returnedTotal = current.quantityReturned + quantity;
      const inPossession = current.quantityInPossession - quantity;
      const status = inPossession === 0 ? "devolvido" as const : "devolvido_parcial" as const;

      if (returnLotRef) {
        if (returnLotSnap?.exists) {
          tx.update(returnLotRef, {
            quantity: Number(returnLotSnap.data()?.quantity ?? 0) + quantity,
            apparelType: current.apparelType ?? null,
            apparelSize: current.apparelSize ?? null,
            apparelColor: current.apparelColor ?? null,
            updatedAt: now,
          });
        } else {
          tx.set(returnLotRef, {
            workspaceId: WORKSPACE_ID,
            productId: current.productId,
            productName: current.productName,
            lotNumber: "DEVOLUÇÃO",
            expiryDate: null,
            kioskId: UNIFORM_STOCK_ID,
            quantity,
            reservedQuantity: 0,
            condition: "usado",
            uniformStockStatus: stockStatus,
            apparelType: current.apparelType ?? null,
            apparelSize: current.apparelSize ?? null,
            apparelColor: current.apparelColor ?? null,
            createdAt: now,
            updatedAt: now,
          });
        }
        tx.set(movementRef, pruneUndefined({
          lotId: returnLotRef.id,
          productId: current.productId,
          productName: current.productName,
          lotNumber: "DEVOLUÇÃO",
          type: "ENTRADA_DEVOLUCAO_UNIFORME",
          quantityChange: quantity,
          toKioskId: UNIFORM_STOCK_ID,
          toKioskName: UNIFORM_STOCK_NAME,
          userId: context.userDoc.id,
          username: context.userDoc.username,
          timestamp: occurredAt,
          sourceType: "uniform_return",
          sourceId: eventRef.id,
          itemClass: "uniform",
          uniformEventId: eventRef.id,
          notes,
        }));
      }

      const event: Omit<UniformEvent, "id"> = {
        workspaceId: WORKSPACE_ID,
        eventType: "UNIFORME_DEVOLUCAO",
        movementId: returnLotRef ? movementRef.id : undefined,
        assignmentId: current.id,
        sourceDeliveryEventId: current.deliveryEventId,
        lotId: current.sourceLotId,
        returnLotId: returnLotRef?.id,
        productId: current.productId,
        productName: current.productName,
        kioskId: UNIFORM_STOCK_ID,
        kioskName: UNIFORM_STOCK_NAME,
        quantity,
        returnedQuantity: quantity,
        returnedCondition,
        stockDisposition,
        collaboratorUserId: current.collaboratorUserId,
        collaboratorName: current.collaboratorName,
        occurredAt,
        issuedCondition: current.issuedCondition,
        apparelType: current.apparelType,
        apparelSize: current.apparelSize,
        apparelColor: current.apparelColor,
        registeredByUserId: context.userDoc.id,
        registeredByUserName: context.userDoc.username,
        notes,
        createdAt: now,
        updatedAt: now,
      };

      tx.set(eventRef, pruneUndefined(event));
      tx.update(assignmentRef, {
        quantityReturned: returnedTotal,
        quantityInPossession: inPossession,
        status,
        updatedAt: now,
      });

      return {
        ...current,
        quantityReturned: returnedTotal,
        quantityInPossession: inPossession,
        status,
        updatedAt: now,
      };
    });

    return NextResponse.json({ assignment }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao devolver uniforme." },
      { status: 400 },
    );
  }
}
