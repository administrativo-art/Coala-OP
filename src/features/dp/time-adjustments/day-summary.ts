/**
 * Dia inteiro do pedido de ajuste: parte pura, usada pela tela de análise (e testável sem servidor).
 * Compara "como está" (batidas depois dos tratamentos já aprovados) com "se aprovar" (mais o que o pedido faz).
 * Só calcula e mostra; não decide nada nem altera o ponto.
 */

export type DayMarking = {
  receiptId: string;
  markedAt: string;
  nsr: number;
  executionUnitId: string | null;
  /** Finalidade declarada da batida (journey_start, break_start, break_end, journey_end), quando há. */
  purpose: string | null;
  channel: 'app' | 'web' | null;
};

export type DayTreatment = {
  adjustmentId: string;
  type: 'discard' | 'inclusion';
  originalReceiptId: string | null;
  markedAt: string | null;
};

export type DayShift = {
  startTime: string | null;
  endTime: string | null;
  overnight: boolean;
  shiftName: string | null;
  unitName: string | null;
  breakType: 'none' | 'fixed' | 'flexible' | 'staggered';
  breakStart: string | null;
  breakEnd: string | null;
  breakDurationMinutes: number | null;
  toleranceMinutes: number | null;
  referenceMinutes: number | null;
  expectedPunches: number | null;
};

export type AdjustmentDayContext = {
  adjustmentId: string;
  workDate: string;
  scope: 'official' | 'pilot';
  markings: DayMarking[];
  treatments: DayTreatment[];
  shifts: DayShift[];
  history: { otherRequestsSameDay: number; approvedInPrevious30Days: number };
  /** Vínculo da pessoa; estágio e aprendizagem têm jornada própria, então a comparação com a escala é só informativa. */
  relationship: 'clt' | 'apprenticeship' | 'pj' | 'internship' | 'partner' | null;
  truncated: boolean;
};

export type DayOperation = {
  kind: 'include' | 'discard' | 'correct';
  target: { receiptId: string; markedAt: string; nsr?: number; pilotSequence?: number; executionUnitId?: string } | null;
  inclusion: { markedAt: string } | null;
};

export type DayMarker = {
  key: string;
  minute: number;
  time: string;
  label: string | null;
  state: 'kept' | 'included' | 'removed';
  outside: boolean;
  side: 'above' | 'below';
};
export type DaySegment = { start: number; end: number; outside: boolean };
export type DayNote = { tone: 'warn' | 'neutral'; text: string };
export type DayState = {
  markers: DayMarker[];
  segments: DaySegment[];
  /** Trechos que existiam em "como está" e deixam de contar em "se aprovar". */
  ghostSegments: DaySegment[];
  workedMinutes: number | null;
  breakMinutes: number;
  scheduledMinutes: number | null;
  diffMinutes: number | null;
  outsideMinutes: number;
  punchCount: number;
  note: DayNote;
};
export type DayRowAction = 'kept' | 'discard' | 'include' | 'earlier_discarded' | 'earlier_included';
export type DayRow = { key: string; time: string; minute: number; label: string | null; origin: string; action: DayRowAction };
export type AdjustmentDaySummary = {
  before: DayState;
  after: DayState;
  rows: DayRow[];
  axis: { start: number; end: number };
  shiftText: string | null;
  scheduledMinutes: number | null;
  toleranceMinutes: number;
  hasShift: boolean;
  /** Escala do dia e intervalo fixo previsto, em minutos desde 00:00 do dia do ponto, para desenhar no fundo da linha. */
  scaleBand: { start: number; end: number; breakStart: number | null; breakEnd: number | null } | null;
  /** Aviso quando o dia tem menos batidas que o esperado ou o pedido cita batida que a leitura do dia não trouxe. */
  notice: string | null;
};

const SHORT_PURPOSE: Record<string, string> = { journey_start: 'Início', break_start: 'Intervalo', break_end: 'Volta', journey_end: 'Fim' };
const LONG_PURPOSE: Record<string, string> = {
  journey_start: 'Início da jornada', break_start: 'Início do intervalo', break_end: 'Volta do intervalo', journey_end: 'Fim da jornada',
};
const POSITIONAL = ['journey_start', 'break_start', 'break_end', 'journey_end'];

type Punch = {
  key: string;
  minute: number;
  markedAt: string;
  purpose: string | null;
  source: 'original' | 'earlier_inclusion' | 'pending_inclusion';
  marking?: DayMarking;
};

/** Minutos desde 00:00 do dia do ponto, pelo horário local gravado no carimbo (`AAAA-MM-DDTHH:mm:ss-0300`). */
export function minutesFromWorkDate(workDate: string, markedAt: string) {
  const day = (value: string) => Date.UTC(Number(value.slice(0, 4)), Number(value.slice(5, 7)) - 1, Number(value.slice(8, 10)));
  const days = Math.round((day(markedAt) - day(workDate)) / 86_400_000);
  return days * 1440 + Number(markedAt.slice(11, 13)) * 60 + Number(markedAt.slice(14, 16)) + Number(markedAt.slice(17, 19) || 0) / 60;
}

export function formatClock(minute: number) {
  const total = Math.round(((minute % 1440) + 1440) % 1440);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}
export function formatDuration(minutes: number) {
  const total = Math.round(Math.abs(minutes));
  return `${Math.floor(total / 60)}h${String(total % 60).padStart(2, '0')}`;
}
export function formatSignedDuration(minutes: number) {
  return `${minutes < 0 ? '−' : '+'}${formatDuration(minutes)}`;
}

function toWindow(workDate: string, shift: DayShift | undefined) {
  if (!shift?.startTime || !shift.endTime) return null;
  const clock = (value: string) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5));
  const start = clock(shift.startTime);
  let end = clock(shift.endTime);
  if (shift.overnight || end <= start) end += 1440;
  return { start, end, workDate };
}

function plannedBreak(shift: DayShift | undefined) {
  if (!shift) return 0;
  if (shift.breakDurationMinutes != null) return shift.breakDurationMinutes;
  if (shift.breakStart && shift.breakEnd) {
    const clock = (value: string) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5));
    return Math.max(0, clock(shift.breakEnd) - clock(shift.breakStart));
  }
  return 0;
}

function scheduledMinutesOf(shift: DayShift | undefined, window: ReturnType<typeof toWindow>) {
  if (!shift || !window) return null;
  return shift.referenceMinutes ?? Math.max(0, window.end - window.start - plannedBreak(shift));
}

function subtract(base: Array<[number, number]>, cut: Array<[number, number]>) {
  let pieces = base;
  for (const [cutStart, cutEnd] of [...cut].sort((a, b) => a[0] - b[0])) {
    pieces = pieces.flatMap(([start, end]) => {
      if (cutEnd <= start || cutStart >= end) return [[start, end] as [number, number]];
      return [
        ...(cutStart > start ? [[start, cutStart] as [number, number]] : []),
        ...(cutEnd < end ? [[cutEnd, end] as [number, number]] : []),
      ];
    });
  }
  return pieces.filter(([start, end]) => end - start > 0.5);
}

function labelFor(purpose: string | null, index: number, total: number) {
  if (purpose && SHORT_PURPOSE[purpose]) return SHORT_PURPOSE[purpose];
  // Com uma batida só (ou nenhuma), a ordem não diz nada: mostra só o horário.
  if (total < 2) return null;
  if (total === 4) return SHORT_PURPOSE[POSITIONAL[index]];
  return index % 2 === 0 ? 'Entrada' : 'Saída';
}

/** Rótulos acima ou abaixo da linha, para batidas próximas não se sobreporem. */
function layoutSides(minutes: number[], axis: { start: number; end: number }) {
  const gap = 13;
  let lastAbove = -Infinity;
  let lastBelow = -Infinity;
  return minutes.map((minute) => {
    const pct = ((minute - axis.start) / (axis.end - axis.start)) * 100;
    if (pct - lastAbove >= gap) { lastAbove = pct; return 'above' as const; }
    if (pct - lastBelow >= gap) { lastBelow = pct; return 'below' as const; }
    lastAbove = pct;
    return 'above' as const;
  });
}

function stateOf(params: {
  punches: Punch[];
  removed: Punch[];
  window: ReturnType<typeof toWindow>;
  scheduled: number | null;
  tolerance: number;
  informative: boolean;
  axis: { start: number; end: number };
  workDate: string;
}): Omit<DayState, 'ghostSegments'> {
  const sorted = [...params.punches].sort((a, b) => a.minute - b.minute);
  const odd = sorted.length % 2 === 1;
  const pairs: Array<[number, number]> = [];
  for (let index = 0; index + 1 < sorted.length; index += 2) pairs.push([sorted[index].minute, sorted[index + 1].minute]);
  const worked = odd || sorted.length === 0 ? (sorted.length === 0 ? 0 : null) : pairs.reduce((total, [start, end]) => total + Math.round(end - start), 0);
  const breakMinutes = pairs.slice(1).reduce((total, [start], index) => total + Math.round(start - pairs[index][1]), 0);
  const segments: DaySegment[] = [];
  let outsideMinutes = 0;
  for (const [start, end] of pairs) {
    const window = params.window;
    if (!window) { segments.push({ start, end, outside: false }); continue; }
    const before: [number, number] | null = start < window.start ? [start, Math.min(end, window.start)] : null;
    const after: [number, number] | null = end > window.end ? [Math.max(start, window.end), end] : null;
    const inside: [number, number] = [Math.max(start, window.start), Math.min(end, window.end)];
    const outsides = [before, after].filter((part): part is [number, number] => part !== null && part[1] - part[0] > 0);
    const pieces: DaySegment[] = [];
    for (const [partStart, partEnd] of outsides) {
      const flagged = partEnd - partStart > params.tolerance;
      pieces.push({ start: partStart, end: partEnd, outside: flagged });
      if (flagged) outsideMinutes += Math.round(partEnd - partStart);
    }
    if (inside[1] > inside[0]) pieces.push({ start: inside[0], end: inside[1], outside: false });
    segments.push(...pieces.sort((a, b) => a.start - b.start));
  }
  const outsideMinute = (minute: number) => {
    const window = params.window;
    if (!window) return false;
    const distance = minute < window.start ? window.start - minute : minute > window.end ? minute - window.end : 0;
    return distance > params.tolerance;
  };
  const all: Array<{ punch: Punch; state: DayMarker['state'] }> = [
    ...sorted.map((punch) => ({ punch, state: (punch.source === 'original' ? 'kept' : 'included') as DayMarker['state'] })),
    ...params.removed.map((punch) => ({ punch, state: 'removed' as const })),
  ].sort((a, b) => a.punch.minute - b.punch.minute);
  const sides = layoutSides(all.map((item) => item.punch.minute), params.axis);
  const effectiveIndex = new Map(sorted.map((punch, index) => [punch.key, index]));
  const markers: DayMarker[] = all.map((item, position) => {
    const index = effectiveIndex.get(item.punch.key);
    const base = item.state === 'removed' ? labelFor(item.punch.purpose, position, all.length) : labelFor(item.punch.purpose, index ?? 0, sorted.length);
    return {
      key: item.punch.key, minute: item.punch.minute, time: formatClock(item.punch.minute),
      label: item.state === 'included' && item.punch.source === 'pending_inclusion' ? `${base} · incluída` : item.state === 'removed' ? 'desconsiderada' : base,
      state: item.state, outside: item.state !== 'removed' && outsideMinute(item.punch.minute), side: sides[position],
    };
  });
  const diff = worked !== null && params.scheduled !== null ? worked - params.scheduled : null;
  return {
    markers, segments, workedMinutes: worked, breakMinutes, scheduledMinutes: params.scheduled, diffMinutes: diff, outsideMinutes,
    punchCount: sorted.length, note: noteFor({ odd, worked, scheduled: params.scheduled, diff, outsideMinutes, tolerance: params.tolerance, count: sorted.length, informative: params.informative }),
  };
}

/**
 * Texto de cada lado do dia. Só descreve a diferença para a escala cadastrada; não afirma limite legal de jornada,
 * hora extra, banco de horas nem regularidade (a tolerância citada é a do cadastro da jornada, não a regra legal de
 * marcação). Para estágio e aprendizagem a comparação é só informativa.
 */
function noteFor(input: { odd: boolean; worked: number | null; scheduled: number | null; diff: number | null; outsideMinutes: number; tolerance: number; count: number; informative: boolean }): DayNote {
  if (input.count === 0) return { tone: 'warn', text: 'Nenhuma batida no dia.' };
  if (input.odd) return { tone: 'warn', text: 'Número ímpar de batidas: não é possível somar o dia.' };
  if (input.scheduled === null || input.diff === null) return { tone: 'neutral', text: 'Sem escala neste dia para comparar.' };
  if (input.informative) {
    return { tone: 'neutral', text: input.diff === 0 ? 'Igual à escala do dia.' : `Diferença de ${formatSignedDuration(input.diff)} em relação à escala do dia (informativo para este vínculo).` };
  }
  if (input.diff === 0) return { tone: 'neutral', text: 'Igual à escala do dia.' };
  if (input.diff > input.tolerance) {
    return { tone: 'warn', text: `Passa ${formatDuration(input.diff)} da escala${input.outsideMinutes > 0 ? `; ${formatDuration(input.outsideMinutes)} fora do horário da escala` : ''}.` };
  }
  if (input.diff < -input.tolerance) return { tone: 'warn', text: `${formatDuration(input.diff)} a menos que a escala.` };
  return { tone: 'neutral', text: `${formatDuration(input.diff)} ${input.diff > 0 ? 'a mais' : 'a menos'} que a escala, dentro da tolerância cadastrada na jornada (${input.tolerance} min).` };
}

export function pendingOperations(adjustment: { kind: DayOperation['kind']; target: DayOperation['target']; inclusion: DayOperation['inclusion']; operations?: DayOperation[] }): DayOperation[] {
  return adjustment.operations?.length ? adjustment.operations : [{ kind: adjustment.kind, target: adjustment.target, inclusion: adjustment.inclusion }];
}

/** Resumo do pedido em uma frase curta: "Trocar 17:59 por 13:50", "Desconsiderar 17:59" ou "Incluir 13:50". */
export function operationsHeadline(operations: DayOperation[]) {
  return operations.map((operation) => {
    const from = operation.target ? operation.target.markedAt.slice(11, 16) : null;
    const to = operation.inclusion ? operation.inclusion.markedAt.slice(11, 16) : null;
    if (from && to) return `Trocar ${from} por ${to}`;
    if (from) return `Desconsiderar ${from}`;
    return to ? `Incluir ${to}` : '';
  }).filter(Boolean).join(' · ');
}

export function summarizeAdjustmentDay(context: AdjustmentDayContext, operations: DayOperation[]): AdjustmentDaySummary {
  const shift = context.shifts[0];
  const window = toWindow(context.workDate, shift);
  const scheduled = scheduledMinutesOf(shift, window);
  const tolerance = shift?.toleranceMinutes ?? 0;
  const minute = (markedAt: string) => minutesFromWorkDate(context.workDate, markedAt);

  const originals: DayMarking[] = [...context.markings];
  for (const operation of operations) {
    const target = operation.target;
    if (target && !originals.some((item) => item.receiptId === target.receiptId)) {
      originals.push({ receiptId: target.receiptId, markedAt: target.markedAt, nsr: target.nsr ?? target.pilotSequence ?? 0,
        executionUnitId: target.executionUnitId ?? null, purpose: null, channel: null });
    }
  }
  const earlierDiscarded = new Set(context.treatments.filter((item) => item.type === 'discard' && item.originalReceiptId).map((item) => item.originalReceiptId as string));
  const pendingTargets = new Set(operations.filter((item) => item.kind !== 'include' && item.target).map((item) => item.target!.receiptId));

  const originalPunch = (marking: DayMarking): Punch => ({ key: marking.receiptId, minute: minute(marking.markedAt), markedAt: marking.markedAt,
    purpose: marking.purpose, source: 'original', marking });
  const earlierInclusions: Punch[] = context.treatments.filter((item) => item.type === 'inclusion' && item.markedAt).map((item, index) => ({
    key: `earlier-${item.adjustmentId}-${index}`, minute: minute(item.markedAt as string), markedAt: item.markedAt as string, purpose: null, source: 'earlier_inclusion' }));
  const pendingInclusions: Punch[] = operations.filter((item) => item.kind !== 'discard' && item.inclusion).map((item, index) => ({
    key: `pending-${index}`, minute: minute(item.inclusion!.markedAt), markedAt: item.inclusion!.markedAt, purpose: null, source: 'pending_inclusion' }));

  const beforePunches = [...originals.filter((item) => !earlierDiscarded.has(item.receiptId)).map(originalPunch), ...earlierInclusions];
  const afterPunches = [...beforePunches.filter((item) => !pendingTargets.has(item.key)), ...pendingInclusions];
  const removed = beforePunches.filter((item) => pendingTargets.has(item.key));

  const everyMinute = [...beforePunches, ...afterPunches, ...removed].map((item) => item.minute).concat(window ? [window.start, window.end] : []);
  const low = everyMinute.length ? Math.min(...everyMinute) : 6 * 60;
  const high = everyMinute.length ? Math.max(...everyMinute) : 18 * 60;
  const axisStart = Math.max(0, Math.floor((low - 45) / 60) * 60);
  const axis = { start: axisStart, end: Math.min(48 * 60, Math.max(Math.ceil((high + 45) / 60) * 60, axisStart + 240)) };

  const informative = context.relationship === 'internship' || context.relationship === 'apprenticeship';
  const common = { window, scheduled, tolerance, informative, axis, workDate: context.workDate };
  const before = stateOf({ ...common, punches: beforePunches, removed: [] });
  const after = stateOf({ ...common, punches: afterPunches, removed });
  const ghost = subtract(before.segments.map((item) => [item.start, item.end] as [number, number]),
    after.segments.map((item) => [item.start, item.end] as [number, number]))
    .sort((a, b) => a[0] - b[0])
    .reduce<Array<[number, number]>>((merged, [start, end]) => {
      const last = merged.at(-1);
      if (last && start <= last[1] + 0.5) last[1] = Math.max(last[1], end);
      else merged.push([start, end]);
      return merged;
    }, []);

  const origin = (marking: DayMarking | undefined) => {
    if (!marking) return 'Ajuste anterior';
    const channel = marking.channel === 'app' ? 'Coala Go' : marking.channel === 'web' ? 'Coala One' : 'Registro';
    return `${channel} · ${context.scope === 'pilot' ? 'seq.' : 'NSR'} ${marking.nsr}`;
  };
  const labelFull = (purpose: string | null, position: number, total: number) =>
    purpose && LONG_PURPOSE[purpose] ? LONG_PURPOSE[purpose] : total === 4 ? LONG_PURPOSE[POSITIONAL[position]] : null;
  const effective = [...beforePunches].sort((a, b) => a.minute - b.minute);
  const rows: DayRow[] = [
    ...originals.map((marking) => {
      const discardedBefore = earlierDiscarded.has(marking.receiptId);
      const position = effective.findIndex((item) => item.key === marking.receiptId);
      return { key: marking.receiptId, time: formatClock(minute(marking.markedAt)), minute: minute(marking.markedAt),
        label: labelFull(marking.purpose, position < 0 ? 0 : position, effective.length), origin: origin(marking),
        action: (discardedBefore ? 'earlier_discarded' : pendingTargets.has(marking.receiptId) ? 'discard' : 'kept') as DayRowAction };
    }),
    ...earlierInclusions.map((punch) => ({ key: punch.key, time: formatClock(punch.minute), minute: punch.minute, label: null, origin: 'Ajuste anterior', action: 'earlier_included' as DayRowAction })),
    ...pendingInclusions.map((punch) => ({ key: punch.key, time: formatClock(punch.minute), minute: punch.minute, label: null, origin: 'Pedido do titular', action: 'include' as DayRowAction })),
  ].sort((a, b) => a.minute - b.minute);

  let shiftText: string | null = null;
  if (shift?.startTime && shift.endTime) {
    const breakText = shift.breakType === 'fixed' && shift.breakStart && shift.breakEnd ? ` · intervalo ${shift.breakStart}–${shift.breakEnd}`
      : plannedBreak(shift) > 0 ? ` · intervalo de ${plannedBreak(shift)} min` : '';
    const extra = context.shifts.length > 1 ? ` · há mais ${context.shifts.length - 1} ${context.shifts.length === 2 ? 'turno' : 'turnos'} no dia, sem somar` : '';
    shiftText = `escala ${shift.startTime}–${shift.endTime}${breakText}${extra}`;
  }
  const clock = (value: string) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5));
  let scaleBand: AdjustmentDaySummary['scaleBand'] = null;
  if (window) {
    const fixed = shift?.breakType === 'fixed' && shift.breakStart && shift.breakEnd;
    let breakStart = fixed ? clock(shift!.breakStart as string) : null;
    let breakEnd = fixed ? clock(shift!.breakEnd as string) : null;
    if (breakStart !== null && breakEnd !== null) {
      if (breakStart < window.start) { breakStart += 1440; breakEnd += 1440; }
      if (breakEnd <= breakStart) breakEnd += 1440;
    }
    scaleBand = { start: window.start, end: window.end, breakStart, breakEnd };
  }
  const expected = shift?.expectedPunches ?? null;
  const notices: string[] = [];
  const dayCount = context.markings.length;
  if (dayCount < (expected ?? 2)) {
    const found = dayCount === 0 ? 'Não há batida registrada neste dia' : dayCount === 1 ? 'Há 1 batida registrada neste dia' : `Há ${dayCount} batidas registradas neste dia`;
    notices.push(`${found}${expected ? `; a escala cadastrada tem ${expected} marcações` : ''}. Confira o motivo informado no pedido.`);
  }
  const missing = operations.filter((operation) => operation.target && !context.markings.some((item) => item.receiptId === operation.target!.receiptId));
  if (missing.length > 0) {
    notices.push(`${missing.length === 1 ? 'A batida das' : 'As batidas das'} ${missing.map((operation) => operation.target!.markedAt.slice(11, 16)).join(', ')} citada${missing.length === 1 ? '' : 's'} no pedido não ${missing.length === 1 ? 'foi encontrada' : 'foram encontradas'} na leitura deste dia. Confira a data e a origem.`);
  }
  return { before: { ...before, ghostSegments: [] }, after: { ...after, ghostSegments: ghost.map(([start, end]) => ({ start, end, outside: false })) },
    rows, axis, shiftText, scheduledMinutes: scheduled, toleranceMinutes: tolerance, hasShift: window !== null, scaleBand,
    notice: notices.length ? notices.join(' ') : null };
}
