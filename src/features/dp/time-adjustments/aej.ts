/**
 * Arquivo Eletrônico de Jornada (AEJ), leiaute 002 do MTE, arquivado em docs/rep-p/referencias/leiaute-aej-v002.pdf
 * (sha256 e1ff56a6…). Puro: recebe batidas originais da ARP, tratamentos aprovados e escala, e devolve o texto
 * ISO 8859-1 com CRLF, campos separados por "|" e a linha final da assinatura destacada (.p7s).
 *
 * Pontos ainda a conferir com o MTE/advogado (registrados no fluxo): largura de seqEntSaida (usamos 3 dígitos),
 * seqEntSaida da marcação desconsiderada (usamos "000") e dia sem escala (sem codHorContratual, vira aviso).
 * Turno noturno preserva o horário contratual e recebe as saídas após meia-noite no dia de início do turno.
 */
import { createHash } from 'node:crypto';

import type { readRepPMonthOfPerson } from '@/features/dp/rep-p/own-month.server';

export const AEJ_LAYOUT_VERSION = '002' as const;
const SIGNATURE_LITERAL = 'ASSINATURA_DIGITAL_EM_ARQUIVO_P7S';

export type AejShift = { date: string; startTime: string; endTime: string; overnight: boolean; netMinutes: number;
  breaks: Array<{ start: string; end: string }> };
export type AejEmployee = {
  cpf: string; name: string;
  markings: Array<{ workDate: string; markedAt: string; nsr: number; discardReason: string | null }>;
  inclusions: Array<{ workDate: string; markedAt: string; reason: string }>;
  shifts: AejShift[];
  /** Dias escalados sem batida e sem ausência ainda não tratados pelo DP: só aviso, nada no arquivo. */
  pendingDays?: string[];
  /** Registro 07: "1" DSR, "2" falta não justificada, "3" movimento do banco ("1" inclusão, "2" compensação), "4" folga compensatória de feriado. */
  absences?: AejAbsence[];
};
export type AejAbsence = { date: string; kind: '1' | '2' | '3' | '4'; minutes?: number; movement?: '1' | '2' };
export type AejInput = {
  employer: { cnpj: string; legalName: string; caepf?: string | null; cno?: string | null };
  startDate: string; endDate: string; generatedAt: string;
  rep: { inpiRegistration: string };
  ptrp: { name: string; version: string; developerCnpj: string; developerName: string; developerEmail: string };
  employees: AejEmployee[];
};
export type AejWarning = { cpf: string; date: string; code: 'NO_SHIFT' | 'NIGHT_SHIFT' | 'ODD_MARKINGS' | 'PENDING_DAY' };

/** ISO 8859-1 sem "|" nem quebra: o resto vira "?" para não corromper o leiaute. */
export function aejText(value: string, max: number) {
  return value.normalize('NFC').replace(/[\r\n|]+/g, ' ').replace(/\s+/g, ' ').replace(/[^\x20-\x7E\u00A0-\u00FF]/gu, '?').trim().slice(0, max);
}
const hhmm = (time: string) => time.replace(':', '');
const digits = (value: string) => value.replace(/\D/g, '');
const fiscalMs = (markedAt: string) => Date.parse(markedAt.replace(/([+-]\d{2})(\d{2})$/, '$1:$2'));
/** Chave do horário contratual: entradas, saídas e duração líquida; turnos iguais nisso dividem o mesmo código. */
export function contractKey(shift: AejShift) {
  return [shift.startTime, ...shift.breaks.flatMap((item) => [item.start, item.end]), shift.endTime, shift.netMinutes].join('-');
}
function contractLine(code: string, shift: AejShift) {
  // Pares entrada/saída: início → 1º intervalo, retorno → próximo intervalo..., último retorno → fim.
  const points = [shift.startTime, ...shift.breaks.flatMap((item) => [item.start, item.end]), shift.endTime].map(hhmm);
  const pairs: string[] = [];
  for (let index = 0; index < points.length; index += 2) pairs.push(points[index], points[index + 1]);
  while (pairs.length < 4) pairs.push('');
  return ['04', code, String(shift.netMinutes), ...pairs].join('|');
}

export function generateAej(input: AejInput) {
  const counts: Record<'01' | '02' | '03' | '04' | '05' | '06' | '07' | '08', number> = { '01': 0, '02': 0, '03': 0, '04': 0, '05': 0, '06': 0, '07': 0, '08': 0 };
  const warnings: AejWarning[] = [];
  const lines: string[] = [];
  const push = (type: keyof typeof counts, line: string) => { counts[type] += 1; lines.push(line); };
  const cnpj = digits(input.employer.cnpj);
  push('01', ['01', '1', cnpj, digits(input.employer.caepf ?? ''), digits(input.employer.cno ?? ''), aejText(input.employer.legalName, 150),
    input.startDate, input.endDate, input.generatedAt, AEJ_LAYOUT_VERSION].join('|'));
  push('02', ['02', '1', '3', input.rep.inpiRegistration ? digits(input.rep.inpiRegistration).padStart(17, '0') : ''].join('|'));
  const employees = [...input.employees].sort((left, right) => left.cpf.localeCompare(right.cpf));
  employees.forEach((employee, index) => push('03', ['03', String(index + 1), digits(employee.cpf), aejText(employee.name, 150)].join('|')));
  const byKey = new Map<string, AejShift>();
  for (const employee of employees) for (const shift of employee.shifts) if (!byKey.has(contractKey(shift))) byKey.set(contractKey(shift), shift);
  // Código sequencial (HC001…) pela ordem da chave: curto, estável para a mesma entrada e sem colisão.
  const codes = new Map([...byKey.keys()].sort().map((key, index) => [key, `HC${String(index + 1).padStart(3, '0')}`]));
  for (const [key, shift] of [...byKey.entries()].sort(([left], [right]) => left.localeCompare(right))) push('04', contractLine(codes.get(key)!, shift));

  for (const employee of employees) for (const date of employee.pendingDays ?? []) if (date >= input.startDate && date <= input.endDate) warnings.push({ cpf: employee.cpf, date, code: 'PENDING_DAY' });
  employees.forEach((employee, index) => {
    const vinculo = String(index + 1);
    const dates = [...new Set([...employee.markings.map((item) => item.workDate), ...employee.inclusions.map((item) => item.workDate)])]
      .filter((date) => date >= input.startDate && date <= input.endDate).sort();
    for (const date of dates) {
      const shift = employee.shifts.find((item) => item.date === date) ?? null;
      if (!shift) warnings.push({ cpf: employee.cpf, date, code: 'NO_SHIFT' });
      type Row = { at: string; nsr: number | null; source: 'O' | 'I'; discardReason: string | null; reason: string | null };
      const rows: Row[] = [
        ...employee.markings.filter((item) => item.workDate === date).map((item) => ({ at: item.markedAt, nsr: item.nsr, source: 'O' as const, discardReason: item.discardReason, reason: null })),
        ...employee.inclusions.filter((item) => item.workDate === date).map((item) => ({ at: item.markedAt, nsr: null, source: 'I' as const, discardReason: null, reason: item.reason })),
      ].sort((left, right) => fiscalMs(left.at) - fiscalMs(right.at) || (left.nsr ?? Number.MAX_SAFE_INTEGER) - (right.nsr ?? Number.MAX_SAFE_INTEGER));
      const effective = rows.filter((row) => !row.discardReason);
      if (effective.length % 2) warnings.push({ cpf: employee.cpf, date, code: 'ODD_MARKINGS' });
      for (const row of rows) {
        const position = effective.indexOf(row);
        const kind = row.discardReason ? 'D' : position % 2 === 0 ? 'E' : 'S';
        const seq = row.discardReason ? '000' : String(Math.floor(position / 2) + 1).padStart(3, '0');
        const code = kind === 'E' && seq === '001' && shift ? codes.get(contractKey(shift))! : '';
        const motivo = row.discardReason ? aejText(row.discardReason, 150) : row.source === 'I' ? aejText(row.reason ?? '', 150) : '';
        // O leiaute exige motivo em toda desconsideração e inclusão.
        if ((kind === 'D' || row.source === 'I') && !motivo) throw new Error(`AEJ_MOTIVO_MISSING:${employee.cpf}:${date}`);
        push('05', ['05', vinculo, row.at, row.source === 'O' ? '1' : '', kind, seq, row.source, code, motivo].join('|'));
      }
    }
  });
  // Registro 07 depois de todas as marcações: ausências e banco de horas por vínculo, em ordem de data.
  employees.forEach((employee, index) => {
    for (const item of [...(employee.absences ?? [])].filter((entry) => entry.date >= input.startDate && entry.date <= input.endDate)
      .sort((left, right) => left.date.localeCompare(right.date) || left.kind.localeCompare(right.kind) || (left.movement ?? '').localeCompare(right.movement ?? ''))) {
      if (item.kind === '3' && (!item.minutes || !item.movement)) throw new Error(`AEJ_BANK_MOVEMENT_INVALID:${employee.cpf}:${item.date}`);
      push('07', ['07', String(index + 1), item.kind, item.date, item.kind === '3' ? String(item.minutes) : '', item.kind === '3' ? item.movement! : ''].join('|'));
    }
  });
  push('08', ['08', aejText(input.ptrp.name, 150), aejText(input.ptrp.version, 8), '1', digits(input.ptrp.developerCnpj), aejText(input.ptrp.developerName, 150),
    aejText(input.ptrp.developerEmail, 50)].join('|'));
  lines.push(['99', counts['01'], counts['02'], counts['03'], counts['04'], counts['05'], counts['06'], counts['07'], counts['08']].join('|'));
  lines.push(SIGNATURE_LITERAL.padEnd(100, ' '));
  const bytes = Buffer.from(`${lines.join('\r\n')}\r\n`, 'latin1');
  const filename = `AEJ_${cnpj}_${input.startDate.replace(/-/g, '')}_${input.endDate.replace(/-/g, '')}.txt`;
  return { filename, signatureFilename: `${filename}.p7s`, bytes, sha256: createHash('sha256').update(bytes).digest('hex'), counts, lineCount: lines.length, warnings };
}

type MonthShift = Awaited<ReturnType<typeof readRepPMonthOfPerson>>['shifts'][number];
const minutesOf = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
/** Horário contratual do dia: início, intervalos com horário fixo e fim; duração líquida em minutos. */
export function aejShiftOf(shift: MonthShift): AejShift | null {
  if (shift.type !== 'work' || !shift.startTime || !shift.endTime) return null;
  const span = (minutesOf(shift.endTime) - minutesOf(shift.startTime) + 1440) % 1440 || 1440;
  const breaks = shift.breakType === 'fixed'
    ? (shift.breakSegments?.length ? shift.breakSegments : shift.breakStart && shift.breakEnd ? [{ start: shift.breakStart, end: shift.breakEnd }] : [])
    : [];
  return { date: shift.date, startTime: shift.startTime, endTime: shift.endTime, overnight: shift.overnight || minutesOf(shift.endTime) <= minutesOf(shift.startTime),
    netMinutes: Math.max(0, span - (shift.breakType && shift.breakType !== 'none' ? shift.breakDurationMinutes ?? 0 : 0)), breaks };
}
