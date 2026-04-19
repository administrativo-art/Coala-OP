import { getFirestore } from "firebase-admin/firestore";
import { adminApp } from "./firebase-admin";

export const financialDbAdmin = getFirestore(adminApp, "coala-financeiro");
