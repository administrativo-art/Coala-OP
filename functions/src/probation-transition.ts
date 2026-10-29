import { Timestamp, type Firestore } from 'firebase-admin/firestore';

function civilDate(value: unknown): string | null {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
  if (value && typeof value === 'object' && 'toDate' in value && typeof value.toDate === 'function') return value.toDate().toISOString().slice(0, 10);
  return null;
}

/** Main users is the concurrency fence shared with termination/readmission. RH is a projection. */
export async function advanceAutomaticProbation(db: Firestore, hrDb: Firestore, date: string) {
  const processes = hrDb.collection('onboardingProcesses');
  const [due, pending] = await Promise.all([
    processes.where('probationV2.config.effectivenessRule', '==', 'automatic_at_end')
      .where('probationV2.status', 'in', ['active', 'decision_pending'])
      .where('probationV2.schedule.finalEndDate', '<', date)
      .where('probationV2.employmentCycleVersion', '>=', 0).limit(100).get(),
    db.collection('users').where('probationProjectionPending', '==', true).limit(100).get(),
  ]);
  const refs = new Map(due.docs.map((row) => [row.id, row.ref]));
  for (const user of pending.docs) {
    const processId = user.get('probationEffectiveMarker')?.processId;
    if (typeof processId === 'string') refs.set(processId, processes.doc(processId));
  }
  let advanced = 0;
  for (const ref of refs.values()) {
    const process = await ref.get();
    const state = process.get('probationV2');
    const end = state?.schedule?.finalEndDate;
    const expectedCycle = state?.employmentCycleVersion;
    if (!state || !/^\d{4}-\d{2}-\d{2}$/.test(end ?? '') || end >= date
      || !Number.isSafeInteger(expectedCycle) || expectedCycle < 0
      || state.config?.effectivenessRule !== 'automatic_at_end' || state.status === 'terminated'
      || process.get('status') === 'cancelled'
      || !(process.get('status') === 'completed' || process.get('currentStage') === 'done' || process.get('formalizationCompletedAt'))) continue;
    const day = new Date(end + 'T12:00:00Z'); day.setUTCDate(day.getUTCDate() + 1);
    const effectiveDate = day.toISOString().slice(0, 10);
    const id = 'probation_' + ref.id + '_' + end;
    let userId = process.get('collaboratorUserId');
    if (!userId && process.get('employeeId')) userId = (await hrDb.collection('employees').doc(String(process.get('employeeId'))).get()).get('auth_uid');
    if (!userId) continue;
    const person = db.collection('users').doc(String(userId));
    const auditRef = person.collection('contractualChanges').doc(id);
    const reason = 'Passagem automática para prazo indeterminado conforme a regra automatic_at_end do contrato e a continuidade do vínculo.';
    const decision = await db.runTransaction(async (transaction) => {
      const [user, audit] = await transaction.getAll(person, auditRef);
      if (audit.exists) return audit.data()!;
      const terminationDate = civilDate(user.get('terminationDate'));
      const admission = civilDate(user.get('admissionDate'));
      if (!user.exists || user.get('isActive') !== true
        || ['terminated', 'inactive', 'dismissed'].includes(String(user.get('employmentStatus') ?? ''))
        || (Number(user.get('employmentCycleVersion')) || 0) !== expectedCycle
        || !admission || admission !== (state.admissionDate ?? state.schedule?.admissionDate)
        || user.get('absenceDocumentDeletionFence')
        || terminationDate && terminationDate < effectiveDate
        || user.get('terminationProcessId') && !terminationDate) return null;
      const now = Timestamp.now();
      const event = { actorId: 'system', actorName: 'Sistema', effectiveDate, reason, source: 'system', status: 'applied',
        processId: ref.id, employmentCycleVersion: expectedCycle,
        changes: { contractStage: { before: 'Em experiência', after: 'Prazo indeterminado' } }, createdAt: now };
      transaction.create(auditRef, event);
      transaction.update(person, { probationEffectiveMarker: { processId: ref.id, changeId: id, employmentCycleVersion: expectedCycle, effectiveDate },
        probationProjectionPending: true, contractualDataVersion: (Number(user.get('contractualDataVersion')) || 0) + 1 });
      return event;
    });
    if (!decision) continue;
    await hrDb.runTransaction(async (transaction) => {
      const latest = await transaction.get(ref);
      if (latest.get('status') === 'cancelled' || latest.get('probationV2.status') === 'terminated'
        || latest.get('probationV2.employmentCycleVersion') !== expectedCycle
        || latest.get('probationV2.schedule.finalEndDate') !== end) return;
      transaction.update(ref, { 'probationV2.status': 'effective',
        'probationV2.updatedAt': decision.createdAt.toDate().toISOString(),
        'probationV2.decision': { result: 'effective', decidedAt: decision.createdAt.toDate().toISOString(), decidedBy: 'system', notes: reason } });
      transaction.set(hrDb.collection('audit_log').doc(id), { employee_id: latest.get('employeeId') ?? null,
        field_key: 'employee.contract_stage', old_value: 'experience', new_value: 'indefinite', changed_by: 'system',
        changed_at: decision.createdAt, effective_date: effectiveDate, reason, source: 'cf_automation' });
    });
    await db.runTransaction(async (transaction) => {
      const latest = await transaction.get(person);
      if (latest.get('probationEffectiveMarker')?.changeId === id) transaction.update(person, { probationProjectionPending: false });
    });
    advanced++;
  }
  return { inspected: refs.size, advanced };
}
