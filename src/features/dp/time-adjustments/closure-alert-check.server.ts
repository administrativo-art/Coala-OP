import 'server-only';

import type { Firestore, Transaction } from 'firebase-admin/firestore';
import { canAccessUnit, getLinkedUnitIds } from '@/lib/unit-access';
import type { ServerUserContext } from '@/lib/auth-server';
import { AppError } from '@/lib/observability/app-error';
import { buildMonthView, type DayTreatment } from '../rep-p/day-model';
import { policyRulesEnabled } from '../time-config/rollout.server';
import { readRepPMonthOfPerson } from '../rep-p/own-month.server';
import { closureClassificationRef, readClosureMarkings } from '../rep-p/service.server';
import { competenceRange, sha256, type ClosurePerson } from './closure-core';
import { blockingClosureIncidents, type ClosureAlert } from './closure-alerts';

type Sources = { mainDb: Firestore; hrDb: Firestore; repDb: Firestore };

export async function readPersonAlertSources(dbs: Sources, workspaceId: string, competence: string, uid: string) {
  const { start, end } = competenceRange(competence);
  const user = await dbs.mainDb.collection('users').doc(uid).get();
  const [schedule, markings] = await Promise.all([
    readRepPMonthOfPerson([uid, user.get('hrEmployeeId')], competence, { db: dbs.mainDb, hrDb: dbs.hrDb }),
    readClosureMarkings(dbs.repDb, workspaceId, uid, start, end, { mainDb: dbs.mainDb, hrDb: dbs.hrDb }),
  ]);
  if (schedule.truncated) throw new AppError({ code: 'PTRP_CLOSURE_ALERT_INPUT_LIMIT', kind: 'CONFLICT', safeMessage: 'A escala está incompleta para conferir os alertas.' });
  return { schedule, markings, fallbackUnits: getLinkedUnitIds(user.data() ?? {}) };
}

export type AlertSources = Awaited<ReturnType<typeof readPersonAlertSources>>;
export async function checkPersonAlerts(dbs: Sources, actor: ServerUserContext, competence: string, expectedVersion: number,
  person: ClosurePerson, treatments: DayTreatment[], tx?: Transaction, preloaded?: AlertSources) {
  const uid = person.uid;
  const { schedule, markings, fallbackUnits } = preloaded ?? await readPersonAlertSources(dbs, actor.workspace_id, competence, uid);
  const refs = markings.map((marking) => closureClassificationRef(dbs.hrDb, marking.receiptId));
  const overlays = refs.length ? await (tx ? tx.getAll(...refs) : dbs.hrDb.getAll(...refs)) : [];
  const days = buildMonthView({ month: competence, today: '9999-12-31', shifts: schedule.shifts,
    markings: markings.map((marking, index) => ({ ...marking, classification: overlays[index].get('classification') ?? marking.classification })),
    treatments, absences: person.absences });
  const result: Array<{ alert: ClosureAlert; inScope: boolean }> = [];
  for (const day of days) {
    const incidents = blockingClosureIncidents(day, policyRulesEnabled());
    if (!incidents.length) continue;
    const shifts = schedule.shifts.filter((shift) => shift.date === day.date);
    const dayUnits = [...new Set([...shifts.map((shift) => shift.unitId), ...day.markings.map((m) => m.executionUnitId)].filter((unit): unit is string => Boolean(unit)))].sort();
    const unitIds = dayUnits.length ? dayUnits : [...fallbackUnits].sort();
    const inScope = actor.isDefaultAdmin || (unitIds.length > 0 && unitIds.every((id) => canAccessUnit(actor.userDoc, id)));
    const fingerprint = sha256({ workspaceId: actor.workspace_id, competence, expectedVersion, uid, date: day.date, incidents, unitIds,
      shifts, markings: day.allMarkings, absence: day.absence, treatments: treatments.filter((item) => item.workDate === day.date) });
    result.push({ alert: { employeeUid: uid, date: day.date, incidents, fingerprint, unitIds }, inScope });
  }
  return result;
}
