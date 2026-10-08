import "server-only";

import { FieldValue } from "firebase-admin/firestore";

import { authAdmin, dbAdmin } from "@/lib/firebase-admin";
import { financialDbAdmin } from "@/lib/firebase-financial-admin";
import { hrDbAdmin } from "@/lib/firebase-rh-admin";

function storedSessionVersion(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

async function writeSessionClaim(userId: string, sessionVersion: number) {
  const user = await authAdmin.getUser(userId);
  await authAdmin.setCustomUserClaims(userId, {
    ...(user.customClaims ?? {}),
    sessionVersion,
  });
}

export async function suspendIdentityAccess(params: {
  userId: string;
  userPatch: Record<string, unknown>;
}) {
  const sessionVersion = await dbAdmin.runTransaction(async (transaction) => {
    const userRef = dbAdmin.collection("users").doc(params.userId);
    const snapshot = await transaction.get(userRef);
    if (!snapshot.exists) throw new Error("Usuário não encontrado.");
    const nextVersion = storedSessionVersion(snapshot.get("sessionVersion")) + 1;
    transaction.set(userRef, {
      ...params.userPatch,
      isActive: false,
      sessionVersion: nextVersion,
    }, { merge: true });
    return nextVersion;
  });

  await Promise.all([
    authAdmin.updateUser(params.userId, { disabled: true }),
    authAdmin.revokeRefreshTokens(params.userId),
    writeSessionClaim(params.userId, sessionVersion),
    hrDbAdmin.collection("rh_access_cache").doc(params.userId).set({
      status: "inactive",
      is_active: false,
      session_version: sessionVersion,
      access_revoked_at: new Date().toISOString(),
      updated_at: FieldValue.serverTimestamp(),
    }, { merge: true }),
    financialDbAdmin.collection("users").doc(params.userId).set({
      active: false,
      sessionVersion,
      syncedAt: FieldValue.serverTimestamp(),
    }, { merge: true }),
  ]);

  return { sessionVersion };
}
