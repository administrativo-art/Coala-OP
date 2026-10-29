/**
 * Declaração do fechamento da competência (plano mestre, "Declaração obrigatória no documento de fechamento"):
 * cada pessoa traz, um a um e ligados ao dia, os pedidos de ajuste, as ausências e as trocas de turno que tocam
 * o mês, inclusive recusados e cancelados. Puro: o serviço lê, este módulo monta, carimba e compara versões.
 */
import { createHash } from 'node:crypto';

export type ClosureAdjustment = {
  id: string; workDate: string; kind: 'include' | 'discard' | 'correct'; status: 'in_review' | 'approved' | 'rejected' | 'cancelled';
  original: { nsr: number; markedAt: string } | null; inclusion: { markedAt: string } | null; reason: string;
  operations?: Array<{ kind: 'include' | 'discard' | 'correct'; original: { nsr: number; markedAt: string } | null; inclusion: { markedAt: string } | null }>;
  requestedBy: string; requestedAt: string; decidedBy: string | null; decidedAt: string | null; decisionReason: string | null;
};
/** Sem motivo nem anexo: a declaração referencia o pedido sem reproduzir dado de saúde. */
export type ClosureAbsence = {
  id: string; typeName: string; startDate: string; endDate: string; startTime: string | null; endTime: string | null;
  quantity: number; unit: 'day' | 'hour'; status: string; approval: 'review' | 'tacit_timeout' | 'automatic_timeout' | null; decidedBy: string | null;
  decidedAt: string | null; attachmentCount: number;
  effect?: 'excused_absence' | 'unexcused_absence' | 'worked_credit' | 'time_bank_debit' | 'manual_review';
  automatic?: boolean;
};
export type ClosureShiftSwap = {
  id: string; status: 'pending' | 'accepted' | 'rejected' | 'cancelled' | 'stale'; date: string;
  unitId: string; unitName: string; requesterUid: string; requesterName: string; targetUid: string; targetName: string;
  offeredShift: { startTime: string; endTime: string; shiftName: string | null };
  requestedShift: { startTime: string; endTime: string; shiftName: string | null };
  reason: string | null; requestedAt: string; decidedAt: string | null;
  acts: Array<{ action: 'submitted' | 'accepted' | 'rejected' | 'cancelled' | 'marked_stale'; at: string; actorUid: string; actorName: string; declaration: string }>;
};
export type ClosurePerson = {
  uid: string; name: string | null; adjustments: ClosureAdjustment[]; absences: ClosureAbsence[]; shiftSwaps: ClosureShiftSwap[];
};
export type ClosureRosterPerson = { uid: string; name: string | null };
export type ClosureChanges = { added: string[]; changed: string[]; removed: string[] };

/** Versões fechadas antes da inclusão da troca de turno continuam legíveis sem migração destrutiva. */
export function normalizeClosurePerson(value: ClosurePerson): ClosurePerson {
  return {
    ...value,
    adjustments: Array.isArray(value.adjustments) ? value.adjustments : [],
    absences: Array.isArray(value.absences) ? value.absences : [],
    shiftSwaps: Array.isArray(value.shiftSwaps) ? value.shiftSwaps : [],
  };
}

/** Pedido ainda sem decisão: impede o fechamento. Rascunho de ausência não foi enviado e não conta. */
export const OPEN_ABSENCE_STATUSES = ['submitted', 'in_review', 'adjustments_requested'] as const;

/**
 * O mês só fecha depois de terminado em todo o Brasil e com um dia de margem para o turno que cruza a meia-noite:
 * a data civil de referência é a do fuso mais a oeste (Rio Branco, UTC−5) um dia antes do instante do fechamento.
 */
export function competenceEnded(competence: string, atIso: string) {
  const reference = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Rio_Branco', year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date(Date.parse(atIso) - 86_400_000));
  return competence < reference.slice(0, 7);
}

export function competenceRange(competence: string) {
  const [year, month] = competence.split('-').map(Number);
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { start: `${competence}-01`, end: `${competence}-${String(last).padStart(2, '0')}` };
}
/** Ausência dura no máximo 366 dias: a que toca o mês começou até 366 dias antes do início. */
export function absenceLookback(start: string) {
  return new Date(Date.parse(`${start}T00:00:00Z`) - 366 * 86_400_000).toISOString().slice(0, 10);
}
export function overlapsCompetence(item: { startDate: string; endDate: string }, competence: string) {
  const { start, end } = competenceRange(competence);
  return item.startDate <= end && item.endDate >= start;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}
export function sha256(value: unknown) { return createHash('sha256').update(canonical(value)).digest('hex'); }

/** Pessoas por ordem de nome e itens por dia: a mesma entrada dá sempre o mesmo documento e o mesmo carimbo. */
export function buildDeclaration(adjustments: Array<ClosureAdjustment & { employeeUid: string; employeeName: string | null }>,
  absences: Array<ClosureAbsence & { beneficiaryUid: string; beneficiaryName: string | null }>, shiftSwaps: ClosureShiftSwap[] = []): ClosurePerson[] {
  const people = new Map<string, ClosurePerson>();
  const person = (uid: string, name: string | null) => {
    const found = people.get(uid) ?? { uid, name: null, adjustments: [], absences: [], shiftSwaps: [] };
    if (!found.name && name) found.name = name;
    people.set(uid, found);
    return found;
  };
  for (const { employeeUid, employeeName, ...item } of adjustments) person(employeeUid, employeeName).adjustments.push(item);
  for (const { beneficiaryUid, beneficiaryName, ...item } of absences) person(beneficiaryUid, beneficiaryName).absences.push(item);
  for (const item of shiftSwaps) {
    person(item.requesterUid, item.requesterName).shiftSwaps.push(item);
    person(item.targetUid, item.targetName).shiftSwaps.push(item);
  }
  for (const entry of people.values()) {
    entry.adjustments.sort((left, right) => left.workDate.localeCompare(right.workDate) || left.requestedAt.localeCompare(right.requestedAt) || left.id.localeCompare(right.id));
    entry.absences.sort((left, right) => left.startDate.localeCompare(right.startDate) || left.id.localeCompare(right.id));
    entry.shiftSwaps.sort((left, right) => left.date.localeCompare(right.date) || left.requestedAt.localeCompare(right.requestedAt) || left.id.localeCompare(right.id));
  }
  return [...people.values()].sort((left, right) => (left.name ?? '').localeCompare(right.name ?? '', 'pt-BR') || left.uid.localeCompare(right.uid));
}

/**
 * O fechamento individual existe para toda pessoa da equipe congelada na versão, mesmo quando ela não teve ajuste ou
 * ausência no mês. Pessoas com ocorrência continuam incluídas ainda que tenham saído da equipe antes do fechamento.
 */
export function includeClosureRoster(people: ClosurePerson[], roster: ClosureRosterPerson[]): ClosurePerson[] {
  const merged = new Map(people.map((person) => [person.uid, { ...person, adjustments: [...person.adjustments], absences: [...person.absences], shiftSwaps: [...person.shiftSwaps] }]));
  for (const subject of roster) {
    const current = merged.get(subject.uid);
    if (current) {
      if (!current.name && subject.name) current.name = subject.name;
    } else {
      merged.set(subject.uid, { uid: subject.uid, name: subject.name, adjustments: [], absences: [], shiftSwaps: [] });
    }
  }
  return [...merged.values()].sort((left, right) => (left.name ?? '').localeCompare(right.name ?? '', 'pt-BR') || left.uid.localeCompare(right.uid));
}

export function pendingOf(people: ClosurePerson[]) {
  return {
    adjustments: people.reduce((sum, entry) => sum + entry.adjustments.filter((item) => item.status === 'in_review').length, 0),
    absences: people.reduce((sum, entry) => sum + entry.absences.filter((item) => (OPEN_ABSENCE_STATUSES as readonly string[]).includes(item.status)).length, 0),
    shiftSwaps: new Set(people.flatMap((entry) => entry.shiftSwaps.filter((item) => item.status === 'pending').map((item) => item.id))).size,
  };
}

/** Carimbo de cada item, para a versão reaberta dizer o que entrou, mudou ou saiu em relação à anterior. */
export function itemDigests(people: ClosurePerson[]) {
  const digests: Record<string, string> = {};
  for (const entry of people) {
    for (const item of entry.adjustments) digests[`adjustment:${item.id}`] = sha256(item);
    for (const item of entry.absences) digests[`absence:${item.id}`] = sha256(item);
    for (const item of entry.shiftSwaps) digests[`shift-swap:${item.id}`] = sha256(item);
  }
  return digests;
}
export function diffDigests(previous: Record<string, string> | null, next: Record<string, string>): ClosureChanges | null {
  if (!previous) return null;
  const added = Object.keys(next).filter((key) => !(key in previous)).sort();
  const changed = Object.keys(next).filter((key) => key in previous && previous[key] !== next[key]).sort();
  const removed = Object.keys(previous).filter((key) => !(key in next)).sort();
  return { added, changed, removed };
}
