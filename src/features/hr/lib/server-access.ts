import { NextRequest } from "next/server";
import { type DecodedIdToken } from "firebase-admin/auth";

import {
  defaultAdminPermissions,
  defaultGuestPermissions,
  type PermissionSet,
} from "@/types";
import { dbAdmin } from "@/lib/firebase-admin";
import { verifyAuth } from "@/lib/verify-auth";

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

function buildPermissions(
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

function canViewHr(permissions: PermissionSet, isDefaultAdmin: boolean) {
  return (
    isDefaultAdmin ||
    permissions.dp.view ||
    permissions.dp.collaborators.view ||
    permissions.dp.collaborators.edit ||
    permissions.settings.manageUsers
  );
}

function canManageHrCatalog(permissions: PermissionSet, isDefaultAdmin: boolean) {
  return (
    isDefaultAdmin ||
    permissions.dp.collaborators.edit ||
    permissions.settings.manageUsers
  );
}

export function serializeHrValue(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(serializeHrValue);
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
        serializeHrValue(entry),
      ])
    );
  }
  return value;
}

export type HrAccess = {
  decoded: DecodedIdToken;
  isDefaultAdmin: boolean;
  profileId: string | null;
  permissions: PermissionSet;
  canView: boolean;
  canManageCatalog: boolean;
  lookupError: string | null;
};

export async function assertHrAccess(
  req: NextRequest,
  mode: "view" | "manage" = "view"
): Promise<HrAccess> {
  const decoded = await verifyAuth(req);
  const isDefaultAdmin = decoded.isDefaultAdmin === true;

  let profileId =
    typeof decoded.profileId === "string" && decoded.profileId
      ? decoded.profileId
      : null;
  let profilePermissions: Partial<PermissionSet> | undefined;
  let lookupError: string | null = null;

  if (!isDefaultAdmin) {
    try {
      if (!profileId && decoded.uid) {
        const userSnap = await dbAdmin.collection("users").doc(decoded.uid).get();
        const userData = userSnap.data() ?? {};
        profileId =
          typeof userData.profileId === "string" && userData.profileId
            ? userData.profileId
            : null;
      }

      if (profileId) {
        const profileSnap = await dbAdmin.collection("profiles").doc(profileId).get();
        profilePermissions = profileSnap.data()?.permissions as
          | Partial<PermissionSet>
          | undefined;
      }
    } catch (error) {
      lookupError =
        error instanceof Error ? error.message : "Falha ao validar acesso ao RH.";
    }
  }

  const permissions = buildPermissions(profilePermissions, isDefaultAdmin);
  const access: HrAccess = {
    decoded,
    isDefaultAdmin,
    profileId,
    permissions,
    canView: canViewHr(permissions, isDefaultAdmin),
    canManageCatalog: canManageHrCatalog(permissions, isDefaultAdmin),
    lookupError,
  };

  if (mode === "view" && !access.canView) {
    throw new Error(access.lookupError ?? "Sem permissão para acessar o RH.");
  }

  if (mode === "manage" && !access.canManageCatalog) {
    throw new Error(
      access.lookupError ?? "Sem permissão para gerenciar cargos e funções."
    );
  }

  return access;
}
