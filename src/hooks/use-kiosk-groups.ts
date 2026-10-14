"use client";

import { useMemo } from 'react';

import { useKiosks } from '@/hooks/use-kiosks';
import { useDPStore } from '@/store/use-dp-store';
import { listKioskGroups, mapKioskGroups, NO_GROUP_ID, NO_GROUP_NAME } from '@/lib/goals-groups';

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
