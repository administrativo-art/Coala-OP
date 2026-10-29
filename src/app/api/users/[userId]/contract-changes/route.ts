import { NextResponse, type NextRequest } from 'next/server';
import { requireUser, type ServerUserContext } from '@/lib/auth-server';
import { canAccessUserByUnit } from '@/lib/unit-access';
import { dbAdmin } from '@/lib/firebase-admin';
import { hrDbAdmin } from '@/lib/firebase-rh-admin';
import { CONTRACTUAL_FIELDS } from '@/lib/contractual-data';
import { AppError } from '@/lib/observability/app-error';
import { defineSecurityContract } from '@/lib/security/route-contract';
import { defineSecurityEnforcer } from '@/lib/security/enforcer';
import { secureRoute } from '@/lib/security/secure-route.server';
import { rethrowServerAuthenticationFailure } from '@/lib/server-authentication-failure';

type Context = { params: Promise<{ userId: string }> };
const contract = defineSecurityContract({ schemaVersion: 1, id: 'users.contract-changes.read', version: 1,
  surface: { method: 'GET', path: '/api/users/[userId]/contract-changes' }, exposure: 'authenticated',
  identity: { kind: 'active-user' }, authorization: { kind: 'custom', strategy: 'contract-history-management' },
  resourceScope: { kind: 'custom', strategy: 'employee-unit' }, input: { kind: 'none' },
  effects: { mode: 'read', audit: 'none' }, errorExposure: 'sanitized' });
const enforcer = defineSecurityEnforcer<NextRequest, Context, unknown, ServerUserContext, Record<string, never>, { userId: string }>({ id: 'contract-history-read-v1',
  guarantees: ['authenticated-user', 'active-user', 'authorization:contract-history-management', 'scope:employee-unit'],
  async enforce({ request, routeContext }) {
    const actor = await requireUser(request).catch(rethrowServerAuthenticationFailure);
    if (!actor.isDefaultAdmin && actor.permissions.settings.manageUsers !== true) {
      throw new AppError({ code: 'CONTRACT_HISTORY_FORBIDDEN', kind: 'AUTHORIZATION', safeMessage: 'Sem permissão para consultar o histórico contratual.' });
    }
    const { userId } = await routeContext.params;
    if (!/^[A-Za-z0-9_-]{1,180}$/.test(userId)) throw new AppError({ code: 'CONTRACT_HISTORY_PERSON_INVALID', kind: 'VALIDATION' });
    const person = await dbAdmin.collection('users').doc(userId).get();
    if (!person.exists) throw new AppError({ code: 'CONTRACT_HISTORY_PERSON_NOT_FOUND', kind: 'NOT_FOUND' });
    if (userId !== actor.decoded.uid && !canAccessUserByUnit(actor.userDoc, person.data() ?? {}, { isDefaultAdmin: actor.isDefaultAdmin })) {
      throw new AppError({ code: 'CONTRACT_HISTORY_UNIT_FORBIDDEN', kind: 'AUTHORIZATION', safeMessage: 'Pessoa fora do escopo de unidades.' });
    }
    return { actor, input: {}, resource: { userId } };
  } });

export const GET = secureRoute({ contract, enforcer }, async ({ security }) => {
  const { userId } = security.resource as { userId: string };
  const userRef = dbAdmin.collection('users').doc(userId);
  const person = await userRef.get();
  const employeeId = String(person.get('hrEmployeeId') ?? person.get('registrationIdBizneo') ?? userId);
  const [snapshot, legacy, rh] = await Promise.all([
    userRef.collection('contractualChanges').orderBy('createdAt', 'desc').limit(50).get(),
    dbAdmin.collection('actionLogs').where('workspace_id', '==', security.actor.workspace_id)
      .where('metadata.target_id', '==', userId).orderBy('timestamp', 'desc').limit(50).get(),
    hrDbAdmin.collection('audit_log').where('employee_id', '==', employeeId).orderBy('changed_at', 'desc').limit(50).get(),
  ]);
  const current = snapshot.docs.map((document) => {
    const row = document.data();
    return { id: document.id, actorName: row.actorName ?? 'Não registrado',
      createdAt: row.createdAt?.toDate?.().toISOString() ?? null, effectiveDate: row.effectiveDate ?? null,
      reason: row.reason ?? null, source: row.source ?? 'user_edit', status: row.status ?? 'applied',
      ...(typeof row.activationIssue === 'string' ? { activationIssue: row.activationIssue.slice(0, 500) } : {}),
      ...(row.cancellation ? { cancellation: {
        reason: typeof row.cancellation.reason === 'string' ? row.cancellation.reason.slice(0, 500) : null,
        actorName: typeof row.cancellation.actorName === 'string' ? row.cancellation.actorName.slice(0, 180) : null,
        createdAt: row.cancellation.createdAt?.toDate?.().toISOString() ?? null,
      } } : {}),
      changes: row.changes ?? {}, ...(row.appliedAt ? { appliedAt: row.appliedAt.toDate().toISOString() } : {}) };
  });
  const oldUser = legacy.docs.flatMap((document) => {
    const row = document.data();
    if (row.metadata?.contract_audit_recorded === true) return [];
    const changes = Object.fromEntries(Object.entries(row.metadata?.changes ?? {}).filter(([key]) => (CONTRACTUAL_FIELDS as readonly string[]).includes(key)));
    return Object.keys(changes).length ? [{ id: `legacy-${document.id}`, actorName: row.username ?? 'Não registrado',
      createdAt: row.timestamp?.toDate?.().toISOString() ?? null, effectiveDate: null,
      reason: row.metadata?.reason ?? null, source: 'legacy_user_audit', status: 'applied', changes }] : [];
  });
  const rhFields: Record<string, string> = { 'employee.employer_cnpj': 'employerCnpj', 'employee.employer_name': 'Empregador — razão social',
    'employee.job_role_id': 'jobRoleId', 'employee.probation_eval_1': 'Fim do 1º período de experiência',
    'employee.probation_eval_2': 'Fim do 2º período de experiência', 'employee.contract_stage': 'contractStage' };
  const oldRH = rh.docs.flatMap((document) => {
    const row = document.data();
    const field = rhFields[row.field_key];
    return field ? [{ id: `rh-${document.id}`, actorName: row.changed_by ?? 'Não registrado',
      createdAt: row.changed_at?.toDate?.().toISOString() ?? null, effectiveDate: row.effective_date ?? null,
      reason: row.reason ?? null, source: row.source ?? 'legacy_rh_audit', status: 'applied',
      changes: { [field]: { before: row.old_value ?? null, after: row.new_value ?? null } } }] : [];
  });
  return NextResponse.json({ changes: [...current, ...oldUser, ...oldRH]
    .sort((left, right) => String(right.createdAt ?? '').localeCompare(String(left.createdAt ?? ''))).slice(0, 50),
    truncated: snapshot.size === 50 || legacy.size === 50 || rh.size === 50 || current.length + oldUser.length + oldRH.length > 50 });
});
