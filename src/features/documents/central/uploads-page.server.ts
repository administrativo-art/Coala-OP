import { FieldPath } from "firebase-admin/firestore";
import { hrDbAdmin } from "@/lib/firebase-rh-admin";
import { serializeHrValue } from "@/features/hr/lib/server-access";
import type { ServerUserContext } from "@/lib/auth-server";
import { uploadAccessFilter } from "./upload-access.server";
import { decodeUploadCursor, encodeUploadCursor } from "./pagination";
import { hasFormalizationPermission } from "@/lib/hr-formalization-permissions";

/** One bounded batch/item page; advance even if every record is denied or already filed. */
export async function documentUploadsPage(actor: ServerUserContext, limit: number, cursor?: string) {
  const position = decodeUploadCursor(cursor);
  const team = actor.permissions.dp?.collaborators?.ownProfileOnly !== true && (actor.isDefaultAdmin || actor.permissions.dp?.collaborators?.edit === true || hasFormalizationPermission(actor.permissions, "view", actor.isDefaultAdmin));
  let batches: FirebaseFirestore.Query = hrDbAdmin.collection("documentUploadBatches");
  if (!team) batches = batches.where("createdBy", "==", actor.decoded.uid);
  batches = batches.orderBy(FieldPath.documentId());
  if (position) batches = position.item ? batches.startAt(position.batch) : batches.startAfter(position.batch);
  const batchPage = await batches.limit(2).get();
  const batch = batchPage.docs[0];
  if (!batch) return { records: [], nextCursor: undefined };
  let items = hrDbAdmin.collection("documentUploadItems").where("batchId", "==", batch.id).orderBy(FieldPath.documentId());
  if (position?.item && batch.id === position.batch) items = items.startAfter(position.item);
  const page = await items.limit(limit + 1).get();
  const canRead = await uploadAccessFilter(actor);
  const records: Array<Record<string, unknown> & { id: string }> = page.docs.slice(0, limit).map((doc) => ({ ...(serializeHrValue(doc.data()) as Record<string, unknown>), id: doc.id }));
  const allowed = await Promise.all(records.map(canRead));
  const nextCursor = page.size > limit
    ? encodeUploadCursor({ batch: batch.id, item: page.docs[limit - 1].id })
    : batchPage.size > 1 ? encodeUploadCursor({ batch: batch.id }) : undefined;
  return { records: records.filter((_, index) => allowed[index]), nextCursor };
}
