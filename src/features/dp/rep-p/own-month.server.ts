import 'server-only';

import type { Firestore } from 'firebase-admin/firestore';

import type { ServerUserContext } from '@/lib/auth-server';
import { dbAdmin } from '@/lib/firebase-admin';
import { AppError } from '@/lib/observability/app-error';

import { repPOwnMonthSchema } from './schemas';

/** Turno escalado da própria pessoa num dia, com o intervalo do cadastro do turno; nunca dado fiscal. */
export type RepPOwnScheduledShift = {
  date: string;
  type: 'work' | 'day_off';
  startTime: string | null;
  endTime: string | null;
  overnight: boolean;
  unitId: string | null;
  unitName: string | null;
  shiftName: string | null;
  breakType: 'none' | 'fixed' | 'flexible' | 'staggered';
  breakStart: string | null;
  breakEnd: string | null;
  breakDurationMinutes: number | null;
  breakWindowStart: string | null;
  breakWindowEnd: string | null;
  expectedPunches: number | null;
  executionUnitPolicy: 'scheduled' | 'free';
};

// Um mês tem no máximo 31 dias; dois turnos por dia cobrem trocas e coberturas sem ler mais que o necessário.
const MAX_OWN_SHIFTS = 62;

type Dependencies = { db: Firestore };
const defaults: Dependencies = { db: dbAdmin };

function text(value: unknown) { return typeof value === 'string' && value.trim() ? value.trim() : null; }
function minutes(value: unknown) { return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null; }
function millis(value: unknown) {
  return value && typeof value === 'object' && 'toMillis' in value && typeof value.toMillis === 'function' ? Number(value.toMillis()) : 0;
}

/**
 * Escala do mês da própria pessoa para o Registro de ponto: lê as escalas do mês (uma por unidade, a trancada
 * e mais recente primeiro, como em Minha escala), só os turnos da pessoa pelo índice userId+date e os cadastros
 * de turno e unidade citados. Custo por abertura: escalas do mês + turnos da pessoa (≤62) + cadastros citados.
 */
export async function readOwnRepPMonth(context: ServerUserContext, raw: unknown, injected: Partial<Dependencies> = {}) {
  const parsed = repPOwnMonthSchema.safeParse(raw);
  if (!parsed.success) throw new AppError({ code: 'REP_P_MONTH_INPUT_INVALID', kind: 'VALIDATION', safeMessage: 'Mês inválido.' });
  const { db } = { ...defaults, ...injected };
  const [year, month] = parsed.data.month.split('-').map(Number);
  const start = `${parsed.data.month}-01`;
  const end = `${parsed.data.month}-${String(new Date(Date.UTC(year, month, 0)).getUTCDate()).padStart(2, '0')}`;
  const ownIds = [...new Set([context.decoded.uid, text(context.userDoc.id), text(context.userDoc.hrEmployeeId)]
    .filter((value): value is string => Boolean(value)))].slice(0, 10);

  const [schedules, shifts] = await Promise.all([
    db.collection('dp_schedules').where('year', '==', year).where('month', '==', month).select('unitId', 'locked', 'createdAt').get(),
    db.collectionGroup('shifts').where('userId', 'in', ownIds).where('date', '>=', start).where('date', '<=', end)
      .orderBy('date', 'asc').limit(MAX_OWN_SHIFTS).get(),
  ]);
  const latestByUnit = new Map<string, string>();
  for (const schedule of [...schedules.docs].sort((left, right) =>
    Number(right.get('locked') === true) - Number(left.get('locked') === true) || millis(right.get('createdAt')) - millis(left.get('createdAt')))) {
    const scope = String(schedule.get('unitId') ?? '__legacy__');
    if (!latestByUnit.has(scope)) latestByUnit.set(scope, schedule.id);
  }
  const official = new Set(latestByUnit.values());
  const ownShifts = shifts.docs.filter((doc) => official.has(doc.ref.parent.parent?.id ?? ''));

  const definitionIds = [...new Set(ownShifts.map((doc) => text(doc.get('shiftDefinitionId'))).filter((value): value is string => Boolean(value)))];
  const unitIds = [...new Set(ownShifts.map((doc) => text(doc.get('unitId'))).filter((value): value is string => Boolean(value)))];
  const [definitions, units] = await Promise.all([
    definitionIds.length ? db.getAll(...definitionIds.map((id) => db.collection('dp_shiftDefinitions').doc(id))) : [],
    unitIds.length ? db.getAll(...unitIds.map((id) => db.collection('dp_units').doc(id))) : [],
  ]);
  const definitionById = new Map(definitions.filter((doc) => doc.exists).map((doc) => [doc.id, doc]));
  const unitNameById = new Map(units.filter((doc) => doc.exists).map((doc) => [doc.id, text(doc.get('name'))]));

  const result: RepPOwnScheduledShift[] = ownShifts.map((doc) => {
    const definition = definitionById.get(text(doc.get('shiftDefinitionId')) ?? '');
    const breakStart = text(definition?.get('breakStart'));
    const breakEnd = text(definition?.get('breakEnd'));
    const declaredBreak = text(definition?.get('breakType'));
    const breakType = (['none', 'fixed', 'flexible', 'staggered'] as const).find((value) => value === declaredBreak)
      ?? (breakStart && breakEnd ? 'fixed' : 'none');
    const unitId = text(doc.get('unitId'));
    return {
      date: String(doc.get('date')),
      type: doc.get('type') === 'day_off' ? 'day_off' : 'work',
      startTime: text(doc.get('startTime')),
      endTime: text(doc.get('endTime')),
      overnight: doc.get('overnight') === true,
      unitId,
      unitName: unitId ? unitNameById.get(unitId) ?? null : null,
      shiftName: text(definition?.get('name')),
      breakType,
      breakStart: breakType === 'fixed' ? breakStart : null,
      breakEnd: breakType === 'fixed' ? breakEnd : null,
      breakDurationMinutes: breakType === 'fixed' && breakStart && breakEnd
        ? Math.max(0, Number(breakEnd.slice(0, 2)) * 60 + Number(breakEnd.slice(3)) - Number(breakStart.slice(0, 2)) * 60 - Number(breakStart.slice(3)))
        : minutes(definition?.get('breakDurationMinutes')),
      breakWindowStart: breakType === 'staggered' ? text(definition?.get('breakWindowStart')) : null,
      breakWindowEnd: breakType === 'staggered' ? text(definition?.get('breakWindowEnd')) : null,
      expectedPunches: minutes(definition?.get('expectedPunches')),
      executionUnitPolicy: definition?.get('executionUnitPolicy') === 'free' ? 'free' : 'scheduled',
    };
  });
  return { month: parsed.data.month, shifts: result, truncated: shifts.size >= MAX_OWN_SHIFTS };
}
