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
  UniformAssignment,
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
const STOCK_DISPOSITIONS: UniformStockDisposition[] = [
  "retorna_estoque",
  "descartar",
];

function canReturn(context: Awaited<ReturnType<typeof requireUser>>) {
  return context.isDefaultAdmin || context.permissions.stock.uniforms?.return === true;
}

function maskedDocument(value: unknown) {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (digits.length === 11) return `***.${digits.slice(3, 6)}.***-${digits.slice(-2)}`;
  if (digits.length === 14) return `${digits.slice(0, 2)}.***.***/****-${digits.slice(-2)}`;
  return null;
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
    const transactionId = body.transactionId;
    const collaboratorSignature = parseUniformSignature(body.collaboratorSignature, "colaborador");
    const responsibleSignature = parseUniformSignature(body.responsibleSignature, "responsável");

    if (
      !assignmentId ||
      !Number.isInteger(quantity) ||
      quantity <= 0 ||
      !occurredAt ||
      Number.isNaN(Date.parse(occurredAt)) ||
      !RETURNED_CONDITIONS.includes(returnedCondition) ||
      !STOCK_DISPOSITIONS.includes(stockDisposition) ||
      !isUniformTransactionId(transactionId)
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
        { error: "Peças danificadas ou inutilizáveis devem ser descartadas." },
        { status: 400 },
      );
    }

    const assignmentRef = dbAdmin.collection("uniformAssignments").doc(assignmentId);
    const transactionRef = dbAdmin.collection("uniformTransactions").doc(transactionId);
    const existingTransaction = await transactionRef.get();
    if (existingTransaction.exists) {
      const existing = { id: existingTransaction.id, ...existingTransaction.data() } as UniformTransaction;
      const assignmentSnapshot = await assignmentRef.get();
      return NextResponse.json({
        transaction: existing,
        assignment: assignmentSnapshot.exists ? { id: assignmentSnapshot.id, ...assignmentSnapshot.data() } : null,
      });
    }
    const eventRef = dbAdmin.collection("uniformEvents").doc(`${transactionId}_return`);
    const movementRef = dbAdmin.collection("movementHistory").doc(`${transactionId}_return`);
    const now = new Date().toISOString();
    const assignmentPreview = await assignmentRef.get();
    if (!assignmentPreview.exists) throw new Error("Entrega de uniforme não encontrada.");
    const assignmentPreviewData = { id: assignmentPreview.id, ...assignmentPreview.data() } as UniformAssignment;
    const collaboratorPreview = await dbAdmin.collection("users").doc(assignmentPreviewData.collaboratorUserId).get();
    const collaboratorData = collaboratorPreview.data() ?? {};
    const collaboratorName = assignmentPreviewData.collaboratorName || String(collaboratorData.username ?? "Colaborador");
    const responsibleName = String(context.userDoc.username ?? "Responsável/RH");
    const signedAt = now;
    const storedTerm = await createAndStoreUniformTerm({
      transactionId,
      type: "return",
      collaboratorUserId: assignmentPreviewData.collaboratorUserId,
      collaboratorName,
      collaboratorDocument: maskedDocument(collaboratorData.cpf ?? collaboratorData.document),
      registeredByName: responsibleName,
      occurredAt,
      outgoingItems: [],
      incomingItems: [{
        productName: assignmentPreviewData.productName,
        quantity,
        condition: returnedCondition,
        stockDisposition,
        apparelType: assignmentPreviewData.apparelType,
        apparelSize: assignmentPreviewData.apparelSize,
        apparelColor: assignmentPreviewData.apparelColor,
      }],
      notes,
      collaboratorSignature: collaboratorSignature.dataUrl,
      responsibleSignature: responsibleSignature.dataUrl,
      signedAt,
    });

    let assignment: UniformAssignment;
    try {
      assignment = await dbAdmin.runTransaction(async (tx) => {
      const [assignmentSnap, transactionSnap] = await Promise.all([
        tx.get(assignmentRef),
        tx.get(transactionRef),
      ]);
      if (transactionSnap.exists) throw new Error("Esta movimentação já foi registrada.");
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
      const stockStatus = "disponivel" as const;
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
            uniformCareInstructions: current.uniformCareInstructions ?? null,
            imageUrl: current.imageUrl ?? null,
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
            uniformCareInstructions: current.uniformCareInstructions ?? null,
            imageUrl: current.imageUrl ?? null,
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
        uniformCareInstructions: current.uniformCareInstructions,
        imageUrl: current.imageUrl,
        registeredByUserId: context.userDoc.id,
        registeredByUserName: context.userDoc.username,
        notes,
        uniformTransactionId: transactionId,
        termDocumentId: storedTerm.documentId,
        termStoragePath: storedTerm.storagePath,
        termContentHash: storedTerm.contentHash,
        signatureStatus: "signed",
        createdAt: now,
        updatedAt: now,
      };

      const transaction: Omit<UniformTransaction, "id"> = {
        workspaceId: WORKSPACE_ID,
        type: "return",
        status: "signed_committed",
        collaboratorUserId: current.collaboratorUserId,
        collaboratorName,
        occurredAt,
        notes,
        items: [{
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
        }],
        eventIds: [eventRef.id],
        movementIds: returnLotRef ? [movementRef.id] : [],
        assignmentIds: [current.id],
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

      tx.set(eventRef, pruneUndefined(event));
      tx.update(assignmentRef, {
        quantityReturned: returnedTotal,
        quantityInPossession: inPossession,
        status,
        updatedAt: now,
      });
      tx.set(transactionRef, pruneUndefined(transaction));

      return {
        ...current,
        quantityReturned: returnedTotal,
        quantityInPossession: inPossession,
        status,
        updatedAt: now,
      };
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
        type: "return",
        collaboratorUserId: assignmentPreviewData.collaboratorUserId,
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
      assignment,
      transaction: { id: transactionId, termDocumentId: storedTerm.documentId },
    }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao devolver uniforme." },
      { status: 400 },
    );
  }
}
