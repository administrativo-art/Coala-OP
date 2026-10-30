import { FieldValue, Timestamp, type Firestore } from 'firebase-admin/firestore';

export async function activateContractualChanges(db: Firestore, hrDb: Firestore, date: string) {
  const due = await db.collection('users').where('nextContractChangeDate', '<=', date).limit(100).get();
  let applied = 0;
  for (const ref of due.docs.map((row) => row.ref)) {
    const updated = await db.runTransaction(async (transaction) => {
      const user = await transaction.get(ref);
      const pending = user.get('scheduledContractChange') as { id: string; fields: Record<string, unknown>; effectiveDate: string;
        observedEmploymentCycleVersion?: number; profileWasDefaultAdmin?: boolean } | undefined;
      if (!pending || pending.effectiveDate > date || !pending.id || !pending.fields) return null;
      const changeRef = ref.collection('contractualChanges').doc(pending.id);
      const change = await transaction.get(changeRef);
      if (!change.exists || change.get('status') !== 'scheduled') return null;
      const profile = typeof pending.fields.profileId === 'string'
        ? await transaction.get(db.collection('profiles').doc(pending.fields.profileId)) : null;
      if (user.get('isActive') === false
        || (Number(user.get('employmentCycleVersion')) || 0) !== (pending.observedEmploymentCycleVersion ?? 0)
        || profile && (!profile.exists || (profile.get('isDefaultAdmin') === true) !== Boolean(pending.profileWasDefaultAdmin))) {
        transaction.update(changeRef, { status: 'conflict', activationIssue: 'Vínculo ou perfil alterado após o agendamento. Confira antes de aplicar.' });
        transaction.update(ref, { scheduledContractChange: { ...pending, activationStatus: 'conflict' }, nextContractChangeDate: FieldValue.delete() });
        return null;
      }
      const cycleChanged = ['admissionDate', 'employmentRelationshipType'].some((key) => key in pending.fields);
      if (cycleChanged && user.get('absenceDocumentDeletionFence')) return null;
      transaction.update(ref, { ...pending.fields,
        contractualFieldOverrides: [...new Set([...(user.get('contractualFieldOverrides') ?? []), ...Object.keys(pending.fields)])],
        ...(cycleChanged ? { employmentCycleVersion: (Number(user.get('employmentCycleVersion')) || 0) + 1 } : {}),
        contractualDataVersion: (Number(user.get('contractualDataVersion')) || 0) + 1,
        contractProjectionSyncPending: true,
        scheduledContractChange: FieldValue.delete(), nextContractChangeDate: FieldValue.delete() });
      transaction.update(changeRef, { status: 'applied', appliedAt: Timestamp.now(), appliedBy: 'system' });
      return { ...user.data(), ...pending.fields, id: user.id };
    });
    if (!updated) continue;
    // The main user is canonical. RH's existing user-write synchronization handles role/profile caches.
    applied++;
  }
  const projections = await db.collection('users').where('contractProjectionSyncPending', '==', true).limit(100).get();
  for (const document of projections.docs) {
    const user = document.data();
    try {
      const employeeId = String(user.hrEmployeeId ?? user.registrationIdBizneo ?? document.id);
      const employee = hrDb.collection('employees').doc(employeeId);
      if ((await employee.get()).exists) await employee.set({ ...(user.unitId ? { unit_id: user.unitId } : {}), updated_at: Timestamp.now() }, { merge: true });
      await db.runTransaction(async (transaction) => {
        const latest = await transaction.get(document.ref);
        if (latest.get('contractualDataVersion') === user.contractualDataVersion) transaction.update(document.ref, { contractProjectionSyncPending: false });
      });
    } catch { /* Keep the pending marker for the next bounded retry. */ }
  }
  return { inspected: due.size, applied };
}
