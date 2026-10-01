import "server-only";

import { randomUUID } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { financialDbAdmin } from "@/lib/firebase-financial-admin";
import { AppError } from "@/lib/observability/app-error";
import { requestStonePixFile } from "@/lib/integrations/stone/pix-request-transport";
import { stonePixFileId } from "@/lib/integrations/stone/pix-conciliation";
import {
  STONE_PIX_FILE_COLLECTION,
  STONE_PIX_FILE_SCHEMA_VERSION,
  STONE_PIX_REQUEST_COLLECTION,
} from "@/lib/integrations/stone/pix-storage-contract";
import { WORKSPACE_ID } from "@/lib/workspace";
import {
  isStonePixRequestDate,
  syncStonePixRequests,
  type StonePixRequestRepository,
} from "./pix-request";

const REQUEST_LEASE_MS = 10 * 60_000;
const WEBHOOK_WAIT_MS = 2 * 60 * 60_000;
const FAILED_RETRY_MS = 6 * 60 * 60_000;

function configuredDocument() {
  const document = process.env.STONE_CONCILIATION_DOCUMENT?.replace(/\D/g, "") ?? "";
  if (!/^(?:\d{11}|\d{14})$/.test(document)) {
    throw new AppError({ code: "STONE_PIX_SYNC_DOCUMENT_NOT_CONFIGURED", kind: "UNEXPECTED_APPLICATION" });
  }
  return document;
}

function configuredStartDate() {
  const value = process.env.STONE_PIX_SYNC_START_DATE?.trim() ?? "";
  if (!isStonePixRequestDate(value)) {
    throw new AppError({ code: "STONE_PIX_SYNC_START_NOT_CONFIGURED", kind: "UNEXPECTED_APPLICATION" });
  }
  return value;
}

function repository(): StonePixRequestRepository {
  return {
    async reserve({ document, referenceDate, now }) {
      const fileId = stonePixFileId(document, referenceDate);
      const fileRef = financialDbAdmin.collection(STONE_PIX_FILE_COLLECTION).doc(fileId);
      const requestRef = financialDbAdmin.collection(STONE_PIX_REQUEST_COLLECTION).doc(fileId);
      return financialDbAdmin.runTransaction(async tx => {
        const file = await tx.get(fileRef);
        const request = await tx.get(requestRef);
        if (file.get("workspaceId") === WORKSPACE_ID
          && file.get("document") === document
          && file.get("referenceDate") === referenceDate
          && file.get("status") === "processed"
          && file.get("schemaVersion") === STONE_PIX_FILE_SCHEMA_VERSION) {
          return { status: "processed" as const };
        }
        const waitUntil = Number(request.get("nextRetryAt") ?? request.get("leaseExpiresAt") ?? 0);
        if (["requesting", "requested"].includes(String(request.get("status"))) && waitUntil > now.getTime()) {
          return { status: "waiting" as const };
        }
        if (request.get("status") === "failed" && Number(request.get("nextRetryAt") ?? 0) > now.getTime()) {
          return { status: "waiting" as const };
        }
        const leaseId = randomUUID();
        const attempt = Math.max(0, Number(request.get("attempt") ?? 0)) + 1;
        tx.set(requestRef, {
          workspaceId: WORKSPACE_ID,
          document,
          referenceDate,
          status: "requesting",
          leaseId,
          leaseExpiresAt: now.getTime() + REQUEST_LEASE_MS,
          attempt,
          updatedAt: now.toISOString(),
        }, { merge: true });
        return { status: "reserved" as const, leaseId, attempt };
      });
    },
    async accepted({ document, referenceDate, leaseId, status, now }) {
      const ref = financialDbAdmin.collection(STONE_PIX_REQUEST_COLLECTION)
        .doc(stonePixFileId(document, referenceDate));
      await financialDbAdmin.runTransaction(async tx => {
        const current = await tx.get(ref);
        if (current.get("leaseId") !== leaseId) return;
        tx.set(ref, {
          status: "requested",
          acceptedAt: now.toISOString(),
          lastHttpStatus: status,
          nextRetryAt: now.getTime() + WEBHOOK_WAIT_MS,
          leaseId: FieldValue.delete(),
          leaseExpiresAt: FieldValue.delete(),
          updatedAt: now.toISOString(),
        }, { merge: true });
      });
    },
    async failed({ document, referenceDate, leaseId, errorCode, now }) {
      const ref = financialDbAdmin.collection(STONE_PIX_REQUEST_COLLECTION)
        .doc(stonePixFileId(document, referenceDate));
      await financialDbAdmin.runTransaction(async tx => {
        const current = await tx.get(ref);
        if (current.get("leaseId") !== leaseId) return;
        tx.set(ref, {
          status: "failed",
          errorCode,
          failedAt: now.toISOString(),
          nextRetryAt: now.getTime() + FAILED_RETRY_MS,
          leaseId: FieldValue.delete(),
          leaseExpiresAt: FieldValue.delete(),
          updatedAt: now.toISOString(),
        }, { merge: true });
      });
    },
  };
}

export async function requestMissingStonePixFiles(now = new Date()) {
  const document = configuredDocument();
  return syncStonePixRequests({
    document,
    startDate: configuredStartDate(),
    now,
    repository: repository(),
    requestFile: input => requestStonePixFile(input, {
      apiKey: process.env.STONE_CONCILIATION_API_KEY,
    }),
  });
}
