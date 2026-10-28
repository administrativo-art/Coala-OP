import type { DPUnit, Kiosk, User } from '@/types';
import { matchDPUnitForKiosk } from '@/lib/dp-kiosk-match';

type OperationalUser = Pick<User, 'id' | 'unitIds' | 'assignedKioskIds'>;

export function userMatchesDPUnit(
  user: Pick<OperationalUser, 'unitIds' | 'assignedKioskIds'>,
  unitId: string | undefined,
  units: DPUnit[],
  kiosks: Kiosk[],
) {
  if (!unitId) return true;
  if (user.unitIds?.includes(unitId)) return true;

  const assignedKioskIds = user.assignedKioskIds ?? [];
  if (assignedKioskIds.length === 0 || units.length === 0 || kiosks.length === 0) return false;

  return assignedKioskIds.some((kioskId) => {
    const kiosk = kiosks.find((item) => item.id === kioskId);
    if (!kiosk) return false;
    return matchDPUnitForKiosk(kiosk.name, units)?.id === unitId;
  });
}

/** A cobertura e o DSR aparecem na própria data; não tornam a pessoa membro da equipe mensal. */
export function buildDPHabitualRoster(
  activeUnits: DPUnit[],
  operationalUsers: OperationalUser[],
  units: DPUnit[],
  kiosks: Kiosk[],
) {
  return new Map(activeUnits.map((unit) => [
    unit.id,
    operationalUsers.filter((user) => userMatchesDPUnit(user, unit.id, units, kiosks)).map((user) => user.id),
  ]));
}
