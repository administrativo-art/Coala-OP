import "server-only";

import { randomUUID } from "node:crypto";
import { z } from "zod";
import { financialAgentIdentifier } from "../agent/contracts";
import { latestPublishedDate } from "../receivables/period-review";
import { readSalesReviewCalendarBinding } from "./mapping.server";
import { pixRefundDates, pixRefundKey } from "@/lib/integrations/stone/pix-refunds";
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
const MAX_BACKFILL_FILES = 62;
const MAX_BACKFILL_REQUESTS_PER_RUN = 8;
const backfillSchema = z.object({
  version: z.literal(1),
  workspaceId: financialAgentIdentifier,
  mappingId: financialAgentIdentifier,
  kioskId: financialAgentIdentifier,
  stoneCode: z.string().regex(/^[1-9]\d{0,19}$/),
  from: z.string().refine(isStonePixRequestDate),
  through: z.string().refine(isStonePixRequestDate),
  expiresAt: z.string().datetime(),
  documentKey: z.string().regex(/^e[a-f0-9]{64}$/),
  files: z.record(z.string().regex(/^[a-f0-9]{64}$/)),
}).strict();

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

function repository(expectedFiles?: Record<string, string>): StonePixRequestRepository {
  return {
    async reserve({ document, referenceDate, now }) {
      const fileId = stonePixFileId(document, referenceDate);
      const fileRef = financialDbAdmin.collection(STONE_PIX_FILE_COLLECTION).doc(fileId);
      const requestRef = financialDbAdmin.collection(STONE_PIX_REQUEST_COLLECTION).doc(fileId);
      return financialDbAdmin.runTransaction(async tx => {
        const file = await tx.get(fileRef);
        const request = await tx.get(requestRef);
        const sameFile = file.get("workspaceId") === WORKSPACE_ID
          && file.get("document") === document
          && file.get("referenceDate") === referenceDate
          && file.get("schemaVersion") === STONE_PIX_FILE_SCHEMA_VERSION;
        if (sameFile && file.get("status") === "processed"
          && (!expectedFiles || typeof file.get("refundLayoutSupported") === "boolean")) {
          return { status: "processed" as const };
        }
        if (expectedFiles && (!sameFile || file.get("sourceHash") !== expectedFiles[referenceDate])) {
          return { status: "waiting" as const };
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

async function readRefundBackfill(document: string, now: Date) {
  const request = await financialDbAdmin.collection("stonePixRefundBackfills").doc(WORKSPACE_ID).get();
  if (!request.exists) return null;
  const parsed = backfillSchema.safeParse(request.data());
  if (!parsed.success) throw new AppError({ code: "STONE_PIX_REFUND_BACKFILL_INVALID", kind: "DATA_INTEGRITY" });
  const plan = parsed.data;
  if (Date.parse(plan.expiresAt) <= now.getTime()) return null;
  const dates = pixRefundDates(plan.from, plan.through);
  if (!dates || dates.length > MAX_BACKFILL_FILES || plan.through > latestPublishedDate(now)
    || Object.keys(plan.files).length !== dates.length || dates.some(date => !plan.files[date])
    || plan.workspaceId !== WORKSPACE_ID || plan.documentKey !== pixRefundKey(document)) {
    throw new AppError({ code: "STONE_PIX_REFUND_BACKFILL_SCOPE_INVALID", kind: "DATA_INTEGRITY" });
  }
  const binding = await readSalesReviewCalendarBinding(plan, WORKSPACE_ID);
  if (binding.status !== "active" || plan.from < binding.validFrom || (binding.validTo && plan.through > binding.validTo)) {
    throw new AppError({ code: "STONE_PIX_REFUND_BACKFILL_BINDING_INVALID", kind: "DATA_INTEGRITY" });
  }
  return { plan, dates };
}

export async function requestMissingStonePixFiles(now = new Date()) {
  const document = configuredDocument();
  const startDate = configuredStartDate();
  const requestFile = (input: { document: string; referenceDate: string }) => requestStonePixFile(input, {
    apiKey: process.env.STONE_CONCILIATION_API_KEY,
  });
  const normal = await syncStonePixRequests({ document, startDate, now, repository: repository(), requestFile });
  const backfill = await readRefundBackfill(document, now);
  if (!backfill) return normal;
  const result = await syncStonePixRequests({
    document, startDate, now, repository: repository(backfill.plan.files), requestFile,
    targeted: { dates: backfill.dates, maxRequests: MAX_BACKFILL_REQUESTS_PER_RUN },
  });
  return { ...normal, refundBackfill: result };
}
