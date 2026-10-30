import 'server-only';

import { Timestamp, type Firestore } from 'firebase-admin/firestore';

import type { ServerUserContext } from '@/lib/auth-server';
import { dbAdmin } from '@/lib/firebase-admin';
import { repPDbAdmin } from '@/lib/firebase-rep-p-admin';
import { hrDbAdmin } from '@/lib/firebase-rh-admin';
import { AppError } from '@/lib/observability/app-error';
import { reportSystemError } from '@/lib/observability/reporter';
import { canAccessUnit, canAccessUserByUnit } from '@/lib/unit-access';

import type { AbsenceRequestRecord } from '@/features/dp/absences/requests/workflow-types';
import { listAdjustmentsOfPerson } from '@/features/dp/time-adjustments/service.server';
import { canReadEmployeeTimeRecording } from './employee-time-access.server';
import { readRepPMonthOfPerson } from './own-month.server';
import { LOCATION_ACCESS_AUDIT } from './location-access.server';
import { listRepPMarkingsOfPerson } from './service.server';

export { canReadEmployeeTimeRecording } from './employee-time-access.server';

const ABSENCES = 'dp_absenceRequests';
const MONTH_ITEM_LIMIT = 200;

function fail(code: string, safeMessage: string, kind: 'VALIDATION' | 'AUTHORIZATION' | 'NOT_FOUND' = 'AUTHORIZATION') {
  return new AppError({ code, kind, safeMessage });
}

function addDays(date: string, days: number) {
  return new Date(Date.parse(`${date}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/**
 * Visão mensal de conferência do DP. A autorização é somente leitura e ainda respeita o escopo de unidades;
 * registrar batida continua exclusivo do titular nas rotas próprias do REP-P.
 */
type MonthHistory = Awaited<ReturnType<typeof listRepPMarkingsOfPerson>>;

/**
 * Terceiros só veem o resultado da localização das batidas com registro de quem viu (política interna de localização).
 * Um registro por leitura do mês, sem coordenadas nem distâncias; se não gravar, a localização sai da resposta.
 */
async function auditLocationResults(context: ServerUserContext, employeeUid: string, month: string, history: MonthHistory,
  viewedAt: Date, db: Firestore) {
  const shown = history.markings.filter((marking) => marking.location);
  if (!shown.length) return;
  try {
    await db.collection(LOCATION_ACCESS_AUDIT).doc().create({ schemaVersion: 1, workspaceId: context.workspace_id,
      actorUid: context.decoded.uid, employeeUid, month, source: 'month_result', role: 'authorized_staff',
      executionUnitIds: [...new Set(shown.map((marking) => marking.executionUnitId))].sort(),
      evidenceIds: shown.map((marking) => marking.receiptId), count: shown.length,
      viewedAt: Timestamp.fromDate(viewedAt), expiresAt: Timestamp.fromMillis(viewedAt.getTime() + 1_825 * 86_400_000) });
  } catch (cause) {
    for (const marking of history.markings) marking.location = null;
    reportSystemError({ error: cause, source: 'rep-p', operation: 'audit-month-location-results',
      code: 'REP_P_LOCATION_RESULT_AUDIT_FAILED', kind: 'TRANSIENT_EXTERNAL', severity: 'medium', isTerminal: false,
      metadata: { month, count: shown.length } });
  }
}

export async function readEmployeeTimeRecordingMonth(context: ServerUserContext, employeeUid: string, month: string,
  injected: { locationAuditDb?: Firestore } = {}) {
  if (!canReadEmployeeTimeRecording(context)) {
    throw fail('REP_P_EMPLOYEE_MONTH_FORBIDDEN', 'Sem permissão para consultar o ponto de colaboradores.');
  }
  const employee = await dbAdmin.collection('users').doc(employeeUid).get();
  if (!employee.exists || !canAccessUserByUnit(context.userDoc, employee.data() ?? {}, { isDefaultAdmin: context.isDefaultAdmin })) {
    throw fail('REP_P_EMPLOYEE_MONTH_NOT_FOUND', 'Colaborador não encontrado.', 'NOT_FOUND');
  }

  const startDate = `${month}-01`;
  const [year, monthNumber] = month.split('-').map(Number);
  const endDate = `${month}-${String(new Date(Date.UTC(year, monthNumber, 0)).getUTCDate()).padStart(2, '0')}`;
  const identifiers = [employeeUid, typeof employee.get('hrEmployeeId') === 'string' ? String(employee.get('hrEmployeeId')) : null];

  const [schedule, history, adjustmentPayload, absenceSnapshot] = await Promise.all([
    readRepPMonthOfPerson(identifiers, month),
    listRepPMarkingsOfPerson(context.workspace_id, employeeUid, { startDate, endDate }, {}, {
      // Localização exige concessão expressa, além da consulta do ponto e do acesso à unidade da batida.
      locationVisible: context.permissions.dp?.view === true && context.permissions.dp?.timeRecording?.readLocation === true
        ? (unitId) => canAccessUnit(context.userDoc, unitId, { isDefaultAdmin: context.isDefaultAdmin }) : undefined,
    }),
    listAdjustmentsOfPerson(context.workspace_id, employeeUid, { month }),
    hrDbAdmin.collection(ABSENCES).where('workspaceId', '==', context.workspace_id)
      .where('beneficiaryUid', '==', employeeUid).where('startDate', '>=', addDays(startDate, -366))
      .where('startDate', '<=', endDate).orderBy('startDate', 'desc').limit(MONTH_ITEM_LIMIT + 1).get(),
  ]);
  if (absenceSnapshot.size > MONTH_ITEM_LIMIT) {
    throw fail('REP_P_EMPLOYEE_MONTH_ABSENCES_TRUNCATED', 'Há ausências demais para montar o mês com segurança.', 'VALIDATION');
  }

  const absences = absenceSnapshot.docs.map((document) => document.data() as AbsenceRequestRecord)
    .filter((record) => record.endDate >= startDate && !['draft', 'cancelled', 'rejected'].includes(record.status))
    .map((record) => ({
      id: record.id,
      typeName: record.typeSnapshot?.name ?? record.typeId,
      status: record.status,
      startDate: record.startDate,
      endDate: record.endDate,
      approvedByInaction: record.approvalOrigin === 'tacit_timeout',
    }));

  // A evidência existe somente quando a política vigente na batida autorizou a coleta. Ela é a decisão
  // histórica estável; a definição atual do turno não pode mudar retroativamente o que o detalhe exibe.

  const unitIds = [...new Set([
    ...schedule.shifts.map((shift) => shift.unitId),
    ...history.markings.map((marking) => marking.executionUnitId),
  ].filter((value): value is string => Boolean(value)))].slice(0, 100);
  const units = unitIds.length ? await dbAdmin.getAll(...unitIds.map((id) => dbAdmin.collection('dp_units').doc(id))) : [];

  const result = {
    employee: { uid: employeeUid, name: typeof employee.get('username') === 'string' ? String(employee.get('username')) : 'Colaborador' },
    schedule,
    history,
    absences,
    adjustments: adjustmentPayload.adjustments,
    treatments: adjustmentPayload.treatments,
    unitNames: Object.fromEntries(units.filter((unit) => unit.exists).map((unit) => [unit.id, String(unit.get('name') ?? 'Unidade')])),
  };
  const viewedAt = new Date();
  await auditLocationResults(context, employeeUid, month, result.history, viewedAt, injected.locationAuditDb ?? repPDbAdmin);
  await hrDbAdmin.collection('dp_timeRecordingAccessAudit').add({
    workspaceId: context.workspace_id,
    actorUid: context.decoded.uid,
    employeeUid,
    month,
    action: 'employee_month_viewed',
    viewedAt: viewedAt.toISOString(),
    expiresAt: new Date(viewedAt.getTime() + 1_825 * 86_400_000),
  });
  return result;
}
