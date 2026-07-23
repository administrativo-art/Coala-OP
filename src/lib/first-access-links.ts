import { createHash, randomBytes } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";

import { authAdmin, dbAdmin } from "@/lib/firebase-admin";
import { hrDbAdmin } from "@/lib/firebase-rh-admin";
import { maybeAdvanceAfterFirstAccess } from "@/lib/hr/onboarding-access-provisioning";
import { createPdvLegalUser } from "@/lib/integrations/pdv-legal-admin";

const FIRST_ACCESS_COLLECTION = "firstAccessLinks";
const FIRST_ACCESS_TTL_DAYS = 2;

function nowIso() {
  return new Date().toISOString();
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function makeToken() {
  return randomBytes(32).toString("base64url");
}

function buildUrl(baseUrl: string, token: string) {
  return `${baseUrl.replace(/\/+$/, "")}/primeiro-acesso/${encodeURIComponent(token)}`;
}

export type FirstAccessLinkResult = {
  url: string;
  expiresAt: string;
  tokenId: string;
};

export async function createFirstAccessLink(params: {
  userId: string;
  onboardingId?: string | null;
  baseUrl: string;
  createdBy: string;
  createdByEmail?: string | null;
}): Promise<FirstAccessLinkResult> {
  const createdAt = nowIso();
  const expiresAt = addDays(new Date(createdAt), FIRST_ACCESS_TTL_DAYS).toISOString();
  const token = makeToken();
  const tokenHash = hashToken(token);
  const tokenId = tokenHash.slice(0, 16);
  const userRef = dbAdmin.collection("users").doc(params.userId);
  const userSnap = await userRef.get();
  const userData = userSnap.data() ?? {};
  const currentFirstAccess =
    userData.firstAccess && typeof userData.firstAccess === "object" && !Array.isArray(userData.firstAccess)
      ? userData.firstAccess as Record<string, unknown>
      : {};
  const previousTokenHash = typeof currentFirstAccess.tokenHash === "string"
    ? currentFirstAccess.tokenHash
    : null;

  const batch = dbAdmin.batch();
  if (previousTokenHash) {
    batch.set(
      dbAdmin.collection(FIRST_ACCESS_COLLECTION).doc(previousTokenHash),
      { revokedAt: createdAt, revokedBy: params.createdBy },
      { merge: true }
    );
  }

  batch.set(dbAdmin.collection(FIRST_ACCESS_COLLECTION).doc(tokenHash), {
    tokenId,
    userId: params.userId,
    onboardingId: params.onboardingId ?? null,
    createdAt,
    expiresAt,
    usedAt: null,
    revokedAt: null,
    createdBy: params.createdBy,
    createdByEmail: params.createdByEmail ?? null,
  });

  batch.set(userRef, {
    mustChangePassword: true,
    firstAccess: {
      status: "pending",
      tokenId,
      tokenHash,
      onboardingId: params.onboardingId ?? null,
      createdAt,
      expiresAt,
      usedAt: null,
      createdBy: params.createdBy,
    },
    updatedAt: createdAt,
  }, { merge: true });

  await batch.commit();

  if (params.onboardingId) {
    await hrDbAdmin.collection("onboardingProcesses").doc(params.onboardingId).set({
      firstAccess: {
        status: "pending",
        tokenId,
        createdAt,
        expiresAt,
        usedAt: null,
        createdBy: params.createdBy,
      },
      updatedAt: createdAt,
    }, { merge: true });
  }

  return {
    url: buildUrl(params.baseUrl, token),
    expiresAt,
    tokenId,
  };
}

export async function getFirstAccessLinkStatus(token: string) {
  const tokenHash = hashToken(token);
  const snap = await dbAdmin.collection(FIRST_ACCESS_COLLECTION).doc(tokenHash).get();
  if (!snap.exists) {
    return { ok: false as const, reason: "not_found" as const };
  }

  const data = snap.data() ?? {};
  const expiresAt = typeof data.expiresAt === "string" ? data.expiresAt : null;
  const usedAt = typeof data.usedAt === "string" ? data.usedAt : null;
  const revokedAt = typeof data.revokedAt === "string" ? data.revokedAt : null;
  const userId = typeof data.userId === "string" ? data.userId : "";
  const onboardingId = typeof data.onboardingId === "string" ? data.onboardingId : null;
  const expired = !expiresAt || new Date(expiresAt).getTime() <= Date.now();

  if (!userId) return { ok: false as const, reason: "invalid" as const };
  if (usedAt) return { ok: false as const, reason: "used" as const };
  if (revokedAt) return { ok: false as const, reason: "revoked" as const };
  if (expired) return { ok: false as const, reason: "expired" as const };

  const userSnap = await dbAdmin.collection("users").doc(userId).get();
  const user = userSnap.data() ?? {};
  const onboardingSnap = onboardingId
    ? await hrDbAdmin.collection("onboardingProcesses").doc(onboardingId).get()
    : null;
  const onboarding = onboardingSnap?.data() ?? {};
  const pdvAccess = onboarding.pdvAccess && typeof onboarding.pdvAccess === "object" && !Array.isArray(onboarding.pdvAccess)
    ? onboarding.pdvAccess as Record<string, unknown>
    : {};

  return {
    ok: true as const,
    userId,
    email: typeof user.email === "string" ? user.email : null,
    username: typeof user.username === "string" ? user.username : null,
    expiresAt,
    onboardingId,
    pdvAccess: {
      required: pdvAccess.required === true,
      completed: pdvAccess.status === "completed",
      profileName: typeof pdvAccess.profileName === "string" ? pdvAccess.profileName : null,
      filialName: typeof pdvAccess.filialName === "string" ? pdvAccess.filialName : null,
    },
  };
}

export async function provisionPdvFirstAccess(token: string, password: string) {
  const status = await getFirstAccessLinkStatus(token);
  if (!status.ok) return status;
  if (!status.pdvAccess.required) return { ok: false as const, reason: "pdv_not_required" as const };
  if (status.pdvAccess.completed) return { ok: true as const, alreadyCompleted: true };
  if (!status.onboardingId) return { ok: false as const, reason: "invalid" as const };

  const onboardingRef = hrDbAdmin.collection("onboardingProcesses").doc(status.onboardingId);
  const [onboardingSnap, userSnap] = await Promise.all([
    onboardingRef.get(),
    dbAdmin.collection("users").doc(status.userId).get(),
  ]);
  const onboarding = onboardingSnap.data() ?? {};
  const pdv = onboarding.pdvAccess && typeof onboarding.pdvAccess === "object" && !Array.isArray(onboarding.pdvAccess)
    ? onboarding.pdvAccess as Record<string, unknown>
    : {};
  const filialId = typeof pdv.filialId === "string" ? pdv.filialId : "";
  const profileId = typeof pdv.profileId === "string" ? pdv.profileId : "";
  const name = typeof userSnap.data()?.username === "string" ? userSnap.data()?.username.trim() : "";
  if (!filialId || !profileId || !name) return { ok: false as const, reason: "invalid" as const };

  try {
    const created = await createPdvLegalUser({ name, filialId, profileId, password });
    const provisionedAt = nowIso();
    await Promise.all([
      dbAdmin.collection("users").doc(status.userId).set({ registrationIdPdv: created.id, updatedAt: provisionedAt }, { merge: true }),
      onboardingRef.set({
        pdvAccess: { ...pdv, status: "completed", userId: created.id, provisionedAt, lastError: null },
        updatedAt: provisionedAt,
      }, { merge: true }),
    ]);
    return { ok: true as const, userId: created.id };
  } catch (error) {
    await onboardingRef.set({
      pdvAccess: { ...pdv, status: "failed", lastError: error instanceof Error ? error.message : "Falha ao criar acesso." },
      updatedAt: nowIso(),
    }, { merge: true });
    throw error;
  }
}

export async function consumeFirstAccessLink(token: string, password: string) {
  const status = await getFirstAccessLinkStatus(token);
  if (!status.ok) return status;

  const tokenHash = hashToken(token);
  const tokenRef = dbAdmin.collection(FIRST_ACCESS_COLLECTION).doc(tokenHash);
  const tokenSnap = await tokenRef.get();
  const tokenData = tokenSnap.data() ?? {};
  const onboardingId = typeof tokenData.onboardingId === "string" ? tokenData.onboardingId : null;
  const usedAt = nowIso();

  await authAdmin.updateUser(status.userId, {
    password,
    disabled: false,
  });

  await Promise.all([
    tokenRef.set({ usedAt }, { merge: true }),
    dbAdmin.collection("users").doc(status.userId).set({
      mustChangePassword: false,
      passwordChangedAt: FieldValue.serverTimestamp(),
      firstAccess: {
        status: "used",
        usedAt,
        expiresAt: status.expiresAt,
      },
      updatedAt: usedAt,
    }, { merge: true }),
    onboardingId
      ? hrDbAdmin.collection("onboardingProcesses").doc(onboardingId).set({
          firstAccess: {
            status: "used",
            usedAt,
            expiresAt: status.expiresAt,
          },
          updatedAt: usedAt,
        }, { merge: true })
      : Promise.resolve(),
  ]);

  if (onboardingId) {
    await maybeAdvanceAfterFirstAccess(onboardingId);
  }

  return {
    ok: true as const,
    email: status.email,
    username: status.username,
  };
}
