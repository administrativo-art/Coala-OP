export type LocalPurchaseKiosk = {
  id: string;
  name: string;
  structuralUnitId: string;
};

export type LocalPurchaseStructuralUnit = {
  id: string;
  groupId?: string | null;
  organizationId?: string | null;
};

export type LocalPurchaseUnitGroup = {
  id: string;
  name: string;
  organizationId?: string | null;
};

export type LocalPurchaseUnitOrganization = {
  id: string;
  name: string;
};

export type LocalPurchaseUnitRef = {
  id: string;
  name: string;
  groupId?: string;
  groupName?: string;
  organizationId?: string;
  organizationName?: string;
};

/**
 * Adds the DP hierarchy only through the explicit kiosk -> structural-unit key.
 * Missing references stay unclassified instead of being guessed from names.
 */
export function localPurchaseUnitRefs(
  kiosks: LocalPurchaseKiosk[],
  structuralUnits: LocalPurchaseStructuralUnit[],
  groups: LocalPurchaseUnitGroup[],
  organizations: LocalPurchaseUnitOrganization[],
): LocalPurchaseUnitRef[] {
  const unitsById = new Map(structuralUnits.map((unit) => [unit.id, unit]));
  const groupsById = new Map(groups.map((group) => [group.id, group]));
  const organizationsById = new Map(organizations.map((organization) => [organization.id, organization]));

  return kiosks.map((kiosk) => {
    const unit = unitsById.get(kiosk.structuralUnitId);
    const group = unit?.groupId ? groupsById.get(unit.groupId) : undefined;
    const organizationId = unit?.organizationId || group?.organizationId || undefined;
    const organization = organizationId ? organizationsById.get(organizationId) : undefined;
    return {
      id: kiosk.id,
      name: kiosk.name,
      ...(group ? { groupId: group.id, groupName: group.name } : {}),
      ...(organization ? { organizationId: organization.id, organizationName: organization.name } : {}),
    };
  }).sort((left, right) => left.name.localeCompare(right.name, "pt-BR"));
}
