import { NextRequest } from "next/server";
import { type DecodedIdToken } from "firebase-admin/auth";

import {
  type PermissionSet,
} from "@/types";
import { dbAdmin } from "@/lib/firebase-admin";
import { requireUser } from "@/lib/auth-server";

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
  let lookupError: string | null = null;
  let context;

  try {
    context = await requireUser(req);
  } catch (error) {
    lookupError =
      error instanceof Error ? error.message : "Falha ao validar acesso ao RH.";
    throw new Error(lookupError);
  }

  const { decoded, permissions, isDefaultAdmin, profileId } = context;
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
