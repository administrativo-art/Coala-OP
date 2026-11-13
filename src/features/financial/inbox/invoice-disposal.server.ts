import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { getStorage } from "firebase-admin/storage";
import { dbAdmin, adminApp } from "@/lib/firebase-admin";
import { financialDbAdmin } from "@/lib/firebase-financial-admin";
import { firebaseClientConfig } from "@/lib/firebase-client-config";
import { AppError } from "@/lib/observability/app-error";
import { invoiceReferenceKey, sameInvoiceDestination, type InvoiceDestination } from "./invoice-destination";
import { redactEmlAttachment } from "./redact-eml";

type Sidecar = { path: string; generation: string; sourceSha256: string | null };
type Operation = { fileId: string; targetPath: string; targetGeneration: string; sidecars: Sidecar[]; priorRawPath: string | null; priorRawGeneration: string | null; nextRawPath: string | null; nextRawSha256: string | null; recoveryUntil: string };
const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const conflict = (safeMessage: string) => new AppError({ code: "INVOICE_DELETE_CONFLICT", kind: "CONFLICT", safeMessage });
const publicDestination = (value: InvoiceDestination): InvoiceDestination => ({ kind: value.kind, assetIds: value.assetIds, version: value.version, sha256: value.sha256, confirmedAt: value.confirmedAt, confirmedBy: value.confirmedBy, deletionState: value.deletionState });

export async function disposeNonAssetInvoice(input: { workspaceId: string; messageId: string; fileId: string; expectedSha256: string; expectedVersion: number; actorId: string }) {
  const ref = financialDbAdmin.collection("financialInboxMessages").doc(input.messageId);
  const current = await ref.get();
  const files = current.get("attachments") as Array<Record<string, any>> | undefined;
  const attachment = files?.find((item) => item.id === input.fileId);
  const destination = attachment?.destination as InvoiceDestination | undefined;
  if (!current.exists || current.get("workspaceId") !== input.workspaceId || current.get("provider") !== "resend" || !attachment || !destination
    || !sameInvoiceDestination(destination, "non_asset_invoice", [], input.expectedSha256) || destination.version !== input.expectedVersion) throw conflict("A decisão ou o anexo mudou. Atualize a cobrança.");
  if (files?.some((item) => item.id !== input.fileId && item.sha256 === input.expectedSha256)) throw conflict("Outro anexo deste e-mail tem os mesmos bytes. Revise ambos antes de excluir.");
  if (destination.deletionState === "deleted") return publicDestination(destination);
  const active = current.get("rawArchiveOperation") as Operation | null | undefined;
  if (active && active.fileId !== input.fileId) throw conflict("Outra exclusão deste e-mail está em andamento. Tente novamente após concluí-la.");
  if (!active && destination.deletionState === "deleting") throw conflict("O descarte anterior exige reconciliação técnica.");
  const key = invoiceReferenceKey(input.messageId, input.fileId);
  const assetReferences = await dbAdmin.collection("assets").where("inboxInvoiceKeys", "array-contains", key).limit(1).get();
  if (!assetReferences.empty) throw conflict("O arquivo está vinculado a um patrimônio.");
  const barcode = String(current.get("classification")?.barcode ?? "").replace(/\D/g, "");
  if (current.get("linkedExpenseId") && barcode && attachment.extractedHints?.barcode?.replace(/\D/g, "") === barcode) throw conflict("Este anexo é o boleto vinculado à despesa.");
  const bucket = getStorage(adminApp).bucket(firebaseClientConfig.storageBucket);
  const [bucketMeta] = await bucket.getMetadata().catch(() => { throw conflict("Não foi possível verificar a política de recuperação do armazenamento. O arquivo foi preservado."); });
  const retention = Number(bucketMeta.softDeletePolicy?.retentionDurationSeconds ?? 0);
  if (!Number.isFinite(retention) || retention < 7 * 86400) throw conflict("A recuperação temporária do armazenamento está indisponível. O arquivo foi preservado.");
  let operation = active ?? null;
  let redactedBytes: Buffer | null = null;
  if (!operation) {
    const targetPath = String(attachment.storagePath ?? "");
    if (!targetPath.startsWith(`financial-inbox/${input.workspaceId}/${input.messageId}/`) || targetPath.includes("..")) throw conflict("Caminho do anexo inválido.");
    const [targetMeta] = await bucket.file(targetPath).getMetadata();
    const targetGeneration = String(targetMeta.generation ?? "");
    if (!targetGeneration || targetMeta.metadata?.sha256 !== input.expectedSha256) throw conflict("O anexo armazenado mudou. Atualize a cobrança.");
    const sidecarPath = typeof attachment.extractedTextStoragePath === "string" ? attachment.extractedTextStoragePath : null;
    const sidecarPrefix = `${targetPath}.extracted-`;
    if (sidecarPath && (!sidecarPath.startsWith(sidecarPrefix) || sidecarPath.includes(".."))) throw conflict("O texto extraído tem origem inesperada.");
    const sidecars: Sidecar[] = [];
    const seenPages = new Set<string>();
    let pageToken: string | undefined;
    do {
      const [files, next] = await bucket.getFiles({ prefix: sidecarPrefix, autoPaginate: false, maxResults: 100, ...(pageToken ? { pageToken } : {}) });
      for (const file of files) {
        if (!file.name.startsWith(sidecarPrefix) || file.name.includes("..")) throw conflict("Um cache extraído tem caminho inesperado.");
        const [metadata] = await file.getMetadata();
        const generation = String(metadata.generation ?? "");
        const sourceSha256 = typeof metadata.metadata?.sourceSha256 === "string" && metadata.metadata.sourceSha256 ? metadata.metadata.sourceSha256 : null;
        if (!generation || sourceSha256 && sourceSha256 !== input.expectedSha256) throw conflict("Um cache extraído mudou de origem. Revise o anexo antes de excluir.");
        sidecars.push({ path: file.name, generation, sourceSha256 });
      }
      pageToken = next?.pageToken;
      if (pageToken && seenPages.has(pageToken)) throw conflict("A paginação dos caches não avançou.");
      if (pageToken) seenPages.add(pageToken);
    } while (pageToken);
    if (sidecarPath && !sidecars.some((item) => item.path === sidecarPath)) throw conflict("O texto extraído indicado pela mensagem não foi localizado.");
    const priorRawPath = typeof current.get("rawStoragePath") === "string" ? String(current.get("rawStoragePath")) : null;
    let priorRawGeneration: string | null = null;
    let nextRawPath: string | null = null;
    let nextRawSha256: string | null = null;
    if (priorRawPath) {
      if (!priorRawPath.startsWith(`financial-inbox/${input.workspaceId}/${input.messageId}/`) || priorRawPath.includes("..")) throw conflict("Caminho do e-mail armazenado inválido.");
      const rawFile = bucket.file(priorRawPath);
      const [rawMeta] = await rawFile.getMetadata();
      priorRawGeneration = String(rawMeta.generation ?? "");
      const [rawBytes] = await rawFile.download();
      if (!priorRawGeneration || sha(rawBytes) !== (current.get("rawCurrentSha256") || current.get("rawSha256"))) throw conflict("O e-mail armazenado mudou. O descarte foi interrompido.");
      const redacted = await redactEmlAttachment(rawBytes, input.expectedSha256).catch((cause: unknown) => {
        if (cause instanceof Error && cause.message.includes("mais de uma parte")) throw conflict("O e-mail contém partes idênticas à NF confirmada. Revise a identidade de cada anexo antes de excluir.");
        throw conflict("Não foi possível sanear a cópia do e-mail com segurança. O arquivo foi preservado para revisão técnica.");
      });
      redactedBytes = redacted.bytes;
      nextRawSha256 = redacted.sha256;
      // This path is only a durable intention until the transaction below claims it.
      nextRawPath = `financial-inbox/${input.workspaceId}/${input.messageId}/redacted/${Number(current.get("rawArchiveVersion") ?? 0) + 1}-${randomUUID()}-${redacted.sha256}.eml`;
    }
    operation = { fileId: input.fileId, targetPath, targetGeneration, sidecars, priorRawPath, priorRawGeneration, nextRawPath, nextRawSha256, recoveryUntil: new Date(Date.now() + retention * 1000).toISOString() };
    await financialDbAdmin.runTransaction(async (tx) => {
        const snapshot = await tx.get(ref);
        const pending = snapshot.get("rawArchiveOperation") as Operation | null | undefined;
        const list = snapshot.get("attachments") as Array<Record<string, any>>;
        const index = list.findIndex((item) => item.id === input.fileId);
        const file = list[index];
        const state = file?.destination as InvoiceDestination | undefined;
        if (pending || snapshot.get("documentAnalysisOperation") || snapshot.get("workspaceId") !== input.workspaceId || snapshot.get("rawStoragePath") !== priorRawPath
          || snapshot.updateTime?.toMillis() !== current.updateTime?.toMillis() || (file?.extractedTextStoragePath ?? null) !== sidecarPath
          || !state || !sameInvoiceDestination(state, "non_asset_invoice", [], input.expectedSha256)
          || state.version !== input.expectedVersion || state.deletionState === "deleted" || file.storagePath !== targetPath) throw conflict("A recepção mudou ou outro descarte foi iniciado. Atualize e tente novamente.");
        const next: InvoiceDestination = { ...state, deletionState: "deleting", deletedStoragePath: targetPath, storageGeneration: targetGeneration, recoveryUntil: operation!.recoveryUntil };
        tx.update(ref, { attachments: list.map((item, position) => position === index ? { ...item, storagePath: null, extractedTextStoragePath: null, extractedHints: null, extractionStatus: "not_attempted", destination: next } : item), rawArchiveState: "redacting", rawArchiveOperation: operation, updatedAt: new Date().toISOString() });
        tx.create(ref.collection("audit").doc(`${input.fileId}_delete_claim_v${state.version}`), { action: "INVOICE_DELETE_CLAIMED", fileId: input.fileId, sha256: input.expectedSha256, actorId: input.actorId, at: new Date().toISOString(), recoveryUntil: operation!.recoveryUntil });
    });
  }
  if (new Date(operation.recoveryUntil).getTime() <= Date.now()) throw conflict("O prazo de recuperação expirou durante a operação. Intervenção técnica necessária.");
  if (operation.nextRawPath) {
    const nextFile = bucket.file(operation.nextRawPath);
    let [nextMeta] = await nextFile.getMetadata().catch(() => [null]);
    if (!nextMeta) {
      if (!redactedBytes) {
        if (!operation.priorRawPath) throw conflict("A origem do e-mail para reconstrução não está disponível.");
        const [rawBytes] = await bucket.file(operation.priorRawPath).download().catch(() => { throw conflict("A origem do e-mail para reconstrução não está disponível."); });
        if (sha(rawBytes) !== (current.get("rawCurrentSha256") || current.get("rawSha256"))) throw conflict("A origem do e-mail mudou durante a reconstrução.");
        const reconstructed = await redactEmlAttachment(rawBytes, input.expectedSha256).catch(() => { throw conflict("O e-mail não pode ser reconstruído com segurança."); });
        redactedBytes = reconstructed.bytes;
        if (reconstructed.sha256 !== operation.nextRawSha256) throw conflict("O saneamento do e-mail mudou entre tentativas. Intervenção técnica necessária.");
      }
      try { await nextFile.save(redactedBytes, { resumable: false, preconditionOpts: { ifGenerationMatch: 0 }, metadata: { contentType: "message/rfc822", cacheControl: "private, no-store", metadata: { sha256: operation.nextRawSha256!, archiveState: "redacted" } } }); }
      catch (cause) { const [existing] = await nextFile.getMetadata().catch(() => [null]); if (existing?.metadata?.sha256 !== operation.nextRawSha256) throw cause; }
      [nextMeta] = await nextFile.getMetadata();
    }
    if (nextMeta.metadata?.sha256 !== operation.nextRawSha256) throw conflict("A versão saneada do e-mail está indisponível. A exclusão foi suspensa.");
  }
  for (const item of [
    { path: operation.priorRawPath, generation: operation.priorRawGeneration },
    ...operation.sidecars.map((sidecar) => ({ path: sidecar.path, generation: sidecar.generation })),
    { path: operation.targetPath, generation: operation.targetGeneration },
  ]) {
    if (!item.path || !item.generation) continue;
    try { await bucket.file(item.path).delete({ ifGenerationMatch: item.generation }); }
    catch (cause) { const [exists] = await bucket.file(item.path).exists(); if (exists) throw cause; }
  }
  const completed = await financialDbAdmin.runTransaction(async (tx) => {
    const snapshot = await tx.get(ref);
    const pending = snapshot.get("rawArchiveOperation") as Operation | null | undefined;
    const list = snapshot.get("attachments") as Array<Record<string, any>>;
    const index = list.findIndex((item) => item.id === input.fileId);
    const state = list[index]?.destination as InvoiceDestination | undefined;
    if (!pending || pending.fileId !== input.fileId || pending.targetGeneration !== operation!.targetGeneration || state?.deletionState !== "deleting") throw conflict("A conclusão do descarte exige reconciliação.");
    const next: InvoiceDestination = { ...state, deletionState: "deleted" };
    tx.update(ref, { attachments: list.map((item, position) => position === index ? { ...item, destination: next } : item), rawStoragePath: operation!.nextRawPath, rawCurrentSha256: operation!.nextRawSha256, rawArchiveState: "redacted", rawArchiveVersion: Number(snapshot.get("rawArchiveVersion") ?? 0) + 1, rawArchiveOperation: null, updatedAt: new Date().toISOString() });
    tx.create(ref.collection("audit").doc(`${input.fileId}_deleted_v${next.version}`), { action: "INVOICE_FILE_DELETED", fileId: input.fileId, sha256: input.expectedSha256, actorId: input.actorId, at: new Date().toISOString(), recoveryUntil: operation!.recoveryUntil, rawArchiveVersion: Number(snapshot.get("rawArchiveVersion") ?? 0) + 1 });
    return next;
  });
  return publicDestination(completed);
}
