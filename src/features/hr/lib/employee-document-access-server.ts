import type { HrAccess } from "@/features/hr/lib/server-access";
import { dbAdmin } from "@/lib/firebase-admin";
import { hrDbAdmin } from "@/lib/firebase-rh-admin";
import { canAccessUserByUnit } from "@/lib/unit-access";
import { isOwnHrEmployeeId } from "@/lib/hr/person-link";
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

type UnitScopedAccess = Pick<HrAccess, "decoded" | "isDefaultAdmin" | "userDoc">;

export async function assertEmployeeUnitAccess(access: UnitScopedAccess, employeeId: string) {
  const normalizedEmployeeId = employeeId.trim();
  if (!normalizedEmployeeId) throw new Error("Colaborador não informado.");
  if (
    normalizedEmployeeId === access.decoded.uid ||
    isOwnHrEmployeeId(access.userDoc, normalizedEmployeeId)
  ) return;

  let employeeSnap = await dbAdmin.collection("users").doc(normalizedEmployeeId).get();
  if (!employeeSnap.exists) {
    const byHrEmployee = await dbAdmin.collection("users")
      .where("hrEmployeeId", "==", normalizedEmployeeId)
      .limit(2)
      .get();
    if (byHrEmployee.size > 1) throw new Error("Vínculo pessoal ambíguo.");
    if (!byHrEmployee.empty) employeeSnap = byHrEmployee.docs[0];
  }
  if (!employeeSnap.exists) {
    const byBizneo = await dbAdmin.collection("users")
      .where("registrationIdBizneo", "==", normalizedEmployeeId)
      .limit(2)
      .get();
    if (byBizneo.size > 1) throw new Error("Vínculo pessoal ambíguo.");
    if (!byBizneo.empty) employeeSnap = byBizneo.docs[0];
  }
  if (!employeeSnap.exists) throw new Error("Colaborador não encontrado.");

  if (!canAccessUserByUnit(
    access.userDoc,
    employeeSnap.data() ?? {},
    { isDefaultAdmin: access.isDefaultAdmin },
  )) {
    throw new Error("Você não possui acesso à unidade deste colaborador.");
  }
}

export async function loadVisibleEmployeeIds(access: HrAccess) {
  const directorySnap = await dbAdmin.collection("users").get();
  return new Set(directorySnap.docs
    .filter((employeeSnap) =>
      employeeSnap.id === access.userDoc.id ||
      employeeSnap.id === access.decoded.uid ||
      canAccessUserByUnit(
        access.userDoc,
        employeeSnap.data() ?? {},
        { isDefaultAdmin: access.isDefaultAdmin },
      )
    )
    .map((employeeSnap) => employeeSnap.id));
}

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
