import "server-only";

import { createHash } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";
import { z } from "zod";
import { financialDbAdmin } from "@/lib/firebase-financial-admin";
import { AppError } from "@/lib/observability/app-error";
import type { StoneAccountMonthResult } from "./reconciliation.server";

/**
 * Resultado salvo da conferência mensal "Recebido" (venda → conta Stone), produzido pela rotina
 * diária. A tela abre com ele; "Reconferir agora" continua sendo a consulta ao vivo, sem gravar.
 * Um documento por workspace × StoneCode × mês; só é reescrito quando o conteúdo muda.
 */
export const STONE_RECEIPT_SNAPSHOT_COLLECTION = "stoneReceiptMonthSnapshots";
const SNAPSHOT_VERSION = 1 as const;
const MAX_COMPRESSED_BYTES = 850_000;
const MAX_RAW_BYTES = 8_000_000;

export type StoneReceiptSnapshotIdentity = { workspaceId: string; mappingId: string; kioskId: string; stoneCode: string; month: string };

const snapshotSchema = z.object({
  schemaVersion: z.literal(SNAPSHOT_VERSION),
  workspaceId: z.string().min(1), mappingId: z.string().min(1), kioskId: z.string().min(1),
  stoneCode: z.string().regex(/^\d{1,20}$/), month: z.string().regex(/^\d{4}-\d{2}$/),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  encoding: z.literal("gzip-json"), rawBytes: z.number().int().positive().max(MAX_RAW_BYTES),
  compressedBytes: z.number().int().positive().max(MAX_COMPRESSED_BYTES), payload: z.unknown(),
  collectedAt: z.string().datetime(), storedAt: z.string().datetime(),
}).strict();

const snapshotId = (identity: Omit<StoneReceiptSnapshotIdentity, "mappingId" | "kioskId">) =>
  createHash("sha256").update(`${identity.workspaceId}:${identity.stoneCode}:${identity.month}`).digest("hex");

/** Impressão digital do conteúdo conferido; ignora o horário da coleta. */
export function stoneReceiptFingerprint(result: StoneAccountMonthResult) {
  return createHash("sha256").update(JSON.stringify({ ...result, collectedAt: null })).digest("hex");
}

export async function saveStoneReceiptSnapshot(identity: StoneReceiptSnapshotIdentity, result: StoneAccountMonthResult, now = new Date()) {
  if (result.scope.workspaceId !== identity.workspaceId || result.scope.mappingId !== identity.mappingId
    || result.scope.stoneCode !== identity.stoneCode || result.period.from.slice(0, 7) !== identity.month) {
    throw new AppError({ code: "STONE_RECEIPT_SNAPSHOT_SCOPE", kind: "DATA_INTEGRITY" });
  }
  const fingerprint = stoneReceiptFingerprint(result);
  const ref = financialDbAdmin.collection("stoneReceiptMonthSnapshots").doc(snapshotId(identity));
  const current = await ref.get();
  if (current.exists && current.get("fingerprint") === fingerprint && current.get("mappingId") === identity.mappingId) {
    return { written: false as const, fingerprint };
  }
  const raw = Buffer.from(JSON.stringify(result), "utf8");
  if (raw.length > MAX_RAW_BYTES) throw new AppError({ code: "STONE_RECEIPT_SNAPSHOT_LIMIT", kind: "EXPECTED_BUSINESS" });
  const payload = gzipSync(raw, { level: 9 });
  if (payload.length > MAX_COMPRESSED_BYTES) throw new AppError({ code: "STONE_RECEIPT_SNAPSHOT_LIMIT", kind: "EXPECTED_BUSINESS" });
  await ref.set({
    schemaVersion: SNAPSHOT_VERSION, ...identity, fingerprint, encoding: "gzip-json",
    rawBytes: raw.length, compressedBytes: payload.length, payload,
    collectedAt: result.collectedAt, storedAt: now.toISOString(),
  });
  return { written: true as const, fingerprint };
}

export type StoneReceiptSavedResult =
  | { view: "saved"; status: "not_ready"; month: string }
  | { view: "saved"; status: "ready"; month: string; savedAt: string|null; cacheReadAt?:string; result: StoneAccountMonthResult };

/** Lê o resultado salvo, conferindo que pertence ao mesmo vínculo; outro vínculo = "ainda não conferido". */
export async function readStoneReceiptSnapshot(identity: StoneReceiptSnapshotIdentity): Promise<StoneReceiptSavedResult> {
  const document = await financialDbAdmin.collection("stoneReceiptMonthSnapshots").doc(snapshotId(identity)).get();
  if (!document.exists) return { view: "saved", status: "not_ready", month: identity.month };
  const parsed = snapshotSchema.safeParse(document.data());
  if (!parsed.success || parsed.data.workspaceId !== identity.workspaceId || parsed.data.stoneCode !== identity.stoneCode
    || parsed.data.month !== identity.month) {
    throw new AppError({ code: "STONE_RECEIPT_SNAPSHOT_INVALID", kind: "DATA_INTEGRITY",
      safeMessage: "A conferência salva está inválida. Use Reconferir agora." });
  }
  if (parsed.data.mappingId !== identity.mappingId || parsed.data.kioskId !== identity.kioskId) {
    return { view: "saved", status: "not_ready", month: identity.month };
  }
  let result: StoneAccountMonthResult;
  try {
    result = JSON.parse(gunzipSync(Buffer.from(parsed.data.payload as Uint8Array)).toString("utf8")) as StoneAccountMonthResult;
  } catch {
    throw new AppError({ code: "STONE_RECEIPT_SNAPSHOT_INVALID", kind: "DATA_INTEGRITY", safeMessage: "A conferência salva está inválida. Use Reconferir agora." });
  }
  return { view: "saved", status: "ready", month: identity.month, savedAt: parsed.data.collectedAt, result };
}
