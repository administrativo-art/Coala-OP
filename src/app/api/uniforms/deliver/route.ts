import { NextRequest, NextResponse } from "next/server";

import { requireUser } from "@/lib/auth-server";
import { dbAdmin } from "@/lib/firebase-admin";
import { UNIFORM_STOCK_ID, UNIFORM_STOCK_NAME } from "@/lib/uniform";
import { pruneUndefined } from "@/lib/utils";
import { WORKSPACE_ID } from "@/lib/workspace";
import type {
  LotEntry,
  Product,
  UniformAssignment,
  UniformCondition,
  UniformEvent,
} from "@/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function canDeliver(context: Awaited<ReturnType<typeof requireUser>>) {
  return context.isDefaultAdmin || context.permissions.stock.uniforms?.deliver === true;
}

function normalizeDate(value: unknown) {
  const text = String(value ?? "").trim();
  if (!text || Number.isNaN(Date.parse(text))) return null;
  return text;
}

export async function POST(request: NextRequest) {
  try {
    const context = await requireUser(request);
    if (!canDeliver(context)) {
      return NextResponse.json(
        { error: "Sem permissão para entregar uniformes." },
        { status: 403 },
      );
    }

    const body = await request.json().catch(() => ({}));
    const lotId = String(body.lotId ?? "").trim();
    const collaboratorUserId = String(body.collaboratorUserId ?? "").trim();
    const quantity = Number(body.quantity);
    const occurredAt = normalizeDate(body.occurredAt);
    const notes = String(body.notes ?? "").trim() || undefined;

    if (!lotId || !collaboratorUserId || !Number.isInteger(quantity) || quantity <= 0 || !occurredAt) {
      return NextResponse.json(
        { error: "Lote, colaborador, quantidade inteira positiva e data são obrigatórios." },
        { status: 400 },
      );
    }

    const lotRef = dbAdmin.collection("lots").doc(lotId);
    const collaboratorRef = dbAdmin.collection("users").doc(collaboratorUserId);
    const movementRef = dbAdmin.collection("movementHistory").doc();
    const eventRef = dbAdmin.collection("uniformEvents").doc();
    const assignmentRef = dbAdmin.collection("uniformAssignments").doc(eventRef.id);
    const now = new Date().toISOString();

    const assignment = await dbAdmin.runTransaction(async (tx) => {
      const [lotSnap, collaboratorSnap] = await Promise.all([
        tx.get(lotRef),
        tx.get(collaboratorRef),
      ]);
      if (!lotSnap.exists) throw new Error("Lote de uniforme não encontrado.");
      if (!collaboratorSnap.exists) throw new Error("Colaborador não encontrado.");

      const lot = { id: lotSnap.id, ...lotSnap.data() } as LotEntry;
      const collaborator = collaboratorSnap.data() ?? {};
      if (collaborator.isActive === false || collaborator.inactivationType === "contract_termination") {
        throw new Error("Não é possível entregar uniforme a um colaborador inativo.");
      }
      if (lot.kioskId !== UNIFORM_STOCK_ID) {
        throw new Error("A entrega deve usar o estoque próprio de uniformes.");
      }
      if (lot.uniformStockStatus && lot.uniformStockStatus !== "disponivel") {
        throw new Error("A peça selecionada está em avaliação e não pode ser entregue.");
      }

      const productSnap = await tx.get(dbAdmin.collection("products").doc(lot.productId));
      if (!productSnap.exists) throw new Error("Produto da vestimenta não encontrado.");
      const product = { id: productSnap.id, ...productSnap.data() } as Product;
      if (product.operationalDestination !== "uniform" && product.category !== "Vestimenta") {
        throw new Error("O lote selecionado não pertence ao controle de uniformes.");
      }

      const available = Number(lot.quantity ?? 0) - Number(lot.reservedQuantity ?? 0);
      if (available < quantity) {
        throw new Error(`Quantidade indisponível. Saldo atual: ${available}.`);
      }

      const collaboratorName = String(collaborator.username ?? collaborator.name ?? "Colaborador");
      const issuedCondition = (lot.condition ?? "novo") as UniformCondition;
      const movement = {
        lotId,
        productId: lot.productId,
        productName: lot.productName,
        lotNumber: lot.lotNumber,
        type: "SAIDA_ENTREGA_UNIFORME" as const,
        quantityChange: quantity,
        fromKioskId: UNIFORM_STOCK_ID,
        fromKioskName: UNIFORM_STOCK_NAME,
        userId: context.userDoc.id,
        username: context.userDoc.username,
        timestamp: occurredAt,
        sourceType: "uniform_delivery",
        sourceId: eventRef.id,
        itemClass: "uniform" as const,
        uniformEventId: eventRef.id,
        deliveredToUserId: collaboratorUserId,
        deliveredToUserName: collaboratorName,
        deliveredAt: occurredAt,
        notes,
      };

      const event: Omit<UniformEvent, "id"> = {
        workspaceId: WORKSPACE_ID,
        eventType: "UNIFORME_ENTREGA",
        movementId: movementRef.id,
        assignmentId: assignmentRef.id,
        lotId,
        productId: lot.productId,
        productName: lot.productName,
        kioskId: UNIFORM_STOCK_ID,
        kioskName: UNIFORM_STOCK_NAME,
        quantity,
        collaboratorUserId,
        collaboratorName,
        occurredAt,
        issuedCondition,
        apparelType: product.apparelType,
        apparelSize: product.apparelSize,
        apparelColor: product.apparelColor,
        registeredByUserId: context.userDoc.id,
        registeredByUserName: context.userDoc.username,
        notes,
        createdAt: now,
        updatedAt: now,
      };

      const assignmentData: Omit<UniformAssignment, "id"> = {
        workspaceId: WORKSPACE_ID,
        deliveryEventId: eventRef.id,
        sourceLotId: lotId,
        productId: lot.productId,
        productName: lot.productName,
        collaboratorUserId,
        collaboratorName,
        issuedCondition,
        quantityDelivered: quantity,
        quantityReturned: 0,
        quantityInPossession: quantity,
        status: "em_posse",
        deliveredAt: occurredAt,
        apparelType: product.apparelType,
        apparelSize: product.apparelSize,
        apparelColor: product.apparelColor,
        createdAt: now,
        updatedAt: now,
      };

      tx.update(lotRef, {
        quantity: Number(lot.quantity ?? 0) - quantity,
        updatedAt: now,
      });
      tx.set(movementRef, pruneUndefined(movement));
      tx.set(eventRef, pruneUndefined(event));
      tx.set(assignmentRef, pruneUndefined(assignmentData));

      return { id: assignmentRef.id, ...assignmentData };
    });

    return NextResponse.json({ assignment }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao entregar uniforme." },
      { status: 400 },
    );
  }
}
