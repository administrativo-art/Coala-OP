import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { verifyAuth } from "@/lib/verify-auth";
import { authAdmin, dbAdmin } from "@/lib/firebase-admin";
import { financialDbAdmin } from "@/lib/firebase-financial-admin";
import {
  defaultAdminPermissions,
  defaultGuestPermissions,
  type PermissionSet,
} from "@/types";

function mergeRecursive(target: Record<string, unknown>, source: Record<string, unknown>) {
  Object.entries(source).forEach(([key, value]) => {
    const current = target[key];
    if (
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      current &&
      typeof current === "object" &&
      !Array.isArray(current)
    ) {
      mergeRecursive(current as Record<string, unknown>, value as Record<string, unknown>);
      return;
    }
    target[key] = value;
  });
}

function buildPermissions(
  profilePermissions: Partial<PermissionSet> | undefined,
  isDefaultAdmin: boolean
) {
  if (isDefaultAdmin) {
    return defaultAdminPermissions.financial;
  }

  const merged = JSON.parse(JSON.stringify(defaultGuestPermissions)) as PermissionSet;
  if (profilePermissions) {
    mergeRecursive(
      merged as unknown as Record<string, unknown>,
      profilePermissions as Record<string, unknown>
    );
  }
  return merged.financial;
}

function serializeValue(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(serializeValue);
  if (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { toDate?: () => Date }).toDate === "function"
  ) {
    return (value as { toDate: () => Date }).toDate().toISOString();
  }
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
        key,
        serializeValue(entry),
      ])
    );
  }
  return value;
}

function sameJsonShape(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export async function POST(request: NextRequest) {
  try {
    const decoded = await verifyAuth(request);
    if (!decoded.uid) {
      return NextResponse.json({ error: "Usuário inválido." }, { status: 401 });
    }

    const isDefaultAdmin = decoded.isDefaultAdmin === true;
    let userData: Record<string, unknown> = {};
    let profileId =
      typeof decoded.profileId === "string" && decoded.profileId
        ? decoded.profileId
        : null;
    let profilePermissions: Partial<PermissionSet> | undefined;
    let userLookupStatus: "synced" | "failed" = "failed";

    try {
      const userSnap = await dbAdmin.collection("users").doc(decoded.uid).get();
      if (userSnap.exists) {
        userData = userSnap.data() ?? {};
        profileId =
          profileId ||
          (typeof userData.profileId === "string" && userData.profileId
            ? userData.profileId
            : null);
      }

      if (profileId) {
        const profileSnap = await dbAdmin.collection("profiles").doc(profileId).get();
        profilePermissions = profileSnap.data()?.permissions as Partial<PermissionSet> | undefined;
      }

      userLookupStatus = "synced";
    } catch (lookupError) {
      console.warn("[Financial bootstrap] Failed to read OP user/profile context.", lookupError);
    }

    const tokenFinancialPermissions =
      decoded.financial &&
      typeof decoded.financial === "object" &&
      !Array.isArray(decoded.financial)
        ? (decoded.financial as Record<string, unknown>)
        : null;

    const financialPermissions =
      profilePermissions || isDefaultAdmin
        ? buildPermissions(profilePermissions, isDefaultAdmin)
        : tokenFinancialPermissions;

    const payload = {
      username:
        (typeof userData.username === "string" && userData.username) ||
        (typeof decoded.name === "string" && decoded.name) ||
        (typeof decoded.email === "string" && decoded.email.split("@")[0]) ||
        "Usuário",
      email:
        (typeof userData.email === "string" && userData.email) ||
        (typeof decoded.email === "string" ? decoded.email : null),
      profileId,
      globalUserId: decoded.uid,
      active: true,
      isDefaultAdmin,
      permissions: financialPermissions ?? null,
      syncedAt: FieldValue.serverTimestamp(),
    };

    let claimsSynced: "already-present" | "updated" | "failed" = "failed";
    if (financialPermissions) {
      try {
        const authUser = await authAdmin.getUser(decoded.uid);
        const currentClaims = authUser.customClaims ?? {};
        const nextClaims = {
          ...currentClaims,
          financial: financialPermissions,
        };

        claimsSynced = sameJsonShape(currentClaims.financial ?? null, financialPermissions)
          ? "already-present"
          : "updated";

        if (claimsSynced === "updated") {
          await authAdmin.setCustomUserClaims(decoded.uid, nextClaims);
        }
      } catch (claimsError) {
        console.warn("[Financial bootstrap] Failed to sync financial claims.", claimsError);
      }
    }

    let userDocSynced = false;
    let savedData: Record<string, unknown> = payload;

    if (financialPermissions) {
      try {
        await financialDbAdmin.collection("users").doc(decoded.uid).set(payload, { merge: true });
        const saved = await financialDbAdmin.collection("users").doc(decoded.uid).get();
        savedData = (serializeValue(saved.data() ?? {}) as Record<string, unknown>) ?? payload;
        userDocSynced = true;
      } catch (syncError) {
        console.warn("[Financial bootstrap] Failed to sync financial user document.", syncError);
        savedData = serializeValue({
          ...payload,
          syncedAt: new Date().toISOString(),
        }) as Record<string, unknown>;
      }
    }

    return NextResponse.json({
      user: {
        id: decoded.uid,
        ...savedData,
      },
      userLookupStatus,
      claimsSynced,
      userDocSynced,
    });
  } catch (error: unknown) {
    console.error("[Financial bootstrap] Failed to sync financial user.", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Erro ao sincronizar o módulo financeiro.",
      },
      { status: 500 }
    );
  }
}
