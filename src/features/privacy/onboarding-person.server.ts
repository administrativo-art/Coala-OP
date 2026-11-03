import { randomUUID } from 'node:crypto';
import { dbAdmin } from '@/lib/firebase-admin';
import { record } from './onboarding-person';
import { hrDbAdmin } from '@/lib/firebase-rh-admin';
import { matchesLegacyProcessEmployeeId, onboardingOrigin, provenPlaceholder, readOnboardingPerson, type OnboardingPersonIdentity } from './onboarding-person';
export function newOnboardingPerson(onboardingId: string): OnboardingPersonIdentity {
  return { schemaVersion: 1, kind: 'natural-person', ref: { namespace: 'hr.onboardingPersons', id: randomUUID() }, sourceLocator: { onboardingId, slot: 'applicant' } };
}
/** Call only from an authorized mutating intake/generation/provisioning operation. */
export async function prepareOnboardingPersonForWrite(onboardingId: string) {
  const proposed = newOnboardingPerson(onboardingId);
  const prepared: Record<string, unknown> & { id: string } = await hrDbAdmin.runTransaction(async (transaction) => {
    const reference = hrDbAdmin.collection('onboardingProcesses').doc(onboardingId);
    const snapshot = await transaction.get(reference);
    if (!snapshot.exists) throw new Error('Processo de admissão não encontrado.');
    const process = { ...snapshot.data(), id: snapshot.id } as Record<string, unknown> & { id: string };
    const origin = onboardingOrigin(process);
    if (origin === 'unknown') throw new Error('Origem da admissão não comprovada. Reconcilie o processo antes de gerar dados pessoais.');
    if (origin === 'recruitment') {
      const candidate = await transaction.get(hrDbAdmin.collection('candidates').doc(String(process.candidateId)));
      if (!candidate.exists) throw new Error('Candidatura real da origem não encontrada.');
      return process;
    }
    if (origin === 'pj-company') {
      if (process.personIdentity) throw new Error('Empresa prestadora não pode ser titular humano da admissão.');
      return process;
    }
    if (process.candidateId && !provenPlaceholder(process, process.candidateId)) throw new Error('A origem manual contém uma referência de candidatura incompatível.');
    const identity = readOnboardingPerson(process, onboardingId);
    if (process.personIdentity && !identity) throw new Error('Identidade embutida divergente da origem/slot.');
    if (identity) return process;
    transaction.update(reference, { personIdentity: proposed });
    return { ...process, personIdentity: proposed };
  });
  const identity = readOnboardingPerson(prepared, onboardingId);
  const uid = prepared.collaboratorUserId;
  if (!identity || identity.provisioningLink || typeof uid !== 'string' || !uid) return prepared;
  // Legacy native accounts already carry both process provenance and reciprocal UID/HR IDs.
  // A mutating operation may checkpoint that evidence; read-only lookups never allocate/link.
  const user = await dbAdmin.collection('users').doc(uid).get();
  const employeeId = user.get('hrEmployeeId');
  if (typeof employeeId !== 'string' || !employeeId || user.get('source') !== 'recruitment_onboarding' || user.get('onboardingId') !== onboardingId
    || !matchesLegacyProcessEmployeeId(prepared.employeeId, uid, employeeId)) throw new Error('Conta legada sem proveniência recíproca de admissão. Reconcilie o vínculo.');
  const [employee, claims, byAuth, bySource] = await Promise.all([
    hrDbAdmin.collection('employees').doc(employeeId).get(), dbAdmin.collection('users').where('hrEmployeeId', '==', employeeId).limit(2).get(),
    hrDbAdmin.collection('employees').where('auth_uid', '==', uid).limit(2).get(), hrDbAdmin.collection('employees').where('source_user_id', '==', uid).limit(2).get(),
  ]);
  if (!employee.exists || employee.get('auth_uid') !== uid || employee.get('source_user_id') && employee.get('source_user_id') !== uid
    || claims.size !== 1 || claims.docs[0].id !== uid || new Set([...byAuth.docs, ...bySource.docs].map((row) => row.id)).size !== 1) throw new Error('Cadastro RH legado não confirma vínculo único da admissão.');
  const existing = record(prepared.personProvisioning);
  const operationId = typeof existing.operationId === 'string' ? existing.operationId : randomUUID();
  if (existing.uid && existing.uid !== uid) throw new Error('Checkpoint diverge da conta já vinculada.');
  const checkpoint = { schemaVersion: 1, operationId, uid, hrEmployeeId: employeeId, origin: 'manual-natural', subjectRef: identity.ref, state: 'linking-identities' };
  const reference = hrDbAdmin.collection('onboardingProcesses').doc(onboardingId);
  await reference.set({ personProvisioning: checkpoint }, { merge: true });
  const fields = { onboardingId, onboardingPersonRef: identity.ref, onboardingProvisioningId: operationId };
  await user.ref.set(fields, { merge: true }); await employee.ref.set(fields, { merge: true });
  const linkedIdentity = { ...identity, provisioningLink: { operationId, uid, hrEmployeeId: employeeId } };
  await hrDbAdmin.runTransaction(async (transaction) => {
    const current = await transaction.get(reference);
    if (current.get('personIdentity.ref.id') !== identity.ref.id || current.get('personProvisioning.operationId') !== operationId || current.get('collaboratorUserId') !== uid) throw new Error('Origem legada mudou durante o checkpoint.');
    transaction.update(reference, { personIdentity: linkedIdentity, personProvisioning: { ...checkpoint, state: 'identities-linked' } });
  });
  return { ...prepared, personIdentity: linkedIdentity, personProvisioning: { ...checkpoint, state: 'identities-linked' } };
}
