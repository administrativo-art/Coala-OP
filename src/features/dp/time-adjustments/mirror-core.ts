/**
 * Espelho de ponto do fechamento (Etapa 6, parte 2). O instantâneo é montado uma vez por pessoa e versão do
 * fechamento e gravado; o PDF é sempre derivado dele, nunca do cadastro atual. Puro e testável.
 */
import { competenceRange, sha256, type ClosureAbsence, type ClosureAdjustment, type ClosurePerson, type ClosureShiftSwap } from './closure-core';

export const MIRROR_TITLE = 'Espelho de ponto' as const;
export const MIRROR_RENDERER_VERSION = 'ptrp-mirror-pdf-v1' as const;

/** `at` é o instante fiscal completo (com data e fuso): ordena e soma os pares mesmo depois da meia-noite. */
export type MirrorPunch = { time: string; at: string; nsr: number | null; mark: 'original' | 'discarded' | 'included' };
export type MirrorDay = { date: string; shift: string | null; punches: MirrorPunch[]; pairedMinutes: number | null; absences: string[] };
export type MirrorSnapshot = {
  schemaVersion: 1; title: typeof MIRROR_TITLE; workspaceId: string; competence: string; closureVersion: number; manifestHash: string;
  employee: { uid: string; name: string; cpf: string | null }; employer: { legalName: string | null; cnpj: string | null };
  generatedAt: string; clockSource: 'hora_legal' | 'server'; days: MirrorDay[];
  adjustments: ClosureAdjustment[]; absences: ClosureAbsence[]; shiftSwaps: ClosureShiftSwap[]; truncated: boolean;
  /** O que foi lido do REP-P ao gerar: batidas tardias depois disso só entram por reabertura e versão nova. */
  arpReading: { count: number; maxNsr: number | null; readAt: string };
  /** Nome de quem pediu e de quem decidiu, congelado junto: o AEJ e o espelho identificam a autoria. */
  actors: Record<string, string>;
};
export type MirrorAgreement = { at: string; clockSource: 'hora_legal' | 'server'; uid: string; snapshotHash: string; channel: 'web' | 'mobile' };

export type MirrorInputs = {
  workspaceId: string; competence: string; closureVersion: number; manifestHash: string; generatedAt: string; clockSource: 'hora_legal' | 'server';
  employee: { uid: string; name: string; cpf: string | null }; employer: { legalName: string | null; cnpj: string | null };
  markings: Array<{ workDate: string; nsr: number; markedAt: string }>;
  shifts: Array<{ date: string; type: 'work' | 'day_off'; startTime: string | null; endTime: string | null; shiftName: string | null }>;
  declaration: ClosurePerson | null; truncated: boolean; actors: Record<string, string>;
};

const clock = (markedAt: string) => markedAt.slice(11, 16);
/** Instante do carimbo fiscal `AAAA-MM-DDTHH:mm:ss-0300`. */
export const fiscalMs = (markedAt: string) => Date.parse(markedAt.replace(/([+-]\d{2})(\d{2})$/, '$1:$2'));
/** Soma dos intervalos entre pares (1ª–2ª, 3ª–4ª...) por instante. Número ímpar de batidas deixa o dia sem soma. */
export function pairedMinutes(instants: string[]) {
  if (!instants.length || instants.length % 2) return instants.length ? null : 0;
  let total = 0;
  for (let index = 0; index < instants.length; index += 2) total += Math.round((fiscalMs(instants[index + 1]) - fiscalMs(instants[index])) / 60_000);
  return total;
}
export function hoursText(value: number | null) {
  return value === null ? 'sem soma (ímpar)' : `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
}

/**
 * Cada dia do mês com escala, batidas originais (as desconsideradas por ajuste aprovado ficam marcadas, não somem),
 * as incluídas por ajuste aprovado e as ausências aprovadas que cobrem o dia.
 */
export function buildMirrorSnapshot(input: MirrorInputs): MirrorSnapshot {
  const { start, end } = competenceRange(input.competence);
  const adjustments = input.declaration?.adjustments ?? [];
  const absences = input.declaration?.absences ?? [];
  const shiftSwaps = input.declaration?.shiftSwaps ?? [];
  const approved = adjustments.filter((item) => item.status === 'approved');
  const discarded = new Set(approved.filter((item) => item.original && item.kind !== 'include').map((item) => `${item.original!.nsr}|${item.original!.markedAt}`));
  const days: MirrorDay[] = [];
  for (let cursor = Date.parse(`${start}T00:00:00Z`); cursor <= Date.parse(`${end}T00:00:00Z`); cursor += 86_400_000) {
    const date = new Date(cursor).toISOString().slice(0, 10);
    const shift = input.shifts.find((item) => item.date === date) ?? null;
    const originals: MirrorPunch[] = input.markings.filter((item) => item.workDate === date)
      .map((item) => ({ time: clock(item.markedAt), at: item.markedAt, nsr: item.nsr, mark: discarded.has(`${item.nsr}|${item.markedAt}`) ? 'discarded' as const : 'original' as const }));
    const included: MirrorPunch[] = approved.filter((item) => item.workDate === date && item.inclusion)
      .map((item) => ({ time: clock(item.inclusion!.markedAt), at: item.inclusion!.markedAt, nsr: null, mark: 'included' as const }));
    const punches = [...originals, ...included].sort((left, right) => fiscalMs(left.at) - fiscalMs(right.at) || (left.nsr ?? 0) - (right.nsr ?? 0));
    const dayAbsences = absences.filter((item) => item.status === 'approved' && item.startDate <= date && item.endDate >= date)
      .map((item) => `${item.typeName}${item.approval === 'tacit_timeout' ? ' (aprovada por decurso de prazo)' : ''}`);
    if (!shift && !punches.length && !dayAbsences.length) continue;
    days.push({
      date, shift: shift ? (shift.type === 'day_off' ? 'Folga' : [shift.startTime && shift.endTime ? `${shift.startTime}–${shift.endTime}` : null, shift.shiftName].filter(Boolean).join(' · ') || 'Turno') : null,
      punches, pairedMinutes: pairedMinutes(punches.filter((item) => item.mark !== 'discarded').map((item) => item.at)), absences: dayAbsences,
    });
  }
  return {
    schemaVersion: 1, title: 'Espelho de ponto', workspaceId: input.workspaceId, competence: input.competence, closureVersion: input.closureVersion,
    manifestHash: input.manifestHash, employee: input.employee, employer: input.employer, generatedAt: input.generatedAt, clockSource: input.clockSource,
    days, adjustments, absences, shiftSwaps, truncated: input.truncated, actors: input.actors,
    arpReading: { count: input.markings.length, maxNsr: input.markings.length ? Math.max(...input.markings.map((item) => item.nsr)) : null, readAt: input.generatedAt },
  };
}
export function mirrorSnapshotHash(snapshot: MirrorSnapshot) { return sha256(snapshot); }

/** Faltando identificação ou com lista cortada, o espelho não recebe concordância: a pessoa procura o DP. */
export function mirrorIncompleteReason(snapshot: MirrorSnapshot) {
  if (snapshot.truncated) return 'O espelho não comporta todas as batidas do mês.';
  if (!snapshot.employee.cpf || !snapshot.employer.cnpj || !snapshot.employer.legalName) return 'Faltam dados de identificação do trabalhador ou do empregador.';
  if (!snapshot.manifestHash) return 'O fechamento não tem carimbo da declaração.';
  return null;
}

/** Dados fictícios da prévia do catálogo de documentos. */
export const MIRROR_PREVIEW_SNAPSHOT: MirrorSnapshot = buildMirrorSnapshot({
  workspaceId: 'preview', competence: '2026-01', closureVersion: 1, manifestHash: '0'.repeat(64), generatedAt: '2026-02-02T12:00:00.000Z', clockSource: 'hora_legal',
  employee: { uid: 'preview', name: 'Pessoa colaboradora exemplo', cpf: '52998224725' }, employer: { legalName: 'Empregador exemplo LTDA', cnpj: '11222333000181' },
  markings: [{ workDate: '2026-01-05', nsr: 1, markedAt: '2026-01-05T08:02:00-0300' }, { workDate: '2026-01-05', nsr: 2, markedAt: '2026-01-05T12:00:00-0300' },
    { workDate: '2026-01-05', nsr: 3, markedAt: '2026-01-05T12:01:00-0300' }, { workDate: '2026-01-05', nsr: 4, markedAt: '2026-01-05T13:00:00-0300' },
    { workDate: '2026-01-05', nsr: 5, markedAt: '2026-01-05T16:03:00-0300' }],
  shifts: [{ date: '2026-01-05', type: 'work', startTime: '08:00', endTime: '16:00', shiftName: 'Manhã' }, { date: '2026-01-06', type: 'work', startTime: '08:00', endTime: '16:00', shiftName: 'Manhã' },
    { date: '2026-01-11', type: 'day_off', startTime: null, endTime: null, shiftName: null }],
  declaration: { uid: 'preview', name: 'Pessoa colaboradora exemplo', adjustments: [{ id: 'a', workDate: '2026-01-05', kind: 'discard', status: 'approved',
    original: { nsr: 3, markedAt: '2026-01-05T12:01:00-0300' }, inclusion: null, reason: 'Bati duas vezes seguidas na saída para o intervalo.', requestedBy: 'preview',
    requestedAt: '2026-01-05T15:00:00.000Z', decidedBy: 'dp', decidedAt: '2026-01-06T12:00:00.000Z', decisionReason: 'Conferido com a gerente.' }],
  absences: [{ id: 'b', typeName: 'Atestado', startDate: '2026-01-06', endDate: '2026-01-06', startTime: null, endTime: null, quantity: 1, unit: 'day', status: 'approved',
    approval: 'tacit_timeout', decidedBy: null, decidedAt: '2026-01-09T12:00:00.000Z', attachmentCount: 1 }], shiftSwaps: [] },
  truncated: false, actors: { preview: 'Pessoa colaboradora exemplo', dp: 'Departamento Pessoal' },
});
