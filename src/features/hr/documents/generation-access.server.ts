import { FieldPath } from 'firebase-admin/firestore';
import type { ServerUserContext } from '@/lib/auth-server';
import { dbAdmin } from '@/lib/firebase-admin';
import { hrDbAdmin } from '@/lib/firebase-rh-admin';
import { AppError } from '@/lib/observability/app-error';
import { canAccessUnit, canAccessUserByUnit } from '@/lib/unit-access';
import { hasFormalizationPermission } from '@/lib/hr-formalization-permissions';
import { assertEmployeeUnitAccess } from '@/features/hr/lib/employee-document-access-server';
import { matchesPersonWorkspace } from '@/features/privacy/person-workspace';

export type GenerationActor = Pick<ServerUserContext, 'decoded' | 'userDoc' | 'isDefaultAdmin' | 'workspace_id'>;
const USER_FIELDS = ['workspaceId', 'workspace_id', 'hrEmployeeId', 'unitIds', 'assignedKioskIds', 'operationalUnitPeriods'];
const HR_FIELDS = ['workspaceId', 'workspace_id', 'auth_uid', 'source_user_id'];
const denied = () => new AppError({ code: 'DOCUMENT_PERSON_SCOPE_FORBIDDEN', kind: 'AUTHORIZATION', safeMessage: 'Sem acesso ao cadastro pessoal selecionado.' });
export function assertDocumentGenerationPermission(actor: ServerUserContext) {
  if (!hasFormalizationPermission(actor.permissions, 'documents.generate', actor.isDefaultAdmin)) throw denied();
}
async function userScope(actor: GenerationActor, id: string, snapshot?: FirebaseFirestore.QueryDocumentSnapshot) {
  const user = snapshot ?? (await dbAdmin.collection('users').where(FieldPath.documentId(), '==', id).limit(1).select(...USER_FIELDS).get()).docs[0];
  if (!user || !matchesPersonWorkspace(user.data(), actor.workspace_id, true)
    || !canAccessUserByUnit(actor.userDoc, user.data(), { isDefaultAdmin: actor.isDefaultAdmin })) throw denied();
  // Reuse the domain assertion only after the bounded projection established scope.
  await assertEmployeeUnitAccess(actor, id);
  return user;
}
/** The input is always an hr.employees ID, never a USERS-directory ID. */
export async function assertHrPartyGenerationAccess(actor: GenerationActor, hrId: string) {
  if (!hrId || hrId !== hrId.trim() || hrId.length > 180 || hrId.includes('/')) throw denied();
  const row = (await hrDbAdmin.collection('employees').where(FieldPath.documentId(), '==', hrId).limit(1).select(...HR_FIELDS).get()).docs[0];
  if (!row || !matchesPersonWorkspace(row.data(), actor.workspace_id, true)) throw denied();
  const auth = row.get('auth_uid'), source = row.get('source_user_id');
  if (auth && source && auth !== source) throw denied();
  const uid = typeof auth === 'string' && auth ? auth : typeof source === 'string' && source ? source : null;
  if (!uid) { if (!actor.isDefaultAdmin) throw denied(); return; }
  const user = await userScope(actor, uid);
  if (user.get('hrEmployeeId') !== hrId) throw denied();
  const claims = await dbAdmin.collection('users').where('hrEmployeeId', '==', hrId).limit(2).select(...USER_FIELDS).get();
  const [byAuth, bySource] = await Promise.all(['auth_uid', 'source_user_id'].map((field) => hrDbAdmin.collection('employees').where(field, '==', uid).limit(2).select(...HR_FIELDS).get()));
  const employeeIds = new Set([...byAuth.docs, ...bySource.docs].map((doc) => doc.id));
  if (claims.size !== 1 || claims.docs[0].id !== uid || employeeIds.size !== 1 || !employeeIds.has(hrId)) throw denied();
}
async function primaryScope(actor: GenerationActor, id: string) {
  const [users, employees] = await Promise.all([
    dbAdmin.collection('users').where(FieldPath.documentId(), '==', id).limit(1).select(...USER_FIELDS).get(),
    hrDbAdmin.collection('employees').where(FieldPath.documentId(), '==', id).limit(1).select(...HR_FIELDS).get(),
  ]);
  if (users.empty && employees.empty) throw denied();
  if (!users.empty) await userScope(actor, id, users.docs[0]);
  if (!employees.empty) {
    await assertHrPartyGenerationAccess(actor, id);
    if (!users.empty && users.docs[0].get('hrEmployeeId') !== id) throw denied();
  }
}
export async function assertGenerationPersonScopes(input: { actorAccess?: GenerationActor; employeeId?: string | null; onboardingId?: string | null; partyHrIds: string[] }) {
  const actor = input.actorAccess;
  if (!actor) {
    // Existing internal admission callers own the process and supply no client-selected parties.
    if (!input.onboardingId || input.partyHrIds.length) throw denied();
    return;
  }
  if (input.employeeId) await primaryScope(actor, input.employeeId);
  if (input.onboardingId) {
    const process = (await hrDbAdmin.collection('onboardingProcesses').where(FieldPath.documentId(), '==', input.onboardingId).limit(1).select('workspaceId', 'workspace_id', 'employeeId', 'collaboratorUserId', 'unitId').get()).docs[0];
    if (!process || !matchesPersonWorkspace(process.data(), actor.workspace_id, true)) throw denied();
    const userId = process.get('collaboratorUserId') ?? process.get('employeeId');
    if (typeof userId === 'string' && userId) await primaryScope(actor, userId);
    else if (!actor.isDefaultAdmin && (typeof process.get('unitId') !== 'string' || !canAccessUnit(actor.userDoc, process.get('unitId')))) throw denied();
  }
  for (const id of [...new Set(input.partyHrIds)]) await assertHrPartyGenerationAccess(actor, id);
}
