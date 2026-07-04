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

function clonePermissionSet(value: PermissionSet | undefined, label: string): PermissionSet {
  if (!value) {
    throw new Error(`${label} não está definido. Verifique o export em @/types.`);
  }

  return structuredClone(value) as PermissionSet;
}

function applyCommercialPermissionFallbacks(permissions: PermissionSet) {
  const legacyCanViewSheets = permissions.dashboard?.technicalSheets === true;
  const legacyCanEditSheets = permissions.pricing?.simulate === true;

  permissions.commercial.technicalSheets.view ||= legacyCanViewSheets;
  permissions.commercial.technicalSheets.create ||= legacyCanEditSheets;
  permissions.commercial.technicalSheets.edit ||= legacyCanEditSheets;
  permissions.commercial.technicalSheets.delete ||= legacyCanEditSheets;
  permissions.commercial.technicalSheets.export ||= legacyCanViewSheets || legacyCanEditSheets;
}

function applyFormsPermissionFallbacks(permissions: PermissionSet) {
  const canViewAnalytics = permissions.forms.global.view_analytics === true;
  const canManageForms =
    permissions.forms.global.manage_templates === true ||
    permissions.forms.global.create_projects === true;

  permissions.forms.analytics.view ||= canViewAnalytics || canManageForms;
  permissions.forms.analytics.view_occurrences ||= canViewAnalytics;
  permissions.forms.analytics.manage_taxonomy ||= canManageForms;
  permissions.forms.analytics.configure_templates ||= canManageForms;
  permissions.forms.analytics.manage_task_rules ||= canManageForms;
}

export function buildPermissionSet(
  profilePermissions: Partial<PermissionSet> | undefined,
  isDefaultAdmin: boolean
) {
  if (isDefaultAdmin) {
    return clonePermissionSet(defaultAdminPermissions, "defaultAdminPermissions");
  }

  const merged = clonePermissionSet(defaultGuestPermissions, "defaultGuestPermissions");

  if (profilePermissions) {
    mergeRecursive(
      merged as unknown as Record<string, unknown>,
      profilePermissions as Record<string, unknown>
    );
  }

  applyCommercialPermissionFallbacks(merged);
  applyFormsPermissionFallbacks(merged);

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
  const isTokenDefaultAdmin = decoded.isDefaultAdmin === true;
  const profileId =
    typeof userData.profileId === "string" && userData.profileId
      ? userData.profileId
      : typeof decoded.profileId === "string" && decoded.profileId
        ? decoded.profileId
        : null;

  let profilePermissions: Partial<PermissionSet> | undefined;
  let isProfileDefaultAdmin = false;

  if (profileId) {
    const profileSnap = await dbAdmin.collection("profiles").doc(profileId).get();
    const profileData = profileSnap.data();
    if (profileData) {
      profilePermissions = profileData.permissions as Partial<PermissionSet> | undefined;
      isProfileDefaultAdmin = profileData.isDefaultAdmin === true;
    }
  }

  const isDefaultAdmin = isTokenDefaultAdmin || isProfileDefaultAdmin;

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
