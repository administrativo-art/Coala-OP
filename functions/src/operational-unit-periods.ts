import { FieldValue, Timestamp, type Firestore } from 'firebase-admin/firestore';

type Period = { validFrom: string; validTo?: string; unitIds: string[] };

/** Bounded reconciliation for legacy projections; date-aware readers never depend on its timing. */
export async function reconcileOperationalUnitPeriods(db: Firestore, hrDb: Firestore, date: string) {
  const users = db.collection('users');
  const [due, pending] = await Promise.all([
    users.where('nextOperationalUnitChangeDate', '<=', date).limit(100).get(),
    users.where('operationalProjectionSyncPending', '==', true).limit(100).get(),
  ]);
  let reconciled = 0;
  for (const ref of new Map([...due.docs, ...pending.docs].map((doc) => [doc.id, doc.ref])).values()) {
    const projection = await db.runTransaction(async (transaction) => {
      const current = await transaction.get(ref);
      const periods = current.get('operationalUnitPeriods') as Period[] | undefined;
      if (!Array.isArray(periods) || !periods.length || periods.some((period) => !/^\d{4}-\d{2}-\d{2}$/.test(period.validFrom) || !Array.isArray(period.unitIds))) return null;
      const period = periods.find((item) => item.validFrom <= date && (!item.validTo || item.validTo >= date));
      const unitIds = period?.unitIds ?? [];
      const next = periods.find((item) => item.validFrom > date)?.validFrom;
      const unitsChanged = JSON.stringify(current.get('unitIds') ?? []) !== JSON.stringify(unitIds);
      if (unitsChanged) {
        transaction.create(ref.collection('operationalUnitAudit').doc(), { actorId: 'system', action: 'scheduled_period_activated',
          before: current.get('unitIds') ?? [], after: unitIds, effectiveDate: date, createdAt: Timestamp.now() });
      }
      // Quiosques atribuídos e acessos ao PDV seguem a vigência; a rota do job conclui o acompanhamento.
      // Se já havia pendência, mantém as unidades de origem dela para o PDV comparar com o estado anterior real.
      const followUp = unitsChanged ? {
        operationalFollowUpPending: true,
        operationalFollowUpAttempts: 0,
        ...(current.get('operationalFollowUpPending') === true ? {} : { operationalFollowUpFromUnitIds: current.get('unitIds') ?? [] }),
      } : {};
      transaction.update(ref, { unitIds, operationalProjectionDate: date, operationalProjectionSyncPending: true,
        nextOperationalUnitChangeDate: next ?? FieldValue.delete(), ...followUp });
      return { unitIds, fingerprint: JSON.stringify(periods), financial: current.get('unitId') ?? null,
        employeeId: current.get('hrEmployeeId') || current.get('registrationIdBizneo') || current.id };
    });
    if (!projection) continue;
    try {
      const employee = hrDb.collection('employees').doc(String(projection.employeeId));
      if ((await employee.get()).exists) await employee.set({ unit_ids: projection.unitIds,
        ...(projection.financial ? { unit_id: projection.financial } : {}), updated_at: Timestamp.now() }, { merge: true });
      await db.runTransaction(async (transaction) => {
        const latest = await transaction.get(ref);
        if (JSON.stringify(latest.get('operationalUnitPeriods')) === projection.fingerprint
          && JSON.stringify(latest.get('unitIds')) === JSON.stringify(projection.unitIds)) {
          transaction.update(ref, { operationalProjectionSyncPending: false });
        }
      });
      reconciled++;
    } catch {
      // Main remains authoritative; the pending marker guarantees the next bounded retry.
    }
  }
  return { inspected: new Set([...due.docs, ...pending.docs].map((doc) => doc.id)).size, reconciled };
}
