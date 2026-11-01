import type { DPUnit } from '@/types';

import { matchDPUnitForKiosk } from './dp-kiosk-match';

export function operationalSelectionForUser(
  user: { assignedKioskIds?: string[]; unitIds?: string[] },
  kiosks: { id: string; name: string }[],
  units: DPUnit[],
) {
  const assigned = (user.assignedKioskIds ?? []).filter((id) => kiosks.some((kiosk) => kiosk.id === id));
  const selectedKioskIds = assigned.length > 0 ? [...new Set(assigned)] : kiosks.filter((kiosk) => {
    const unit = matchDPUnitForKiosk(kiosk.name, units);
    return unit ? (user.unitIds ?? []).includes(unit.id) : false;
  }).map((kiosk) => kiosk.id);
  const mappedIds = selectedKioskIds.map((id) => {
    const kiosk = kiosks.find((item) => item.id === id);
    return kiosk ? matchDPUnitForKiosk(kiosk.name, units)?.id : undefined;
  }).filter((id): id is string => Boolean(id));
  return {
    selectedKioskIds,
    additionalUnitIds: [...new Set((user.unitIds ?? []).filter((id) => !mappedIds.includes(id)))],
  };
}

export function operationalUnitsDiffer(saved: string[] | undefined, selected: string[]) {
  const previous = new Set(saved ?? []);
  const next = new Set(selected);
  return previous.size !== next.size || [...previous].some((id) => !next.has(id));
}

/**
 * Quiosques atribuídos derivados das unidades da vigência: cada unidade que
 * corresponde a um quiosque (mesma filial do PDV ou, sem filial, mesmo nome)
 * entra; unidades sem quiosque, como o CD, não geram atribuição.
 */
/** Unidade que corresponde a um quiosque: mesma filial do PDV ou, sem filial, mesmo nome. */
export function unitIdForKiosk(
  kiosk: { name: string; pdvFilialId?: string | null },
  units: (Pick<DPUnit, 'id' | 'name'> & { pdvFilialId?: string | null })[],
) {
  const filial = kiosk.pdvFilialId?.trim();
  const byFilial = filial ? units.find((unit) => unit.pdvFilialId?.trim() === filial)?.id : undefined;
  return byFilial ?? matchDPUnitForKiosk(kiosk.name, units as DPUnit[])?.id ?? null;
}

/** Tradutor quiosque → unidade para leituras que só conhecem o id do quiosque (acessos antigos do PDV). */
export function kioskUnitResolver(
  kiosks: { id: string; name: string; pdvFilialId?: string | null }[],
  units: (Pick<DPUnit, 'id' | 'name'> & { pdvFilialId?: string | null })[],
) {
  const byKiosk = new Map(kiosks.map((kiosk) => [kiosk.id, unitIdForKiosk(kiosk, units)]));
  return (kioskId: string) => byKiosk.get(kioskId) ?? null;
}

export function kioskIdsForOperationalUnits(
  unitIds: readonly string[],
  kiosks: { id: string; name: string; pdvFilialId?: string | null }[],
  units: (Pick<DPUnit, 'id' | 'name'> & { pdvFilialId?: string | null })[],
) {
  const selected = new Set(unitIds);
  return kiosks.flatMap((kiosk) => {
    const unitId = unitIdForKiosk(kiosk, units);
    return unitId && selected.has(unitId) ? [kiosk.id] : [];
  });
}
