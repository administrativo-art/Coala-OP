import { NextRequest, NextResponse } from "next/server";

import {
  archiveUniformTermInEmployeeDossier,
  createAndStoreUniformTerm,
  deleteStoredUniformTerm,
  isUniformTransactionId,
  parseUniformSignature,
} from "@/features/uniforms/term.server";
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
  LotEntry,
  Product,
  UniformAssignment,
  UniformCondition,
  UniformEvent,
  UniformReturnedCondition,
  UniformStockDisposition,
  UniformTransaction,
} from "@/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RETURNED_CONDITIONS: UniformReturnedCondition[] = [
  "bom_estado",
  "usado",
  "danificado",
  "inutilizavel",
];
const STOCK_DISPOSITIONS: UniformStockDisposition[] = ["retorna_estoque", "descartar"];

function canExchange(context: Awaited<ReturnType<typeof requireUser>>) {
  return context.isDefaultAdmin ||
    (context.permissions.stock.uniforms?.deliver === true &&
      context.permissions.stock.uniforms?.return === true);
}

function maskedDocument(value: unknown) {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (digits.length === 11) return `***.${digits.slice(3, 6)}.***-${digits.slice(-2)}`;
  if (digits.length === 14) return `${digits.slice(0, 2)}.***.***/****-${digits.slice(-2)}`;
  return null;
}

function careInstructions(
  primary?: Product["uniformCareInstructions"],
  fallback?: Product["uniformCareInstructions"],
) {
  const hasSteps = (primary ?? []).some((section) =>
    (section.etapas ?? []).some((step) => String(step.text ?? "").trim()),
  );
  return hasSteps ? primary : fallback;
}

export async function POST(request: NextRequest) {
  try {
    const context = await requireUser(request);
    if (!canExchange(context)) {
      return NextResponse.json({ error: "Sem permissão para trocar uniformes." }, { status: 403 });
    }
    const body = await request.json().catch(() => ({}));
    const assignmentId = String(body.assignmentId ?? "").trim();
    const newLotId = String(body.newLotId ?? "").trim();
    const quantity = Number(body.quantity);
    const occurredAt = String(body.occurredAt ?? "").trim();
    const returnedCondition = body.returnedCondition as UniformReturnedCondition;
    const stockDisposition = body.stockDisposition as UniformStockDisposition;
    const notes = String(body.notes ?? "").trim() || undefined;
    const transactionId = body.transactionId;
    const collaboratorSignature = parseUniformSignature(body.collaboratorSignature, "colaborador");
    const responsibleSignature = parseUniformSignature(body.responsibleSignature, "responsável");

    if (
      !assignmentId ||
      !newLotId ||
      !Number.isInteger(quantity) ||
      quantity <= 0 ||
      !occurredAt ||
      Number.isNaN(Date.parse(occurredAt)) ||
      !RETURNED_CONDITIONS.includes(returnedCondition) ||
      !STOCK_DISPOSITIONS.includes(stockDisposition) ||
      !isUniformTransactionId(transactionId)
    ) {
      return NextResponse.json({ error: "Dados inválidos para a troca." }, { status: 400 });
    }
    if (
      stockDisposition === "retorna_estoque" &&
      (returnedCondition === "danificado" || returnedCondition === "inutilizavel")
    ) {
      return NextResponse.json({ error: "Peças danificadas ou inutilizáveis devem ser descartadas." }, { status: 400 });
    }

    const transactionRef = dbAdmin.collection("uniformTransactions").doc(transactionId);
    const existingTransaction = await transactionRef.get();
    if (existingTransaction.exists) {
      return NextResponse.json({
        transaction: { id: existingTransaction.id, ...existingTransaction.data() } as UniformTransaction,
      });
    }

    const oldAssignmentRef = dbAdmin.collection("uniformAssignments").doc(assignmentId);
    const newLotRef = dbAdmin.collection("lots").doc(newLotId);
    const exchangeEventRef = dbAdmin.collection("uniformEvents").doc(`${transactionId}_exchange`);
    const returnMovementRef = dbAdmin.collection("movementHistory").doc(`${transactionId}_return`);
    const deliveryMovementRef = dbAdmin.collection("movementHistory").doc(`${transactionId}_delivery`);
    const newAssignmentRef = dbAdmin.collection("uniformAssignments").doc(`${transactionId}_delivery`);
    const [oldPreview, newLotPreview] = await Promise.all([oldAssignmentRef.get(), newLotRef.get()]);
    if (!oldPreview.exists) throw new Error("Entrega original não encontrada.");
    if (!newLotPreview.exists) throw new Error("Novo lote de uniforme não encontrado.");
    const oldAssignment = { id: oldPreview.id, ...oldPreview.data() } as UniformAssignment;
    const newLot = { id: newLotPreview.id, ...newLotPreview.data() } as LotEntry;
    const collaboratorPreview = await dbAdmin.collection("users").doc(oldAssignment.collaboratorUserId).get();
    const collaboratorData = collaboratorPreview.data() ?? {};
    const collaboratorName = oldAssignment.collaboratorName || String(collaboratorData.username ?? "Colaborador");
    const responsibleName = String(context.userDoc.username ?? "Responsável/RH");
    const now = new Date().toISOString();
    const signedAt = now;
    const storedTerm = await createAndStoreUniformTerm({
      transactionId,
      type: "exchange",
      collaboratorUserId: oldAssignment.collaboratorUserId,
      collaboratorName,
      collaboratorDocument: maskedDocument(collaboratorData.cpf ?? collaboratorData.document),
      registeredByName: responsibleName,
      occurredAt,
      incomingItems: [{
        productName: oldAssignment.productName,
        quantity,
        condition: returnedCondition,
        stockDisposition,
        apparelType: oldAssignment.apparelType,
        apparelSize: oldAssignment.apparelSize,
        apparelColor: oldAssignment.apparelColor,
      }],
      outgoingItems: [{
        productName: newLot.productName,
        quantity,
        condition: String(newLot.condition ?? "novo"),
        apparelType: newLot.apparelType,
        apparelSize: newLot.apparelSize,
        apparelColor: newLot.apparelColor,
      }],
      notes,
      collaboratorSignature: collaboratorSignature.dataUrl,
      responsibleSignature: responsibleSignature.dataUrl,
      signedAt,
    });

    let newAssignment: UniformAssignment;
    try {
      newAssignment = await dbAdmin.runTransaction(async (tx) => {
        const [oldSnap, newLotSnap, collaboratorSnap, productSnap, transactionSnap] = await Promise.all([
          tx.get(oldAssignmentRef),
          tx.get(newLotRef),
          tx.get(dbAdmin.collection("users").doc(oldAssignment.collaboratorUserId)),
          tx.get(dbAdmin.collection("products").doc(newLot.productId)),
          tx.get(transactionRef),
        ]);
        if (transactionSnap.exists) throw new Error("Esta troca já foi registrada.");
        if (!oldSnap.exists || !newLotSnap.exists || !productSnap.exists) {
          throw new Error("Os dados da troca não estão mais disponíveis.");
        }
        if (!collaboratorSnap.exists || collaboratorSnap.get("isActive") === false) {
          throw new Error("Não é possível entregar nova peça a um colaborador inativo.");
        }
        const current = { id: oldSnap.id, ...oldSnap.data() } as UniformAssignment;
        const deliveryLot = { id: newLotSnap.id, ...newLotSnap.data() } as LotEntry;
        const product = { id: productSnap.id, ...productSnap.data() } as Product;
        if (current.workspaceId !== WORKSPACE_ID || current.quantityInPossession < quantity) {
          throw new Error(`Quantidade disponível para troca: ${current.quantityInPossession}.`);
        }
        if (deliveryLot.kioskId !== UNIFORM_STOCK_ID || deliveryLot.uniformStockStatus && deliveryLot.uniformStockStatus !== "disponivel") {
          throw new Error("A nova peça não está disponível no estoque de uniformes.");
        }
        if (product.operationalDestination !== "uniform" && product.category !== "Vestimenta") {
          throw new Error("O novo item não pertence ao controle de uniformes.");
        }
        const available = Number(deliveryLot.quantity ?? 0) - Number(deliveryLot.reservedQuantity ?? 0);
        if (available < quantity) throw new Error(`Quantidade indisponível. Saldo atual: ${available}.`);

        const returnLotRef = stockDisposition === "retorna_estoque"
          ? dbAdmin.collection("lots").doc(uniformLotId({
              productId: current.productId,
              condition: "usado",
              status: "disponivel",
              lotNumber: "devolucao",
            }))
          : null;
        if (returnLotRef?.id === newLotRef.id) {
          throw new Error("Selecione outra peça para concluir a troca.");
        }
        const returnLotSnap = returnLotRef ? await tx.get(returnLotRef) : null;
        const returnedTotal = current.quantityReturned + quantity;
        const oldInPossession = current.quantityInPossession - quantity;
        const oldStatus = oldInPossession === 0 ? "devolvido" as const : "devolvido_parcial" as const;
        const issuedCondition = (deliveryLot.condition ?? "novo") as UniformCondition;
        const apparelType = deliveryLot.apparelType ?? product.apparelType;
        const apparelSize = deliveryLot.apparelSize ?? product.apparelSize;
        const apparelColor = deliveryLot.apparelColor ?? product.apparelColor;
        const uniformCareInstructions = careInstructions(deliveryLot.uniformCareInstructions, product.uniformCareInstructions);
        const imageUrl = deliveryLot.imageUrl ?? product.imageUrl;

        if (returnLotRef) {
          if (returnLotSnap?.exists) {
            tx.update(returnLotRef, {
              quantity: Number(returnLotSnap.get("quantity") ?? 0) + quantity,
              updatedAt: now,
            });
          } else {
            tx.set(returnLotRef, pruneUndefined({
              workspaceId: WORKSPACE_ID,
              productId: current.productId,
              productName: current.productName,
              lotNumber: "DEVOLUÇÃO",
              expiryDate: null,
              kioskId: UNIFORM_STOCK_ID,
              quantity,
              reservedQuantity: 0,
              condition: "usado",
              uniformStockStatus: "disponivel",
              apparelType: current.apparelType,
              apparelSize: current.apparelSize,
              apparelColor: current.apparelColor,
              uniformCareInstructions: current.uniformCareInstructions,
              imageUrl: current.imageUrl,
              createdAt: now,
              updatedAt: now,
            }));
          }
          tx.set(returnMovementRef, pruneUndefined({
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
            sourceType: "uniform_exchange",
            sourceId: transactionId,
            itemClass: "uniform",
            uniformEventId: exchangeEventRef.id,
            notes,
          }));
        }

        tx.set(deliveryMovementRef, pruneUndefined({
          lotId: newLotId,
          productId: deliveryLot.productId,
          productName: deliveryLot.productName,
          lotNumber: deliveryLot.lotNumber,
          type: "SAIDA_ENTREGA_UNIFORME",
          quantityChange: quantity,
          fromKioskId: UNIFORM_STOCK_ID,
          fromKioskName: UNIFORM_STOCK_NAME,
          userId: context.userDoc.id,
          username: context.userDoc.username,
          timestamp: occurredAt,
          sourceType: "uniform_exchange",
          sourceId: transactionId,
          itemClass: "uniform",
          uniformEventId: exchangeEventRef.id,
          deliveredToUserId: current.collaboratorUserId,
          deliveredToUserName: collaboratorName,
          deliveredAt: occurredAt,
          notes,
        }));

        const assignmentData: Omit<UniformAssignment, "id"> = {
          workspaceId: WORKSPACE_ID,
          deliveryEventId: exchangeEventRef.id,
          sourceLotId: newLotId,
          productId: deliveryLot.productId,
          productName: deliveryLot.productName,
          collaboratorUserId: current.collaboratorUserId,
          collaboratorName,
          issuedCondition,
          quantityDelivered: quantity,
          quantityReturned: 0,
          quantityInPossession: quantity,
          status: "em_posse",
          deliveredAt: occurredAt,
          apparelType,
          apparelSize,
          apparelColor,
          uniformCareInstructions,
          imageUrl,
          deliveryTransactionId: transactionId,
          deliveryTermDocumentId: storedTerm.documentId,
          createdAt: now,
          updatedAt: now,
        };

        const event: Omit<UniformEvent, "id"> = {
          workspaceId: WORKSPACE_ID,
          eventType: "UNIFORME_TROCA",
          movementId: deliveryMovementRef.id,
          assignmentId: newAssignmentRef.id,
          lotId: newLotId,
          productId: deliveryLot.productId,
          productName: deliveryLot.productName,
          kioskId: UNIFORM_STOCK_ID,
          kioskName: UNIFORM_STOCK_NAME,
          quantity,
          collaboratorUserId: current.collaboratorUserId,
          collaboratorName,
          occurredAt,
          issuedCondition,
          returnedCondition,
          stockDisposition,
          apparelType,
          apparelSize,
          apparelColor,
          uniformCareInstructions,
          imageUrl,
          registeredByUserId: context.userDoc.id,
          registeredByUserName: responsibleName,
          notes,
          uniformTransactionId: transactionId,
          termDocumentId: storedTerm.documentId,
          termStoragePath: storedTerm.storagePath,
          termContentHash: storedTerm.contentHash,
          signatureStatus: "signed",
          exchangedFromAssignmentId: current.id,
          exchangedToAssignmentId: newAssignmentRef.id,
          exchangedFromProductId: current.productId,
          exchangedFromProductName: current.productName,
          createdAt: now,
          updatedAt: now,
        };

        const transaction: Omit<UniformTransaction, "id"> = {
          workspaceId: WORKSPACE_ID,
          type: "exchange",
          status: "signed_committed",
          collaboratorUserId: current.collaboratorUserId,
          collaboratorName,
          occurredAt,
          notes,
          items: [
            {
              direction: "incoming",
              assignmentId: current.id,
              lotId: current.sourceLotId,
              productId: current.productId,
              productName: current.productName,
              quantity,
              condition: returnedCondition,
              stockDisposition,
              apparelType: current.apparelType,
              apparelSize: current.apparelSize,
              apparelColor: current.apparelColor,
            },
            {
              direction: "outgoing",
              assignmentId: newAssignmentRef.id,
              lotId: newLotId,
              productId: deliveryLot.productId,
              productName: deliveryLot.productName,
              quantity,
              condition: issuedCondition,
              apparelType,
              apparelSize,
              apparelColor,
            },
          ],
          eventIds: [exchangeEventRef.id],
          movementIds: [deliveryMovementRef.id, ...(returnLotRef ? [returnMovementRef.id] : [])],
          assignmentIds: [current.id, newAssignmentRef.id],
          signatures: {
            collaborator: { name: collaboratorName, imageHash: collaboratorSignature.imageHash, capturedAt: signedAt },
            responsible: { name: responsibleName, userId: context.userDoc.id, imageHash: responsibleSignature.imageHash, capturedAt: signedAt },
          },
          term: {
            documentId: storedTerm.documentId,
            templateId: storedTerm.templateId,
            fileName: storedTerm.fileName,
            storagePath: storedTerm.storagePath,
            contentHash: storedTerm.contentHash,
            mimeType: "application/pdf",
            size: storedTerm.size,
            archiveStatus: "pending",
          },
          registeredByUserId: context.userDoc.id,
          registeredByUserName: responsibleName,
          createdAt: now,
          updatedAt: now,
        };

        tx.update(oldAssignmentRef, {
          quantityReturned: returnedTotal,
          quantityInPossession: oldInPossession,
          status: oldStatus,
          updatedAt: now,
        });
        tx.update(newLotRef, { quantity: Number(deliveryLot.quantity ?? 0) - quantity, updatedAt: now });
        tx.set(exchangeEventRef, pruneUndefined(event));
        tx.set(newAssignmentRef, pruneUndefined(assignmentData));
        tx.set(transactionRef, pruneUndefined(transaction));
        return { id: newAssignmentRef.id, ...assignmentData };
      });
    } catch (error) {
      const committed = await transactionRef.get().catch(() => null);
      if (!committed?.exists) {
        await deleteStoredUniformTerm(storedTerm.storagePath).catch(() => undefined);
      }
      throw error;
    }

    try {
      await archiveUniformTermInEmployeeDossier({
        transactionId,
        type: "exchange",
        collaboratorUserId: oldAssignment.collaboratorUserId,
        collaboratorName,
        occurredAt,
        registeredByUserId: context.userDoc.id,
        registeredByName: responsibleName,
        fileName: storedTerm.fileName,
        storagePath: storedTerm.storagePath,
        storageSubfolder: storedTerm.storageSubfolder,
        contentHash: storedTerm.contentHash,
        size: storedTerm.size,
        signedAt,
      });
      await transactionRef.set({ "term.archiveStatus": "archived", updatedAt: new Date().toISOString() }, { merge: true });
    } catch {
      await transactionRef.set({ "term.archiveStatus": "failed", updatedAt: new Date().toISOString() }, { merge: true });
    }

    return NextResponse.json({
      assignment: newAssignment,
      transaction: { id: transactionId, termDocumentId: storedTerm.documentId },
    }, { status: 201 });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Falha ao trocar uniforme.",
    }, { status: 400 });
  }
}
