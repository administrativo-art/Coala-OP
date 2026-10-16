import 'server-only';

import type { ServerUserContext } from '@/lib/auth-server';
import { dbAdmin } from '@/lib/firebase-admin';
import { AppError } from '@/lib/observability/app-error';
import type { DPAbsenceResolutionTarget } from '@/lib/dp-absence-rules';

export async function ownAbsenceResolutionTarget(actor: ServerUserContext): Promise<DPAbsenceResolutionTarget | null> {
  const user = actor.userDoc;
  if (user.id !== actor.decoded.uid) throw new AppError({ code: 'ABSENCE_OWNER_MISMATCH', kind: 'AUTHORIZATION', safeMessage: 'Não foi possível validar a pessoa autenticada.' });
  return absenceResolutionTargetForUser(user);
}

export async function absenceResolutionTargetForUser(user: ServerUserContext['userDoc']): Promise<DPAbsenceResolutionTarget | null> {
  if (user.isActive === false) return null;
  const relationship = user.employmentRelationshipType;
  if (!relationship || !['clt', 'apprenticeship', 'internship'].includes(relationship)) return null;
  const unitId = user.unitId;
  const unit = unitId ? await dbAdmin.collection('dp_units').doc(unitId).get() : null;
  if (unitId && !unit?.exists) return null;
  const groupId = unit?.get('groupId');
  const group = typeof groupId === 'string' && groupId ? await dbAdmin.collection('dp_unitGroups').doc(groupId).get() : null;
  const organizationId = unit?.get('organizationId') ?? group?.get('organizationId');
  return {
    collaboratorId: user.id,
    employmentRelationshipType: relationship as 'clt' | 'apprenticeship' | 'internship',
    ...(unitId ? { unitId } : {}),
    ...(typeof groupId === 'string' && groupId ? { unitGroupId: groupId } : {}),
    ...(typeof organizationId === 'string' && organizationId ? { unitOrganizationId: organizationId } : {}),
    ...(user.jobRoleId ? { jobRoleId: user.jobRoleId } : {}),
    jobFunctionIds: Array.isArray(user.jobFunctionIds) ? user.jobFunctionIds : [],
  };
}
