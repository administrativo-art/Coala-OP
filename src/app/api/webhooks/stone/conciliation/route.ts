import { createHash, randomUUID } from "node:crypto";

import { after, NextRequest, NextResponse } from "next/server";

import { financialDbAdmin } from "@/lib/firebase-financial-admin";
import {
  assertSafeStoneDownloadUrl,
  parseStonePixCsv,
  parseStonePixWebhookPayload,
  StonePixProcessingError,
  stonePixFileId,
  verifyStoneWebhookSecret,
} from "@/lib/integrations/stone/pix-conciliation";
import { AppError, reportSystemError } from "@/lib/observability";
import { writePixRefundProjection } from "@/features/financial/sales-reconciliation/pix-refunds.server";
import { projectPixRefundDay } from "@/lib/integrations/stone/pix-refunds";
import { createStandardSecurityEnforcer } from "@/lib/security/enforcer";
import { defineSecurityContract } from "@/lib/security/route-contract";
import { secureRoute } from "@/lib/security/secure-route.server";
import { WORKSPACE_ID } from "@/lib/workspace";
import {
  STONE_PIX_FILE_COLLECTION,
  STONE_PIX_FILE_SCHEMA_VERSION,
  STONE_PIX_REQUEST_COLLECTION,
} from "@/lib/integrations/stone/pix-storage-contract";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const MAX_WEBHOOK_BODY_BYTES = 20_000;
const MAX_CSV_BYTES = 10 * 1024 * 1024;
const PROCESSING_LEASE_MS = 10 * 60_000;

function expectedDocument(): string | null {
  const value = process.env.STONE_CONCILIATION_DOCUMENT?.replace(/\D/g, "");
  return value && /^(?:\d{11}|\d{14})$/.test(value) ? value : null;
}

function isAuthorized(request: NextRequest): boolean {
  return verifyStoneWebhookSecret(
    request.headers.get("x-coala-stone-webhook-secret"),
    process.env.STONE_CONCILIATION_WEBHOOK_SECRET,
  );
}

function routeError(options: ConstructorParameters<typeof AppError>[0]): never {
  throw new AppError({ ...options, reportable: false });
}

async function replaceTransactions(
  fileRef: FirebaseFirestore.DocumentReference,
  transactions: ReturnType<typeof parseStonePixCsv>["transactions"],
  sourceHash: string,
) {
  const current = await fileRef.collection("transactions").get();
  for (let offset = 0; offset < current.docs.length; offset += 400) {
    const batch = financialDbAdmin.batch();
    for (const existing of current.docs.slice(offset, offset + 400)) batch.delete(existing.ref);
    await batch.commit();
  }

  for (let offset = 0; offset < transactions.length; offset += 400) {
    const batch = financialDbAdmin.batch();
    for (const transaction of transactions.slice(offset, offset + 400)) {
      batch.set(fileRef.collection("transactions").doc(transaction.rowId), {
        ...transaction,
        sourceHash,
      });
    }
    await batch.commit();
  }
}

async function processPixFile(input: {
  document: string;
  referenceDate: string;
  url: string;
  receivedAt: string;
}) {
  const fileRef = financialDbAdmin.collection(STONE_PIX_FILE_COLLECTION)
    .doc(stonePixFileId(input.document, input.referenceDate));
  const requestRef = financialDbAdmin.collection(STONE_PIX_REQUEST_COLLECTION).doc(fileRef.id);
  const projectionScope = { workspaceId: WORKSPACE_ID, document: input.document, referenceDate: input.referenceDate };
  const runId = randomUUID();
  const notificationHash = createHash("sha256").update(input.url).digest("hex");

  try {
    const safeUrl = assertSafeStoneDownloadUrl(input.url);
    const acquired = await financialDbAdmin.runTransaction(async tx => {
      const current = await tx.get(fileRef);
      if (current.get("status") === "processed"
        && current.get("schemaVersion") === STONE_PIX_FILE_SCHEMA_VERSION
        && typeof current.get("refundLayoutSupported") === "boolean"
        && current.get("notificationHash") === notificationHash) return null;
      if (current.get("status") === "processing"
        && Number(current.get("processingLeaseExpiresAt") ?? 0) > Date.now()) return null;
      const reusableHash = current.get("status") === "processed" && current.get("schemaVersion") === STONE_PIX_FILE_SCHEMA_VERSION
        ? current.get("sourceHash") : null;
      await writePixRefundProjection(tx, projectionScope);
      tx.set(fileRef, {
        id: fileRef.id,
        workspaceId: WORKSPACE_ID,
        document: input.document,
        referenceDate: input.referenceDate,
        status: "processing",
        receivedAt: input.receivedAt,
        processingStartedAt: new Date().toISOString(),
        processingRunId: runId,
        processingLeaseExpiresAt: Date.now() + PROCESSING_LEASE_MS,
        notificationHash,
      }, { merge: true });
      return { reusableHash };
    });
    if (!acquired) return;

    const response = await fetch(safeUrl, {
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw new StonePixProcessingError("download_failed");
    const declaredLength = Number(response.headers.get("content-length") ?? 0);
    if (declaredLength > MAX_CSV_BYTES) throw new StonePixProcessingError("csv_too_large");

    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > MAX_CSV_BYTES) throw new StonePixProcessingError("csv_too_large");
    const sourceHash = createHash("sha256").update(bytes).digest("hex");
    const csv = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const parsed = parseStonePixCsv(csv);
    const refundProjection = projectPixRefundDay(input.referenceDate, sourceHash, parsed.transactions);
    refundProjection.complete &&= parsed.refundCoverageSupported;
    if (sourceHash !== acquired.reusableHash) {
      await replaceTransactions(fileRef, parsed.transactions, sourceHash);
    }
    await financialDbAdmin.runTransaction(async tx => {
      const current = await tx.get(fileRef);
      if (current.get("processingRunId") !== runId) {
        throw new StonePixProcessingError("processing_lease_lost");
      }
      await writePixRefundProjection(tx, projectionScope, refundProjection);
      const processedAt = new Date().toISOString();
      tx.set(fileRef, {
        status: "processed",
        schemaVersion: STONE_PIX_FILE_SCHEMA_VERSION,
        processedAt,
        sourceHash,
        sourceBytes: bytes.byteLength,
        summary: parsed.summary,
        refundLayoutSupported: parsed.refundCoverageSupported,
        errorCode: null,
        processingRunId: null,
        processingLeaseExpiresAt: null,
      }, { merge: true });
      tx.set(requestRef, {
        workspaceId: WORKSPACE_ID,
        document: input.document,
        referenceDate: input.referenceDate,
        status: "processed",
        processedAt,
        sourceHash,
        nextRetryAt: null,
        errorCode: null,
        updatedAt: processedAt,
      }, { merge: true });
    });
  } catch (error) {
    const errorCode = error instanceof StonePixProcessingError
      ? error.code
      : "processing_failed";
    await financialDbAdmin.runTransaction(async tx => {
      const current = await tx.get(fileRef);
      if (current.exists && current.get("processingRunId") !== runId) return;
      const failedAt = new Date().toISOString();
      tx.set(fileRef, {
        id: fileRef.id,
        workspaceId: WORKSPACE_ID,
        document: input.document,
        referenceDate: input.referenceDate,
        status: "failed",
        failedAt,
        receivedAt: input.receivedAt,
        errorCode,
        processingRunId: null,
        processingLeaseExpiresAt: null,
      }, { merge: true });
      tx.set(requestRef, {
        workspaceId: WORKSPACE_ID,
        document: input.document,
        referenceDate: input.referenceDate,
        status: "failed",
        failedAt,
        errorCode,
        nextRetryAt: Date.now() + 6 * 60 * 60_000,
        updatedAt: failedAt,
      }, { merge: true });
    });
    reportSystemError({
      error: new StonePixProcessingError(errorCode),
      code: "STONE_PIX_FILE_PROCESSING_FAILED",
      kind: "TRANSIENT_EXTERNAL",
      source: "stone-conciliation",
      operation: "process-pix-file",
      routeOrJob: "/api/webhooks/stone/conciliation",
      metadata: {
        document: input.document,
        referenceDate: input.referenceDate,
        provider: "stone",
        status: errorCode,
      },
    });
  }
}

type StaticRouteContext = { params: Promise<Record<string, never>> };

function authenticateStone(request: NextRequest, query = false) {
  if (!process.env.STONE_CONCILIATION_WEBHOOK_SECRET?.trim()) {
    return routeError({
      code: "STONE_WEBHOOK_NOT_CONFIGURED",
      kind: "TRANSIENT_EXTERNAL",
      httpStatus: 503,
      safeMessage: "Webhook não configurado.",
    });
  }
  if (!isAuthorized(request)) {
    return routeError({
      code: query ? "STONE_QUERY_UNAUTHORIZED" : "STONE_WEBHOOK_UNAUTHORIZED",
      kind: "AUTHENTICATION",
      safeMessage: query ? "Consulta não autorizada." : "Webhook não autorizado.",
    });
  }
  return true as const;
}

async function parseStoneNotification(request: NextRequest) {
  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_WEBHOOK_BODY_BYTES) {
    return routeError({
      code: "STONE_WEBHOOK_PAYLOAD_TOO_LARGE",
      kind: "VALIDATION",
      httpStatus: 413,
      safeMessage: "Payload muito grande.",
    });
  }
  const rawBody = await request.text();
  if (Buffer.byteLength(rawBody, "utf8") > MAX_WEBHOOK_BODY_BYTES) {
    return routeError({
      code: "STONE_WEBHOOK_PAYLOAD_TOO_LARGE",
      kind: "VALIDATION",
      httpStatus: 413,
      safeMessage: "Payload muito grande.",
    });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch (cause) {
    return routeError({
      code: "STONE_WEBHOOK_INVALID_JSON",
      kind: "VALIDATION",
      safeMessage: "JSON inválido.",
      cause,
    });
  }

  let notification: ReturnType<typeof parseStonePixWebhookPayload>;
  try {
    notification = parseStonePixWebhookPayload(payload);
  } catch (cause) {
    return routeError({
      code: "STONE_WEBHOOK_INVALID_PAYLOAD",
      kind: "VALIDATION",
      safeMessage: "Payload fora do contrato esperado.",
      cause,
    });
  }

  if (notification.type === "validation_notification") {
    return notification;
  }

  const document = expectedDocument();
  if (!document) {
    return routeError({
      code: "STONE_DOCUMENT_NOT_CONFIGURED",
      kind: "TRANSIENT_EXTERNAL",
      httpStatus: 503,
      safeMessage: "Documento Stone não configurado.",
    });
  }
  if (notification.document !== document) {
    return routeError({
      code: "STONE_DOCUMENT_UNAUTHORIZED",
      kind: "AUTHORIZATION",
      safeMessage: "Documento não autorizado.",
    });
  }

  return notification;
}

const notificationContract = defineSecurityContract({
  schemaVersion: 1, id: "stone.conciliation.webhook.receive", version: 1,
  surface: { method: "POST", path: "/api/webhooks/stone/conciliation" },
  exposure: "internal-service", identity: { kind: "signed-webhook", provider: "stone" },
  authorization: { kind: "none" }, resourceScope: { kind: "none" },
  input: { kind: "schema", schema: "stone.pix.notification", unknownFields: "strip" },
  effects: { mode: "external", audit: "server-authoritative" }, errorExposure: "sanitized",
});

const notificationEnforcer = createStandardSecurityEnforcer<
  NextRequest, StaticRouteContext, unknown, true, Awaited<ReturnType<typeof parseStoneNotification>>
>(notificationContract, {
  authenticate: ({ request }) => authenticateStone(request),
  parseInput: ({ request }) => parseStoneNotification(request),
});

export const POST = secureRoute({ contract: notificationContract, enforcer: notificationEnforcer }, ({ security }) => {
  if (security.input.type === "validation_notification") return NextResponse.json({ ok: true });
  const notification = security.input;
  const receivedAt = new Date().toISOString();
  after(() => processPixFile({ ...notification, receivedAt }));
  return NextResponse.json({ ok: true, accepted: true });
});

function parseStoneQuery(request: NextRequest) {
  const document = request.nextUrl.searchParams.get("document")?.replace(/\D/g, "") ?? "";
  const referenceDate = request.nextUrl.searchParams.get("referenceDate") ?? "";
  if (document !== expectedDocument() || !/^\d{4}-\d{2}-\d{2}$/.test(referenceDate)) {
    return routeError({
      code: "STONE_QUERY_INVALID_PARAMETERS",
      kind: "VALIDATION",
      safeMessage: "Parâmetros inválidos.",
    });
  }

  return { document, referenceDate };
}

const queryContract = defineSecurityContract({
  schemaVersion: 1, id: "stone.conciliation.webhook.read", version: 1,
  surface: { method: "GET", path: "/api/webhooks/stone/conciliation" },
  exposure: "internal-service", identity: { kind: "signed-webhook", provider: "stone" },
  authorization: { kind: "none" }, resourceScope: { kind: "none" },
  input: { kind: "schema", schema: "stone.pix.file-query", unknownFields: "strip" },
  effects: { mode: "read", audit: "none" }, errorExposure: "sanitized",
});

const queryEnforcer = createStandardSecurityEnforcer<
  NextRequest, StaticRouteContext, unknown, true, ReturnType<typeof parseStoneQuery>
>(queryContract, {
  authenticate: ({ request }) => authenticateStone(request, true),
  parseInput: ({ request }) => parseStoneQuery(request),
});

export const GET = secureRoute({ contract: queryContract, enforcer: queryEnforcer }, async ({ security }) => {
  const { document, referenceDate } = security.input;
  const fileRef = financialDbAdmin.collection(STONE_PIX_FILE_COLLECTION)
    .doc(stonePixFileId(document, referenceDate));
  const [file, transactionSnapshot] = await Promise.all([
    fileRef.get(),
    fileRef.collection("transactions").limit(2_000).get(),
  ]);
  if (!file.exists) {
    return routeError({
      code: "STONE_PIX_FILE_NOT_FOUND",
      kind: "NOT_FOUND",
      safeMessage: "Arquivo ainda não recebido.",
    });
  }

  return NextResponse.json({
    file: file.data(),
    transactions: transactionSnapshot.docs.map((doc) => doc.data()),
  });
});
