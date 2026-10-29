import 'server-only';

import type { Firestore } from 'firebase-admin/firestore';

import { readRepPMonthOfPerson } from '@/features/dp/rep-p/own-month.server';
import type { ServerUserContext } from '@/lib/auth-server';
import { dbAdmin } from '@/lib/firebase-admin';
import { hrDbAdmin } from '@/lib/firebase-rh-admin';
import { repPDbAdmin } from '@/lib/firebase-rep-p-admin';
import { AppError } from '@/lib/observability/app-error';
import { isEmploymentRelationshipType } from '@/lib/hr/employment-relationship';
import { canAccessUnit } from '@/lib/unit-access';

import type { AdjustmentDayContext, DayMarking, DayShift, DayTreatment } from './day-summary';
import { canReview, DAY_MARKINGS_LIMIT, readAdjustmentHistoryDocuments, readAdjustmentRequestForDay, readDayMarkingDocuments, readDayTreatmentDocuments } from './service.server';
import { pilotTreatmentsOf, type PilotTreatmentSource } from './pilot-treatments';

type Dependencies = { mainDb: Firestore; hrDb: Firestore; repDb: Firestore };
const defaults: Dependencies = { mainDb: dbAdmin, hrDb: hrDbAdmin, repDb: repPDbAdmin };

const PURPOSES = new Set(['journey_start', 'break_start', 'break_end', 'journey_end']);

function fail(code: string, safeMessage: string, kind: 'NOT_FOUND' | 'AUTHORIZATION' = 'NOT_FOUND') {
  return new AppError({ code, kind, safeMessage });
}
const text = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : null);
function daysBefore(date: string, days: number) {
  const value = new Date(Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)) - days));
  return value.toISOString().slice(0, 10);
}

/**
 * O dia inteiro de um pedido de ajuste, para a análise: batidas do dia (oficiais ou do ensaio, conforme o pedido),
 * tratamentos já aprovados, turno escalado e um resumo do histórico da pessoa. Só leitura; vale a mesma regra da fila
 * (permissão de análise, unidades acessíveis, nunca o próprio pedido).
 *
 * Custo por abertura do painel: 1 pedido + 1 consulta de batidas do dia + 1 de tratamentos + 1 usuário + a escala do
 * mês (escalas do mês, turnos da pessoa ≤62 e cadastros citados) + 2 consultas de histórico (≤60 cada). Sem polling.
 * As leituras das coleções protegidas do ponto ficam em `service.server.ts`.
 */
export async function readAdjustmentDayContext(context: ServerUserContext, adjustmentId: string, injected: Partial<Dependencies> = {}): Promise<AdjustmentDayContext> {
  if (!canReview(context)) throw fail('PTRP_ADJUSTMENT_REVIEW_FORBIDDEN', 'Sem permissão para analisar ajustes de ponto.', 'AUTHORIZATION');
  const deps = { ...defaults, ...injected };
  const { scope, snapshot: request } = await readAdjustmentRequestForDay(deps, adjustmentId);
  if (!request.exists || request.get('workspaceId') !== context.workspace_id) throw fail('PTRP_ADJUSTMENT_NOT_FOUND', 'Pedido não encontrado.');
  const employeeUid = String(request.get('employeeUid'));
  const workDate = String(request.get('workDate'));
  const unitIds = (request.get('unitIds') as string[] | undefined)?.length ? (request.get('unitIds') as string[]) : [String(request.get('unitId'))];
  if (employeeUid === context.decoded.uid) throw fail('PTRP_ADJUSTMENT_SELF_DECISION', 'Quem pediu não analisa o próprio ajuste.', 'AUTHORIZATION');
  if (!unitIds.every((unitId) => canAccessUnit(context.userDoc, unitId, { isDefaultAdmin: context.isDefaultAdmin }))) {
    throw fail('PTRP_ADJUSTMENT_REVIEW_FORBIDDEN', 'Sem permissão para analisar este pedido.', 'AUTHORIZATION');
  }

  const workspaceId = context.workspace_id;
  const [markings, treatments, user, [officialHistory, pilotHistory]] = await Promise.all([
    readDayMarkingDocuments(deps, scope, workspaceId, employeeUid, workDate),
    // O ensaio não grava tratamento; o dele é derivado dos pedidos aprovados do dia (abaixo).
    scope === 'official' ? readDayTreatmentDocuments(deps, workspaceId, employeeUid, workDate) : Promise.resolve(null),
    deps.mainDb.collection('users').doc(employeeUid).get(),
    readAdjustmentHistoryDocuments(deps, workspaceId, employeeUid, daysBefore(workDate, 30), workDate),
  ]);
  const month = await readRepPMonthOfPerson([employeeUid, user.id, text(user.get('hrEmployeeId'))], workDate.slice(0, 7), { db: deps.mainDb });

  const dayMarkings: DayMarking[] = markings.docs.slice(0, DAY_MARKINGS_LIMIT).flatMap((document) => {
    const markedAt = text(document.get('markedAt')) ?? text(document.get('snapshot.markedAt'));
    if (!markedAt) return [];
    const purpose = text(document.get('classification.purpose'));
    const collector = text(document.get('collectorId')) ?? text(document.get('snapshot.collectorId'));
    return [{
      receiptId: document.id, markedAt,
      nsr: Number(document.get('nsr') ?? document.get('snapshot.nsr') ?? document.get('sequence') ?? 0),
      executionUnitId: text(document.get('executionUnitId')) ?? text(document.get('snapshot.executionUnitId')),
      purpose: purpose && PURPOSES.has(purpose) ? purpose : null,
      channel: collector === '01' ? 'app' as const : collector === '02' ? 'web' as const : null,
    }];
  }).sort((left, right) => left.markedAt.localeCompare(right.markedAt) || left.nsr - right.nsr);

  const pilotTreatments = scope === 'pilot'
    ? pilotTreatmentsOf(pilotHistory.docs.filter((document) => document.get('workDate') === workDate)
      .map((document) => document.data() as PilotTreatmentSource))
    : [];
  const dayTreatments: DayTreatment[] = [
    ...(treatments?.docs ?? []).filter((document) => document.get('status') === 'active').map((document) => ({
      adjustmentId: String(document.get('adjustmentId')),
      type: document.get('type') as 'discard' | 'inclusion',
      originalReceiptId: text(document.get('originalReceiptId')),
      markedAt: text(document.get('markedAt')),
    })),
    ...pilotTreatments.map((treatment) => ({ adjustmentId: treatment.adjustmentId, type: treatment.type,
      originalReceiptId: treatment.originalReceiptId, markedAt: treatment.markedAt })),
  ];

  const shifts: DayShift[] = month.shifts.filter((shift) => shift.date === workDate && shift.type === 'work').map((shift) => ({
    startTime: shift.startTime, endTime: shift.endTime, overnight: shift.overnight, shiftName: shift.shiftName, unitName: shift.unitName,
    breakType: shift.breakType, breakStart: shift.breakStart, breakEnd: shift.breakEnd, breakDurationMinutes: shift.breakDurationMinutes,
    toleranceMinutes: shift.toleranceMinutes, referenceMinutes: shift.referenceMinutes, expectedPunches: shift.expectedPunches,
  }));

  const others = [...officialHistory.docs, ...pilotHistory.docs].filter((document) => document.id !== adjustmentId);
  return {
    adjustmentId, workDate, scope, markings: dayMarkings, treatments: dayTreatments, shifts,
    relationship: isEmploymentRelationshipType(user.get('employmentRelationshipType')) ? user.get('employmentRelationshipType') : null,
    history: {
      otherRequestsSameDay: others.filter((document) => document.get('workDate') === workDate && document.get('status') !== 'cancelled').length,
      approvedInPrevious30Days: others.filter((document) => document.get('workDate') !== workDate && document.get('status') === 'approved').length,
    },
    truncated: markings.size > DAY_MARKINGS_LIMIT || month.truncated,
  };
}
