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
