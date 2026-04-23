import { getFirestore } from "firebase-admin/firestore";

import { adminApp } from "./firebase-admin";

export const hrDbAdmin = getFirestore(adminApp, "coala-rh");
