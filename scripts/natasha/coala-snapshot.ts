import {
  natashaRosterSnapshotSchema,
  type NatashaRosterSnapshot,
} from '../../src/lib/natasha-roster-validator';

export type CoalaReadDocument = {
  id: string;
  data: Record<string, unknown>;
  updateTime?: string;
};

export type CoalaSnapshotSources = {
  period: string;
  unitIds: string[];
  units: CoalaReadDocument[];
  schedules: CoalaReadDocument[];
  shiftsBySchedule: Record<string, CoalaReadDocument[]>;
  vacations: CoalaReadDocument[];
  historyConfirmed: boolean;
  allUnitsConfirmed: boolean;
};

export class NatashaCollectError extends Error {}

function assertDate(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new NatashaCollectError(`${label}: data inválida.`);
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new NatashaCollectError(`${label}: data inválida.`);
  }
  return value;
}

function assertTime(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) {
    throw new NatashaCollectError(`${label}: horário inválido.`);
  }
  return value;
}

function assertId(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 180 || value.includes('/') || value.includes('::')) {
    throw new NatashaCollectError(`${label}: identificador inválido.`);
  }
  return value;
}

function periodBounds(period: string) {
  if (!/^(20\d{2}|21\d{2})-(0[1-9]|1[0-2])$/.test(period)) {
    throw new NatashaCollectError('Competência inválida; informe AAAA-MM.');
  }
  const first = `${period}-01`;
  const date = new Date(`${first}T00:00:00.000Z`);
  date.setUTCMonth(date.getUTCMonth() + 1);
  const last = new Date(date.getTime() - 86400000).toISOString().slice(0, 10);
  const historyFrom = new Date(Date.parse(`${first}T00:00:00.000Z`) - 14 * 86400000).toISOString().slice(0, 10);
  const previous = new Date(Date.parse(`${first}T00:00:00.000Z`) - 86400000).toISOString().slice(0, 10);
  return { first, last, historyFrom, previous, previousPeriod: previous.slice(0, 7) };
}

function weekday(date: string) {
  return new Date(`${date}T00:00:00.000Z`).getUTCDay();
}

function classifySlot(shift: { date: string; startTime: string; endTime: string }, unit: CoalaReadDocument) {
  const operatingHours = unit.data.operatingHours;
  if (!operatingHours || typeof operatingHours !== 'object' || Array.isArray(operatingHours)) return undefined;
  const day = (operatingHours as Record<string, unknown>)[String(weekday(shift.date))];
  if (!day || typeof day !== 'object' || Array.isArray(day)) return undefined;
  const hours = day as Record<string, unknown>;
  if (hours.isOpen !== true) return undefined;
  const start = typeof hours.startTime === 'string' ? hours.startTime : '';
  const end = typeof hours.endTime === 'string' ? hours.endTime : '';
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(start) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(end) || end <= start) return undefined;
  if (shift.endTime <= start || shift.startTime >= end) return undefined;
  if (shift.startTime <= start && shift.endTime >= end) return 'single' as const;
  if (shift.startTime <= start) return 'opening' as const;
  if (shift.endTime >= end) return 'closing' as const;
  return 'intermediate' as const;
}

function schedulePeriod(document: CoalaReadDocument) {
  const year = Number(document.data.year);
  const month = Number(document.data.month);
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    throw new NatashaCollectError('Escala consultada com competência inválida.');
  }
  return `${year}-${String(month).padStart(2, '0')}`;
}

export function buildNatashaSnapshotFromCoala(source: CoalaSnapshotSources) {
  const { first, last, historyFrom, previous, previousPeriod } = periodBounds(source.period);
  const unitIds = source.unitIds.map((id) => assertId(id, 'Unidade'));
  if (unitIds.length < 1 || unitIds.length > 5 || new Set(unitIds).size !== unitIds.length) {
    throw new NatashaCollectError('Informe de uma a cinco unidades distintas.');
  }
  const units = new Map(source.units.map((unit) => [unit.id, unit]));
  for (const id of unitIds) {
    const unit = units.get(id);
    if (!unit || unit.data.isArchived === true) throw new NatashaCollectError(`Unidade ausente ou arquivada: ${id}.`);
  }

  const schedules = new Map<string, CoalaReadDocument>();
  for (const document of source.schedules) {
    const period = schedulePeriod(document);
    if (period !== source.period && period !== previousPeriod) continue;
    const unitId = document.data.unitId;
    if (typeof unitId !== 'string' || !unitId) {
      throw new NatashaCollectError(`Escala legada sem unidade em ${period}; a abrangência precisa ser resolvida antes da coleta.`);
    }
    if (!unitIds.includes(unitId)) continue;
    const key = `${period}::${unitId}`;
    if (schedules.has(key)) throw new NatashaCollectError(`Mais de uma escala para ${unitId} em ${period}.`);
    schedules.set(key, document);
  }

  const missingPriorUnitIds = unitIds.filter((id) => !schedules.has(`${previousPeriod}::${id}`));
  const missingTargetUnitIds = unitIds.filter((id) => !schedules.has(`${source.period}::${id}`));
  const shifts: NatashaRosterSnapshot['shifts'] = [];
  const dayOffs: NatashaRosterSnapshot['dayOffs'] = [];
  const people = new Map<string, string>();
  const sourceScheduleIds: string[] = [];

  for (const [key, schedule] of schedules) {
    const [scheduleMonth, unitId] = key.split('::');
    const documents = source.shiftsBySchedule[schedule.id];
    if (!documents) throw new NatashaCollectError(`Turnos da escala ${schedule.id} não foram consultados.`);
    if (documents.length > 300) throw new NatashaCollectError(`Limite de turnos da escala ${schedule.id} alcançado.`);
    sourceScheduleIds.push(schedule.id);
    for (const document of documents) {
      const data = document.data;
      const date = assertDate(data.date, 'Turno');
      if (scheduleMonth === source.period ? date < first || date > last : date < historyFrom || date > previous) {
        throw new NatashaCollectError(`Turno fora da janela consultada na escala ${schedule.id}.`);
      }
      const employeeId = assertId(data.userId, 'Colaboradora do turno');
      if (data.unitId !== unitId) throw new NatashaCollectError(`Unidade divergente no turno da escala ${schedule.id}.`);
      if (typeof data.userName === 'string' && data.userName.trim()) people.set(employeeId, data.userName.trim());
      if (data.type === 'day_off') {
        dayOffs.push({ employeeId, date });
        continue;
      }
      if (data.type !== 'work' && data.type !== undefined) {
        throw new NatashaCollectError(`Tipo de turno desconhecido na escala ${schedule.id}.`);
      }
      const startTime = assertTime(data.startTime, 'Início do turno');
      const endTime = assertTime(data.endTime, 'Fim do turno');
      if (endTime <= startTime) throw new NatashaCollectError(`Turno com horário invertido na escala ${schedule.id}.`);
      const slot = classifySlot({ date, startTime, endTime }, units.get(unitId)!);
      shifts.push({
        id: `${schedule.id}:${document.id}`, employeeId, unitId, date, startTime, endTime,
        ...(slot ? { slot } : {}),
      });
    }
  }

  const relevantEmployees = new Set(shifts.map((shift) => shift.employeeId));
  const vacations: NatashaRosterSnapshot['vacations'] = [];
  for (const document of source.vacations) {
    const data = document.data;
    if (typeof data.userId !== 'string' || !relevantEmployees.has(data.userId)) continue;
    const status = data.status === 'APPROVED' ? 'approved'
      : data.status === 'REJECTED' ? 'rejected' : 'pending';
    if (data.recordType !== 'gozo' && data.recordType !== 'venda') {
      throw new NatashaCollectError('Tipo de férias desconhecido para colaboradora relevante.');
    }
    const startDate = assertDate(data.startDate, 'Início das férias');
    const endDate = assertDate(data.endDate, 'Fim das férias');
    if (endDate < startDate) throw new NatashaCollectError('Período de férias invertido.');
    if (endDate < first || startDate > last) continue;
    vacations.push({
      employeeId: data.userId, startDate, endDate,
      recordType: data.recordType === 'gozo' ? 'gozo' : 'other',
      status,
    });
  }

  const snapshot = natashaRosterSnapshotSchema.parse({
    period: source.period,
    history: {
      from: historyFrom, through: previous,
      complete: source.historyConfirmed && source.allUnitsConfirmed && missingPriorUnitIds.length === 0,
    },
    shifts, dayOffs, vacations,
    unavailabilities: [],
    fixedAssignments: [],
    fridayMatrix: null,
  });
  return {
    snapshot,
    evidence: {
      selectedUnitIds: unitIds,
      sourceScheduleIds: sourceScheduleIds.sort(),
      missingPriorUnitIds,
      missingTargetUnitIds,
      people: Object.fromEntries([...people].sort(([left], [right]) => left.localeCompare(right))),
      historyConfirmedByRequester: source.historyConfirmed,
      allUnitsConfirmedByRequester: source.allUnitsConfirmed,
      readIsAtomic: false,
      pendingQuestions: [
        'A sexta na matriz vincula Heucilene nominalmente ou a função de líder?',
        'Existem indisponibilidades fora do sistema ou horários especiais neste mês?',
        'Quais datas fixas e intermediários foram definidos para este mês?',
      ],
      slotClassification: 'horário nominal de funcionamento da unidade; códigos numéricos de turno não são interpretados',
      vacationScope: 'somente pessoas presentes nos turnos selecionados; ampliar para equipe candidata antes de gerar escala',
    },
  };
}
