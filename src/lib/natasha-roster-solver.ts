import { z } from 'zod';

import { validateNatashaCoverage, type NatashaCoveragePlan } from './natasha-roster-coverage';
import { assessNatashaProposalInputs, type NatashaProposalInputs, type NatashaPreflightReport } from './natasha-proposal-preflight';
import { validateNatashaRoster, type NatashaRosterSnapshot } from './natasha-roster-validator';

const MIN_REST_MINUTES = 11 * 60;
const DAY_MS = 86400000;

export const natashaSolverOptionsSchema = z.object({
  maxNodes: z.number().int().min(1).max(200000).default(30000),
  maxAlternatives: z.number().int().min(1).max(5).default(3),
  minDifferentAssignments: z.number().int().min(1).max(500).optional(),
  weights: z.object({
    openingAfterClosing: z.number().int().min(0).max(1000).default(10),
    shiftSpread: z.number().int().min(0).max(1000).default(1),
    sundaySpread: z.number().int().min(0).max(1000).default(3),
    saraMix: z.number().int().min(0).max(1000).default(5),
  }).strict().default({}),
  saraPreference: z.object({
    employeeId: z.string().trim().min(1).max(180),
    tiriricalUnitId: z.string().trim().min(1).max(180),
    shoppingUnitId: z.string().trim().min(1).max(180),
  }).strict().nullable().default(null),
}).strict();

export type NatashaSolverOptions = z.input<typeof natashaSolverOptionsSchema>;
type ParsedOptions = z.output<typeof natashaSolverOptionsSchema>;
type WorkShift = NatashaRosterSnapshot['shifts'][number];
type Position = NatashaProposalInputs['positions'][number];
type WorkSpan = { date: string; start: number; end: number };
type Mandate = { employeeId: string; unitId: string; date: string };

export type NatashaAlternativeMetrics = {
  openingAfterClosing: number;
  shiftSpread: number;
  sundaySpread: number;
  saraMix: number;
};
export type NatashaAlternative = {
  label: string;
  score: number;
  metrics: NatashaAlternativeMetrics;
  differenceFromBest: number;
  assignments: Array<{
    positionId: string;
    employeeId: string;
    unitId: string;
    date: string;
    startTime: string;
    endTime: string;
    slot: Position['slot'];
  }>;
};
export type NatashaSolverReport = {
  period: string;
  status: 'not_ready' | 'alternatives' | 'infeasible' | 'search_limit';
  preflight: NatashaPreflightReport;
  search: {
    nodesVisited: number;
    feasibleSolutionsSeen: number;
    limitReached: boolean;
    exhaustive: boolean;
    maxNodes: number;
    minDifferentAssignments: number;
  };
  weights: ParsedOptions['weights'];
  alternatives: NatashaAlternative[];
  caveat: string;
};

function dayNumber(date: string): number {
  return Date.parse(`${date}T00:00:00.000Z`) / DAY_MS;
}

function minute(time: string): number {
  const [hour, rest] = time.split(':').map(Number);
  return hour * 60 + rest;
}

function span(date: string, startTime: string, endTime: string): WorkSpan {
  const origin = dayNumber(date) * 1440;
  return { date, start: origin + minute(startTime), end: origin + minute(endTime) };
}

function isSunday(date: string): boolean {
  return new Date(`${date}T00:00:00.000Z`).getUTCDay() === 0;
}

function hardCompatible(existing: readonly WorkSpan[], candidate: WorkSpan): boolean {
  const all = [...existing, candidate].sort((left, right) => left.start - right.start);
  for (let index = 1; index < all.length; index += 1) {
    if (all[index].start - all[index - 1].end < MIN_REST_MINUTES) return false;
  }
  const dates = [...new Set(all.map((item) => item.date))].sort();
  let consecutive = 0;
  for (let index = 0; index < dates.length; index += 1) {
    consecutive = index > 0 && dayNumber(dates[index]) - dayNumber(dates[index - 1]) === 1 ? consecutive + 1 : 1;
    if (consecutive > 6) return false;
  }
  const worked = new Set(dates);
  for (const date of dates) {
    if (!isSunday(date)) continue;
    const day = dayNumber(date);
    const prior = new Date((day - 7) * DAY_MS).toISOString().slice(0, 10);
    const beforePrior = new Date((day - 14) * DAY_MS).toISOString().slice(0, 10);
    if (worked.has(prior) && worked.has(beforePrior)) return false;
  }
  return true;
}

function eligible(position: Position, employee: NatashaProposalInputs['employees'][number], snapshot: NatashaRosterSnapshot): boolean {
  return employee.active && employee.allowedUnitIds.includes(position.unitId)
    && (position.requiredRoleId === null || employee.roleIds.includes(position.requiredRoleId))
    && !snapshot.vacations.some((item) => item.employeeId === employee.id && item.status === 'approved'
      && item.recordType === 'gozo' && position.date >= item.startDate && position.date <= item.endDate)
    && !snapshot.unavailabilities.some((item) => item.employeeId === employee.id
      && position.date >= item.startDate && position.date <= item.endDate)
    && !snapshot.dayOffs.some((item) => item.employeeId === employee.id && item.date === position.date);
}

function countDifference(left: readonly string[], right: readonly string[]): number {
  return left.reduce((count, value, index) => count + Number(value !== right[index]), 0);
}

function preferenceMetrics(
  assignments: readonly { position: Position; employeeId: string }[],
  rosterIssues: ReturnType<typeof validateNatashaRoster>['issues'],
  candidateEmployeeIds: readonly string[],
  options: ParsedOptions,
): NatashaAlternativeMetrics {
  const counts = new Map(candidateEmployeeIds.map((id) => [id, 0]));
  const sundays = new Map(candidateEmployeeIds.map((id) => [id, 0]));
  for (const item of assignments) {
    counts.set(item.employeeId, (counts.get(item.employeeId) ?? 0) + 1);
    if (isSunday(item.position.date)) sundays.set(item.employeeId, (sundays.get(item.employeeId) ?? 0) + 1);
  }
  const spread = (values: Map<string, number>) => {
    const numbers = [...values.values()];
    return numbers.length > 0 ? Math.max(...numbers) - Math.min(...numbers) : 0;
  };
  let saraMix = 0;
  if (options.saraPreference) {
    const sara = assignments.filter((item) => item.employeeId === options.saraPreference?.employeeId
      && item.position.slot === 'intermediate');
    const tirirical = sara.filter((item) => item.position.unitId === options.saraPreference?.tiriricalUnitId).length;
    const shopping = sara.filter((item) => item.position.unitId === options.saraPreference?.shoppingUnitId).length;
    saraMix = Math.abs(tirirical - shopping) + Number(tirirical === 0) + Number(shopping === 0);
  }
  return {
    openingAfterClosing: rosterIssues.filter((issue) => issue.code === 'OPENING_AFTER_CLOSING').length,
    shiftSpread: spread(counts),
    sundaySpread: spread(sundays),
    saraMix,
  };
}

function weightedScore(metrics: NatashaAlternativeMetrics, weights: ParsedOptions['weights']): number {
  return metrics.openingAfterClosing * weights.openingAfterClosing
    + metrics.shiftSpread * weights.shiftSpread
    + metrics.sundaySpread * weights.sundaySpread
    + metrics.saraMix * weights.saraMix;
}

/** Busca limitada, local e determinística; nunca publica nem declara ótimo sem prova. */
export function generateNatashaAlternatives(
  snapshot: NatashaRosterSnapshot,
  coveragePlan: NatashaCoveragePlan,
  inputs: NatashaProposalInputs,
  rawOptions: NatashaSolverOptions = {},
): NatashaSolverReport {
  const options = natashaSolverOptionsSchema.parse(rawOptions);
  const preflight = assessNatashaProposalInputs(snapshot, coveragePlan, inputs);
  const minDifferentAssignments = options.minDifferentAssignments
    ?? Math.min(3, Math.max(1, Math.ceil(inputs.positions.length / 10)));
  const search = {
    nodesVisited: 0, feasibleSolutionsSeen: 0, limitReached: false, exhaustive: false,
    maxNodes: options.maxNodes, minDifferentAssignments,
  };
  const base = {
    period: inputs.period, preflight, search, weights: options.weights,
    caveat: 'Alternativas locais para revisão humana; busca limitada não prova ótimo nem autoriza publicação.',
  };
  if (preflight.status !== 'ready_for_solver') {
    return { ...base, status: preflight.status === 'infeasible' ? 'infeasible' : 'not_ready', alternatives: [] };
  }

  const mandates = new Map<string, Mandate>();
  for (const fixed of snapshot.fixedAssignments) mandates.set(`${fixed.date}\u0000${fixed.unitId}\u0000${fixed.employeeId}`, fixed);
  if (snapshot.fridayMatrix) {
    const [year, month] = inputs.period.split('-').map(Number);
    const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
    for (let day = 1; day <= days; day += 1) {
      const date = `${inputs.period}-${String(day).padStart(2, '0')}`;
      if (new Date(`${date}T00:00:00.000Z`).getUTCDay() === 5) {
        const mandate = { date, unitId: snapshot.fridayMatrix.unitId, employeeId: snapshot.fridayMatrix.employeeId };
        mandates.set(`${date}\u0000${mandate.unitId}\u0000${mandate.employeeId}`, mandate);
      }
    }
  }
  const candidates = new Map(inputs.positions.map((position) => [position.id,
    inputs.employees.filter((employee) => eligible(position, employee, snapshot)).map((employee) => employee.id).sort(),
  ]));
  const mandateList = [...mandates.values()];
  const ordered = [...inputs.positions].sort((left, right) => {
    const count = (candidates.get(left.id)?.length ?? 0) - (candidates.get(right.id)?.length ?? 0);
    if (count !== 0) return count;
    const mandatory = (position: Position) => Number(mandateList.some((item) => item.date === position.date && item.unitId === position.unitId));
    return mandatory(right) - mandatory(left) || left.date.localeCompare(right.date) || left.id.localeCompare(right.id);
  });
  const assigned = new Map<string, string>();
  const perEmployee = new Map(inputs.employees.map((employee) => [employee.id, [] as WorkSpan[]]));
  for (const shift of snapshot.shifts) {
    const spans = perEmployee.get(shift.employeeId) ?? [];
    spans.push(span(shift.date, shift.startTime, shift.endTime));
    perEmployee.set(shift.employeeId, spans);
  }
  for (const shift of inputs.nextMonthKnownShifts) {
    const spans = perEmployee.get(shift.employeeId) ?? [];
    spans.push(span(shift.date, shift.startTime, shift.endTime));
    perEmployee.set(shift.employeeId, spans);
  }
  const candidateEmployeeIds = inputs.employees.filter((employee) => employee.active
    && inputs.positions.some((position) => candidates.get(position.id)?.includes(employee.id))).map((employee) => employee.id).sort();
  const canonicalPositions = [...inputs.positions].sort((left, right) => left.id.localeCompare(right.id));
  const pool: Array<{ score: number; metrics: NatashaAlternativeMetrics; signature: string[]; assignments: NatashaAlternative['assignments'] }> = [];
  const compare = (left: typeof pool[number], right: typeof pool[number]) =>
    left.score - right.score || left.signature.join('\u0000').localeCompare(right.signature.join('\u0000'));

  function mandatesStillPossible(nextIndex: number): boolean {
    return mandateList.every((mandate) => {
      if (ordered.some((position) => position.date === mandate.date && position.unitId === mandate.unitId
        && assigned.get(position.id) === mandate.employeeId)) return true;
      return ordered.slice(nextIndex).some((position) => position.date === mandate.date && position.unitId === mandate.unitId
        && candidates.get(position.id)?.includes(mandate.employeeId));
    });
  }

  function assessComplete(): void {
    const assignments = canonicalPositions.map((position) => ({ position, employeeId: assigned.get(position.id)! }));
    const shifts: WorkShift[] = assignments.map(({ position, employeeId }) => ({
      id: `proposal:${position.id}`, employeeId, unitId: position.unitId, date: position.date,
      startTime: position.startTime, endTime: position.endTime, slot: position.slot,
    }));
    const proposed = { ...snapshot, shifts: [...snapshot.shifts, ...shifts] };
    const rules = validateNatashaRoster(proposed);
    if (rules.status !== 'checked') return;
    if (validateNatashaCoverage(proposed, coveragePlan).status !== 'checked') return;
    search.feasibleSolutionsSeen += 1;
    const metrics = preferenceMetrics(assignments, rules.issues, candidateEmployeeIds, options);
    const entry = {
      score: weightedScore(metrics, options.weights), metrics,
      signature: assignments.map((item) => item.employeeId),
      assignments: assignments.map(({ position, employeeId }) => ({
        positionId: position.id, employeeId, unitId: position.unitId, date: position.date,
        startTime: position.startTime, endTime: position.endTime, slot: position.slot,
      })),
    };
    const similarIndex = pool.findIndex((item) => countDifference(item.signature, entry.signature) < minDifferentAssignments);
    if (similarIndex >= 0) {
      if (compare(entry, pool[similarIndex]) < 0
        && pool.every((item, index) => index === similarIndex
          || countDifference(item.signature, entry.signature) >= minDifferentAssignments)) {
        pool[similarIndex] = entry;
      }
    } else if (pool.length < options.maxAlternatives) {
      pool.push(entry);
    } else {
      pool.sort(compare);
      if (compare(entry, pool.at(-1)!) < 0) pool[pool.length - 1] = entry;
    }
  }

  function visit(index: number): void {
    if (search.nodesVisited >= options.maxNodes) {
      search.limitReached = true;
      return;
    }
    search.nodesVisited += 1;
    if (index === ordered.length) {
      assessComplete();
      return;
    }
    const position = ordered[index];
    const optionsForPosition = [...(candidates.get(position.id) ?? [])].sort((left, right) => {
      const needed = (id: string) => Number(mandateList.some((item) => item.employeeId === id
        && item.date === position.date && item.unitId === position.unitId));
      const required = needed(right) - needed(left);
      if (required !== 0) return required;
      const count = (perEmployee.get(left)?.filter((item) => item.date.startsWith(`${inputs.period}-`)).length ?? 0)
        - (perEmployee.get(right)?.filter((item) => item.date.startsWith(`${inputs.period}-`)).length ?? 0);
      return count || left.localeCompare(right);
    });
    for (const employeeId of optionsForPosition) {
      const current = perEmployee.get(employeeId) ?? [];
      const candidate = span(position.date, position.startTime, position.endTime);
      if (!hardCompatible(current, candidate)) continue;
      current.push(candidate);
      perEmployee.set(employeeId, current);
      assigned.set(position.id, employeeId);
      if (mandatesStillPossible(index + 1)) visit(index + 1);
      assigned.delete(position.id);
      current.pop();
      if (search.limitReached) return;
    }
  }

  visit(0);
  search.exhaustive = !search.limitReached;
  pool.sort(compare);
  const best = pool[0]?.signature;
  const alternatives: NatashaAlternative[] = pool.map((entry, index) => ({
    label: String.fromCharCode(65 + index), score: entry.score, metrics: entry.metrics,
    differenceFromBest: best ? countDifference(entry.signature, best) : 0,
    assignments: entry.assignments,
  }));
  return {
    ...base,
    status: alternatives.length > 0 ? 'alternatives' : search.limitReached ? 'search_limit' : 'infeasible',
    alternatives,
  };
}
