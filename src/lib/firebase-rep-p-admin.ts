import { getFirestore } from "firebase-admin/firestore";

import { adminApp } from "./firebase-admin";

export const REP_P_FIRESTORE_DATABASE_ID = process.env.REP_P_FIRESTORE_DATABASE_ID?.trim() || "coala-rep-p";
export const repPDbAdmin = getFirestore(adminApp, REP_P_FIRESTORE_DATABASE_ID);
