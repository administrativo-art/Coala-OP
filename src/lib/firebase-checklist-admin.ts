import { getFirestore } from "firebase-admin/firestore";

import { adminApp } from "./firebase-admin";

export const checklistDbAdmin = getFirestore(adminApp, "coala-checklist");
