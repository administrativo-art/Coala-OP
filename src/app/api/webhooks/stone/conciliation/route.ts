import { createHash } from "node:crypto";

import { after, NextRequest, NextResponse } from "next/server";

import { financialDbAdmin } from "@/lib/firebase-financial-admin";
import {
  assertSafeStoneDownloadUrl,
  parseStonePixCsv,
  parseStonePixWebhookPayload,
  stonePixFileId,
  verifyStoneWebhookSecret,
} from "@/lib/integrations/stone/pix-conciliation";
import { WORKSPACE_ID } from "@/lib/workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_WEBHOOK_BODY_BYTES = 20_000;
const MAX_CSV_BYTES = 10 * 1024 * 1024;
const COLLECTION = "stonePixConciliationFiles";

function expectedDocument(): string | null {
  const value = process.env.STONE_CONCILIATION_DOCUMENT?.replace(/\D/g, "");
  return value && /^\d{11,14}$/.test(value) ? value : null;
}

function isAuthorized(request: NextRequest): boolean {
  return verifyStoneWebhookSecret(
    request.headers.get("x-coala-stone-webhook-secret"),
    process.env.STONE_CONCILIATION_WEBHOOK_SECRET,
  );
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
  const fileRef = financialDbAdmin.collection(COLLECTION)
    .doc(stonePixFileId(input.document, input.referenceDate));

  try {
    const safeUrl = assertSafeStoneDownloadUrl(input.url);
    await fileRef.set({
      id: fileRef.id,
      workspaceId: WORKSPACE_ID,
      document: input.document,
      referenceDate: input.referenceDate,
      status: "processing",
      receivedAt: input.receivedAt,
      processingStartedAt: new Date().toISOString(),
    }, { merge: true });

    const response = await fetch(safeUrl, {
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw new Error("download_failed");
    const declaredLength = Number(response.headers.get("content-length") ?? 0);
    if (declaredLength > MAX_CSV_BYTES) throw new Error("csv_too_large");

    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > MAX_CSV_BYTES) throw new Error("csv_too_large");
    const sourceHash = createHash("sha256").update(bytes).digest("hex");
    const csv = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const parsed = parseStonePixCsv(csv);
    await replaceTransactions(fileRef, parsed.transactions, sourceHash);
    await fileRef.set({
      status: "processed",
      processedAt: new Date().toISOString(),
      sourceHash,
      sourceBytes: bytes.byteLength,
      summary: parsed.summary,
      errorCode: null,
    }, { merge: true });
  } catch (error) {
    const errorCode = error instanceof Error && /^[a-z_]+$/.test(error.message)
      ? error.message
      : "processing_failed";
    await fileRef.set({
      id: fileRef.id,
      workspaceId: WORKSPACE_ID,
      document: input.document,
      referenceDate: input.referenceDate,
      status: "failed",
      failedAt: new Date().toISOString(),
      receivedAt: input.receivedAt,
      errorCode,
    }, { merge: true });
    console.error("Falha ao processar arquivo de conciliação Pix da Stone.", {
      document: input.document,
      referenceDate: input.referenceDate,
      errorCode,
    });
  }
}

export async function POST(request: NextRequest) {
  if (!process.env.STONE_CONCILIATION_WEBHOOK_SECRET?.trim()) {
    return NextResponse.json({ error: "Webhook não configurado." }, { status: 503 });
  }
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Webhook não autorizado." }, { status: 401 });
  }

  const rawBody = await request.text();
  if (Buffer.byteLength(rawBody, "utf8") > MAX_WEBHOOK_BODY_BYTES) {
    return NextResponse.json({ error: "Payload muito grande." }, { status: 413 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "JSON inválido." }, { status: 400 });
  }

  let notification: ReturnType<typeof parseStonePixWebhookPayload>;
  try {
    notification = parseStonePixWebhookPayload(payload);
  } catch {
    return NextResponse.json({ error: "Payload fora do contrato esperado." }, { status: 400 });
  }

  if (notification.type === "validation_notification") {
    return NextResponse.json({ ok: true });
  }

  const document = expectedDocument();
  if (!document) {
    return NextResponse.json({ error: "Documento Stone não configurado." }, { status: 503 });
  }
  if (notification.document !== document) {
    return NextResponse.json({ error: "Documento não autorizado." }, { status: 403 });
  }

  const receivedAt = new Date().toISOString();
  after(() => processPixFile({ ...notification, receivedAt }));
  return NextResponse.json({ ok: true, accepted: true });
}

export async function GET(request: NextRequest) {
  if (!process.env.STONE_CONCILIATION_WEBHOOK_SECRET?.trim()) {
    return NextResponse.json({ error: "Webhook não configurado." }, { status: 503 });
  }
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Consulta não autorizada." }, { status: 401 });
  }

  const document = request.nextUrl.searchParams.get("document")?.replace(/\D/g, "") ?? "";
  const referenceDate = request.nextUrl.searchParams.get("referenceDate") ?? "";
  if (document !== expectedDocument() || !/^\d{4}-\d{2}-\d{2}$/.test(referenceDate)) {
    return NextResponse.json({ error: "Parâmetros inválidos." }, { status: 400 });
  }

  const fileRef = financialDbAdmin.collection(COLLECTION)
    .doc(stonePixFileId(document, referenceDate));
  const [file, transactionSnapshot] = await Promise.all([
    fileRef.get(),
    fileRef.collection("transactions").limit(2_000).get(),
  ]);
  if (!file.exists) return NextResponse.json({ error: "Arquivo ainda não recebido." }, { status: 404 });

  return NextResponse.json({
    file: file.data(),
    transactions: transactionSnapshot.docs.map((doc) => doc.data()),
  });
}
