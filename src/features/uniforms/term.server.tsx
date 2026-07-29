import "server-only";

import { readFile } from "node:fs/promises";
import path from "node:path";
import React from "react";
import { renderToBuffer } from "@react-pdf/renderer";
import { Timestamp } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";

import {
  SignedUniformMovementTermDocument,
  type SignedUniformTermItem,
} from "@/components/pdf/UniformTermDocument";
import {
  isUniformTransactionId,
  parseUniformSignature,
  uniformDocumentTypeCode,
} from "@/features/uniforms/term-core";
import { uniformSystemTemplateId } from "@/features/uniforms/template-catalog";
import { getDocumentTypeConfig } from "@/lib/hr/employee-document-catalog";
import { resolveDocumentDestination } from "@/lib/hr/employee-document-distribution";
import {
  employeeCodeFrom,
  hashBuffer,
  loadExpectedIdentity,
} from "@/lib/hr/employee-document-identity";
import { adminApp } from "@/lib/firebase-admin";
import { firebaseClientConfig } from "@/lib/firebase-client-config";
import { hrDbAdmin } from "@/lib/firebase-rh-admin";
import type { UniformTransactionType } from "@/types";

function safeName(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase()
    .slice(0, 70) || "colaborador";
}

function typeLabel(type: UniformTransactionType) {
  if (type === "exchange") return "troca";
  if (type === "return") return "devolucao";
  return "entrega";
}

export { isUniformTransactionId, parseUniformSignature };

async function loadUniformLetterhead() {
  return readFile(path.join(
    process.cwd(),
    "src/features/hr/documents/assets/coala-shakes-letterhead-a4-v2.png",
  ));
}

export async function renderUniformSystemTemplatePreview(type: UniformTransactionType) {
  const letterhead = await loadUniformLetterhead();
  const returnedItems: SignedUniformTermItem[] = [
    { productName: "Camiseta polo", quantity: 1, condition: "usado", apparelType: "Piquê Coala", apparelColor: "Preta", apparelSize: "M", stockDisposition: "retorna_estoque" },
    { productName: "Avental operacional", quantity: 1, condition: "danificado", apparelType: "Linha Frente", apparelColor: "Rosa", apparelSize: "Único", stockDisposition: "descartar" },
    { productName: "Boné trucker", quantity: 1, condition: "danificado", apparelType: "Aba curva", apparelColor: "Azul", apparelSize: "Único", stockDisposition: "descartar" },
  ];
  const deliveredItems: SignedUniformTermItem[] = [
    { productName: "Camiseta polo", quantity: 2, condition: "novo", apparelType: "Piquê Coala", apparelColor: "Preta", apparelSize: "M" },
    { productName: "Avental operacional", quantity: 1, condition: "novo", apparelType: "Linha Frente", apparelColor: "Rosa", apparelSize: "Único" },
    { productName: "Boné trucker", quantity: 1, condition: "novo", apparelType: "Aba curva", apparelColor: "Azul", apparelSize: "Único" },
  ];
  const pdf = await renderToBuffer(
    <SignedUniformMovementTermDocument
      type={type}
      protocol="GERADO AUTOMATICAMENTE"
      collaboratorName="Nome do colaborador"
      collaboratorDocument="***.***.***-**"
      registeredByName="Responsável/RH"
      occurredAt="dd/mm/aaaa"
      outgoingItems={type === "return" ? [] : deliveredItems}
      incomingItems={type === "delivery" ? [] : type === "return" ? returnedItems.slice(0, 2) : returnedItems}
      letterheadDataUri={`data:image/png;base64,${letterhead.toString("base64")}`}
    />,
  );
  return Buffer.from(pdf);
}

export async function createAndStoreUniformTerm(input: {
  transactionId: string;
  type: UniformTransactionType;
  collaboratorUserId: string;
  collaboratorName: string;
  collaboratorDocument?: string | null;
  registeredByName: string;
  occurredAt: string;
  outgoingItems: SignedUniformTermItem[];
  incomingItems: SignedUniformTermItem[];
  notes?: string | null;
  collaboratorSignature: string;
  responsibleSignature: string;
  signedAt: string;
}) {
  const letterhead = await loadUniformLetterhead();
  const pdf = await renderToBuffer(
    <SignedUniformMovementTermDocument
      type={input.type}
      protocol={input.transactionId}
      collaboratorName={input.collaboratorName}
      collaboratorDocument={input.collaboratorDocument}
      registeredByName={input.registeredByName}
      occurredAt={input.occurredAt}
      outgoingItems={input.outgoingItems}
      incomingItems={input.incomingItems}
      notes={input.notes}
      collaboratorSignature={input.collaboratorSignature}
      responsibleSignature={input.responsibleSignature}
      signedAt={input.signedAt}
      letterheadDataUri={`data:image/png;base64,${letterhead.toString("base64")}`}
    />,
  );
  const buffer = Buffer.from(pdf);
  const fileName = `termo-${typeLabel(input.type)}-uniforme-${safeName(input.collaboratorName)}-${input.occurredAt.slice(0, 10)}.pdf`;
  const storageSubfolder = `hr/employee-documents/${input.collaboratorUserId}/documents/${input.transactionId}`;
  const storagePath = `${storageSubfolder}/versions/01/original.pdf`;
  const contentHash = hashBuffer(buffer);
  await getStorage(adminApp).bucket(firebaseClientConfig.storageBucket).file(storagePath).save(buffer, {
    resumable: false,
    metadata: {
      contentType: "application/pdf",
      cacheControl: "private, max-age=0, no-store",
      metadata: {
        employeeId: input.collaboratorUserId,
        documentId: input.transactionId,
        uniformTransactionId: input.transactionId,
        contentHash,
      },
    },
  });
  return {
    buffer,
    documentId: input.transactionId,
    templateId: uniformSystemTemplateId(input.type),
    fileName,
    storagePath,
    storageSubfolder,
    contentHash,
    size: buffer.byteLength,
  };
}

export async function deleteStoredUniformTerm(storagePath: string) {
  await getStorage(adminApp)
    .bucket(firebaseClientConfig.storageBucket)
    .file(storagePath)
    .delete({ ignoreNotFound: true });
}

export async function archiveUniformTermInEmployeeDossier(input: {
  transactionId: string;
  type: UniformTransactionType;
  collaboratorUserId: string;
  collaboratorName: string;
  occurredAt: string;
  registeredByUserId: string;
  registeredByName: string;
  fileName: string;
  storagePath: string;
  storageSubfolder: string;
  contentHash: string;
  size: number;
  signedAt: string;
}) {
  const reference = hrDbAdmin.collection("employeeDocuments").doc(input.transactionId);
  if ((await reference.get()).exists) return input.transactionId;
  const config = getDocumentTypeConfig(uniformDocumentTypeCode(input.type));
  const identity = await loadExpectedIdentity(input.collaboratorUserId);
  const employeeCode = employeeCodeFrom(identity, input.collaboratorUserId);
  const fields = {
    employeeName: input.collaboratorName,
    issueDate: input.occurredAt.slice(0, 10),
    uniformTransactionId: input.transactionId,
  };
  const destination = resolveDocumentDestination({ config, employeeCode, fields, version: 1 });
  const now = Timestamp.now();
  const displayName = `${config.label} - ${input.occurredAt.slice(0, 10).split("-").reverse().join("/")}`;
  await reference.set({
    employeeId: input.collaboratorUserId,
    candidateId: null,
    category: config.category,
    documentType: config.label,
    documentTypeCode: config.code,
    accessLevel: config.defaultAccessLevel,
    accessPolicyId: config.accessPolicyId,
    status: "validated",
    signatureRequired: true,
    signatureStatus: "signed",
    folderCode: destination.folderCode,
    caseId: destination.caseId,
    subcaseId: destination.subcaseId,
    destinationTrail: destination.pathSegments,
    displayName,
    storedName: input.fileName,
    originalName: input.fileName,
    mimeType: "application/pdf",
    size: input.size,
    contentHash: input.contentHash,
    hashAlgorithm: "sha256",
    logicalKey: `${input.collaboratorUserId}:${config.code}:${input.transactionId}`,
    version: 1,
    versionResolution: "NEW_DOCUMENT",
    extractedFields: fields,
    storagePath: input.storagePath,
    storageSubfolder: input.storageSubfolder,
    source: "uniform_transaction",
    sourceTemplateId: uniformSystemTemplateId(input.type),
    uniformTransactionId: input.transactionId,
    signedAt: input.signedAt,
    validatedBy: input.registeredByUserId,
    validatedByName: input.registeredByName,
    validatedAt: now,
    uploadedBy: input.registeredByUserId,
    uploadedByName: input.registeredByName,
    uploadedAt: now,
    updatedAt: now,
    accessCount: 0,
    deletedAt: null,
  });
  await reference.collection("audit").add({
    action: "UNIFORM_TERM_SIGNED_AND_ARCHIVED",
    actorId: input.registeredByUserId,
    actorName: input.registeredByName,
    uniformTransactionId: input.transactionId,
    contentHash: input.contentHash,
    at: now,
  });
  return input.transactionId;
}
