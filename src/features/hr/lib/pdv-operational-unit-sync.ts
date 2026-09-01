import type { UserPdvAccess } from "@/types";

type RecordLike = Record<string, unknown>;

export const PDV_SERVER_MANAGED_USER_FIELDS = [
  "pdvAccesses",
  "pdvAccessProfileId",
  "pdvAccessProfileName",
  "pdvAccessFilialId",
  "pdvAccessFilialName",
] as const;

function cleanText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function stringArray(value: unknown) {
  return Array.isArray(value)
    ? Array.from(new Set(value.flatMap((entry) => {
        const text = cleanText(entry);
        return text ? [text] : [];
      })))
    : [];
}

export function operationalUnitIds(user: RecordLike) {
  const unitIds = stringArray(user.unitIds);
  return unitIds.length > 0 ? unitIds : stringArray(user.assignedKioskIds);
}

export function sameOperationalUnits(left: RecordLike, right: RecordLike) {
  const leftIds = [...operationalUnitIds(left)].sort();
  const rightIds = [...operationalUnitIds(right)].sort();
  return JSON.stringify(leftIds) === JSON.stringify(rightIds);
}

function storedPdvAccesses(user: RecordLike): UserPdvAccess[] {
  const stored = Array.isArray(user.pdvAccesses) ? user.pdvAccesses.flatMap((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return [];
    const row = value as RecordLike;
    const externalUserId = cleanText(row.externalUserId);
    if (!externalUserId) return [];
    const status = row.status === "inactive" || row.status === "error" ? row.status : "active";
    return [{
      externalUserId,
      unitId: cleanText(row.unitId),
      unitName: cleanText(row.unitName),
      filialId: cleanText(row.filialId) ?? "",
      filialName: cleanText(row.filialName),
      profileId: cleanText(row.profileId) ?? "",
      profileName: cleanText(row.profileName),
      status,
      updatedAt: cleanText(row.updatedAt),
    } satisfies UserPdvAccess];
  }) : [];
  if (stored.length > 0) return stored;

  const legacyExternalUserId = cleanText(user.registrationIdPdv);
  if (!legacyExternalUserId) return [];
  return [{
    externalUserId: legacyExternalUserId,
    unitId: operationalUnitIds(user)[0] ?? null,
    unitName: null,
    filialId: cleanText(user.pdvAccessFilialId) ?? "",
    filialName: cleanText(user.pdvAccessFilialName),
    profileId: cleanText(user.pdvAccessProfileId) ?? "",
    profileName: cleanText(user.pdvAccessProfileName),
    status: "active",
    updatedAt: null,
  }];
}

export class PdvOperationalUnitSyncError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PdvOperationalUnitSyncError";
  }
}

export type PdvOperationalUnitSyncPlan =
  | {
      kind: "move";
      sourceExternalUserId: string;
      sourceUnitId: string;
      targetUnitId: string;
      profileId: string | null;
    }
  | {
      kind: "add";
      sourceExternalUserId: string;
      sourceUnitId: null;
      targetUnitId: string;
      profileId: string | null;
    };

/**
 * A conta do PDV aceita uma filial por usuário. A movimentação automática só é
 * segura quando a alteração representa uma troca inequívoca de uma unidade por
 * outra. Inclusões adicionais não movem a conta existente; remoções e mudanças
 * múltiplas que afetem um acesso ativo exigem tratamento explícito.
 */
export function planPdvOperationalUnitSyncs(
  currentUser: RecordLike,
  nextUser: RecordLike,
): PdvOperationalUnitSyncPlan[] {
  const currentUnits = operationalUnitIds(currentUser);
  const nextUnits = operationalUnitIds(nextUser);
  const removed = currentUnits.filter((unitId) => !nextUnits.includes(unitId));
  const added = nextUnits.filter((unitId) => !currentUnits.includes(unitId));
  if (removed.length === 0 && added.length === 0) return [];

  const accesses = storedPdvAccesses(currentUser).filter((access) => access.status === "active");
  const legacyExternalUserId = cleanText(currentUser.registrationIdPdv);
  const hasPdvAccess = accesses.length > 0 || Boolean(legacyExternalUserId);
  if (!hasPdvAccess) return [];

  if (removed.length === 0 && added.length > 0) {
    const selected = legacyExternalUserId
      ? accesses.find((access) => access.externalUserId === legacyExternalUserId) ?? null
      : accesses.length === 1 ? accesses[0] : null;
    const sourceExternalUserId = selected?.externalUserId ?? legacyExternalUserId;
    if (!sourceExternalUserId) {
      throw new PdvOperationalUnitSyncError(
        "Não foi possível identificar o acesso principal do PDV Legal para criar o acesso da nova unidade.",
      );
    }
    return added.map((targetUnitId) => ({
      kind: "add",
      sourceExternalUserId,
      sourceUnitId: null,
      targetUnitId,
      profileId: cleanText(selected?.profileId) ?? cleanText(currentUser.pdvAccessProfileId),
    }));
  }

  if (removed.length !== 1 || added.length !== 1) {
    const removedAccess = accesses.some((access) => access.unitId && removed.includes(access.unitId));
    if (removedAccess || (legacyExternalUserId && currentUnits.length === 1 && removed.length === 1)) {
      throw new PdvOperationalUnitSyncError(
        "A alteração afeta um acesso ativo do PDV Legal, mas não é uma troca direta entre duas unidades. Ajuste os acessos do PDV individualmente.",
      );
    }
    return [];
  }

  const [sourceUnitId] = removed;
  const [targetUnitId] = added;
  const accessAtSource = accesses.filter((access) => access.unitId === sourceUnitId);
  if (accessAtSource.length > 1 || (accessAtSource.length === 0 && accesses.length > 1)) {
    throw new PdvOperationalUnitSyncError(
      "Há mais de um acesso do PDV Legal relacionado à unidade atual. Ajuste os acessos individualmente.",
    );
  }
  const selected = accessAtSource[0] ?? accesses[0] ?? null;
  const externalUserId = selected?.externalUserId ?? legacyExternalUserId;
  if (!externalUserId) {
    throw new PdvOperationalUnitSyncError(
      "Não foi possível identificar qual acesso do PDV Legal deve acompanhar a troca de unidade.",
    );
  }

  return [{
    kind: "move",
    sourceExternalUserId: externalUserId,
    sourceUnitId,
    targetUnitId,
    profileId: cleanText(selected?.profileId) ?? cleanText(currentUser.pdvAccessProfileId),
  }];
}

export function pdvOperationalUnitPatch(params: {
  currentUser: RecordLike;
  plan: PdvOperationalUnitSyncPlan;
  externalUserId: string;
  targetUnitName: string;
  targetFilialId: string;
  targetFilialName: string;
  confirmedProfileId: string;
  updatedAt: string;
}) {
  const currentAccesses = storedPdvAccesses(params.currentUser);
  const previous = params.plan.kind === "move"
    ? currentAccesses.find((access) => access.externalUserId === params.plan.sourceExternalUserId)
    : currentAccesses.find((access) =>
        access.unitId === params.plan.targetUnitId || access.externalUserId === params.externalUserId
      ) ?? null;
  const updatedAccess: UserPdvAccess = {
    externalUserId: params.externalUserId,
    unitId: params.plan.targetUnitId,
    unitName: params.targetUnitName,
    filialId: params.targetFilialId,
    filialName: params.targetFilialName,
    profileId: params.confirmedProfileId,
    profileName: previous?.profileName ?? cleanText(params.currentUser.pdvAccessProfileName),
    status: "active",
    updatedAt: params.updatedAt,
  };
  const previousExternalUserId = previous?.externalUserId;
  const pdvAccesses = previous
    ? currentAccesses.map((access) => access.externalUserId === previousExternalUserId ? updatedAccess : access)
    : [...currentAccesses, updatedAccess];
  const legacyId = cleanText(params.currentUser.registrationIdPdv);
  const updatesPrimaryAccess = params.plan.kind === "move" && (
    !legacyId || legacyId === params.plan.sourceExternalUserId || pdvAccesses.length === 1
  );

  return {
    pdvAccesses,
    ...(updatesPrimaryAccess ? {
      registrationIdPdv: params.externalUserId,
      pdvAccessFilialId: params.targetFilialId,
      pdvAccessFilialName: params.targetFilialName,
      pdvAccessProfileId: params.confirmedProfileId,
      pdvAccessProfileName: updatedAccess.profileName,
    } : {}),
  };
}
