import { dbAdmin } from "@/lib/firebase-admin";
import {
  defaultAdminPermissions,
  defaultGuestPermissions,
  type PermissionSet,
} from "@/types";

type DecodedLike = {
  uid?: string;
  profileId?: unknown;
  isDefaultAdmin?: unknown;
  financial?: unknown;
};

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

export function serializeFinancialValue(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(serializeFinancialValue);
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
        serializeFinancialValue(entry),
      ])
    );
  }
  return value;
}

export async function resolveFinancialPermissions(decoded: DecodedLike) {
  const isDefaultAdmin = decoded.isDefaultAdmin === true;
  let profileId =
    typeof decoded.profileId === "string" && decoded.profileId
      ? decoded.profileId
      : null;
  let profilePermissions: Partial<PermissionSet> | undefined;
  let userLookupStatus: "synced" | "failed" = "failed";
  let lookupError: string | null = null;

  try {
    if (!decoded.uid) {
      throw new Error("Usuário inválido.");
    }

    const userSnap = await dbAdmin.collection("users").doc(decoded.uid).get();
    const userData = userSnap.data() ?? {};
    profileId =
      profileId ||
      (typeof userData.profileId === "string" && userData.profileId
        ? userData.profileId
        : null);

    if (profileId) {
      const profileSnap = await dbAdmin.collection("profiles").doc(profileId).get();
      profilePermissions = profileSnap.data()?.permissions as Partial<PermissionSet> | undefined;
    }

    userLookupStatus = "synced";
  } catch (error) {
    lookupError = error instanceof Error ? error.message : "Falha ao ler permissões do OP.";
  }

  const tokenFinancialPermissions =
    decoded.financial &&
    typeof decoded.financial === "object" &&
    !Array.isArray(decoded.financial)
      ? (decoded.financial as PermissionSet["financial"])
      : null;

  const permissions =
    profilePermissions || isDefaultAdmin
      ? buildPermissions(profilePermissions, isDefaultAdmin)
      : tokenFinancialPermissions;

  return {
    isDefaultAdmin,
    profileId,
    permissions: permissions ?? null,
    userLookupStatus,
    lookupError,
  };
}

function topLevelCollection(path: string) {
  return path.split("/").filter(Boolean)[0] ?? null;
}

export function canReadFinancialPath(
  path: string,
  permissions: PermissionSet["financial"] | null,
  isDefaultAdmin: boolean
) {
  if (isDefaultAdmin) return true;
  if (!permissions?.view) return false;

  switch (topLevelCollection(path)) {
    case "accountPlans":
    case "resultCenters":
    case "bankAccounts":
      return permissions.view;
    case "importAliases":
    case "importDrafts":
      return permissions.expenses.import || permissions.settings.manageImportAliases;
    case "expenses":
      return (
        permissions.expenses.view ||
        permissions.dashboard ||
        permissions.financialFlow ||
        permissions.dre
      );
    case "payments":
      return (
        permissions.expenses.view ||
        permissions.cashFlow.view ||
        permissions.financialFlow ||
        permissions.dre
      );
    case "transactions":
      return (
        permissions.cashFlow.view ||
        permissions.financialFlow ||
        permissions.dre ||
        permissions.dashboard
      );
    case "users":
      return false;
    default:
      return false;
  }
}
