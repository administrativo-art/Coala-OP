import {
  collection,
  doc,
  type CollectionReference,
  type DocumentData,
  type DocumentReference,
} from "firebase/firestore";
import { financialDb } from "@/lib/firebase-financial";
import { FINANCIAL_COLLECTIONS, type FinancialCollectionName } from "./constants";

export function financialCollection<T = DocumentData>(
  name: FinancialCollectionName
): CollectionReference<T> {
  return collection(financialDb, name) as CollectionReference<T>;
}

export function financialDoc<T = DocumentData>(
  name: FinancialCollectionName,
  id: string
): DocumentReference<T> {
  return doc(financialDb, name, id) as DocumentReference<T>;
}

export { FINANCIAL_COLLECTIONS };
