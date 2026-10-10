import { matchDPUnitForKiosk } from '@/lib/dp-kiosk-match';
import type { DPUnit, DPUnitGroup, Kiosk } from '@/types';

export const NO_GROUP_ID = '__no_group__';
export const NO_GROUP_NAME = 'Sem grupo';

export interface KioskGroup {
  id: string;
  name: string;
  kioskIds: string[];
}

/** Grupo de cada quiosque, pela unidade do DP que corresponde ao quiosque (mesma regra do cadastro de metas). */
export function mapKioskGroups(
  kiosks: Pick<Kiosk, 'id' | 'name'>[],
  units: DPUnit[],
  unitGroups: Pick<DPUnitGroup, 'id' | 'name'>[],
): Map<string, { id: string; name: string }> {
  const groupById = new Map(unitGroups.map(group => [group.id, group]));
  const result = new Map<string, { id: string; name: string }>();
  for (const kiosk of kiosks) {
    const unit = matchDPUnitForKiosk(kiosk.name, units);
    const group = unit?.groupId ? groupById.get(unit.groupId) : undefined;
    result.set(kiosk.id, group ? { id: group.id, name: group.name } : { id: NO_GROUP_ID, name: NO_GROUP_NAME });
  }
  return result;
}

/** Grupos com seus quiosques, em ordem alfabética; "Sem grupo" por último e só se houver quiosque nele. */
export function listKioskGroups(kioskGroupById: Map<string, { id: string; name: string }>): KioskGroup[] {
  const groups = new Map<string, KioskGroup>();
  for (const [kioskId, group] of kioskGroupById) {
    const entry = groups.get(group.id) ?? { id: group.id, name: group.name, kioskIds: [] };
    entry.kioskIds.push(kioskId);
    groups.set(group.id, entry);
  }
  return [...groups.values()].sort((a, b) => {
    if (a.id === NO_GROUP_ID) return 1;
    if (b.id === NO_GROUP_ID) return -1;
    return a.name.localeCompare(b.name, 'pt-BR');
  });
}
