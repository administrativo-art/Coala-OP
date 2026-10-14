import 'server-only';

import { dbAdmin } from '@/lib/firebase-admin';
import { matchDPUnitForKiosk } from '@/lib/dp-kiosk-match';
import { AppError } from '@/lib/observability/app-error';
import type { DPUnit } from '@/types';

const MAX_DP_UNITS = 300;

export async function resolveGoalDPUnit(kioskId: string) {
  const [kiosk, externalMatches] = await Promise.all([
    dbAdmin.collection('kiosks').doc(kioskId).get(),
    dbAdmin.collection('dp_units').where('externalId', '==', kioskId).limit(2).get(),
  ]);
  if (!kiosk.exists) {
    throw new AppError({ code: 'GOAL_KIOSK_NOT_FOUND', kind: 'NOT_FOUND', safeMessage: 'Unidade da meta não encontrada.' });
  }
  const kioskName = String(kiosk.get('name') ?? '').trim();
  if (externalMatches.size > 1) {
    throw new AppError({ code: 'GOAL_DP_UNIT_AMBIGUOUS', kind: 'DATA_INTEGRITY', safeMessage: 'Mais de uma unidade do Departamento Pessoal usa o mesmo vínculo operacional.' });
  }
  const exactNameMatches = externalMatches.empty
    ? await dbAdmin.collection('dp_units').where('name', '==', kioskName).limit(2).get()
    : null;
  if (exactNameMatches && exactNameMatches.size > 1) {
    throw new AppError({ code: 'GOAL_DP_UNIT_AMBIGUOUS', kind: 'DATA_INTEGRITY', safeMessage: 'Mais de uma unidade do Departamento Pessoal corresponde à unidade da meta.' });
  }
  let dpUnit = externalMatches.docs[0]
    ? ({ id: externalMatches.docs[0].id, ...externalMatches.docs[0].data() } as DPUnit)
    : exactNameMatches?.docs[0]
      ? ({ id: exactNameMatches.docs[0].id, ...exactNameMatches.docs[0].data() } as DPUnit)
      : undefined;
  if (!dpUnit) {
    const units = await dbAdmin.collection('dp_units').limit(MAX_DP_UNITS + 1).get();
    if (units.size > MAX_DP_UNITS) {
      throw new AppError({ code: 'GOAL_DP_UNIT_LIMIT_REACHED', kind: 'DATA_INTEGRITY', safeMessage: 'Há unidades demais para validar a equipe com segurança.' });
    }
    dpUnit = matchDPUnitForKiosk(kioskName, units.docs.map((unit) => ({ id: unit.id, ...unit.data() } as DPUnit)));
  }
  if (!dpUnit) {
    throw new AppError({ code: 'GOAL_DP_UNIT_NOT_FOUND', kind: 'DATA_INTEGRITY', safeMessage: 'A unidade da meta não está vinculada a uma unidade do Departamento Pessoal.' });
  }
  return { kiosk, kioskName, dpUnit };
}
