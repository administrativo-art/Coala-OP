import type { HrAccess } from "@/features/hr/lib/server-access";
import { hrDbAdmin } from "@/lib/firebase-rh-admin";
import {
  normalizeDocumentVisibilityConfig,
  subjectFromPermissions,
  type DocumentAccessSubject,
} from "@/lib/hr/employee-document-access";
import {
  normalizeProfileAccessMatrix,
  type DocumentVisibilityConfig,
  type ProfileAccessMatrix,
  type RhAccessCache,
  type RhRole,
} from "@/types/rh";

function cleanIds(values: unknown[]) {
  return Array.from(new Set(values.flatMap((value) =>
    Array.isArray(value) ? value : [value]
  ).map((value) => typeof value === "string" ? value.trim() : "").filter(Boolean)));
}

export type EmployeeDocumentAccessSettings = {
  accessMatrix: ProfileAccessMatrix;
  visibilityConfig: DocumentVisibilityConfig;
  role: RhRole;
  userId: string;
  roleIds: string[];
  functionIds: string[];
};

export async function loadEmployeeDocumentAccessSettings(access: HrAccess): Promise<EmployeeDocumentAccessSettings> {
  const [fieldMapSnap, cacheSnap] = await Promise.all([
    hrDbAdmin.collection("schema").doc("field_map").get(),
    hrDbAdmin.collection("rh_access_cache").doc(access.decoded.uid).get(),
  ]);
  const fieldMap = fieldMapSnap.data() ?? {};
  const cache = (cacheSnap.data() ?? {}) as Partial<RhAccessCache>;
  const role: RhRole = access.isDefaultAdmin || access.permissions.settings?.manageUsers
    ? "admin"
    : access.permissions.dp?.rh_role === "admin" || access.permissions.dp?.rh_role === "manager"
      ? access.permissions.dp.rh_role
      : access.permissions.dp?.collaborators?.edit
        ? "manager"
        : "employee";
  return {
    accessMatrix: normalizeProfileAccessMatrix(fieldMap.access_matrix),
    visibilityConfig: normalizeDocumentVisibilityConfig(fieldMap.document_visibility),
    role,
    userId: access.decoded.uid,
    roleIds: cleanIds([cache.job_role_id, cache.job_role_ids, cache.role_ids]),
    functionIds: cleanIds([cache.job_function_id, cache.job_function_ids, cache.function_ids]),
  };
}

export function buildEmployeeDocumentAccessSubject(
  access: HrAccess,
  settings: EmployeeDocumentAccessSettings,
  employeeId: string,
): DocumentAccessSubject {
  return {
    ...subjectFromPermissions(access.permissions, {
      isDefaultAdmin: access.isDefaultAdmin,
      isOwner: employeeId === access.decoded.uid || employeeId === access.userDoc.id,
    }),
    profileRole: settings.role,
    accessMatrix: settings.accessMatrix,
    visibilityContext: {
      userId: settings.userId,
      roleIds: settings.roleIds,
      functionIds: settings.functionIds,
    },
  };
}
