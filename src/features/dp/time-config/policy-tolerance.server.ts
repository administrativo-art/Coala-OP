import 'server-only';

import type { Firestore } from 'firebase-admin/firestore';

import { resolveDPJourney } from '@/lib/dp-journey-resolution';
import type { DPOvertimePolicy, DPPolicyTolerances } from '@/types';
import { policyRulesEnabled } from './rollout.server';

const POLICY_LIMIT = 500;

export type PolicyDayRules = { tolerances: DPPolicyTolerances; intrajornada: boolean };

/** Pessoa e alvo de aplicabilidade da política de hora extra: usado pelo banco e pelas tolerâncias do dia. */
export async function policyTargetOf(db: Firestore, uid: string) {
  const text = (value: unknown) => typeof value === 'string' && value ? value : null;
  const user = await db.collection('users').doc(uid).get();
  const unitId = text(user.get('unitId'));
  const unit = unitId ? await db.collection('dp_units').doc(unitId).get() : null;
  const unitGroupId = text(unit?.get('groupId'));
  const group = unitGroupId ? await db.collection('dp_unitGroups').doc(unitGroupId).get() : null;
  const unitOrganizationId = text(unit?.get('organizationId')) ?? text(group?.get('organizationId'));
  return { user, target: {
    collaboratorId: uid, ...(text(user.get('jobRoleId')) ? { jobRoleId: text(user.get('jobRoleId'))! } : {}),
    jobFunctionIds: Array.isArray(user.get('jobFunctionIds')) ? (user.get('jobFunctionIds') as string[]) : [],
    ...(unitId ? { unitId } : {}), ...(unitGroupId ? { unitGroupId } : {}), ...(unitOrganizationId ? { unitOrganizationId } : {}),
  } };
}

/**
 * Tolerâncias da política de hora extra vigente para a pessoa em cada data, com a mesma resolução do banco de horas.
 * Enquanto nenhuma política tiver tolerâncias, custa só a consulta das políticas e o resto segue pela jornada.
 */
export async function policyDayRulesFor(db: Firestore, uid: string): Promise<(date: string) => PolicyDayRules | null> {
  if (!policyRulesEnabled()) return () => null;
  const snapshot = await db.collection('dp_overtimePolicies').where('status', 'in', ['published', 'archived']).limit(POLICY_LIMIT + 1).get();
  if (snapshot.size > POLICY_LIMIT) throw new Error('Há políticas de hora extra demais para resolver as tolerâncias com segurança.');
  const policies = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }) as DPOvertimePolicy);
  if (!policies.some((policy) => policy.tolerances)) return () => null;
  const { target } = await policyTargetOf(db, uid);
  return (date) => {
    const resolution = resolveDPJourney({ journeys: policies, target, date });
    const policy = resolution.status === 'resolved' ? resolution.journey : null;
    return policy?.tolerances ? { tolerances: policy.tolerances, intrajornada: Boolean(policy.intrajornada) } : null;
  };
}
