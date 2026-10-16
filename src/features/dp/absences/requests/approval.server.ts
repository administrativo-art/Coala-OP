import 'server-only';

import type { DPAbsenceApprovalLevel, DPAbsencePolicy, User } from '@/types';
import { buildPermissionSet } from '@/lib/auth-server';
import { dbAdmin } from '@/lib/firebase-admin';
import { hrDbAdmin } from '@/lib/firebase-rh-admin';
import { canAccessUnit } from '@/lib/unit-access';
import { AppError } from '@/lib/observability/app-error';
import { resolvePersonLink } from '@/features/hr/lib/person-link.server';

export type AbsenceApprovalStage = 'manager' | 'dp';
const LIMIT = 20;

async function directManagerId(beneficiaryUid: string) {
  const link = await resolvePersonLink(beneficiaryUid);
  const managerId = link.employeeDocument?.get('manager_id');
  if (typeof managerId !== 'string' || !managerId) return null;
  const manager = await hrDbAdmin.collection('employees').doc(managerId).get();
  const authUid = manager.get('auth_uid');
  return manager.exists && typeof authUid === 'string' && authUid ? authUid : null;
}

async function candidateIds(level: DPAbsenceApprovalLevel) {
  if (level.kind === 'people') return [...new Set(level.personIds)];
  const field = level.kind === 'function' ? 'jobFunctionIds' : 'jobRoleId';
  const value = level.kind === 'function' ? level.functionId : level.jobRoleId;
  const query = dbAdmin.collection('users');
  const snapshot = await (field === 'jobFunctionIds' ? query.where(field, 'array-contains', value) : query.where(field, '==', value)).limit(LIMIT + 1).get();
  if (snapshot.size > LIMIT) throw new AppError({ code: 'ABSENCE_APPROVERS_LIMIT', kind: 'DATA_INTEGRITY', safeMessage: 'Há responsáveis demais para esta etapa.' });
  return snapshot.docs.map((doc) => doc.id);
}

async function eligible(ids: string[], beneficiaryUid: string, unitId: string | undefined, requesterUid?: string) {
  const unique = [...new Set(ids)].filter((id) => id !== beneficiaryUid && id !== requesterUid);
  if (unique.length > LIMIT) throw new AppError({ code: 'ABSENCE_APPROVERS_LIMIT', kind: 'DATA_INTEGRITY' });
  const users = unique.length ? await dbAdmin.getAll(...unique.map((id) => dbAdmin.collection('users').doc(id))) : [];
  const result: string[] = [];
  for (const user of users) {
    if (!user.exists || user.get('isActive') !== true) continue;
    const record = { id: user.id, ...user.data() } as User;
    const profileId = user.get('profileId');
    const profile = typeof profileId === 'string' && profileId ? await dbAdmin.collection('profiles').doc(profileId).get() : null;
    const admin = profile?.get('isDefaultAdmin') === true;
    if (!canAccessUnit(record, unitId, { isDefaultAdmin: admin })) continue;
    const permissions = buildPermissionSet(profile?.get('permissions'), admin);
    if (admin || permissions.dp.requests.review === true) result.push(user.id);
  }
  return result;
}

export async function resolveAbsenceApprovers(policy: DPAbsencePolicy, stage: AbsenceApprovalStage, beneficiaryUid: string, unitId: string | undefined,
  requesterUid?: string) {
  let levels = policy.approvalAssignments?.[stage];
  if ((!levels || !levels.length) && stage === 'manager') {
    const managerId = await directManagerId(beneficiaryUid);
    levels = managerId ? [{ kind: 'people', personIds: [managerId] }] : [];
  }
  if (!levels?.length) throw new AppError({ code: 'ABSENCE_APPROVAL_UNCONFIGURED', kind: 'CONFLICT', safeMessage: 'A etapa de aprovação ainda não tem responsável configurado.' });
  for (let index = 0; index < levels.length; index += 1) {
    const level = levels[index];
    const ids = await candidateIds(level);
    let reviewers = await eligible(ids, beneficiaryUid, unitId, requesterUid);
    if (!reviewers.length && level.kind === 'function' && level.fallbackJobRoleId) {
      reviewers = await eligible(await candidateIds({ kind: 'role', jobRoleId: level.fallbackJobRoleId }), beneficiaryUid, unitId, requesterUid);
    }
    if (reviewers.length) return { stage, level: index, reviewerIds: reviewers };
  }
  throw new AppError({ code: 'ABSENCE_APPROVER_UNAVAILABLE', kind: 'CONFLICT', safeMessage: 'Nenhum responsável elegível está disponível para esta etapa.' });
}
