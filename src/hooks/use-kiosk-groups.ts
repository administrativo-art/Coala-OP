"use client";

import { useMemo } from 'react';

import { useKiosks } from '@/hooks/use-kiosks';
import { useDPStore } from '@/store/use-dp-store';
import { listKioskGroups, mapKioskGroups, mapKioskOrganizations, NO_GROUP_ID, NO_GROUP_NAME, NO_ORGANIZATION_NAME } from '@/lib/goals-groups';

/** Grupos de unidades (DP) aplicados aos quiosques, para filtrar e agrupar telas de metas. */
export function useKioskGroups() {
  const { kiosks } = useKiosks();
  const { units, unitGroups } = useDPStore();

  return useMemo(() => {
    const byKiosk = mapKioskGroups(kiosks, units, unitGroups);
    const groups = listKioskGroups(byKiosk);
    return {
      groups,
      groupOf: (kioskId: string) => byKiosk.get(kioskId) ?? { id: NO_GROUP_ID, name: NO_GROUP_NAME },
      /** Só um grupo (ou nenhum): filtros por grupo não agregam nada. */
      hasMultipleGroups: groups.length > 1,
    };
  }, [kiosks, units, unitGroups]);
}

/** Organizações (DP) aplicadas aos quiosques, com a mesma forma de `useKioskGroups`. */
export function useKioskOrganizations() {
  const { kiosks } = useKiosks();
  const { units, unitGroups, unitOrganizations } = useDPStore();

  return useMemo(() => {
    const byKiosk = mapKioskOrganizations(kiosks, units, unitGroups, unitOrganizations);
    const groups = listKioskGroups(byKiosk);
    return {
      groups,
      groupOf: (kioskId: string) => byKiosk.get(kioskId) ?? { id: NO_GROUP_ID, name: NO_ORGANIZATION_NAME },
      /** Só uma organização (ou nenhuma): o filtro não agrega nada. */
      hasMultipleGroups: groups.length > 1,
    };
  }, [kiosks, units, unitGroups, unitOrganizations]);
}
