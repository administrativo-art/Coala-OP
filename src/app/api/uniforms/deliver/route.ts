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
import { UNIFORM_STOCK_ID, UNIFORM_STOCK_NAME } from "@/lib/uniform";
import { pruneUndefined } from "@/lib/utils";
import { WORKSPACE_ID } from "@/lib/workspace";
import type {
  LotEntry,
  Product,
  UniformAssignment,
  UniformCondition,
  UniformEvent,
  UniformTransaction,
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

function getUniformCareInstructions(
  primary?: Product["uniformCareInstructions"],
  fallback?: Product["uniformCareInstructions"],
) {
  const hasSteps = (primary ?? []).some((section) =>
    (section.etapas ?? []).some((step) => String(step.text ?? "").trim()),
  );
  return hasSteps ? primary : fallback;
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
    const transactionId = body.transactionId;
    const collaboratorSignature = parseUniformSignature(body.collaboratorSignature, "colaborador");
    const responsibleSignature = parseUniformSignature(body.responsibleSignature, "responsável");

    if (
      !lotId ||
      !collaboratorUserId ||
      !Number.isInteger(quantity) ||
      quantity <= 0 ||
      !occurredAt ||
      !isUniformTransactionId(transactionId)
    ) {
      return NextResponse.json(
        { error: "Lote, colaborador, quantidade, data e protocolo são obrigatórios." },
        { status: 400 },
      );
    }

    const transactionRef = dbAdmin.collection("uniformTransactions").doc(transactionId);
    const existingTransaction = await transactionRef.get();
    if (existingTransaction.exists) {
      const existing = { id: existingTransaction.id, ...existingTransaction.data() } as UniformTransaction;
      const assignmentId = existing.assignmentIds[0];
      const assignmentSnapshot = assignmentId
        ? await dbAdmin.collection("uniformAssignments").doc(assignmentId).get()
        : null;
      return NextResponse.json({
        transaction: existing,
        assignment: assignmentSnapshot?.exists ? { id: assignmentSnapshot.id, ...assignmentSnapshot.data() } : null,
      });
    }

    const lotRef = dbAdmin.collection("lots").doc(lotId);
    const collaboratorRef = dbAdmin.collection("users").doc(collaboratorUserId);
    const movementRef = dbAdmin.collection("movementHistory").doc(`${transactionId}_delivery`);
    const eventRef = dbAdmin.collection("uniformEvents").doc(`${transactionId}_delivery`);
    const assignmentRef = dbAdmin.collection("uniformAssignments").doc(`${transactionId}_delivery`);
    const now = new Date().toISOString();
    const [lotPreview, collaboratorPreview] = await Promise.all([lotRef.get(), collaboratorRef.get()]);
    if (!lotPreview.exists) throw new Error("Lote de uniforme não encontrado.");
    if (!collaboratorPreview.exists) throw new Error("Colaborador não encontrado.");
    const lotPreviewData = { id: lotPreview.id, ...lotPreview.data() } as LotEntry;
    const collaboratorPreviewData = collaboratorPreview.data() ?? {};
    const responsibleName = String(context.userDoc.username ?? "Responsável/RH");
    const collaboratorName = String(collaboratorPreviewData.username ?? collaboratorPreviewData.name ?? "Colaborador");
    const signedAt = now;
    const storedTerm = await createAndStoreUniformTerm({
      transactionId,
      type: "delivery",
      collaboratorUserId,
      collaboratorName,
      collaboratorDocument: maskedDocument(collaboratorPreviewData.cpf ?? collaboratorPreviewData.document),
      registeredByName: responsibleName,
      occurredAt,
      outgoingItems: [{
        productName: String(lotPreviewData.productName ?? "Uniforme"),
        quantity,
        condition: String(lotPreviewData.condition ?? "novo"),
        apparelType: lotPreviewData.apparelType,
        apparelSize: lotPreviewData.apparelSize,
        apparelColor: lotPreviewData.apparelColor,
      }],
      incomingItems: [],
      notes,
      collaboratorSignature: collaboratorSignature.dataUrl,
      responsibleSignature: responsibleSignature.dataUrl,
      signedAt,
    });

    let assignment: UniformAssignment;
    try {
      assignment = await dbAdmin.runTransaction(async (tx) => {
        const [lotSnap, collaboratorSnap, transactionSnap] = await Promise.all([
          tx.get(lotRef),
          tx.get(collaboratorRef),
          tx.get(transactionRef),
        ]);
        if (transactionSnap.exists) {
          throw new Error("Esta movimentação já foi registrada.");
        }
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
      const apparelType = lot.apparelType ?? product.apparelType;
      const apparelSize = lot.apparelSize ?? product.apparelSize;
      const apparelColor = lot.apparelColor ?? product.apparelColor;
      const uniformCareInstructions = getUniformCareInstructions(lot.uniformCareInstructions, product.uniformCareInstructions);
      const imageUrl = lot.imageUrl ?? product.imageUrl;
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
        apparelType,
        apparelSize,
        apparelColor,
        uniformCareInstructions,
        imageUrl,
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

      const transaction: Omit<UniformTransaction, "id"> = {
        workspaceId: WORKSPACE_ID,
        type: "delivery",
        status: "signed_committed",
        collaboratorUserId,
        collaboratorName,
        occurredAt,
        notes,
        items: [{
          direction: "outgoing",
          assignmentId: assignmentRef.id,
          lotId,
          productId: lot.productId,
          productName: lot.productName,
          quantity,
          condition: issuedCondition,
          apparelType,
          apparelSize,
          apparelColor,
        }],
        eventIds: [eventRef.id],
        movementIds: [movementRef.id],
        assignmentIds: [assignmentRef.id],
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

      tx.update(lotRef, {
        quantity: Number(lot.quantity ?? 0) - quantity,
        updatedAt: now,
      });
      tx.set(movementRef, pruneUndefined(movement));
      tx.set(eventRef, pruneUndefined(event));
      tx.set(assignmentRef, pruneUndefined(assignmentData));
      tx.set(transactionRef, pruneUndefined(transaction));

      return { id: assignmentRef.id, ...assignmentData };
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
        type: "delivery",
        collaboratorUserId,
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
      { error: error instanceof Error ? error.message : "Falha ao entregar uniforme." },
      { status: 400 },
    );
  }
}
