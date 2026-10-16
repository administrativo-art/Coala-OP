import 'server-only';

import type { ServerUserContext } from '@/lib/auth-server';
import { dbAdmin } from '@/lib/firebase-admin';
import { hrDbAdmin } from '@/lib/firebase-rh-admin';
import { AppError } from '@/lib/observability/app-error';
import { canAccessUnit } from '@/lib/unit-access';
import { resolvePersonLink } from '@/features/hr/lib/person-link.server';
import type { User } from '@/types';
import { absenceResolutionTargetForUser, ownAbsenceResolutionTarget } from './target.server';

export type AbsenceInitiationOrigin = 'collaborator' | 'manager' | 'dp';
const unavailable = () => new AppError({ code: 'ABSENCE_BENEFICIARY_UNAVAILABLE', kind: 'NOT_FOUND', safeMessage: 'Pessoa ou opção de ausência indisponível.' });

export async function resolveAbsenceBeneficiary(actor: ServerUserContext, requestedUid?: string) {
  const beneficiaryUid = requestedUid ?? actor.decoded.uid;
  if (beneficiaryUid === actor.decoded.uid) {
    if (!actor.isDefaultAdmin && (actor.permissions.dashboard.collaborator ?? actor.permissions.dashboard.view) !== true) throw unavailable();
    const target = await ownAbsenceResolutionTarget(actor);
    if (!target?.unitId) throw unavailable();
    return { target, beneficiary: actor.userDoc, origin: 'collaborator' as const };
  }
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(beneficiaryUid)) throw unavailable();
  const snapshot = await dbAdmin.collection('users').doc(beneficiaryUid).get();
  if (!snapshot.exists) throw unavailable();
  const beneficiary = { id: snapshot.id, ...snapshot.data() } as User;
  const target = await absenceResolutionTargetForUser(beneficiary);
  if (!target?.unitId || !canAccessUnit(actor.userDoc, target.unitId, { isDefaultAdmin: actor.isDefaultAdmin })
    || actor.permissions.dp.collaborators.ownProfileOnly === true) throw unavailable();
  if (actor.isDefaultAdmin || actor.permissions.dp.requests.review === true && actor.permissions.dp.collaborators.edit === true) {
    return { target, beneficiary, origin: 'dp' as const };
  }
  if (actor.permissions.dp.requests.review !== true) throw unavailable();
  const link = await resolvePersonLink(beneficiaryUid);
  const managerId = link.employeeDocument?.get('manager_id');
  if (typeof managerId !== 'string' || !managerId) throw unavailable();
  const manager = await hrDbAdmin.collection('employees').doc(managerId).get();
  if (!manager.exists || manager.get('auth_uid') !== actor.decoded.uid) throw unavailable();
  return { target, beneficiary, origin: 'manager' as const };
}
