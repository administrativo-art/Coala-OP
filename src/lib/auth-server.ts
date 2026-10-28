import { type DecodedIdToken } from "firebase-admin/auth";
import { type DocumentData, type DocumentSnapshot } from "firebase-admin/firestore";
import { type NextRequest } from "next/server";

import {
  defaultAdminPermissions,
  defaultGuestPermissions,
  type PermissionSet,
  type User,
} from "@/types";
import { applyLegacyFormalizationFallbacks } from "@/lib/hr-formalization-permissions";
import { dbAdmin } from "@/lib/firebase-admin";
import { verifyAuthWithUser } from "@/lib/verify-auth";
import { WORKSPACE_ID } from "@/lib/workspace";
import { requiresProfileCompliance } from "@/features/hr/profile-compliance-access.server";
import { isDeveloperViewAsEmail, isDeveloperViewAsReadMethod } from "@/features/auth/developer-view-as";
import { requestedDeveloperViewAsUserId } from "@/features/auth/developer-view-as.server";
import { resolveAuthenticatedEmail } from "@/features/auth/authenticated-email";

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
    const permissions = clonePermissionSet(defaultAdminPermissions, "defaultAdminPermissions");
    permissions.dp.timeRecording!.readLocation = profilePermissions?.dp?.timeRecording?.readLocation === true;
    return permissions;
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
  applyLegacyFormalizationFallbacks(merged, profilePermissions);

  return merged;
}

export type ServerUserContext = {
  decoded: DecodedIdToken;
  userDoc: User;
  profileId: string | null;
  permissions: PermissionSet;
  isDefaultAdmin: boolean;
  workspace_id: string;
  authenticatedActor?: {
    uid: string;
    email: string | null;
    username: string;
  };
  viewAs?: {
    targetUserId: string;
    targetUsername: string;
    readOnly: true;
  } | null;
};

async function buildServerUserContext(
  decoded: DecodedIdToken,
  userSnap: DocumentSnapshot<DocumentData>,
  request: NextRequest,
  authenticatedActor?: NonNullable<ServerUserContext["authenticatedActor"]>,
  options: { enforceProfileCompliance?: boolean } = {},
): Promise<ServerUserContext> {
  if (!decoded.uid) {
    throw new Error("Usuário inválido.");
  }

  const userData = userSnap.data() ?? {};
  if (userData.isActive === false) {
    throw new Error("Conta inativa.");
  }
  if (options.enforceProfileCompliance !== false && requiresProfileCompliance(userData, request)) {
    throw new Error("Atualização cadastral obrigatória pendente.");
  }
  const isTokenDefaultAdmin = decoded.isDefaultAdmin === true;
  const profileId =
    typeof userData.profileId === "string" && userData.profileId
      ? userData.profileId
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

  // O perfil atual é autoritativo. Um token emitido com perfil não pode recuperar
  // permissões/administração quando sua atribuição foi removida do cadastro.
  const tokenHadProfile = typeof decoded.profileId === "string" && Boolean(decoded.profileId);
  const isDefaultAdmin = profileId ? isProfileDefaultAdmin : !tokenHadProfile && isTokenDefaultAdmin;
  const userDoc = {
    id: userSnap.id,
    ...(userData as Omit<User, "id">),
  };
  const actualActor = authenticatedActor ?? {
    uid: decoded.uid,
    email: resolveAuthenticatedEmail(decoded.email, userDoc.email),
    username: userDoc.username || decoded.name || "Usuário",
  };

  return {
    decoded,
    userDoc,
    profileId,
    permissions: buildPermissionSet(profilePermissions, isDefaultAdmin),
    isDefaultAdmin,
    workspace_id: WORKSPACE_ID,
    authenticatedActor: actualActor,
    viewAs: null,
  };
}

/** Identidade real do token, sem aplicar a visualização de suporte. */
export async function requireAuthenticatedUser(req: NextRequest): Promise<ServerUserContext> {
  const { decoded, userSnap } = await verifyAuthWithUser(req, { enforceProfileCompliance: false });
  return buildServerUserContext(decoded, userSnap, req);
}

/** UID que deve ser usado em controles ligados ao token/aparelho, não ao usuário visualizado. */
export function authenticatedActorId(context: ServerUserContext) {
  return authenticatedActorIdentity(context).uid;
}

export function authenticatedActorIdentity(context: ServerUserContext) {
  return context.authenticatedActor ?? {
    uid: context.decoded.uid,
    email: resolveAuthenticatedEmail(context.decoded.email, context.userDoc.email),
    username: context.userDoc.username || context.decoded.name || "Usuário",
  };
}

export async function requireUser(req: NextRequest): Promise<ServerUserContext> {
  const authenticated = await requireAuthenticatedUser(req);
  const targetUserId = requestedDeveloperViewAsUserId(req);
  if (!targetUserId || targetUserId === authenticated.userDoc.id) return authenticated;

  const realActor = authenticatedActorIdentity(authenticated);
  const actorEmail = realActor.email ?? authenticated.decoded.email;
  if (!isDeveloperViewAsEmail(actorEmail)) {
    return authenticated;
  }

  if (!isDeveloperViewAsReadMethod(req.method)) {
    throw new Error("O modo Visualizar como é somente leitura. Volte ao seu perfil para alterar dados.");
  }

  const targetSnap = await dbAdmin.collection("users").doc(targetUserId).get();
  if (!targetSnap.exists || targetSnap.get("isActive") === false) {
    throw new Error("Usuário selecionado não está disponível.");
  }
  const targetData = targetSnap.data() ?? {};
  const targetProfileId = typeof targetData.profileId === "string" && targetData.profileId
    ? targetData.profileId
    : null;
  const effectiveDecoded = {
    ...authenticated.decoded,
    uid: targetSnap.id,
    email: typeof targetData.email === "string" ? targetData.email : undefined,
    name: typeof targetData.username === "string" ? targetData.username : undefined,
    profileId: targetProfileId ?? undefined,
    isDefaultAdmin: false,
  } as DecodedIdToken;
  const effective = await buildServerUserContext(
    effectiveDecoded,
    targetSnap,
    req,
    realActor,
    { enforceProfileCompliance: false },
  );

  return {
    ...effective,
    viewAs: {
      targetUserId: targetSnap.id,
      targetUsername: effective.userDoc.username,
      readOnly: true,
    },
  };
}
