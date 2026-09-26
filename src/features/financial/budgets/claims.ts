import { BudgetDomainError } from "./errors";

/** One existing month_account/account document is the lock for ALL scopes. */
export type BudgetClaim = {
  budgetId?: string;
  ruleId?: string;
  globalOwnerId?: string | null;
  centerOwners?: Record<string, string>;
  version?: number;
};

export function claimOwners(claim: BudgetClaim | undefined) {
  return {
    globalOwnerId: claim?.globalOwnerId || claim?.budgetId || claim?.ruleId || null,
    centerOwners: { ...claim?.centerOwners },
  };
}

export function claimConflicts(claim: BudgetClaim | undefined, centerId?: string | null, ownerId?: string) {
  const { globalOwnerId, centerOwners } = claimOwners(claim);
  return Boolean(globalOwnerId && globalOwnerId !== ownerId)
    || (centerId ? Boolean(centerOwners[centerId] && centerOwners[centerId] !== ownerId)
      : Object.values(centerOwners).some((owner) => owner !== ownerId));
}

export function changeBudgetClaim(claim: BudgetClaim | undefined, centerId: string | null | undefined, ownerId: string, acquire: boolean): BudgetClaim | null {
  if (acquire && claimConflicts(claim, centerId, ownerId)) {
    throw new BudgetDomainError("Já existe orçamento ou regra sobreposta para esta conta e centro.");
  }
  const owners = claimOwners(claim);
  if (centerId) {
    if (acquire) {
      if (!owners.centerOwners[centerId] && Object.keys(owners.centerOwners).length >= 200) {
        throw new BudgetDomainError("Limite de 200 centros por conta atingido.");
      }
      owners.centerOwners[centerId] = ownerId;
    } else if (owners.centerOwners[centerId] === ownerId) delete owners.centerOwners[centerId];
  } else if (acquire) owners.globalOwnerId = ownerId;
  else if (owners.globalOwnerId === ownerId) owners.globalOwnerId = null;
  return owners.globalOwnerId || Object.keys(owners.centerOwners).length ? { version: 2, ...owners } : null;
}
