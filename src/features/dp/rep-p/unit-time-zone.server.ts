import 'server-only';

import { FieldValue, type Firestore } from 'firebase-admin/firestore';
import { z } from 'zod';

import type { ServerUserContext } from '@/lib/auth-server';
import { dbAdmin } from '@/lib/firebase-admin';
import { AppError } from '@/lib/observability/app-error';

import { isBrazilTimeZone } from './time-zones';

export const unitTimeZoneSchema = z.object({
  timeZone: z.string().refine(isBrazilTimeZone, 'Fuso horário inválido.').nullable(),
}).strict();
export type UnitTimeZoneInput = z.infer<typeof unitTimeZoneSchema>;

/** Mesma regra de quem gerencia unidades operacionais no cadastro. */
export function canManageUnitTimeZone(context: ServerUserContext) {
  return Boolean(context.isDefaultAdmin || context.permissions.settings?.manageUsers
    || context.permissions.settings?.manageKiosks || context.permissions.dp?.settings?.manageUnits);
}

/**
 * Grava o fuso da unidade usado na batida (o instante continua o da Hora Legal) e o histórico da troca na
 * mesma transação. `null` volta ao fuso do estabelecimento. Batidas já gravadas não mudam.
 */
export async function setUnitTimeZone(context: ServerUserContext, unitId: string, input: UnitTimeZoneInput, db: Firestore = dbAdmin) {
  const unitRef = db.collection('dp_units').doc(unitId);
  return db.runTransaction(async (transaction) => {
    const unit = await transaction.get(unitRef);
    if (!unit.exists) throw new AppError({ code: 'DP_UNIT_NOT_FOUND', kind: 'NOT_FOUND', safeMessage: 'Unidade não encontrada.' });
    const previous = isBrazilTimeZone(unit.get('timeZone')) ? String(unit.get('timeZone')) : null;
    if (previous === input.timeZone) return { timeZone: previous, changed: false };
    transaction.update(unitRef, { timeZone: input.timeZone ?? FieldValue.delete(), updatedAt: FieldValue.serverTimestamp() });
    transaction.create(unitRef.collection('timeZoneHistory').doc(), {
      previous, next: input.timeZone, actorUid: context.decoded.uid, workspaceId: context.workspace_id, at: FieldValue.serverTimestamp(),
    });
    return { timeZone: input.timeZone, changed: true };
  });
}
