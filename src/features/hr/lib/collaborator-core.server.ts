import { dbAdmin } from "@/lib/firebase-admin";
import { hrDbAdmin } from "@/lib/firebase-rh-admin";
import { shiftDefinitionMatchesUnit } from "@/lib/dp-shift-definitions";

type AnyRecord = Record<string, unknown>;

function hasOwn(record: AnyRecord, key: string) {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function asString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asBoolean(value: unknown) {
  return typeof value === "boolean" ? value : null;
}

function asNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.replace(",", "."));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function asStringArray(value: unknown) {
  if (Array.isArray(value)) {
    return Array.from(
      new Set(
        value
          .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
          .map(entry => entry.trim())
      )
    );
  }
  const single = asString(value);
  return single ? [single] : [];
}

function stripUndefined<T extends AnyRecord>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as Partial<T>;
}

export type CollaboratorCoreInput = {
  jobRoleId?: unknown;
  functionId?: unknown;
  jobFunctionIds?: unknown;
  unitId?: unknown;
  unitIds?: unknown;
  assignedKioskIds?: unknown;
  responsibleUnitIds?: unknown;
  shiftDefinitionId?: unknown;
  operational?: unknown;
  operacional?: unknown;
  participatesInGoals?: unknown;
  loginRestrictionEnabled?: unknown;
  needsTransportVoucher?: unknown;
  transportVoucherValue?: unknown;
  jobRoleProfileSyncDisabled?: unknown;
};

export type CollaboratorCoreOptions = {
  currentUser?: AnyRecord;
  protectedUser?: boolean;
  syncProfile?: boolean;
};

export type CollaboratorCoreResult = {
  userPatch: AnyRecord;
  role: { id: string; name: string | null; defaultProfileId: string | null } | null;
  functions: Array<{ id: string; name: string; defaultProfileId: string | null }>;
  effectiveProfileId: string | null;
  unitIds: string[];
};

export async function resolveCollaboratorCore(
  input: CollaboratorCoreInput,
  options: CollaboratorCoreOptions = {}
): Promise<CollaboratorCoreResult> {
  const data = input as AnyRecord;
  const currentUser = options.currentUser ?? {};
  const syncProfile = options.syncProfile !== false;
  const jobRoleId = asString(data.jobRoleId) ?? asString(currentUser.jobRoleId);
  const jobFunctionIds = asStringArray(data.jobFunctionIds).length > 0
    ? asStringArray(data.jobFunctionIds)
    : asStringArray(data.functionId).length > 0
      ? asStringArray(data.functionId)
      : asStringArray(currentUser.jobFunctionIds);

  const unitIds = asStringArray(data.unitIds).length > 0
    ? asStringArray(data.unitIds)
    : asStringArray(data.assignedKioskIds).length > 0
      ? asStringArray(data.assignedKioskIds)
      : asStringArray(data.unitId).length > 0
        ? asStringArray(data.unitId)
        : asStringArray(currentUser.unitIds).length > 0
          ? asStringArray(currentUser.unitIds)
          : asStringArray(currentUser.assignedKioskIds);

  const [roleDoc, functionDocs, shiftDefinitionDoc] = await Promise.all([
    jobRoleId ? hrDbAdmin.collection("jobRoles").doc(jobRoleId).get() : Promise.resolve(null),
    Promise.all(jobFunctionIds.map((id) => hrDbAdmin.collection("jobFunctions").doc(id).get())),
    asString(data.shiftDefinitionId)
      ? dbAdmin.collection("dp_shiftDefinitions").doc(asString(data.shiftDefinitionId)!).get()
      : Promise.resolve(null),
  ]);

  if (jobRoleId && !roleDoc?.exists) {
    throw new Error("Cargo não encontrado.");
  }

  const roleData = roleDoc?.data?.() ?? {};
  const role = roleDoc?.exists
    ? {
        id: roleDoc.id,
        name: asString(roleData.name) ?? asString(roleData.publicTitle),
        defaultProfileId: asString(roleData.defaultProfileId),
      }
    : null;

  const functions = functionDocs.map((doc) => {
    if (!doc.exists) {
      throw new Error("Função não encontrada.");
    }
    const functionData = doc.data() ?? {};
    const compatibleRoleIds = asStringArray(functionData.compatibleRoleIds);
    if (jobRoleId && compatibleRoleIds.length > 0 && !compatibleRoleIds.includes(jobRoleId)) {
      throw new Error("A função selecionada não está vinculada ao cargo escolhido.");
    }
    return {
      id: doc.id,
      name: asString(functionData.name) ?? asString(functionData.publicTitle) ?? doc.id,
      defaultProfileId: asString(functionData.defaultProfileId),
    };
  });

  const shiftDefinitionId = asString(data.shiftDefinitionId);
  if (shiftDefinitionId && !shiftDefinitionDoc?.exists) {
    throw new Error("Turno não encontrado.");
  }
  if (
    shiftDefinitionId &&
    shiftDefinitionDoc?.exists &&
    unitIds.length > 0 &&
    !unitIds.some((unitId) => shiftDefinitionMatchesUnit(shiftDefinitionDoc.data(), unitId))
  ) {
    throw new Error("O turno selecionado não pertence à unidade escolhida.");
  }

  const profileSyncDisabled = hasOwn(data, "jobRoleProfileSyncDisabled")
    ? asBoolean(data.jobRoleProfileSyncDisabled) ?? false
    : currentUser.jobRoleProfileSyncDisabled === true;
  const functionProfileId = functions.find((item) => item.defaultProfileId)?.defaultProfileId ?? null;
  const effectiveProfileId = functionProfileId ?? role?.defaultProfileId ?? null;
  const shouldSyncProfile = syncProfile && !options.protectedUser && !profileSyncDisabled && !!effectiveProfileId;

  const operationalValue = hasOwn(data, "operational")
    ? asBoolean(data.operational)
    : hasOwn(data, "operacional")
      ? asBoolean(data.operacional)
      : null;
  const needsTransportVoucher = hasOwn(data, "needsTransportVoucher")
    ? asBoolean(data.needsTransportVoucher) ?? false
    : null;

  const patch = stripUndefined({
    ...(role ? { jobRoleId: role.id, jobRoleName: role.name ?? "" } : {}),
    ...(functions.length > 0 ? {
      jobFunctionIds: functions.map((item) => item.id),
      jobFunctionNames: functions.map((item) => item.name),
    } : {}),
    ...(hasOwn(data, "responsibleUnitIds") ? { responsibleUnitIds: asStringArray(data.responsibleUnitIds) } : {}),
    ...(unitIds.length > 0 ? { unitIds, assignedKioskIds: unitIds } : {}),
    ...(hasOwn(data, "shiftDefinitionId") ? { shiftDefinitionId: shiftDefinitionId ?? null } : {}),
    ...(operationalValue !== null ? { operacional: operationalValue } : {}),
    ...(hasOwn(data, "participatesInGoals") ? { participatesInGoals: asBoolean(data.participatesInGoals) ?? false } : {}),
    ...(hasOwn(data, "loginRestrictionEnabled") ? { loginRestrictionEnabled: asBoolean(data.loginRestrictionEnabled) ?? false } : {}),
    ...(needsTransportVoucher !== null ? {
      needsTransportVoucher,
      transportVoucherValue: needsTransportVoucher ? asNumber(data.transportVoucherValue) ?? null : null,
    } : {}),
    ...(hasOwn(data, "jobRoleProfileSyncDisabled") ? { jobRoleProfileSyncDisabled: profileSyncDisabled } : {}),
    ...(shouldSyncProfile ? { profileId: effectiveProfileId } : {}),
  });

  return {
    userPatch: patch,
    role,
    functions,
    effectiveProfileId,
    unitIds,
  };
}
