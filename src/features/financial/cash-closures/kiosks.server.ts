import "server-only";

import { FieldPath } from "firebase-admin/firestore";

import { dbAdmin } from "@/lib/firebase-admin";

const KIOSK_PAGE_SIZE = 100;
const MAX_OPERATIONAL_KIOSKS = 1_000;

export async function listCashClosureKioskDocuments() {
  const documents: FirebaseFirestore.QueryDocumentSnapshot[] = [];
  let cursor: string | null = null;
  while (documents.length <= MAX_OPERATIONAL_KIOSKS) {
    const remaining = MAX_OPERATIONAL_KIOSKS + 1 - documents.length;
    let query: FirebaseFirestore.Query = dbAdmin.collection("kiosks")
      .orderBy(FieldPath.documentId())
      .limit(Math.min(KIOSK_PAGE_SIZE, remaining));
    if (cursor) query = query.startAfter(cursor);
    const snapshot = await query.get();
    documents.push(...snapshot.docs);
    if (snapshot.empty || snapshot.size < Math.min(KIOSK_PAGE_SIZE, remaining)) break;
    cursor = snapshot.docs.at(-1)?.id ?? null;
    if (!cursor) break;
  }
  if (documents.length > MAX_OPERATIONAL_KIOSKS) {
    throw new Error("A quantidade de unidades ultrapassa o limite operacional do fechamento de caixa.");
  }
  return documents;
}
