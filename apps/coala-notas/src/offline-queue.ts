import * as FileSystem from "expo-file-system/legacy";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

import { openFile, sealFile } from "./queue-vault";
import type { FundingSource, OpenWithdrawal, SelectedReceipt } from "./upload";

const STORAGE_KEY = "coala-notas:offline-queue:v2";
const MAX_PENDING_RECEIPTS = 20;
const QUEUE_DIRECTORY = `${FileSystem.documentDirectory ?? ""}coala-notas-pending/`;
const OPEN_DIRECTORY = `${FileSystem.cacheDirectory ?? ""}coala-notas-sending/`;

export type QueuedReceipt = {
  ownerUid: string;
  submissionId: string;
  capturedAt: string;
  note: string;
  fundingSource: FundingSource;
  receipts: SelectedReceipt[];
  paymentProofs: SelectedReceipt[];
  /** Sangria escolhida na tela inicial; ausente em itens guardados por versões anteriores. */
  withdrawal?: OpenWithdrawal | null;
  createdAt: string;
  retryCount: number;
  lastError: string | null;
};

async function readRaw() {
  if (Platform.OS === "web") return globalThis.localStorage?.getItem(STORAGE_KEY) ?? null;
  return SecureStore.getItemAsync(STORAGE_KEY);
}

async function writeRaw(value: string) {
  if (Platform.OS === "web") {
    globalThis.localStorage?.setItem(STORAGE_KEY, value);
    return;
  }
  await SecureStore.setItemAsync(STORAGE_KEY, value);
}

async function writeQueue(queue: QueuedReceipt[]) {
  await writeRaw(JSON.stringify(queue.slice(0, MAX_PENDING_RECEIPTS)));
}

async function loadAll(): Promise<QueuedReceipt[]> {
  try {
    const raw = await readRaw();
    if (!raw) return [];
    const value = JSON.parse(raw) as unknown;
    if (!Array.isArray(value)) return [];
    return value.flatMap((entry) => {
      if (!entry || typeof entry !== "object" || !("ownerUid" in entry) || !("submissionId" in entry) || !("capturedAt" in entry)) return [];
      // Itens guardados antes dos anexos múltiplos tinham um arquivo por papel.
      const legacy = entry as { receipt?: SelectedReceipt; paymentProof?: SelectedReceipt | null; receipts?: SelectedReceipt[]; paymentProofs?: SelectedReceipt[] };
      const receipts = Array.isArray(legacy.receipts) ? legacy.receipts : legacy.receipt ? [legacy.receipt] : [];
      if (!receipts.length) return [];
      const paymentProofs = Array.isArray(legacy.paymentProofs) ? legacy.paymentProofs : legacy.paymentProof ? [legacy.paymentProof] : [];
      return [{ ...(entry as QueuedReceipt), receipts, paymentProofs }];
    }).slice(0, MAX_PENDING_RECEIPTS);
  } catch {
    return [];
  }
}

export async function loadOfflineQueue(ownerUid: string): Promise<QueuedReceipt[]> {
  return (await loadAll()).filter((entry) => entry.ownerUid === ownerUid);
}

function safeExtension(receipt: SelectedReceipt) {
  const match = receipt.name.toLowerCase().match(/\.([a-z0-9]{2,5})$/);
  if (match?.[1]) return match[1];
  if (receipt.mimeType === "application/pdf") return "pdf";
  if (receipt.mimeType === "image/png") return "png";
  if (receipt.mimeType === "image/webp") return "webp";
  return "jpg";
}

export async function enqueueReceipt(input: {
  ownerUid: string;
  submissionId: string;
  capturedAt: string;
  note: string;
  fundingSource: FundingSource;
  receipts: SelectedReceipt[];
  paymentProofs: SelectedReceipt[];
  withdrawal: OpenWithdrawal | null;
}) {
  const current = await loadAll();
  const existing = current.find((entry) => entry.ownerUid === input.ownerUid && entry.submissionId === input.submissionId);
  if (existing) return existing;
  if (current.length >= MAX_PENDING_RECEIPTS) {
    throw new Error(`O aparelho já tem ${MAX_PENDING_RECEIPTS} notas pendentes. Sincronize uma delas antes de guardar outra.`);
  }
  if (Platform.OS === "web" || !FileSystem.documentDirectory) {
    throw new Error("A fila offline fica disponível no aplicativo Android instalado.");
  }

  await FileSystem.makeDirectoryAsync(QUEUE_DIRECTORY, { intermediates: true });
  async function protect(role: "receipt" | "payment-proof", documents: SelectedReceipt[]) {
    const copies: SelectedReceipt[] = [];
    for (const [index, document] of documents.entries()) {
      const destination = `${QUEUE_DIRECTORY}${input.submissionId}-${role}-${index + 1}.${safeExtension(document)}.enc`;
      await sealFile(document.uri, destination);
      // A foto original fica no cache do app em claro; só a cópia cifrada deve sobrar.
      if (FileSystem.cacheDirectory && document.uri.startsWith(FileSystem.cacheDirectory)) {
        await FileSystem.deleteAsync(document.uri, { idempotent: true }).catch(() => undefined);
      }
      copies.push({ ...document, uri: destination, previewUri: null, sealed: true });
    }
    return copies;
  }
  const queued: QueuedReceipt = {
    ownerUid: input.ownerUid,
    submissionId: input.submissionId,
    capturedAt: input.capturedAt,
    note: input.note,
    fundingSource: input.fundingSource,
    receipts: await protect("receipt", input.receipts),
    paymentProofs: await protect("payment-proof", input.paymentProofs),
    withdrawal: input.withdrawal,
    createdAt: new Date().toISOString(),
    retryCount: 0,
    lastError: null,
  };
  await writeQueue([...current, queued]);
  return queued;
}

export async function markQueuedReceiptFailed(ownerUid: string, submissionId: string, message: string) {
  const current = await loadAll();
  await writeQueue(current.map((entry) => entry.ownerUid === ownerUid && entry.submissionId === submissionId
    ? { ...entry, retryCount: entry.retryCount + 1, lastError: message.slice(0, 300) }
    : entry));
}

export async function removeQueuedReceipt(ownerUid: string, submissionId: string) {
  const current = await loadAll();
  const removed = current.find((entry) => entry.ownerUid === ownerUid && entry.submissionId === submissionId);
  await writeQueue(current.filter((entry) => entry.ownerUid !== ownerUid || entry.submissionId !== submissionId));
  if (removed && Platform.OS !== "web") {
    for (const document of [...removed.receipts, ...removed.paymentProofs]) {
      await FileSystem.deleteAsync(document.uri, { idempotent: true }).catch(() => undefined);
    }
  }
}

/**
 * Abre os documentos de um item da fila em arquivos temporários só pelo tempo do
 * envio. Itens guardados antes da criptografia seguem como estão.
 */
export async function withOpenDocuments<T>(queued: QueuedReceipt, work: (documents: { receipts: SelectedReceipt[]; paymentProofs: SelectedReceipt[] }) => Promise<T>) {
  const temporary: string[] = [];
  async function open(documents: SelectedReceipt[]) {
    const opened: SelectedReceipt[] = [];
    for (const document of documents) {
      if (!document.sealed) { opened.push(document); continue; }
      await FileSystem.makeDirectoryAsync(OPEN_DIRECTORY, { intermediates: true });
      const destination = `${OPEN_DIRECTORY}${document.uri.split("/").pop()!.replace(/\.enc$/, "")}`;
      temporary.push(destination);
      await openFile(document.uri, destination);
      opened.push({ ...document, uri: destination, sealed: false });
    }
    return opened;
  }
  try {
    return await work({ receipts: await open(queued.receipts), paymentProofs: await open(queued.paymentProofs) });
  } finally {
    for (const uri of temporary) await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => undefined);
  }
}
