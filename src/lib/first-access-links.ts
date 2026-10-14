import { createHash, randomBytes, randomUUID } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";

import { authAdmin, dbAdmin } from "@/lib/firebase-admin";
import { hrDbAdmin } from "@/lib/firebase-rh-admin";
import { maybeAdvanceAfterFirstAccess } from "@/lib/hr/onboarding-access-provisioning";
import { reportSystemError } from "@/lib/observability/reporter";
import {
  replaceOnboardingIntegrationAlert,
  resolvedPdvOnboardingAlert,
} from "@/lib/hr/onboarding-integrations";
import { createPdvLegalUser } from "@/lib/integrations/pdv-legal-admin";

const FIRST_ACCESS_COLLECTION = "firstAccessLinks";
const FIRST_ACCESS_TTL_DAYS = 2;
const FIRST_ACCESS_CONSUMPTION_LEASE_MS = 5 * 60 * 1000;

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

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function firstAccessFailure(
  token: Record<string, unknown>,
  user: Record<string, unknown>,
  now: number,
) {
  const expiresAt = typeof token.expiresAt === "string" ? token.expiresAt : null;
  if (typeof token.userId !== "string" || !token.userId) return "invalid" as const;
  if (typeof token.usedAt === "string" && token.usedAt) return "used" as const;
  if (typeof token.revokedAt === "string" && token.revokedAt) return "revoked" as const;
  if (!expiresAt || new Date(expiresAt).getTime() <= now) return "expired" as const;
  if (user.isActive === false) return "inactive" as const;
  const consumption = recordValue(token.consumption);
  const leaseExpiresAt = typeof consumption.leaseExpiresAt === "string"
    ? new Date(consumption.leaseExpiresAt).getTime()
    : 0;
  if (consumption.state === "reserved" && leaseExpiresAt > now) return "in_progress" as const;
  return null;
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
  const userId = typeof data.userId === "string" ? data.userId : "";
  const onboardingId = typeof data.onboardingId === "string" ? data.onboardingId : null;
  if (!userId) return { ok: false as const, reason: "invalid" as const };
  const userSnap = await dbAdmin.collection("users").doc(userId).get();
  if (!userSnap.exists) return { ok: false as const, reason: "invalid" as const };
  const user = userSnap.data() ?? {};
  const failure = firstAccessFailure(data, user, Date.now());
  if (failure) return { ok: false as const, reason: failure };
  const expiresAt = data.expiresAt as string;
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

async function reserveFirstAccessLink(token: string) {
  const tokenHash = hashToken(token);
  const tokenRef = dbAdmin.collection(FIRST_ACCESS_COLLECTION).doc(tokenHash);
  const attemptId = randomUUID();
  const reservedAt = nowIso();
  const leaseExpiresAt = new Date(Date.now() + FIRST_ACCESS_CONSUMPTION_LEASE_MS).toISOString();

  return dbAdmin.runTransaction(async (transaction) => {
    const tokenSnap = await transaction.get(tokenRef);
    if (!tokenSnap.exists) return { ok: false as const, reason: "not_found" as const };
    const tokenData = tokenSnap.data() ?? {};
    const userId = typeof tokenData.userId === "string" ? tokenData.userId : "";
    if (!userId) return { ok: false as const, reason: "invalid" as const };
    const userRef = dbAdmin.collection("users").doc(userId);
    const userSnap = await transaction.get(userRef);
    if (!userSnap.exists) return { ok: false as const, reason: "invalid" as const };
    const userData = userSnap.data() ?? {};
    const failure = firstAccessFailure(tokenData, userData, Date.now());
    if (failure) return { ok: false as const, reason: failure };

    transaction.set(tokenRef, {
      consumption: { state: "reserved", attemptId, reservedAt, leaseExpiresAt },
    }, { merge: true });
    return {
      ok: true as const,
      attemptId,
      tokenRef,
      userRef,
      userId,
      onboardingId: typeof tokenData.onboardingId === "string" ? tokenData.onboardingId : null,
      expiresAt: tokenData.expiresAt as string,
      email: typeof userData.email === "string" ? userData.email : null,
      username: typeof userData.username === "string" ? userData.username : null,
    };
  });
}

async function releaseFirstAccessReservation(
  tokenRef: FirebaseFirestore.DocumentReference,
  attemptId: string,
) {
  await dbAdmin.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(tokenRef);
    const consumption = recordValue(snapshot.data()?.consumption);
    if (consumption.attemptId !== attemptId || snapshot.get("usedAt")) return;
    transaction.set(tokenRef, { consumption: FieldValue.delete() }, { merge: true });
  });
}

async function finalizeFirstAccessReservation(
  reservation: Extract<Awaited<ReturnType<typeof reserveFirstAccessLink>>, { ok: true }>,
) {
  const usedAt = nowIso();
  await dbAdmin.runTransaction(async (transaction) => {
    const [tokenSnap, userSnap] = await Promise.all([
      transaction.get(reservation.tokenRef),
      transaction.get(reservation.userRef),
    ]);
    const consumption = recordValue(tokenSnap.data()?.consumption);
    if (consumption.attemptId !== reservation.attemptId || consumption.state !== "reserved") {
      throw new Error("Reserva do primeiro acesso não pertence a esta operação.");
    }
    if (!userSnap.exists || userSnap.get("isActive") === false) {
      throw new Error("Conta inativa durante o primeiro acesso.");
    }
    transaction.set(reservation.tokenRef, {
      usedAt,
      consumedByAttemptId: reservation.attemptId,
      consumption: FieldValue.delete(),
    }, { merge: true });
    transaction.set(reservation.userRef, {
      mustChangePassword: false,
      passwordChangedAt: FieldValue.serverTimestamp(),
      firstAccess: {
        status: "used",
        usedAt,
        expiresAt: reservation.expiresAt,
      },
      updatedAt: usedAt,
    }, { merge: true });
  });
  return usedAt;
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
      dbAdmin.collection("users").doc(status.userId).set({
        registrationIdPdv: created.id,
        pdvAccessProfileId: profileId,
        pdvAccessProfileName: typeof pdv.profileName === "string" ? pdv.profileName : null,
        pdvAccessFilialId: filialId,
        pdvAccessFilialName: typeof pdv.filialName === "string" ? pdv.filialName : null,
        pdvAccesses: [{
          externalUserId: created.id,
          unitId: typeof pdv.unitId === "string" ? pdv.unitId : null,
          unitName: typeof pdv.unitName === "string" ? pdv.unitName : null,
          filialId,
          filialName: typeof pdv.filialName === "string" ? pdv.filialName : null,
          profileId,
          profileName: typeof pdv.profileName === "string" ? pdv.profileName : null,
          status: "active",
          updatedAt: provisionedAt,
        }],
        updatedAt: provisionedAt,
      }, { merge: true }),
      onboardingRef.set({
        pdvAccess: { ...pdv, status: "completed", userId: created.id, provisionedAt, lastError: null },
        integrationAlerts: replaceOnboardingIntegrationAlert(onboarding.integrationAlerts, resolvedPdvOnboardingAlert({
          externalId: created.id,
          filialName: pdv.filialName,
          checkedAt: provisionedAt,
          source: "onboarding_first_access",
          action: "created",
        })),
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
  const reservation = await reserveFirstAccessLink(token);
  if (!reservation.ok) return reservation;

  try {
    await authAdmin.updateUser(reservation.userId, { password });
  } catch (error) {
    await releaseFirstAccessReservation(reservation.tokenRef, reservation.attemptId).catch(() => undefined);
    throw error;
  }

  const usedAt = await finalizeFirstAccessReservation(reservation);
  if (reservation.onboardingId) {
    try {
      await hrDbAdmin.collection("onboardingProcesses").doc(reservation.onboardingId).set({
        firstAccess: {
          status: "used",
          usedAt,
          expiresAt: reservation.expiresAt,
        },
        updatedAt: usedAt,
      }, { merge: true });
      await maybeAdvanceAfterFirstAccess(reservation.onboardingId);
    } catch (error) {
      reportSystemError({
        error,
        code: "FIRST_ACCESS_ONBOARDING_PROJECTION_FAILED",
        kind: "UNEXPECTED_APPLICATION",
        source: "first-access",
        operation: "project-onboarding-after-consumption",
        routeOrJob: "/api/auth/first-access/[token]",
      });
    }
  }

  return {
    ok: true as const,
    email: reservation.email,
    username: reservation.username,
  };
}
