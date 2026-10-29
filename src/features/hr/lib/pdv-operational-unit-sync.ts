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

function normalizeExternalUserId(value: unknown) {
  const normalized = typeof value === "number" && Number.isSafeInteger(value)
    ? String(value)
    : cleanText(value);
  return normalized && /^\d+$/.test(normalized) ? normalized : null;
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
    const externalUserId = normalizeExternalUserId(row.externalUserId);
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

  const operationalUnits = operationalUnitIds(user);
  const assignedKioskIds = stringArray(user.assignedKioskIds);
  const legacyOperatorIds = user.pdvOperatorIds && typeof user.pdvOperatorIds === "object" && !Array.isArray(user.pdvOperatorIds)
    ? Object.entries(user.pdvOperatorIds as Record<string, unknown>).flatMap(([kioskId, value]) => {
        const id = normalizeExternalUserId(value);
        if (!id) return [];
        const assignedIndex = assignedKioskIds.indexOf(kioskId);
        const unitId = operationalUnits.includes(kioskId)
          ? kioskId
          : operationalUnits.length === 1 && assignedKioskIds.length === 1
            ? operationalUnits[0]
            : assignedKioskIds.length === operationalUnits.length && assignedIndex >= 0
              ? operationalUnits[assignedIndex] ?? null
              : null;
        return [{
          externalUserId: id,
          unitId,
          unitName: null,
          filialId: "",
          filialName: null,
          profileId: "",
          profileName: null,
          status: "active" as const,
          updatedAt: null,
        } satisfies UserPdvAccess];
      })
    : [];
  if (legacyOperatorIds.length > 0) return legacyOperatorIds;

  const legacyExternalUserId = normalizeExternalUserId(user.registrationIdPdv);
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
    }
  | {
      kind: "remove";
      sourceExternalUserId: string;
      sourceUnitId: string | null;
      targetUnitId: null;
      profileId: null;
    };

export type PdvOperationalUnitSyncOptions = {
  /** Unidades vinculadas a uma filial do PDV; as demais (ex.: CD) não têm acesso a sincronizar. */
  pdvUnitIds?: ReadonlySet<string>;
};

/** Acesso ao PDV ligado no cadastro; sem decisão gravada, vale "Sim" para quem já tem acesso ativo. */
export function pdvAccessEnabled(user: RecordLike) {
  if (typeof user.pdvAccessEnabled === "boolean") return user.pdvAccessEnabled;
  return hasActivePdvAccess(user);
}

export function hasActivePdvAccess(user: RecordLike) {
  return storedPdvAccesses(user).some((access) => access.status === "active")
    || Boolean(normalizeExternalUserId(user.registrationIdPdv));
}

/**
 * A conta do PDV aceita uma filial por usuário. Cada unidade da vigência com
 * filial recebe um acesso: a troca de uma unidade por outra move o acesso, uma
 * inclusão clona o acesso existente (preservando o perfil) e uma saída remove o
 * acesso daquela unidade. Só as unidades alteradas são tocadas; acessos que já
 * divergiam da vigência ficam para conferência humana. Quando não dá para
 * identificar qual acesso pertence à unidade removida, a alteração é bloqueada.
 */
export function planPdvOperationalUnitSyncs(
  currentUser: RecordLike,
  nextUser: RecordLike,
  options: PdvOperationalUnitSyncOptions = {},
): PdvOperationalUnitSyncPlan[] {
  const inScope = (unitId: string) => !options.pdvUnitIds || options.pdvUnitIds.has(unitId);
  const currentUnits = operationalUnitIds(currentUser).filter(inScope);
  const nextUnits = operationalUnitIds(nextUser).filter(inScope);
  const removed = currentUnits.filter((unitId) => !nextUnits.includes(unitId));
  const added = nextUnits.filter((unitId) => !currentUnits.includes(unitId));
  if (removed.length === 0 && added.length === 0) return [];

  const accesses = storedPdvAccesses(currentUser).filter((access) => access.status === "active");
  const legacyExternalUserId = normalizeExternalUserId(currentUser.registrationIdPdv);
  const hasPdvAccess = accesses.length > 0 || Boolean(legacyExternalUserId);
  if (!hasPdvAccess) return [];

  if (removed.length !== 1 || added.length !== 1) {
    if (removed.length > 0) return planMultipleUnitChanges(currentUser, accesses, legacyExternalUserId, removed, added);
  }

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

function planMultipleUnitChanges(
  currentUser: RecordLike,
  accesses: UserPdvAccess[],
  legacyExternalUserId: string | null,
  removed: string[],
  added: string[],
): PdvOperationalUnitSyncPlan[] {
  const removedSources = removed.flatMap((unitId) => {
    const atUnit = accesses.filter((access) => access.unitId === unitId);
    if (atUnit.length > 1) {
      throw new PdvOperationalUnitSyncError(
        "Há mais de um acesso do PDV Legal relacionado à mesma unidade. Ajuste os acessos individualmente.",
      );
    }
    return atUnit.length ? [{ unitId, access: atUnit[0] }] : [];
  });
  const unidentified = accesses.some((access) => !access.unitId)
    || Boolean(legacyExternalUserId && !accesses.some((access) => access.externalUserId === legacyExternalUserId));
  if (removedSources.length < removed.length && unidentified) {
    throw new PdvOperationalUnitSyncError(
      "Não foi possível identificar qual acesso do PDV Legal pertence à unidade removida. Ajuste os acessos individualmente.",
    );
  }

  const plans: PdvOperationalUnitSyncPlan[] = [];
  const pairs = Math.min(removedSources.length, added.length);
  for (let index = 0; index < pairs; index++) {
    const { unitId, access } = removedSources[index];
    plans.push({
      kind: "move",
      sourceExternalUserId: access.externalUserId,
      sourceUnitId: unitId,
      targetUnitId: added[index],
      profileId: cleanText(access.profileId) ?? cleanText(currentUser.pdvAccessProfileId),
    });
  }
  const leaving = new Set(removedSources.slice(pairs).map(({ access }) => access.externalUserId));
  const source = accesses.find((access) => access.externalUserId === legacyExternalUserId && !leaving.has(access.externalUserId))
    ?? accesses.find((access) => !leaving.has(access.externalUserId))
    ?? null;
  for (const targetUnitId of added.slice(pairs)) {
    const sourceExternalUserId = source?.externalUserId ?? legacyExternalUserId;
    if (!sourceExternalUserId) {
      throw new PdvOperationalUnitSyncError(
        "Não foi possível identificar o acesso principal do PDV Legal para criar o acesso da nova unidade.",
      );
    }
    plans.push({
      kind: "add",
      sourceExternalUserId,
      sourceUnitId: null,
      targetUnitId,
      profileId: cleanText(source?.profileId) ?? cleanText(currentUser.pdvAccessProfileId),
    });
  }
  // Remoções por último: as inclusões ainda podem clonar o perfil de um acesso que vai sair.
  for (const { unitId, access } of removedSources.slice(pairs)) {
    plans.push({ kind: "remove", sourceExternalUserId: access.externalUserId, sourceUnitId: unitId, targetUnitId: null, profileId: null });
  }
  return plans;
}

/** Desligar o acesso ao PDV remove todos os acessos ativos da pessoa, inclusive o registro legado. */
export function planPdvAccessRevocation(currentUser: RecordLike): PdvOperationalUnitSyncPlan[] {
  const ids = new Map<string, string | null>();
  for (const access of storedPdvAccesses(currentUser)) {
    if (access.status === "active") ids.set(access.externalUserId, access.unitId ?? null);
  }
  const legacyExternalUserId = normalizeExternalUserId(currentUser.registrationIdPdv);
  if (legacyExternalUserId && !ids.has(legacyExternalUserId)) ids.set(legacyExternalUserId, null);
  return [...ids].map(([sourceExternalUserId, sourceUnitId]) => ({
    kind: "remove",
    sourceExternalUserId,
    sourceUnitId,
    targetUnitId: null,
    profileId: null,
  }));
}

/** Marca o acesso removido como inativo (o ID fica no histórico) e reaponta o acesso principal. */
export function pdvRemovalPatch(params: { currentUser: RecordLike; externalUserId: string; updatedAt: string }) {
  const currentAccesses = storedPdvAccesses(params.currentUser);
  const pdvAccesses = currentAccesses.some((access) => access.externalUserId === params.externalUserId)
    ? currentAccesses.map((access) => access.externalUserId === params.externalUserId
      ? { ...access, status: "inactive" as const, updatedAt: params.updatedAt }
      : access)
    : currentAccesses;
  const legacyId = normalizeExternalUserId(params.currentUser.registrationIdPdv);
  if (legacyId !== params.externalUserId) return { pdvAccesses };
  const next = pdvAccesses.find((access) => access.status === "active") ?? null;
  return {
    pdvAccesses,
    registrationIdPdv: next?.externalUserId ?? null,
    pdvAccessFilialId: next?.filialId || null,
    pdvAccessFilialName: next?.filialName ?? null,
    pdvAccessProfileId: next?.profileId || null,
    pdvAccessProfileName: next?.profileName ?? null,
  };
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
  const plan = params.plan;
  if (plan.kind === "remove") throw new PdvOperationalUnitSyncError("A remoção de acesso usa pdvRemovalPatch.");

  const currentAccesses = storedPdvAccesses(params.currentUser);
  const previous = plan.kind === "move"
    ? currentAccesses.find((access) => access.externalUserId === plan.sourceExternalUserId)
    : currentAccesses.find((access) =>
        access.unitId === plan.targetUnitId || access.externalUserId === params.externalUserId
      ) ?? null;
  const updatedAccess: UserPdvAccess = {
    externalUserId: params.externalUserId,
    unitId: plan.targetUnitId,
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
  const legacyId = normalizeExternalUserId(params.currentUser.registrationIdPdv);
  const establishesPrimaryAccess = !legacyId
    && plan.kind === "add"
    && currentAccesses.length === 1
    && currentAccesses[0]?.externalUserId === plan.sourceExternalUserId;
  const updatesPrimaryAccess = plan.kind === "move" && (
    !legacyId || legacyId === plan.sourceExternalUserId || pdvAccesses.length === 1
  );

  return {
    pdvAccesses,
    ...(establishesPrimaryAccess ? { registrationIdPdv: plan.sourceExternalUserId } : {}),
    ...(updatesPrimaryAccess ? {
      registrationIdPdv: params.externalUserId,
      pdvAccessFilialId: params.targetFilialId,
      pdvAccessFilialName: params.targetFilialName,
      pdvAccessProfileId: params.confirmedProfileId,
      pdvAccessProfileName: updatedAccess.profileName,
    } : {}),
  };
}

/** Acessos do PDV do cadastro (inclui os legados por quiosque), para exibição. */
export { storedPdvAccesses as listPdvAccesses };
