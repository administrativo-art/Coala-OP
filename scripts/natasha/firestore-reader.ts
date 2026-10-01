import { NatashaCollectError, type CoalaReadDocument, type CoalaSnapshotSources } from './coala-snapshot';

const DATABASE = 'coala';
const MAX_SCHEDULES_PER_QUERY = 11;
const MAX_SHIFTS_PER_SCHEDULE = 300;
const MAX_VACATIONS = 300;
const MAX_EMPLOYEES = 50;

type FirestoreValue = Record<string, unknown>;
type FirestoreDocument = {
  name?: string;
  fields?: Record<string, FirestoreValue>;
  updateTime?: string;
};
type QueryRow = { document?: FirestoreDocument };
type FieldValue = { integerValue: string } | { stringValue: string };
type StructuredQuery = Record<string, unknown>;

function decodeValue(value: FirestoreValue): unknown {
  if ('nullValue' in value) return null;
  if ('stringValue' in value) return value.stringValue;
  if ('booleanValue' in value) return value.booleanValue;
  if ('integerValue' in value) return Number(value.integerValue);
  if ('doubleValue' in value) return Number(value.doubleValue);
  if ('timestampValue' in value) return value.timestampValue;
  if ('mapValue' in value) {
    const fields = (value.mapValue as { fields?: Record<string, FirestoreValue> }).fields ?? {};
    return Object.fromEntries(Object.entries(fields).map(([key, nested]) => [key, decodeValue(nested)]));
  }
  if ('arrayValue' in value) {
    const values = (value.arrayValue as { values?: FirestoreValue[] }).values ?? [];
    return values.map(decodeValue);
  }
  return null;
}

function toDocument(value: FirestoreDocument): CoalaReadDocument {
  if (typeof value.name !== 'string' || !value.name.includes('/documents/')) {
    throw new NatashaCollectError('Resposta do Firestore sem caminho de documento válido.');
  }
  const id = value.name.split('/').at(-1) ?? '';
  if (!id || !value.fields || typeof value.fields !== 'object') {
    throw new NatashaCollectError('Resposta do Firestore sem documento ou campos.');
  }
  return {
    id,
    data: Object.fromEntries(Object.entries(value.fields).map(([key, field]) => [key, decodeValue(field)])),
    ...(value.updateTime ? { updateTime: value.updateTime } : {}),
  };
}

function fieldFilter(fieldPath: string, op: string, value: FieldValue) {
  return { fieldFilter: { field: { fieldPath }, op, value } };
}

function and(...filters: ReturnType<typeof fieldFilter>[]) {
  return { compositeFilter: { op: 'AND', filters } };
}

function projection(...paths: string[]) {
  return { fields: paths.map((fieldPath) => ({ fieldPath })) };
}

function scheduleQuery(year: number, yearAsString: boolean, monthValue: FieldValue): StructuredQuery {
  return {
    from: [{ collectionId: 'dp_schedules' }],
    where: and(
      fieldFilter('year', 'EQUAL', yearAsString ? { stringValue: String(year) } : { integerValue: String(year) }),
      fieldFilter('month', 'EQUAL', monthValue),
    ),
    select: projection('year', 'month', 'unitId'),
    limit: MAX_SCHEDULES_PER_QUERY + 1,
  };
}

function shiftQuery(from: string, through: string): StructuredQuery {
  return {
    from: [{ collectionId: 'shifts' }],
    where: and(
      fieldFilter('date', 'GREATER_THAN_OR_EQUAL', { stringValue: from }),
      fieldFilter('date', 'LESS_THAN_OR_EQUAL', { stringValue: through }),
    ),
    select: projection('userId', 'userName', 'unitId', 'date', 'startTime', 'endTime', 'type'),
    limit: MAX_SHIFTS_PER_SCHEDULE + 1,
  };
}

function vacationQuery(employeeId: string, limit: number): StructuredQuery {
  return {
    from: [{ collectionId: 'dp_vacations' }],
    where: fieldFilter('userId', 'EQUAL', { stringValue: employeeId }),
    select: projection('userId', 'startDate', 'endDate', 'status', 'recordType'),
    limit,
  };
}

export type NatashaReadPlan = {
  period: string;
  unitIds: string[];
  historyConfirmed: boolean;
  allUnitsConfirmed: boolean;
};

export function validateNatashaReadPlan(plan: NatashaReadPlan) {
  if (!/^(20\d{2}|21\d{2})-(0[1-9]|1[0-2])$/.test(plan.period)) throw new NatashaCollectError('Competência inválida.');
  if (plan.unitIds.length < 1 || plan.unitIds.length > 5 || new Set(plan.unitIds).size !== plan.unitIds.length) {
    throw new NatashaCollectError('Informe de uma a cinco unidades distintas.');
  }
  for (const id of plan.unitIds) {
    if (!/^[^\s/?#]{1,180}$/.test(id) || id.includes('::')) throw new NatashaCollectError('ID de unidade inválido.');
  }
  return plan;
}

export function createNatashaFirestoreReader(params: {
  token: string;
  projectId: string;
  fetcher?: typeof fetch;
}) {
  if (!params.token || !/^[a-zA-Z0-9-]{1,120}$/.test(params.projectId)) {
    throw new NatashaCollectError('Sessão ou projeto do Coala indisponível.');
  }
  const fetcher = params.fetcher ?? fetch;
  const base = `https://firestore.googleapis.com/v1/projects/${params.projectId}/databases/${DATABASE}/documents`;

  async function request(url: string, init: RequestInit) {
    let response: Response;
    try {
      response = await fetcher(url, {
        ...init,
        headers: { ...init.headers, Authorization: `Bearer ${params.token}` },
        cache: 'no-store',
        redirect: 'error',
        signal: AbortSignal.timeout(30_000),
      });
    } catch {
      throw new NatashaCollectError('Falha ou tempo esgotado na leitura do Firestore.');
    }
    if (!response.ok || response.redirected) {
      throw new NatashaCollectError(`Leitura do Firestore recusada (HTTP ${response.status}); confira a permissão da sessão e os índices.`);
    }
    try {
      return await response.json() as unknown;
    } catch {
      throw new NatashaCollectError('Resposta inválida do Firestore.');
    }
  }

  async function query(parent: string, structuredQuery: StructuredQuery, cap: number) {
    const result = await request(`${base}${parent}:runQuery`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ structuredQuery }),
    });
    if (!Array.isArray(result)) throw new NatashaCollectError('Resultado de consulta do Firestore inválido.');
    const documents = (result as QueryRow[]).flatMap((row) => {
      if (row.document) return [toDocument(row.document)];
      if (Object.keys(row).length === 0 || 'readTime' in row) return [];
      throw new NatashaCollectError('Linha de consulta inesperada do Firestore.');
    });
    if (documents.length > cap) throw new NatashaCollectError('Limite de leitura atingido; o snapshot não foi produzido.');
    return documents;
  }

  async function unit(id: string) {
    const params = new URLSearchParams();
    for (const path of ['name', 'isArchived', 'operatingHours', 'coverageMode']) params.append('mask.fieldPaths', path);
    const result = await request(`${base}/dp_units/${encodeURIComponent(id)}?${params}`, { method: 'GET' });
    if (!result || typeof result !== 'object' || Array.isArray(result)) {
      throw new NatashaCollectError('Documento de unidade inválido.');
    }
    return toDocument(result as FirestoreDocument);
  }

  return {
    async collect(input: NatashaReadPlan): Promise<CoalaSnapshotSources> {
      const plan = validateNatashaReadPlan(input);
      const [year, month] = plan.period.split('-').map(Number);
      const first = `${plan.period}-01`;
      const previousDate = new Date(Date.parse(`${first}T00:00:00.000Z`) - 86400000);
      const previous = previousDate.toISOString().slice(0, 10);
      const previousPeriod = previous.slice(0, 7);
      const historyFrom = new Date(Date.parse(`${first}T00:00:00.000Z`) - 14 * 86400000).toISOString().slice(0, 10);
      const nextMonth = new Date(`${first}T00:00:00.000Z`);
      nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1);
      const last = new Date(nextMonth.getTime() - 86400000).toISOString().slice(0, 10);

      const units = await Promise.all(plan.unitIds.map((id) => unit(id)));
      const periods = [[year, month], [Number(previous.slice(0, 4)), Number(previous.slice(5, 7))]];
      const batches = await Promise.all(periods.flatMap(([queryYear, queryMonth]) => {
        const monthValues: FieldValue[] = [
          { integerValue: String(queryMonth) },
          { stringValue: String(queryMonth) },
        ];
        if (queryMonth < 10) monthValues.push({ stringValue: String(queryMonth).padStart(2, '0') });
        return [false, true].flatMap((yearAsString) => monthValues.map((monthValue) =>
          query('', scheduleQuery(queryYear, yearAsString, monthValue), MAX_SCHEDULES_PER_QUERY)
        ));
      }));
      const schedules = [...new Map(batches.flat().map((document) => [document.id, document])).values()];
      const selectedSchedules = schedules.filter((document) => plan.unitIds.includes(String(document.data.unitId ?? '')) || !document.data.unitId);
      if (selectedSchedules.length > plan.unitIds.length * 2 + 1) {
        throw new NatashaCollectError('Escalas duplicadas ou excessivas para as unidades escolhidas.');
      }

      const shiftBatches = await Promise.all(selectedSchedules.map(async (schedule) => {
        const schedulePeriod = `${Number(schedule.data.year)}-${String(Number(schedule.data.month)).padStart(2, '0')}`;
        const from = schedulePeriod === previousPeriod ? historyFrom : first;
        const through = schedulePeriod === previousPeriod ? previous : last;
        const rows = await query(`/dp_schedules/${encodeURIComponent(schedule.id)}`, shiftQuery(from, through), MAX_SHIFTS_PER_SCHEDULE);
        return [schedule.id, rows] as const;
      }));
      const employeeIds = [...new Set(shiftBatches.flatMap(([, rows]) => rows.map((row) => row.data.userId)
        .filter((value): value is string => typeof value === 'string' && Boolean(value))))].sort();
      if (employeeIds.length > MAX_EMPLOYEES) throw new NatashaCollectError('Limite de colaboradores da revisão atingido.');
      const vacations: CoalaReadDocument[] = [];
      for (const employeeId of employeeIds) {
        const remaining = MAX_VACATIONS - vacations.length;
        if (remaining < 1) throw new NatashaCollectError('Limite de férias da revisão atingido.');
        const rows = await query('', vacationQuery(employeeId, remaining + 1), remaining);
        vacations.push(...rows);
      }
      return {
        period: plan.period,
        unitIds: plan.unitIds,
        units,
        schedules: selectedSchedules,
        shiftsBySchedule: Object.fromEntries(shiftBatches),
        vacations,
        historyConfirmed: plan.historyConfirmed,
        allUnitsConfirmed: plan.allUnitsConfirmed,
      };
    },
  };
}

export const NATASHA_FIRESTORE_LIMITS = {
  maxUnits: 5,
  maxSchedulesPerQuery: MAX_SCHEDULES_PER_QUERY,
  maxShiftsPerSchedule: MAX_SHIFTS_PER_SCHEDULE,
  maxVacations: MAX_VACATIONS,
  maxEmployees: MAX_EMPLOYEES,
} as const;
