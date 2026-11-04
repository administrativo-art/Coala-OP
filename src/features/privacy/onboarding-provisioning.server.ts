import { randomUUID } from 'node:crypto';
import { authAdmin, dbAdmin } from '@/lib/firebase-admin';
import { hrDbAdmin } from '@/lib/firebase-rh-admin';
import { onboardingOrigin, processSubjectRef, readOnboardingPerson, record } from './onboarding-person';
import { prepareOnboardingPersonForWrite } from './onboarding-person.server';

/** Auth/main/RH are not atomic. Reserve an immutable UID before creating Auth and checkpoint each boundary. */
export async function provisionOnboardingAuth(input: { processId: string }, email: string, displayName: string, password: string) {
  const process = await prepareOnboardingPersonForWrite(input.processId);
  const origin = onboardingOrigin(process), subject = processSubjectRef(process);
  let byEmail: Awaited<ReturnType<typeof authAdmin.getUserByEmail>> | undefined;
  try { byEmail = await authAdmin.getUserByEmail(email); }
  catch (error) { if ((error as { code?: string }).code !== 'auth/user-not-found') throw error; }
  const old = record(process.personProvisioning);
  if (byEmail && old.uid !== byEmail.uid) {
    const existing = await dbAdmin.collection('users').doc(byEmail.uid).get();
    if (!existing.exists || existing.get('source') !== 'recruitment_onboarding' || existing.get('onboardingId') !== input.processId) throw new Error('Já existe uma conta com este e-mail sem vínculo comprovado com esta admissão.');
  }
  const uid = typeof old.uid === 'string' ? old.uid : byEmail?.uid ?? randomUUID();
  const operationId = typeof old.operationId === 'string' ? old.operationId : randomUUID();
  const checkpoint = await hrDbAdmin.runTransaction(async (transaction) => {
    const ref = hrDbAdmin.collection('onboardingProcesses').doc(input.processId), row = await transaction.get(ref);
    const current = record(row.get('personProvisioning'));
    if (current.uid && (current.uid !== uid || current.operationId !== operationId)) throw new Error('Outro provisionamento está em andamento. Retome a operação registrada.');
    if (byEmail && byEmail.uid !== uid) throw new Error('A conta existente diverge do UID reservado.');
    const next = { ...current, schemaVersion: 1, operationId, uid, hrEmployeeId: uid, origin, subjectRef: subject, state: current.state ?? 'reserved' };
    transaction.set(ref, { personProvisioning: next }, { merge: true });
    return next;
  });
  let user; let created = false;
  try { user = await authAdmin.getUser(uid); }
  catch (error) {
    if ((error as { code?: string }).code !== 'auth/user-not-found') throw error;
    user = await authAdmin.createUser({ uid, email, password, displayName, emailVerified: false, disabled: false }); created = true;
  }
  if (user.email?.toLowerCase() !== email) throw new Error('O e-mail atual diverge da conta reservada.');
  if (checkpoint.state === 'reserved') await hrDbAdmin.collection('onboardingProcesses').doc(input.processId).set({ personProvisioning: { ...checkpoint, state: 'auth-created' } }, { merge: true });
  return { user, created, checkpoint };
}

export async function checkpointOnboardingIdentities(processId: string, uid: string, employeeId: string) {
  const [processRow, user, employee] = await Promise.all([
    hrDbAdmin.collection('onboardingProcesses').doc(processId).get(), dbAdmin.collection('users').doc(uid).get(), hrDbAdmin.collection('employees').doc(employeeId).get(),
  ]);
  const process = { ...processRow.data(), id: processId }, checkpoint = record(processRow.get('personProvisioning'));
  if (checkpoint.uid !== uid || checkpoint.hrEmployeeId !== employeeId || !user.exists || user.get('hrEmployeeId') !== employeeId
    || user.get('onboardingId') !== processId || user.get('onboardingProvisioningId') !== checkpoint.operationId || employee.get('auth_uid') !== uid
    || employee.get('onboardingId') !== processId || employee.get('onboardingProvisioningId') !== checkpoint.operationId) throw new Error('Identidades do provisionamento ainda não estão confirmadas. Retome a mesma operação.');
  const identity = readOnboardingPerson(process, processId);
  if (identity && (record(user.get('onboardingPersonRef')).id !== identity.ref.id || record(employee.get('onboardingPersonRef')).id !== identity.ref.id)) throw new Error('Pessoa embutida diverge das identidades provisionadas.');
  await hrDbAdmin.runTransaction(async (transaction) => {
    const ref = hrDbAdmin.collection('onboardingProcesses').doc(processId), fresh = await transaction.get(ref);
    if (fresh.get('personProvisioning.operationId') !== checkpoint.operationId || fresh.get('personProvisioning.uid') !== uid) throw new Error('O provisionamento mudou durante a confirmação.');
    transaction.set(ref, { collaboratorUserId: uid, employeeId, personProvisioning: { ...checkpoint, state: 'identities-linked' },
      ...(identity ? { personIdentity: { ...identity, provisioningLink: { uid, hrEmployeeId: employeeId, operationId: String(checkpoint.operationId) } } } : {}) }, { merge: true });
  });
}
