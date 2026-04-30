import { type DecodedIdToken } from "firebase-admin/auth";
import { type NextRequest } from "next/server";

import {
  defaultAdminPermissions,
  defaultGuestPermissions,
  type PermissionSet,
  type User,
} from "@/types";
import { dbAdmin } from "@/lib/firebase-admin";
import { verifyAuth } from "@/lib/verify-auth";
import { WORKSPACE_ID } from "@/lib/workspace";

function mergeRecursive(
  target: Record<string, unknown>,
  source: Record<string, unknown>
) {
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
      mergeRecursive(
        current as Record<string, unknown>,
        value as Record<string, unknown>
      );
      return;
    }

    target[key] = value;
  });
}

export function buildPermissionSet(
  profilePermissions: Partial<PermissionSet> | undefined,
  isDefaultAdmin: boolean
) {
  if (isDefaultAdmin) {
    return defaultAdminPermissions;
  }

  const merged = JSON.parse(
    JSON.stringify(defaultGuestPermissions)
  ) as PermissionSet;

  if (profilePermissions) {
    mergeRecursive(
      merged as unknown as Record<string, unknown>,
      profilePermissions as Record<string, unknown>
    );
  }

  return merged;
}

export type ServerUserContext = {
  decoded: DecodedIdToken;
  userDoc: User;
  profileId: string | null;
  permissions: PermissionSet;
  isDefaultAdmin: boolean;
  workspace_id: string;
};

export async function requireUser(req: NextRequest): Promise<ServerUserContext> {
  const decoded = await verifyAuth(req);
  if (!decoded.uid) {
    throw new Error("Usuário inválido.");
  }

  const userSnap = await dbAdmin.collection("users").doc(decoded.uid).get();
  if (!userSnap.exists) {
    throw new Error("Usuário não encontrado.");
  }

  const userData = userSnap.data() ?? {};
  const isDefaultAdmin = decoded.isDefaultAdmin === true;
  const profileId =
    typeof decoded.profileId === "string" && decoded.profileId
      ? decoded.profileId
      : typeof userData.profileId === "string" && userData.profileId
        ? userData.profileId
        : null;

  let profilePermissions: Partial<PermissionSet> | undefined;
  if (!isDefaultAdmin && profileId) {
    const profileSnap = await dbAdmin.collection("profiles").doc(profileId).get();
    profilePermissions = profileSnap.data()?.permissions as
      | Partial<PermissionSet>
      | undefined;
  }

  return {
    decoded,
    userDoc: {
      id: userSnap.id,
      ...(userData as Omit<User, "id">),
    },
    profileId,
    permissions: buildPermissionSet(profilePermissions, isDefaultAdmin),
    isDefaultAdmin,
    workspace_id: WORKSPACE_ID,
  };
}
