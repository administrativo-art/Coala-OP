import { getFirestore } from "firebase-admin/firestore";

import { adminApp } from "./firebase-admin";

export const MARKETING_FIRESTORE_DATABASE_ID = "coala-signage";
export const marketingDbAdmin = getFirestore(adminApp, MARKETING_FIRESTORE_DATABASE_ID);

export const LEGACY_MARKETING_FIRESTORE_DATABASE_ID = "coala";
export const legacyMarketingDbAdmin = getFirestore(adminApp, LEGACY_MARKETING_FIRESTORE_DATABASE_ID);

export function shouldReadLegacyMarketingDatabase() {
  return process.env.NODE_ENV !== "production"
    || process.env.INSTAGRAM_MARKETING_ENABLE_LEGACY_READS === "true";
}
