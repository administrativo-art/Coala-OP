import "server-only";

import { randomUUID } from "node:crypto";

import { Timestamp, type DocumentSnapshot, type Firestore } from "firebase-admin/firestore";

import type { ServerUserContext } from "@/lib/auth-server";
import { marketingDbAdmin } from "@/lib/firebase-marketing-admin";
import { AppError } from "@/lib/observability/app-error";

import type { InstagramMediaFolder } from "./contracts";
import {
  INSTAGRAM_MEDIA_FOLDER_MAX_COUNT,
  checkCreateFolder,
  checkRenameOrMoveFolder,
  instagramMediaFolderErrorMessages,
  uniqueFolderName,
  type InstagramMediaFolderPolicyError,
} from "./media-folders";

const FOLDERS = "instagramMediaFolders";
const MEDIA = "instagramMediaLibrary";
const MOVE_BATCH_SIZE = 400;

function actorOf(context: ServerUserContext) {
  return {
    uid: context.decoded.uid,
    email: context.decoded.email ?? context.userDoc.email ?? null,
  };
}

export function serializeInstagramMediaFolder(doc: DocumentSnapshot): InstagramMediaFolder {
  const data = doc.data() ?? {};
  return {
    id: doc.id,
    name: typeof data.name === "string" ? data.name : "Pasta",
    parentId: typeof data.parentId === "string" ? data.parentId : null,
  };
}

function policyError(code: InstagramMediaFolderPolicyError): never {
  throw new AppError({
    code: `INSTAGRAM_MEDIA_FOLDER_${code}`,
    kind: code === "FOLDER_NOT_FOUND" || code === "PARENT_NOT_FOUND"
      ? "NOT_FOUND"
      : code === "DUPLICATE_NAME" || code === "MOVE_INTO_ITSELF"
        ? "CONFLICT"
        : "VALIDATION",
    safeMessage: instagramMediaFolderErrorMessages[code],
    reportable: false,
  });
}

function folderQuery(db: Firestore, workspaceId: string) {
  return db
    .collection(FOLDERS)
    .where("workspace_id", "==", workspaceId)
    .limit(INSTAGRAM_MEDIA_FOLDER_MAX_COUNT + 1);
}

/** Uma consulta limitada: a árvore inteira (até 500 pastas) é carregada de uma vez. */
export async function listInstagramMediaFolders(workspaceId: string) {
  const snapshot = await folderQuery(marketingDbAdmin, workspaceId).get();
  return snapshot.docs.map(serializeInstagramMediaFolder);
}

export async function requireInstagramMediaFolder(workspaceId: string, folderId: string | null) {
  if (folderId === null) return;
  const snapshot = await marketingDbAdmin.collection(FOLDERS).doc(folderId).get();
  if (!snapshot.exists || snapshot.data()?.workspace_id !== workspaceId) policyError("PARENT_NOT_FOUND");
}

export async function createInstagramMediaFolder(
  context: ServerUserContext,
  input: { name: string; parentId: string | null },
) {
  const ref = marketingDbAdmin.collection(FOLDERS).doc(randomUUID());
  const actor = actorOf(context);
  await marketingDbAdmin.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(folderQuery(marketingDbAdmin, context.workspace_id));
    const folders = snapshot.docs.map(serializeInstagramMediaFolder);
    const failure = checkCreateFolder(folders, input);
    if (failure) policyError(failure);
    const now = Timestamp.now();
    transaction.create(ref, {
      workspace_id: context.workspace_id,
      name: input.name,
      parentId: input.parentId,
      createdAt: now,
      updatedAt: now,
      createdBy: actor,
      updatedBy: actor,
    });
  });
  return serializeInstagramMediaFolder(await ref.get());
}

export async function updateInstagramMediaFolder(
  context: ServerUserContext,
  id: string,
  changes: { name?: string; parentId?: string | null },
) {
  const ref = marketingDbAdmin.collection(FOLDERS).doc(id);
  const actor = actorOf(context);
  await marketingDbAdmin.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(folderQuery(marketingDbAdmin, context.workspace_id));
    const folders = snapshot.docs.map(serializeInstagramMediaFolder);
    const current = folders.find((folder) => folder.id === id);
    if (!current) policyError("FOLDER_NOT_FOUND");
    const next = {
      id,
      name: changes.name ?? current.name,
      parentId: changes.parentId === undefined ? current.parentId : changes.parentId,
    };
    const failure = checkRenameOrMoveFolder(folders, next);
    if (failure) policyError(failure);
    transaction.update(ref, {
      name: next.name,
      parentId: next.parentId,
      updatedAt: Timestamp.now(),
      updatedBy: actor,
    });
  });
  return serializeInstagramMediaFolder(await ref.get());
}

/**
 * Exclui a pasta sem apagar arquivos: mídias e subpastas sobem para a pasta de cima.
 * Subpastas que colidiriam de nome no destino recebem " (2)", " (3)"…
 * A movimentação das mídias é feita em lotes idempotentes antes da transação final, que
 * confere que nenhuma mídia restou (a consulta fica travada na transação) e remove a pasta.
 */
export async function deleteInstagramMediaFolder(context: ServerUserContext, id: string) {
  const db = marketingDbAdmin;
  const folders = await listInstagramMediaFolders(context.workspace_id);
  const target = folders.find((folder) => folder.id === id);
  if (!target) policyError("FOLDER_NOT_FOUND");
  const destination = target.parentId;
  const actor = actorOf(context);

  const mediaIn = (folderId: string) => db
    .collection(MEDIA)
    .where("workspace_id", "==", context.workspace_id)
    .where("folderId", "==", folderId);

  for (;;) {
    const batchSnapshot = await mediaIn(id).limit(MOVE_BATCH_SIZE).get();
    if (batchSnapshot.empty) break;
    const batch = db.batch();
    const now = Timestamp.now();
    batchSnapshot.docs.forEach((doc) => batch.update(doc.ref, { folderId: destination, updatedAt: now }));
    await batch.commit();
  }

  let moved = 0;
  await db.runTransaction(async (transaction) => {
    const [folderSnapshot, remaining] = await Promise.all([
      transaction.get(folderQuery(db, context.workspace_id)),
      transaction.get(mediaIn(id).limit(1)),
    ]);
    const current = folderSnapshot.docs.map(serializeInstagramMediaFolder);
    if (!current.some((folder) => folder.id === id)) policyError("FOLDER_NOT_FOUND");
    if (!remaining.empty) {
      throw new AppError({
        code: "INSTAGRAM_MEDIA_FOLDER_BUSY",
        kind: "CONFLICT",
        safeMessage: "Chegaram arquivos novos nesta pasta. Tente excluir novamente.",
        reportable: false,
      });
    }

    const working = current.filter((folder) => folder.id !== id);
    const now = Timestamp.now();
    for (const child of current.filter((folder) => folder.parentId === id)) {
      const name = uniqueFolderName(working, destination, child.name, child.id);
      const index = working.findIndex((folder) => folder.id === child.id);
      working[index] = { ...child, name, parentId: destination };
      transaction.update(db.collection(FOLDERS).doc(child.id), {
        name,
        parentId: destination,
        updatedAt: now,
        updatedBy: actor,
      });
      moved += 1;
    }
    transaction.delete(db.collection(FOLDERS).doc(id));
  });
  return { movedFolders: moved };
}

/** Move até 50 arquivos da biblioteca para uma pasta (ou para a raiz). */
export async function moveInstagramMedia(
  context: ServerUserContext,
  input: { ids: string[]; folderId: string | null },
) {
  const db = marketingDbAdmin;
  const actor = actorOf(context);
  await db.runTransaction(async (transaction) => {
    const refs = input.ids.map((mediaId) => db.collection(MEDIA).doc(mediaId));
    const [targetFolder, docs] = await Promise.all([
      input.folderId === null ? Promise.resolve(null) : transaction.get(db.collection(FOLDERS).doc(input.folderId)),
      transaction.getAll(...refs),
    ]);
    if (targetFolder && (!targetFolder.exists || targetFolder.data()?.workspace_id !== context.workspace_id)) {
      policyError("PARENT_NOT_FOUND");
    }
    for (const doc of docs) {
      if (!doc.exists || doc.data()?.workspace_id !== context.workspace_id) {
        throw new AppError({
          code: "INSTAGRAM_LIBRARY_MEDIA_NOT_FOUND",
          kind: "NOT_FOUND",
          safeMessage: "Mídia não encontrada.",
          reportable: false,
        });
      }
    }
    const now = Timestamp.now();
    for (const ref of refs) {
      transaction.update(ref, { folderId: input.folderId, updatedAt: now, updatedBy: actor });
    }
  });
  return { moved: input.ids.length };
}
